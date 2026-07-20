/**
 * Evaluation Schema — Layer H eval and evolution tables
 *
 * Tracks inference calls, baseline comparisons, routing recommendations,
 * and benchmark results for continuous self-evolution.
 *
 * Sections 18, 19, and 20.6 of the v2 plan.
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Inference Calls — per-call telemetry for model/tool invocations
// ---------------------------------------------------------------------------

export const inferenceCalls = defineTable({
  callKey: v.string(),
  runStepId: v.optional(v.string()),
  missionId: v.optional(v.string()),
  taskId: v.optional(v.string()),
  provider: v.string(),
  model: v.string(),
  taskType: v.optional(v.string()),
  stakesLevel: v.optional(v.union(
    v.literal("low"),
    v.literal("medium"),
    v.literal("high"),
  )),
  inputTokens: v.number(),
  outputTokens: v.number(),
  latencyMs: v.number(),
  costUsd: v.number(),
  status: v.union(
    v.literal("success"),
    v.literal("error"),
    v.literal("timeout"),
    v.literal("rate_limited"),
  ),
  errorMessage: v.optional(v.string()),
  toolsUsed: v.optional(v.array(v.string())),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
})
  .index("by_call_key", ["callKey"])
  .index("by_model_created", ["model", "createdAt"])
  .index("by_mission_created", ["missionId", "createdAt"])
  .index("by_status_created", ["status", "createdAt"]);

// ---------------------------------------------------------------------------
// Baseline Comparisons — A/B tracking of baseline vs enhanced
// ---------------------------------------------------------------------------

export const baselineComparisons = defineTable({
  comparisonKey: v.string(),
  benchmarkFamily: v.union(
    v.literal("investigation"),
    v.literal("company_direction"),
    v.literal("repo_shift"),
    v.literal("document_enrichment"),
    v.literal("app_building"),
    v.literal("operational"),
    v.literal("canary"),
    v.literal("custom"),
  ),
  baselineLabel: v.string(),
  enhancedLabel: v.string(),
  baselineMetrics: v.object({
    factualAccuracy: v.optional(v.number()),
    relationshipAccuracy: v.optional(v.number()),
    causalChainQuality: v.optional(v.number()),
    evidenceCoverage: v.optional(v.number()),
    receiptCompleteness: v.optional(v.number()),
    humanEditDistance: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    falseConfidenceRate: v.optional(v.number()),
  }),
  enhancedMetrics: v.object({
    factualAccuracy: v.optional(v.number()),
    relationshipAccuracy: v.optional(v.number()),
    causalChainQuality: v.optional(v.number()),
    evidenceCoverage: v.optional(v.number()),
    receiptCompleteness: v.optional(v.number()),
    humanEditDistance: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    falseConfidenceRate: v.optional(v.number()),
  }),
  relativeUplift: v.object({
    factualAccuracy: v.optional(v.number()),
    relationshipAccuracy: v.optional(v.number()),
    causalChainQuality: v.optional(v.number()),
    evidenceCoverage: v.optional(v.number()),
    receiptCompleteness: v.optional(v.number()),
    humanEditDistance: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    falseConfidenceRate: v.optional(v.number()),
  }),
  overallUplift: v.number(),
  regressions: v.array(v.string()),
  verdict: v.union(
    v.literal("improved"),
    v.literal("regressed"),
    v.literal("mixed"),
    v.literal("neutral"),
  ),
  notes: v.optional(v.string()),
  ranAt: v.number(),
  createdAt: v.number(),
})
  .index("by_comparison_key", ["comparisonKey"])
  .index("by_family_created", ["benchmarkFamily", "createdAt"])
  .index("by_verdict_created", ["verdict", "createdAt"]);

// ---------------------------------------------------------------------------
// Routing Recommendations — feedback from eval to inference router
// ---------------------------------------------------------------------------

export const routingRecommendations = defineTable({
  recommendationKey: v.string(),
  taskType: v.string(),
  currentModel: v.string(),
  recommendedModel: v.string(),
  reason: v.string(),
  evidenceComparisonId: v.optional(v.id("baselineComparisons")),
  expectedUplift: v.optional(v.number()),
  expectedCostDelta: v.optional(v.number()),
  status: v.union(
    v.literal("pending"),
    v.literal("accepted"),
    v.literal("rejected"),
    v.literal("expired"),
  ),
  acceptedAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_recommendation_key", ["recommendationKey"])
  .index("by_task_type", ["taskType"])
  .index("by_status_created", ["status", "createdAt"]);

// ---------------------------------------------------------------------------
// Canary Runs — weekly/daily canary benchmark tracking
// ---------------------------------------------------------------------------

export const canaryRuns = defineTable({
  runKey: v.string(),
  commitHash: v.optional(v.string()),
  fixtureCount: v.number(),
  throughputScore: v.number(),
  qualityScore: v.number(),
  throughputMetrics: v.any(),
  qualityMetrics: v.any(),
  regressions: v.array(v.string()),
  wallClockMs: v.number(),
  costUsd: v.number(),
  verdict: v.union(
    v.literal("pass"),
    v.literal("regression"),
    v.literal("improvement"),
  ),
  previousRunKey: v.optional(v.string()),
  deltaFromPrevious: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_run_key", ["runKey"])
  .index("by_verdict_created", ["verdict", "createdAt"])
  .index("by_created", ["createdAt"]);
