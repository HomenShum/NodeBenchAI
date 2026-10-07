/**
 * Admin Queries
 * Queries for admin feedback dashboard (invite-only)
 *
 * Access Control: Only users in adminUsers table can access these queries
 */

import { query } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Check if current user has admin access
 */
export const checkAdminAccess = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        hasAccess: false,
      };
    }

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user) {
      return {
        hasAccess: false,
      };
    }

    const adminUser = await ctx.db
      .query("adminUsers")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();

    if (!adminUser) {
      return {
        hasAccess: false,
      };
    }

    return {
      hasAccess: true,
      email: adminUser.email,
      role: adminUser.role,
      permissions: adminUser.permissions,
    };
  },
});

/**
 * Get all feedback with filters
 */
export const getAllFeedback = query({
  args: {
    filters: v.optional(
      v.object({
        startDate: v.optional(v.number()),
        endDate: v.optional(v.number()),
        feedbackType: v.optional(v.union(v.literal("useful"), v.literal("not_useful"))),
        detectorName: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Check admin access
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    const adminUser = await ctx.db
      .query("adminUsers")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();

    if (!adminUser) {
      throw new Error("Access denied: Not an admin");
    }

    // Fetch feedback
    let feedbackQuery = ctx.db.query("proactiveFeedbackLabels");

    // Apply filters
    if (args.filters?.feedbackType) {
      feedbackQuery = feedbackQuery.filter((q) =>
        q.eq(q.field("feedbackType"), args.filters!.feedbackType)
      );
    }

    if (args.filters?.detectorName) {
      feedbackQuery = feedbackQuery.filter((q) =>
        q.eq(q.field("contextSnapshot.detectorName"), args.filters!.detectorName)
      );
    }

    let feedback = await feedbackQuery.collect();

    // Filter by date range
    if (args.filters?.startDate || args.filters?.endDate) {
      feedback = feedback.filter((f) => {
        if (args.filters!.startDate && f.createdAt < args.filters!.startDate) {
          return false;
        }
        if (args.filters!.endDate && f.createdAt > args.filters!.endDate) {
          return false;
        }
        return true;
      });
    }

    // Calculate stats
    const stats = calculateStats(feedback, args.filters);

    return {
      feedback,
      stats,
    };
  },
});

/**
 * Get feedback analytics for a specific detector
 */
export const getDetectorFeedback = query({
  args: {
    detectorName: v.string(),
    timeRange: v.optional(v.union(v.literal("7d"), v.literal("30d"), v.literal("90d"))),
  },
  handler: async (ctx, args) => {
    // Check admin access (same as above)
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    const adminUser = await ctx.db
      .query("adminUsers")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();

    if (!adminUser) {
      throw new Error("Access denied: Not an admin");
    }

    // Calculate time range
    const now = Date.now();
    const timeRangeMs = args.timeRange === "7d" ? 7 * 24 * 60 * 60 * 1000
      : args.timeRange === "30d" ? 30 * 24 * 60 * 60 * 1000
      : 90 * 24 * 60 * 60 * 1000;
    const startDate = now - timeRangeMs;

    // Get feedback for detector
    const feedback = await ctx.db
      .query("proactiveFeedbackLabels")
      .withIndex("by_detector", (q) => q.eq("detectorName", args.detectorName))
      .filter((q) => q.gte(q.field("createdAt"), startDate))
      .collect();

    const stats = {
      total: feedback.length,
      useful: feedback.filter((f) => f.feedbackType === "useful").length,
      notUseful: feedback.filter((f) => f.feedbackType === "not_useful").length,
      usefulRate: 0,
    };

    stats.usefulRate = stats.total > 0 ? (stats.useful / stats.total) * 100 : 0;

    return {
      detectorName: args.detectorName,
      stats,
      feedback,
    };
  },
});

// Helper function to calculate stats
function calculateStats(feedback: any[], filters?: any) {
  const total = feedback.length;
  const useful = feedback.filter((f) => f.feedbackType === "useful").length;
  const notUseful = feedback.filter((f) => f.feedbackType === "not_useful").length;

  // Group by detector
  const byDetector: Record<string, any> = {};
  feedback.forEach((f) => {
    const detectorName = f.contextSnapshot?.detectorName || "unknown";
    if (!byDetector[detectorName]) {
      byDetector[detectorName] = {
        detectorName,
        total: 0,
        useful: 0,
        notUseful: 0,
        usefulRate: 0,
      };
    }
    byDetector[detectorName].total++;
    if (f.feedbackType === "useful") {
      byDetector[detectorName].useful++;
    } else if (f.feedbackType === "not_useful") {
      byDetector[detectorName].notUseful++;
    }
  });

  // Calculate useful rates
  Object.values(byDetector).forEach((detector: any) => {
    detector.usefulRate = detector.total > 0 ? (detector.useful / detector.total) * 100 : 0;
  });

  // Get top complaints (most common negative feedback reasons)
  const complaints: Record<string, number> = {};
  feedback
    .filter((f) => f.feedbackType === "not_useful" && f.reason)
    .forEach((f) => {
      const reason = f.reason!;
      complaints[reason] = (complaints[reason] || 0) + 1;
    });

  const topComplaints = Object.entries(complaints)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Calculate trending (compare to previous period)
  // For now, just return empty trending data
  const trending: any[] = [];

  return {
    total,
    useful,
    notUseful,
    usefulRate: total > 0 ? (useful / total) * 100 : 0,
    byDetector: Object.values(byDetector),
    topComplaints,
    trending,
  };
}
