import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action, internalQuery, query } from "../../_generated/server";
import { HEALTH_CONFIG } from "../../config/autonomousConfig";

type AutonomousAdminRole = "owner" | "admin" | "viewer";
type AutonomousAccessMode = "read" | "write";

const AUTONOMOUS_READ_ROLES = new Set<AutonomousAdminRole>([
  "owner",
  "admin",
  "viewer",
]);
const AUTONOMOUS_WRITE_ROLES = new Set<AutonomousAdminRole>([
  "owner",
  "admin",
]);

export async function requireAutonomousAdminAccess(
  ctx: any,
  userId: any,
  mode: AutonomousAccessMode,
): Promise<AutonomousAdminRole> {
  if (!userId) throw new Error("Not authenticated");

  const adminUser = await ctx.db
    .query("adminUsers")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .first();
  const role = adminUser?.role as AutonomousAdminRole | undefined;
  const allowedRoles = mode === "write" ? AUTONOMOUS_WRITE_ROLES : AUTONOMOUS_READ_ROLES;

  if (!role || !allowedRoles.has(role)) {
    throw new Error(
      mode === "write"
        ? "Access denied: autonomous maintenance requires an owner or admin"
        : "Access denied: autonomous operations are operator-only",
    );
  }

  return role;
}

type CountSummary = {
  total: number;
  byColumn: Record<string, number>;
};

export function summarizeColumnCounts(
  rows: Array<{ meta?: { column?: string | null } | null }>,
): CountSummary {
  const byColumn: Record<string, number> = {};
  for (const row of rows) {
    const column = String(row?.meta?.column ?? "unknown");
    byColumn[column] = (byColumn[column] ?? 0) + 1;
  }
  return {
    total: rows.length,
    byColumn,
  };
}

export function buildAttentionItems(input: {
  activeAlerts: Array<{ component: string; status: string; issues?: string[] }>;
  maintenanceErrors: string[];
  maintenanceWarnings: string[];
  hotspotInboxCount: number;
  hotspotHumanReviewCount: number;
  bugHumanApproveCount: number;
}) {
  const items: Array<{
    severity: "critical" | "warning" | "info";
    title: string;
    detail: string;
  }> = [];

  for (const alert of input.activeAlerts.slice(0, 4)) {
    items.push({
      severity: alert.status === "unhealthy" ? "critical" : "warning",
      title: `${alert.component} is ${alert.status}`,
      detail: Array.isArray(alert.issues) && alert.issues.length > 0 ? alert.issues[0] : "Health check reported issues.",
    });
  }

  for (const error of input.maintenanceErrors.slice(0, 3)) {
    items.push({
      severity: "critical",
      title: "Nightly maintenance failed a hard gate",
      detail: error,
    });
  }

  for (const warning of input.maintenanceWarnings.slice(0, 3)) {
    items.push({
      severity: "warning",
      title: "Nightly maintenance raised a warning",
      detail: warning,
    });
  }

  if (input.hotspotInboxCount > 0) {
    items.push({
      severity: "info",
      title: "Intent hotspots waiting in inbox",
      detail: `${input.hotspotInboxCount} hotspot cards still need operator review or auto-investigation.`,
    });
  }

  if (input.hotspotHumanReviewCount > 0) {
    items.push({
      severity: "info",
      title: "Intent hotspot briefs ready for review",
      detail: `${input.hotspotHumanReviewCount} hotspot cards already have investigation briefs attached.`,
    });
  }

  if (input.bugHumanApproveCount > 0) {
    items.push({
      severity: "info",
      title: "Bug cards are queued for approval",
      detail: `${input.bugHumanApproveCount} bug cards are waiting in human_approve.`,
    });
  }

  return items.slice(0, 8);
}

