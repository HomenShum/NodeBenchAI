// convex/apiUsageTracking.ts
// API Usage tracking utilities

import { mutation, query } from "../../../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id, Doc } from "../../../_generated/dataModel";

/**
 * Track an API call
 */
export const trackApiUsage = mutation({
  args: {
    userId: v.optional(v.id("users")),
    apiName: v.string(),
    operation: v.string(),
    unitsUsed: v.optional(v.number()),
    estimatedCost: v.optional(v.number()),
    requestMetadata: v.optional(v.any()),
    success: v.boolean(),
    errorMessage: v.optional(v.string()),
    responseTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Use provided userId or get from auth
    const userId = args.userId || await getAuthUserId(ctx);
    if (!userId) return null;

    const timestamp = Date.now();

    // Insert usage record
    await ctx.db.insert("apiUsage", {
      userId,
      apiName: args.apiName,
      operation: args.operation,
      timestamp,
      unitsUsed: args.unitsUsed,
      estimatedCost: args.estimatedCost,
      requestMetadata: args.requestMetadata,
      success: args.success,
      errorMessage: args.errorMessage,
      responseTime: args.responseTime,
    });

    // Update daily aggregate
    const date = new Date(timestamp).toISOString().split('T')[0]; // YYYY-MM-DD
    
    const existing = await ctx.db
      .query("apiUsageDaily")
      .withIndex("by_user_api_date", (q) =>
        q.eq("userId", userId).eq("apiName", args.apiName).eq("date", date)
      )
      .first() as Doc<"apiUsageDaily"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        totalCalls: existing.totalCalls + 1,
        successfulCalls: existing.successfulCalls + (args.success ? 1 : 0),
        failedCalls: existing.failedCalls + (args.success ? 0 : 1),
        totalUnitsUsed: existing.totalUnitsUsed + (args.unitsUsed || 0),
        totalCost: existing.totalCost + (args.estimatedCost || 0),
      });
    } else {
      await ctx.db.insert("apiUsageDaily", {
        userId,
        apiName: args.apiName,
        date,
        totalCalls: 1,
        successfulCalls: args.success ? 1 : 0,
        failedCalls: args.success ? 0 : 1,
        totalUnitsUsed: args.unitsUsed || 0,
        totalCost: args.estimatedCost || 0,
      });
    }
  },
});

/**
 * Get usage summary for current user
 */
export const getUserApiUsageSummary = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    // Get all-time stats
    const allUsage = await ctx.db
      .query("apiUsage")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Get today's stats
    const today = new Date().toISOString().split('T')[0];
    const todayUsage = await ctx.db
      .query("apiUsageDaily")
      .withIndex("by_user_and_date", (q) => q.eq("userId", userId).eq("date", today))
      .collect();

    // Get this month's stats
    const thisMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
    const monthUsage = await ctx.db
      .query("apiUsageDaily")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    
    const thisMonthFiltered = monthUsage.filter(u => u.date.startsWith(thisMonth));

    // Group by API
    const byApi: Record<string, {
      totalCalls: number;
      successfulCalls: number;
      failedCalls: number;
      totalUnitsUsed: number;
      totalCost: number;
      todayCalls: number;
      monthCalls: number;
    }> = {};

    // Process all-time data
    for (const usage of allUsage) {
      if (!byApi[usage.apiName]) {
        byApi[usage.apiName] = {
          totalCalls: 0,
          successfulCalls: 0,
          failedCalls: 0,
          totalUnitsUsed: 0,
          totalCost: 0,
          todayCalls: 0,
          monthCalls: 0,
        };
      }
      byApi[usage.apiName].totalCalls++;
      if (usage.success) byApi[usage.apiName].successfulCalls++;
      else byApi[usage.apiName].failedCalls++;
      byApi[usage.apiName].totalUnitsUsed += usage.unitsUsed || 0;
      byApi[usage.apiName].totalCost += usage.estimatedCost || 0;
    }

    // Add today's data
    for (const usage of todayUsage) {
      if (byApi[usage.apiName]) {
        byApi[usage.apiName].todayCalls = usage.totalCalls;
      }
    }

    // Add month's data
    for (const usage of thisMonthFiltered) {
      if (byApi[usage.apiName]) {
        byApi[usage.apiName].monthCalls += usage.totalCalls;
      }
    }

    return {
      byApi,
      summary: {
        totalCalls: allUsage.length,
        successfulCalls: allUsage.filter(u => u.success).length,
        failedCalls: allUsage.filter(u => !u.success).length,
        todayTotalCalls: todayUsage.reduce((sum, u) => sum + u.totalCalls, 0),
        monthTotalCalls: thisMonthFiltered.reduce((sum, u) => sum + u.totalCalls, 0),
        totalCost: allUsage.reduce((sum, u) => sum + (u.estimatedCost || 0), 0),
      },
    };
  },
});

/**
 * Get detailed usage history for current user
 */
export const getUserApiUsageHistory = query({
  args: {
    apiName: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    let results;
    
    if (args.apiName && args.apiName.length > 0) {
      results = await ctx.db
        .query("apiUsage")
        .withIndex("by_user_and_api", (q) =>
          q.eq("userId", userId).eq("apiName", args.apiName)
        )
        .order("desc")
        .take(args.limit || 50);
    } else {
      results = await ctx.db
        .query("apiUsage")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .order("desc")
        .take(args.limit || 50);
    }

    return results;
  },
});

/**
 * Get daily usage chart data (last 30 days)
 */
export const getUserApiUsageChart = query({
  args: {
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const days = args.days || 30;
    const dateArray: string[] = [];
    
    // Generate last N days
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      dateArray.push(date.toISOString().split('T')[0]);
    }

    // Get all usage for these dates
    const usageRecords = await ctx.db
      .query("apiUsageDaily")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Group by date and API
    const chartData = dateArray.map(date => {
      const dayRecords = usageRecords.filter(r => r.date === date);
      const byApi: Record<string, number> = {};
      
      for (const record of dayRecords) {
        byApi[record.apiName] = (byApi[record.apiName] || 0) + record.totalCalls;
      }

      return {
        date,
        ...byApi,
        total: dayRecords.reduce((sum, r) => sum + r.totalCalls, 0),
      };
    });

    return chartData;
  },
});
