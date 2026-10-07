/**
 * Dashboard Data - Unified Observability Dashboard
 * Deep Agents 3.0 - Provides aggregated metrics for UI dashboards
 *
 * Features:
 * - System overview metrics
 * - Real-time activity feed
 * - Persona performance tracking
 * - Channel analytics
 * - Research pipeline visibility
 */

import { v } from "convex/values";
import { internalAction, internalQuery, query } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { PERSONA_CONFIG, type PersonaId } from "../../../config/autonomousConfig";
import type { Doc } from "../../../_generated/dataModel";
import { isActiveHealthStatus, normalizeHealthCheckDoc } from "./healthMonitor";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

export interface DashboardOverview {
  health: {
    overall: string;
    components: Record<string, string>;
    activeAlerts: number;
  };
  activity: {
    signalsToday: number;
    researchTasksToday: number;
    publicationsToday: number;
    entitiesUpdated: number;
  };
  pipeline: {
    signalsQueued: number;
    researchInProgress: number;
    publishingPending: number;
    deliveryPending: number;
  };
  performance: {
    avgResearchTime: number;
    avgDeliveryTime: number;
    successRate: number;
  };
}

export interface PersonaDashboard {
  personaId: PersonaId;
  personaName: string;
  budget: {
    daily: number;
    remaining: number;
    usedToday: number;
    utilizationPercent: number;
  };
  activity: {
    tasksCompletedToday: number;
    avgQualityScore: number;
    entitiesResearched: number;
  };
  performance: {
    successRate: number;
    avgTaskDuration: number;
  };
}

export interface ChannelDashboard {
  channel: string;
  metrics: {
    sentToday: number;
    deliveredToday: number;
    failedToday: number;
    deliveryRate: number;
  };
  engagement: {
    openRate: number;
    clickRate: number;
    dismissRate: number;
  };
  trend: "up" | "down" | "stable";
}

export interface ActivityFeedItem {
  id: string;
  type: "signal" | "research" | "publish" | "healing" | "alert";
  title: string;
  description: string;
  timestamp: number;
  status: "success" | "warning" | "error" | "info";
  metadata?: Record<string, unknown>;
}

/* ================================================================== */
/* QUERIES                                                             */
/* ================================================================== */

/**
 * Get system overview for dashboard
 */
export const getSystemOverview = query({
  args: {},
  handler: async (ctx): Promise<DashboardOverview> => {
    const now = Date.now();
    const todayStart = new Date().setUTCHours(0, 0, 0, 0);

    // Get health status
    const healthChecks = await ctx.db
      .query("healthChecks")
      .withIndex("by_checked", (q) => q.gte("checkedAt", 0))
      .order("desc")
      .take(20);

    const componentStatuses: Record<string, string> = {};
    for (const check of healthChecks) {
      const normalized = normalizeHealthCheckDoc(check as Doc<"healthChecks">);
      if (!componentStatuses[normalized.component]) {
        componentStatuses[normalized.component] = normalized.status;
      }
    }

    const hasUnhealthy = Object.values(componentStatuses).includes("unhealthy");
    const hasDegraded = Object.values(componentStatuses).includes("degraded");
    const overallHealth = hasUnhealthy ? "unhealthy" : hasDegraded ? "degraded" : "healthy";

    // Get activity counts
    const signalsToday = await ctx.db
      .query("signals")
      .filter((q) => q.gte(q.field("ingestedAt"), todayStart))
      .collect();

    const researchTasksToday = await ctx.db
      .query("researchTasks")
      .filter((q) => q.gte(q.field("createdAt"), todayStart))
      .collect();

    const completedResearch = researchTasksToday.filter((t) => t.status === "completed");

    const publicationsToday = await ctx.db
      .query("publishingTasks")
      .filter((q) =>
        q.and(
          q.gte(q.field("createdAt"), todayStart),
          q.eq(q.field("status"), "completed")
        )
      )
      .collect();

    // Get pipeline status
    const queuedSignals = await ctx.db
      .query("signals")
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();

    const researchInProgress = await ctx.db
      .query("researchTasks")
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "researching"),
          q.eq(q.field("status"), "validating")
        )
      )
      .collect();

    const publishingPending = await ctx.db
      .query("publishingTasks")
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();

    const deliveryPending = await ctx.db
      .query("deliveryJobs")
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();

    // Calculate performance metrics
    const successfulTasks = researchTasksToday.filter((t) => t.status === "completed").length;
    const failedTasks = researchTasksToday.filter((t) => t.status === "failed").length;
    const totalProcessed = successfulTasks + failedTasks;

    const completedWithTiming = completedResearch.filter(
      (t) => t.completedAt && t.startedAt
    );
    const avgResearchTime =
      completedWithTiming.length > 0
        ? completedWithTiming.reduce(
            (sum, t) => sum + ((t.completedAt || 0) - (t.startedAt || 0)),
            0
          ) / completedWithTiming.length
        : 0;

    // Get active alerts count
    const activeAlerts = Object.values(componentStatuses).filter((status) => isActiveHealthStatus(status)).length;

    // Get entity update count
    const entityStates = await ctx.db
      .query("entityStates")
      .filter((q) => q.gte(q.field("updatedAt"), todayStart))
      .collect();

    return {
      health: {
        overall: overallHealth,
        components: componentStatuses,
        activeAlerts,
      },
      activity: {
        signalsToday: signalsToday.length,
        researchTasksToday: researchTasksToday.length,
        publicationsToday: publicationsToday.length,
        entitiesUpdated: entityStates.length,
      },
      pipeline: {
        signalsQueued: queuedSignals.length,
        researchInProgress: researchInProgress.length,
        publishingPending: publishingPending.length,
        deliveryPending: deliveryPending.length,
      },
      performance: {
        avgResearchTime: Math.round(avgResearchTime / 1000), // seconds
        avgDeliveryTime: 0, // Would need delivery timing data
        successRate: totalProcessed > 0 ? successfulTasks / totalProcessed : 1,
      },
    };
  },
});

