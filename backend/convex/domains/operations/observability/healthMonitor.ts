/**
 * Health Monitor - System Health Tracking & Alerting
 * Deep Agents 3.0 - Monitors all autonomous components for health issues
 *
 * Features:
 * - Component health checks
 * - Metric collection and trending
 * - Anomaly detection
 * - Alert generation
 * - SLA monitoring
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, query } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { HEALTH_CONFIG, CRON_CONFIG } from "../../../config/autonomousConfig";
import type { Doc, Id } from "../../../_generated/dataModel";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

export type ComponentStatus = "healthy" | "degraded" | "unhealthy" | "unknown";
export type HealthCheckType =
  | "signal_ingestion"
  | "research_queue"
  | "publishing"
  | "delivery"
  | "entity_lifecycle"
  | "validation"
  | "budget"
  | "database";

export interface HealthCheckResult {
  component: HealthCheckType;
  status: ComponentStatus;
  latencyMs: number;
  metrics: Record<string, number>;
  issues: string[];
  timestamp: number;
}

export interface SystemHealth {
  overall: ComponentStatus;
  components: Record<HealthCheckType, HealthCheckResult>;
  activeAlerts: number;
  lastChecked: number;
  uptime: number;
}

export interface HealthTrend {
  component: HealthCheckType;
  hourlyAvgLatency: number[];
  hourlyErrorRate: number[];
  hourlyThroughput: number[];
  trend: "improving" | "stable" | "degrading";
}

export interface Alert {
  id: string;
  component: HealthCheckType;
  severity: "info" | "warning" | "critical";
  message: string;
  timestamp: number;
  acknowledged: boolean;
  resolvedAt?: number;
}

type CanonicalHealthCheck = Doc<"healthChecks">;

const HEALTH_COMPONENTS: HealthCheckType[] = [
  "signal_ingestion",
  "research_queue",
  "publishing",
  "delivery",
  "entity_lifecycle",
  "validation",
  "budget",
  "database",
];

const DEFAULT_HEALTH_WINDOW_MINUTES = Math.max(1, Math.round(HEALTH_CONFIG.healthCheckIntervalMs / 60_000));
const HEALTH_CHECK_STALE_MS =
  HEALTH_CONFIG.healthCheckIntervalMs * HEALTH_CONFIG.healthCheckStaleMultiplier;

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toLegacyStatus(status: string): ComponentStatus {
  if (status === "healthy" || status === "degraded" || status === "unknown") {
    return status;
  }
  return status === "down" || status === "unhealthy" ? "unhealthy" : "unknown";
}

function toCanonicalStatus(status: string): CanonicalHealthCheck["status"] {
  if (status === "healthy" || status === "degraded") {
    return status;
  }
  return "down";
}

function toRecentErrors(issues: string[], timestamp: number): CanonicalHealthCheck["recentErrors"] {
  if (issues.length === 0) {
    return undefined;
  }

  return issues.map((message) => ({
    timestamp,
    message,
    count: 1,
  }));
}

function toLegacyIssues(check: CanonicalHealthCheck): string[] {
  const recentErrors = Array.isArray(check.recentErrors)
    ? check.recentErrors.map((error) => String(error.message)).filter(Boolean)
    : [];

  if (recentErrors.length > 0) {
    return recentErrors;
  }

  const status = toLegacyStatus(check.status);
  return status === "healthy" ? [] : [`${check.component} is ${status}`];
}

function toLegacyMetrics(check: CanonicalHealthCheck): Record<string, number> {
  const metrics: Record<string, number> = {
    errorRate: check.errorRate,
    latencyP50: check.latencyP50,
    latencyP99: check.latencyP99,
  };

  if (check.throughput !== undefined) metrics.throughput = check.throughput;
  if (check.queueDepth !== undefined) metrics.queueDepth = check.queueDepth;
  if (check.oldestItemAge !== undefined) metrics.oldestItemAge = check.oldestItemAge;
  if (check.memoryUsage !== undefined) metrics.memoryUsage = check.memoryUsage;
  if (check.cpuUsage !== undefined) metrics.cpuUsage = check.cpuUsage;

  return metrics;
}

export function normalizeHealthCheckDoc(check: CanonicalHealthCheck): HealthCheckResult {
  return {
    component: check.component as HealthCheckType,
    status: toLegacyStatus(check.status),
    latencyMs: check.latencyP99 ?? check.latencyP50 ?? 0,
    metrics: toLegacyMetrics(check),
    issues: toLegacyIssues(check),
    timestamp: check.checkedAt,
  };
}

export function isActiveHealthStatus(status: string): boolean {
  const normalizedStatus = toLegacyStatus(status);
  return normalizedStatus === "unhealthy" || normalizedStatus === "degraded";
}

function isStaleHealthCheck(check: HealthCheckResult | undefined, now: number): boolean {
  return !check || check.timestamp <= 0 || now - check.timestamp > HEALTH_CHECK_STALE_MS;
}

async function loadRecentHealthChecks(ctx: any, limit: number): Promise<CanonicalHealthCheck[]> {
  return await ctx.db
    .query("healthChecks")
    .withIndex("by_checked", (q) => q.gte("checkedAt", 0))
    .order("desc")
    .take(limit) as CanonicalHealthCheck[];
}

function getLatestNormalizedHealthChecks(checks: CanonicalHealthCheck[]): HealthCheckResult[] {
  const latestByComponent = new Map<string, HealthCheckResult>();
  for (const check of checks) {
    if (!latestByComponent.has(check.component)) {
      latestByComponent.set(check.component, normalizeHealthCheckDoc(check));
    }
  }
  return [...latestByComponent.values()];
}

/* ================================================================== */
/* HEALTH CHECK IMPLEMENTATIONS                                        */
/* ================================================================== */

