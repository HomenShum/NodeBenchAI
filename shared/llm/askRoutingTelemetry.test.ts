/**
 * Scenario-based tests for the LLM-router observability aggregate
 * (shared/llm/askRoutingTelemetry.ts).
 *
 * Per .claude/rules/scenario_testing.md each test names a persona + goal +
 * prior state + scale + duration + edge cases. The panel on the telemetry
 * surface renders these numbers verbatim, so the risks are:
 *   - a fabricated 0%/"healthy" when there's no data (HONEST_SCORES),
 *   - mis-counting cache/deterministic answers (that never hit the router) into
 *     the floor/escalated denominator,
 *   - non-deterministic breakdown ordering (UI jitter).
 */
import { describe, expect, it } from "vitest";
import { aggregateAskRouting, tierForModelId, type AskRoutingRow } from "./askRoutingTelemetry";

const HAIKU = "claude-haiku-4-5-20251001";
const SONNET = "claude-sonnet-4-6";

/** Build a routed (provider) answer row succinctly. */
function answer(partial: Partial<AskRoutingRow>): AskRoutingRow {
  return { agentMode: "provider", provider: "anthropic", modelId: HAIKU, estimatedCostCents: 0, ...partial };
}

describe("aggregateAskRouting — model mix + escalation (operator view)", () => {
  /**
   * Persona:     Operator opens /?surface=telemetry mid-event.
   * Goal:        See how often the router stayed on the Haiku floor vs. escalated.
   * Prior state: 10 routed answers — 7 Haiku floor, 3 Sonnet escalations.
   * Scale:       10 answers. Duration: single query.
   * Expected:    escalationRate = 3/10 = 0.3; floor/escalated counts exact;
   *              model mix sorted by count desc.
   */
  it("computes the floor-vs-escalated split from real model ids", () => {
    const rows: AskRoutingRow[] = [
      ...Array.from({ length: 7 }, () => answer({ modelId: HAIKU, estimatedCostCents: 0.01 })),
      ...Array.from({ length: 3 }, () => answer({ modelId: SONNET, estimatedCostCents: 0.05 })),
    ];
    const t = aggregateAskRouting(rows, false);

    expect(t.total).toBe(10);
    expect(t.routedCount).toBe(10);
    expect(t.floorCount).toBe(7);
    expect(t.escalatedCount).toBe(3);
    expect(t.escalationRate).toBe(0.3);
    // model mix is sorted by count desc — Haiku floor first.
    expect(t.modelMix[0]).toEqual({ modelId: HAIKU, count: 7, tier: "floor" });
    expect(t.modelMix[1]).toEqual({ modelId: SONNET, count: 3, tier: "escalated" });
  });

  /**
   * Persona:     Operator on a calm room — every question was a quick lookup.
   * Goal:        Confirm the router did NOT over-escalate (cost discipline).
   * Prior state: 5 routed answers, all Haiku.
   * Expected:    escalationRate = 0 (a REAL zero, not a null) — there IS a
   *              denominator (5 routed), the router genuinely never escalated.
   */
  it("reports a TRUE 0% escalation when the floor served every routed answer", () => {
    const rows = Array.from({ length: 5 }, () => answer({ modelId: HAIKU }));
    const t = aggregateAskRouting(rows, false);
    expect(t.routedCount).toBe(5);
    expect(t.escalationRate).toBe(0); // real 0, not null
    expect(t.escalatedCount).toBe(0);
  });
});

describe("aggregateAskRouting — HONEST_SCORES (no fabricated metrics)", () => {
  /**
   * Persona:     Operator opens telemetry for a brand-new deployment.
   * Goal:        Must NOT see a fake "0% escalation / $0 healthy" from no data.
   * Prior state: 0 answers.
   * Expected:    rates are null (panel renders "—"), counts are 0.
   */
  it("empty input → rates are null, never a fabricated 0% or $0/answer", () => {
    const t = aggregateAskRouting([], false);
    expect(t.total).toBe(0);
    expect(t.routedCount).toBe(0);
    expect(t.escalationRate).toBeNull();
    expect(t.providerFallbackRate).toBeNull();
    expect(t.avgCostCents).toBeNull();
    expect(t.totalCostCents).toBe(0);
    expect(t.modelMix).toEqual([]);
    expect(t.providerMix).toEqual([]);
  });

  /**
   * Persona:     Operator on a room where every answer was served from cache /
   *              the deterministic synthesizer (no model ever ran).
   * Goal:        The router metrics must stay null — these answers never invoked
   *              routeLLM, so there's no routing to report.
   * Prior state: 4 cache + 2 deterministic answers, 0 provider attempts.
   * Expected:    routedCount 0, escalationRate null, providerFallbackRate null,
   *              but the agentMode mix still counts all 6 for completeness.
   */
  it("cache/deterministic-only traffic → routing rates null, agentMode mix still counted", () => {
    const rows: AskRoutingRow[] = [
      ...Array.from({ length: 4 }, () => ({ agentMode: "cache" as const, modelId: null, estimatedCostCents: 0 })),
      ...Array.from({ length: 2 }, () => ({ agentMode: "deterministic" as const, modelId: null, estimatedCostCents: 0 })),
    ];
    const t = aggregateAskRouting(rows, false);
    expect(t.total).toBe(6);
    expect(t.routedCount).toBe(0);
    expect(t.escalationRate).toBeNull();
    expect(t.providerFallbackRate).toBeNull();
    expect(t.avgCostCents).toBeNull();
    expect(t.agentModes).toEqual({ provider: 0, provider_fallback: 0, cache: 4, deterministic: 2 });
  });
});

