/**
 * Agent Marketplace - Ranked Agent Discovery with X Algorithm Patterns
 * Phase 4 Implementation
 *
 * Features:
 * - Multi-action prediction (run, fork, like, share)
 * - Success rate tracking
 * - Usage-based ranking
 * - Phoenix ML scoring
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "../../_generated/server";
import { internal } from "../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES & CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const MARKETPLACE_CONFIG = {
  rankingWeights: {
    successRate: 0.35,
    usageCount: 0.25,
    avgLatency: 0.20,
    engagement: 0.20,
  },
  refreshIntervalMs: 15 * 60 * 1000, // 15 minutes
  minUsageForRanking: 5,
} as const;

export interface AgentStats {
  agentType: string;
  usageCount: number;
  successCount: number;
  successRate: number;
  avgLatencyMs: number;
  multiActionPrediction: {
    run: number;
    fork: number;
    like: number;
    share: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// RANKING & DISCOVERY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate Phoenix score for an agent
 */
export const calculateAgentPhoenixScore = internalAction({
  args: {
    agentType: v.string(),
    stats: v.any(),
  },
  handler: async (ctx, { agentType, stats }): Promise<number> => {
    const {
      successRate,
      usageCount,
      avgLatencyMs,
    } = stats as AgentStats;

    // Normalize metrics to 0-100
    const successScore = successRate * 100;
    const usageScore = Math.min((usageCount / 100) * 100, 100);
    const latencyScore = Math.max(100 - (avgLatencyMs / 5000) * 100, 0);

    // Multi-action engagement (weighted average)
    const engagementScore =
      (stats.multiActionPrediction.run * 0.4 +
        stats.multiActionPrediction.fork * 0.3 +
        stats.multiActionPrediction.like * 0.2 +
        stats.multiActionPrediction.share * 0.1) *
      100;

    // Weighted phoenix score
    const phoenixScore =
      successScore * MARKETPLACE_CONFIG.rankingWeights.successRate +
      usageScore * MARKETPLACE_CONFIG.rankingWeights.usageCount +
      latencyScore * MARKETPLACE_CONFIG.rankingWeights.avgLatency +
      engagementScore * MARKETPLACE_CONFIG.rankingWeights.engagement;

    return Math.round(phoenixScore);
  },
});

/**
 * Update all agent rankings
 */
export const updateAgentRankings = internalAction({
  args: {},
  handler: async (ctx) => {
    // Get all autonomous model usage stats
    const usageStats = await ctx.runQuery(
      internal.domains.models.autonomousModelResolver.getAutonomousModelStats,
      { hours: 168 } // 7 days
    );

    const rankings: Array<{
      agentType: string;
      stats: AgentStats;
      phoenixScore: number;
    }> = [];

    // Calculate rankings for each task type (proxy for agent types)
    for (const [taskType, taskStats] of Object.entries(usageStats.byTaskType || {})) {
      // Type guard to ensure taskStats has the expected shape
      if (!taskStats || typeof taskStats !== 'object' || !('calls' in taskStats) || !('success' in taskStats)) continue;
      const typedStats = taskStats as { calls: number; success: number };

      if (typedStats.calls < MARKETPLACE_CONFIG.minUsageForRanking) continue;

      const stats: AgentStats = {
        agentType: taskType,
        usageCount: typedStats.calls,
        successCount: typedStats.success,
        successRate: typedStats.success / typedStats.calls,
        avgLatencyMs: 2000, // TODO: Get actual latency
        multiActionPrediction: {
          run: 0.8, // Placeholder - TODO: Calculate from actual engagement
          fork: 0.3,
          like: 0.5,
          share: 0.2,
        },
      };

      const phoenixScore = await ctx.runAction(
        internal.domains.agents.agentMarketplace.calculateAgentPhoenixScore,
        { agentType: taskType, stats }
      );

      rankings.push({ agentType: taskType, stats, phoenixScore });
    }

    // Sort by Phoenix score
    rankings.sort((a, b) => b.phoenixScore - a.phoenixScore);

    // Save to database
    for (const ranking of rankings) {
      await ctx.runMutation(internal.domains.agents.agentMarketplace.saveAgentRanking, {
        agentType: ranking.agentType,
        agentId: ranking.agentType, // TODO: Map to actual agent IDs
        stats: ranking.stats,
        phoenixScore: ranking.phoenixScore,
      });
    }

    return rankings;
  },
});

/**
 * Get ranked agents
 */
export const getRankedAgents = query({
  args: {
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { category, limit = 20 }) => {
    let query = ctx.db
      .query("agentRankings")
      .withIndex("by_agent_type");

    if (category) {
      query = query.filter((q) => q.eq(q.field("agentType"), category)) as any;
    }

    const rankings = await query.order("desc").take(limit);

    return rankings;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Save agent ranking
 */
export const saveAgentRanking = internalMutation({
  args: {
    agentType: v.string(),
    agentId: v.string(),
    stats: v.any(),
    phoenixScore: v.number(),
  },
  handler: async (ctx, { agentType, agentId, stats, phoenixScore }) => {
    // Update or insert ranking
    const existing = await ctx.db
      .query("agentRankings")
      .withIndex("by_agent_id", (q) => q.eq("agentId", agentId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        phoenixScore,
        usageCount: stats.usageCount,
        successRate: stats.successRate,
        avgLatencyMs: stats.avgLatencyMs,
        multiActionPrediction: stats.multiActionPrediction,
        lastRankedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("agentRankings", {
        agentType,
        agentId,
        phoenixScore,
        usageCount: stats.usageCount,
        successRate: stats.successRate,
        avgLatencyMs: stats.avgLatencyMs,
        multiActionPrediction: stats.multiActionPrediction,
        lastRankedAt: Date.now(),
      });
    }
  },
});