/**
 * Check signal ingestion health
 */
async function checkSignalIngestion(ctx: any): Promise<HealthCheckResult> {
  const start = Date.now();
  const issues: string[] = [];
  const metrics: Record<string, number> = {};

  try {
    // Check recent signals
    const recentSignals = await ctx.runQuery(
      internal.domains.signals.signalIngester.getRecentSignals,
      { limit: 100 }
    );

    metrics.recentSignalCount = recentSignals.length;

    // Check for stale ingestion (no signals in last hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const freshSignals = recentSignals.filter((s: Doc<"signals">) => s.ingestedAt > oneHourAgo);

    if (recentSignals.length > 0 && freshSignals.length === 0) {
      issues.push("No signals ingested in the last hour");
    }

    metrics.freshSignalCount = freshSignals.length;
    metrics.ingestionIdle = recentSignals.length === 0 ? 1 : 0;

    // Check error rate
    const errorSignals = recentSignals.filter((s: Doc<"signals">) => s.status === "error");
    metrics.errorRate = recentSignals.length > 0 ? errorSignals.length / recentSignals.length : 0;

    if (metrics.errorRate > HEALTH_CONFIG.errorRateCritical) {
      issues.push(`High error rate: ${(metrics.errorRate * 100).toFixed(1)}%`);
    }

    const latencyMs = Date.now() - start;
    let status: ComponentStatus = "healthy";

    if (issues.length > 0) {
      status = metrics.errorRate > 0.3 ? "unhealthy" : "degraded";
    }

    return { component: "signal_ingestion", status, latencyMs, metrics, issues, timestamp: Date.now() };
  } catch (error) {
    return {
      component: "signal_ingestion",
      status: "unhealthy",
      latencyMs: Date.now() - start,
      metrics: {},
      issues: [`Health check failed: ${error}`],
      timestamp: Date.now(),
    };
  }
}

/**
 * Check research queue health
 */
async function checkResearchQueue(ctx: any): Promise<HealthCheckResult> {
  const start = Date.now();
  const issues: string[] = [];
  const metrics: Record<string, number> = {};

  try {
    // Get queue stats
    const stats = await ctx.runQuery(
      internal.domains.research.researchQueue.getQueueStats,
      {}
    );

    metrics.queuedTasks = stats.queued;
    metrics.researchingTasks = stats.researching;
    metrics.completedToday = stats.completedToday;
    metrics.failedToday = stats.failedToday;

    // Check for queue backup
    if (stats.queued > HEALTH_CONFIG.queueDepthWarning) {
      issues.push(`Queue backlog: ${stats.queued} tasks waiting`);
    }

    // Check for stuck tasks
    if (stats.researching > 10) {
      issues.push(`Many tasks in progress: ${stats.researching}`);
    }

    // Check failure rate
    const totalProcessed = stats.completedToday + stats.failedToday;
    metrics.failureRate = totalProcessed > 0 ? stats.failedToday / totalProcessed : 0;

    if (metrics.failureRate > HEALTH_CONFIG.errorRateCritical) {
      issues.push(`High failure rate: ${(metrics.failureRate * 100).toFixed(1)}%`);
    }

    const latencyMs = Date.now() - start;
    let status: ComponentStatus = "healthy";

    if (issues.length > 0) {
      status = metrics.failureRate > 0.3 || stats.queued > 100 ? "unhealthy" : "degraded";
    }

    return { component: "research_queue", status, latencyMs, metrics, issues, timestamp: Date.now() };
  } catch (error) {
    return {
      component: "research_queue",
      status: "unhealthy",
      latencyMs: Date.now() - start,
      metrics: {},
      issues: [`Health check failed: ${error}`],
      timestamp: Date.now(),
    };
  }
}

