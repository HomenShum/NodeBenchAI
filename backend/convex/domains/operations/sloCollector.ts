// convex/domains/operations/sloCollector.ts
// SLO Measurement Collector with Multi-Window Burn-Rate Evaluation
//
// Implements the Google SRE burn-rate alerting logic:
// - Computes burn rates over multiple windows
// - Requires BOTH windows to breach before alerting
// - Handles minimum-event gating for low-volume SLIs
// - Implements dedupe and suppression logic
//
// ============================================================================

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  SERVICE_LEVEL_OBJECTIVES,
  ALERT_CONFIGURATIONS,
  type ServiceLevelObjective,
  type AlertConfig,
  type WindowSpec,
  type BurnRateClause,
  type MultiWindowBurnRateCondition,
  type ComplianceCondition,
} from "./sloFramework";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/* ------------------------------------------------------------------ */
/* EVALUATION RESULT TYPES                                             */
/* ------------------------------------------------------------------ */

export interface WindowStats {
  total: number;
  bad: number;
}

export interface BurnRateEval {
  eligible: boolean;
  reasonIneligible?: "NO_DATA" | "INSUFFICIENT_EVENTS" | "ZERO_ERROR_BUDGET";
  badRatio?: number;
  burnRate?: number;
  breached?: boolean;
}

export interface ClauseEval {
  clause: BurnRateClause;
  long: BurnRateEval;
  short: BurnRateEval;
  breached: boolean;   // true if requireBothWindows satisfied
  eligible: boolean;   // true if both windows eligible
}

export interface MultiWindowEval {
  condition: MultiWindowBurnRateCondition;
  clauses: ClauseEval[];
  eligible: boolean;
  breached: boolean;    // true if ANY clause breached
  winningClauseIndex?: number;
}

export interface ComplianceEval {
  eligible: boolean;
  breached: boolean;
  details?: Record<string, unknown>;
}

export interface ActiveAlertState {
  alertId: string;
  sloId: string;
  status: "active" | "resolved";
  lastTriggeredAtMs: number;
  dedupeKey?: string;
}

/* ------------------------------------------------------------------ */
/* CORE BURN-RATE EVALUATION FUNCTIONS                                */
/* ------------------------------------------------------------------ */

export function computeBurnRate(
  bad: number,
  total: number,
  allowedBadFraction: number
): BurnRateEval {
  if (allowedBadFraction <= 0) {
    return { eligible: false, reasonIneligible: "ZERO_ERROR_BUDGET" };
  }
  if (total <= 0) {
    return { eligible: false, reasonIneligible: "NO_DATA" };
  }

  const badRatio = bad / total;
  const burnRate = badRatio / allowedBadFraction;
  return { eligible: true, badRatio, burnRate };
}

export function passesMinEventGates(
  stats: WindowStats,
  spec: WindowSpec,
  defaultMinTotal?: number
): boolean {
  const minTotal = spec.minTotal ?? defaultMinTotal;
  if (minTotal !== undefined && stats.total < minTotal) return false;

  if (spec.minBad !== undefined && stats.bad < spec.minBad) return false;
  return true;
}

/**
 * Evaluate multi-window burn-rate condition
 */
