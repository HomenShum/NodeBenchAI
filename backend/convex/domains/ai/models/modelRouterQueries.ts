/**
 * Model Router — Queries & Mutations
 *
 * Budget checks, audit logging, and usage stats for the Model Router.
 * Separated from modelRouter.ts because these are queries/mutations
 * and cannot live in a "use node" file.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "../../../_generated/server";

// ═══════════════════════════════════════════════════════════════════════════
// BUDGET CHECK
// ═══════════════════════════════════════════════════════════════════════════

export const checkAgentBudget = internalQuery({
  args: { agentId: v.string() },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.string(),
    dailyCostUsd: v.number(),
    dailyTokens: v.number(),
    budgetLimitUsd: v.number(),
    budgetLimitTokens: v.number(),
  }),
  handler: async (ctx, { agentId }) => {
    // Get agent identity for budget limits
    const identity = await ctx.db
      .query("agentIdentities")
      .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
      .first();

    const budgetLimitUsd = identity?.budgetDailyCostUsd ?? 1.0;
    const budgetLimitTokens = identity?.budgetDailyTokens ?? 500_000;

    // Sum today's usage from router call log
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todaysCalls = await ctx.db
      .query("modelRouterCalls")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .filter((q) => q.gte(q.field("calledAt"), todayStart.getTime()))
      .collect();

    let dailyCostUsd = 0;
    let dailyTokens = 0;
    for (const call of todaysCalls) {
      dailyCostUsd += call.costUsd;
      dailyTokens += call.inputTokens + call.outputTokens;
    }

    if (dailyCostUsd >= budgetLimitUsd) {
      return {
        allowed: false,
        reason: `Daily cost $${dailyCostUsd.toFixed(4)} >= limit $${budgetLimitUsd.toFixed(2)}`,
        dailyCostUsd,
        dailyTokens,
        budgetLimitUsd,
        budgetLimitTokens,
      };
    }

    if (dailyTokens >= budgetLimitTokens) {
      return {
        allowed: false,
        reason: `Daily tokens ${dailyTokens} >= limit ${budgetLimitTokens}`,
        dailyCostUsd,
        dailyTokens,
        budgetLimitUsd,
        budgetLimitTokens,
      };
    }

    return {
      allowed: true,
      reason: `Budget OK: $${dailyCostUsd.toFixed(4)}/$${budgetLimitUsd.toFixed(2)}, ${dailyTokens}/${budgetLimitTokens} tokens`,
      dailyCostUsd,
      dailyTokens,
      budgetLimitUsd,
      budgetLimitTokens,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT LOG
// ═══════════════════════════════════════════════════════════════════════════

export const logRouterCall = internalMutation({
  args: {
    modelId: v.string(),
    taskCategory: v.string(),
    requestedTier: v.string(),
    actualTier: v.string(),
    agentId: v.optional(v.string()),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    latencyMs: v.number(),
    fallbacksUsed: v.number(),
    fromCache: v.boolean(),
    pinnedModel: v.union(v.string(), v.null()),
    success: v.boolean(),
    errorMessage: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("modelRouterCalls", {
      ...args,
      calledAt: Date.now(),
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// USAGE DASHBOARD QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/** Get routing stats for a time window */
export const getRoutingStats = internalQuery({
  args: {
    sinceMs: v.optional(v.number()),
    agentId: v.optional(v.string()),
  },
  returns: v.object({
    totalCalls: v.number(),
    totalCost: v.number(),
    totalInputTokens: v.number(),
    totalOutputTokens: v.number(),
    cacheHitRate: v.number(),
    avgLatencyMs: v.number(),
    freeModelRate: v.number(),
    errorRate: v.number(),
    byTier: v.any(),
    byTask: v.any(),
    byModel: v.any(),
  }),
  handler: async (ctx, args) => {
    const since = args.sinceMs ?? Date.now() - 24 * 60 * 60 * 1000;

    let query = ctx.db.query("modelRouterCalls");
    if (args.agentId) {
      query = query.withIndex("by_agent", (q) =>
        q.eq("agentId", args.agentId!)
      );
    }

    const calls = await query
      .filter((q) => q.gte(q.field("calledAt"), since))
      .collect();

    if (calls.length === 0) {
      return {
        totalCalls: 0,
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheHitRate: 0,
        avgLatencyMs: 0,
        freeModelRate: 0,
        errorRate: 0,
        byTier: {},
        byTask: {},
        byModel: {},
      };
    }

    const totalCost = calls.reduce((s, c) => s + c.costUsd, 0);
    const totalInputTokens = calls.reduce((s, c) => s + c.inputTokens, 0);
    const totalOutputTokens = calls.reduce((s, c) => s + c.outputTokens, 0);
    const cacheHits = calls.filter((c) => c.fromCache).length;
    const freeCalls = calls.filter((c) => c.costUsd === 0).length;
    const errors = calls.filter((c) => !c.success).length;
    const avgLatency =
      calls.reduce((s, c) => s + c.latencyMs, 0) / calls.length;

    // Group by tier
    const byTier: Record<string, number> = {};
    for (const c of calls) {
      byTier[c.actualTier] = (byTier[c.actualTier] ?? 0) + 1;
    }

    // Group by task
    const byTask: Record<string, number> = {};
    for (const c of calls) {
      byTask[c.taskCategory] = (byTask[c.taskCategory] ?? 0) + 1;
    }

    // Group by model
    const byModel: Record<string, number> = {};
    for (const c of calls) {
      byModel[c.modelId] = (byModel[c.modelId] ?? 0) + 1;
    }

    return {
      totalCalls: calls.length,
      totalCost,
      totalInputTokens,
      totalOutputTokens,
      cacheHitRate: cacheHits / calls.length,
      avgLatencyMs: Math.round(avgLatency),
      freeModelRate: freeCalls / calls.length,
      errorRate: errors / calls.length,
      byTier,
      byTask,
      byModel,
    };
  },
});
