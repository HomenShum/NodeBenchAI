/**
 * Standardized Judge Metrics — Boolean + Numeric Outputs
 *
 * Instead of judge prose, persist structured metrics into a metrics table.
 * Every LLM judge evaluation produces a `JudgeMetricRecord` with:
 *   - Boolean flags: entails, contradiction, hallucination, novelty, ...
 *   - Numeric scores: supported_claim_rate, citation_coverage, confidence, ...
 *   - Enum decisions: duplicate_decision, verdict, ...
 *
 * Architecture upgrade: makes the system *measurable* and *auditable*.
 */

import { v } from "convex/values";
import {
  internalQuery,
  internalMutation,
} from "../../_generated/server";

// ═══════════════════════════════════════════════════════════════════════════
// METRIC TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * All possible metric keys produced by judges.
 * Each is either boolean, number (0-1), or a categorical string.
 */
export type MetricKey =
  // Boolean flags
  | "entails"
  | "contradicts"
  | "hallucinated"
  | "novel"
  | "actionable"
  | "coherent"
  | "grounded"
  | "safe"
  | "correct_tool_use"
  | "persona_match"
  | "entity_resolved"
  | "format_valid"
  // Numeric scores (0.0 - 1.0)
  | "supported_claim_rate"
  | "citation_coverage"
  | "confidence_calibrated"
  | "factual_accuracy"
  | "response_quality"
  | "evidence_strength"
  | "entity_resolution_score"
  | "persona_inference_score"
  | "safety_score"
  // Categorical decisions
  | "verdict"
  | "duplicate_decision"
  | "promotion_decision"
  | "severity";

export type MetricType = "boolean" | "number" | "category";

export interface MetricDefinition {
  key: MetricKey;
  type: MetricType;
  description: string;
  /** For category type, the allowed values */
  allowedValues?: string[];
  /** Whether this is a critical metric that blocks promotion */
  critical: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// METRIC DEFINITIONS CATALOG
// ═══════════════════════════════════════════════════════════════════════════

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  // ── Boolean Metrics ────────────────────────────────────────────────
  { key: "entails", type: "boolean", description: "Response entails the claim/hypothesis", critical: false },
  { key: "contradicts", type: "boolean", description: "Response contradicts known facts or sources", critical: true },
  { key: "hallucinated", type: "boolean", description: "Response contains fabricated information", critical: true },
  { key: "novel", type: "boolean", description: "Response contains genuinely new information", critical: false },
  { key: "actionable", type: "boolean", description: "Response provides actionable next steps", critical: false },
  { key: "coherent", type: "boolean", description: "Response is logically coherent", critical: false },
  { key: "grounded", type: "boolean", description: "Claims are grounded in cited evidence", critical: true },
  { key: "safe", type: "boolean", description: "No forbidden content, PII, or unsafe outputs", critical: true },
  { key: "correct_tool_use", type: "boolean", description: "Tools were used correctly and appropriately", critical: false },
  { key: "persona_match", type: "boolean", description: "Response matches the target persona", critical: false },
  { key: "entity_resolved", type: "boolean", description: "Target entity was correctly identified", critical: false },
  { key: "format_valid", type: "boolean", description: "Output matches expected format/schema", critical: false },

  // ── Numeric Metrics (0.0 - 1.0) ───────────────────────────────────
  { key: "supported_claim_rate", type: "number", description: "Fraction of claims supported by evidence (0-1)", critical: false },
  { key: "citation_coverage", type: "number", description: "Fraction of claims with citations (0-1)", critical: false },
  { key: "confidence_calibrated", type: "number", description: "Calibrated confidence score (0-1)", critical: false },
  { key: "factual_accuracy", type: "number", description: "Composite factual accuracy (0-1)", critical: true },
  { key: "response_quality", type: "number", description: "Composite response quality (0-1)", critical: false },
  { key: "evidence_strength", type: "number", description: "Strength of supporting evidence (0-1)", critical: false },
  { key: "entity_resolution_score", type: "number", description: "Entity resolution composite (0-1)", critical: false },
  { key: "persona_inference_score", type: "number", description: "Persona inference composite (0-1)", critical: false },
  { key: "safety_score", type: "number", description: "Safety composite (0-1)", critical: true },

  // ── Categorical Decisions ─────────────────────────────────────────
  { key: "verdict", type: "category", description: "Overall evaluation verdict", allowedValues: ["pass", "partial", "fail"], critical: true },
  { key: "duplicate_decision", type: "category", description: "Deduplication decision", allowedValues: ["unique", "near_duplicate", "exact_duplicate"], critical: false },
  { key: "promotion_decision", type: "category", description: "Whether content should be promoted", allowedValues: ["promote", "hold", "reject"], critical: true },
  { key: "severity", type: "category", description: "Issue severity level", allowedValues: ["critical", "high", "medium", "low", "info"], critical: false },
];

