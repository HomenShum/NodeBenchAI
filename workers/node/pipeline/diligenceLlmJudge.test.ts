/**
 * Scenario tests for the non-deterministic LLM judge parser + prompt builder.
 *
 * Per .claude/rules/scenario_testing.md — every test is anchored to a real
 * failure mode we expect Gemini to produce in production:
 *   - well-formed JSON (happy path, operator persona)
 *   - ```json fenced response (common with Flash)
 *   - prose wrapper around JSON (common with Pro)
 *   - malformed JSON (rate-limited or truncated response)
 *   - out-of-range scores (adversarial LLM behavior)
 *   - missing dimensions (prompt drift — we must fail hard, not default)
 *   - junk strengths/concerns (type confusion)
 *   - rogue LLM returning 1MB of text (BOUND check)
 *   - long-running: 200 sequential parses stay linear in time
 */

import { describe, it, expect } from "vitest";
import {
  buildLlmJudgePrompt,
  parseLlmJudgeResponse,
  promptHashOf,
  validateLlmJudgeScores,
  JUDGE_PROMPT_VERSION,
  type LlmJudgeInput,
  type LlmJudgeScores,
} from "./diligenceLlmJudge";

const BASE_INPUT: LlmJudgeInput = {
  entitySlug: "acme-ai",
  blockType: "founder",
  overallTier: "verified",
  headerText: "Founders",
  bodyProse:
    "Jane Doe is CEO and co-founder (ex-Google Brain, 2018-2023). John Smith is CTO.",
  payload: [{ name: "Jane Doe", role: "CEO" }],
  sources: [
    { label: "LinkedIn", url: "https://linkedin.com/in/janedoe", snippet: "CEO @ Acme AI" },
    { label: "Press release", snippet: "Acme AI announces seed round led by Sequoia" },
  ],
};

const VALID_RESPONSE = JSON.stringify({
  scores: {
    proseQuality: 0.82,
    citationCoherence: 0.7,
    sourceCredibility: 0.75,
    tierAppropriate: 0.8,
    overallSemantic: 0.76,
  },
  strengths: [
    "Specific dates (2018-2023) attached to prior role",
    "Both founders named with role",
  ],
  concerns: [
    "Only 2 sources — consider Crunchbase + SEC filings",
    "No mention of advisors or investors",
  ],
  proposedNextStep: "Verify Jane Doe's Google Brain tenure via LinkedIn or arxiv co-authorship",
  reason: "Prose is concrete, sources partly corroborate but 'verified' tier wants >=3",
});

describe("buildLlmJudgePrompt — deterministic prompt construction", () => {
  it("same input produces byte-identical prompt + hash across calls", () => {
    const p1 = buildLlmJudgePrompt(BASE_INPUT);
    const p2 = buildLlmJudgePrompt(BASE_INPUT);
    expect(p1).toEqual(p2);
    expect(promptHashOf(p1)).toEqual(promptHashOf(p2));
  });

  it("prompt hash changes when any input field changes", () => {
    const a = promptHashOf(buildLlmJudgePrompt(BASE_INPUT));
    const b = promptHashOf(buildLlmJudgePrompt({ ...BASE_INPUT, headerText: "Founders v2" }));
    expect(a).not.toEqual(b);
  });

  it("prompt includes all declared context fields", () => {
    const p = buildLlmJudgePrompt(BASE_INPUT);
    expect(p).toContain("acme-ai");
    expect(p).toContain("founder");
    expect(p).toContain("verified");
    expect(p).toContain("Jane Doe");
    expect(p).toContain("LinkedIn");
  });

  it("BOUND: massive prose is truncated (rogue caller protection)", () => {
    const huge = "X".repeat(50_000);
    const p = buildLlmJudgePrompt({ ...BASE_INPUT, bodyProse: huge });
    // Truncation ends with ellipsis + prose section bounded under 9KB.
    expect(p.length).toBeLessThan(16_000);
    expect(p).toContain("…");
  });

  it("missing sources → explicit '(no sources attached)' label, never undefined", () => {
    const p = buildLlmJudgePrompt({ ...BASE_INPUT, sources: [] });
    expect(p).toContain("(no sources attached)");
  });

  it("payload non-serializable (circular ref) → safe fallback, no throw", () => {
    const circular: Record<string, unknown> = { name: "cycle" };
    circular.self = circular;
    expect(() =>
      buildLlmJudgePrompt({ ...BASE_INPUT, payload: circular }),
    ).not.toThrow();
    const p = buildLlmJudgePrompt({ ...BASE_INPUT, payload: circular });
    expect(p).toContain("(payload could not be serialized)");
  });

  it("JUDGE_PROMPT_VERSION is a stable string (dashboards depend on it)", () => {
    expect(JUDGE_PROMPT_VERSION).toBe("llmjudge-v1");
  });
});

