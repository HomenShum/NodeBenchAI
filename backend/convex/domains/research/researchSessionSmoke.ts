/**
 * Minimal smoke test for ultra-long chat pipeline.
 * Tests each primitive in isolation to isolate failures.
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

export const smokeTestPrimitives = internalAction({
  args: {
    ownerKey: v.string(),
    userId: v.string(),
  },
  returns: v.object({
    results: v.array(v.object({
      step: v.string(),
      ok: v.boolean(),
      durationMs: v.number(),
      payloadPreview: v.optional(v.string()),
      error: v.optional(v.string()),
    })),
  }),
  handler: async (ctx, args): Promise<any> => {
    const results: any[] = [];

    const step = async (name: string, fn: () => Promise<any>) => {
      const start = Date.now();
      try {
        const result = await fn();
        results.push({
          step: name,
          ok: true,
          durationMs: Date.now() - start,
          payloadPreview: JSON.stringify(result).slice(0, 200),
        });
        return result;
      } catch (e: any) {
        results.push({
          step: name,
          ok: false,
          durationMs: Date.now() - start,
          error: e?.message || String(e),
        });
        throw e;
      }
    };

    try {
      // 1) record a memory
      await step("recordMemory", () =>
        ctx.runMutation(internal.domains.research.researchSessionLifecycle.recordMemory, {
          userId: args.userId,
          claim: "smoke test memory",
          confidence: 0.5,
          topic: "smoke",
          tags: ["test"],
        }),
      );

      // 2) create session
      const sessionId = await step("createSession", () =>
        ctx.runMutation(internal.domains.research.researchSessionLifecycle.createSession, {
          userId: args.userId,
          topic: "smoke test topic",
          primaryEntity: "test-entity",
        }),
      );

      // 3) get session
      await step("getSession", () =>
        ctx.runQuery(internal.domains.research.researchSessionLifecycle.getSession, {
          sessionId,
        }),
      );

      // 4) get relevant memory
      await step("getRelevantMemory", () =>
        ctx.runQuery(internal.domains.research.researchSessionLifecycle.getRelevantMemory, {
          userId: args.userId,
          topic: "smoke",
          limit: 5,
        }),
      );

      // 5) record turn
      await step("recordTurn", () =>
        ctx.runMutation(internal.domains.research.researchSessionLifecycle.recordTurn, {
          sessionId,
          tokensConsumed: 500,
        }),
      );

      // 6) hydrate one angle
      await step("hydrateAngle", () =>
        ctx.runQuery(internal.domains.research.researchSessionJit.hydrateAngle, {
          ownerKey: args.ownerKey,
          userId: args.userId,
          angleId: "entity_profile",
          entitySlug: "test-entity",
        }),
      );

      // 7) load angle
      await step("loadAngle", () =>
        ctx.runMutation(internal.domains.research.researchSessionLifecycle.loadAngle, {
          sessionId,
          angleId: "entity_profile",
          summary: "test summary",
          fullDataRef: "ref:test",
          dataHash: "abc123",
        }),
      );

      // 8) evict stale
      await step("evictStale", () =>
        ctx.runMutation(internal.domains.research.researchSessionLifecycle.evictStaleAngles, {
          sessionId,
          staleThresholdMs: 1000,
        }),
      );

      // 9) save checkpoint
      await step("saveCheckpoint", () =>
        ctx.runMutation(internal.domains.research.researchSessionLifecycle.saveCheckpoint, {
          sessionId,
          threadId: "smoke-thread",
          turnNumber: 1,
          checkpointNs: "smoke",
          state: { test: true },
          nextNodes: ["done"],
        }),
      );

      // 10) run full turn via orchestrator
      await step("runTurn", () =>
        ctx.runAction(internal.domains.research.researchSessionOrchestrator.runTurn, {
          sessionId,
          ownerKey: args.ownerKey,
          userId: args.userId,
          prompt: "Tell me about this entity's recent funding",
          entitySlug: "test-entity",
          hotWindow: [],
          estimatedPromptTokens: 500,
        }),
      );
    } catch (e: any) {
      // Already recorded in step()
    }

    return { results };
  },
});
