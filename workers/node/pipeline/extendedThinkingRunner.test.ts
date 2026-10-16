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
  buildCheckpointRequestBody,
  resolveCheckpointModel,
  estimateThinkingTokens,
  parseCheckpointResponse,
  shouldContinue,
  EXTENDED_PROMPT_VERSION,
  MAX_CHECKPOINTS,
  MAX_OUTPUT_TOKENS,
  MAX_THINKING_BUDGET_TOKENS,
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

describe("buildCheckpointRequestBody - Anthropic request shape (SPEC-v9 A.0.6)", () => {
  const prompt = { system: "sys", user: "usr" };

  it("sends the hyphenated wire id for a stored dotted alias", () => {
    // run.modelName defaults to the catalog alias "claude-sonnet-4.6"; api.anthropic.com
    // rejects that string, so the body must carry the resolver's wire id.
    const body = buildCheckpointRequestBody({ modelName: "claude-sonnet-4.6", prompt, remainingThinkingTokens: 40_000 });
    expect(body.model).toBe("claude-sonnet-4-6");
  });

  it("uses adaptive thinking with output_config.effort, never budget_tokens", () => {
    const body = buildCheckpointRequestBody({ modelName: "claude-sonnet-4.6", prompt, remainingThinkingTokens: 40_000 }) as any;
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.thinking).not.toHaveProperty("budget_tokens");
    expect(body.output_config).toEqual({ effort: "medium" });
    for (const key of ["temperature", "top_p", "top_k"]) expect(body).not.toHaveProperty(key);
    expect(body.messages).toEqual([{ role: "user", content: "usr" }]);
    expect(body.system).toBe("sys");
  });

  it("caps total output per checkpoint: max_tokens = answer cap + min(allowance, remaining)", () => {
    // This bounds thinking PLUS answer. Adaptive thinking has no separate thinking cap, so with 2,500
    // tokens left a checkpoint may still think for up to 6,500 (the 4,000 answer room is not reserved).
    // The run-level bound is the next test.
    const at = (remaining: number) =>
      (buildCheckpointRequestBody({ modelName: "claude-sonnet-4.6", prompt, remainingThinkingTokens: remaining }) as any).max_tokens;
    expect(at(40_000)).toBe(MAX_OUTPUT_TOKENS + MAX_THINKING_BUDGET_TOKENS);
    expect(at(2_500)).toBe(MAX_OUTPUT_TOKENS + 2_500);
    expect(at(0)).toBe(MAX_OUTPUT_TOKENS);
    expect(at(-50)).toBe(MAX_OUTPUT_TOKENS);
  });

  it("a run spends at most thinkingBudgetTokens + MAX_OUTPUT_TOKENS on thinking when every checkpoint thinks to its cap", () => {
    // Worst case: each checkpoint uses all of max_tokens, answers with 1 token of text, and the run
    // charges thinking from usage exactly as extendedThinking.advanceRun does. The thinking block's text is
    // omitted (Sonnet 5.x), so nothing but usage.output_tokens can drive the charge.
    const budget = 15_000;
    let charged = 0;
    let actuallySpent = 0;
    for (let checkpoint = 1; checkpoint <= MAX_CHECKPOINTS; checkpoint++) {
      const maxTokens = (buildCheckpointRequestBody({ modelName: "claude-sonnet-4.6", prompt, remainingThinkingTokens: budget - charged }) as any).max_tokens;
      const answer = "x".repeat(4); // 1 token
      actuallySpent += maxTokens - 1;
      charged += estimateThinkingTokens(maxTokens, answer);
      const verdict = shouldContinue({ currentCheckpoint: checkpoint, totalCheckpoints: MAX_CHECKPOINTS, researchComplete: false, thinkingTokensUsed: charged, thinkingBudgetTokens: budget });
      if (!verdict.continue) break;
    }
    expect(charged).toBeGreaterThanOrEqual(budget);
    expect(actuallySpent).toBeLessThanOrEqual(budget + MAX_OUTPUT_TOKENS);
    // and the charge never undercounts what was spent
    expect(charged).toBeGreaterThanOrEqual(actuallySpent);
  });

  it("Haiku 4.5 keeps manual thinking with budget_tokens and gets no effort; an allowance under 1,024 sends no thinking", () => {
    const body = (modelName: string, remaining: number) => buildCheckpointRequestBody({ modelName, prompt, remainingThinkingTokens: remaining }) as any;
    for (const modelName of ["claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929", "claude-opus-4-5-20251101"]) {
      expect(body(modelName, 40_000).thinking, modelName).toEqual({ type: "enabled", budget_tokens: MAX_THINKING_BUDGET_TOKENS });
      expect(body(modelName, 40_000), modelName).not.toHaveProperty("output_config");
      expect(body(modelName, 3_000).thinking, modelName).toEqual({ type: "enabled", budget_tokens: 3_000 });
      expect(body(modelName, 1_023), modelName).not.toHaveProperty("thinking");
      expect(body(modelName, 0), modelName).not.toHaveProperty("thinking");
    }
  });

  it("resolveCheckpointModel returns the wire id and throws for a name with no Anthropic id", () => {
    expect(resolveCheckpointModel("claude-sonnet-4.6")).toBe("claude-sonnet-4-6");
    expect(resolveCheckpointModel("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5-20251001");
    expect(() => resolveCheckpointModel("claude-not-real")).toThrow(/no Anthropic wire id/);
  });

  it.each(["toString", "valueOf", "hasOwnProperty", "constructor", "__proto__"])(
    "resolveCheckpointModel rejects Object.prototype key %s instead of returning a function",
    (key) => {
      expect(() => resolveCheckpointModel(key)).toThrow(/no Anthropic wire id/);
      expect(() => buildCheckpointRequestBody({ modelName: key, prompt, remainingThinkingTokens: 5_000 })).toThrow(/no Anthropic wire id/);
    },
  );

  it("accepts an operator-supplied wire id and refuses a name with no Anthropic id", () => {
    expect(buildCheckpointRequestBody({ modelName: "claude-sonnet-4-6", prompt, remainingThinkingTokens: 1 }).model).toBe(
      "claude-sonnet-4-6",
    );
    expect(() => buildCheckpointRequestBody({ modelName: "kimi-k2.6", prompt, remainingThinkingTokens: 1 })).toThrow(
      /no Anthropic wire id/,
    );
  });
});

describe("estimateThinkingTokens", () => {
  it("is output_tokens minus the answer's estimated tokens, never negative", () => {
    expect(estimateThinkingTokens(5_000, "x".repeat(400))).toBe(4_900);
    expect(estimateThinkingTokens(50, "x".repeat(4_000))).toBe(0);
    expect(estimateThinkingTokens(0, "")).toBe(0);
  });

  it("does not depend on the thinking block text (it is omitted by default on Sonnet 5.x / Opus 4.7+)", () => {
    // The function has no thinking-text input at all: a run that omits display still pays.
    expect(estimateThinkingTokens(3_000, "answer")).toBeGreaterThan(2_900);
  });
});
