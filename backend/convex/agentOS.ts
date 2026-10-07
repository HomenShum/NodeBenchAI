/**
 * Agent OS — Perpetual Multi-Agent Runtime mutations & queries.
 * CRUD for agentIdentities, agentChannels, agentHeartbeats.
 * These are the foundation tables for "agents as employees" pattern.
 */

import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// ═══════════════════════════════════════════════════════════════════════════
// AGENT IDENTITIES
// ═══════════════════════════════════════════════════════════════════════════

export const registerAgent = mutation({
  args: {
    agentId: v.string(),
    name: v.string(),
    persona: v.string(),
    allowedTools: v.array(v.string()),
    allowedChannels: v.array(v.string()),
    heartbeatIntervalMs: v.optional(v.number()),
    budgetDailyTokens: v.optional(v.number()),
    budgetDailyCostUsd: v.optional(v.number()),
    maxConcurrentRuns: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Check for existing agent with same agentId
    const existing = await ctx.db
      .query("agentIdentities")
      .withIndex("by_agentId", (q) => q.eq("agentId", args.agentId))
      .first();

    if (existing) {
      // Update existing agent (UPSERT pattern)
      await ctx.db.patch(existing._id, {
        name: args.name,
        persona: args.persona,
        allowedTools: args.allowedTools,
        allowedChannels: args.allowedChannels,
        heartbeatIntervalMs: args.heartbeatIntervalMs,
        budgetDailyTokens: args.budgetDailyTokens,
        budgetDailyCostUsd: args.budgetDailyCostUsd,
        maxConcurrentRuns: args.maxConcurrentRuns,
        updatedAt: Date.now(),
      });
      return { agentId: args.agentId, action: "updated", _id: existing._id };
    }

    const now = Date.now();
    const id = await ctx.db.insert("agentIdentities", {
      agentId: args.agentId,
      name: args.name,
      persona: args.persona,
      allowedTools: args.allowedTools,
      allowedChannels: args.allowedChannels,
      heartbeatIntervalMs: args.heartbeatIntervalMs,
      budgetDailyTokens: args.budgetDailyTokens,
      budgetDailyCostUsd: args.budgetDailyCostUsd,
      maxConcurrentRuns: args.maxConcurrentRuns,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    // Sync authorTrust entry so governance checks apply to this agent
    const existingTrust = await ctx.db
      .query("authorTrust")
      .withIndex("by_author", (q) =>
        q.eq("authorType", "agent").eq("authorId", args.agentId)
      )
      .first();
    if (!existingTrust) {
      await ctx.db.insert("authorTrust", {
        authorType: "agent",
        authorId: args.agentId,
        tier: "new",
        trustScore: 0,
        totalContributions: 0,
        verifiedContributions: 0,
        flaggedContributions: 0,
        lastActivityAt: now,
        tierChangedAt: now,
        tierChangedBy: "system:registerAgent",
      });
    }

    return { agentId: args.agentId, action: "created", _id: id };
  },
});

export const updateAgentStatus = mutation({
  args: {
    agentId: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("retired")
    ),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("agentIdentities")
      .withIndex("by_agentId", (q) => q.eq("agentId", args.agentId))
      .first();
    if (!agent) throw new Error(`Agent not found: ${args.agentId}`);
    await ctx.db.patch(agent._id, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return { agentId: args.agentId, status: args.status };
  },
});

export const listAgents = query({
  args: {
    status: v.optional(v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("retired")
    )),
  },
  handler: async (ctx, args) => {
    if (args.status) {
      return await ctx.db
        .query("agentIdentities")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    }
    return await ctx.db.query("agentIdentities").collect();
  },
});

export const getAgent = query({
  args: { agentId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentIdentities")
      .withIndex("by_agentId", (q) => q.eq("agentId", args.agentId))
      .first();
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// AGENT CHANNELS
// ═══════════════════════════════════════════════════════════════════════════

export const createChannel = mutation({
  args: {
    channelId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    memberAgentIds: v.array(v.string()),
    memberUserIds: v.array(v.string()),
    channelType: v.union(
      v.literal("team"),
      v.literal("broadcast"),
      v.literal("alert")
    ),
    rankingWeights: v.optional(v.object({
      recency: v.optional(v.number()),
      evidenceCoverage: v.optional(v.number()),
      novelty: v.optional(v.number()),
      authorTrust: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentChannels")
      .withIndex("by_channelId", (q) => q.eq("channelId", args.channelId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: Date.now() });
      return { channelId: args.channelId, action: "updated" };
    }

    await ctx.db.insert("agentChannels", {
      ...args,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { channelId: args.channelId, action: "created" };
  },
});

export const listChannels = query({
  args: {
    channelType: v.optional(v.union(
      v.literal("team"),
      v.literal("broadcast"),
      v.literal("alert")
    )),
  },
  handler: async (ctx, args) => {
    if (args.channelType) {
      return await ctx.db
        .query("agentChannels")
        .withIndex("by_type", (q) => q.eq("channelType", args.channelType!))
        .collect();
    }
    return await ctx.db.query("agentChannels").collect();
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// AGENT HEARTBEATS
// ═══════════════════════════════════════════════════════════════════════════

export const recordHeartbeat = internalMutation({
  args: {
    agentId: v.string(),
    triggeredBy: v.union(
      v.literal("schedule"),
      v.literal("event"),
      v.literal("manual"),
      v.literal("sweep")
    ),
    triggerEventId: v.optional(v.string()),
    triggerOpportunityId: v.optional(v.string()),
    status: v.union(
      v.literal("started"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped")
    ),
    workQueueItemsProcessed: v.optional(v.number()),
    postsCreated: v.optional(v.number()),
    gapsIdentified: v.optional(v.number()),
    tokensBurned: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    agentRunId: v.optional(v.id("agentRuns")),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Rate limiting: enforce heartbeatIntervalMs if configured
    const agent = await ctx.db
      .query("agentIdentities")
      .withIndex("by_agentId", (q) => q.eq("agentId", args.agentId))
      .first();

    if (agent?.heartbeatIntervalMs) {
      const lastHeartbeat = await ctx.db
        .query("agentHeartbeats")
        .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
        .order("desc")
        .first();

      if (lastHeartbeat && now - lastHeartbeat.startedAt < agent.heartbeatIntervalMs) {
        const id = await ctx.db.insert("agentHeartbeats", {
          agentId: args.agentId,
          triggeredBy: args.triggeredBy,
          triggerEventId: args.triggerEventId,
          triggerOpportunityId: args.triggerOpportunityId,
          status: "skipped",
          errorMessage: `Rate limited: ${now - lastHeartbeat.startedAt}ms since last heartbeat (min: ${agent.heartbeatIntervalMs}ms)`,
          startedAt: now,
          completedAt: now,
          durationMs: 0,
        });
        return { heartbeatId: id, agentId: args.agentId, status: "skipped", rateLimited: true };
      }
    }

    const id = await ctx.db.insert("agentHeartbeats", {
      agentId: args.agentId,
      triggeredBy: args.triggeredBy,
      triggerEventId: args.triggerEventId,
      triggerOpportunityId: args.triggerOpportunityId,
      status: args.status,
      workQueueItemsProcessed: args.workQueueItemsProcessed,
      postsCreated: args.postsCreated,
      gapsIdentified: args.gapsIdentified,
      tokensBurned: args.tokensBurned,
      costUsd: args.costUsd,
      errorMessage: args.errorMessage,
      agentRunId: args.agentRunId,
      startedAt: now,
      completedAt: args.status === "completed" || args.status === "failed" ? now : undefined,
      durationMs: args.durationMs,
    });
    return { heartbeatId: id, agentId: args.agentId, status: args.status };
  },
});

/**
 * Complete a started heartbeat with results.
 * Called by agentLoop after work cycle finishes (success or failure).
 */
export const completeHeartbeat = internalMutation({
  args: {
    heartbeatId: v.id("agentHeartbeats"),
    status: v.union(v.literal("completed"), v.literal("failed")),
    workQueueItemsProcessed: v.optional(v.number()),
    postsCreated: v.optional(v.number()),
    gapsIdentified: v.optional(v.number()),
    tokensBurned: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const heartbeat = await ctx.db.get(args.heartbeatId);
    if (!heartbeat) throw new Error(`Heartbeat not found: ${args.heartbeatId}`);

    const now = Date.now();
    await ctx.db.patch(args.heartbeatId, {
      status: args.status,
      workQueueItemsProcessed: args.workQueueItemsProcessed,
      postsCreated: args.postsCreated,
      gapsIdentified: args.gapsIdentified,
      tokensBurned: args.tokensBurned,
      costUsd: args.costUsd,
      errorMessage: args.errorMessage,
      completedAt: now,
      durationMs: now - heartbeat.startedAt,
    });

    return {
      heartbeatId: args.heartbeatId,
      status: args.status,
      durationMs: now - heartbeat.startedAt,
    };
  },
});

export const getAgentHeartbeats = query({
  args: {
    agentId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    return await ctx.db
      .query("agentHeartbeats")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .order("desc")
      .take(limit);
  },
});

export const getAgentStats = query({
  args: { agentId: v.string() },
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("agentIdentities")
      .withIndex("by_agentId", (q) => q.eq("agentId", args.agentId))
      .first();
    if (!agent) return null;

    // Get recent heartbeats (last 24h)
    const dayAgo = Date.now() - 86400000;
    const recentHeartbeats = await ctx.db
      .query("agentHeartbeats")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId).gte("startedAt", dayAgo))
      .collect();

    const completed = recentHeartbeats.filter((h) => h.status === "completed");
    const failed = recentHeartbeats.filter((h) => h.status === "failed");
    const totalTokens = completed.reduce((s, h) => s + (h.tokensBurned ?? 0), 0);
    const totalCost = completed.reduce((s, h) => s + (h.costUsd ?? 0), 0);
    const totalPosts = completed.reduce((s, h) => s + (h.postsCreated ?? 0), 0);

    return {
      agent,
      last24h: {
        heartbeats: recentHeartbeats.length,
        completed: completed.length,
        failed: failed.length,
        tokensBurned: totalTokens,
        costUsd: totalCost,
        postsCreated: totalPosts,
        budgetRemaining: agent.budgetDailyTokens
          ? agent.budgetDailyTokens - totalTokens
          : null,
      },
    };
  },
});
