/**
 * llmTools.call_llm and researchWritingTools.polish_academic_text reach Anthropic through
 * the SDK (SPEC-v9 A.0.6, A.2.10 PR 1). Persona: a user of the published MCP server who
 * has only ANTHROPIC_API_KEY set and asks for a low-temperature polish. Claude 4.7+/5.x
 * answer 400 to `temperature`, so the Messages call must not carry it even though the
 * caller supplied one, and the answer must be read from the text block (content[0] is a
 * thinking block when adaptive thinking is on). The SDK is the fake transport; no
 * network, no spend. The tools are driven through their real handlers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    messages = { create };
  },
}));

import { llmTools } from "../tools/llmTools.js";
import { researchWritingTools } from "../tools/researchWritingTools.js";

const thinkingThenText = (text: string) => ({
  content: [
    { type: "thinking", thinking: "…", signature: "sig" },
    { type: "text", text },
  ],
  usage: { input_tokens: 3, output_tokens: 4 },
});

function handler(tools: Array<{ name: string; handler: (a: any) => Promise<any> }>, name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool.handler;
}

describe("mcp-local Anthropic provider request shape", () => {
  beforeEach(() => {
    for (const key of ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "OPENAI_API_KEY"]) vi.stubEnv(key, "");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    create.mockReset();
    create.mockResolvedValue(thinkingThenText("the answer"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("call_llm: no temperature although the caller passed one; text read past a thinking block", async () => {
    const result = await handler(llmTools as never, "call_llm")({ prompt: "hi", temperature: 0.9, maxTokens: 777 });
    expect(create).toHaveBeenCalledTimes(1);
    const body = create.mock.calls[0][0];
    expect(body.model).toBe("claude-haiku-4-5-20251001"); // PR 1 moves no ids
    for (const key of ["temperature", "top_p", "top_k"]) expect(body, key).not.toHaveProperty(key);
    expect(body.max_tokens).toBe(777);
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(result.response).toBe("the answer");
    expect(result.provider).toBe("anthropic");
  });

  it("polish_academic_text: no temperature although the tool passes 0.2; text read past a thinking block", async () => {
    const result = await handler(researchWritingTools as never, "polish_academic_text")({ text: "We propose a method." });
    expect(create).toHaveBeenCalledTimes(1);
    const body = create.mock.calls[0][0];
    for (const key of ["temperature", "top_p", "top_k"]) expect(body, key).not.toHaveProperty(key);
    expect(body.max_tokens).toBe(4096);
    expect(result.polishedText).toBe("the answer");
  });
});
