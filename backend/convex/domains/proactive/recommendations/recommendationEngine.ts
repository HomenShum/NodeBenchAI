import { v } from "convex/values";
import { mutation, query, internalMutation } from "../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc } from "../../../_generated/dataModel";

/**
 * Get active recommendations for the current user
 */
export const getActiveRecommendations = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const now = Date.now();
    const limit = args.limit ?? 5;

    const recommendations = await ctx.db
      .query("recommendations")
      .withIndex("by_user_active", (q) =>
        q.eq("userId", userId).eq("dismissed", false).gte("expiresAt", now)
      )
      .order("desc")
      .take(limit);

    return recommendations;
  },
});

/**
 * Create a new recommendation
 */
export const createRecommendation = mutation({
  args: {
    type: v.union(
      v.literal("pattern"),
      v.literal("idle_content"),
      v.literal("collaboration"),
      v.literal("external_trigger"),
      v.literal("smart_suggestion")
    ),
    priority: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    message: v.string(),
    actionLabel: v.string(),
    actionType: v.optional(v.string()),
    actionData: v.optional(v.any()),
    icon: v.optional(v.string()),
    expiresInHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const expiresInHours = args.expiresInHours ?? 24;
    const expiresAt = Date.now() + expiresInHours * 60 * 60 * 1000;

    const recId = await ctx.db.insert("recommendations", {
      userId,
      type: args.type,
      priority: args.priority,
      message: args.message,
      actionLabel: args.actionLabel,
      actionType: args.actionType,
      actionData: args.actionData,
      icon: args.icon,
      dismissed: false,
      clicked: false,
      createdAt: Date.now(),
      expiresAt,
    });

    return recId;
  },
});

/**
 * Dismiss a recommendation
 */
export const dismissRecommendation = mutation({
  args: { recommendationId: v.id("recommendations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const rec = await ctx.db.get(args.recommendationId) as Doc<"recommendations"> | null;
    if (!rec || rec.userId !== userId) {
      throw new Error("Recommendation not found");
    }

    await ctx.db.patch(args.recommendationId, { dismissed: true });
  },
});

/**
 * Mark a recommendation as clicked
 */
export const clickRecommendation = mutation({
  args: { recommendationId: v.id("recommendations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const rec = await ctx.db.get(args.recommendationId) as Doc<"recommendations"> | null;
    if (!rec || rec.userId !== userId) {
      throw new Error("Recommendation not found");
    }

    await ctx.db.patch(args.recommendationId, { clicked: true, dismissed: true });
  },
});

/**
 * Internal: Create recommendation (for scheduled jobs)
 */
export const createRecommendationInternal = internalMutation({
  args: {
    userId: v.id("users"),
    type: v.union(
      v.literal("pattern"),
      v.literal("idle_content"),
      v.literal("collaboration"),
      v.literal("external_trigger"),
      v.literal("smart_suggestion")
    ),
    priority: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    message: v.string(),
    actionLabel: v.string(),
    actionType: v.optional(v.string()),
    actionData: v.optional(v.any()),
    icon: v.optional(v.string()),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId, ...rest } = args;
    await ctx.db.insert("recommendations", {
      userId,
      ...rest,
      dismissed: false,
      clicked: false,
      createdAt: Date.now(),
    });
  },
});

/**
 * Get recommendation stats for the user
 */
export const getRecommendationStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const allRecs = await ctx.db
      .query("recommendations")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .collect() as Doc<"recommendations">[];

    const clicked = allRecs.filter((r: Doc<"recommendations">) => r.clicked).length;
    const dismissed = allRecs.filter((r: Doc<"recommendations">) => r.dismissed && !r.clicked).length;
    const total = allRecs.length;

    return {
      total,
      clicked,
      dismissed,
      clickRate: total > 0 ? clicked / total : 0,
    };
  },
});

