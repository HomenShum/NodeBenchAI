// @vitest-environment node
/**
 * extendedThinking.advanceRun is the action that makes the Anthropic call for one
 * checkpoint of a long diligence run (SPEC-v9 A.0.6, A.2.10 PR 1). Persona: a founder
 * whose run was given a 40,000-token thinking budget. Two things must hold on the real
 * action, not just on the body builder:
 *   1. The request is adaptive thinking with no sampling keys and the wire model id.
 *   2. The run's thinking budget goes down after every checkpoint. On Sonnet 5.x and
 *      Opus 4.7+ the thinking block's text is omitted by default, so a charge estimated
 *      from that text is always 0 and the budget would never run out. The charge comes
 *      from usage.output_tokens minus the answer.
 * The fetch transport is fake; no network, no spend.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { advanceRun } from "./extendedThinking";

const answer = JSON.stringify({
  headline: "Funding history found",
  findings: [{ text: "Raised a Series B in 2024.", sourceRefId: "ref1" }],
  nextFocus: "founders",
  researchComplete: false,
  reasoning: "short",
});

function runRow(over: Record<string, unknown> = {}) {
  return {
    _id: "run1",
    entitySlug: "Anthropic",
    goal: "Build a diligence brief.",
    status: "running",
    currentCheckpoint: 0,
    totalCheckpoints: 8,
    thinkingBudgetTokens: 40_000,
    thinkingTokensUsed: 0,
    modelName: "claude-sonnet-4.6",
    ...over,
  };
}

async function advance(run: Record<string, unknown>, outputTokens: number) {
  const requests: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      requests.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({
          model: "claude-sonnet-4-6",
          // display omitted: the thinking block carries no text
          content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: answer }],
          usage: { input_tokens: 500, output_tokens: outputTokens },
        }),
        { status: 200 },
      );
    }),
  );
  const mutations: any[] = [];
  const ctx = {
    runQuery: vi.fn(async () => ({ run, checkpoints: [] })),
    runMutation: vi.fn(async (_ref: unknown, args: any) => {
      mutations.push(args);
      return null;
    }),
    scheduler: { runAfter: vi.fn(async () => null) },
  };
  const result = await (advanceRun as any)._handler(ctx, { runId: "run1" });
  return { result, requests, mutations };
}

describe("extendedThinking.advanceRun", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends adaptive thinking, no sampling keys and the wire model id", async () => {
    const { requests } = await advance(runRow(), 5_000);
    expect(requests).toHaveLength(1);
    const body = requests[0];
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.thinking).not.toHaveProperty("budget_tokens");
    for (const key of ["temperature", "top_p", "top_k"]) expect(body, key).not.toHaveProperty(key);
    expect(body.max_tokens).toBe(14_000);
  });

  it("charges thinking from usage.output_tokens even though the thinking text is omitted", async () => {
    const { result, mutations } = await advance(runRow(), 5_000);
    const expected = 5_000 - Math.floor(answer.length / 4);
    const recorded = mutations.find((m) => "promptHash" in m);
    expect(recorded.thinkingTokens).toBe(expected);
    expect(expected).toBeGreaterThan(4_800);
    // Before: the estimate came from the empty thinking text, so this was 0 and the budget never went down.
    const status = mutations.find((m) => "thinkingTokensUsedDelta" in m);
    expect(status.thinkingTokensUsedDelta).toBe(expected);
    expect(result.status).toBe("scheduled_next");
  });

  it("stops the run once the charged thinking reaches the budget", async () => {
    const { result } = await advance(runRow({ thinkingBudgetTokens: 6_000, thinkingTokensUsed: 2_000 }), 5_000);
    expect(result.status).toBe("completed");
    expect(result.reason).toMatch(/thinking token budget exhausted/);
  });

  it("with 2,500 thinking tokens left the cap is 4,000 + 2,500: the bound is on total output, not thinking alone", async () => {
    const { requests } = await advance(runRow({ thinkingBudgetTokens: 40_000, thinkingTokensUsed: 37_500 }), 6_500);
    expect(requests[0].max_tokens).toBe(6_500);
  });
});