/**
 * Check publishing health
 */
async function checkPublishing(ctx: any): Promise<HealthCheckResult> {
  const start = Date.now();
  const issues: string[] = [];
  const metrics: Record<string, number> = {};

  try {
    // Get publishing stats
    const stats = await ctx.runQuery(
      internal.domains.publishing.publishingOrchestrator.getPublishingStats,
      {}
    );

    metrics.pendingTasks = stats.pending;
    metrics.publishedToday = stats.publishedToday;
    metrics.failedToday = stats.failedToday;

    // Check for publishing backup
    if (stats.pending > 50) {
      issues.push(`Publishing backlog: ${stats.pending} tasks waiting`);
    }

    // Check failure rate
    const totalProcessed = stats.publishedToday + stats.failedToday;
    metrics.failureRate = totalProcessed > 0 ? stats.failedToday / totalProcessed : 0;

    if (metrics.failureRate > 0.2) {
      issues.push(`Publishing failure rate: ${(metrics.failureRate * 100).toFixed(1)}%`);
    }

    const latencyMs = Date.now() - start;
    let status: ComponentStatus = "healthy";

    if (issues.length > 0) {
      status = metrics.failureRate > 0.3 ? "unhealthy" : "degraded";
    }

    return { component: "publishing", status, latencyMs, metrics, issues, timestamp: Date.now() };
  } catch (error) {
    return {
      component: "publishing",
      status: "unhealthy",
      latencyMs: Date.now() - start,
      metrics: {},
      issues: [`Health check failed: ${error}`],
      timestamp: Date.now(),
    };
  }
}

/**
 * Check delivery queue health
 */
async function checkDelivery(ctx: any): Promise<HealthCheckResult> {
  const start = Date.now();
  const issues: string[] = [];
  const metrics: Record<string, number> = {};

  try {
    // Get delivery stats
    const stats = await ctx.runQuery(
      internal.domains.publishing.deliveryQueue.getDeliveryStats,
      {}
    );

    metrics.pendingJobs = stats.pending;
    metrics.deliveredToday = stats.deliveredToday;
    metrics.failedToday = stats.failedToday;
    metrics.retriesExhausted = stats.retriesExhausted;

    // Check for delivery backup
    if (stats.pending > 100) {
      issues.push(`Delivery backlog: ${stats.pending} jobs waiting`);
    }

    // Check for exhausted retries
    if (stats.retriesExhausted > 10) {
      issues.push(`${stats.retriesExhausted} deliveries exhausted retries`);
    }

    // Check failure rate
    const totalProcessed = stats.deliveredToday + stats.failedToday;
    metrics.failureRate = totalProcessed > 0 ? stats.failedToday / totalProcessed : 0;

    if (metrics.failureRate > 0.2) {
      issues.push(`Delivery failure rate: ${(metrics.failureRate * 100).toFixed(1)}%`);
    }

    const latencyMs = Date.now() - start;
    let status: ComponentStatus = "healthy";

    if (issues.length > 0) {
      status = metrics.failureRate > 0.3 || stats.retriesExhausted > 20 ? "unhealthy" : "degraded";
    }

    return { component: "delivery", status, latencyMs, metrics, issues, timestamp: Date.now() };
  } catch (error) {
    return {
      component: "delivery",
      status: "unhealthy",
      latencyMs: Date.now() - start,
      metrics: {},
      issues: [`Health check failed: ${error}`],
      timestamp: Date.now(),
    };
  }
}

/**
 * Check entity lifecycle health
 */
