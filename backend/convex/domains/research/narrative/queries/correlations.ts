/**
 * Narrative Correlations Queries (Phase 6+7)
 *
 * Read-only queries for narrativeCorrelations table.
 * Correlations represent detected relationships between events across threads,
 * each graded by correlationBasis (hard/soft proof) and reviewStatus.
 *
 * @module domains/narrative/queries/correlations
 */

import { v } from "convex/values";
import { query, internalQuery } from "../../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC QUERIES (User-facing, require auth)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get correlations for a specific thread.
 */
export const getByThread = query({
  args: {
    threadId: v.id("narrativeThreads"),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 50;
    const rows = await ctx.db
      .query("narrativeCorrelations")
      .withIndex("by_primary_thread", (q) => q.eq("primaryThreadId", args.threadId))
      .order("desc")
      .take(limit);

    return rows;
  },
});

/**
 * Get correlations for a specific event.
 */
export const getByEvent = query({
  args: {
    eventId: v.id("narrativeEvents"),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 20;
    const rows = await ctx.db
      .query("narrativeCorrelations")
      .withIndex("by_primary_event", (q) => q.eq("primaryEventId", args.eventId))
      .order("desc")
      .take(limit);

    return rows;
  },
});

/**
 * Get correlations by review status (e.g. needs_review for HITL queue).
 */
export const getByReviewStatus = query({
  args: {
    reviewStatus: v.union(
      v.literal("auto_approved"),
      v.literal("needs_review"),
      v.literal("human_verified"),
      v.literal("human_rejected")
    ),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 50;
    const rows = await ctx.db
      .query("narrativeCorrelations")
      .withIndex("by_review_status", (q) => q.eq("reviewStatus", args.reviewStatus))
      .order("desc")
      .take(limit);

    return rows;
  },
});

/**
 * Get correlations by proof basis (e.g. all shared_entity correlations).
 */
export const getByBasis = query({
  args: {
    correlationBasis: v.union(
      v.literal("shared_entity"),
      v.literal("shared_investor"),
      v.literal("explicit_reference"),
      v.literal("time_proximity"),
      v.literal("topic_similarity"),
      v.literal("llm_inference")
    ),
    reviewStatus: v.optional(v.union(
      v.literal("auto_approved"),
      v.literal("needs_review"),
      v.literal("human_verified"),
      v.literal("human_rejected")
    )),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 50;
    let q = ctx.db
      .query("narrativeCorrelations")
      .withIndex("by_basis", (idx) =>
        args.reviewStatus
          ? idx.eq("correlationBasis", args.correlationBasis).eq("reviewStatus", args.reviewStatus)
          : idx.eq("correlationBasis", args.correlationBasis)
      );

    const rows = await q.order("desc").take(limit);
    return rows;
  },
});

/**
 * Get a thread-level correlation summary (counts by type and proof level).
 */
export const getThreadCorrelationSummary = query({
  args: {
    threadId: v.id("narrativeThreads"),
  },
  returns: v.object({
    total: v.number(),
    byType: v.any(),
    byBasis: v.any(),
    byReviewStatus: v.any(),
    hardProofCount: v.number(),
    softProofCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { total: 0, byType: {}, byBasis: {}, byReviewStatus: {}, hardProofCount: 0, softProofCount: 0 };
    }

    const rows = await ctx.db
      .query("narrativeCorrelations")
      .withIndex("by_primary_thread", (q) => q.eq("primaryThreadId", args.threadId))
      .collect();

    const byType: Record<string, number> = {};
    const byBasis: Record<string, number> = {};
    const byReviewStatus: Record<string, number> = {};
    const HARD_BASES = new Set(["shared_entity", "shared_investor", "explicit_reference"]);
    let hardProofCount = 0;
    let softProofCount = 0;

    for (const r of rows) {
      byType[r.correlationType] = (byType[r.correlationType] || 0) + 1;
      byBasis[r.correlationBasis] = (byBasis[r.correlationBasis] || 0) + 1;
      byReviewStatus[r.reviewStatus] = (byReviewStatus[r.reviewStatus] || 0) + 1;
      if (HARD_BASES.has(r.correlationBasis)) hardProofCount++;
      else softProofCount++;
    }

    return {
      total: rows.length,
      byType,
      byBasis,
      byReviewStatus,
      hardProofCount,
      softProofCount,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL QUERIES (Agent-facing, no auth required)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get correlations for a thread (internal, no auth).
 */
export const getByThreadInternal = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    return await ctx.db
      .query("narrativeCorrelations")
      .withIndex("by_primary_thread", (q) => q.eq("primaryThreadId", args.threadId))
      .order("desc")
      .take(limit);
  },
});

/**
 * Get correlations needing review (internal, for HITL pipeline).
 */
export const getNeedsReviewInternal = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    return await ctx.db
      .query("narrativeCorrelations")
      .withIndex("by_review_status", (q) => q.eq("reviewStatus", "needs_review"))
      .order("desc")
      .take(limit);
  },
});
