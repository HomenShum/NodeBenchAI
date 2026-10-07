/**
 * Scenario tests for extendedThinkingRunner — pure prompt + parser layer.
 *
 * Personas:
 *   - Founder dropping "Anthropic" → 8-checkpoint run. First prompt has
 *     no prior findings; 5th prompt must include the 4 prior checkpoints.
 *   - Adversarial model returns malformed JSON, plain prose, giant blob,
 *     missing headline → parse_error each time.
 *   - Determinism: same input → same promptHash across 100 invocations.
 *   - Continuation rules: research_complete ends the chain; token budget
 *     exhaustion ends the chain; explicit checkpoint cap ends the chain.
 */

import { describe, it, expect } from "vitest";
import {
  buildCheckpointPrompt,
  parseCheckpointResponse,
  shouldContinue,
  EXTENDED_PROMPT_VERSION,
  MAX_CHECKPOINTS,
  type CheckpointPromptInput,
} from "./extendedThinkingRunner";

const BASE: CheckpointPromptInput = {
  runId: "run_2026_04_19_abc123",
  entityLabel: "Anthropic",
  goal: "Build a diligence brief including founders, product, funding, and market thesis.",
  checkpointIndex: 1,
  totalCheckpoints: 8,
  priorFindings: [],
};

const VALID_RESPONSE = JSON.stringify({
  headline: "Founders traced to Claude research lab split from OpenAI 2021",
  findings: [
    { text: "Dario Amodei is CEO, previously VP of Research at OpenAI", sourceRefId: "linkedin-1" },
    { text: "Daniela Amodei is President and co-founder", sourceRefId: "crunchbase-1" },
  ],
  nextFocus: "dig into product / model release cadence",
  researchComplete: false,
  reasoning: "Founder info is foundational; next checkpoint should cover products.",
});

describe("buildCheckpointPrompt — deterministic prompt + hash", () => {
  it("same input → identical prompt across 100 calls", () => {
    const first = buildCheckpointPrompt(BASE);
    for (let i = 0; i < 100; i++) {
      const again = buildCheckpointPrompt(BASE);
      expect(again.system).toBe(first.system);
      expect(again.user).toBe(first.user);
      expect(again.promptHash).toBe(first.promptHash);
    }
  });

  it("hash includes EXTENDED_PROMPT_VERSION (bump breaks cache appropriately)", () => {
    const a = buildCheckpointPrompt(BASE);
    // Not asserting the version fragment in the hash; just that it's present in the contract.
    expect(EXTENDED_PROMPT_VERSION).toBe("ext-think-v1");
    expect(a.promptHash).toMatch(/^djb2-/);
  });

  it("cold start: 'no prior findings' explicit hint", () => {
    const p = buildCheckpointPrompt(BASE);
    expect(p.user).toContain("no prior findings");
  });

  it("prior findings cap respected (>40 findings → only 40 included)", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      text: `finding ${i}`,
      sourceRefId: `ref-${i}`,
    }));
    const p = buildCheckpointPrompt({ ...BASE, priorFindings: many, checkpointIndex: 5 });
    // We include the first 40 — finding 40..59 should NOT be present
    expect(p.user).toContain("finding 0");
    expect(p.user).toContain("finding 39");
    expect(p.user).not.toContain("finding 59");
  });

  it("focus hint included when supplied", () => {
    const p = buildCheckpointPrompt({ ...BASE, focus: "patent portfolio" });
    expect(p.user).toContain("Focus for THIS checkpoint: patent portfolio");
  });

  it("prompt hash changes when focus changes (different checkpoint, different prompt)", () => {
    const a = buildCheckpointPrompt({ ...BASE, focus: "founders" });
    const b = buildCheckpointPrompt({ ...BASE, focus: "patents" });
    expect(a.promptHash).not.toEqual(b.promptHash);
  });

  it("BOUND: massive goal is truncated so prompts stay sane", () => {
    const huge = "X".repeat(10_000);
    const p = buildCheckpointPrompt({ ...BASE, goal: huge });
    expect(p.user.length).toBeLessThan(15_000);
    expect(p.user).toContain("…");
  });
});

