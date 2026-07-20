/**
 * HITL Decision Tracking
 *
 * Tracks outcomes of human-in-the-loop review requests.
 * Enables measurement of HITL effectiveness and automation improvement.
 *
 * Created: 2026-01-21 (P0 - Critical for HITL analytics)
 */

import { mutation, query } from "../../../_generated/server";
import { v } from "convex/values";

/**
 * Record a human decision on a HITL request
 */
export const recordHumanDecision = mutation({
  args: {
    requestId: v.id("humanRequests"),
    requestType: v.string(),
    decision: v.union(
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("modified"),
      v.literal("escalated"),
      v.literal("deferred")
    ),
    reviewTimeMs: v.number(),
    feedback: v.optional(v.string()),
    modifiedFields: v.optional(v.array(v.string())),
    modifiedValues: v.optional(v.any()),
    confidence: v.optional(v.number()),
    reasoning: v.optional(v.string()),
    escalatedTo: v.optional(v.id("users")),
    deferredUntil: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const userId = identity.subject as any;

    const decisionId = await ctx.db.insert("humanDecisions", {
      requestId: args.requestId,
      requestType: args.requestType,
      decision: args.decision,
      reviewTimeMs: args.reviewTimeMs,
      reviewedBy: userId,
      reviewedAt: Date.now(),
      feedback: args.feedback,
      modifiedFields: args.modifiedFields,
      modifiedValues: args.modifiedValues,
      confidence: args.confidence,
      reasoning: args.reasoning,
      escalatedTo: args.escalatedTo,
      deferredUntil: args.deferredUntil,
      metadata: args.metadata,
      createdAt: Date.now(),
    });

    console.log(
      `[HITL Decision] User ${userId} ${args.decision} request ${args.requestId} in ${args.reviewTimeMs}ms`
    );

    return { success: true, decisionId };
  },
});

/**
 * Get decision for a specific HITL request
 */
export const getDecisionByRequest = query({
  args: {
    requestId: v.id("humanRequests"),
  },
  handler: async (ctx, args) => {
    const decisions = await ctx.db
      .query("humanDecisions")
      .withIndex("by_request", (q) => q.eq("requestId", args.requestId))
      .collect();

    return decisions[0]; // Should only be one decision per request
  },
});

/**
 * Get all decisions by a specific reviewer
 */
export const getDecisionsByReviewer = query({
  args: {
    reviewerId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    return await ctx.db
      .query("humanDecisions")
      .withIndex("by_reviewer", (q) => q.eq("reviewedBy", args.reviewerId))
      .order("desc")
      .take(limit);
  },
});

/**
 * Get HITL approval rate metrics
 */
export const getHitlApprovalRate = query({
  args: {
    requestType: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let decisions;

    if (args.requestType) {
      decisions = await ctx.db
        .query("humanDecisions")
        .withIndex("by_request_type", (q) => q.eq("requestType", args.requestType))
        .collect();
    } else {
      decisions = await ctx.db.query("humanDecisions").collect();
    }

    // Filter by date range
    if (args.startDate || args.endDate) {
      decisions = decisions.filter((d) => {
        if (args.startDate && d.reviewedAt < args.startDate) return false;
        if (args.endDate && d.reviewedAt > args.endDate) return false;
        return true;
      });
    }

    // Calculate metrics
    const total = decisions.length;
    const approved = decisions.filter((d) => d.decision === "approved").length;
    const rejected = decisions.filter((d) => d.decision === "rejected").length;
    const modified = decisions.filter((d) => d.decision === "modified").length;
    const escalated = decisions.filter((d) => d.decision === "escalated").length;
    const deferred = decisions.filter((d) => d.decision === "deferred").length;

    const approvalRate = total > 0 ? approved / total : 0;
    const rejectionRate = total > 0 ? rejected / total : 0;
    const modificationRate = total > 0 ? modified / total : 0;

    // Calculate average review time
    const avgReviewTimeMs =
      total > 0
        ? decisions.reduce((sum, d) => sum + d.reviewTimeMs, 0) / total
        : 0;

    return {
      total,
      approved,
      rejected,
      modified,
      escalated,
      deferred,
      approvalRate,
      rejectionRate,
      modificationRate,
      avgReviewTimeMs,
      avgReviewTimeSeconds: avgReviewTimeMs / 1000,
    };
  },
});

/**
 * Get average review time by request type
 */
