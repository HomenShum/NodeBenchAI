/**
 * Mission Cost Queries — aggregated cost and token usage per mission
 *
 * Provides rollup views for the Cost/Usage Dashboard:
 * - Per-mission cost breakdown by model
 * - Recent mission cost summaries
 * - Daily cost trend for sparklines
 *
 * All queries are BOUNDED — no unbounded .collect() calls.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";

// ---------------------------------------------------------------------------
// getMissionCostRollup — per-mission cost + token aggregation
// ---------------------------------------------------------------------------

export const getMissionCostRollup = query({
  args: { missionId: v.id("missions") },
  handler: async (ctx, { missionId }) => {
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_mission_created", (q) => q.eq("missionId", missionId))
      .take(500);

    let totalCostUsd = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    const modelMap = new Map<
      string,
      { costUsd: number; tokens: number; count: number }
    >();

    for (const step of steps) {
      const cost = step.costUsd ?? 0;
      const input = step.inputTokens ?? 0;
      const output = step.outputTokens ?? 0;

      totalCostUsd += cost;
      totalInputTokens += input;
      totalOutputTokens += output;

      const model = step.modelUsed ?? "unknown";
      const existing = modelMap.get(model);
      if (existing) {
        existing.costUsd += cost;
        existing.tokens += input + output;
        existing.count += 1;
      } else {
        modelMap.set(model, {
          costUsd: cost,
          tokens: input + output,
          count: 1,
        });
      }
    }

    const modelBreakdown = Array.from(modelMap.entries()).map(
      ([model, data]) => ({
        model,
        costUsd: data.costUsd,
        tokens: data.tokens,
        count: data.count,
      }),
    );

    return {
      totalCostUsd,
      totalInputTokens,
      totalOutputTokens,
      stepCount: steps.length,
      modelBreakdown,
    };
  },
});

// ---------------------------------------------------------------------------
// getRecentMissionCosts — dashboard list of recent missions with cost summary
// ---------------------------------------------------------------------------

const MAX_RECENT_LIMIT = 50;
const DEFAULT_RECENT_LIMIT = 20;
const DEFAULT_TIME_RANGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const getRecentMissionCosts = query({
  args: {
    limit: v.optional(v.number()),
    timeRangeMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? DEFAULT_RECENT_LIMIT, MAX_RECENT_LIMIT);
    const timeRangeMs = args.timeRangeMs ?? DEFAULT_TIME_RANGE_MS;
    const cutoff = Date.now() - timeRangeMs;

    // Fetch recent missions ordered by creation time descending
    const missions = await ctx.db
      .query("missions")
      .withIndex("by_status_updated")
      .order("desc")
      .take(limit * 3); // over-fetch to filter by time

    const recentMissions = missions
      .filter((m) => m.createdAt >= cutoff)
      .slice(0, limit);

    const results: Array<{
      missionId: typeof recentMissions[number]["_id"];
      title: string;
      missionType: string;
      totalCostUsd: number;
      totalTokens: number;
      stepCount: number;
      createdAt: number;
    }> = [];
    for (const mission of recentMissions) {
      const steps = await ctx.db
        .query("runSteps")
        .withIndex("by_mission_created", (q) =>
          q.eq("missionId", mission._id),
        )
        .take(500);

      let totalCostUsd = 0;
      let totalTokens = 0;
      for (const step of steps) {
        totalCostUsd += step.costUsd ?? 0;
        totalTokens += (step.inputTokens ?? 0) + (step.outputTokens ?? 0);
      }

      results.push({
        missionId: mission._id,
        title: mission.title,
        missionType: mission.missionType,
        totalCostUsd,
        totalTokens,
        stepCount: steps.length,
        createdAt: mission.createdAt,
      });
    }

    return results;
  },
});

// ---------------------------------------------------------------------------
// getCostTrend — daily cost data points for sparkline rendering
// ---------------------------------------------------------------------------

const DEFAULT_TREND_DAYS = 30;
const MAX_TREND_STEPS = 5000;

export const getCostTrend = query({
  args: {
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const days = args.days ?? DEFAULT_TREND_DAYS;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    // Scan runSteps created after cutoff, bounded
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_mission_created")
      .order("desc")
      .take(MAX_TREND_STEPS);

    // Group by day
    const dayMap = new Map<string, { costUsd: number; tokens: number }>();

    for (const step of steps) {
      if (step.createdAt < cutoff) continue;

      const date = new Date(step.createdAt);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

      const existing = dayMap.get(key);
      const cost = step.costUsd ?? 0;
      const tokens = (step.inputTokens ?? 0) + (step.outputTokens ?? 0);

      if (existing) {
        existing.costUsd += cost;
        existing.tokens += tokens;
      } else {
        dayMap.set(key, { costUsd: cost, tokens });
      }
    }

    // Sort by date ascending
    return Array.from(dayMap.entries())
      .map(([date, data]) => ({
        date,
        costUsd: data.costUsd,
        tokens: data.tokens,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  },
});