/**
 * Get persona dashboard data
 */
export const getPersonaDashboards = query({
  args: {},
  handler: async (ctx): Promise<PersonaDashboard[]> => {
    const todayStart = new Date().setUTCHours(0, 0, 0, 0);
    const dashboards: PersonaDashboard[] = [];

    // Get all persona budgets
    const budgets = await ctx.db.query("personaBudgets").collect();

    for (const budget of budgets) {
      const personaId = budget.personaId as PersonaId;

      // Verify this is a valid persona ID from the config
      if (!PERSONA_CONFIG.personaIds.includes(personaId)) continue;

      // Get persona name by formatting the ID (e.g., "JPM_STARTUP_BANKER" -> "JPM Startup Banker")
      const personaName = personaId.split('_').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      ).join(' ');

      // Get research tasks for this persona
      const tasks = await ctx.db
        .query("researchTasks")
        .withIndex("by_persona", (q) => q.eq("primaryPersona", personaId))
        .filter((q) => q.gte(q.field("createdAt"), todayStart))
        .collect();

      const completedTasks = tasks.filter((t) => t.status === "completed");
      const failedTasks = tasks.filter((t) => t.status === "failed");

      // Calculate average quality score
      const qualityScores = completedTasks
        .filter((t) => t.result?.qualityScore)
        .map((t) => t.result?.qualityScore || 0);
      const avgQuality =
        qualityScores.length > 0
          ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
          : 0;

      // Get unique entities researched
      const entitiesResearched = new Set(tasks.map((t) => t.entityId)).size;

      // Calculate success rate
      const totalProcessed = completedTasks.length + failedTasks.length;
      const successRate = totalProcessed > 0 ? completedTasks.length / totalProcessed : 1;

      dashboards.push({
        personaId,
        personaName,
        budget: {
          daily: budget.dailyBudget,
          remaining: budget.remainingBudget,
          usedToday: budget.usedToday,
          utilizationPercent:
            budget.dailyBudget > 0
              ? ((budget.dailyBudget - budget.remainingBudget) / budget.dailyBudget) * 100
              : 0,
        },
        activity: {
          tasksCompletedToday: completedTasks.length,
          avgQualityScore: Math.round(avgQuality),
          entitiesResearched,
        },
        performance: {
          successRate,
          avgTaskDuration: 0, // Would need timing data
        },
      });
    }

    return dashboards;
  },
});

/**
 * Get channel dashboard data
 */