async function checkEntityLifecycle(ctx: any): Promise<HealthCheckResult> {
  const start = Date.now();
  const issues: string[] = [];
  const metrics: Record<string, number> = {};

  try {
    // Get lifecycle stats
    const stats = await ctx.runQuery(
      internal.domains.entities.entityLifecycle.getLifecycleStats,
      {}
    );

    metrics.totalEntities = stats.total;
    metrics.freshEntities = stats.fresh;
    metrics.staleEntities = stats.stale;
    metrics.criticalEntities = stats.critical;
    metrics.avgDecayScore = stats.avgDecayScore;

    // Check for high staleness
    const staleRatio = stats.total > 0 ? stats.stale / stats.total : 0;
    if (staleRatio > 0.3) {
      issues.push(`High staleness: ${(staleRatio * 100).toFixed(0)}% of entities are stale`);
    }

    // Check for critical entities
    if (stats.critical > 20) {
      issues.push(`${stats.critical} entities in critical state`);
    }

    const latencyMs = Date.now() - start;
    let status: ComponentStatus = "healthy";

    if (issues.length > 0) {
      status = stats.critical > 50 || staleRatio > 0.5 ? "unhealthy" : "degraded";
    }

    return { component: "entity_lifecycle", status, latencyMs, metrics, issues, timestamp: Date.now() };
  } catch (error) {
    return {
      component: "entity_lifecycle",
      status: "unhealthy",
      latencyMs: Date.now() - start,
      metrics: {},
      issues: [`Health check failed: ${error}`],
      timestamp: Date.now(),
    };
  }
}

/**
 * Check validation health
 */
async function checkValidation(ctx: any): Promise<HealthCheckResult> {
  const start = Date.now();
  const issues: string[] = [];
  const metrics: Record<string, number> = {};

  try {
    // Get contradiction stats
    const stats = await ctx.runQuery(
      internal.domains.validation.contradictionDetector.getContradictionStats,
      {}
    );

    metrics.totalContradictions = stats.total;
    metrics.unresolvedContradictions = stats.unresolved;
    metrics.criticalContradictions = stats.bySeverity.critical || 0;

    // Check for unresolved contradictions
    if (stats.unresolved > 50) {
      issues.push(`${stats.unresolved} unresolved contradictions`);
    }

    // Check for critical contradictions
    if ((stats.bySeverity.critical || 0) > 5) {
      issues.push(`${stats.bySeverity.critical} critical contradictions need attention`);
    }

    const latencyMs = Date.now() - start;
    let status: ComponentStatus = "healthy";

    if (issues.length > 0) {
      status = (stats.bySeverity.critical || 0) > 10 ? "unhealthy" : "degraded";
    }

    return { component: "validation", status, latencyMs, metrics, issues, timestamp: Date.now() };
  } catch (error) {
    return {
      component: "validation",
      status: "unhealthy",
      latencyMs: Date.now() - start,
      metrics: {},
      issues: [`Health check failed: ${error}`],
      timestamp: Date.now(),
    };
  }
}

/**
 * Check budget health
 */
async function checkBudget(ctx: any): Promise<HealthCheckResult> {
  const start = Date.now();
  const issues: string[] = [];
  const metrics: Record<string, number> = {};

  try {
    // Get all persona budgets
    const budgets = await ctx.runQuery(
      internal.domains.personas.personaAutonomousAgent.getAllPersonaBudgets,
      {}
    );

    let totalBudget = 0;
    let totalRemaining = 0;
    let exhaustedPersonas = 0;

    for (const budget of budgets) {
      totalBudget += budget.dailyBudget;
      totalRemaining += budget.remainingBudget;

      if (budget.remainingBudget < budget.dailyBudget * 0.1) {
        exhaustedPersonas++;
      }
    }

    metrics.totalDailyBudget = totalBudget;
    metrics.remainingBudget = totalRemaining;
    metrics.exhaustedPersonas = exhaustedPersonas;
    metrics.utilizationRate = totalBudget > 0 ? (totalBudget - totalRemaining) / totalBudget : 0;

    // Check for exhausted personas
    if (exhaustedPersonas > budgets.length * 0.5) {
      issues.push(`${exhaustedPersonas}/${budgets.length} personas near budget exhaustion`);
    }

    // Check for over-utilization
    if (metrics.utilizationRate > 0.9) {
      issues.push("Budget utilization above 90%");
    }

    const latencyMs = Date.now() - start;
    let status: ComponentStatus = "healthy";

    if (issues.length > 0) {
      status = exhaustedPersonas > budgets.length * 0.7 ? "unhealthy" : "degraded";
    }

    return { component: "budget", status, latencyMs, metrics, issues, timestamp: Date.now() };
  } catch (error) {
    return {
      component: "budget",
      status: "unhealthy",
      latencyMs: Date.now() - start,
      metrics: {},
      issues: [`Health check failed: ${error}`],
      timestamp: Date.now(),
    };
  }
}

