// @vitest-environment node
/**
 * The daily-brief public actions take `model: v.string()` from an authenticated browser and used to
 * hand it unchanged to executeFeature -> generateWithProvider -> getModelWithFailover -> the provider
 * SDK (SPEC-v9 A.0.10; PR #662 review round 2). Persona: a signed-in user who types a model name the
 * repo does not know ("gpt-5.5-pro"). The action must reject it before any internal action runs, so
 * no provider call and no spend. Known ids and free-looking ids still go through, normalised.
 * Fake ctx; no network.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({ getAuthUserId: vi.fn(async () => "user1") }));

import { runNextPersonalTask } from "./dailyBriefPersonalOverlay";
import { runNextTask } from "./dailyBriefWorker";
import { UnknownModelError } from "../agents/mcp_tools/models";

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

  it("resolves a free-looking unknown id to the free lane, never a paid model", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ctx, result } = run({ model: "retired-model-free", taskId: "t1" });
    await result;
    expect(ctx.runAction).toHaveBeenCalledWith(expect.anything(), { model: "nemotron-3-super-free", taskId: "t1" });
  });

  it("forwards a known id as its approved alias and leaves an omitted model omitted", async () => {
    const known = run({ model: "gpt-5.4-mini" });
    await known.result;
    expect(known.ctx.runAction).toHaveBeenCalledWith(expect.anything(), { model: "gpt-5.4-mini" });

    const omitted = run({ taskId: "t1" });
    await omitted.result;
    expect(omitted.ctx.runAction).toHaveBeenCalledWith(expect.anything(), { taskId: "t1" });
  });
});
