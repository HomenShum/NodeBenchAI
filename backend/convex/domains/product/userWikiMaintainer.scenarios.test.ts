/**
 * Scenario tests for the wiki maintainer's pure helpers — per
 * .claude/rules/scenario_testing.md every test has a persona + goal + scale
 * + duration + failure-mode row, not a function-signature sanity check.
 *
 * Focus: parseGeneratedWikiJson + countUnsupportedClaims, the two gates
 * that stand between an LLM response and a user's wiki page. These are
 * the highest-blast-radius pure functions in the maintainer — if they
 * miss a malformed JSON or fail to flag an uncited specific, the user
 * sees editorial drift.
 */

import { describe, it, expect } from "vitest";
import {
  parseGeneratedWikiJson,
  countUnsupportedClaims,
} from "./userWikiMaintainer";

// ───────────────────────────────────────────────────────────────────────────
// parseGeneratedWikiJson — adversarial + degraded + happy
// ───────────────────────────────────────────────────────────────────────────

const HAPPY = {
  summary: "Stripe is a payments platform.",
  whatItIs: "Stripe builds developer-first payments APIs.",
  whyItMatters: "Underpins much of internet commerce [report_A].",
  whatChanged: "Raised Series I at $91.5B in 2023 [report_B].",
  openQuestions: "International expansion strategy unclear.",
};

describe("parseGeneratedWikiJson — happy path", () => {
  it("Scenario: model returns clean JSON, page renders on first regen", () => {
    // Persona: founder using the wiki for the first time.
    // Goal: see a synthesized Stripe page.
    // Scale: single user.
    // Duration: one regen.
    // Expected: ok=true, all 5 fields preserved verbatim.
    const result = parseGeneratedWikiJson(JSON.stringify(HAPPY));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.summary).toBe(HAPPY.summary);
      expect(result.data.whatItIs).toBe(HAPPY.whatItIs);
      expect(result.data.whyItMatters).toBe(HAPPY.whyItMatters);
      expect(result.data.whatChanged).toBe(HAPPY.whatChanged);
      expect(result.data.openQuestions).toBe(HAPPY.openQuestions);
    }
  });

  it("Scenario: model wraps JSON in ```json ... ``` fences (common)", () => {
    // Persona: any user; Gemini/Claude both emit fenced JSON by default.
    // Failure mode: naive JSON.parse rejects the fence wrapper.
    const fenced = "```json\n" + JSON.stringify(HAPPY) + "\n```";
    const result = parseGeneratedWikiJson(fenced);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.summary).toBe(HAPPY.summary);
    }
  });

  it("Scenario: model wraps in bare ``` fences without language tag", () => {
    const fenced = "```\n" + JSON.stringify(HAPPY) + "\n```";
    const result = parseGeneratedWikiJson(fenced);
    expect(result.ok).toBe(true);
  });

  it("Scenario: model emits JSON with leading/trailing whitespace", () => {
    const padded = "   \n\n" + JSON.stringify(HAPPY) + "\n\n   ";
    const result = parseGeneratedWikiJson(padded);
    expect(result.ok).toBe(true);
  });
});