export const getAverageReviewTimeByType = query({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let decisions = await ctx.db.query("humanDecisions").collect();

    // Filter by date range
    if (args.startDate || args.endDate) {
      decisions = decisions.filter((d) => {
        if (args.startDate && d.reviewedAt < args.startDate) return false;
        if (args.endDate && d.reviewedAt > args.endDate) return false;
        return true;
      });
    }

    // Group by request type
    const typeMetrics = new Map<string, {
      totalTime: number;
      count: number;
      approved: number;
      rejected: number;
      modified: number;
    }>();

    for (const decision of decisions) {
      const existing = typeMetrics.get(decision.requestType) || {
        totalTime: 0,
        count: 0,
        approved: 0,
        rejected: 0,
        modified: 0,
      };

      existing.totalTime += decision.reviewTimeMs;
      existing.count++;

      if (decision.decision === "approved") existing.approved++;
      if (decision.decision === "rejected") existing.rejected++;
      if (decision.decision === "modified") existing.modified++;

      typeMetrics.set(decision.requestType, existing);
    }

    // Calculate averages
    const results = Array.from(typeMetrics.entries()).map(([type, metrics]) => ({
      requestType: type,
      avgReviewTimeMs: metrics.totalTime / metrics.count,
      avgReviewTimeSeconds: metrics.totalTime / metrics.count / 1000,
      count: metrics.count,
      approvalRate: metrics.approved / metrics.count,
      rejectionRate: metrics.rejected / metrics.count,
      modificationRate: metrics.modified / metrics.count,
    }));

    return results.sort((a, b) => b.count - a.count);
  },
});

/**
 * Get most commonly modified fields for improvement
 */
export const getMostModifiedFields = query({
  args: {
    requestType: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 10;

    let decisions = await ctx.db
      .query("humanDecisions")
      .withIndex("by_decision", (q) => q.eq("decision", "modified"))
      .collect();

    if (args.requestType) {
      decisions = decisions.filter((d) => d.requestType === args.requestType);
    }

    // Count field modifications
    const fieldCounts = new Map<string, number>();

    for (const decision of decisions) {
      if (decision.modifiedFields) {
        for (const field of decision.modifiedFields) {
          const count = fieldCounts.get(field) || 0;
          fieldCounts.set(field, count + 1);
        }
      }
    }

    // Sort by frequency
    const results = Array.from(fieldCounts.entries())
      .map(([field, count]) => ({ field, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    return results;
  },
});

/**
 * Get reviewer performance metrics
 */
export const getReviewerPerformance = query({
  args: {
    reviewerId: v.id("users"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let decisions = await ctx.db
      .query("humanDecisions")
      .withIndex("by_reviewer", (q) => q.eq("reviewedBy", args.reviewerId))
      .collect();

    // Filter by date range
    if (args.startDate || args.endDate) {
      decisions = decisions.filter((d) => {
        if (args.startDate && d.reviewedAt < args.startDate) return false;
        if (args.endDate && d.reviewedAt > args.endDate) return false;
        return true;
      });
    }

    const total = decisions.length;
    const approved = decisions.filter((d) => d.decision === "approved").length;
    const rejected = decisions.filter((d) => d.decision === "rejected").length;
    const modified = decisions.filter((d) => d.decision === "modified").length;

    const avgReviewTimeMs =
      total > 0
        ? decisions.reduce((sum, d) => sum + d.reviewTimeMs, 0) / total
        : 0;

    const avgConfidence =
      decisions.filter((d) => d.confidence !== undefined).length > 0
        ? decisions.reduce((sum, d) => sum + (d.confidence || 0), 0) /
          decisions.filter((d) => d.confidence !== undefined).length
        : null;

    return {
      reviewerId: args.reviewerId,
      totalDecisions: total,
      approved,
      rejected,
      modified,
      approvalRate: total > 0 ? approved / total : 0,
      avgReviewTimeMs,
      avgReviewTimeSeconds: avgReviewTimeMs / 1000,
      avgConfidence,
    };
  },
});

/**
 * Get pending escalations
 */
export const getPendingEscalations = query({
  args: {
    escalatedTo: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    let decisions = await ctx.db
      .query("humanDecisions")
      .withIndex("by_decision", (q) => q.eq("decision", "escalated"))
      .collect();

    if (args.escalatedTo) {
      decisions = decisions.filter((d) => d.escalatedTo === args.escalatedTo);
    }

    // Filter only those without a follow-up decision
    // (In a real implementation, you'd check if the escalated request has been resolved)
    return decisions;
  },
});
