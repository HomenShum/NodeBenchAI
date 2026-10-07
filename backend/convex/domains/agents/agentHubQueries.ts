/**
 * agentHubQueries.ts
 *
 * Query functions for the Agents Hub UI.
 * Provides agent status, stats, and aggregated data for the dashboard.
 */

import { v } from "convex/values";
import { query as queryBase } from "../../_generated/server";
import type { Id, Doc } from "../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { HEALTH_CONFIG } from "../../config/autonomousConfig";

// Avoid TS2589 "excessively deep" instantiations in dashboard-only queries.
const query = queryBase as any;

const AUTONOMOUS_READ_ROLES = new Set(["viewer", "admin", "owner"]);

async function requireAutonomousReadAccess(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");

  const adminUser = await ctx.db
    .query("adminUsers")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .first();

  if (!adminUser || !AUTONOMOUS_READ_ROLES.has(String(adminUser.role))) {
    throw new Error("Access denied: autonomous operations are operator-only");
  }

  return adminUser;
}

/**
 * Get aggregated agent statistics
 */
export const getAgentStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        totalAgents: 6,
        activeNow: 0,
        tasksCompleted: 0,
        successRate: 0,
      };
    }

    // Get user's swarms
    const swarms = await ctx.db
      .query("agentSwarms")
      .withIndex("by_user", (q) => q.eq("userId", userId as Id<"users">))
      .collect();

    const completed = swarms.filter((s) => s.status === "completed").length;
    const failed = swarms.filter((s) => s.status === "failed").length;
    const total = completed + failed;
    const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    const activeSwarms = swarms.filter((s) =>
      ["pending", "spawning", "executing", "gathering", "synthesizing"].includes(s.status)
    );

    // Count unique active agents
    let activeAgentCount = 0;
    for (const swarm of activeSwarms) {
      const tasks = await ctx.db
        .query("swarmAgentTasks")
        .withIndex("by_swarm", (q) => q.eq("swarmId", swarm.swarmId))
        .filter((q) => q.eq(q.field("status"), "running"))
        .collect();
      activeAgentCount += tasks.length;
    }

    return {
      totalAgents: 6, // Fixed count of available agent types
      activeNow: activeAgentCount,
      tasksCompleted: completed,
      successRate,
    };
  },
});

/**
 * Get individual agent status by type
 */
export const getAgentStatusByType = query({
  args: {
    agentType: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { status: "idle", lastActivity: null, tasksCompleted: 0 };
    }

    // Map agent type to agent name used in swarm tasks
    const agentNameMap: Record<string, string> = {
      coordinator: "Coordinator",
      document: "DocumentAgent",
      media: "MediaAgent",
      sec: "SECAgent",
      openbb: "OpenBBAgent",
      arbitrage: "EntityResearchAgent",
    };

    const agentName = agentNameMap[args.agentType];
    if (!agentName) {
      return { status: "idle", lastActivity: null, tasksCompleted: 0 };
    }

    // Get recent tasks for this agent type
    const tasks = await ctx.db
      .query("swarmAgentTasks")
      .filter((q) => q.eq(q.field("agentName"), agentName))
      .order("desc")
      .take(100);

    // Filter to user's tasks by checking the swarm
    const userTasks: Doc<"swarmAgentTasks">[] = [];
    for (const task of tasks) {
      const swarm = await ctx.db
        .query("agentSwarms")
        .withIndex("by_swarm", (q) => q.eq("swarmId", task.swarmId))
        .first() as Doc<"agentSwarms"> | null;
      if (swarm && swarm.userId === userId) {
        userTasks.push(task);
      }
    }

    // Determine current status
    const runningTask = userTasks.find((t) => t.status === "running");
    const status = runningTask ? "running" : "idle";

    // Get last activity
    const lastTask = userTasks[0];
    const lastActivity = lastTask?.completedAt || lastTask?.createdAt || null;

    // Count completed tasks
    const completedCount = userTasks.filter((t) => t.status === "completed").length;

    return {
      status,
      lastActivity,
      tasksCompleted: completedCount,
      currentTask: runningTask?.query || null,
    };
  },
});

/**
 * Get all agent statuses for dashboard
 */
