/**
 * Post-Execution Hygiene — Layer G operational hardening
 *
 * Three subsystems:
 * 1. Spot-fix runner — detect and fix common issues automatically
 * 2. Telemetry auditor — validate data quality across inference calls
 * 3. Housekeeping — expire stale data, cleanup orphans
 *
 * v2 plan section 15 (Post-Execution Hygiene)
 */

import { v } from "convex/values";
import { mutation, query, action } from "../../_generated/server";
import { internal } from "../../_generated/api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALE_MISSION_HOURS = 72; // Missions executing > 72h are stale
const STALE_TASK_HOURS = 24; // Tasks in_progress > 24h are stale
const ORPHAN_ARTIFACT_DAYS = 30; // Artifacts with no references after 30 days
const MAX_HOUSEKEEPING_BATCH = 100; // Bound cleanup operations per run
const TELEMETRY_ANOMALY_THRESHOLD = 3; // Standard deviations for cost/latency anomalies

// ---------------------------------------------------------------------------
// 1. Spot-Fix Runner — detect common issues
// ---------------------------------------------------------------------------

export const runSpotFixScan = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const issues: Array<{
      type: string;
      severity: "p0" | "p1" | "p2";
      entity: string;
      entityId: string;
      description: string;
      suggestedFix: string;
    }> = [];

    // Check 1: Stale executing missions
    const staleMissions = await ctx.db
      .query("missions")
      .withIndex("by_status_updated", (q) => q.eq("status", "executing"))
      .collect();

    for (const m of staleMissions) {
      const hoursStale = (now - m.updatedAt) / 3600000;
      if (hoursStale > STALE_MISSION_HOURS) {
        issues.push({
          type: "stale_mission",
          severity: "p1",
          entity: "missions",
          entityId: m._id,
          description: `Mission "${m.title}" executing for ${Math.round(hoursStale)}h without update`,
          suggestedFix: "Cancel or investigate stuck agent",
        });
      }
    }

    // Check 2: Stale in-progress tasks
    const staleTasks = await ctx.db
      .query("missions")
      .withIndex("by_status_updated", (q) => q.eq("status", "executing"))
      .take(20);

    for (const mission of staleTasks) {
      const tasks = await ctx.db
        .query("taskPlans")
        .withIndex("by_mission_order", (q) => q.eq("missionId", mission._id))
        .collect();

      for (const task of tasks) {
        if (task.status === "in_progress") {
          const hoursStale = (now - task.updatedAt) / 3600000;
          if (hoursStale > STALE_TASK_HOURS) {
            issues.push({
              type: "stale_task",
              severity: "p1",
              entity: "taskPlans",
              entityId: task._id,
              description: `Task "${task.title}" in_progress for ${Math.round(hoursStale)}h`,
              suggestedFix: "Release task claim or force-retry",
            });
          }
        }
      }
    }

    // Check 3: Blocked tasks with completed dependencies
    for (const mission of staleTasks) {
      const tasks = await ctx.db
        .query("taskPlans")
        .withIndex("by_mission_order", (q) => q.eq("missionId", mission._id))
        .collect();

      const completedKeys = new Set(
        tasks.filter((t) => t.status === "completed").map((t) => t.taskKey),
      );

      for (const task of tasks) {
        if (task.status === "blocked") {
          const allDepsMet = task.dependsOn.every((dep) => completedKeys.has(dep));
          if (allDepsMet) {
            issues.push({
              type: "blocked_with_completed_deps",
              severity: "p0",
              entity: "taskPlans",
              entityId: task._id,
              description: `Task "${task.title}" blocked but all dependencies are completed`,
              suggestedFix: "Unblock task (dependency resolution missed)",
            });
          }
        }
      }
    }

    // Check 4: Pending sniff checks older than 24h
    const pendingSniffs = await ctx.db
      .query("sniffChecks")
      .withIndex("by_status_created", (q) => q.eq("status", "pending"))
      .take(50);

    for (const sc of pendingSniffs) {
      const hoursOld = (now - sc.createdAt) / 3600000;
      if (hoursOld > 24) {
        issues.push({
          type: "stale_sniff_check",
          severity: "p2",
          entity: "sniffChecks",
          entityId: sc._id,
          description: `Sniff check pending for ${Math.round(hoursOld)}h`,
          suggestedFix: "Assign reviewer or auto-approve if low-stakes",
        });
      }
    }

    // Check 5: Failed index jobs not retried
    const failedJobs = await ctx.db
      .query("artifactIndexJobs")
      .order("desc")
      .take(100);

    const recentFailed = failedJobs.filter(
      (j) => j.status === "failed" && now - j.updatedAt < 24 * 3600000,
    );
    if (recentFailed.length > 5) {
      issues.push({
        type: "high_index_failure_rate",
        severity: "p1",
        entity: "artifactIndexJobs",
        entityId: "aggregate",
        description: `${recentFailed.length} failed index jobs in last 24h`,
        suggestedFix: "Check ingestion pipeline and retry failed jobs",
      });
    }

    return {
      scannedAt: now,
      issueCount: issues.length,
      byPriority: {
        p0: issues.filter((i) => i.severity === "p0").length,
        p1: issues.filter((i) => i.severity === "p1").length,
        p2: issues.filter((i) => i.severity === "p2").length,
      },
      issues,
    };
  },
});

