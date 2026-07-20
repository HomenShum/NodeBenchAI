import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../../../_generated/server";

/**
 * Persist a compact, replay-friendly snapshot for a Newsroom workflow execution.
 *
 * Implementation note:
 * Uses the existing `checkpoints` table as the storage substrate to avoid
 * introducing new schema surface area. The stored `state` is a single immutable
 * snapshot (no resume semantics required).
 */
export const saveNewsroomWorkflowSnapshot = internalMutation({
  args: {
    workflowId: v.string(),
    weekNumber: v.string(),
    entityKeys: v.array(v.string()),
    fixtureId: v.optional(v.string()),
    config: v.optional(v.any()),
    configHash: v.string(),
    codeVersion: v.optional(v.string()),
    toolReplayMode: v.optional(
      v.union(v.literal("live"), v.literal("record"), v.literal("replay"))
    ),
    deterministicNowMs: v.optional(v.number()),
    published: v.object({
      threadDocIds: v.array(v.string()),
      eventDocIds: v.array(v.string()),
      postDocIds: v.optional(v.array(v.string())),
      stableEventIds: v.array(v.string()),
      searchLogIds: v.array(v.string()),
    }),
    dedupDecisions: v.optional(v.array(v.any())),
    stats: v.object({
      newsItemsFound: v.number(),
      claimsRetrieved: v.number(),
      existingThreads: v.number(),
      shiftsDetected: v.number(),
      narrativesPublished: v.number(),
      searchesLogged: v.number(),
      citationsGenerated: v.number(),
      verifiedEvents: v.optional(v.number()),
      temporalFactsCreated: v.optional(v.number()),
      contradictionsFound: v.optional(v.number()),
      disputesCreated: v.optional(v.number()),
    }),
    errors: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();

    const state = {
      version: 3,
      kind: "drane_newsroom_snapshot",
      weekNumber: args.weekNumber,
      entityKeys: args.entityKeys,
      fixtureId: args.fixtureId,
      config: args.config ?? null,
      configHash: args.configHash,
      codeVersion: args.codeVersion ?? null,
      toolReplayMode: args.toolReplayMode ?? "live",
      deterministicNowMs: args.deterministicNowMs ?? null,
      published: {
        ...args.published,
        postDocIds: args.published.postDocIds ?? [],
      },
      dedupDecisions: args.dedupDecisions ?? [],
      stats: args.stats,
      errors: args.errors,
      capturedAt: now,
    };

    await ctx.db.insert("checkpoints", {
      workflowId: args.workflowId,
      checkpointId: `drane_${args.workflowId}_${now}`,
      checkpointNumber: 1,
      parentCheckpointId: undefined,
      workflowType: "drane_newsroom",
      workflowName: "DRANE Newsroom Pipeline",
      userId: undefined,
      sessionId: undefined,
      currentStep: "complete",
      status: args.errors.length > 0 ? "error" : "completed",
      progress: 100,
      state,
      createdAt: now,
      error: args.errors.length > 0 ? args.errors[0] : undefined,
      estimatedTimeRemaining: undefined,
      nextScheduledAction: undefined,
    });

    return null;
  },
});

/**
 * Get the most recent snapshot for a given workflowId (best-effort).
 */
export const getLatestNewsroomWorkflowSnapshot = internalQuery({
  args: {
    workflowId: v.string(),
  },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const checkpoint = await ctx.db
      .query("checkpoints")
      .withIndex("by_workflow_id", (q) => q.eq("workflowId", args.workflowId))
      .filter((q) => q.eq(q.field("workflowType"), "drane_newsroom"))
      .order("desc")
      .first();
    return checkpoint ? checkpoint.state : null;
  },
});