export const getChannelDashboards = query({
  args: {},
  handler: async (ctx): Promise<ChannelDashboard[]> => {
    const todayStart = new Date().setUTCHours(0, 0, 0, 0);
    const channels = ["ntfy", "email", "slack", "sms", "ui"];
    const dashboards: ChannelDashboard[] = [];

    for (const channel of channels) {
      // Get delivery stats
      const deliveryJobs = await ctx.db
        .query("deliveryJobs")
        .withIndex("by_channel", (q) => q.eq("channel", channel))
        .filter((q) => q.gte(q.field("createdAt"), todayStart))
        .collect();

      const delivered = deliveryJobs.filter((j) => j.status === "delivered").length;
      const failed = deliveryJobs.filter((j) => j.status === "failed").length;

      // Get engagement stats
      const engagementEvents = await ctx.db
        .query("engagementEvents")
        .withIndex("by_channel", (q) => q.eq("channel", channel))
        .filter((q) => q.gte(q.field("timestamp"), todayStart))
        .collect();

      const opened = engagementEvents.filter((e) => e.eventType === "opened").length;
      const clicked = engagementEvents.filter((e) => e.eventType === "clicked").length;
      const dismissed = engagementEvents.filter((e) => e.eventType === "dismissed").length;

      // Determine trend (simplified)
      const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
      const yesterdayJobs = await ctx.db
        .query("deliveryJobs")
        .withIndex("by_channel", (q) => q.eq("channel", channel))
        .filter((q) =>
          q.and(
            q.gte(q.field("createdAt"), yesterdayStart),
            q.lt(q.field("createdAt"), todayStart)
          )
        )
        .collect();

      let trend: "up" | "down" | "stable" = "stable";
      if (deliveryJobs.length > yesterdayJobs.length * 1.1) {
        trend = "up";
      } else if (deliveryJobs.length < yesterdayJobs.length * 0.9) {
        trend = "down";
      }

      dashboards.push({
        channel,
        metrics: {
          sentToday: deliveryJobs.length,
          deliveredToday: delivered,
          failedToday: failed,
          deliveryRate: deliveryJobs.length > 0 ? delivered / deliveryJobs.length : 1,
        },
        engagement: {
          openRate: delivered > 0 ? opened / delivered : 0,
          clickRate: opened > 0 ? clicked / opened : 0,
          dismissRate: delivered > 0 ? dismissed / delivered : 0,
        },
        trend,
      });
    }

    return dashboards;
  },
});

/**
 * Get activity feed
 */
export const getActivityFeed = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 50 }): Promise<ActivityFeedItem[]> => {
    const feed: ActivityFeedItem[] = [];

    // Get recent signals
    const signals = await ctx.db.query("signals").order("desc").take(20);
    for (const signal of signals) {
      feed.push({
        id: signal._id,
        type: "signal",
        title: `Signal: ${signal.title?.slice(0, 50) || "Untitled"}`,
        description: `From ${signal.source} - ${signal.urgency} urgency`,
        timestamp: signal.ingestedAt,
        status: signal.status === "processed" ? "success" : signal.status === "error" ? "error" : "info",
      });
    }

    // Get recent research tasks
    const research = await ctx.db.query("researchTasks").order("desc").take(20);
    for (const task of research) {
      feed.push({
        id: task._id,
        type: "research",
        title: `Research: ${task.entityName}`,
        description: `${task.primaryPersona} - ${task.status}`,
        timestamp: task.createdAt,
        status:
          task.status === "completed"
            ? "success"
            : task.status === "failed"
              ? "error"
              : "info",
      });
    }

    // Get recent publications
    const publications = await ctx.db.query("publishingTasks").order("desc").take(20);
    for (const pub of publications) {
      feed.push({
        id: pub._id,
        type: "publish",
        title: `Published: ${pub.entityName || "Content"}`,
        description: `To ${pub.channels.join(", ")}`,
        timestamp: pub.createdAt,
        status: pub.status === "completed" ? "success" : pub.status === "failed" ? "error" : "info",
      });
    }

    // Get recent healing actions
    const healing = await ctx.db.query("healingActions").order("desc").take(10);
    for (const action of healing) {
      feed.push({
        id: action._id,
        type: "healing",
        title: `Self-Heal: ${action.actionType}`,
        description: action.issue,
        timestamp: action.timestamp,
        status: action.status === "completed" ? "success" : action.status === "failed" ? "error" : "warning",
      });
    }

    // Get recent health alerts
    const alerts = await ctx.db
      .query("healthChecks")
      .withIndex("by_checked", (q) => q.gte("checkedAt", 0))
      .order("desc")
      .take(25);

    const latestAlerts = new Map<string, ReturnType<typeof normalizeHealthCheckDoc>>();
    for (const alert of alerts) {
      const normalized = normalizeHealthCheckDoc(alert as Doc<"healthChecks">);
      if (isActiveHealthStatus(normalized.status) && !latestAlerts.has(normalized.component)) {
        latestAlerts.set(normalized.component, normalized);
      }
    }

    for (const alert of [...latestAlerts.values()].slice(0, 10)) {
      feed.push({
        id: `${alert.component}-${alert.timestamp}`,
        type: "alert",
        title: `Alert: ${alert.component}`,
        description: (alert.issues.join(", ") || `${alert.component} is ${alert.status}`).slice(0, 100),
        timestamp: alert.timestamp,
        status: alert.status === "unhealthy" ? "error" : "warning",
      });
    }

    // Sort by timestamp and limit
    return feed
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  },
});