export const applySpotFix = mutation({
  args: {
    fixType: v.union(
      v.literal("unblock_task"),
      v.literal("cancel_stale_mission"),
      v.literal("release_stale_task"),
      v.literal("auto_approve_sniff_check"),
    ),
    entityId: v.string(),
  },
  handler: async (ctx, { fixType, entityId }) => {
    const now = Date.now();

    if (fixType === "unblock_task") {
      const task = await ctx.db.get(entityId as any);
      if (task && (task as any).status === "blocked") {
        await ctx.db.patch(entityId as any, { status: "pending", updatedAt: now });
        return { applied: true, action: "Task unblocked" };
      }
    }

    if (fixType === "cancel_stale_mission") {
      const mission = await ctx.db.get(entityId as any);
      if (mission) {
        await ctx.db.patch(entityId as any, { status: "cancelled", completedAt: now, updatedAt: now });
        return { applied: true, action: "Mission cancelled" };
      }
    }

    if (fixType === "release_stale_task") {
      const task = await ctx.db.get(entityId as any);
      if (task && (task as any).status === "in_progress") {
        await ctx.db.patch(entityId as any, {
          status: "pending",
          assignedAgent: undefined,
          updatedAt: now,
        });
        return { applied: true, action: "Task released for re-claim" };
      }
    }

    if (fixType === "auto_approve_sniff_check") {
      const sc = await ctx.db.get(entityId as any);
      if (sc && (sc as any).status === "pending") {
        await ctx.db.patch(entityId as any, {
          status: "approved",
          reviewerNotes: "Auto-approved by hygiene runner (stale >24h)",
          resolvedAt: now,
        });
        return { applied: true, action: "Sniff check auto-approved" };
      }
    }

    return { applied: false, action: "No matching fix available" };
  },
});

// ---------------------------------------------------------------------------
// 2. Telemetry Auditor — validate inference call data quality
// ---------------------------------------------------------------------------

