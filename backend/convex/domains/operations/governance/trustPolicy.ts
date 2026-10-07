/**
 * Trust Policy — Agent trust scoring and policy enforcement.
 * Uses agentIdentities table for trust tier tracking.
 * Provides queries + mutations for governance decisions.
 */

import { query, internalQuery, internalMutation } from "../../../_generated/server";
import { v } from "convex/values";

// ═══════════════════════════════════════════════════════════════════════════
// TRUST TIER CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const TRUST_TIER_SCORES: Record<string, number> = {
  verified: 1.0,
  established: 0.75,
  new: 0.5,
  quarantined: 0.1,
  banned: 0.0,
};

const ACTION_MIN_TRUST: Record<string, number> = {
  post_to_linkedin: 0.75,
  send_email: 0.75,
  delete_data: 0.9,
  modify_schema: 0.9,
  run_workflow: 0.5,
  read_data: 0.1,
  generate_content: 0.3,
};

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check whether an agent is allowed to perform a specific action.
 */
export const checkPolicy = internalQuery({
  args: {
    agentId: v.string(),
    action: v.string(),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.string(),
    trustScore: v.number(),
    trustTier: v.string(),
  }),
  handler: async (ctx, { agentId, action }) => {
    const identity = await ctx.db
      .query("agentIdentities")
      .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
      .first();

    if (!identity) {
      return {
        allowed: false,
        reason: `Agent ${agentId} not found in identity registry`,
        trustScore: 0,
        trustTier: "unknown",
      };
    }

    if (identity.status !== "active") {
      return {
        allowed: false,
        reason: `Agent ${identity.name} is ${identity.status}`,
        trustScore: 0,
        trustTier: identity.authorTrustTier ?? "unknown",
      };
    }

    const tier = identity.authorTrustTier ?? "new";
    const trustScore = TRUST_TIER_SCORES[tier] ?? 0.5;
    const requiredTrust = ACTION_MIN_TRUST[action] ?? 0.5;

    if (tier === "quarantined" || tier === "banned") {
      return {
        allowed: false,
        reason: `Agent ${identity.name} is ${tier}`,
        trustScore,
        trustTier: tier,
      };
    }

    if (trustScore < requiredTrust) {
      return {
        allowed: false,
        reason: `Action "${action}" requires trust >= ${requiredTrust}, agent has ${trustScore} (${tier})`,
        trustScore,
        trustTier: tier,
      };
    }

    return {
      allowed: true,
      reason: `Trust ${trustScore} >= ${requiredTrust} required for "${action}"`,
      trustScore,
      trustTier: tier,
    };
  },
});

/**
 * Get agent trust profile with budget and constraint info.
 */
export const getAgentTrustProfile = query({
  args: {
    agentId: v.string(),
  },
  returns: v.union(
    v.object({
      agentId: v.string(),
      name: v.string(),
      persona: v.string(),
      trustTier: v.string(),
      trustScore: v.number(),
      status: v.string(),
      allowedTools: v.array(v.string()),
      allowedChannels: v.array(v.string()),
      budgetDailyTokens: v.union(v.number(), v.null()),
      budgetDailyCostUsd: v.union(v.number(), v.null()),
      maxConcurrentRuns: v.union(v.number(), v.null()),
    }),
    v.null()
  ),
  handler: async (ctx, { agentId }) => {
    const identity = await ctx.db
      .query("agentIdentities")
      .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
      .first();

    if (!identity) return null;

    const tier = identity.authorTrustTier ?? "new";
    return {
      agentId: identity.agentId,
      name: identity.name,
      persona: identity.persona,
      trustTier: tier,
      trustScore: TRUST_TIER_SCORES[tier] ?? 0.5,
      status: identity.status,
      allowedTools: identity.allowedTools,
      allowedChannels: identity.allowedChannels,
      budgetDailyTokens: identity.budgetDailyTokens ?? null,
      budgetDailyCostUsd: identity.budgetDailyCostUsd ?? null,
      maxConcurrentRuns: identity.maxConcurrentRuns ?? null,
    };
  },
});

/**
 * List all active agents with their trust profiles.
 */
export const listActiveAgents = query({
  args: {},
  returns: v.array(
    v.object({
      agentId: v.string(),
      name: v.string(),
      trustTier: v.string(),
      trustScore: v.number(),
      status: v.string(),
    })
  ),
  handler: async (ctx) => {
    const agents = await ctx.db
      .query("agentIdentities")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    return agents.map((a) => {
      const tier = a.authorTrustTier ?? "new";
      return {
        agentId: a.agentId,
        name: a.name,
        trustTier: tier,
        trustScore: TRUST_TIER_SCORES[tier] ?? 0.5,
        status: a.status,
      };
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update an agent's trust tier.
 */
export const updateTrustTier = internalMutation({
  args: {
    agentId: v.string(),
    newTier: v.union(
      v.literal("verified"),
      v.literal("established"),
      v.literal("new"),
      v.literal("quarantined"),
      v.literal("banned")
    ),
    reason: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { agentId, newTier, reason }) => {
    const identity = await ctx.db
      .query("agentIdentities")
      .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
      .first();

    if (!identity) return false;

    await ctx.db.patch(identity._id, {
      authorTrustTier: newTier,
      updatedAt: Date.now(),
    });

    // If quarantined or banned, also pause the agent
    if (newTier === "quarantined" || newTier === "banned") {
      await ctx.db.patch(identity._id, {
        status: "paused",
      });
    }

    return true;
  },
});

/**
 * Check if an agent has exceeded its daily budget.
 */
export const checkBudget = internalQuery({
  args: {
    agentId: v.string(),
  },
  returns: v.object({
    withinBudget: v.boolean(),
    tokensUsedToday: v.number(),
    costUsedToday: v.number(),
    tokenBudget: v.union(v.number(), v.null()),
    costBudget: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, { agentId }) => {
    const identity = await ctx.db
      .query("agentIdentities")
      .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
      .first();

    if (!identity) {
      return {
        withinBudget: false,
        tokensUsedToday: 0,
        costUsedToday: 0,
        tokenBudget: null,
        costBudget: null,
      };
    }

    // Get today's heartbeats to sum usage
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    const heartbeats = await ctx.db
      .query("agentHeartbeats")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId).gte("startedAt", todayMs))
      .collect();

    const tokensUsedToday = heartbeats.reduce(
      (sum, h) => sum + (h.tokensBurned ?? 0),
      0
    );
    const costUsedToday = heartbeats.reduce(
      (sum, h) => sum + (h.costUsd ?? 0),
      0
    );

    const tokenBudget = identity.budgetDailyTokens ?? null;
    const costBudget = identity.budgetDailyCostUsd ?? null;

    const withinBudget =
      (tokenBudget === null || tokensUsedToday < tokenBudget) &&
      (costBudget === null || costUsedToday < costBudget);

    return {
      withinBudget,
      tokensUsedToday,
      costUsedToday,
      tokenBudget,
      costBudget,
    };
  },
});
