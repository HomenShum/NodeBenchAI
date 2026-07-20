/**
 * Recommendation Feedback System
 *
 * Captures user actions and outcomes for recommendations.
 * Enables the recommendation system to learn from user preferences.
 *
 * Created: 2026-01-21 (P0 - Critical for recommendation improvement)
 */

import { mutation, query } from "../../../_generated/server";
import { v } from "convex/values";

/**
 * Record user action on a recommendation
 */
export const recordRecommendationOutcome = mutation({
  args: {
    recommendationId: v.id("recommendations"),
    action: v.union(
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("ignored"),
      v.literal("dismissed"),
      v.literal("snoozed")
    ),
    reason: v.optional(v.string()),
    actualValue: v.optional(v.number()), // 0-1 user rating
    timeTakenMs: v.optional(v.number()),
    displayContext: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const userId = identity.subject as any; // User ID from auth

    const outcomeId = await ctx.db.insert("recommendationOutcomes", {
      recommendationId: args.recommendationId,
      userId,
      action: args.action,
      actionTimestamp: Date.now(),
      reason: args.reason,
      actualValue: args.actualValue,
      timeTakenMs: args.timeTakenMs,
      displayContext: args.displayContext,
      metadata: args.metadata,
      createdAt: Date.now(),
    });

    console.log(
      `[RecommendationFeedback] User ${userId} ${args.action} recommendation ${args.recommendationId}`
    );

    return { success: true, outcomeId };
  },
});

/**
 * Get outcomes for a specific recommendation
 */
export const getRecommendationOutcomes = query({
  args: {
    recommendationId: v.id("recommendations"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("recommendationOutcomes")
      .withIndex("by_recommendation", (q) =>
        q.eq("recommendationId", args.recommendationId)
      )
      .collect();
  },
});

/**
 * Get user's recommendation history
 */
export const getUserRecommendationHistory = query({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    return await ctx.db
      .query("recommendationOutcomes")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit);
  },
});

/**
 * Get recommendation acceptance rate for analysis
 */
export const getRecommendationAcceptanceRate = query({
  args: {
    userId: v.optional(v.id("users")),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let outcomes;

    if (args.userId) {
      outcomes = await ctx.db
        .query("recommendationOutcomes")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect();
    } else {
      outcomes = await ctx.db.query("recommendationOutcomes").collect();
    }

    // Filter by date range if provided
    if (args.startDate || args.endDate) {
      outcomes = outcomes.filter((o) => {
        if (args.startDate && o.actionTimestamp < args.startDate) return false;
        if (args.endDate && o.actionTimestamp > args.endDate) return false;
        return true;
      });
    }

    // Calculate metrics
    const total = outcomes.length;
    const accepted = outcomes.filter((o) => o.action === "accepted").length;
    const rejected = outcomes.filter((o) => o.action === "rejected").length;
    const ignored = outcomes.filter((o) => o.action === "ignored").length;
    const dismissed = outcomes.filter((o) => o.action === "dismissed").length;
    const snoozed = outcomes.filter((o) => o.action === "snoozed").length;

    const acceptanceRate = total > 0 ? accepted / total : 0;
    const rejectionRate = total > 0 ? rejected / total : 0;

    // Calculate average value rating for accepted recommendations
    const acceptedWithRatings = outcomes.filter(
      (o) => o.action === "accepted" && o.actualValue !== undefined
    );
    const avgValue =
      acceptedWithRatings.length > 0
        ? acceptedWithRatings.reduce((sum, o) => sum + (o.actualValue || 0), 0) /
          acceptedWithRatings.length
        : null;

    return {
      total,
      accepted,
      rejected,
      ignored,
      dismissed,
      snoozed,
      acceptanceRate,
      rejectionRate,
      avgValue,
    };
  },
});

/**
 * Get recommendations that need feedback (shown but no outcome yet)
 */
export const getRecommendationsNeedingFeedback = query({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;

    // Get all user recommendations
    const recommendations = await ctx.db
      .query("recommendations")
      .collect();

    // Get all outcomes
    const outcomes = await ctx.db
      .query("recommendationOutcomes")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const outcomeRecIds = new Set(outcomes.map((o) => o.recommendationId));

    // Filter recommendations without outcomes
    const needingFeedback = recommendations.filter(
      (r) => !outcomeRecIds.has(r._id)
    );

    return needingFeedback.slice(0, limit);
  },
});

/**
 * Get common rejection reasons for analysis
 */
export const getTopRejectionReasons = query({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 10;

    let outcomes = await ctx.db
      .query("recommendationOutcomes")
      .withIndex("by_action", (q) => q.eq("action", "rejected"))
      .collect();

    // Filter by date range
    if (args.startDate || args.endDate) {
      outcomes = outcomes.filter((o) => {
        if (args.startDate && o.actionTimestamp < args.startDate) return false;
        if (args.endDate && o.actionTimestamp > args.endDate) return false;
        return true;
      });
    }

    // Group by reason
    const reasonCounts = new Map<string, number>();

    for (const outcome of outcomes) {
      if (outcome.reason) {
        const count = reasonCounts.get(outcome.reason) || 0;
        reasonCounts.set(outcome.reason, count + 1);
      }
    }

    // Sort by frequency
    const results = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    return results;
  },
});

/**
 * Get average time to action for recommendations
 */
export const getAverageTimeToAction = query({
  args: {
    userId: v.optional(v.id("users")),
    action: v.optional(v.union(
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("ignored"),
      v.literal("dismissed"),
      v.literal("snoozed")
    )),
  },
  handler: async (ctx, args) => {
    let outcomes;

    if (args.userId) {
      outcomes = await ctx.db
        .query("recommendationOutcomes")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect();
    } else {
      outcomes = await ctx.db.query("recommendationOutcomes").collect();
    }

    if (args.action) {
      outcomes = outcomes.filter((o) => o.action === args.action);
    }

    // Filter only outcomes with timeTaken data
    const outcomesWithTime = outcomes.filter((o) => o.timeTakenMs !== undefined);

    if (outcomesWithTime.length === 0) {
      return { avgTimeMs: null, count: 0 };
    }

    const avgTimeMs =
      outcomesWithTime.reduce((sum, o) => sum + (o.timeTakenMs || 0), 0) /
      outcomesWithTime.length;

    return {
      avgTimeMs,
      avgTimeSeconds: avgTimeMs / 1000,
      count: outcomesWithTime.length,
    };
  },
});