describe("aggregateAskRouting — provider-fallback + cost", () => {
  /**
   * Persona:     Operator notices answers feel degraded.
   * Goal:        See the provider-fallback rate — the headline degraded signal.
   * Prior state: 8 provider + 2 provider_fallback (Anthropic primary fell back).
   * Expected:    providerFallbackRate = 2/10 = 0.2; routedCount counts BOTH
   *              (a fallback still reached a model).
   */
  it("provider-fallback rate = fallbacks / (provider + fallback)", () => {
    const rows: AskRoutingRow[] = [
      ...Array.from({ length: 8 }, () => answer({ agentMode: "provider", modelId: HAIKU })),
      ...Array.from({ length: 2 }, () => answer({ agentMode: "provider_fallback", modelId: SONNET })),
    ];
    const t = aggregateAskRouting(rows, false);
    expect(t.routedCount).toBe(10);
    expect(t.providerFallbackRate).toBe(0.2);
    expect(t.agentModes.provider).toBe(8);
    expect(t.agentModes.provider_fallback).toBe(2);
  });

  /**
   * Persona:     Finance-minded operator checking cost discipline.
   * Goal:        Avg cost/answer should reflect ONLY routed answers (cache is free
   *              and must not dilute the average toward $0).
   * Prior state: 2 routed answers @ 0.10 + 0.30 cents, plus 3 free cache answers.
   * Expected:    avgCostCents = 0.40/2 = 0.2 (cache excluded from the average).
   */
  it("avg cost is over ROUTED answers only — free cache hits don't dilute it", () => {
    const rows: AskRoutingRow[] = [
      answer({ estimatedCostCents: 0.1 }),
      answer({ estimatedCostCents: 0.3 }),
      { agentMode: "cache", modelId: null, estimatedCostCents: 0 },
      { agentMode: "cache", modelId: null, estimatedCostCents: 0 },
      { agentMode: "cache", modelId: null, estimatedCostCents: 0 },
    ];
    const t = aggregateAskRouting(rows, false);
    expect(t.routedCount).toBe(2);
    expect(t.totalCostCents).toBe(0.4);
    expect(t.avgCostCents).toBe(0.2);
  });
});

describe("aggregateAskRouting — adversarial + scale + determinism", () => {
  /**
   * Persona:     Adversarial / messy data — env-pinned heavy model, blank model
   *              ids, weird providers, missing cost.
   * Goal:        Never crash; classify a pinned non-Haiku model as escalated; a
   *              blank model id as "other" (excluded from the escalation denom).
   * Prior state: 1 opus (pinned heavy), 1 blank-model provider answer, 1 haiku.
   * Expected:    escalation denom = floor + escalated = 1 haiku + 1 opus = 2; the
   *              blank-model row is "other" and excluded; escalationRate = 1/2.
   */
  it("classifies pinned-heavy as escalated and blank model id as 'other'", () => {
    const rows: AskRoutingRow[] = [
      answer({ modelId: "claude-opus-4-7", provider: "anthropic" }),
      answer({ modelId: "", provider: "anthropic" }), // unrecorded model
      answer({ modelId: HAIKU, provider: "anthropic" }),
    ];
    const t = aggregateAskRouting(rows, false);
    expect(t.routedCount).toBe(3);
    expect(t.floorCount).toBe(1);
    expect(t.escalatedCount).toBe(1);
    // 1 escalated / (1 floor + 1 escalated) — the "other" row is excluded.
    expect(t.escalationRate).toBe(0.5);
    const other = t.modelMix.find((m) => m.modelId === "(unrecorded model)");
    expect(other?.tier).toBe("other");
  });

  /**
   * Long-running accumulation: a multi-day room scanned at the BOUND cap.
   * Goal:        BOUND — the caller's `capped` flag is surfaced so the UI can say
   *              "(capped at 1000)". The aggregate stays correct over a large slice.
   * Prior state: 1000 routed answers (the cap), all Haiku, capped=true.
   * Expected:    total 1000, capped true, escalationRate 0 (all floor), O(n) stable.
   */
  it("scale: stays correct + honest about truncation at the read cap", () => {
    const rows = Array.from({ length: 1000 }, () => answer({ modelId: HAIKU }));
    const t = aggregateAskRouting(rows, /* capped */ true);
    expect(t.total).toBe(1000);
    expect(t.capped).toBe(true);
    expect(t.routedCount).toBe(1000);
    expect(t.escalationRate).toBe(0);
  });

  /**
   * Determinism (replay safety): identical rows → byte-identical output, and the
   * breakdowns tie-break deterministically by key when counts are equal.
   */
  it("is deterministic: same rows in → identical sorted breakdowns out", () => {
    const rows: AskRoutingRow[] = [
      answer({ provider: "zeta", modelId: SONNET }),
      answer({ provider: "alpha", modelId: HAIKU }),
      answer({ provider: "alpha", modelId: SONNET }),
      answer({ provider: "zeta", modelId: HAIKU }),
    ];
    const a = aggregateAskRouting(rows, false);
    const b = aggregateAskRouting(rows, false);
    expect(a).toEqual(b);
    // Equal counts (2 each) → alpha before zeta (localeCompare tie-break).
    expect(a.providerMix.map((p) => p.provider)).toEqual(["alpha", "zeta"]);
  });
});

describe("tierForModelId", () => {
  it("maps Haiku → floor, Sonnet/Opus → escalated, blank → other", () => {
    expect(tierForModelId(HAIKU)).toBe("floor");
    expect(tierForModelId("claude-haiku-pinned")).toBe("floor");
    expect(tierForModelId(SONNET)).toBe("escalated");
    expect(tierForModelId("claude-opus-4-7")).toBe("escalated");
    expect(tierForModelId("")).toBe("other");
  });
});
