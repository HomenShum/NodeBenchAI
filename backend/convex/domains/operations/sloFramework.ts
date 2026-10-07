// convex/domains/operations/sloFramework.ts
// SLO Framework with Multi-Window Burn-Rate Alerting
//
// Implements Google SRE-style error budgets and burn-rate alerting.
// Aligned with https://sre.google/workbook/alerting-on-slos/
//
// ============================================================================
// MULTI-WINDOW BURN-RATE ALERTING
// ============================================================================
//
// Key principles:
// 1. Error budgets are the "control surface" (not raw error counts)
// 2. Multi-window alerting (short ≈ 1/12 long) reduces false positives
// 3. Trigger when BOTH windows breach (better reset time)
// 4. Use different burn-rate thresholds for page vs. ticket
//
// Canonical parameters for 30-day SLOs (Google SRE Workbook):
// - Page (fast): 1h/5m at 14.4× burn rate (consumes 2% budget)
// - Page (slow): 6h/30m at 6× burn rate (consumes 5% budget)
// - Ticket: 3d/6h at 1× burn rate (consumes 10% budget)
//
// ============================================================================

import { v } from "convex/values";
import { internalMutation, query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* MULTI-WINDOW BURN-RATE TYPES                                       */
/* ------------------------------------------------------------------ */

export type AlertSeverity = "page" | "ticket" | "warning";

export interface WindowSpec {
  /** Window duration in milliseconds */
  durationMs: number;

  /** Burn-rate threshold for this window */
  burnRateThreshold: number;

  /** Minimum event gating (prevents low-volume false pages) */
  minTotal?: number;  // Require at least N events in this window
  minBad?: number;    // Require at least N bad events in this window
}

export interface BurnRateClause {
  /** Long window (e.g., 1h, 6h, 24h) */
  long: WindowSpec;

  /** Short window (e.g., 5m, 30m, 2h) - typically 1/12 of long */
  short: WindowSpec;

  /** Clause breaches only when BOTH windows breach */
  requireBothWindows: true;
}

export interface MultiWindowBurnRateCondition {
  type: "multi_window_burn_rate";

  /** Any clause can trigger the alert (OR semantics) */
  anyOf: BurnRateClause[];

  /** Default minimum events for low-volume SLIs */
  minTotalLongDefault?: number;
  minTotalShortDefault?: number;

  /** Dedupe/suppression */
  cooldownMs: number;  // Do not re-fire if active alert exists within cooldown
  suppression?: {
    /** Suppress this alert if any of these alerts are currently active */
    suppressIfActiveAlertIds: string[];
  };
}

export interface ComplianceCondition {
  type: "compliance";

  /** Named compliance check */
  check: "model_validation_currency" | "ground_truth_freshness";

  cooldownMs: number;

  /** Optional parameters for the check */
  params?: Record<string, unknown>;
}

export type AlertCondition = MultiWindowBurnRateCondition | ComplianceCondition;

export interface AlertConfig {
  alertId: string;
  sloId: string;
  severity: AlertSeverity;
  runbookId: string;
  condition: AlertCondition;

  /** Optional metadata */
  ownerTeam?: string;
  tags?: string[];
}

/* ------------------------------------------------------------------ */
/* SLO DEFINITIONS                                                     */
/* ------------------------------------------------------------------ */

export interface ServiceLevelObjective {
  sloId: string;
  name: string;
  description: string;

  /** Target value (e.g., 99.0 for 99% availability) */
  target: number;

  /** Comparison operator */
  operator: "gte" | "lte" | "eq";

  /** Compliance window in days */
  windowDays: number;

  /** Error budget as percentage (e.g., 1.0 for 1%) */
  errorBudgetPercent: number;

  /** Owner team */
  owner: string;

  /** Tags for filtering */
  tags: string[];
}

/* ------------------------------------------------------------------ */
/* BURN-RATE CONSTANTS                                                 */
/* ------------------------------------------------------------------ */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// 30-day canonical defaults from Google SRE Workbook
const BR_30D_PAGE_FAST = 14.4; // 1h/5m
const BR_30D_PAGE_SLOW = 6.0;  // 6h/30m
const BR_30D_TICKET = 1.0;     // 3d/6h
const BR_30D_TICKET_FAST = 3.0; // 24h/2h (faster ticket)

// 7-day burn-rate defaults (same method, shorter window)
const BR_7D_PAGE_FAST = 16.8; // 1h/5m
const BR_7D_PAGE_SLOW = 5.6;  // 6h/30m
const BR_7D_TICKET_FAST = 1.4; // 24h/2h

/* ------------------------------------------------------------------ */
/* SERVICE LEVEL OBJECTIVES                                            */
/* ------------------------------------------------------------------ */

export const SERVICE_LEVEL_OBJECTIVES: ServiceLevelObjective[] = [
  {
    sloId: "slo_sec_edgar_availability",
    name: "SEC EDGAR Availability",
    description: "Percentage of SEC EDGAR API calls that succeed",
    target: 99.0,
    operator: "gte",
    windowDays: 30,
    errorBudgetPercent: 1.0,  // ~7.2 hours/month downtime
    owner: "data-platform",
    tags: ["external-dependency", "critical"],
  },
  {
    sloId: "slo_sec_edgar_latency",
    name: "SEC EDGAR P95 Latency",
    description: "95th percentile latency for SEC EDGAR API calls",
    target: 5000,  // milliseconds
    operator: "lte",
    windowDays: 7,
    errorBudgetPercent: 5.0,
    owner: "data-platform",
    tags: ["external-dependency", "performance"],
  },
  {
    sloId: "slo_source_quality_accuracy",
    name: "Source Quality Classification Accuracy",
    description: "Percentage of classifications marked 'appropriate' by human reviewers",
    target: 90.0,
    operator: "gte",
    windowDays: 30,
    errorBudgetPercent: 10.0,
    owner: "ml-quality",
    tags: ["ml-model", "calibration"],
  },
  {
    sloId: "slo_repro_pack_success",
    name: "Repro Pack Success Rate",
    description: "Percentage of repro packs that are fully reproducible",
    target: 95.0,
    operator: "gte",
    windowDays: 30,
    errorBudgetPercent: 5.0,
    owner: "evaluation-platform",
    tags: ["reproducibility", "critical"],
  },
  {
    sloId: "slo_inconclusive_rate",
    name: "Overall Inconclusive Rate",
    description: "Percentage of external calls resulting in inconclusive outcomes",
    target: 5.0,
    operator: "lte",
    windowDays: 7,
    errorBudgetPercent: 5.0,
    owner: "reliability",
    tags: ["reliability", "external-dependency"],
  },
  {
    sloId: "slo_ground_truth_freshness",
    name: "Ground Truth Freshness",
    description: "Percentage of ground truth updated within last 90 days",
    target: 80.0,
    operator: "gte",
    windowDays: 30,
    errorBudgetPercent: 20.0,
    owner: "data-curation",
    tags: ["data-quality", "governance"],
  },
  {
    sloId: "slo_model_validation_currency",
    name: "Model Validation Currency",
    description: "Percentage of tier-1/tier-2 models with current validation",
    target: 100.0,
    operator: "gte",
    windowDays: 30,
    errorBudgetPercent: 0.0,  // Zero tolerance
    owner: "model-risk",
    tags: ["governance", "compliance", "critical"],
  },
];

/* ------------------------------------------------------------------ */
/* ALERT CONFIGURATIONS (Multi-Window Burn-Rate)                       */
/* ------------------------------------------------------------------ */

export const ALERT_CONFIGURATIONS: AlertConfig[] = [
  // ========== SEC EDGAR Availability (30d) ==========
  {
    alertId: "alert_sec_edgar_availability_page",
    sloId: "slo_sec_edgar_availability",
    severity: "page",
    runbookId: "rb_sec_edgar_outage",
    condition: {
      type: "multi_window_burn_rate",
      anyOf: [
        {
          long:  { durationMs: 1 * HOUR, burnRateThreshold: BR_30D_PAGE_FAST, minTotal: 50 },
          short: { durationMs: 5 * MIN,  burnRateThreshold: BR_30D_PAGE_FAST, minTotal: 10 },
          requireBothWindows: true,
        },
        {
          long:  { durationMs: 6 * HOUR, burnRateThreshold: BR_30D_PAGE_SLOW, minTotal: 200 },
          short: { durationMs: 30 * MIN, burnRateThreshold: BR_30D_PAGE_SLOW, minTotal: 50 },
          requireBothWindows: true,
        },
      ],
      cooldownMs: 30 * MIN,
      suppression: { suppressIfActiveAlertIds: ["alert_sec_edgar_availability_ticket"] },
    },
    ownerTeam: "data-platform",
    tags: ["critical", "page"],
  },
  {
    alertId: "alert_sec_edgar_availability_ticket",
    sloId: "slo_sec_edgar_availability",
    severity: "ticket",
    runbookId: "rb_sec_edgar_degraded",
    condition: {
      type: "multi_window_burn_rate",
      anyOf: [
        {
          long:  { durationMs: 24 * HOUR, burnRateThreshold: BR_30D_TICKET_FAST, minTotal: 200 },
          short: { durationMs: 2 * HOUR,  burnRateThreshold: BR_30D_TICKET_FAST, minTotal: 50 },
          requireBothWindows: true,
        },
        {
          long:  { durationMs: 3 * DAY, burnRateThreshold: BR_30D_TICKET, minTotal: 500 },
          short: { durationMs: 6 * HOUR, burnRateThreshold: BR_30D_TICKET, minTotal: 200 },
          requireBothWindows: true,
        },
      ],
      cooldownMs: 6 * HOUR,
    },
    ownerTeam: "data-platform",
    tags: ["degraded", "ticket"],
  },

  // ========== SEC EDGAR Latency P95 (7d) ==========
  {
    alertId: "alert_sec_edgar_latency_page",
    sloId: "slo_sec_edgar_latency",
    severity: "page",
    runbookId: "rb_sec_edgar_latency",
    condition: {
      type: "multi_window_burn_rate",
      anyOf: [
        {
          long:  { durationMs: 1 * HOUR, burnRateThreshold: BR_7D_PAGE_FAST, minTotal: 50 },
          short: { durationMs: 5 * MIN,  burnRateThreshold: BR_7D_PAGE_FAST, minTotal: 10 },
          requireBothWindows: true,
        },
        {
          long:  { durationMs: 6 * HOUR, burnRateThreshold: BR_7D_PAGE_SLOW, minTotal: 200 },
          short: { durationMs: 30 * MIN, burnRateThreshold: BR_7D_PAGE_SLOW, minTotal: 50 },
          requireBothWindows: true,
        },
      ],
      cooldownMs: 30 * MIN,
      suppression: { suppressIfActiveAlertIds: ["alert_sec_edgar_latency_ticket"] },
    },
    ownerTeam: "data-platform",
    tags: ["performance", "page"],
  },
  {
    alertId: "alert_sec_edgar_latency_ticket",
    sloId: "slo_sec_edgar_latency",
    severity: "ticket",
    runbookId: "rb_sec_edgar_latency_ticket",
    condition: {
      type: "multi_window_burn_rate",
      anyOf: [
        {
          long:  { durationMs: 24 * HOUR, burnRateThreshold: BR_7D_TICKET_FAST, minTotal: 200 },
          short: { durationMs: 2 * HOUR,  burnRateThreshold: BR_7D_TICKET_FAST, minTotal: 50 },
          requireBothWindows: true,
        },
      ],
      cooldownMs: 6 * HOUR,
    },
    ownerTeam: "data-platform",
    tags: ["performance", "ticket"],
  },

  // ========== Source Quality Accuracy (30d, low-volume) ==========
  {
    alertId: "alert_source_quality_accuracy_ticket",
    sloId: "slo_source_quality_accuracy",
    severity: "ticket",
    runbookId: "rb_source_quality_regression",
    condition: {
      type: "multi_window_burn_rate",
      anyOf: [
        {
          long:  { durationMs: 7 * DAY,  burnRateThreshold: 1.0, minTotal: 30 },
          short: { durationMs: 14 * HOUR, burnRateThreshold: 1.0, minTotal: 10 },
          requireBothWindows: true,
        },
      ],
      cooldownMs: 12 * HOUR,
    },
    ownerTeam: "ml-quality",
    tags: ["calibration", "ticket"],
  },

  // ========== Repro Pack Success Rate (30d) ==========
  {
    alertId: "alert_repro_pack_success_ticket",
    sloId: "slo_repro_pack_success",
    severity: "ticket",
    runbookId: "rb_repro_pack_failures",
    condition: {
      type: "multi_window_burn_rate",
      anyOf: [
        {
          long:  { durationMs: 3 * DAY, burnRateThreshold: BR_30D_TICKET, minTotal: 20 },
          short: { durationMs: 6 * HOUR, burnRateThreshold: BR_30D_TICKET, minTotal: 5 },
          requireBothWindows: true,
        },
      ],
      cooldownMs: 6 * HOUR,
    },
    ownerTeam: "evaluation-platform",
    tags: ["reproducibility", "ticket"],
  },

  // ========== Overall Inconclusive Rate (7d) ==========
  {
    alertId: "alert_inconclusive_rate_page",
    sloId: "slo_inconclusive_rate",
    severity: "page",
    runbookId: "rb_inconclusive_spike",
    condition: {
      type: "multi_window_burn_rate",
      anyOf: [
        {
          long:  { durationMs: 1 * HOUR, burnRateThreshold: BR_7D_PAGE_FAST, minTotal: 100 },
          short: { durationMs: 5 * MIN,  burnRateThreshold: BR_7D_PAGE_FAST, minTotal: 20 },
          requireBothWindows: true,
        },
        {
          long:  { durationMs: 6 * HOUR, burnRateThreshold: BR_7D_PAGE_SLOW, minTotal: 500 },
          short: { durationMs: 30 * MIN, burnRateThreshold: BR_7D_PAGE_SLOW, minTotal: 100 },
          requireBothWindows: true,
        },
      ],
      cooldownMs: 30 * MIN,
    },
    ownerTeam: "reliability",
    tags: ["reliability", "page"],
  },

  // ========== Ground Truth Freshness (30d, compliance) ==========
  {
    alertId: "alert_ground_truth_freshness_ticket",
    sloId: "slo_ground_truth_freshness",
    severity: "ticket",
    runbookId: "rb_ground_truth_staleness",
    condition: {
      type: "compliance",
      check: "ground_truth_freshness",
      cooldownMs: 12 * HOUR,
      params: {
        consecutiveBreaches: 2,  // Ticket after 2 consecutive daily breaches
      },
    },
    ownerTeam: "data-curation",
    tags: ["governance", "ticket"],
  },

  // ========== Model Validation Currency (zero tolerance) ==========
  {
    alertId: "alert_model_validation_currency_page",
    sloId: "slo_model_validation_currency",
    severity: "page",
    runbookId: "rb_validation_overdue",
    condition: {
      type: "compliance",
      check: "model_validation_currency",
      cooldownMs: 6 * HOUR,
      params: {
        pageRiskTiers: ["tier1_critical", "tier2_significant"],
        ticketApproachingDays: { from: 14, to: 7 },
      },
    },
    ownerTeam: "model-risk",
    tags: ["compliance", "page"],
  },
];

/* ------------------------------------------------------------------ */
/* CONVEX MUTATIONS - Store SLO measurements                           */
/* ------------------------------------------------------------------ */

export const recordSloMeasurement = internalMutation({
  args: {
    sloId: v.string(),
    value: v.number(),
    metadata: v.optional(v.any()),
  },
  returns: v.id("sloMeasurements"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("sloMeasurements", {
      sloId: args.sloId,
      value: args.value,
      metadata: args.metadata,
      recordedAt: Date.now(),
    });
  },
});

export const recordAlertTrigger = internalMutation({
  args: {
    alertId: v.string(),
    sloId: v.string(),
    severity: v.string(),
    currentValue: v.number(),
    threshold: v.number(),
    message: v.string(),
    dedupeKey: v.optional(v.string()),
    evaluationDetails: v.optional(v.any()),
  },
  returns: v.id("alertHistory"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("alertHistory", {
      alertId: args.alertId,
      sloId: args.sloId,
      severity: args.severity,
      currentValue: args.currentValue,
      threshold: args.threshold,
      message: args.message,
      dedupeKey: args.dedupeKey,
      evaluationDetails: args.evaluationDetails,
      triggeredAt: Date.now(),
      acknowledgedAt: undefined,
      resolvedAt: undefined,
      acknowledgedBy: undefined,
      resolvedBy: undefined,
    });
  },
});

/* ------------------------------------------------------------------ */
/* CONVEX QUERIES - Get active alerts                                  */
/* ------------------------------------------------------------------ */

export const getActiveAlertsForSlo = query({
  args: { sloId: v.string() },
  returns: v.array(v.object({
    _id: v.id("alertHistory"),
    alertId: v.string(),
    status: v.union(v.literal("active"), v.literal("resolved")),
    lastTriggeredAtMs: v.number(),
    dedupeKey: v.optional(v.string()),
  })),
  handler: async (ctx, args) => {
    const alerts = await ctx.db
      .query("alertHistory")
      .withIndex("by_slo", (q) => q.eq("sloId", args.sloId))
      .filter((q) => q.eq(q.field("resolvedAt"), undefined))
      .collect();

    return alerts.map((a) => ({
      _id: a._id,
      alertId: a.alertId,
      status: "active" as const,
      lastTriggeredAtMs: a.triggeredAt,
      dedupeKey: a.dedupeKey,
    }));
  },
});

/* ------------------------------------------------------------------ */
/* EXPORTS                                                             */
/* ------------------------------------------------------------------ */

export {
  SERVICE_LEVEL_OBJECTIVES as SLOs,
  ALERT_CONFIGURATIONS as ALERTS,
};

// Export burn-rate constants for testing
export {
  BR_30D_PAGE_FAST,
  BR_30D_PAGE_SLOW,
  BR_30D_TICKET,
  BR_30D_TICKET_FAST,
  BR_7D_PAGE_FAST,
  BR_7D_PAGE_SLOW,
  BR_7D_TICKET_FAST,
};