export const getAllAgentStatuses = query({
  args: {},
  handler: async (ctx) => {
    const agentTypes = ["coordinator", "document", "media", "sec", "openbb", "arbitrage"];

    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const agentNameMap: Record<string, string> = {
      coordinator: "Coordinator",
      document: "DocumentAgent",
      media: "MediaAgent",
      sec: "SECAgent",
      openbb: "OpenBBAgent",
      arbitrage: "EntityResearchAgent",
    };

    // Get all recent swarm tasks
    const allTasks = await ctx.db
      .query("swarmAgentTasks")
      .order("desc")
      .take(500);

    // Get user's swarms for filtering
    const userSwarms = await ctx.db
      .query("agentSwarms")
      .withIndex("by_user", (q) => q.eq("userId", userId as Id<"users">))
      .collect();
    const userSwarmIds = new Set(userSwarms.map((s) => s.swarmId));

    // Filter to user's tasks
    const userTasks = allTasks.filter((t) => userSwarmIds.has(t.swarmId));

    // Build status for each agent type
    return agentTypes
      .map((agentType) => {
        const agentName = agentNameMap[agentType];
        const agentTasks = userTasks.filter((t) => t.agentName === agentName);

        const runningTask = agentTasks.find((t) => t.status === "running");
        const status = runningTask ? "running" : "idle";

        const lastTask = agentTasks[0];
        const lastActivity = lastTask?.completedAt || lastTask?.createdAt || null;

        const completedCount = agentTasks.filter((t) => t.status === "completed").length;

        return {
          agentType,
          status,
          lastActivity,
          tasksCompleted: completedCount,
          currentTask: runningTask?.query || null,
        };
      })
      .filter((status) => status.lastActivity !== null || status.currentTask !== null);
  },
});

/**
 * Get active swarms for the hub
 */
export const getActiveSwarms = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const swarms = await ctx.db
      .query("agentSwarms")
      .withIndex("by_user", (q) => q.eq("userId", userId as Id<"users">))
      .order("desc")
      .take(args.limit || 10);

    // Enrich with task counts
    const enrichedSwarms = await Promise.all(
      swarms.map(async (swarm) => {
        const tasks = await ctx.db
          .query("swarmAgentTasks")
          .withIndex("by_swarm", (q) => q.eq("swarmId", swarm.swarmId))
          .collect();

        const running = tasks.filter((t) => t.status === "running").length;
        const completed = tasks.filter((t) => t.status === "completed" || t.status === "failed").length;

        return {
          ...swarm,
          taskCount: tasks.length,
          runningCount: running,
          completedCount: completed,
        };
      })
    );

    return enrichedSwarms;
  },
});

/* ================================================================== */
/* AUTONOMOUS RESEARCH SYSTEM QUERIES                                  */
/* ================================================================== */

/** Components actually emitted by healthMonitor.runAllHealthChecks. */
const HEALTH_COMPONENTS = [
  { component: "signal_ingestion", displayName: "Signal ingestion" },
  { component: "research_queue", displayName: "Research queue" },
  { component: "publishing", displayName: "Publishing" },
  { component: "delivery", displayName: "Delivery" },
  { component: "entity_lifecycle", displayName: "Entity lifecycle" },
  { component: "validation", displayName: "Validation" },
  { component: "budget", displayName: "Budget" },
  { component: "database", displayName: "Database" },
] as const;

const HEALTH_CHECK_INTERVAL_MINUTES = Math.max(
  1,
  Math.round(HEALTH_CONFIG.healthCheckIntervalMs / 60_000),
);
const HEALTH_CHECK_STALE_MS =
  HEALTH_CONFIG.healthCheckIntervalMs * HEALTH_CONFIG.healthCheckStaleMultiplier;

/**
 * Get status of all autonomous cron jobs
 * Returns latest health check for each system component
 */