export const getAutonomousControlTowerSnapshot = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    await requireAutonomousAdminAccess(ctx, userId, "read");

    const systemHealth = await ctx.runQuery(internal.domains.observability.healthMonitor.getLatestHealthChecks, {});
    const activeAlerts = await ctx.runQuery(internal.domains.observability.healthMonitor.getActiveAlerts, {});
    const healingStats = await ctx.runQuery(internal.domains.observability.selfHealer.getHealingStats, { hours: 24 });
    const healingHistory = await ctx.runQuery(internal.domains.observability.selfHealer.getHealingHistory, {
      hours: 24,
      limit: 5,
    });
    const maintenanceState = await ctx.runQuery(internal.domains.operations.selfMaintenance.getLatestSelfMaintenanceSnapshot, {});
    const hotspotExport = await ctx.runQuery(internal.domains.analytics.intentSignals.exportIntentHotspotCardsForOps, {
      limit: 200,
    });
    const bugExport = await ctx.runQuery(internal.domains.operations.bugLoop.exportBugCardsForVault, {
      limit: 200,
      maxOccurrencesPerCard: 1,
    });

    const healthChecks = Array.isArray(systemHealth) ? systemHealth : [];
    const hotspotCards = Array.isArray((hotspotExport as any)?.cards) ? ((hotspotExport as any).cards as any[]) : [];
    const bugCards = Array.isArray((bugExport as any)?.cards) ? ((bugExport as any).cards as any[]) : [];

    const generatedAt = Date.now();
    const staleAfterMs =
      HEALTH_CONFIG.healthCheckIntervalMs * HEALTH_CONFIG.healthCheckStaleMultiplier;
    const staleComponents = healthChecks
      .filter((check) => {
        const timestamp = Number(check.timestamp ?? 0);
        return timestamp <= 0 || generatedAt - timestamp > staleAfterMs;
      })
      .map((check) => check.component);
    const unhealthyComponents = healthChecks
      .filter((check) => check.status === "unhealthy")
      .map((check) => check.component);
    const degradedComponents = healthChecks
      .filter((check) => check.status === "degraded")
      .map((check) => check.component);
    const latestHealthAt = healthChecks.reduce((max, check) => Math.max(max, Number(check.timestamp ?? 0)), 0);

    const maintenanceReport = (maintenanceState as any)?.report ?? null;
    const maintenanceRanAt = Number(maintenanceReport?.ranAtMs ?? (maintenanceState as any)?.capturedAt ?? 0);
    const maintenanceErrors = Array.isArray(maintenanceReport?.errors) ? maintenanceReport.errors.map(String) : [];
    const maintenanceWarnings = Array.isArray(maintenanceReport?.warnings) ? maintenanceReport.warnings.map(String) : [];

    const hotspotSummary = summarizeColumnCounts(hotspotCards);
    const bugSummary = summarizeColumnCounts(bugCards);
    const hotspotInboxCount = hotspotSummary.byColumn.inbox ?? 0;
    const hotspotHumanReviewCount = hotspotSummary.byColumn.human_review ?? 0;
    const bugHumanApproveCount = bugSummary.byColumn.human_approve ?? 0;

    const attentionItems = buildAttentionItems({
      activeAlerts: (Array.isArray(activeAlerts) ? activeAlerts : []).map((alert: any) => ({
        component: String(alert.component ?? "unknown"),
        status: String(alert.status ?? "unknown"),
        issues: Array.isArray(alert.issues) ? alert.issues.map(String) : [],
      })),
      maintenanceErrors,
      maintenanceWarnings,
      hotspotInboxCount,
      hotspotHumanReviewCount,
      bugHumanApproveCount,
    });

    const healingAttempted = Number((healingStats as any)?.attempted ?? 0);
    const healingSucceeded = Number((healingStats as any)?.succeeded ?? 0);

    return {
      generatedAt,
      health: {
        overall:
          unhealthyComponents.length > 0
            ? "unhealthy"
            : degradedComponents.length > 0
              ? "degraded"
              : staleComponents.length > 0
                ? "unknown"
                : healthChecks.length > 0
                ? "healthy"
                : "unknown",
        latestCheckAt: latestHealthAt || null,
        activeAlertCount: Array.isArray(activeAlerts) ? activeAlerts.length : 0,
        unhealthyComponents,
        degradedComponents,
        staleComponents,
      },
      healing: {
        attempted24h: healingAttempted,
        succeeded24h: healingSucceeded,
        failed24h: Number((healingStats as any)?.failed ?? 0),
        escalated24h: Number((healingStats as any)?.escalated ?? 0),
        successRate24h: healingAttempted > 0 ? Number(((healingSucceeded / healingAttempted) * 100).toFixed(1)) : 0,
        recentActions: (Array.isArray(healingHistory) ? healingHistory : []).map((item: any) => ({
          issue: String(item.issue ?? "unknown issue"),
          actionType: String(item.actionType ?? "unknown"),
          status: String(item.status ?? "unknown"),
          timestamp: Number(item.timestamp ?? 0),
          result: item.result ? String(item.result) : null,
        })),
      },
      maintenance: {
        lastRunAt: maintenanceRanAt || null,
        passed: maintenanceReport?.passed === true,
        workflowId: maintenanceReport?.workflowId ? String(maintenanceReport.workflowId) : null,
        errorCount: maintenanceErrors.length,
        warningCount: maintenanceWarnings.length,
        errors: maintenanceErrors.slice(0, 3),
        warnings: maintenanceWarnings.slice(0, 3),
        hotspotSync: maintenanceReport?.details?.intentTelemetry?.hotspotSync ?? null,
        autoInvestigate: maintenanceReport?.details?.intentTelemetry?.autoInvestigate ?? null,
      },
      loops: {
        intentHotspots: hotspotSummary,
        bugCards: bugSummary,
      },
      attentionItems,
    };
  },
});

export const assertAutonomousMaintenanceAccess = internalQuery({
  args: {
    userId: v.id("users"),
  },
  returns: v.object({
    role: v.union(v.literal("owner"), v.literal("admin")),
  }),
  handler: async (ctx, args) => ({
    role: await requireAutonomousAdminAccess(ctx, args.userId, "write") as "owner" | "admin",
  }),
});

export const runAutonomousMaintenanceNow = action({
  args: {
    includeLlmExplanation: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    await ctx.runQuery(
      internal.domains.operations.autonomousControlTower.assertAutonomousMaintenanceAccess,
      { userId },
    );

    const health = await ctx.runAction(internal.domains.observability.healthMonitor.runAllHealthChecks, {});
    const healing = await ctx.runAction(internal.domains.observability.selfHealer.runSelfHealing, {});
    const maintenance = await ctx.runAction(internal.domains.operations.selfMaintenance.runNightlySelfMaintenance, {
      includeLlmExplanation: args.includeLlmExplanation ?? false,
    });

    return {
      ranAt: Date.now(),
      health,
      healing,
      maintenance,
    };
  },
});