describe("parseLlmJudgeResponse — happy path (Flash returns clean JSON)", () => {
  it("parses a well-formed response with all dimensions", () => {
    const outcome = parseLlmJudgeResponse(VALID_RESPONSE);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.result.scores.proseQuality).toBe(0.82);
    expect(outcome.result.scores.overallSemantic).toBe(0.76);
    expect(outcome.result.strengths).toHaveLength(2);
    expect(outcome.result.concerns).toHaveLength(2);
    expect(outcome.result.proposedNextStep).toMatch(/Google Brain/);
    expect(outcome.result.reason.length).toBeGreaterThan(0);
  });

  it("extracts JSON from a ```json fenced response (common with Flash)", () => {
    const fenced = "Sure, here is the review:\n\n```json\n" + VALID_RESPONSE + "\n```\n\nLet me know if you want more.";
    const outcome = parseLlmJudgeResponse(fenced);
    expect(outcome.ok).toBe(true);
  });

  it("extracts JSON surrounded by free-form prose (common with Pro)", () => {
    const wrapped = "Thinking... the projection looks solid.\n\n" + VALID_RESPONSE + "\n\nHope that helps!";
    const outcome = parseLlmJudgeResponse(wrapped);
    expect(outcome.ok).toBe(true);
  });
});

describe("parseLlmJudgeResponse — sad paths (honest failure, no silent defaults)", () => {
  it("empty string → parse error, no fake scores", () => {
    const outcome = parseLlmJudgeResponse("");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error).toMatch(/empty/i);
  });

  it("no JSON found → parse error", () => {
    const outcome = parseLlmJudgeResponse("Sorry, I can't help with that.");
    expect(outcome.ok).toBe(false);
  });

  it("malformed JSON → parse error with details", () => {
    const broken = "{ scores: { proseQuality: 0.8 ";
    const outcome = parseLlmJudgeResponse(broken);
    expect(outcome.ok).toBe(false);
  });

  it("missing scores object → parse error", () => {
    const missing = JSON.stringify({ strengths: [], concerns: [] });
    const outcome = parseLlmJudgeResponse(missing);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error).toMatch(/scores/);
  });

  it("adversarial out-of-range score (LLM returns 1.5) → parse error", () => {
    const bad = JSON.stringify({
      scores: {
        proseQuality: 0.8,
        citationCoherence: 0.7,
        sourceCredibility: 0.7,
        tierAppropriate: 0.8,
        overallSemantic: 1.5, // <-- adversarial
      },
    });
    const outcome = parseLlmJudgeResponse(bad);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error).toMatch(/outside/);
  });

  it("adversarial negative score → parse error", () => {
    const bad = JSON.stringify({
      scores: {
        proseQuality: -0.1,
        citationCoherence: 0.5,
        sourceCredibility: 0.5,
        tierAppropriate: 0.5,
        overallSemantic: 0.5,
      },
    });
    const outcome = parseLlmJudgeResponse(bad);
    expect(outcome.ok).toBe(false);
  });

  it("adversarial string-shaped score → parse error", () => {
    const bad = JSON.stringify({
      scores: {
        proseQuality: "high",
        citationCoherence: 0.5,
        sourceCredibility: 0.5,
        tierAppropriate: 0.5,
        overallSemantic: 0.5,
      },
    });
    const outcome = parseLlmJudgeResponse(bad);
    expect(outcome.ok).toBe(false);
  });

  it("rogue LLM returns 1MB blob → rejected by BOUND check, no OOM", () => {
    const huge = "x".repeat(500_000) + VALID_RESPONSE;
    const outcome = parseLlmJudgeResponse(huge);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error).toMatch(/too large/);
  });
});

