// @vitest-environment node
/**
 * modelRouter.route is the single inference entrypoint. Two things changed in
 * SPEC-v9 A.2.10 PR 1 and need a test that goes through the real action, not a helper:
 *   1. Claude 4.7+/5.x answer 400 to `temperature` and Gemini 3.x deprecates it, so the
 *      request carries it only for the providers that still accept it.
 *   2. The free tier no longer appends paid candidates to its fallback list (A.0.10):
 *      a user who asked for free must not be billed because the free models were down.
 * Persona: a background agent calling route() with tier "free", then pinned to a Claude
 * model for a repro pack. generateText is the fake transport; no network, no spend.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.hoisted(() => vi.fn());
const resolveChain = vi.hoisted(() => vi.fn());

vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), generateText }));
vi.mock("./chainResolver", () => ({ resolveChain }));

import { route } from "./modelRouter";

const baseArgs = {
  taskCategory: "research",
  systemPrompt: "sys",
  messages: [{ role: "user" as const, content: "hi" }],
};
const makeCtx = () => ({
  runQuery: vi.fn(async () => ({ allowed: true })),
  runMutation: vi.fn(async () => null),
});
const call = (ctx: ReturnType<typeof makeCtx>, args: Record<string, unknown>) =>
  (route as any)._handler(ctx, { ...baseArgs, ...args });

describe("modelRouter.route request shape and cost class", () => {
  beforeEach(() => {
    for (const key of ["OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]) {
      vi.stubEnv(key, "test-key-not-real-0000");
    }
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    generateText.mockReset();
    resolveChain.mockReset();
    generateText.mockResolvedValue({ text: "ok", usage: { inputTokens: 1, outputTokens: 1 } });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("omits temperature for Claude and Gemini and sends it for the providers that accept it", async () => {
    const sent: Record<string, boolean> = {};
    const dispatched: Record<string, string> = {};
    for (const pinnedModel of ["claude-sonnet-4.6", "gemini-3.1-pro-preview", "kimi-k2.6", "gpt-5.4"]) {
      generateText.mockClear();
      await call(makeCtx(), { pinnedModel, temperature: 0.7 });
      expect(generateText).toHaveBeenCalledTimes(1);
      const request = generateText.mock.calls[0][0];
      sent[pinnedModel] = "temperature" in request;
      dispatched[pinnedModel] = (request.model as { modelId: string }).modelId;
      for (const key of ["top_p", "top_k", "topP", "topK"]) expect(request, `${pinnedModel} ${key}`).not.toHaveProperty(key);
    }
    // The outgoing model string, so a wrong-model dispatch cannot pass on the temperature check alone.
    expect(dispatched).toEqual({
      "claude-sonnet-4.6": "claude-sonnet-4-6",
      "gemini-3.1-pro-preview": "gemini-3.1-pro-preview",
      "kimi-k2.6": "moonshotai/kimi-k2.6",
      "gpt-5.4": "gpt-5.4",
    });
    expect(sent).toEqual({
      "claude-sonnet-4.6": false,
      "gemini-3.1-pro-preview": false,
      "kimi-k2.6": true,
      "gpt-5.4": true,
    });
    // and the value is the caller's, not a constant
    expect(generateText.mock.calls[0][0].temperature).toBe(0.7);
  });

  it("the free tier tries only free models when every free model fails: no paid candidate is appended", async () => {
    // Empty registry chain forces the static TIER_MODELS safety net, where the paid push used to live.
    resolveChain.mockReturnValue({ chain: [], reason: "no_matches_for_requirement", diagnostics: { primaryOutcome: "not_supplied", candidatePoolSize: 0 } });
    generateText.mockRejectedValue(Object.assign(new Error("provider down"), { status: 400 }));

    await expect(call(makeCtx(), { tier: "free" })).rejects.toThrow(/All 3 models failed/);

    expect(generateText).toHaveBeenCalledTimes(3);
    const tried = generateText.mock.calls.map((c) => (c[0].model as { modelId: string }).modelId);
    expect(tried.every((id) => id.endsWith(":free")), tried.join(", ")).toBe(true);
  });

  it("a free request is capped at free even when the registry chain holds a paid model (requireVision)", async () => {
    // Before: tier is a floor in the registry chain, so requireVision put glm-4.7-flash ($0.07/M)
    // in the free chain; it was dispatched and recorded isFree=false, actualTier=cheap.
    resolveChain.mockReturnValue({ chain: ["glm-4.7-flash", "nemotron-3-super-free"], reason: "ok", diagnostics: { primaryOutcome: "primary", candidatePoolSize: 2 } });
    const result = await call(makeCtx(), { tier: "free", requireVision: true });
    const tried = generateText.mock.calls.map((c) => (c[0].model as { modelId: string }).modelId);
    expect(tried).toEqual(["nvidia/nemotron-3-super-120b-a12b:free"]);
    expect(result.modelId).toBe("nemotron-3-super-free");
    expect(result.isFree).toBe(true);
    expect(result.routing.actualTier).toBe("free");
    expect(result.costUsd).toBe(0);

    // No free model qualifies: the call fails, nothing is dispatched.
    generateText.mockClear();
    resolveChain.mockReturnValue({ chain: ["glm-4.7-flash"], reason: "ok", diagnostics: { primaryOutcome: "primary", candidatePoolSize: 1 } });
    await expect(call(makeCtx(), { tier: "free", requireVision: true })).rejects.toThrow(/All 0 models failed/);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("a pinned free-lane route is recorded as free, not as premium paid usage", async () => {
    const ctx = makeCtx();
    const result = await call(ctx, { pinnedModel: "nemotron-3-super-free" });
    expect(result.isFree).toBe(true);
    expect(result.costUsd).toBe(0);
    expect(result.routing.actualTier).toBe("free");
    const logged = (ctx.runMutation.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(logged).toMatchObject({ modelId: "nemotron-3-super-free", actualTier: "free", costUsd: 0 });
  });

  it.each(["auto-free", "nvidia/nemotron-3-super-120b-a12b:free", "invented-free"])(
    "a pinned free alias or wire id (%s) is priced, classified, cached and logged as the free lane it dispatched to",
    async (pinnedModel) => {
      // Before: the raw string was priced ($1/$5 default), isFree false, actualTier "premium" even
      // though the request went to the free lane (audit data, PR #662 round 2).
      const ctx = makeCtx();
      const result = await call(ctx, { tier: "free", pinnedModel, cacheKey: `pin-${pinnedModel}` });
      expect((generateText.mock.calls[0][0].model as { modelId: string }).modelId).toBe("nvidia/nemotron-3-super-120b-a12b:free");
      expect(result).toMatchObject({ modelId: "nemotron-3-super-free", isFree: true, costUsd: 0 });
      expect(result.routing.actualTier).toBe("free");
      const logged = (ctx.runMutation.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
      expect(logged).toMatchObject({ modelId: "nemotron-3-super-free", actualTier: "free", costUsd: 0, pinnedModel });

      generateText.mockClear();
      const cached = await call(makeCtx(), { tier: "free", pinnedModel, cacheKey: `pin-${pinnedModel}` });
      expect(generateText).not.toHaveBeenCalled();
      expect(cached).toMatchObject({ modelId: "nemotron-3-super-free", isFree: true, fromCache: true });
    },
  );

  it("a cheap-tier outage still falls through the cheap list (the paid list is only for paid tiers)", async () => {
    resolveChain.mockReturnValue({ chain: [], reason: "no_matches_for_requirement", diagnostics: { primaryOutcome: "not_supplied", candidatePoolSize: 0 } });
    generateText.mockRejectedValue(Object.assign(new Error("provider down"), { status: 400 }));
    await expect(call(makeCtx(), { tier: "cheap" })).rejects.toThrow(/All 4 models failed/);
  });
});