export const auditTelemetry = query({
  args: {
    sinceDaysAgo: v.optional(v.number()),
  },
  handler: async (ctx, { sinceDaysAgo }) => {
    const since = Date.now() - (sinceDaysAgo ?? 1) * 86400000;

    const calls = await ctx.db
      .query("inferenceCalls")
      .order("desc")
      .take(500);

    const recent = calls.filter((c) => c.createdAt >= since);

    if (recent.length === 0) {
      return { status: "no_data", anomalies: [], metrics: null };
    }

    const anomalies: Array<{
      type: string;
      callKey: string;
      model: string;
      value: number;
      threshold: number;
      description: string;
    }> = [];

    // Calculate baselines per model
    const byModel = new Map<string, typeof recent>();
    for (const call of recent) {
      const arr = byModel.get(call.model) ?? [];
      arr.push(call);
      byModel.set(call.model, arr);
    }

    for (const [model, modelCalls] of byModel) {
      // Cost anomaly detection
      const costs = modelCalls.filter((c) => c.costUsd > 0).map((c) => c.costUsd);
      if (costs.length > 10) {
        const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
        const stdDev = Math.sqrt(
          costs.reduce((sum, c) => sum + (c - mean) ** 2, 0) / costs.length,
        );
        const threshold = mean + TELEMETRY_ANOMALY_THRESHOLD * stdDev;

        for (const call of modelCalls) {
          if (call.costUsd > threshold) {
            anomalies.push({
              type: "cost_spike",
              callKey: call.callKey,
              model,
              value: call.costUsd,
              threshold,
              description: `Cost $${call.costUsd.toFixed(4)} exceeds ${TELEMETRY_ANOMALY_THRESHOLD}σ threshold ($${threshold.toFixed(4)})`,
            });
          }
        }
      }

      // Latency anomaly detection
      const latencies = modelCalls.map((c) => c.latencyMs);
      if (latencies.length > 10) {
        const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const stdDev = Math.sqrt(
          latencies.reduce((sum, l) => sum + (l - mean) ** 2, 0) / latencies.length,
        );
        const threshold = mean + TELEMETRY_ANOMALY_THRESHOLD * stdDev;

        for (const call of modelCalls) {
          if (call.latencyMs > threshold) {
            anomalies.push({
              type: "latency_spike",
              callKey: call.callKey,
              model,
              value: call.latencyMs,
              threshold,
              description: `Latency ${call.latencyMs}ms exceeds ${TELEMETRY_ANOMALY_THRESHOLD}σ threshold (${Math.round(threshold)}ms)`,
            });
          }
        }
      }

      // Zero-cost detection (suspicious)
      const zeroCost = modelCalls.filter((c) => c.costUsd === 0 && c.status === "success");
      if (zeroCost.length > 0 && zeroCost.length > modelCalls.length * 0.1) {
        anomalies.push({
          type: "zero_cost_suspicious",
          callKey: zeroCost[0].callKey,
          model,
          value: zeroCost.length,
          threshold: modelCalls.length * 0.1,
          description: `${zeroCost.length} successful calls with zero cost (${Math.round(zeroCost.length / modelCalls.length * 100)}%)`,
        });
      }
    }

    // Overall metrics
    const totalCost = recent.reduce((s, c) => s + c.costUsd, 0);
    const totalTokens = recent.reduce((s, c) => s + c.inputTokens + c.outputTokens, 0);
    const errorCount = recent.filter((c) => c.status !== "success").length;

    return {
      status: "complete",
      periodDays: sinceDaysAgo ?? 1,
      metrics: {
        callCount: recent.length,
        totalCostUsd: Math.round(totalCost * 10000) / 10000,
        totalTokens,
        errorRate: Math.round((errorCount / recent.length) * 1000) / 1000,
        uniqueModels: byModel.size,
        avgCostPerCall: Math.round((totalCost / recent.length) * 10000) / 10000,
      },
      anomalies: anomalies.slice(0, 50), // Cap anomaly output
    };
  },
});

// ---------------------------------------------------------------------------
// 3. Housekeeping — cleanup stale data
// ---------------------------------------------------------------------------