describe("parseLlmJudgeResponse — junk cleanup (defensive parsing)", () => {
  it("strengths with non-string items → filtered, doesn't fail whole parse", () => {
    const mixed = JSON.stringify({
      scores: {
        proseQuality: 0.8,
        citationCoherence: 0.7,
        sourceCredibility: 0.7,
        tierAppropriate: 0.8,
        overallSemantic: 0.76,
      },
      strengths: ["good point", 42, null, { nested: "bad" }, "another good"],
      concerns: [],
    });
    const outcome = parseLlmJudgeResponse(mixed);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.result.strengths).toEqual(["good point", "another good"]);
  });

  it("overlong strength bullet → truncated with ellipsis, not dropped", () => {
    const long = "x".repeat(500);
    const payload = JSON.stringify({
      scores: {
        proseQuality: 0.8,
        citationCoherence: 0.7,
        sourceCredibility: 0.7,
        tierAppropriate: 0.8,
        overallSemantic: 0.76,
      },
      strengths: [long],
      concerns: [],
    });
    const outcome = parseLlmJudgeResponse(payload);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.result.strengths[0].length).toBeLessThanOrEqual(241);
    expect(outcome.result.strengths[0]).toMatch(/…$/);
  });

  it("more than MAX_STRENGTHS items → first N kept (operator sees top-ranked)", () => {
    const many = Array.from({ length: 20 }, (_, i) => `strength ${i}`);
    const payload = JSON.stringify({
      scores: {
        proseQuality: 0.8,
        citationCoherence: 0.7,
        sourceCredibility: 0.7,
        tierAppropriate: 0.8,
        overallSemantic: 0.76,
      },
      strengths: many,
      concerns: [],
    });
    const outcome = parseLlmJudgeResponse(payload);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.result.strengths).toHaveLength(5); // MAX_STRENGTHS
    expect(outcome.result.strengths[0]).toBe("strength 0");
  });

  it("missing optional fields → defaults to empty, not null", () => {
    const minimal = JSON.stringify({
      scores: {
        proseQuality: 0.9,
        citationCoherence: 0.9,
        sourceCredibility: 0.9,
        tierAppropriate: 0.9,
        overallSemantic: 0.9,
      },
    });
    const outcome = parseLlmJudgeResponse(minimal);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.result.strengths).toEqual([]);
    expect(outcome.result.concerns).toEqual([]);
    expect(outcome.result.proposedNextStep).toBe("");
    expect(outcome.result.reason).toBe("");
  });
});

describe("validateLlmJudgeScores — defense in depth", () => {
  const validScores: LlmJudgeScores = {
    proseQuality: 0.5,
    citationCoherence: 0.5,
    sourceCredibility: 0.5,
    tierAppropriate: 0.5,
    overallSemantic: 0.5,
  };

  it("valid scores do not throw", () => {
    expect(() => validateLlmJudgeScores(validScores)).not.toThrow();
  });

  it("NaN injected by buggy caller → throw, HONEST_SCORES", () => {
    expect(() =>
      validateLlmJudgeScores({ ...validScores, proseQuality: Number.NaN }),
    ).toThrow(/proseQuality/);
  });

  it("negative score injected → throw", () => {
    expect(() =>
      validateLlmJudgeScores({ ...validScores, overallSemantic: -0.1 }),
    ).toThrow(/overallSemantic/);
  });

  it("> 1 score injected → throw", () => {
    expect(() =>
      validateLlmJudgeScores({ ...validScores, citationCoherence: 2.0 }),
    ).toThrow(/citationCoherence/);
  });
});

describe("parseLlmJudgeResponse — long-running accumulation", () => {
  it("parsing 200 sequential valid responses stays linear (<2s)", () => {
    const start = performance.now();
    for (let i = 0; i < 200; i++) {
      const out = parseLlmJudgeResponse(VALID_RESPONSE);
      if (!out.ok) throw new Error(`iteration ${i} failed`);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2_000);
  });
});
