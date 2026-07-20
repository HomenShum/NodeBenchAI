/**
 * Self Healer - Autonomous System Recovery
 * Deep Agents 3.0 - Automatically detects and resolves system issues
 *
 * Features:
 * - Automatic issue detection
 * - Self-healing actions
 * - Recovery playbooks
 * - Escalation management
 * - Healing history tracking
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, query } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { HEALTH_CONFIG } from "../../../config/autonomousConfig";
import type { Doc, Id } from "../../../_generated/dataModel";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

export type HealingActionType =
  | "retry_failed_tasks"
  | "clear_stale_locks"
  | "reset_budget"
  | "reprocess_signals"
  | "cleanup_queue"
  | "restart_component"
  | "escalate";

export interface HealingPlaybook {
  issue: string;
  actions: Array<{
    type: HealingActionType;
    params: Record<string, unknown>;
    timeout: number;
  }>;
  escalateAfter: number;
}

export interface HealingResult {
  actionId: Id<"healingActions">;
  actionType: HealingActionType;
  success: boolean;
  message: string;
  metrics?: Record<string, number>;
  duration: number;
}

export interface HealingReport {
  period: string;
  actionsAttempted: number;
  actionsSucceeded: number;
  actionsFailed: number;
  issuesResolved: string[];
  issuesEscalated: string[];
  recommendations: string[];
}

type StoredHealingAction = Doc<"healingActions">;

type HealingStatsSummary = {
  attempted: number;
  succeeded: number;
  failed: number;
  escalated: number;
  byType: Record<string, number>;
};

type HealingActionFeedItem = {
  _id: string;
  issue: string;
  actionType: string;
  status: "pending" | "executing" | "completed" | "failed" | "skipped";
  component: string;
  automated: boolean;
  timestamp: number;
  reason: string;
  result?: string;
};

function toStoredAction(actionType: string): string {
  return actionType === "escalate" ? "alert" : actionType;
}

function toDisplayActionType(action: string): string {
  return action === "alert" ? "escalate" : action;
}

function toStoredStatus(status: string): StoredHealingAction["status"] {
  switch (status) {
    case "running":
    case "executing":
      return "executing";
    case "completed":
    case "success":
      return "success";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    default:
      return "pending";
  }
}

function toDisplayStatus(status: string): HealingActionFeedItem["status"] {
  switch (status) {
    case "success":
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    case "executing":
    case "running":
      return "executing";
    default:
      return "pending";
  }
}

function resolveHealingComponent(actionType: string, params: unknown): string {
  if (params && typeof params === "object" && "component" in params && typeof params.component === "string") {
    return params.component;
  }

  switch (actionType as HealingActionType) {
    case "reprocess_signals":
      return "signals";
    case "reset_budget":
      return "budget";
    default:
      return "system";
  }
}

function buildHealingReason(actionType: string, issue: string): string {
  return actionType === "escalate"
    ? `Escalated for manual review: ${issue}`
    : issue;
}

function isSuccessfulHealingStatus(status: string): boolean {
  return status === "success" || status === "completed";
}

function isEscalationAction(action: string): boolean {
  return action === "alert" || action === "escalate";
}

function summarizeHealingActions(actions: StoredHealingAction[]): HealingStatsSummary {
  const stats: HealingStatsSummary = {
    attempted: actions.length,
    succeeded: actions.filter((action) => isSuccessfulHealingStatus(action.status)).length,
    failed: actions.filter((action) => action.status === "failed").length,
    escalated: actions.filter((action) => isEscalationAction(action.action)).length,
    byType: {},
  };

  for (const action of actions) {
    const actionType = toDisplayActionType(action.action);
    stats.byType[actionType] = (stats.byType[actionType] || 0) + 1;
  }

  return stats;
}

function toHealingFeedItem(action: StoredHealingAction): HealingActionFeedItem {
  return {
    _id: String(action._id),
    issue: action.issue,
    actionType: toDisplayActionType(action.action),
    status: toDisplayStatus(action.status),
    component: action.component,
    automated: action.automated,
    timestamp: action.executedAt ?? action.createdAt,
    reason: action.reason,
    result: action.status === "failed" ? action.errorMessage : undefined,
  };
}

async function listHealingActions(
  ctx: { db: any },
  { hours = 24, limit = 100 }: { hours?: number; limit?: number },
): Promise<StoredHealingAction[]> {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  return await ctx.db
    .query("healingActions")
    .filter((q: any) => q.gte(q.field("createdAt"), cutoff))
    .order("desc")
    .take(limit) as StoredHealingAction[];
}

/* ================================================================== */
/* HEALING PLAYBOOKS                                                   */
/* ================================================================== */

