// convex/domains/agents/agentDelegations.ts
// Queries + internal mutations for parallel delegation tracking
// OCC-safe: seq owned by action, not mutated per event

import { v } from "convex/values";
import { query, internalMutation, internalQuery } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATORS (reusable)
// ═══════════════════════════════════════════════════════════════════════════

export const agentNameValidator: any = v.union(
  v.literal("DocumentAgent"),
  v.literal("MediaAgent"),
  v.literal("SECAgent"),
  v.literal("OpenBBAgent"),
  v.literal("EntityResearchAgent"),
);

export const delegationStatusValidator: any = v.union(
  v.literal("scheduled"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const writeEventKindValidator: any = v.union(
  v.literal("delta"),
  v.literal("tool_start"),
  v.literal("tool_end"),
  v.literal("note"),
  v.literal("final"),
);

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES (auth-guarded)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * List active delegations for a run (UI subscription)
 * Auth-guarded: only returns delegations owned by current user
 */
export const listByRun = (query as any)({
  args: { runId: v.string() },
  handler: async (ctx: any, { runId }: any): Promise<any> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Filter by userId to prevent run bleed
    return await ctx.db
      .query("agentDelegations")
      .withIndex("by_user_run", (q: any) => q.eq("userId", userId).eq("runId", runId))
      .collect();
  },
});

/**
 * Internal version of listByRun (no auth check, for evaluation)
 */
export const listByRunInternal = (internalQuery as any)({
  args: {
    runId: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx: any, { runId, userId }: any): Promise<any> => {
    return await ctx.db
      .query("agentDelegations")
      .withIndex("by_user_run", (q: any) => q.eq("userId", userId).eq("runId", runId))
      .collect();
  },
});

/**
 * Get write events for a delegation (UI streaming)
 * Range query + bounded to prevent unbounded reads
 *
 * Fix B applied: proper index usage, no JS filter, bounded results
 */
export const getWriteEvents = (query as any)({
  args: {
    delegationId: v.string(),
    afterSeq: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx: any, { delegationId, afterSeq, limit }: any): Promise<any> => {
    // First verify user owns this delegation (auth guard)
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const delegation = await ctx.db
      .query("agentDelegations")
      .withIndex("by_delegation", (q: any) => q.eq("delegationId", delegationId))
      .unique();

    if (!delegation || delegation.userId !== userId) {
      return []; // Not found or not owned by user
    }

    // Range query using compound index (delegationId, seq)
    // Convex compound index allows eq on first field, then range on second
    let q = ctx.db
      .query("agentWriteEvents")
      .withIndex("by_delegation", (q: any) => q.eq("delegationId", delegationId));

    // Apply seq filter if provided (incremental fetch)
    if (afterSeq !== undefined) {
      q = q.filter((q: any) => q.gt(q.field("seq"), afterSeq));
    }

    // Bounded results to prevent runaway queries
    const boundedLimit = Math.min(limit ?? 200, 500);
    return await q.take(boundedLimit);
  },
});

/**
 * Internal version of getWriteEvents (no auth check, for evaluation)
 */
export const getWriteEventsInternal = (internalQuery as any)({
  args: {
    delegationId: v.string(),
    afterSeq: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx: any, { delegationId, afterSeq, limit }: any): Promise<any> => {
    let q = ctx.db
      .query("agentWriteEvents")
      .withIndex("by_delegation", (q: any) => q.eq("delegationId", delegationId));

    if (afterSeq !== undefined) {
      q = q.filter((q: any) => q.gt(q.field("seq"), afterSeq));
    }

    const boundedLimit = Math.min(limit ?? 200, 500);
    return await q.take(boundedLimit);
  },
});

/**
 * Get a single delegation by ID
 */
export const getByDelegationId = (query as any)({
  args: { delegationId: v.string() },
  handler: async (ctx: any, { delegationId }: any): Promise<any> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    
    const delegation = await ctx.db
      .query("agentDelegations")
      .withIndex("by_delegation", (q: any) => q.eq("delegationId", delegationId))
      .unique();
    
    if (!delegation || delegation.userId !== userId) {
      return null;
    }
    
    return delegation;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL MUTATIONS (called by actions only)
// Fix C applied: all writes are internal, not public
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new delegation record
 * Called before scheduling the execution action
 */
export const createDelegation = (internalMutation as any)({
  args: {
    runId: v.string(),
    delegationId: v.string(),
    userId: v.id("users"),
    agentName: agentNameValidator,
    query: v.string(),
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    await ctx.db.insert("agentDelegations", {
      runId: args.runId,
      delegationId: args.delegationId,
      userId: args.userId,
      agentName: args.agentName,
      query: args.query,
      status: "scheduled",
      scheduledAt: Date.now(),
    });
    return { delegationId: args.delegationId };
  },
});

/**
 * Update delegation status
 * Only patches specific fields to minimize write size
 */
export const updateStatus = (internalMutation as any)({
  args: {
    delegationId: v.string(),
    status: delegationStatusValidator,
    subagentThreadId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    finalPatchRef: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    const delegation = await ctx.db
      .query("agentDelegations")
      .withIndex("by_delegation", (q: any) => q.eq("delegationId", args.delegationId))
      .unique();
    
    if (!delegation) {
      console.warn(`[updateStatus] Delegation not found: ${args.delegationId}`);
      return;
    }
    
    const updates: Record<string, any> = { status: args.status };
    
    // Set timing fields based on status transition
    if (args.status === "running" && !delegation.startedAt) {
      updates.startedAt = Date.now();
    }
    if (args.status === "completed" || args.status === "failed" || args.status === "cancelled") {
      updates.finishedAt = Date.now();
    }
    
    // Optional fields
    if (args.subagentThreadId) updates.subagentThreadId = args.subagentThreadId;
    if (args.errorMessage) updates.errorMessage = args.errorMessage;
    if (args.finalPatchRef) updates.finalPatchRef = args.finalPatchRef;
    
    await ctx.db.patch(delegation._id, updates);
  },
});

/**
 * Emit a write event (append-only, OCC-safe)
 * 
 * Fix A applied: seq is passed in by action (action-owned), NOT mutated here
 * This makes streaming essentially conflict-free
 */
export const emitWriteEvent = (internalMutation as any)({
  args: {
    delegationId: v.string(),
    seq: v.number(),                    // Action-owned, passed in
    kind: writeEventKindValidator,
    textChunk: v.optional(v.string()),
    toolName: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    // Pure insert - no reads or patches, no OCC contention
    await ctx.db.insert("agentWriteEvents", {
      delegationId: args.delegationId,
      seq: args.seq,
      kind: args.kind,
      textChunk: args.textChunk,
      toolName: args.toolName,
      metadata: args.metadata,
      createdAt: Date.now(),
    });
  },
});

/**
 * Update merge status (called after coordinator merges)
 */
export const updateMergeStatus = (internalMutation as any)({
  args: {
    delegationId: v.string(),
    mergeStatus: v.string(),
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    const delegation = await ctx.db
      .query("agentDelegations")
      .withIndex("by_delegation", (q: any) => q.eq("delegationId", args.delegationId))
      .unique();
    
    if (!delegation) return;
    
    await ctx.db.patch(delegation._id, { mergeStatus: args.mergeStatus });
  },
});

/**
 * Cancel a delegation (user-initiated)
 */
export const cancelDelegation = (internalMutation as any)({
  args: { delegationId: v.string() },
  handler: async (ctx: any, args: any): Promise<any> => {
    const delegation = await ctx.db
      .query("agentDelegations")
      .withIndex("by_delegation", (q: any) => q.eq("delegationId", args.delegationId))
      .unique();
    
    if (!delegation) return;
    
    // Only cancel if still in progress
    if (delegation.status === "scheduled" || delegation.status === "running") {
      await ctx.db.patch(delegation._id, {
        status: "cancelled",
        finishedAt: Date.now(),
      });
    }
  },
});
