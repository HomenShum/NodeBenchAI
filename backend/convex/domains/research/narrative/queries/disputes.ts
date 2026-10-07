/**
 * Narrative Dispute Chain Queries
 *
 * Query operations for narrativeDisputeChains table.
 * Supports viewing disputes, their resolution status, and affected content.
 */

import { v } from "convex/values";
import { query, internalQuery } from "../../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Status filter validator
 */
const statusValidator = v.union(
  v.literal("open"),
  v.literal("under_review"),
  v.literal("resolved_original"),
  v.literal("resolved_challenge"),
  v.literal("merged")
);

// ============================================================================
// PUBLIC QUERIES (User-facing)
// ============================================================================

/**
 * Get disputes for a specific target
 */
export const getDisputesForTarget = query({
  args: {
    targetType: v.union(
      v.literal("post"),
      v.literal("event"),
      v.literal("fact"),
      v.literal("claim")
    ),
    targetId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("narrativeDisputeChains")
      .withIndex("by_target", (q) =>
        q.eq("targetType", args.targetType).eq("targetId", args.targetId)
      )
      .order("desc")
      .collect();
  },
});

/**
 * Get open disputes for moderation dashboard
 */
export const getOpenDisputes = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    return await ctx.db
      .query("narrativeDisputeChains")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("desc")
      .take(args.limit || 50);
  },
});

/**
 * Get disputes under review
 */
export const getDisputesUnderReview = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    return await ctx.db
      .query("narrativeDisputeChains")
      .withIndex("by_status", (q) => q.eq("status", "under_review"))
      .order("desc")
      .take(args.limit || 50);
  },
});

/**
 * Get dispute by ID
 */
export const getDispute = query({
  args: {
    disputeId: v.id("narrativeDisputeChains"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.disputeId);
  },
});

/**
 * Get disputes raised by a user
 */
export const getMyDisputes = query({
  args: {
    status: v.optional(statusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    let disputes;
    if (args.status) {
      disputes = await ctx.db
        .query("narrativeDisputeChains")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .order("desc")
        .take(args.limit || 50);
    } else {
      disputes = await ctx.db
        .query("narrativeDisputeChains")
        .order("desc")
        .take(args.limit || 50);
    }

    // Filter to disputes raised by this user
    return disputes.filter((d) => d.raisedBy === userId);
  },
});

/**
 * Get dispute statistics for dashboard
 */
export const getDisputeStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        total: 0,
        open: 0,
        underReview: 0,
        resolved: 0,
        byType: {},
      };
    }

    const allDisputes = await ctx.db
      .query("narrativeDisputeChains")
      .order("desc")
      .take(500);

    const stats = {
      total: allDisputes.length,
      open: 0,
      underReview: 0,
      resolved: 0,
      byType: {} as Record<string, number>,
    };

    for (const dispute of allDisputes) {
      if (dispute.status === "open") stats.open++;
      else if (dispute.status === "under_review") stats.underReview++;
      else stats.resolved++;

      stats.byType[dispute.disputeType] =
        (stats.byType[dispute.disputeType] || 0) + 1;
    }

    return stats;
  },
});

/**
 * Get resolved disputes for learning/patterns
 */
export const getResolvedDisputes = query({
  args: {
    disputeType: v.optional(
      v.union(
        v.literal("factual_error"),
        v.literal("outdated"),
        v.literal("missing_context"),
        v.literal("alternative_interpretation")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Get disputes by type if specified
    if (args.disputeType) {
      const disputes = await ctx.db
        .query("narrativeDisputeChains")
        .withIndex("by_type", (q) => q.eq("disputeType", args.disputeType!))
        .order("desc")
        .take(200);

      return disputes
        .filter(
          (d) =>
            d.status === "resolved_original" ||
            d.status === "resolved_challenge" ||
            d.status === "merged"
        )
        .slice(0, args.limit || 50);
    }

    // Get all resolved disputes
    const allDisputes = await ctx.db
      .query("narrativeDisputeChains")
      .order("desc")
      .take(500);

    return allDisputes
      .filter(
        (d) =>
          d.status === "resolved_original" ||
          d.status === "resolved_challenge" ||
          d.status === "merged"
      )
      .slice(0, args.limit || 50);
  },
});

// ============================================================================
// INTERNAL QUERIES (Agent-facing)
// ============================================================================

/**
 * Get open disputes for contradiction detection
 */
export const getOpenDisputesInternal = internalQuery({
  args: {
    targetType: v.optional(
      v.union(
        v.literal("post"),
        v.literal("event"),
        v.literal("fact"),
        v.literal("claim")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const disputes = await ctx.db
      .query("narrativeDisputeChains")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("desc")
      .take(args.limit || 100);

    if (args.targetType) {
      return disputes.filter((d) => d.targetType === args.targetType);
    }

    return disputes;
  },
});

/**
 * Check if a target already has an open dispute
 */
export const hasOpenDispute = internalQuery({
  args: {
    targetType: v.union(
      v.literal("post"),
      v.literal("event"),
      v.literal("fact"),
      v.literal("claim")
    ),
    targetId: v.string(),
  },
  handler: async (ctx, args) => {
    const disputes = await ctx.db
      .query("narrativeDisputeChains")
      .withIndex("by_target", (q) =>
        q.eq("targetType", args.targetType).eq("targetId", args.targetId)
      )
      .take(10);

    return disputes.some(
      (d) => d.status === "open" || d.status === "under_review"
    );
  },
});

/**
 * Get dispute patterns for learning
 */
export const getDisputePatternsInternal = internalQuery({
  args: {
    disputeType: v.union(
      v.literal("factual_error"),
      v.literal("outdated"),
      v.literal("missing_context"),
      v.literal("alternative_interpretation")
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const disputes = await ctx.db
      .query("narrativeDisputeChains")
      .withIndex("by_type", (q) => q.eq("disputeType", args.disputeType))
      .order("desc")
      .take(args.limit || 50);

    // Return only resolved disputes with resolutions for learning
    return disputes
      .filter((d) => d.resolution)
      .map((d) => ({
        originalClaim: d.originalClaim,
        challengeClaim: d.challengeClaim,
        resolution: d.resolution,
        resolvedAs: d.status,
      }));
  },
});