/**
 * Check database health (basic connectivity)
 */
async function checkDatabase(ctx: any): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    // Simple read operation to verify database connectivity
    await ctx.runQuery(internal.domains.observability.healthMonitor.pingDatabase, {});

    const latencyMs = Date.now() - start;
    const status: ComponentStatus = latencyMs > 1000 ? "degraded" : "healthy";
    const issues = latencyMs > 1000 ? ["Database latency high"] : [];

    return {
      component: "database",
      status,
      latencyMs,
      metrics: { queryLatencyMs: latencyMs },
      issues,
      timestamp: Date.now(),
    };
  } catch (error) {
    return {
      component: "database",
      status: "unhealthy",
      latencyMs: Date.now() - start,
      metrics: {},
      issues: [`Database connection failed: ${error}`],
      timestamp: Date.now(),
    };
  }
}

/* ================================================================== */
/* QUERIES                                                             */
/* ================================================================== */

/**
 * Simple database ping for health check
 */
export const pingDatabase = internalQuery({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    // Just verify we can query the database
    await ctx.db.query("healthChecks").first();
    return true;
  },
});

/**
 * Get latest health check results
 */
export const getLatestHealthChecks = internalQuery({
  args: {},
  handler: async (ctx): Promise<HealthCheckResult[]> => {
    const checks = await loadRecentHealthChecks(ctx, 50);
    return getLatestNormalizedHealthChecks(checks);
  },
});

/**
 * Get health check history for a component
 */
export const getHealthHistory = internalQuery({
  args: {
    component: v.string(),
    hours: v.optional(v.number()),
  },
  handler: async (ctx, { component, hours = 24 }): Promise<HealthCheckResult[]> => {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    const checks = await ctx.db
      .query("healthChecks")
      .withIndex("by_component", (q) => q.eq("component", component).gte("checkedAt", cutoff))
      .order("desc")
      .collect() as CanonicalHealthCheck[];

    return checks.map(normalizeHealthCheckDoc);
  },
});

/**
 * Get active alerts
 */
export const getActiveAlerts = internalQuery({
  args: {},
  handler: async (ctx): Promise<HealthCheckResult[]> => {
    const checks = await loadRecentHealthChecks(ctx, 100);
    return getLatestNormalizedHealthChecks(checks).filter((check) => isActiveHealthStatus(check.status));
  },
});

/**
 * Public query for health dashboard
 */
export const getSystemHealth = query({
  args: {},
  handler: async (ctx): Promise<SystemHealth> => {
    const checks = getLatestNormalizedHealthChecks(await loadRecentHealthChecks(ctx, 50));
    const checksByComponent = new Map(checks.map((check) => [check.component, check]));
    const now = Date.now();

    // Get latest check per component
    const components: Record<HealthCheckType, HealthCheckResult> = {} as Record<HealthCheckType, HealthCheckResult>;

    for (const type of HEALTH_COMPONENTS) {
      const check = checksByComponent.get(type);
      if (check && !isStaleHealthCheck(check, now)) {
        components[type] = {
          component: type,
          status: check.status,
          latencyMs: check.latencyMs,
          metrics: check.metrics,
          issues: check.issues,
          timestamp: check.timestamp,
        };
      } else {
        components[type] = {
          component: type,
          status: "unknown",
          latencyMs: 0,
          metrics: {},
          issues: [],
          timestamp: 0,
        };
      }
    }

    // Calculate overall status
    const statuses = Object.values(components).map((c) => c.status);
    let overall: ComponentStatus = "healthy";

    if (statuses.includes("unhealthy")) {
      overall = "unhealthy";
    } else if (statuses.includes("degraded")) {
      overall = "degraded";
    } else if (statuses.includes("unknown")) {
      overall = "degraded";
    }

    // Count active alerts
    const activeAlerts = Object.values(components).filter((check) => isActiveHealthStatus(check.status)).length;

    // Calculate uptime (simplified - time since last unhealthy check)
    const lastUnhealthy = checks
      .filter((check) => check.status === "unhealthy")
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    const lastChecked = Math.max(0, ...checks.map((check) => check.timestamp));
    const uptime = lastUnhealthy
      ? now - lastUnhealthy.timestamp
      : lastChecked > 0
        ? now - lastChecked
        : 0;

    return {
      overall,
      components,
      activeAlerts,
      lastChecked,
      uptime,
    };
  },
});