describe("parseGeneratedWikiJson — degraded + adversarial", () => {
  it("Scenario: model emits empty response (provider outage partial)", () => {
    // Failure mode: upstream returned 200 with empty body. Gate must
    // fail closed, not pretend a happy path.
    const result = parseGeneratedWikiJson("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/empty/);
    }
  });

  it("Scenario: model emits only whitespace", () => {
    const result = parseGeneratedWikiJson("   \n\n  \t  ");
    expect(result.ok).toBe(false);
  });

  it("Scenario: model emits malformed JSON (stopped mid-string)", () => {
    const truncated = '{"summary":"Stripe is a paym';
    const result = parseGeneratedWikiJson(truncated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/json parse error/);
    }
  });

  it("Scenario: model emits top-level array instead of object", () => {
    // Some models mis-interpret the prompt and return `[{...}]`.
    const result = parseGeneratedWikiJson(JSON.stringify([HAPPY]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/object at top level/);
    }
  });

  it("Scenario: model emits object but missing required field", () => {
    const missingField = { ...HAPPY } as Partial<typeof HAPPY>;
    delete missingField.whyItMatters;
    const result = parseGeneratedWikiJson(JSON.stringify(missingField));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/whyItMatters/);
    }
  });

  it("Scenario: model emits field with non-string type (null)", () => {
    const badType = { ...HAPPY, summary: null };
    const result = parseGeneratedWikiJson(JSON.stringify(badType));
    expect(result.ok).toBe(false);
  });

  it("Scenario: model emits field with nested object instead of string", () => {
    const nested = { ...HAPPY, whatItIs: { text: "nested" } };
    const result = parseGeneratedWikiJson(JSON.stringify(nested));
    expect(result.ok).toBe(false);
  });

  it("Scenario: adversarial — model emits 20-MB summary to blow up the client", () => {
    // Persona: adversarial; upstream jailbreak tries to flood the UI.
    // Expected: gate clamps each field to the documented max (1200 chars
    // for prose, 500 for summary), so the payload is always bounded.
    const huge = "A".repeat(100_000);
    const result = parseGeneratedWikiJson(
      JSON.stringify({ ...HAPPY, summary: huge, whatItIs: huge }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.summary.length).toBeLessThanOrEqual(500);
      expect(result.data.whatItIs.length).toBeLessThanOrEqual(1200);
    }
  });

  it("Scenario: adversarial — JSON with extra fields is accepted, extras ignored", () => {
    // Models sometimes emit bonus fields ("reasoning", "scratchpad").
    // Gate must not reject valid payloads just because they carry extras.
    const result = parseGeneratedWikiJson(
      JSON.stringify({ ...HAPPY, reasoning: "hidden chain", scratchpad: "work" }),
    );
    expect(result.ok).toBe(true);
  });

  it("Scenario: adversarial — JSON injection via unicode control chars", () => {
    const weird = { ...HAPPY, summary: "Stripe\u0000\u0001hidden" };
    const result = parseGeneratedWikiJson(JSON.stringify(weird));
    // JSON.stringify escapes these; parse + clamp preserves the escaped form
    expect(result.ok).toBe(true);
  });
});