// ═══════════════════════════════════════════════════════════════════════════
// RECORD METRICS — Persist judge outputs
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record a judge metric evaluation result.
 * Called after any LLM judge produces an evaluation.
 */
export const recordMetrics = internalMutation({
  args: {
    /** Source of the evaluation (which judge produced this) */
    judgeId: v.string(),
    /** What was evaluated (artifact ID, post ID, claim ID, etc.) */
    targetType: v.string(),
    targetId: v.string(),
    /** The evaluation context */
    evaluationContext: v.optional(v.string()),
    /** Agent run that triggered this evaluation */
    agentRunId: v.optional(v.string()),
    /** Boolean metrics */
    booleans: v.optional(
      v.object({
        entails: v.optional(v.boolean()),
        contradicts: v.optional(v.boolean()),
        hallucinated: v.optional(v.boolean()),
        novel: v.optional(v.boolean()),
        actionable: v.optional(v.boolean()),
        coherent: v.optional(v.boolean()),
        grounded: v.optional(v.boolean()),
        safe: v.optional(v.boolean()),
        correct_tool_use: v.optional(v.boolean()),
        persona_match: v.optional(v.boolean()),
        entity_resolved: v.optional(v.boolean()),
        format_valid: v.optional(v.boolean()),
      })
    ),
    /** Numeric metrics (0-1) */
    numerics: v.optional(
      v.object({
        supported_claim_rate: v.optional(v.number()),
        citation_coverage: v.optional(v.number()),
        confidence_calibrated: v.optional(v.number()),
        factual_accuracy: v.optional(v.number()),
        response_quality: v.optional(v.number()),
        evidence_strength: v.optional(v.number()),
        entity_resolution_score: v.optional(v.number()),
        persona_inference_score: v.optional(v.number()),
        safety_score: v.optional(v.number()),
      })
    ),
    /** Categorical decisions */
    categories: v.optional(
      v.object({
        verdict: v.optional(v.string()),
        duplicate_decision: v.optional(v.string()),
        promotion_decision: v.optional(v.string()),
        severity: v.optional(v.string()),
      })
    ),
    /** Model used for judging */
    judgeModel: v.optional(v.string()),
    /** Latency of the judge call */
    latencyMs: v.optional(v.number()),
    /** Raw judge reasoning (kept for debugging, not the primary output) */
    reasoning: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Compute composite pass/fail from critical metrics
    const criticalPass = computeCriticalPass(args.booleans, args.numerics, args.categories);

    await ctx.db.insert("judgeMetrics", {
      judgeId: args.judgeId,
      targetType: args.targetType,
      targetId: args.targetId,
      evaluationContext: args.evaluationContext,
      agentRunId: args.agentRunId,
      booleans: args.booleans ?? {},
      numerics: args.numerics ?? {},
      categories: args.categories ?? {},
      criticalPass,
      judgeModel: args.judgeModel,
      latencyMs: args.latencyMs,
      reasoning: args.reasoning,
      recordedAt: Date.now(),
    });
  },
});