/**
 * Get research pipeline visualization data
 */
export const getResearchPipelineData = query({
  args: {},
  handler: async (ctx): Promise<{
    stages: Array<{
      name: string;
      count: number;
      avgTime: number;
    }>;
    flow: Array<{
      from: string;
      to: string;
      count: number;
    }>;
  }> => {
    // Get all research tasks
    const tasks = await ctx.db.query("researchTasks").collect();

    // Count by status
    const stageCounts: Record<string, number> = {
      queued: 0,
      researching: 0,
      validating: 0,
      publishing: 0,
      completed: 0,
      failed: 0,
    };

    for (const task of tasks) {
      if (stageCounts[task.status] !== undefined) {
        stageCounts[task.status]++;
      }
    }

    const stages = Object.entries(stageCounts).map(([name, count]) => ({
      name,
      count,
      avgTime: 0, // Would need timing data
    }));

    // Calculate flow (simplified - actual flow would need transition tracking)
    const flow = [
      { from: "queued", to: "researching", count: stageCounts.researching },
      { from: "researching", to: "validating", count: stageCounts.validating },
      { from: "validating", to: "publishing", count: stageCounts.publishing },
      { from: "publishing", to: "completed", count: stageCounts.completed },
      { from: "researching", to: "failed", count: Math.floor(stageCounts.failed * 0.7) },
      { from: "validating", to: "failed", count: Math.floor(stageCounts.failed * 0.3) },
    ];

    return { stages, flow };
  },
});

/**
 * Get entity health overview
 */
export const getEntityHealthOverview = query({
  args: {},
  handler: async (ctx): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    recentlyUpdated: number;
    needingAttention: number;
  }> => {
    const entities = await ctx.db.query("entityStates").collect();
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    const byStatus = {
      fresh: 0,
      stale: 0,
      critical: 0,
    };

    const byType: Record<string, number> = {};
    let recentlyUpdated = 0;
    let needingAttention = 0;

    for (const entity of entities) {
      // Status
      if (entity.freshness.decayScore >= 0.7) {
        byStatus.fresh++;
      } else if (entity.freshness.decayScore >= 0.3) {
        byStatus.stale++;
        needingAttention++;
      } else {
        byStatus.critical++;
        needingAttention++;
      }

      // Type
      byType[entity.entityType] = (byType[entity.entityType] || 0) + 1;

      // Recently updated
      if (entity.updatedAt >= oneDayAgo) {
        recentlyUpdated++;
      }
    }

    return {
      total: entities.length,
      byStatus,
      byType,
      recentlyUpdated,
      needingAttention,
    };
  },
});

/* ================================================================== */
/* ACTIONS                                                             */
/* ================================================================== */

/**
 * Generate comprehensive dashboard snapshot
 */
export const generateDashboardSnapshot = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    timestamp: number;
    overview: DashboardOverview;
    personas: PersonaDashboard[];
    channels: ChannelDashboard[];
    recentActivity: ActivityFeedItem[];
  }> => {
    // Note: In a real implementation, these would be parallel queries
    // For now, we'll use the public queries
    const overview = await ctx.runQuery(
      internal.domains.observability.dashboardData.getSystemOverview,
      {}
    );

    const personas = await ctx.runQuery(
      internal.domains.observability.dashboardData.getPersonaDashboards,
      {}
    );

    const channels = await ctx.runQuery(
      internal.domains.observability.dashboardData.getChannelDashboards,
      {}
    );

    const recentActivity = await ctx.runQuery(
      internal.domains.observability.dashboardData.getActivityFeed,
      { limit: 20 }
    );

    return {
      timestamp: Date.now(),
      overview,
      personas,
      channels,
      recentActivity,
    };
  },
});
