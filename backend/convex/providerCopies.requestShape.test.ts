// @vitest-environment node
/**
 * The ~16 hand-copied multi-provider helpers (dealFlow, morningDigest, repoScout, ...) each carry
 * their own Anthropic branch. SPEC-v9 A.0.6 and A.2.10 PR 1 changed every copy the same way: send
 * the hyphenated wire id from the catalog's explicit table (api.anthropic.com answers 404 to the
 * dotted alias "claude-sonnet-4.6") and read the answer from the text block (content[0] is a
 * thinking block whenever adaptive thinking is on). A test of the shared helper alone cannot
 * catch one copy being reverted, so this drives each copy's real function against a fake SDK
 * transport and asserts the outgoing request and the returned text.
 *
 * Persona: an operator whose catalog default for these tasks is a Claude model; a reply that
 * starts with a thinking block must still yield the answer, and the request must name a model
 * Anthropic accepts, with no sampling keys. No network, no spend.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    messages = { create };
  },
}));
// Every copy asks the catalog for its task model; put a Claude alias there so each copy takes its Anthropic branch.
vi.mock("../../shared/llm/modelCatalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/llm/modelCatalog")>()),
  getLlmModel: () => "claude-sonnet-4.6",
}));
// entityInsights tries pi-ai first and only then its legacy provider branch.
vi.mock("./domains/pipelines/piRuntime", () => ({
  runPiOrAiSdkCompletion: vi.fn(async () => {
    throw new Error("pi-ai unavailable in this test");
  }),
}));
vi.mock("@convex-dev/auth/server", () => ({ getAuthUserId: vi.fn(async () => "user1") }));

import { generateWithProvider as morningDigest } from "./domains/ai/morningDigest";
import { generateWithProvider as entityInsights } from "./domains/knowledge/entityInsights";
import { generateWithProvider as dailyBriefPersonalOverlay } from "./domains/research/dailyBriefPersonalOverlay";
import { generateWithProvider as dailyBriefWorker } from "./domains/research/dailyBriefWorker";
import { generateWithProvider as dealFlow } from "./domains/research/dealFlow";
import { generateWithProvider as modelComparison } from "./domains/research/modelComparison";
import { generateWithProvider as paperDetails } from "./domains/research/paperDetails";
import { generateWithProvider as repoScout } from "./domains/research/repoScout";
import { generateWithProvider as stackImpact } from "./domains/research/stackImpact";
import { generateWithProvider as strategyMetrics } from "./domains/research/strategyMetrics";
import { callDedupJudge } from "./domains/social/postDedupAction";
import { judgeClaimAgainstSource } from "./domains/verification/claimVerificationAction";
import { handleChatResponse } from "./domains/agents/fastAgentChat";
import { generateResponse } from "./domains/ai/ai";
import { generateForDocument } from "./tags_actions";

const ANSWER = "the answer";
const thinkingThen = (text: string) => ({
  content: [
    { type: "thinking", thinking: "…", signature: "sig" },
    { type: "text", text },
  ],
  usage: { input_tokens: 3, output_tokens: 4 },
});

function expectAnthropicRequest(maxTokens?: number) {
  expect(create).toHaveBeenCalledTimes(1);
  const body = create.mock.calls[0][0];
  expect(body.model).toBe("claude-sonnet-4-6"); // the wire id, never "claude-sonnet-4.6"
  for (const key of ["temperature", "top_p", "top_k"]) expect(body, key).not.toHaveProperty(key);
  expect(body.messages.at(-1).role).toBe("user"); // no prefill
  if (maxTokens !== undefined) expect(body.max_tokens).toBe(maxTokens);
  return body;
}

describe("Anthropic branch of every multi-provider copy", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key-not-real");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockReset();
    create.mockResolvedValue(thinkingThen(ANSWER));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const copies: Array<[string, (model: string, system: string, user: string, max: number) => Promise<string>]> = [
    ["morningDigest", morningDigest],
    ["entityInsights", entityInsights],
    ["dailyBriefPersonalOverlay", dailyBriefPersonalOverlay],
    ["dailyBriefWorker", dailyBriefWorker],
    ["dealFlow", dealFlow],
    ["modelComparison", modelComparison],
    ["paperDetails", paperDetails],
    ["repoScout", repoScout],
    ["stackImpact", stackImpact],
    ["strategyMetrics", strategyMetrics],
  ];

  it.each(copies)("%s: wire id, no sampling keys, answer read past the thinking block", async (_name, generateWithProvider) => {
    const text = await generateWithProvider("claude-sonnet-4.6", "sys", "usr", 321);
    const body = expectAnthropicRequest(321);
    expect(body.system).toBe("sys");
    expect(body.messages).toEqual([{ role: "user", content: "usr" }]);
    expect(text).toBe(ANSWER);
  });

  it("postDedupAction.callDedupJudge reads the verdict past the thinking block", async () => {
    create.mockResolvedValue(thinkingThen(JSON.stringify({ verdict: "NEW", confidence: 0.9, reasoning: "r", keyDifferences: [] })));
    const result = await callDedupJudge("compare these");
    expectAnthropicRequest(300);
    // A reverted content[0] read gives "Empty response", which the judge turns into INCONCLUSIVE.
    expect(result.verdict).toBe("NEW");
  });

  it("claimVerificationAction.judgeClaimAgainstSource reads the verdict past the thinking block", async () => {
    create.mockResolvedValue(thinkingThen(JSON.stringify({ verdict: "supported", confidence: 0.8, explanation: "e" })));
    const result = await judgeClaimAgainstSource("claim", "source");
    expectAnthropicRequest(200);
    expect(result.verdict).toBe("supported");
  });

  it("fastAgentChat.handleChatResponse returns the text block", async () => {
    const ctx = { runQuery: vi.fn(async () => null), runMutation: vi.fn(async () => null) };
    const text = await handleChatResponse(ctx as never, { message: "hello", userId: "u1" as never, model: "anthropic", fastMode: false });
    expectAnthropicRequest(2000);
    expect(text).toBe(ANSWER);
  });

  it("ai.generateResponse returns the text block", async () => {
    const ctx = {
      runQuery: vi.fn(async () => []),
      runMutation: vi.fn(async () => null),
    };
    const result = await (generateResponse as any)._handler(ctx, { userMessage: "hello" });
    expectAnthropicRequest(2000);
    expect(result.message).toBe(ANSWER);
  });

  it("tags_actions.generateForDocument parses tags from the text block", async () => {
    create.mockResolvedValue(thinkingThen(JSON.stringify([{ name: "React", kind: "entity", importance: 0.9 }])));
    const ctx = {
      runQuery: vi.fn(async () => "A document about the React web framework and its ecosystem of tooling."),
      runMutation: vi.fn(async (_ref: unknown, args: any) => args?.tags ?? null),
    };
    const result = await (generateForDocument as any)._handler(ctx, { documentId: "doc1" });
    expectAnthropicRequest(500);
    expect(result).toMatchObject({ success: true, tagsGenerated: 1 });
  });
});