function computeCriticalPass(
  booleans?: Record<string, boolean | undefined>,
  numerics?: Record<string, number | undefined>,
  categories?: Record<string, string | undefined>
): boolean {
  // Critical booleans that must be true/false
  if (booleans?.contradicts === true) return false;
  if (booleans?.hallucinated === true) return false;
  if (booleans?.safe === false) return false;
  if (booleans?.grounded === false) return false;

  // Critical numerics that must meet threshold
  if (numerics?.factual_accuracy !== undefined && numerics.factual_accuracy < 0.6) return false;
  if (numerics?.safety_score !== undefined && numerics.safety_score < 0.8) return false;

  // Critical categories
  if (categories?.verdict === "fail") return false;
  if (categories?.promotion_decision === "reject") return false;

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERY METRICS
// ═══════════════════════════════════════════════════════════════════════════

/** Get all metrics for a specific target */
export const getMetricsForTarget = internalQuery({
  args: {
    targetType: v.string(),
    targetId: v.string(),
  },
  returns: v.array(v.any()),
  handler: async (ctx, { targetType, targetId }) => {
    return ctx.db
      .query("judgeMetrics")
      .withIndex("by_target", (q) =>
        q.eq("targetType", targetType).eq("targetId", targetId)
      )
      .order("desc")
      .collect();
  },
});

/** Get metrics summary for a time window */
export const getMetricsSummary = internalQuery({
  args: {
    sinceMs: v.optional(v.number()),
    judgeId: v.optional(v.string()),
  },
  returns: v.object({
    totalEvaluations: v.number(),
    criticalPassRate: v.number(),
    avgFactualAccuracy: v.number(),
    avgSafetyScore: v.number(),
    avgCitationCoverage: v.number(),
    avgResponseQuality: v.number(),
    verdictDistribution: v.any(),
    promotionDistribution: v.any(),
  }),
  handler: async (ctx, args) => {
    const since = args.sinceMs ?? Date.now() - 24 * 60 * 60 * 1000;

    let query = ctx.db.query("judgeMetrics");
    if (args.judgeId) {
      query = query.withIndex("by_judge", (q) => q.eq("judgeId", args.judgeId));
    }

    const metrics = await query
      .filter((q) => q.gte(q.field("recordedAt"), since))
      .collect();

    if (metrics.length === 0) {
      return {
        totalEvaluations: 0,
        criticalPassRate: 0,
        avgFactualAccuracy: 0,
        avgSafetyScore: 0,
        avgCitationCoverage: 0,
        avgResponseQuality: 0,
        verdictDistribution: {},
        promotionDistribution: {},
      };
    }

    const criticalPasses = metrics.filter((m) => m.criticalPass).length;

    // Average numeric metrics (only from records that have them)
    const avg = (key: string) => {
      const vals = metrics
        .map((m) => (m.numerics as Record<string, number | undefined>)?.[key])
        .filter((v): v is number => v !== undefined);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    };

    // Count categorical distributions
    const countCat = (key: string) => {
      const dist: Record<string, number> = {};
      for (const m of metrics) {
        const val = (m.categories as Record<string, string | undefined>)?.[key];
        if (val) dist[val] = (dist[val] ?? 0) + 1;
      }
      return dist;
    };

    return {
      totalEvaluations: metrics.length,
      criticalPassRate: criticalPasses / metrics.length,
      avgFactualAccuracy: avg("factual_accuracy"),
      avgSafetyScore: avg("safety_score"),
      avgCitationCoverage: avg("citation_coverage"),
      avgResponseQuality: avg("response_quality"),
      verdictDistribution: countCat("verdict"),
      promotionDistribution: countCat("promotion_decision"),
    };
  },
});

/** Check if a target has passing metrics (gate check before promotion) */
export const checkPromotionGate = internalQuery({
  args: {
    targetType: v.string(),
    targetId: v.string(),
  },
  returns: v.object({
    canPromote: v.boolean(),
    reason: v.string(),
    latestVerdict: v.optional(v.string()),
    criticalPass: v.boolean(),
    evaluationCount: v.number(),
  }),
  handler: async (ctx, { targetType, targetId }) => {
    const metrics = await ctx.db
      .query("judgeMetrics")
      .withIndex("by_target", (q) =>
        q.eq("targetType", targetType).eq("targetId", targetId)
      )
      .order("desc")
      .collect();

    if (metrics.length === 0) {
      return {
        canPromote: false,
        reason: "No judge evaluations found — cannot promote unevaluated content",
        criticalPass: false,
        evaluationCount: 0,
      };
    }

    const latest = metrics[0];
    const latestVerdict = (latest.categories as any)?.verdict;

    if (!latest.criticalPass) {
      return {
        canPromote: false,
        reason: `Critical metrics failed: ${identifyFailures(latest)}`,
        latestVerdict,
        criticalPass: false,
        evaluationCount: metrics.length,
      };
    }

    return {
      canPromote: true,
      reason: `All critical metrics pass (${metrics.length} evaluations)`,
      latestVerdict,
      criticalPass: true,
      evaluationCount: metrics.length,
    };
  },
});

function identifyFailures(metric: any): string {
  const failures: string[] = [];
  const bools = metric.booleans as Record<string, boolean | undefined>;
  const nums = metric.numerics as Record<string, number | undefined>;
  const cats = metric.categories as Record<string, string | undefined>;

  if (bools?.contradicts) failures.push("contradiction detected");
  if (bools?.hallucinated) failures.push("hallucination detected");
  if (bools?.safe === false) failures.push("safety check failed");
  if (bools?.grounded === false) failures.push("not grounded in evidence");
  if (nums?.factual_accuracy !== undefined && nums.factual_accuracy < 0.6)
    failures.push(`factual_accuracy=${nums.factual_accuracy.toFixed(2)}`);
  if (nums?.safety_score !== undefined && nums.safety_score < 0.8)
    failures.push(`safety_score=${nums.safety_score.toFixed(2)}`);
  if (cats?.verdict === "fail") failures.push("verdict=fail");

  return failures.join(", ") || "unknown critical failure";
}
