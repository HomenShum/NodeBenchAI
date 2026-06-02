/**
 * Scenario-based tests for the NodeBench LLM Router (shared/llm/router.ts).
 *
 * Per .claude/rules/scenario_testing.md each test starts from a real persona/goal.
 * The router is the single model-selection point for served LLM features, so the
 * risks are: a regression that escalates *simple* questions (cost blowup), a
 * regression that *fails to* escalate genuinely hard ones (quality loss), and
 * non-determinism (same turn routing differently across calls — breaks replay).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  routeLLM,
  computeComplexityScore,
  askAnswerSignals,
  getPools,
  ESCALATE_THRESHOLD,
  HEAVY_THRESHOLD,
} from "./router";

const FLOOR = "claude-haiku-4-5-20251001";
const HEAVY = "claude-sonnet-4-6";

describe("LLM router — ask_answer escalation (event attendee)", () => {
  /**
   * Persona: attendee asks a quick factual lookup. Goal: fast, cheap answer.
   * Expected: stays on the Haiku floor — no cost escalation for simple Qs.
   */
  it("keeps a short factual question on the Haiku floor", () => {
    const r = routeLLM("ask_answer", askAnswerSignals("What time is the keynote?", 2));
    expect(r.model).toBe(FLOOR);
    expect(r.tier).toBe("light");
    expect(r.escalated).toBe(false);
  });

  /**
   * Persona: attendee asks a comparative/strategic question over many sources.
   * Goal: a well-reasoned synthesis. Expected: escalate to Sonnet.
   */
  it("escalates a long analytical multi-entity question to Sonnet", () => {
    const q =
      "Compare the MCP auth approach versus the legacy RBAC model and explain why teams should pick one — what are the tradeoffs and risks for a multi-tenant deployment at scale?";
    const r = routeLLM("ask_answer", askAnswerSignals(q, 7));
    expect(r.model).toBe(HEAVY);
    expect(r.tier).toBe("heavy");
    expect(r.escalated).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(HEAVY_THRESHOLD);
  });

  /**
   * Many sources alone (heavy synthesis load) should lift complexity even for a
   * plainly-worded question.
   */
  it("escalates when there are many sources to synthesize", () => {
    const r = routeLLM("ask_answer", { inputChars: 50, sourceCount: 12, complexityHint: "medium", multiEntity: true });
    expect(r.escalated).toBe(true);
  });

  /**
   * Adversarial: a caller marks the turn high-stakes. Expected: always the
   * quality target, regardless of how trivial the signals look.
   */
  it("forceTarget always routes to the quality target", () => {
    const r = routeLLM("ask_answer", { inputChars: 5, sourceCount: 0, forceTarget: true });
    expect(r.model).toBe(HEAVY);
    expect(r.tier).toBe("heavy");
    expect(r.escalated).toBe(true);
    expect(r.reason).toMatch(/forced/i);
  });
});

describe("LLM router — determinism + monotonicity (replay safety)", () => {
  it("is deterministic: identical signals route identically across calls", () => {
    const sig = askAnswerSignals("How should we evaluate voice agents for latency and barge-in?", 5);
    const a = routeLLM("ask_answer", sig);
    const b = routeLLM("ask_answer", sig);
    expect(a).toEqual(b);
  });

  it("complexity score is monotonic — adding signal weight never lowers it", () => {
    const base = computeComplexityScore({ inputChars: 100 });
    const more = computeComplexityScore({ inputChars: 100, sourceCount: 10 });
    const most = computeComplexityScore({ inputChars: 700, sourceCount: 10, multiEntity: true, complexityHint: "high" });
    expect(more).toBeGreaterThanOrEqual(base);
    expect(most).toBeGreaterThanOrEqual(more);
    expect(most).toBeLessThanOrEqual(1); // bounded
  });

  it("score sits below the escalate threshold for trivial input", () => {
    expect(computeComplexityScore({ inputChars: 20, sourceCount: 1 })).toBeLessThan(ESCALATE_THRESHOLD);
  });
});

describe("LLM router — signal extraction", () => {
  it("detects multi-entity comparison questions", () => {
    expect(askAnswerSignals("Anthropic vs OpenAI for tool use", 3).multiEntity).toBe(true);
    expect(askAnswerSignals("compare Brave and Serper", 3).multiEntity).toBe(true);
    expect(askAnswerSignals("What is MCP?", 3).multiEntity).toBe(false);
  });

  it("flags analytical intent as high complexity", () => {
    expect(askAnswerSignals("Why did the panel recommend scoped credentials?", 3).complexityHint).toBe("high");
    expect(askAnswerSignals("Who is speaking next?", 1).complexityHint).toBe("low");
  });
});

describe("LLM router — single-candidate pools never escalate", () => {
  it("classify pool stays on its only (light) model even under high complexity", () => {
    const r = routeLLM("classify", { complexityHint: "high", inputChars: 999, multiEntity: true });
    expect(r.tier).toBe("light");
    expect(r.escalated).toBe(false);
    expect(getPools().classify.candidates).toHaveLength(1);
  });
});

describe("LLM router — ops env override", () => {
  afterEach(() => {
    delete process.env.SCRATCHNODE_ASK_MODEL_HEAVY;
    delete process.env.SCRATCHNODE_ASK_MODEL_LIGHT;
  });

  it("respects SCRATCHNODE_ASK_MODEL_HEAVY for the escalation target", () => {
    process.env.SCRATCHNODE_ASK_MODEL_HEAVY = "claude-opus-4-7";
    const r = routeLLM("ask_answer", { forceTarget: true });
    expect(r.model).toBe("claude-opus-4-7");
  });

  it("respects SCRATCHNODE_ASK_MODEL_LIGHT for the floor", () => {
    process.env.SCRATCHNODE_ASK_MODEL_LIGHT = "claude-haiku-pinned";
    const r = routeLLM("ask_answer", askAnswerSignals("hi", 1));
    expect(r.model).toBe("claude-haiku-pinned");
  });
});
