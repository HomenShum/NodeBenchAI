/**
 * Proactive Queries
 * Query functions for proactive feed and dashboard
 */

import { query } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Get user's proactive opportunities
 */
export const getUserOpportunities = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("detected"),
        v.literal("evaluating"),
        v.literal("approved"),
        v.literal("actioned"),
        v.literal("completed"),
        v.literal("dismissed")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user) {
      return [];
    }

    let query = ctx.db.query("opportunities");

    // Filter by user
    const opportunities = await query
      .filter((q) => q.eq(q.field("trigger.userId"), user._id))
      .order("desc")
      .take(args.limit || 50);

    // Filter by status if provided
    const filtered = args.status
      ? opportunities.filter((o) => o.status === args.status)
      : opportunities;

    return filtered;
  },
});

/**
 * Get a specific opportunity by ID
 */
export const getOpportunity = query({
  args: {
    opportunityId: v.id("opportunities"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user) {
      return null;
    }

    const opportunity = await ctx.db.get(args.opportunityId);

    if (!opportunity) {
      return null;
    }

    // Check ownership
    if (opportunity.trigger.userId !== user._id) {
      return null;
    }

    return opportunity;
  },
});

/**
 * Get user's proactive settings
 */
export const getUserSettings = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user) {
      return null;
    }

    const settings = await ctx.db
      .query("userProactiveSettings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    return settings;
  },
});

/**
 * Get user's usage stats
 */
export const getUserUsage = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user) {
      return null;
    }

    // Get current month usage
    const currentMonth = new Date().toISOString().slice(0, 7);
    const usage = await ctx.db
      .query("usageTracking")
      .withIndex("by_user_month", (q) =>
        q.eq("userId", user._id).eq("month", currentMonth)
      )
      .first();

    // Get subscription
    const subscription = await ctx.db
      .query("proactiveSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    const tier = subscription?.tier || "free";
    const limit = tier === "free" ? 50 : -1; // -1 = unlimited
    const used = usage?.proactiveNotifications || 0;

    return {
      tier,
      used,
      limit,
      remaining: limit === -1 ? -1 : Math.max(0, limit - used),
      month: currentMonth,
    };
  },
});

/**
 * Get user's consent status
 */
export const getConsentStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { hasConsent: false };
    }

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user) {
      return { hasConsent: false };
    }

    const consent = await ctx.db
      .query("userConsents")
      .withIndex("by_user_type", (q) =>
        q.eq("userId", user._id).eq("consentType", "proactive_features")
      )
      .first();

    if (!consent || !consent.granted) {
      return { hasConsent: false };
    }

    return {
      hasConsent: true,
      grantedAt: consent.grantedAt,
      version: consent.version,
    };
  },
});

/**
 * Get opportunities summary (for dashboard)
 */
export const getOpportunitiesSummary = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user) {
      return null;
    }

    // Get all opportunities for user
    const opportunities = await ctx.db
      .query("opportunities")
      .filter((q) => q.eq(q.field("trigger.userId"), user._id))
      .collect();

    // Calculate stats
    const total = opportunities.length;
    const byStatus = {
      detected: opportunities.filter((o) => o.status === "detected").length,
      evaluating: opportunities.filter((o) => o.status === "evaluating").length,
      approved: opportunities.filter((o) => o.status === "approved").length,
      actioned: opportunities.filter((o) => o.status === "actioned").length,
      completed: opportunities.filter((o) => o.status === "completed").length,
      dismissed: opportunities.filter((o) => o.status === "dismissed").length,
    };

    const byType: Record<string, number> = {};
    opportunities.forEach((o) => {
      byType[o.type] = (byType[o.type] || 0) + 1;
    });

    // Calculate time saved (sum of all time estimates)
    const totalTimeSaved = opportunities.reduce((sum, o) => {
      return sum + (o.impactEstimate?.timeSavedMinutes || 0);
    }, 0);

    return {
      total,
      byStatus,
      byType,
      totalTimeSaved,
      thisWeek: opportunities.filter(
        (o) => o.createdAt > Date.now() - 7 * 24 * 60 * 60 * 1000
      ).length,
    };
  },
});
