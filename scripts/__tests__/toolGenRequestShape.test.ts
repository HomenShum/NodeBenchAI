// @vitest-environment node
/**
 * Request-shape test for the daily tool-gen job's raw-fetch Anthropic call
 * (SPEC-v9 A.0.6, A.2.10 PR 1). The job runs `analyze-gap.mjs` on a schedule with
 * a real key, so what it sends is what gets billed: no sampling keys (Claude
 * 4.7+/5.x answer 400), an output cap that leaves room for adaptive thinking, and
 * the answer read from the text block, because content[0] is a thinking block
 * whenever thinking is on. Fake transport; no network, no spend.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoManualThinkingOrForcedToolChoice } from "../../shared/llm/expectClaudeRequestShape";

// @ts-expect-error - plain .mjs script without types
import { buildClaudeRequest, callClaude, claudeText } from "../tool-gen/analyze-gap.mjs";
// @ts-expect-error - plain .mjs script without types
import * as generateTool from "../tool-gen/generate-tool.mjs";

describe("analyze-gap.mjs Anthropic request", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("builds a body with no sampling keys, no prefill and room to think", () => {
    const body = buildClaudeRequest("system text", "user text");
    // PR 1 moves no ids; PR 2 changes this literal to claude-haiku-5-5 with its own update.
    expect(body.model).toBe("claude-haiku-4-5-20251001");
    for (const key of ["temperature", "top_p", "top_k"]) expect(body).not.toHaveProperty(key);
    expectNoManualThinkingOrForcedToolChoice(body, "tool-gen");
    expect(body.max_tokens).toBeGreaterThanOrEqual(1024);
    expect(body.system).toBe("system text");
    expect(body.messages).toEqual([{ role: "user", content: "user text" }]);
  });

  it("sends that body over the transport and returns the text block, not content[0]", async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
        seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
        return new Response(
          JSON.stringify({
            content: [
              { type: "thinking", thinking: "weighing the signals", signature: "sig" },
              { type: "text", text: '{"shouldGenerate":false,"reason":"none"}' },
            ],
          }),
          { status: 200 },
        );
      }),
    );
    const text = await callClaude("sys", "usr");
    expect(text).toBe('{"shouldGenerate":false,"reason":"none"}');
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[0].headers["x-api-key"]).toBe("test-key-not-real");
    expect(seen[0].body).toEqual(buildClaudeRequest("sys", "usr"));
  });

  it("claudeText tolerates a response with no text block", () => {
    expect(claudeText({ content: [{ type: "thinking", thinking: "x" }] })).toBe("");
    expect(claudeText({})).toBe("");
  });

  // Importing the module at the top of this file is itself the guard test: an unguarded
  // main() would read /tmp/daily-brief.json and call process.exit(1) inside the worker.
});

// generate-tool.mjs is the second raw-fetch Anthropic call of the daily job. It builds its
// own body (a longer output cap and a different model than analyze-gap), so it needs its
// own request-shape test rather than leaning on analyze-gap's.
describe("generate-tool.mjs Anthropic request", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("builds a body with no sampling keys, no prefill and room to think", () => {
    const body = generateTool.buildClaudeRequest("system text", "user text");
    // PR 1 moves no ids; PR 2 changes this literal to claude-sonnet-5-5 with its own update.
    expect(body.model).toBe("claude-sonnet-4-6");
    for (const key of ["temperature", "top_p", "top_k"]) expect(body).not.toHaveProperty(key);
    expectNoManualThinkingOrForcedToolChoice(body, "tool-gen");
    expect(body.max_tokens).toBe(4096);
    expect(body.messages).toEqual([{ role: "user", content: "user text" }]);
  });

  it("sends exactly that body and returns the text block, not content[0]", async () => {
    const seen: Array<{ url: string; body: any }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        seen.push({ url, body: JSON.parse(init.body) });
        return new Response(
          JSON.stringify({ content: [{ type: "thinking", thinking: "x", signature: "s" }, { type: "text", text: '{"toolObjectCode":"{}"}' }] }),
          { status: 200 },
        );
      }),
    );
    expect(await generateTool.callClaude("sys", "usr")).toBe('{"toolObjectCode":"{}"}');
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[0].body).toEqual(generateTool.buildClaudeRequest("sys", "usr"));
  });

  it("surfaces an HTTP failure instead of returning an empty answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad request", { status: 400 })));
    await expect(generateTool.callClaude("sys", "usr")).rejects.toThrow(/Claude API 400/);
  });
});