/* ================================================================== */
/* MUTATIONS                                                           */
/* ================================================================== */

/**
 * Store health check result
 */
export const storeHealthCheck = internalMutation({
  args: {
    component: v.string(),
    status: v.string(),
    latencyMs: v.number(),
    metrics: v.any(),
    issues: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"healthChecks">> => {
    const metrics = (args.metrics ?? {}) as Record<string, unknown>;
    const checkedAt = Date.now();
    const errorRate = asFiniteNumber(metrics.errorRate) ?? asFiniteNumber(metrics.failureRate) ?? 0;
    const throughput =
      asFiniteNumber(metrics.throughput) ??
      asFiniteNumber(metrics.recentSignalCount) ??
      asFiniteNumber(metrics.completedToday) ??
      asFiniteNumber(metrics.publishedToday);
    const queueDepth =
      asFiniteNumber(metrics.queueDepth) ??
      asFiniteNumber(metrics.queuedTasks) ??
      asFiniteNumber(metrics.pendingTasks);
    const oldestItemAge = asFiniteNumber(metrics.oldestItemAge);
    const memoryUsage = asFiniteNumber(metrics.memoryUsage);
    const cpuUsage = asFiniteNumber(metrics.cpuUsage);
    const recentErrors = toRecentErrors(args.issues, checkedAt);

    return await ctx.db.insert("healthChecks", {
      component: args.component,
      status: toCanonicalStatus(args.status),
      latencyP50: args.latencyMs,
      latencyP99: args.latencyMs,
      errorRate: Math.max(0, Math.min(1, errorRate)),
      ...(throughput !== undefined ? { throughput } : {}),
      ...(queueDepth !== undefined ? { queueDepth } : {}),
      ...(oldestItemAge !== undefined ? { oldestItemAge } : {}),
      ...(memoryUsage !== undefined ? { memoryUsage } : {}),
      ...(cpuUsage !== undefined ? { cpuUsage } : {}),
      ...(recentErrors ? { recentErrors } : {}),
      checkedAt,
      windowMinutes: Math.max(1, Math.round(asFiniteNumber(metrics.windowMinutes) ?? DEFAULT_HEALTH_WINDOW_MINUTES)),
    });
  },
});

/**
 * Acknowledge an alert
 */
export const acknowledgeAlert = internalMutation({
  args: { checkId: v.id("healthChecks") },
  handler: async (ctx, { checkId }): Promise<void> => {
    await ctx.db.patch(checkId, {
      acknowledged: true,
      acknowledgedAt: Date.now(),
    });
  },
});

/**
 * Cleanup old health checks (keep 7 days)
 */
export const cleanupOldHealthChecks = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const oldChecks = await ctx.runQuery(
      internal.domains.observability.healthMonitor.getOldHealthChecks,
      { before: sevenDaysAgo, limit: 500 }
    );

    let deleted = 0;
    for (const check of oldChecks) {
      await ctx.runMutation(
        internal.domains.observability.healthMonitor.deleteHealthCheck,
        { checkId: check._id }
      );
      deleted++;
    }

    console.log(`[HealthMonitor] Cleaned up ${deleted} old health checks`);
    return deleted;
  },
});

/**
 * Get old health checks for cleanup
 */
export const getOldHealthChecks = internalQuery({
  args: { before: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, { before, limit = 500 }): Promise<Doc<"healthChecks">[]> => {
    return await ctx.db
      .query("healthChecks")
      .withIndex("by_checked", (q) => q.lt("checkedAt", before))
      .order("desc")
      .take(limit) as Doc<"healthChecks">[];
  },
});

/**
 * Delete a health check
 */
export const deleteHealthCheck = internalMutation({
  args: { checkId: v.id("healthChecks") },
  handler: async (ctx, { checkId }): Promise<void> => {
    await ctx.db.delete(checkId);
  },
});

