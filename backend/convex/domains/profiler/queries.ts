/**
 * Convex queries for the Founder Operating Profiler.
 *
 * Read paths for the Dashboard > Profiler tab and the
 * /api/search/insights endpoint.
 */

import { query } from "../../_generated/server";
import { v } from "convex/values";

/** Get aggregate profiler insights for the last N days. */
export const getInsights = query({
  args: {
    daysBack: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const daysBack = args.daysBack ?? 7;
    const since = Date.now() - daysBack * 86400000;

    const events = await ctx.db
      .query("profilerEvents")
      .filter((q) => q.gte(q.field("timestamp"), since))
      .collect();

    const sessions = await ctx.db
      .query("profilerSessionSummaries")
      .filter((q) => q.gte(q.field("timestamp"), since))
      .collect();

    // Aggregate tool stats
    const toolStats = new Map<string, { count: number; totalLatency: number; totalCost: number }>();
    for (const e of events) {
      const s = toolStats.get(e.toolName) ?? { count: 0, totalLatency: 0, totalCost: 0 };
      s.count++;
      s.totalLatency += e.latencyMs;
      s.totalCost += e.estimatedCostUsd;
      toolStats.set(e.toolName, s);
    }

    const topTools = Array.from(toolStats.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 15)
      .map(([tool, stats]) => ({
        tool,
        count: stats.count,
        avgLatencyMs: Math.round(stats.totalLatency / stats.count),
        totalCost: Math.round(stats.totalCost * 10000) / 10000,
      }));

    // Find repeated queries
    const queryMap = new Map<string, number>();
    for (const e of events) {
      if (e.query) {
        const normalized = e.query.toLowerCase().trim();
        queryMap.set(normalized, (queryMap.get(normalized) ?? 0) + 1);
      }
    }
    const repeatedQueries = Array.from(queryMap.entries())
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([q, count]) => ({ query: q, count }));

    const totalCost = events.reduce((s, e) => s + e.estimatedCostUsd, 0);
    const redundantCount = events.filter((e) => e.isDuplicate).length;

    return {
      success: true,
      totalSessions: sessions.length,
      totalQueries: new Set(events.map((e) => e.query).filter(Boolean)).size,
      totalToolCalls: events.length,
      totalCostUsd: Math.round(totalCost * 1000) / 1000,
      redundantCallRate: events.length > 0 ? Math.round((redundantCount / events.length) * 100) : 0,
      topTools,
      repeatedQueries,
      reuseRate: 0, // TODO: context reuse tracking
    };
  },
});