export const getHousekeepingStatus = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Count expired recommendations
    const pendingRecs = await ctx.db
      .query("routingRecommendations")
      .withIndex("by_status_created", (q) => q.eq("status", "pending"))
      .take(100);
    const expiredRecs = pendingRecs.filter(
      (r) => now - r.createdAt > 7 * 86400000, // >7 days old
    );

    // Count stale canary runs (>90 days)
    const oldCanary = await ctx.db
      .query("canaryRuns")
      .withIndex("by_created", (q) => q)
      .order("asc")
      .take(50);
    const staleCanary = oldCanary.filter(
      (r) => now - r.createdAt > 90 * 86400000,
    );

    // Count failed missions that are old
    const failedMissions = await ctx.db
      .query("missions")
      .withIndex("by_status_updated", (q) => q.eq("status", "failed"))
      .take(50);
    const oldFailed = failedMissions.filter(
      (m) => now - m.updatedAt > 30 * 86400000,
    );

    return {
      expiredRecommendations: expiredRecs.length,
      staleCanaryRuns: staleCanary.length,
      oldFailedMissions: oldFailed.length,
      totalCleanupCandidates: expiredRecs.length + staleCanary.length + oldFailed.length,
    };
  },
});

export const runHousekeeping = mutation({
  args: {
    expireRecommendations: v.optional(v.boolean()),
    archiveOldCanary: v.optional(v.boolean()),
    cleanupFailedMissions: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const actions: string[] = [];
    let cleaned = 0;

    // Expire old pending recommendations
    if (args.expireRecommendations) {
      const pendingRecs = await ctx.db
        .query("routingRecommendations")
        .withIndex("by_status_created", (q) => q.eq("status", "pending"))
        .take(MAX_HOUSEKEEPING_BATCH);

      for (const rec of pendingRecs) {
        if (now - rec.createdAt > 7 * 86400000) {
          await ctx.db.patch(rec._id, { status: "expired" });
          cleaned++;
        }
      }
      if (cleaned > 0) actions.push(`Expired ${cleaned} stale recommendations`);
    }

    // Mark old failed missions as archived (set status to cancelled)
    if (args.cleanupFailedMissions) {
      let missionsCleaned = 0;
      const failedMissions = await ctx.db
        .query("missions")
        .withIndex("by_status_updated", (q) => q.eq("status", "failed"))
        .take(MAX_HOUSEKEEPING_BATCH);

      for (const m of failedMissions) {
        if (now - m.updatedAt > 30 * 86400000) {
          await ctx.db.patch(m._id, { status: "cancelled", updatedAt: now });
          missionsCleaned++;
        }
      }
      if (missionsCleaned > 0) actions.push(`Archived ${missionsCleaned} old failed missions`);
      cleaned += missionsCleaned;
    }

    return {
      cleanedAt: now,
      totalCleaned: cleaned,
      actions,
    };
  },
});

// ---------------------------------------------------------------------------
// Combined hygiene report
// ---------------------------------------------------------------------------

export const getHygieneReport = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Quick spot check counts
    const executingMissions = await ctx.db
      .query("missions")
      .withIndex("by_status_updated", (q) => q.eq("status", "executing"))
      .take(50);
    const stale = executingMissions.filter(
      (m) => (now - m.updatedAt) / 3600000 > STALE_MISSION_HOURS,
    );

    const pendingSniffs = await ctx.db
      .query("sniffChecks")
      .withIndex("by_status_created", (q) => q.eq("status", "pending"))
      .take(50);
    const oldSniffs = pendingSniffs.filter(
      (s) => (now - s.createdAt) / 3600000 > 24,
    );

    // Recent error rate
    const recentCalls = await ctx.db
      .query("inferenceCalls")
      .order("desc")
      .take(100);
    const recentErrors = recentCalls.filter((c) => c.status !== "success").length;

    return {
      generatedAt: now,
      health: {
        staleMissions: stale.length,
        staleSniffChecks: oldSniffs.length,
        activeMissions: executingMissions.length,
        pendingSniffChecks: pendingSniffs.length,
        recentErrorRate: recentCalls.length > 0
          ? Math.round((recentErrors / recentCalls.length) * 100)
          : 0,
      },
      needsAttention: stale.length > 0 || oldSniffs.length > 3 || recentErrors > recentCalls.length * 0.2,
    };
  },
});
