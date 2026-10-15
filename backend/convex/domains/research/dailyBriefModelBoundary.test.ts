// @vitest-environment node
/**
 * The daily-brief public actions take `model: v.string()` from an authenticated browser and used to
 * hand it unchanged to executeFeature -> generateWithProvider -> getModelWithFailover -> the provider
 * SDK (SPEC-v9 A.0.10; PR #662 review round 2). Persona: a signed-in user who types a model name the
 * repo does not know ("gpt-5.5-pro"). The action must reject it before any internal action runs, so
 * no provider call and no spend. A known or free-looking id is validated and then forwarded exactly as
 * the caller wrote it: normalizeModelInput returns the resolver's lossy alias, and "claude-sonnet-4-5-20250929"
 * (live until 2026-11-30) must not become "claude-sonnet-4" (retired) in PR 1 (A.0.4; round 4).
 * Fake ctx; no network.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({ getAuthUserId: vi.fn(async () => "user1") }));

import { runNextPersonalTask } from "./dailyBriefPersonalOverlay";
import { runNextTask } from "./dailyBriefWorker";
import { UnknownModelError } from "../agents/mcp_tools/models";
import { FREE_LANE_WIRE_ID, LEGACY_PASSTHROUGH_IDS, getModelWithFailover, resolveModelAlias } from "../../../../shared/llm/modelCatalog";

const actions = [
  ["dailyBriefWorker.runNextTask", runNextTask],
  ["dailyBriefPersonalOverlay.runNextPersonalTask", runNextPersonalTask],
] as const;

describe.each(actions)("%s model boundary", (_name, action) => {
  const run = (args: Record<string, unknown>) => {
    const ctx = { runAction: vi.fn(async () => ({ done: true })) };
    const result = (action as any)._handler(ctx, args);
    return { ctx, result };
  };

  it.each(["gpt-not-real", "gpt-5.5-pro", "not-a-model"])("rejects unknown id %s before any internal action runs", async (model) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ctx, result } = run({ model });
    await expect(result).rejects.toBeInstanceOf(UnknownModelError);
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it("forwards a free-looking unknown id as written; the catalog then sends it to the free lane, never a paid model", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key-not-real");
    const { ctx, result } = run({ model: "retired-model-free", taskId: "t1" });
    await result;
    expect(ctx.runAction).toHaveBeenCalledWith(expect.anything(), { model: "retired-model-free", taskId: "t1" });
    expect(getModelWithFailover(resolveModelAlias("retired-model-free"))).toEqual({ model: FREE_LANE_WIRE_ID, provider: "openrouter", isFallback: true });
    vi.unstubAllEnvs();
  });

  it("forwards a known id exactly as given and leaves an omitted model omitted", async () => {
    const known = run({ model: "gpt-5.4-mini" });
    await known.result;
    expect(known.ctx.runAction).toHaveBeenCalledWith(expect.anything(), { model: "gpt-5.4-mini" });

    const omitted = run({ taskId: "t1" });
    await omitted.result;
    expect(omitted.ctx.runAction).toHaveBeenCalledWith(expect.anything(), { taskId: "t1" });
  });

  // Persona: a signed-in user pins a model that is live today. Before the fix the action replaced it with
  // the resolver's alias (claude-sonnet-4-5-20250929 -> claude-sonnet-4, claude-opus-4-5-20251101 ->
  // claude-opus-4, gpt-4o -> gpt-5.4, gpt-5-mini / gpt-4o-mini -> gpt-5.4-mini): all 16 ids main sent unchanged.
  it("forwards every legacy id main passed through byte-for-byte, and the catalog sends that same string to the provider", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key-not-real");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key-not-real-0000");
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key-not-real");
    expect(LEGACY_PASSTHROUGH_IDS.size).toBe(16);
    for (const model of LEGACY_PASSTHROUGH_IDS) {
      const { ctx, result } = run({ model, taskId: "t1" });
      await result;
      const forwarded = (ctx.runAction.mock.calls[0] as unknown as [unknown, { model: string }])[1].model;
      expect(forwarded, model).toBe(model);
      expect(getModelWithFailover(resolveModelAlias(forwarded)).model, model).toBe(model);
    }
    vi.unstubAllEnvs();
  });
});