/* ================================================================== */
/* ACTIONS                                                             */
/* ================================================================== */

/**
 * Run all health checks
 */
export const runAllHealthChecks = internalAction({
  args: {},
  handler: async (ctx): Promise<SystemHealth> => {
    console.log("[HealthMonitor] Running all health checks...");

    const checkFunctions = [
      checkSignalIngestion,
      checkResearchQueue,
      checkPublishing,
      checkDelivery,
      checkEntityLifecycle,
      checkValidation,
      checkBudget,
      checkDatabase,
    ];

    const components: Record<HealthCheckType, HealthCheckResult> = {} as Record<HealthCheckType, HealthCheckResult>;
    let activeAlerts = 0;

    for (const checkFn of checkFunctions) {
      try {
        const result = await checkFn(ctx);
        components[result.component] = result;

        // Store the result
        await ctx.runMutation(
          internal.domains.observability.healthMonitor.storeHealthCheck,
          {
            component: result.component,
            status: result.status,
            latencyMs: result.latencyMs,
            metrics: result.metrics,
            issues: result.issues,
          }
        );

        if (result.status === "unhealthy" || result.status === "degraded") {
          activeAlerts++;
        }

        console.log(`[HealthMonitor] ${result.component}: ${result.status} (${result.latencyMs}ms)`);
      } catch (error) {
        console.error(`[HealthMonitor] Check failed:`, error);
      }
    }

    // Calculate overall status
    const statuses = Object.values(components).map((c) => c.status);
    let overall: ComponentStatus = "healthy";

    if (statuses.includes("unhealthy")) {
      overall = "unhealthy";
    } else if (statuses.includes("degraded")) {
      overall = "degraded";
    }

    console.log(`[HealthMonitor] Overall status: ${overall}, Active alerts: ${activeAlerts}`);

    return {
      overall,
      components,
      activeAlerts,
      lastChecked: Date.now(),
      uptime: 0, // Would need persistent tracking
    };
  },
});

/**
 * Health check tick for cron
 */
export const tickHealthCheck = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    await ctx.runAction(
      internal.domains.observability.healthMonitor.runAllHealthChecks,
      {}
    );
  },
});

/**
 * Generate health report
 */
export const generateHealthReport = internalAction({
  args: { hours: v.optional(v.number()) },
  handler: async (ctx, { hours = 24 }): Promise<{
    summary: string;
    uptimePercent: number;
    avgLatency: number;
    issueCount: number;
    recommendations: string[];
  }> => {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    const checks = await ctx.runQuery(
      internal.domains.observability.healthMonitor.getLatestHealthChecks,
      {}
    );

    // Calculate uptime percentage
    const healthyChecks = checks.filter((c: HealthCheckResult) => c.status === "healthy" && c.timestamp >= cutoff);
    const totalChecks = checks.filter((c: HealthCheckResult) => c.timestamp >= cutoff);
    const uptimePercent = totalChecks.length > 0 ? (healthyChecks.length / totalChecks.length) * 100 : 100;

    // Calculate average latency
    const avgLatency =
      checks.length > 0
        ? checks.reduce((sum: number, c: HealthCheckResult) => sum + c.latencyMs, 0) / checks.length
        : 0;

    // Count unique issues
    const allIssues = checks.flatMap((c: HealthCheckResult) => c.issues);
    const issueCount = new Set(allIssues).size;

    // Generate recommendations
    const recommendations: string[] = [];

    const unhealthyComponents = checks.filter((c: HealthCheckResult) => c.status === "unhealthy");
    if (unhealthyComponents.length > 0) {
      recommendations.push(
        `Investigate unhealthy components: ${unhealthyComponents.map((c: HealthCheckResult) => c.component).join(", ")}`
      );
    }

    if (avgLatency > 500) {
      recommendations.push("Consider performance optimization - average latency is high");
    }

    if (issueCount > 10) {
      recommendations.push("Multiple issues detected - prioritize resolution");
    }

    const summary = `${hours}h Health Report: ${uptimePercent.toFixed(1)}% uptime, ${avgLatency.toFixed(0)}ms avg latency, ${issueCount} unique issues`;

    return {
      summary,
      uptimePercent,
      avgLatency,
      issueCount,
      recommendations,
    };
  },
});