const HEALING_PLAYBOOKS: Record<string, HealingPlaybook> = {
  signal_ingestion_stale: {
    issue: "No signals ingested in the last hour",
    actions: [
      { type: "reprocess_signals", params: { limit: 50 }, timeout: 60000 },
      { type: "cleanup_queue", params: { component: "signals" }, timeout: 30000 },
    ],
    escalateAfter: 2,
  },
  research_queue_backlog: {
    issue: "Research queue backlog",
    actions: [
      { type: "clear_stale_locks", params: { component: "research" }, timeout: 30000 },
      { type: "retry_failed_tasks", params: { component: "research", limit: 20 }, timeout: 120000 },
    ],
    escalateAfter: 3,
  },
  delivery_failures: {
    issue: "High delivery failure rate",
    actions: [
      { type: "retry_failed_tasks", params: { component: "delivery", limit: 50 }, timeout: 120000 },
      { type: "cleanup_queue", params: { component: "delivery" }, timeout: 30000 },
    ],
    escalateAfter: 2,
  },
  budget_exhausted: {
    issue: "Persona budgets exhausted",
    actions: [
      { type: "reset_budget", params: { increaseBy: 0.2 }, timeout: 10000 },
    ],
    escalateAfter: 1,
  },
  entity_critical: {
    issue: "Critical entities need attention",
    actions: [
      { type: "reprocess_signals", params: { priority: "critical", limit: 10 }, timeout: 60000 },
    ],
    escalateAfter: 1,
  },
  validation_backlog: {
    issue: "Unresolved contradictions",
    actions: [
      { type: "cleanup_queue", params: { component: "validation" }, timeout: 30000 },
    ],
    escalateAfter: 2,
  },
};

/* ================================================================== */
/* HEALING IMPLEMENTATIONS                                             */
/* ================================================================== */

/**
 * Retry failed tasks for a component
 */
async function executeRetryFailedTasks(
  ctx: any,
  params: { component: string; limit?: number }
): Promise<{ success: boolean; message: string; metrics?: Record<string, number> }> {
  const { component, limit = 20 } = params;

  try {
    let retried = 0;

    if (component === "research") {
      const failedTasks = await ctx.runQuery(
        internal.domains.research.researchQueue.getFailedTasks,
        { limit }
      );

      for (const task of failedTasks) {
        if (task.retryCount < 3) {
          await ctx.runMutation(
            internal.domains.research.researchQueue.markForRetry,
            { taskId: task._id }
          );
          retried++;
        }
      }
    } else if (component === "delivery") {
      const failedJobs = await ctx.runQuery(
        internal.domains.publishing.deliveryQueue.getFailedJobs,
        { limit }
      );

      for (const job of failedJobs) {
        if (job.retryCount < 3) {
          await ctx.runMutation(
            internal.domains.publishing.deliveryQueue.requeueJob,
            { jobId: job._id }
          );
          retried++;
        }
      }
    }

    return {
      success: true,
      message: `Retried ${retried} failed ${component} tasks`,
      metrics: { retriedCount: retried },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to retry ${component} tasks: ${error}`,
    };
  }
}

/**
 * Clear stale locks
 */
async function executeClearStaleLocks(
  ctx: any,
  params: { component: string }
): Promise<{ success: boolean; message: string; metrics?: Record<string, number> }> {
  const { component } = params;

  try {
    let cleared = 0;

    if (component === "research") {
      // Find tasks stuck in "researching" status for too long
      const stuckTasks = await ctx.runQuery(
        internal.domains.research.researchQueue.getStuckTasks,
        { timeoutMinutes: 30 }
      );

      for (const task of stuckTasks) {
        await ctx.runMutation(
          internal.domains.research.researchQueue.resetTaskStatus,
          { taskId: task._id, status: "queued" }
        );
        cleared++;
      }
    }

    return {
      success: true,
      message: `Cleared ${cleared} stale locks in ${component}`,
      metrics: { clearedCount: cleared },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to clear stale locks: ${error}`,
    };
  }
}

