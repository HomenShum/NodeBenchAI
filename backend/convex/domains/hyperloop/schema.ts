import { defineTable } from "convex/server";
import { v } from "convex/values";

export const hyperloopMetricSchema = v.object({
  qualityScore: v.number(),
  baselineQualityScore: v.optional(v.number()),
  artifactQualityScore: v.optional(v.number()),
  evidenceCoverage: v.number(),
  contradictionCatchRate: v.optional(v.number()),
  packetReuseRate: v.optional(v.number()),
  costReductionPct: v.optional(v.number()),
  latencyReductionPct: v.optional(v.number()),
  workflowCallReductionPct: v.optional(v.number()),
  humanEditDistancePct: v.optional(v.number()),
});

export const hyperloopGateSchema = v.object({
  key: v.string(),
  passed: v.boolean(),
  critical: v.optional(v.boolean()),
  reason: v.optional(v.string()),
});

const targetKind = v.union(
  v.literal("packet_template"),
  v.literal("workflow_template"),
  v.literal("routing_policy"),
  v.literal("export_adapter"),
  v.literal("readiness_rubric"),
  v.literal("watchlist_threshold"),
);

const variantStatus = v.union(
  v.literal("draft"),
  v.literal("evaluating"),
  v.literal("archived"),
  v.literal("candidate"),
  v.literal("promoted"),
  v.literal("rejected"),
  v.literal("rolled_back"),
);

export const hyperloopVariants = defineTable({
  workspaceId: v.string(),
  companyId: v.optional(v.string()),
  targetKind,
  targetId: v.string(),
  status: variantStatus,
  summary: v.string(),
  diffSummary: v.optional(v.string()),
  parentVariantIds: v.array(v.string()),
  createdFromEpisodeIds: v.array(v.string()),
  createdFromPacketIds: v.array(v.string()),
  sourceRefs: v.array(v.string()),
  evaluationRunIds: v.array(v.id("hyperloopEvaluationRuns")),
  metrics: v.optional(hyperloopMetricSchema),
  promotedAt: v.optional(v.number()),
  promotedBy: v.optional(v.string()),
  rollbackOfVariantId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_workspace_status", ["workspaceId", "status", "updatedAt"])
  .index("by_target", ["targetKind", "targetId", "updatedAt"])
  .index("by_status", ["status", "updatedAt"]);

export const hyperloopEvaluationRuns = defineTable({
  variantId: v.id("hyperloopVariants"),
  baselineVariantId: v.optional(v.id("hyperloopVariants")),
  workspaceId: v.string(),
  targetKind,
  targetId: v.string(),
  episodeIds: v.array(v.string()),
  packetIds: v.array(v.string()),
  workflowTemplateId: v.optional(v.string()),
  metrics: hyperloopMetricSchema,
  gates: v.array(hyperloopGateSchema),
  score: v.number(),
  improvementDelta: v.number(),
  failedGateReasons: v.array(v.string()),
  policyAction: v.string(),
  llmExplanation: v.optional(v.string()),
  artifactIds: v.array(v.string()),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_variant", ["variantId", "createdAt"])
  .index("by_workspace", ["workspaceId", "createdAt"])
  .index("by_target", ["targetKind", "targetId", "createdAt"]);

export const hyperloopPromotions = defineTable({
  variantId: v.id("hyperloopVariants"),
  workspaceId: v.string(),
  decision: v.union(v.literal("promote"), v.literal("reject"), v.literal("rollback")),
  reviewerId: v.string(),
  rationale: v.string(),
  policyAction: v.string(),
  score: v.number(),
  improvementDelta: v.number(),
  failedGateReasons: v.array(v.string()),
  requiredFollowup: v.array(v.string()),
  decidedAt: v.number(),
})
  .index("by_variant", ["variantId", "decidedAt"])
  .index("by_workspace", ["workspaceId", "decidedAt"])
  .index("by_decision", ["decision", "decidedAt"]);