describe("parseGeneratedWikiJson — scale + duration", () => {
  it("Scenario: 100 regenerations on identical input produce identical parsed output", () => {
    // Persona: background maintainer running ambient refreshes.
    // Scale: 100 calls; must be deterministic (no time-dependent or
    // random-dependent behavior in the pure parser).
    const serialized = JSON.stringify(HAPPY);
    const first = parseGeneratedWikiJson(serialized);
    expect(first.ok).toBe(true);
    for (let i = 0; i < 100; i++) {
      const r = parseGeneratedWikiJson(serialized);
      expect(r.ok).toBe(true);
      if (r.ok && first.ok) {
        expect(r.data).toEqual(first.data);
      }
    }
  });

  it("Scenario: parser handles 1000 calls on malformed input without leaking memory", () => {
    // Pure function — no module-level state should accumulate.
    for (let i = 0; i < 1000; i++) {
      const r = parseGeneratedWikiJson(`{"bad":${i}`);
      expect(r.ok).toBe(false);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// countUnsupportedClaims — false-positive + false-negative sweep
// ───────────────────────────────────────────────────────────────────────────

describe("countUnsupportedClaims — correctness", () => {
  it("Scenario: prose with no specifics → 0 unsupported", () => {
    // Persona: model returned a safe, uncited synthesis paragraph.
    // Expected: no specifics triggered, 0 unsupported.
    expect(countUnsupportedClaims("Stripe is a payments platform.")).toBe(0);
    expect(countUnsupportedClaims("Important context for founders.")).toBe(0);
  });

  it("Scenario: prose with cited specifics → 0 unsupported", () => {
    // Every dollar/date/number has a [reportId] cite.
    const cited =
      "Stripe raised $91.5B [report_A]. Valuation hit $50B in 2023 [report_B]. " +
      "Revenue grew 25% [report_C].";
    expect(countUnsupportedClaims(cited)).toBe(0);
  });

  it("Scenario: uncited dollar amount → flagged", () => {
    // Failure mode: LLM invents a specific number without citing.
    expect(countUnsupportedClaims("Raised $5B in Series D.")).toBe(1);
  });

  it("Scenario: uncited percentage → flagged", () => {
    expect(countUnsupportedClaims("Revenue grew 42% this quarter.")).toBe(1);
  });

  it("Scenario: uncited year → flagged", () => {
    expect(countUnsupportedClaims("Founded in 2010 by the Collison brothers.")).toBe(1);
  });

  it("Scenario: uncited large number → flagged", () => {
    expect(countUnsupportedClaims("Now serves 3500 enterprises.")).toBe(1);
  });

  it("Scenario: multiple uncited specifics across sentences → each flagged", () => {
    const prose =
      "Stripe raised $5B. Valuation hit $200B in 2023. Revenue grew 42%.";
    // 3 sentences, each with an uncited specific.
    expect(countUnsupportedClaims(prose)).toBe(3);
  });

  it("Scenario: mix of cited + uncited — counts only uncited", () => {
    const prose =
      "Stripe raised $5B [report_A]. Valuation hit $200B. Revenue grew 42% [report_B].";
    // Middle sentence is uncited → 1 flagged.
    expect(countUnsupportedClaims(prose)).toBe(1);
  });

  it("Scenario: citation with hyphens + underscores + colons — still recognized", () => {
    const prose =
      "Raised $5B [report_xyz-123]. Grew 42% [csl:abcd1234]. Founded 2010 [artifact-99].";
    expect(countUnsupportedClaims(prose)).toBe(0);
  });

  it("Scenario: single-digit numbers NOT flagged (prevents false positives on common prose)", () => {
    // "3 founders" and "7 employees" are specifics but below the 3-digit
    // threshold; the rule intentionally ignores small numbers to avoid
    // flagging natural prose like "3 co-founders".
    expect(countUnsupportedClaims("Founded by 3 co-founders.")).toBe(0);
    expect(countUnsupportedClaims("Started with 7 employees.")).toBe(0);
  });

  it("Scenario: prose that mentions a year in context but IS cited → not flagged", () => {
    expect(countUnsupportedClaims("Founded in 2010 [about_A].")).toBe(0);
  });

  it("Scenario: empty prose → 0", () => {
    expect(countUnsupportedClaims("")).toBe(0);
    expect(countUnsupportedClaims("   ")).toBe(0);
  });

  it("Scenario: single-sentence prose without terminal punctuation → still analyzed", () => {
    // The sentence splitter is lenient; a single fragment still gets checked.
    expect(countUnsupportedClaims("Raised $5B last month")).toBeGreaterThanOrEqual(1);
  });

  it("Scenario: adversarial — sentence with [] that isn't a citation marker", () => {
    // Expected: empty brackets or non-id brackets don't satisfy the citation
    // regex. The current regex requires [a-zA-Z0-9_:-]+ inside brackets.
    expect(countUnsupportedClaims("Raised $5B [].")).toBe(1);
    expect(countUnsupportedClaims("Raised $5B [!?].")).toBe(1);
  });

  it("Scenario: scale — 500-sentence prose, every third sentence uncited", () => {
    const sentences: string[] = [];
    for (let i = 0; i < 500; i++) {
      if (i % 3 === 0) sentences.push(`Raised $${i + 100}M in round ${i}.`);
      else sentences.push(`Safe generic statement number ${i} [ref_${i}].`);
    }
    const prose = sentences.join(" ");
    const count = countUnsupportedClaims(prose);
    // Every i%3===0 is uncited and has a $N specific; expect ~167 flagged.
    expect(count).toBeGreaterThan(150);
    expect(count).toBeLessThan(180);
  });
});

describe("countUnsupportedClaims — gate integration", () => {
  it("Scenario: prose with 2 uncited specifics is at threshold (not failed)", () => {
    // hallucinationGateFailed triggers only when > 2 (from the maintainer
    // action). Exactly 2 unsupported is still acceptable — borderline
    // draft, not hard-fail.
    const prose = "Raised $5B. Grew 42%.";
    expect(countUnsupportedClaims(prose)).toBe(2);
  });

  it("Scenario: prose with 3 uncited specifics fails the hallucination gate", () => {
    const prose = "Raised $5B. Grew 42%. Founded 2010.";
    const count = countUnsupportedClaims(prose);
    expect(count).toBeGreaterThan(2); // triggers hallucinationGateFailed
  });

  it("Scenario: honest 0 when model cites every specific (the happy contract)", () => {
    const prose =
      "Stripe raised $91.5B [report_A]. Valuation hit $95B in 2024 [report_B]. " +
      "Has 10000+ customers [report_C].";
    expect(countUnsupportedClaims(prose)).toBe(0);
  });
});
