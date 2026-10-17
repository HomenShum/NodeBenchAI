// @vitest-environment node
/**
 * Request-shape tests for the raw-fetch Anthropic paths in events.ts
 * (SPEC-v9 A.0.6, A.2.10 PR 1).
 *
 * Persona: a ScratchNode event attendee asks a question, and a host triages a join
 * request. Each call builds its real request through events.ts's own code and hands
 * it to a fake transport, so the assertions are about the bytes that would reach
 * api.anthropic.com. Claude 4.7+/5.x answer 400 to a non-default temperature, and
 * adaptive thinking counts toward max_tokens, so the body must carry no sampling
 * keys and a cap that leaves room to think. No network, no spend.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoManualThinkingOrForcedToolChoice } from "../../shared/llm/expectClaudeRequestShape";

import { generateBouncerAdvisory, generateProviderAnswer, runJoinBouncer } from "./events";

const SAMPLING_KEYS = ["temperature", "top_p", "top_k"] as const;
// Claude Haiku 5.5 runs adaptive thinking by default, so content[0] is a thinking block.
const thinkingThenText = (text: string) => ({
  model: "claude-haiku-4-5-20251001",
  content: [
    { type: "thinking", thinking: "…", signature: "sig" },
    { type: "text", text },
  ],
  usage: { input_tokens: 10, output_tokens: 20 },
});

interface Captured {
  url: string;
  body: Record<string, any>;
}

function fakeAnthropic(responseBody: unknown): { captured: Captured[]; fetchMock: ReturnType<typeof vi.fn> } {
  const captured: Captured[] = [];
  const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
    captured.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { captured, fetchMock };
}

function expectMessagesRequestShape(captured: Captured[], model: string) {
  expect(captured).toHaveLength(1);
  const { url, body } = captured[0];
  expect(url).toBe("https://api.anthropic.com/v1/messages");
  expect(body.model).toBe(model);
  for (const key of SAMPLING_KEYS) expect(body, `${key} must be absent`).not.toHaveProperty(key);
  expectNoManualThinkingOrForcedToolChoice(body, "events.ts");
  expect(body.max_tokens).toBeGreaterThanOrEqual(1024);
  // no prefill: the last turn is the user's
  expect(body.messages.at(-1).role).toBe("user");
}

describe("events.ts Anthropic request shape", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    vi.stubEnv("SCRATCHNODE_BOUNCER_MODEL", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("answer path: no sampling keys, room to think, text read by block type", async () => {
    const { captured } = fakeAnthropic(thinkingThenText("It starts at 6pm. Next move: arrive early."));
    const result = await generateProviderAnswer({
      eventName: "Demo Night",
      question: "When does it start?",
      sources: [{ title: "Agenda", excerpt: "Doors 6pm", body: "Doors open at 6pm." }],
      model: "claude-haiku-4-5-20251001",
    });
    expectMessagesRequestShape(captured, "claude-haiku-4-5-20251001");
    expect(result).toMatchObject({ ok: true, body: "It starts at 6pm. Next move: arrive early." });
  });

  it("bouncer advisory path: no sampling keys, JSON read past a thinking block", async () => {
    const { captured } = fakeAnthropic(
      thinkingThenText(
        JSON.stringify({ recommendation: "approve", riskScore: 0.1, flags: [], hostSummary: "Looks fine.", guestMessage: "Hi" }),
      ),
    );
    const result = await generateBouncerAdvisory({
      eventName: "Demo Night",
      displayName: "Pat",
      note: "friend of the host",
      model: "claude-haiku-4-5-20251001",
    });
    expectMessagesRequestShape(captured, "claude-haiku-4-5-20251001");
    expect(result).toMatchObject({ provider: "anthropic", recommendation: "approve" });
  });

  it("join bouncer path: default model, no sampling keys, JSON read past a thinking block", async () => {
    const { captured } = fakeAnthropic(
      thinkingThenText(
        JSON.stringify({ recommendation: "hold", riskScore: 0.4, flags: ["thin_request"], hostSummary: "Thin.", guestMessage: "Wait" }),
      ),
    );
    const result = await runJoinBouncer({ eventName: "Demo Night", displayName: "Sam", note: "" });
    // PR 1 moves no ids; PR 2 changes this literal with its own request-shape update.
    expectMessagesRequestShape(captured, "claude-haiku-4-5-20251001");
    expect(result).toMatchObject({ recommendation: "hold" });
  });

  it("join bouncer honours SCRATCHNODE_BOUNCER_MODEL (override precedence unchanged)", async () => {
    vi.stubEnv("SCRATCHNODE_BOUNCER_MODEL", "claude-sonnet-4-6");
    const { captured } = fakeAnthropic(
      thinkingThenText(JSON.stringify({ recommendation: "approve", riskScore: 0, flags: [], hostSummary: "", guestMessage: "" })),
    );
    await runJoinBouncer({ eventName: "Demo Night", displayName: "Sam", note: "" });
    expect(captured[0].body.model).toBe("claude-sonnet-4-6");
  });
});