/**
 * Reset persona budgets
 */
async function executeResetBudget(
  ctx: any,
  params: { increaseBy?: number }
): Promise<{ success: boolean; message: string; metrics?: Record<string, number> }> {
  const { increaseBy = 0 } = params;

  try {
    const budgets = await ctx.runQuery(
      internal.domains.personas.personaAutonomousAgent.getAllPersonaBudgets,
      {}
    );

    let reset = 0;
    for (const budget of budgets) {
      const newBudget = Math.round(budget.dailyBudget * (1 + increaseBy));
      await ctx.runMutation(
        internal.domains.personas.personaAutonomousAgent.initializePersonaBudget,
        { personaId: budget.personaId, dailyBudget: newBudget }
      );
      reset++;
    }

    return {
      success: true,
      message: `Reset ${reset} persona budgets${increaseBy > 0 ? ` with ${(increaseBy * 100).toFixed(0)}% increase` : ""}`,
      metrics: { resetCount: reset },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to reset budgets: ${error}`,
    };
  }
}

/**
 * Reprocess signals
 */
async function executeReprocessSignals(
  ctx: any,
  params: { priority?: string; limit?: number }
): Promise<{ success: boolean; message: string; metrics?: Record<string, number> }> {
  const { limit = 50 } = params;

  try {
    // Get unprocessed signals and requeue them
    const signals = await ctx.runQuery(
      internal.domains.signals.signalIngester.getUnprocessedSignals,
      { limit }
    );

    let reprocessed = 0;
    for (const signal of signals) {
      await ctx.runMutation(
        internal.domains.signals.signalIngester.updateSignalStatus,
        { signalId: signal._id, status: "pending" }
      );
      reprocessed++;
    }

    return {
      success: true,
      message: `Requeued ${reprocessed} signals for processing`,
      metrics: { reprocessedCount: reprocessed },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to reprocess signals: ${error}`,
    };
  }
}

/**
 * Cleanup queue
 */
