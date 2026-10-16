// @vitest-environment node
/**
 * benchmark.evaluateSearch calls its judge over raw fetch (SPEC-v9 A.0.6, A.2.10 PR 1).
 * Persona: an engineer running the search-quality benchmark with SEARCH_JUDGE_MODEL set
 * to a Claude model after the migration. Claude 4.7+/5.x answer 400 to `temperature`, so
 * the Anthropic body must not carry it; the OpenAI and Google bodies still pin
 * temperature to 0 for determinism, so removing it only for Claude must not leak.
 * The action runs through its real handler against a fake transport; no network, no spend.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoManualThinkingOrForcedToolChoice } from "../../../../../shared/llm/expectClaudeRequestShape";

import { evaluateSearch } from "./benchmark";

const searchPayload = {
  payload: { mode: "balanced", sourcesQueried: [], results: [], totalTimeMs: 1, timing: {}, errors: [] },
};
const judgeJson = JSON.stringify({ scores: { relevance: 1 }, pass: false, reasoning: "r", issues: [], suggestions: [] });

function run(judgeEnv: string) {
  vi.stubEnv("SEARCH_JUDGE_MODEL", judgeEnv);
  const captured: Array<{ url: string; body: Record<string, any> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      captured.push({ url: String(url), body: JSON.parse(init.body) });
      const body = String(url).includes("anthropic")
        ? { content: [{ type: "thinking", thinking: "…" }, { type: "text", text: judgeJson }] }
        : String(url).includes("openai")
          ? { choices: [{ message: { content: judgeJson } }] }
          : { candidates: [{ content: { parts: [{ text: judgeJson }] } }] };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  const ctx = {
    runAction: vi.fn(async () => searchPayload),
    runMutation: vi.fn(async () => null),
  };
  return (evaluateSearch as any)._handler(ctx, { query: "q" }).then((result: any) => ({ result, captured }));
}

describe("benchmark.evaluateSearch judge request shape", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    vi.stubEnv("OPENAI_API_KEY", "test-key-not-real");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key-not-real");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Claude judge: model is the wire id, no sampling keys, answer read past a thinking block", async () => {
    const { result, captured } = await run("claude-sonnet-4.6");
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(captured[0].body.model).toBe("claude-sonnet-4-6");
    for (const key of ["temperature", "top_p", "top_k"]) expect(captured[0].body, key).not.toHaveProperty(key);
    expectNoManualThinkingOrForcedToolChoice(captured[0].body, "benchmark judge");
    expect(captured[0].body.max_tokens).toBeGreaterThanOrEqual(1024);
    // Claude 4.7+/5.x answer 400 to an assistant prefill: the conversation must end on a user turn (round 4).
    expect(captured[0].body.messages.at(-1).role).toBe("user");
    expect(result.judgeModel).toBe("claude-sonnet-4.6");
    expect(result.judgeResult.reasoning).toBe("r");
  });

  it("OpenAI judge keeps temperature pinned to 0", async () => {
    const { captured } = await run("gpt-5.4");
    expect(captured[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(captured[0].body.temperature).toBe(0);
    expect(captured[0].body.messages.at(-1).role).toBe("user");
  });

  it("Gemini judge sends no sampling keys (deprecated on Gemini 3.x, SPEC-v9 s1.3), with the model in the URL", async () => {
    // Round 3: this test used to require generationConfig.temperature === 0 and would have blocked
    // the removal; ignored today, a 400 later. The determinism pin stays on the OpenAI and the
    // other judges.
    const { captured } = await run("gemini-3.1-pro-preview");
    expect(captured[0].url).toContain("/models/gemini-3.1-pro-preview:generateContent");
    for (const key of ["temperature", "topP", "topK", "top_p", "top_k"]) expect(captured[0].body.generationConfig, key).not.toHaveProperty(key);
    expect(captured[0].body.generationConfig.maxOutputTokens).toBe(1500);
    // A model-turn prefill is a 400 on Gemini 3.x; a content with no role is a user turn.
    expect(captured[0].body.contents.at(-1).role ?? "user").toBe("user");
  });
});
