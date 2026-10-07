/**
 * ActionSpan Replay — Query & Mutation helpers
 *
 * Convex internalActions cannot directly access ctx.db. These internal queries
 * and mutations are called from the replay engine via ctx.runQuery / ctx.runMutation.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "../_generated/server";

// ---------------------------------------------------------------------------
// Queries — fetch span records for replay
// ---------------------------------------------------------------------------

export const getTrajectorySpan = internalQuery({
  args: { spanId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    // spanId is the spanKey field
    const spans = await ctx.db
      .query("trajectorySpans")
      .filter((q) => q.eq(q.field("spanKey"), args.spanId))
      .take(1);
    return spans[0] ?? null;
  },
});

export const getRunStep = internalQuery({
  args: { spanId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    // spanId format for runSteps is "taskId:stepNumber"
    const parts = args.spanId.split(":");
    if (parts.length < 2) return null;

    const taskId = parts[0];
    const stepNumber = parseInt(parts[1], 10);
    if (isNaN(stepNumber)) return null;

    // Use the by_task_step index
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_task_step", (q: any) =>
        q.eq("taskId", taskId).eq("stepNumber", stepNumber),
      )
      .take(1);
    return steps[0] ?? null;
  },
});

// ---------------------------------------------------------------------------
// Mutations — persist replay span records
// ---------------------------------------------------------------------------

export const insertReplaySpan = internalMutation({
  args: {
    entityKey: v.string(),
    entityType: v.string(),
    spanKey: v.string(),
    parentSpanKey: v.optional(v.string()),
    traceKey: v.optional(v.string()),
    sessionKey: v.optional(v.string()),
    spanType: v.string(),
    name: v.string(),
    status: v.string(),
    summary: v.string(),
    score: v.optional(v.number()),
    sourceRecordType: v.string(),
    sourceRecordId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("trajectorySpans", {
      entityKey: args.entityKey,
      entityType: args.entityType as any,
      spanKey: args.spanKey,
      parentSpanKey: args.parentSpanKey,
      traceKey: args.traceKey,
      sessionKey: args.sessionKey,
      spanType: args.spanType,
      name: args.name,
      status: args.status,
      summary: args.summary,
      score: args.score,
      sourceRecordType: args.sourceRecordType,
      sourceRecordId: args.sourceRecordId,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    });
    return { spanId: id };
  },
});