async function executeCleanupQueue(
  ctx: any,
  params: { component: string }
): Promise<{ success: boolean; message: string; metrics?: Record<string, number> }> {
  const { component } = params;

  try {
    let cleaned = 0;

    if (component === "signals") {
      // Clean up old error signals
      cleaned = await ctx.runMutation(
        internal.domains.signals.signalIngester.cleanupErrorSignals,
        { olderThanHours: 24 }
      );
    } else if (component === "delivery") {
      // Clean up old failed deliveries
      cleaned = await ctx.runMutation(
        internal.domains.publishing.deliveryQueue.cleanupOldJobs,
        {}
      );
    } else if (component === "validation") {
      // Auto-resolve low-severity contradictions
      cleaned = await ctx.runAction(
        internal.domains.validation.contradictionDetector.autoResolveContradictions,
        { limit: 50 }
      );
    }

    return {
      success: true,
      message: `Cleaned up ${cleaned} items from ${component} queue`,
      metrics: { cleanedCount: cleaned },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to cleanup ${component} queue: ${error}`,
    };
  }
}

/* ================================================================== */
/* QUERIES                                                             */
/* ================================================================== */

/**
 * Get healing action history
 */
export const getHealingHistory = internalQuery({
  args: { hours: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, { hours = 24, limit = 100 }): Promise<StoredHealingAction[]> => {
    return await listHealingActions(ctx, { hours, limit });
  },
});

/**
 * Get pending healing actions
 */
export const getPendingHealingActions = internalQuery({
  args: {},
  handler: async (ctx): Promise<StoredHealingAction[]> => {
    return await ctx.db
      .query("healingActions")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect() as StoredHealingAction[];
  },
});

/**
 * Get healing stats
 */
export const getHealingStats = internalQuery({
  args: { hours: v.optional(v.number()) },
  handler: async (ctx, { hours = 24 }): Promise<HealingStatsSummary> => {
    const actions = await listHealingActions(ctx, { hours, limit: 500 });
    return summarizeHealingActions(actions);
  },
});

/**
 * Public query for cockpit / observability repair summary
 */
export const getHealingStatsSummary = query({
  args: { hours: v.optional(v.number()) },
  returns: v.object({
    attempted: v.number(),
    succeeded: v.number(),
    failed: v.number(),
    escalated: v.number(),
  }),
  handler: async (ctx, { hours = 24 }) => {
    const stats = await ctx.runQuery(
      internal.domains.observability.selfHealer.getHealingStats,
      { hours },
    );

    return {
      attempted: stats.attempted,
      succeeded: stats.succeeded,
      failed: stats.failed,
      escalated: stats.escalated,
    };
  },
});

/**
 * Public query for observability healing action feed
 */
export const getRecentHealingActions = query({
  args: { hours: v.optional(v.number()), limit: v.optional(v.number()) },
  returns: v.array(v.object({
    _id: v.string(),
    issue: v.string(),
    actionType: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("executing"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    component: v.string(),
    automated: v.boolean(),
    timestamp: v.number(),
    reason: v.string(),
    result: v.optional(v.string()),
  })),
  handler: async (ctx, { hours = 24, limit = 20 }) => {
    const actions = await ctx.runQuery(
      internal.domains.observability.selfHealer.getHealingHistory,
      { hours, limit },
    );

    return actions.map(toHealingFeedItem);
  },
});

/* ================================================================== */
/* MUTATIONS                                                           */
/* ================================================================== */

/**
 * Create healing action record
 */
export const createHealingAction = internalMutation({
  args: {
    issue: v.string(),
    actionType: v.string(),
    params: v.any(),
    triggeredBy: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"healingActions">> => {
    return await ctx.db.insert("healingActions", {
      component: resolveHealingComponent(args.actionType, args.params),
      issue: args.issue,
      action: toStoredAction(args.actionType),
      reason: buildHealingReason(args.actionType, args.issue),
      automated: args.triggeredBy !== "manual",
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

/**
 * Update healing action status
 */
export const updateHealingAction = internalMutation({
  args: {
    actionId: v.id("healingActions"),
    status: v.string(),
    result: v.optional(v.string()),
    metrics: v.optional(v.any()),
  },
  handler: async (ctx, { actionId, status, result, metrics }): Promise<void> => {
    const storedStatus = toStoredStatus(status);
    await ctx.db.patch(actionId, {
      status: storedStatus,
      executedAt: storedStatus === "success" || storedStatus === "failed" || storedStatus === "skipped"
        ? Date.now()
        : undefined,
      errorMessage: storedStatus === "failed" ? result : undefined,
      impactMetrics: metrics
        ? {
            preActionHealth: "unknown",
            recoveryTimeMs: typeof metrics?.duration === "number" ? metrics.duration : undefined,
          }
        : undefined,
    });
  },
});

/* ================================================================== */
/* ACTIONS                                                             */
/* ================================================================== */

/**
 * Execute a single healing action
 */
export const executeHealingAction = internalAction({
  args: {
    actionType: v.string(),
    params: v.any(),
    issue: v.string(),
  },
  handler: async (ctx, { actionType, params, issue }): Promise<HealingResult> => {
    const start = Date.now();

    // Create action record
    const actionId = await ctx.runMutation(
      internal.domains.observability.selfHealer.createHealingAction,
      {
        issue,
        actionType,
        params,
        triggeredBy: "auto",
      }
    );

    // Mark as running
    await ctx.runMutation(
      internal.domains.observability.selfHealer.updateHealingAction,
      { actionId, status: "running" }
    );

    let result: { success: boolean; message: string; metrics?: Record<string, number> };

    try {
      // Execute the appropriate action
      switch (actionType as HealingActionType) {
        case "retry_failed_tasks":
          result = await executeRetryFailedTasks(ctx, params);
          break;
        case "clear_stale_locks":
          result = await executeClearStaleLocks(ctx, params);
          break;
        case "reset_budget":
          result = await executeResetBudget(ctx, params);
          break;
        case "reprocess_signals":
          result = await executeReprocessSignals(ctx, params);
          break;
        case "cleanup_queue":
          result = await executeCleanupQueue(ctx, params);
          break;
        case "escalate":
          result = { success: true, message: "Issue escalated for manual review" };
          break;
        default:
          result = { success: false, message: `Unknown action type: ${actionType}` };
      }
    } catch (error) {
      result = { success: false, message: `Action failed: ${error}` };
    }

    // Update action record
    await ctx.runMutation(
      internal.domains.observability.selfHealer.updateHealingAction,
      {
        actionId,
        status: result.success ? "completed" : "failed",
        result: result.message,
        metrics: result.metrics,
      }
    );

    const duration = Date.now() - start;
    console.log(`[SelfHealer] ${actionType}: ${result.success ? "SUCCESS" : "FAILED"} (${duration}ms) - ${result.message}`);

    return {
      actionId,
      actionType: actionType as HealingActionType,
      success: result.success,
      message: result.message,
      metrics: result.metrics,
      duration,
    };
  },
});

/**
 * Run self-healing based on health check results
 */
export const runSelfHealing = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    actionsExecuted: number;
    actionsSucceeded: number;
    issues: string[];
  }> => {
    console.log("[SelfHealer] Starting self-healing cycle...");

    // Get current health status
    const health = await ctx.runAction(
      internal.domains.observability.healthMonitor.runAllHealthChecks,
      {}
    );

    const issues: string[] = [];
    let actionsExecuted = 0;
    let actionsSucceeded = 0;

    // Process each unhealthy/degraded component
    for (const [component, check] of Object.entries(health.components) as [string, { status: string; issues: string[] }][]) {
      if (check.status === "healthy") continue;

      for (const issue of check.issues) {
        issues.push(`${component}: ${issue}`);

        // Find matching playbook
        const playbookKey = Object.keys(HEALING_PLAYBOOKS).find((key) =>
          issue.toLowerCase().includes(HEALING_PLAYBOOKS[key].issue.toLowerCase().slice(0, 20))
        );

        if (playbookKey) {
          const playbook = HEALING_PLAYBOOKS[playbookKey];

          // Check if we've already tried this playbook recently
          const recentActions = await ctx.runQuery(
            internal.domains.observability.selfHealer.getHealingHistory,
            { hours: 1 }
          );

          const recentAttempts = recentActions.filter(
            (a: Doc<"healingActions">) => a.issue === issue && a.status === "failed"
          ).length;

          if (recentAttempts >= playbook.escalateAfter) {
            // Escalate instead
            await ctx.runAction(
              internal.domains.observability.selfHealer.executeHealingAction,
              {
                actionType: "escalate",
                params: { issue, component },
                issue,
              }
            );
            actionsExecuted++;
            continue;
          }

          // Execute playbook actions
          for (const action of playbook.actions) {
            const result = await ctx.runAction(
              internal.domains.observability.selfHealer.executeHealingAction,
              {
                actionType: action.type,
                params: action.params,
                issue,
              }
            );

            actionsExecuted++;
            if (result.success) {
              actionsSucceeded++;
            }
          }
        }
      }
    }

    console.log(
      `[SelfHealer] Healing cycle complete: ${actionsExecuted} actions, ${actionsSucceeded} succeeded, ${issues.length} issues`
    );

    return { actionsExecuted, actionsSucceeded, issues };
  },
});

/**
 * Tick function for cron-based self-healing
 */
export const tickSelfHealing = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    await ctx.runAction(
      internal.domains.observability.selfHealer.runSelfHealing,
      {}
    );
  },
});

/**
 * Generate healing report
 */
export const generateHealingReport = internalAction({
  args: { hours: v.optional(v.number()) },
  handler: async (ctx, { hours = 24 }): Promise<HealingReport> => {
    const stats = await ctx.runQuery(
      internal.domains.observability.selfHealer.getHealingStats,
      { hours }
    );

    const history = await ctx.runQuery(
      internal.domains.observability.selfHealer.getHealingHistory,
      { hours }
    );

    // Get unique resolved and escalated issues
    const resolvedIssues = [...new Set(
      history
        .filter((a: StoredHealingAction) => isSuccessfulHealingStatus(a.status))
        .map((a: StoredHealingAction) => a.issue)
    )] as string[];

    const escalatedIssues = [...new Set(
      history
        .filter((a: StoredHealingAction) => isEscalationAction(a.action))
        .map((a: StoredHealingAction) => a.issue)
    )] as string[];

    // Generate recommendations
    const recommendations: string[] = [];

    if (stats.failed > stats.succeeded) {
      recommendations.push("High failure rate - review healing playbooks");
    }

    if (stats.escalated > 5) {
      recommendations.push("Multiple issues escalated - manual intervention needed");
    }

    const mostCommonAction = (Object.entries(stats.byType) as [string, number][])
      .sort(([, a], [, b]) => b - a)[0];
    if (mostCommonAction && mostCommonAction[1] > 10) {
      recommendations.push(`Frequent ${mostCommonAction[0]} actions - investigate root cause`);
    }

    return {
      period: `Last ${hours} hours`,
      actionsAttempted: stats.attempted,
      actionsSucceeded: stats.succeeded,
      actionsFailed: stats.failed,
      issuesResolved: resolvedIssues,
      issuesEscalated: escalatedIssues,
      recommendations,
    };
  },
});

/**
 * Cleanup old healing actions (keep 30 days)
 */
export const cleanupOldHealingActions = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const oldActions = await ctx.runQuery(
      internal.domains.observability.selfHealer.getOldHealingActions,
      { before: thirtyDaysAgo, limit: 500 }
    );

    let deleted = 0;
    for (const action of oldActions) {
      await ctx.runMutation(
        internal.domains.observability.selfHealer.deleteHealingAction,
        { actionId: action._id }
      );
      deleted++;
    }

    console.log(`[SelfHealer] Cleaned up ${deleted} old healing actions`);
    return deleted;
  },
});

/**
 * Get old healing actions for cleanup
 */
export const getOldHealingActions = internalQuery({
  args: { before: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, { before, limit = 500 }): Promise<StoredHealingAction[]> => {
    return await ctx.db
      .query("healingActions")
      .filter((q) => q.lt(q.field("createdAt"), before))
      .take(limit) as StoredHealingAction[];
  },
});

/**
 * Delete a healing action
 */
export const deleteHealingAction = internalMutation({
  args: { actionId: v.id("healingActions") },
  handler: async (ctx, { actionId }): Promise<void> => {
    await ctx.db.delete(actionId);
  },
});
