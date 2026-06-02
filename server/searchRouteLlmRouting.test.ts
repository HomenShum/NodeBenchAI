/**
 * Scenario-based tests for the search route's LLM-router wiring
 * (server/routes/search.ts `searchRouteSignals` + the shared router).
 *
 * Track B of the LLM-router rollout routes the search pipeline's Gemini calls
 * (classify / extract / synthesize) through shared/llm/router.ts instead of a
 * hardcoded `gemini-3.1-flash-lite-preview`. The whole point is that this is
 * BEHAVIOR-PRESERVING for the common case: the floor of every pool is that same
 * flash-lite model, so a short, single-entity, non-analytical query MUST still
 * resolve to flash-lite. Only long / analytical / many-source / multi-entity
 * turns may escalate.
 *
 * Per .claude/rules/scenario_testing.md each test starts from a real persona +
 * goal. The risks we are guarding against:
 *   - Regression that ESCALATES the simple case (cost blowup + a non-no-op rollout).
 *   - Regression that FAILS to escalate the genuinely hard comparison case.
 *   - Non-determinism (same query routing differently across calls — breaks replay).
 *
 * Per .claude/rules/agentic_reliability.md DETERMINISTIC: routeLLM + signal
 * derivation are pure, so identical inputs must always yield the identical model.
 */
import { describe, expect, it } from "vitest";

import { searchRouteSignals } from "./routes/search.js";
import { routeLLM } from "../shared/llm/router.js";

const FLASH_LITE = "gemini-3.1-flash-lite-preview"; // the production floor before this change
const FLASH = "gemini-3-flash-preview"; // the escalation target for extract/synthesize

describe("search route LLM routing — behavior-preserving floor (the no-op guarantee)", () => {
  /**
   * Persona: a founder types a bare company name to pull a quick entity card.
   * Goal: fast, cheap single-entity lookup.
   * Prior state: a normal single-entity search with a handful of snippets.
   * Expected: extract stays on the flash-lite floor — IDENTICAL to pre-router
   * behavior. If this ever escalates, the "additive no-op" promise is broken.
   */
  it("keeps a short single-entity extract on the flash-lite floor", () => {
    const sig = searchRouteSignals("Mercury", 3);
    const r = routeLLM("extract", sig);
    expect(r.model).toBe(FLASH_LITE);
    expect(r.tier).toBe("light");
    expect(r.escalated).toBe(false);
  });

  /**
   * Persona: same founder, slightly longer plain-language query, few sources.
   * Expected: still the floor — length alone (under the medium threshold) and a
   * non-analytical phrasing must not trip escalation.
   */
  it("keeps a medium plain-language single-entity query on the floor", () => {
    const sig = searchRouteSignals("Tell me about the company Linear and what they do", 4);
    const r = routeLLM("extract", sig);
    expect(r.model).toBe(FLASH_LITE);
    expect(r.escalated).toBe(false);
  });

  /**
   * classify is a single-candidate pool — it can NEVER escalate, no matter how
   * complex the query looks. This is the strongest no-op guarantee in the route.
   */
  it("classify never escalates regardless of query complexity", () => {
    const heavy = searchRouteSignals(
      "Compare Anthropic versus OpenAI on tool use, pricing, and the strategic risks for a multi-tenant deployment",
      12,
      { multiEntity: true },
    );
    const r = routeLLM("classify", heavy);
    expect(r.model).toBe(FLASH_LITE);
    expect(r.tier).toBe("light");
    expect(r.escalated).toBe(false);
  });
});

describe("search route LLM routing — escalation on genuinely hard turns", () => {
  /**
   * Persona: an investor runs a head-to-head comparison ("X vs Y") across many
   * gathered sources. Goal: a well-reasoned comparative synthesis.
   * Prior state: the multi-entity branch gathered results for 2+ entities.
   * Expected: extract escalates above the flash-lite floor — multiEntity plus an
   * analytical verb plus many sources together cross the heavy threshold.
   */
  it("escalates a multi-entity comparison with many sources", () => {
    const sig = searchRouteSignals(
      "Compare Stripe versus Adyen for cross-border payments — tradeoffs and risks",
      14,
      { multiEntity: true },
    );
    const r = routeLLM("extract", sig);
    expect(r.escalated).toBe(true);
    expect(r.model).toBe(FLASH);
    expect(r.tier).not.toBe("light");
  });

  /**
   * Persona: a banker asks a long analytical diligence question over a deep
   * source set. Expected: synthesize escalates — "diligence" + length + sources.
   */
  it("escalates a long analytical diligence synthesis", () => {
    const q =
      "Give me a full diligence teardown of why this company's moat is defensible, what the strategic risks are, and how the funding trajectory implies their runway under a downturn scenario at scale.";
    const r = routeLLM("synthesize", searchRouteSignals(q, 9));
    expect(r.escalated).toBe(true);
    expect(r.model).toBe(FLASH);
  });

  /**
   * Boundary: a short but explicitly multi-entity comparison with only a couple
   * of sources. multiEntity (0.3) + analytical "compare" hint (0.5) already clears
   * the escalate threshold (0.5) even without source weight, so it should escalate.
   */
  it("escalates a short multi-entity comparison even with few sources", () => {
    const sig = searchRouteSignals("compare Brave and Serper", 2, { multiEntity: true });
    const r = routeLLM("extract", sig);
    expect(r.escalated).toBe(true);
  });
});

describe("search route LLM routing — determinism (replay safety)", () => {
  it("derives identical signals + route for identical inputs", () => {
    const a = searchRouteSignals("How should we evaluate voice agents for latency?", 5);
    const b = searchRouteSignals("How should we evaluate voice agents for latency?", 5);
    expect(a).toEqual(b);
    expect(routeLLM("extract", a)).toEqual(routeLLM("extract", b));
  });

  it("coerces missing / negative source counts to a safe 0 (no NaN leaks into scoring)", () => {
    expect(searchRouteSignals("x", Number.NaN as unknown as number).sourceCount).toBe(0);
    expect(searchRouteSignals("x", -5).sourceCount).toBe(0);
    // and the route is still deterministic + on the floor for this trivial input
    const r = routeLLM("extract", searchRouteSignals("x", Number.NaN as unknown as number));
    expect(r.model).toBe(FLASH_LITE);
    expect(r.escalated).toBe(false);
  });

  it("flags analytical intent as high complexity, plain lookups as low", () => {
    expect(searchRouteSignals("Why did valuations compress this quarter?", 3).complexityHint).toBe("high");
    expect(searchRouteSignals("Acme", 1).complexityHint).toBe("low");
  });
});
