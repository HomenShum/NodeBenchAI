// @vitest-environment node
/**
 * agentChatActions.continueThread resumes a conversation on the model stored on its thread
 * (SPEC-v9 A.0.10; PR #662 review round 1). Persona: a user returning to a thread whose stored
 * model name no longer resolves (a retired or mistyped alias). The turn must stop with
 * UnknownModelError. It used to catch the error, log a warning and carry on with DEFAULT_MODEL
 * (kimi-k2.6), so the user paid for a model they never chose; logging a fallback is not a control.
 * A transient failure to read the thread is a different thing and still uses the default.
 * The agent is faked; no network, no spend.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createCoordinatorAgent = vi.hoisted(() => vi.fn());
vi.mock("./core/coordinatorAgent", () => ({ createCoordinatorAgent }));
vi.mock("@convex-dev/auth/server", () => ({ getAuthUserId: vi.fn(async () => "user1") }));

import { continueThread } from "./agentChatActions";
import { UnknownModelError } from "./mcp_tools/models";

function ctxWith(streamThreadModel: string | Error) {
  return {
    runQuery: vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("agentThreadId" in args) {
        if (streamThreadModel instanceof Error) throw streamThreadModel;
        return { model: streamThreadModel };
      }
      return { agentThreadId: "agent-thread-1" };
    }),
  };
}

describe("agentChatActions.continueThread fails closed on a stored model", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    createCoordinatorAgent.mockReset();
    const result = { consumeStream: vi.fn(async () => undefined) };
    createCoordinatorAgent.mockReturnValue({
      saveMessage: vi.fn(async () => ({ messageId: "m1" })),
      streamText: vi.fn(async () => result),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("an unknown stored model stops the turn and starts no agent", async () => {
    await expect(
      (continueThread as any)._handler(ctxWith("gpt-9-ultra"), { threadId: "t1", message: "hi" }),
    ).rejects.toBeInstanceOf(UnknownModelError);
    expect(createCoordinatorAgent).not.toHaveBeenCalled();
  });

  it("a free-looking stored model continues on the free lane, not a paid default", async () => {
    await (continueThread as any)._handler(ctxWith("retired-model-free"), { threadId: "t1", message: "hi" });
    expect(createCoordinatorAgent).toHaveBeenCalledWith("flint-v1-free");
  });

  it("a transient failure to read the thread still falls back to the default model", async () => {
    await (continueThread as any)._handler(ctxWith(new Error("convex timeout")), { threadId: "t1", message: "hi" });
    expect(createCoordinatorAgent).toHaveBeenCalledWith("kimi-k2.6");
  });
});