export const getAutonomousCronStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireAutonomousReadAccess(ctx);
    const now = Date.now();

    const cronStatuses = await Promise.all(
      HEALTH_COMPONENTS.map(async ({ component, displayName }) => {
        // Get most recent health check for this component
        const latestCheck = await ctx.db
          .query("healthChecks")
          .withIndex("by_component", (q) => q.eq("component", component))
          .order("desc")
          .first() as Doc<"healthChecks"> | null;

        if (!latestCheck) {
          return {
            component,
            displayName,
            measurementIntervalMinutes: HEALTH_CHECK_INTERVAL_MINUTES,
            status: "unknown" as const,
            lastRun: null,
            latencyP50: null,
            latencyP99: null,
            errorRate: null,
            queueDepth: null,
            isHealthy: false,
            isStale: true,
          };
        }

        // Freshness comes from the same health-monitor cadence as the cron.
        const checkAge = now - latestCheck.checkedAt;
        const isStale = checkAge > HEALTH_CHECK_STALE_MS;

        return {
          component,
          displayName,
          measurementIntervalMinutes: HEALTH_CHECK_INTERVAL_MINUTES,
          status:
            latestCheck.status === "down"
              ? ("unhealthy" as const)
              : latestCheck.status,
          lastRun: latestCheck.checkedAt,
          latencyP50: latestCheck.latencyP50,
          latencyP99: latestCheck.latencyP99,
          errorRate: latestCheck.errorRate,
          queueDepth: latestCheck.queueDepth ?? null,
          isHealthy: latestCheck.status === "healthy" && !isStale,
          isStale,
        };
      })
    );

    return cronStatuses;
  },
});

/**
 * Get ranked list of discovered free models
 * Returns top N models sorted by rank (performance + reliability)
 */
export const getFreeModelRankings = query({
  args: {
    limit: v.optional(v.number()),
    activeOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const activeOnly = args.activeOnly ?? true;

    let models;
    if (activeOnly) {
      models = await ctx.db
        .query("freeModels")
        .withIndex("by_active_rank", (q) => q.eq("isActive", true))
        .order("asc")
        .take(limit);
    } else {
      models = await ctx.db
        .query("freeModels")
        .withIndex("by_rank")
        .order("asc")
        .take(limit);
    }

    return models.map((model) => ({
      id: model._id,
      openRouterId: model.openRouterId,
      name: model.name,
      contextLength: model.contextLength,
      capabilities: model.capabilities,
      performanceScore: model.performanceScore,
      reliabilityScore: model.reliabilityScore,
      latencyAvgMs: model.latencyAvgMs,
      rank: model.rank,
      isActive: model.isActive,
      lastEvaluated: model.lastEvaluated,
      evaluationCount: model.evaluationCount,
      successRate: model.evaluationCount > 0
        ? Math.round((model.successCount / model.evaluationCount) * 100)
        : 0,
    }));
  },
});

/**
 * Get cost savings metrics from autonomous operations
 * Calculates savings vs Claude Haiku baseline
 */
export const getCostSavingsMetrics = query({
  args: {
    windowHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const windowHours = args.windowHours ?? 24;
    const windowStart = Date.now() - windowHours * 60 * 60 * 1000;

    // Get all autonomous model usage in window
    const usage = await ctx.db
      .query("autonomousModelUsage")
      .withIndex("by_timestamp")
      .filter((q) => q.gte(q.field("timestamp"), windowStart))
      .collect();

    // Aggregate metrics
    let freeRuns = 0;
    let paidRuns = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let actualCost = 0;

    for (const record of usage) {
      if (record.cost === 0) {
        freeRuns++;
      } else {
        paidRuns++;
      }
      totalInputTokens += record.inputTokens ?? 0;
      totalOutputTokens += record.outputTokens ?? 0;
      actualCost += record.cost;
    }

    // Calculate hypothetical cost if all runs used Claude Haiku
    // Haiku pricing: $0.25/1M input, $1.25/1M output
    const haikuInputCost = (totalInputTokens / 1_000_000) * 0.25;
    const haikuOutputCost = (totalOutputTokens / 1_000_000) * 1.25;
    const hypotheticalCost = haikuInputCost + haikuOutputCost;

    const dollarsSaved = Math.max(0, hypotheticalCost - actualCost);
    const savingsPercent = hypotheticalCost > 0
      ? Math.round((dollarsSaved / hypotheticalCost) * 100)
      : 0;

    return {
      freeRunsToday: freeRuns,
      paidRunsToday: paidRuns,
      totalRuns: freeRuns + paidRuns,
      totalInputTokens,
      totalOutputTokens,
      actualCost: Math.round(actualCost * 1000) / 1000, // Round to 3 decimals
      hypotheticalCost: Math.round(hypotheticalCost * 1000) / 1000,
      dollarsSaved: Math.round(dollarsSaved * 1000) / 1000,
      savingsPercent,
      windowHours,
    };
  },
});
