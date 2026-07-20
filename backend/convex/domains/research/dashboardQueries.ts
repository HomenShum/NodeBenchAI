import { v } from "convex/values";
import { query, mutation, action, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import type { DashboardState } from "../../../src/features/research/types";

/**
 * Internal query to fetch feed items for metrics calculation
 * Used by the daily morning brief workflow
 *
 * Note: Uses a 7-day window to ensure sufficient data for metrics.
 * Feed items may not be refreshed daily, so a longer window provides
 * more accurate statistics.
 */
export const getFeedItemsForMetrics = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Use 7-day window to ensure we have data even if feeds aren't refreshed daily
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const items = await ctx.db
      .query("feedItems")
      .withIndex("by_score")
      .order("desc")
      .take(200);

    // Filter to last 7 days and return relevant fields
    const recentItems = items.filter((item: Doc<"feedItems">) => {
      if (!item.publishedAt) return false;
      const pubTime = new Date(item.publishedAt).getTime();
      return pubTime > sevenDaysAgo;
    });

    // If no recent items, return all items (fallback for demo/testing)
    const resultItems = recentItems.length > 0 ? recentItems : items;

    return resultItems.map((item: Doc<"feedItems">) => ({
      sourceId: item.sourceId,
      type: item.type,
      category: item.category,
      title: item.title,
      summary: item.summary,
      source: item.source,
      tags: item.tags,
      score: item.score,
      publishedAt: item.publishedAt,
      url: item.url,
    }));
  },
});

/**
 * Get the latest daily brief snapshot for the dashboard
 * Returns the most recent dashboard metrics or null if none exist
 */
export const getLatestDashboardSnapshot = query({
  args: {},
  handler: async (ctx): Promise<{
    dashboardMetrics: DashboardState;
    generatedAt: number;
    dateString: string;
    sourceSummary: any;
  } | null> => {
    // Get the most recent snapshot
    const snapshot = await ctx.db
      .query("dailyBriefSnapshots")
      .withIndex("by_generated_at")
      .order("desc")
      .first() as Doc<"dailyBriefSnapshots"> | null;

    if (!snapshot) {
      return null;
    }

    return {
      dashboardMetrics: snapshot.dashboardMetrics as DashboardState,
      generatedAt: snapshot.generatedAt,
      dateString: snapshot.dateString,
      sourceSummary: snapshot.sourceSummary,
    };
  },
});

/**
 * Get dashboard snapshot for a specific date
 */
export const getDashboardSnapshotByDate = query({
  args: {
    dateString: v.string(), // YYYY-MM-DD
  },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db
      .query("dailyBriefSnapshots")
      .withIndex("by_date_string", (q) => q.eq("dateString", args.dateString))
      .order("desc")
      .first() as Doc<"dailyBriefSnapshots"> | null;
    
    if (!snapshot) {
      return null;
    }
    
    return {
      dashboardMetrics: snapshot.dashboardMetrics as DashboardState,
      generatedAt: snapshot.generatedAt,
      dateString: snapshot.dateString,
      sourceSummary: snapshot.sourceSummary,
      version: snapshot.version,
    };
  },
});

/**
 * Manually trigger dashboard metrics refresh
 * Useful for testing or on-demand updates
 */
export const refreshDashboardMetrics = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    console.log("[dashboardQueries] Manually triggering dashboard metrics refresh...");
    
    const result: any = await ctx.runAction(
      internal.workflows.dailyMorningBrief.runDailyMorningBrief,
      {}
    );
    
    return result;
  },
});

/**
 * Get historical dashboard snapshots (last N days)
 */
export const getHistoricalSnapshots = query({
  args: {
    days: v.optional(v.number()), // Default: 7 days
  },
  handler: async (ctx, args) => {
    const days = args.days ?? 7;
    const cutoffDate = Date.now() - (days * 24 * 60 * 60 * 1000);
    
    const snapshots = await ctx.db
      .query("dailyBriefSnapshots")
      .withIndex("by_generated_at")
      .order("desc")
      .filter((q) => q.gte(q.field("generatedAt"), cutoffDate))
      .take(days);
    
    return snapshots.map((snapshot: Doc<"dailyBriefSnapshots">) => ({
      dateString: snapshot.dateString,
      generatedAt: snapshot.generatedAt,
      version: snapshot.version,
      sourceSummary: snapshot.sourceSummary,
      processingTimeMs: snapshot.processingTimeMs,
    }));
  },
});