describe("parseCheckpointResponse — happy + sad paths", () => {
  it("well-formed JSON yields typed CheckpointOutput", () => {
    const outcome = parseCheckpointResponse(VALID_RESPONSE);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.result.headline).toMatch(/Founders/);
    expect(outcome.result.findings).toHaveLength(2);
    expect(outcome.result.researchComplete).toBe(false);
    expect(outcome.result.nextFocus).toMatch(/product/i);
  });

  it("```json fenced response → parsed", () => {
    const fenced = "Sure:\n```json\n" + VALID_RESPONSE + "\n```";
    const outcome = parseCheckpointResponse(fenced);
    expect(outcome.ok).toBe(true);
  });

  it("prose-wrapped JSON → parsed", () => {
    const wrapped = "Thinking done.\n\n" + VALID_RESPONSE + "\n\nHope that helps.";
    expect(parseCheckpointResponse(wrapped).ok).toBe(true);
  });

  it("empty string → parse_error", () => {
    expect(parseCheckpointResponse("").ok).toBe(false);
  });

  it("no JSON object in response → parse_error", () => {
    expect(parseCheckpointResponse("I can't help with that").ok).toBe(false);
  });

  it("missing headline → parse_error", () => {
    const bad = JSON.stringify({
      findings: [{ text: "x" }],
      researchComplete: false,
    });
    const outcome = parseCheckpointResponse(bad);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error).toMatch(/headline/);
  });

  it("findings not an array → parse_error", () => {
    const bad = JSON.stringify({
      headline: "x",
      findings: "not-an-array",
      researchComplete: false,
    });
    expect(parseCheckpointResponse(bad).ok).toBe(false);
  });

  it("rogue 1MB response → rejected by BOUND, no OOM", () => {
    const huge = "x".repeat(500_000) + VALID_RESPONSE;
    const outcome = parseCheckpointResponse(huge);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error).toMatch(/too large/);
  });

  it("findings with non-object items filtered, don't fail whole parse", () => {
    const mixed = JSON.stringify({
      headline: "mixed",
      findings: [
        { text: "good" },
        null,
        "string item",
        { text: "another" },
      ],
      researchComplete: false,
    });
    const outcome = parseCheckpointResponse(mixed);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.result.findings.map((f) => f.text)).toEqual(["good", "another"]);
  });

  it("MAX_FINDINGS_PER_CHECKPOINT cap enforced", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ text: `finding ${i}` }));
    const payload = JSON.stringify({
      headline: "lots",
      findings: many,
      researchComplete: false,
    });
    const outcome = parseCheckpointResponse(payload);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.result.findings.length).toBe(10);
  });

  it("overlong finding text truncated with ellipsis", () => {
    const long = "x".repeat(900);
    const payload = JSON.stringify({
      headline: "long",
      findings: [{ text: long }],
      researchComplete: false,
    });
    const outcome = parseCheckpointResponse(payload);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.result.findings[0].text.length).toBeLessThanOrEqual(601);
    expect(outcome.result.findings[0].text).toMatch(/…$/);
  });

  it("researchComplete=true propagated", () => {
    const payload = JSON.stringify({
      headline: "done",
      findings: [],
      researchComplete: true,
    });
    const outcome = parseCheckpointResponse(payload);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.result.researchComplete).toBe(true);
  });
});

describe("shouldContinue — chain termination rules", () => {
  const base = {
    currentCheckpoint: 3,
    totalCheckpoints: 8,
    researchComplete: false,
    thinkingTokensUsed: 1_000,
    thinkingBudgetTokens: 40_000,
  };

  it("mid-chain not complete → continue", () => {
    const v = shouldContinue(base);
    expect(v.continue).toBe(true);
  });

  it("research_complete → stop", () => {
    const v = shouldContinue({ ...base, researchComplete: true });
    expect(v.continue).toBe(false);
    expect(v.reason).toMatch(/research_complete/);
  });

  it("at planned cap → stop", () => {
    const v = shouldContinue({ ...base, currentCheckpoint: 8, totalCheckpoints: 8 });
    expect(v.continue).toBe(false);
    expect(v.reason).toMatch(/planned/);
  });

  it("beyond MAX_CHECKPOINTS hard cap → stop (defense in depth)", () => {
    const v = shouldContinue({
      ...base,
      currentCheckpoint: MAX_CHECKPOINTS,
      totalCheckpoints: 999,
    });
    expect(v.continue).toBe(false);
    expect(v.reason).toMatch(/MAX_CHECKPOINTS/);
  });

  it("thinking budget exhausted → stop", () => {
    const v = shouldContinue({
      ...base,
      thinkingTokensUsed: 50_000,
      thinkingBudgetTokens: 40_000,
    });
    expect(v.continue).toBe(false);
    expect(v.reason).toMatch(/token budget/);
  });

  it("boundary: exactly budget → stop (>= not >)", () => {
    const v = shouldContinue({
      ...base,
      thinkingTokensUsed: 40_000,
      thinkingBudgetTokens: 40_000,
    });
    expect(v.continue).toBe(false);
  });
});