export function evaluateMultiWindowBurnRate(
  condition: MultiWindowBurnRateCondition,
  allowedBadFraction: number,
  getWindowStats: (durationMs: number) => WindowStats
): MultiWindowEval {
  const clauses: ClauseEval[] = condition.anyOf.map((clause) => {
    const longStats = getWindowStats(clause.long.durationMs);
    const shortStats = getWindowStats(clause.short.durationMs);

    const longEligibleByCount = passesMinEventGates(
      longStats,
      clause.long,
      condition.minTotalLongDefault
    );
    const shortEligibleByCount = passesMinEventGates(
      shortStats,
      clause.short,
      condition.minTotalShortDefault
    );

    const longBase = computeBurnRate(longStats.bad, longStats.total, allowedBadFraction);
    const shortBase = computeBurnRate(shortStats.bad, shortStats.total, allowedBadFraction);

    const long: BurnRateEval = longEligibleByCount && longBase.eligible
      ? { ...longBase, breached: (longBase.burnRate ?? 0) >= clause.long.burnRateThreshold }
      : { eligible: false, reasonIneligible: "INSUFFICIENT_EVENTS" };

    const short: BurnRateEval = shortEligibleByCount && shortBase.eligible
      ? { ...shortBase, breached: (shortBase.burnRate ?? 0) >= clause.short.burnRateThreshold }
      : { eligible: false, reasonIneligible: "INSUFFICIENT_EVENTS" };

    const eligible = long.eligible && short.eligible;
    const breached = eligible && clause.requireBothWindows
      ? Boolean(long.breached && short.breached)
      : false;

    return { clause, long, short, eligible, breached };
  });

  const breachedIdx = clauses.findIndex(c => c.breached);
  return {
    condition,
    clauses,
    eligible: clauses.some(c => c.eligible),
    breached: breachedIdx >= 0,
    winningClauseIndex: breachedIdx >= 0 ? breachedIdx : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* COMPLIANCE EVALUATION (Zero-Tolerance SLOs)                         */
/* ------------------------------------------------------------------ */

export async function evaluateComplianceAlert(
  check: ComplianceCondition["check"],
  params: Record<string, unknown> | undefined,
  deps: {
    getOverdueModels?: () => Promise<Array<{ modelId: string; riskTier: string; daysOverdue: number }>>;
    getApproachingDueModels?: (fromDays: number, toDays: number) => Promise<Array<{ modelId: string; riskTier: string; daysUntilDue: number }>>;
    getGroundTruthFreshnessSnapshots?: () => Promise<Array<{ asOfDay: string; freshnessPct: number }>>;
  }
): Promise<ComplianceEval> {
  if (check === "model_validation_currency") {
    const pageRiskTiers = (params?.pageRiskTiers as string[] | undefined) ?? [
      "tier1_critical",
      "tier2_significant",
    ];
    const ticketApproachingDays = (params?.ticketApproachingDays as { from: number; to: number } | undefined) ?? {
      from: 14,
      to: 7,
    };

    const overdue = await deps.getOverdueModels?.() ?? [];
    const overdueCritical = overdue.filter(m => pageRiskTiers.includes(m.riskTier));

    if (overdueCritical.length > 0) {
      return {
        eligible: true,
        breached: true,
        details: { mode: "page_overdue", overdueCritical },
      };
    }

    const approaching = await deps.getApproachingDueModels?.(
      ticketApproachingDays.from,
      ticketApproachingDays.to
    ) ?? [];
    if (approaching.length > 0) {
      return {
        eligible: true,
        breached: true,
        details: { mode: "ticket_approaching_due", approaching },
      };
    }

    return { eligible: true, breached: false };
  }

  if (check === "ground_truth_freshness") {
    const consecutiveBreaches = (params?.consecutiveBreaches as number | undefined) ?? 2;
    const targetPct = 80; // Aligns to SLO target

    const snaps = await deps.getGroundTruthFreshnessSnapshots?.() ?? [];
    const recent = snaps.slice(-consecutiveBreaches);
    const breached = (recent.length === consecutiveBreaches) &&
      recent.every(s => s.freshnessPct < targetPct);

    return {
      eligible: true,
      breached,
      details: { recent, targetPct, consecutiveBreaches },
    };
  }

  return {
    eligible: false,
    breached: false,
    details: { reason: "unknown_check" },
  };
}

/* ------------------------------------------------------------------ */
/* ALERT TRIGGER DECISION (Dedupe + Suppression)                      */
/* ------------------------------------------------------------------ */

export function isSuppressed(
  cfg: AlertConfig,
  activeAlerts: ActiveAlertState[]
): boolean {
  const mw = cfg.condition.type === "multi_window_burn_rate" ? cfg.condition : undefined;
  const suppression = mw?.suppression;
  if (!suppression) return false;

  const activeIds = new Set(activeAlerts.filter(a => a.status === "active").map(a => a.alertId));
  return suppression.suppressIfActiveAlertIds.some(id => activeIds.has(id));
}

export function shouldTriggerAlert(
  cfg: AlertConfig,
  evaluation: { eligible: boolean; breached: boolean },
  nowMs: number,
  activeAlertsForSlo: ActiveAlertState[],
  dedupeKey?: string
): { trigger: boolean; reason?: string } {
  if (!evaluation.eligible) return { trigger: false, reason: "not_eligible" };
  if (!evaluation.breached) return { trigger: false, reason: "not_breached" };

  if (isSuppressed(cfg, activeAlertsForSlo)) {
    return { trigger: false, reason: "suppressed" };
  }

  const cooldownMs = cfg.condition.cooldownMs;
  const existing = activeAlertsForSlo.find(a =>
    a.alertId === cfg.alertId &&
    a.status === "active" &&
    (dedupeKey ? a.dedupeKey === dedupeKey : true)
  );

  if (existing && (nowMs - existing.lastTriggeredAtMs) < cooldownMs) {
    return { trigger: false, reason: "cooldown_active" };
  }

  return { trigger: true };
}

/* ------------------------------------------------------------------ */
/* MAIN COLLECTION & EVALUATION WORKFLOW                               */
/* ------------------------------------------------------------------ */

/**
 * Collect SLO metrics and evaluate alerts
 */
export const collectAndEvaluateAlerts = internalAction({
  args: {},
  returns: v.object({
    collectedAt: v.number(),
    measurementsRecorded: v.number(),
    alertsTriggered: v.number(),
  }),
  handler: async (ctx): Promise<{
    collectedAt: number;
    measurementsRecorded: number;
    alertsTriggered: number;
  }> => {
    const collectedAt = Date.now();
    let measurementsRecorded = 0;
    let alertsTriggered = 0;

    // Collect metrics for each SLO
    for (const slo of SERVICE_LEVEL_OBJECTIVES) {
      // Collect current metric value
      const metricValue = await collectSloMetric(ctx, slo.sloId);
      if (metricValue === null) continue;

      // Record measurement
      await ctx.runMutation(internal.domains.operations.sloFramework.recordSloMeasurement, {
        sloId: slo.sloId,
        value: metricValue,
        metadata: { collectedAt },
      });
      measurementsRecorded++;
    }

    // Evaluate all alerts
    for (const alertCfg of ALERT_CONFIGURATIONS) {
      const slo = SERVICE_LEVEL_OBJECTIVES.find(s => s.sloId === alertCfg.sloId);
      if (!slo) continue;

      let evaluation: { eligible: boolean; breached: boolean; details?: unknown };
      let currentValue: number | undefined;
      let threshold: number | undefined;

      if (alertCfg.condition.type === "multi_window_burn_rate") {
        // Multi-window burn-rate evaluation
        const allowedBadFraction = slo.errorBudgetPercent / 100;

        const durations = new Set<number>();
        for (const clause of alertCfg.condition.anyOf) {
          durations.add(clause.long.durationMs);
          durations.add(clause.short.durationMs);
        }

        const statsByDurationMs = new Map<number, WindowStats>();
        for (const durationMs of durations) {
          const stats = await getWindowStatsForSlo(ctx, alertCfg.sloId, durationMs);
          statsByDurationMs.set(durationMs, stats);
        }

        const mwEval = evaluateMultiWindowBurnRate(
          alertCfg.condition,
          allowedBadFraction,
          (durationMs: number) => statsByDurationMs.get(durationMs) ?? { total: 0, bad: 0 }
        );
        evaluation = { eligible: mwEval.eligible, breached: mwEval.breached, details: mwEval };

        if (mwEval.winningClauseIndex != null) {
          const clauseEval = mwEval.clauses[mwEval.winningClauseIndex];
          currentValue = Math.max(
            clauseEval.long.burnRate ?? 0,
            clauseEval.short.burnRate ?? 0
          );
          threshold = Math.max(
            clauseEval.clause.long.burnRateThreshold,
            clauseEval.clause.short.burnRateThreshold
          );
        } else {
          currentValue = 0;
          threshold = Math.max(0, slo.target);
        }
      } else {
        // Compliance evaluation
        const complianceEval = await evaluateComplianceAlert(
          alertCfg.condition.check,
          alertCfg.condition.params,
          {
            getOverdueModels: async () => {
              const today = isoDay(Date.now());
              const all = await ctx.db.query("modelCards").collect();
              const overdue = all
                .filter((m: any) => isTier1Or2(m.riskTier))
                .map((m: any) => {
                  const due = typeof m.nextValidationDate === "string" ? m.nextValidationDate : null;
                  if (!due) {
                    return { modelId: String(m.modelId), riskTier: String(m.riskTier), daysOverdue: 9999 };
                  }
                  if (due >= today) return null;
                  const daysOverdue = Math.max(0, diffDays(dayToMs(today), dayToMs(due)));
                  return { modelId: String(m.modelId), riskTier: String(m.riskTier), daysOverdue };
                })
                .filter(
                  (x: any): x is { modelId: string; riskTier: string; daysOverdue: number } => x !== null
                );
              return overdue;
            },
            getApproachingDueModels: async (from, to) => {
              const today = isoDay(Date.now());
              const todayMs = dayToMs(today);
              const windowStartMs = todayMs + to * DAY;
              const windowEndMs = todayMs + from * DAY;
              const all = await ctx.db.query("modelCards").collect();
              const approaching = all
                .filter((m: any) => isTier1Or2(m.riskTier))
                .map((m: any) => {
                  const due = typeof m.nextValidationDate === "string" ? m.nextValidationDate : null;
                  if (!due) return null;
                  const dueMs = dayToMs(due);
                  if (dueMs < windowStartMs || dueMs > windowEndMs) return null;
                  const daysUntilDue = Math.max(0, diffDays(dueMs, todayMs));
                  return { modelId: String(m.modelId), riskTier: String(m.riskTier), daysUntilDue };
                })
                .filter(
                  (x: any): x is { modelId: string; riskTier: string; daysUntilDue: number } => x !== null
                );
              return approaching;
            },
            getGroundTruthFreshnessSnapshots: async () => {
              const snaps: Array<{ asOfDay: string; freshnessPct: number }> = [];
              for (const deltaDays of [1, 0]) {
                const asOfMs = Date.now() - deltaDays * DAY;
                const asOfDay = isoDay(asOfMs);
                const pct = await computeGroundTruthFreshnessPct(ctx, asOfMs);
                snaps.push({ asOfDay, freshnessPct: pct });
              }
              return snaps;
            },
          }
        );
        evaluation = complianceEval;
        currentValue = evaluation.breached ? 1 : 0;
        threshold = 0;
      }

      // Get active alerts for this SLO
      const activeAlerts = await ctx.runQuery(
        internal.domains.operations.sloFramework.getActiveAlertsForSlo,
        { sloId: alertCfg.sloId }
      );

      // Decide whether to trigger
      const decision = shouldTriggerAlert(
        alertCfg,
        evaluation,
        collectedAt,
        activeAlerts
      );

      if (decision.trigger) {
        // Trigger alert
        await ctx.runMutation(
          internal.domains.operations.sloFramework.recordAlertTrigger,
          {
            alertId: alertCfg.alertId,
            sloId: alertCfg.sloId,
            severity: alertCfg.severity,
            currentValue: currentValue ?? 0,
            threshold: threshold ?? slo.target,
            message: `Alert triggered for ${alertCfg.alertId} (${alertCfg.sloId})`,
            evaluationDetails: evaluation.details,
          }
        );
        alertsTriggered++;
      }
    }

    return {
      collectedAt,
      measurementsRecorded,
      alertsTriggered,
    };
  },
});

/**
 * Collect a single SLO metric value
 */
async function collectSloMetric(
  ctx: any,
  sloId: string
): Promise<number | null> {
  if (sloId === "slo_sec_edgar_availability") {
    const stats: WindowStats = await ctx.runQuery(
      internal.domains.operations.sloCollector.getSecEdgarAvailabilityWindowStats,
      { windowMs: HOUR }
    );
    if (stats.total <= 0) return null;
    return ((stats.total - stats.bad) / stats.total) * 100;
  }

  if (sloId === "slo_inconclusive_rate") {
    const stats: WindowStats = await ctx.runQuery(
      internal.domains.operations.sloCollector.getInconclusiveWindowStats,
      { windowMs: HOUR }
    );
    if (stats.total <= 0) return null;
    return (stats.bad / stats.total) * 100;
  }

  if (sloId === "slo_source_quality_accuracy") {
    const stats: WindowStats = await ctx.runQuery(
      internal.domains.operations.sloCollector.getSourceQualityAccuracyWindowStats,
      { windowMs: 30 * DAY }
    );
    if (stats.total <= 0) return null;
    return ((stats.total - stats.bad) / stats.total) * 100;
  }

  if (sloId === "slo_repro_pack_success") {
    const stats: WindowStats = await ctx.runQuery(
      internal.domains.operations.sloCollector.getReproPackSuccessWindowStats,
      { windowMs: 30 * DAY }
    );
    if (stats.total <= 0) return null;
    return ((stats.total - stats.bad) / stats.total) * 100;
  }

  if (sloId === "slo_ground_truth_freshness") {
    return await computeGroundTruthFreshnessPct(ctx, Date.now());
  }

  if (sloId === "slo_model_validation_currency") {
    return await computeModelValidationCurrencyPct(ctx, Date.now());
  }

  // Not yet instrumented
  return null;
}

async function getWindowStatsForSlo(
  ctx: any,
  sloId: string,
  windowMs: number
): Promise<WindowStats> {
  if (sloId === "slo_inconclusive_rate") {
    return await ctx.runQuery(
      internal.domains.operations.sloCollector.getInconclusiveWindowStats,
      { windowMs }
    );
  }
  if (sloId === "slo_sec_edgar_availability") {
    return await ctx.runQuery(
      internal.domains.operations.sloCollector.getSecEdgarAvailabilityWindowStats,
      { windowMs }
    );
  }
  if (sloId === "slo_source_quality_accuracy") {
    return await ctx.runQuery(
      internal.domains.operations.sloCollector.getSourceQualityAccuracyWindowStats,
      { windowMs }
    );
  }
  if (sloId === "slo_repro_pack_success") {
    return await ctx.runQuery(
      internal.domains.operations.sloCollector.getReproPackSuccessWindowStats,
      { windowMs }
    );
  }

  return { total: 0, bad: 0 };
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayToMs(day: string): number {
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) throw new Error(`Invalid ISO day: ${day}`);
  return ms;
}

function diffDays(laterMs: number, earlierMs: number): number {
  return Math.floor((laterMs - earlierMs) / DAY);
}

function isTier1Or2(riskTier: unknown): boolean {
  return typeof riskTier === "string" && (riskTier.startsWith("tier1") || riskTier.startsWith("tier2"));
}

async function computeModelValidationCurrencyPct(ctx: any, nowMs: number): Promise<number> {
  const today = isoDay(nowMs);
  const models = await ctx.db.query("modelCards").collect();
  const inScope = models.filter((m: any) => isTier1Or2(m.riskTier));
  if (inScope.length === 0) return 100;

  const currentCount = inScope.filter((m: any) => {
    const due = typeof m.nextValidationDate === "string" ? m.nextValidationDate : null;
    return due !== null && due >= today;
  }).length;

  return (currentCount / inScope.length) * 100;
}

async function computeGroundTruthFreshnessPct(ctx: any, nowMs: number): Promise<number> {
  const freshnessWindowMs = 90 * DAY;
  const cutoff = nowMs - freshnessWindowMs;

  const versions = await ctx.db.query("groundTruthVersions").collect();
  const approved = versions.filter((v: any) => v.status === "approved");
  const latestByEntity = new Map<string, any>();
  for (const v of approved) {
    const key = String(v.entityKey);
    const existing = latestByEntity.get(key);
    const better = !existing || (v.version ?? 0) > (existing.version ?? 0);
    if (better) latestByEntity.set(key, v);
  }

  const total = latestByEntity.size;
  if (total === 0) return 100;

  let fresh = 0;
  for (const v of latestByEntity.values()) {
    const t = typeof v.updatedAt === "number" ? v.updatedAt : (typeof v.approvedAt === "number" ? v.approvedAt : 0);
    if (t >= cutoff) fresh++;
  }
  return (fresh / total) * 100;
}

/* ------------------------------------------------------------------ */
/* WINDOW STATS QUERIES (To be implemented with real data)            */
/* ------------------------------------------------------------------ */

/**
 * Get window stats for inconclusive rate
 */
export const getInconclusiveWindowStats = internalQuery({
  args: {
    windowMs: v.number(),
  },
  returns: v.object({
    total: v.number(),
    bad: v.number(),
  }),
  handler: async (ctx, args): Promise<WindowStats> => {
    const since = Date.now() - args.windowMs;

    // Get inconclusive events
    const inconclusiveEvents = await ctx.db
      .query("inconclusiveEventLog")
      .withIndex("by_occurred_at", (q) => q.gte("occurredAt", since))
      .collect();

    // Get successful fundamentals as proxy for successful calls
    const successfulCalls = await ctx.db
      .query("financialFundamentals")
      .filter((q) => q.gte(q.field("createdAt"), since))
      .collect();

    return {
      total: successfulCalls.length + inconclusiveEvents.length,
      bad: inconclusiveEvents.length,
    };
  },
});

/**
 * Get window stats for SEC EDGAR availability
 */
export const getSecEdgarAvailabilityWindowStats = internalQuery({
  args: {
    windowMs: v.number(),
  },
  returns: v.object({
    total: v.number(),
    bad: v.number(),
  }),
  handler: async (ctx, args): Promise<WindowStats> => {
    const since = Date.now() - args.windowMs;

    // Success count
    const successfulIngestions = await ctx.db
      .query("financialFundamentals")
      .filter((q) => q.gte(q.field("createdAt"), since))
      .collect();

    // Failure count
    const failures = await ctx.db
      .query("inconclusiveEventLog")
      .withIndex("by_dependency", (q) => q.eq("dependency", "sec_edgar"))
      .filter((q) => q.gte(q.field("occurredAt"), since))
      .collect();

    return {
      total: successfulIngestions.length + failures.length,
      bad: failures.length,
    };
  },
});

/**
 * Get window stats for source quality accuracy
 */
export const getSourceQualityAccuracyWindowStats = internalQuery({
  args: {
    windowMs: v.number(),
  },
  returns: v.object({
    total: v.number(),
    bad: v.number(),
  }),
  handler: async (ctx, args): Promise<WindowStats> => {
    const since = Date.now() - args.windowMs;

    const labeled = await ctx.db
      .query("sourceQualityLog")
      .withIndex("by_classified_at", (q) => q.gte("classifiedAt", since))
      .filter((q) => q.neq(q.field("humanLabel"), undefined))
      .collect();

    const inappropriate = labeled.filter(
      l => l.humanLabel !== "appropriate"
    );

    return {
      total: labeled.length,
      bad: inappropriate.length,
    };
  },
});

/**
 * Get window stats for repro pack success
 */
export const getReproPackSuccessWindowStats = internalQuery({
  args: {
    windowMs: v.number(),
  },
  returns: v.object({
    total: v.number(),
    bad: v.number(),
  }),
  handler: async (ctx, args): Promise<WindowStats> => {
    const since = Date.now() - args.windowMs;

    const packs = await ctx.db
      .query("modelReproPacks")
      .filter((q) => q.gte(q.field("createdAt"), since))
      .collect();

    const failed = packs.filter(p => p.fullyReproducible !== true);

    return {
      total: packs.length,
      bad: failed.length,
    };
  },
});

/* ------------------------------------------------------------------ */
/* EXPORTS                                                             */
/* ------------------------------------------------------------------ */

// Note: Functions are already exported inline with their declarations
