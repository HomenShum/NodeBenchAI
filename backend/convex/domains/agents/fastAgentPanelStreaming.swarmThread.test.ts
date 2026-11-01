import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createThreadForUserInternal } from "./fastAgentPanelStreaming";
import { UnknownModelError } from "./mcp_tools/models/modelResolver";

// PR #662 round 15. Persona: a signed-in user starts a research team from the agents hub (createSwarm). The
// server default model is 'claude-sonnet-4.6' and the liveApiSmoke default is 'claude-haiku-4.5'. Both are
// approved models the advisor profile does not allow, and the swarm's TASKS run the requested model. The thread
// that holds the team's output used the refusing normalizer, so team creation threw RefusedModelError before
// any task existed (origin/main swapped only the thread's metadata to kimi-k2.6 and ran the tasks as asked).

async function runHandler(model: string | undefined) {
  const stored: Array<Record<string, unknown>> = [];
  const ctx = {
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args && "agentThreadId" in args && "model" in args) {
        stored.push(args);
        return "chatThreadsStream-1";
      }
      return { _id: "agent-thread-1", threadId: "agent-thread-1" };
    },
    runQuery: async () => null,
    runAction: async () => null,
  };
  const handler = (createThreadForUserInternal as unknown as {
    _handler: (c: unknown, a: Record<string, unknown>) => Promise<unknown>;
  })._handler;
  await handler(ctx, { userId: "users-1", title: "Swarm: test", ...(model ? { model } : {}) });
  return stored;
}

describe("swarm thread creation (createThreadForUserInternal)", () => {
  // A placeholder key only lets the provider object be built; ctx is a stub, so nothing is ever sent.
  beforeEach(() => vi.stubEnv("OPENROUTER_API_KEY", "test-placeholder"));
  afterEach(() => vi.unstubAllEnvs());

  it("creates the thread for the createSwarm and liveApiSmoke default models instead of refusing them", async () => {
    for (const model of ["claude-sonnet-4.6", "claude-haiku-4.5"]) {
      const stored = await runHandler(model);
      expect(stored, model).toHaveLength(1);
      expect(stored[0].model, model).toBe("kimi-k2.6");
    }
  });

  it("still fails closed on an id nobody knows", async () => {
    await expect(runHandler("gpt-9-ultra")).rejects.toBeInstanceOf(UnknownModelError);
  });
});
