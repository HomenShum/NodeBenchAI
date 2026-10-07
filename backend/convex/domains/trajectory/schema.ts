import { defineTable } from "convex/server";
import { v } from "convex/values";

const trajectoryEntityType = v.union(
  v.literal("workflow"),
  v.literal("agent"),
  v.literal("mission"),
  v.literal("product"),
  v.literal("startup"),
  v.literal("founder"),
  v.literal("team"),
);

const trajectorySourceRef = v.object({
  label: v.string(),
  href: v.optional(v.string()),
  note: v.optional(v.string()),
  kind: v.optional(v.string()),
});

const trajectoryScoreLabel = v.union(
  v.literal("compounding"),
  v.literal("improving"),
  v.literal("flat"),
  v.literal("drifting"),
);

const scoreCard = v.object({
  score: v.number(),
  label: trajectoryScoreLabel,
  explanation: v.string(),
});

export const trajectoryEntities = defineTable({
  entityKey: v.string(),
  entityType: trajectoryEntityType,
  label: v.string(),
  description: v.optional(v.string()),
  activePopulation: v.boolean(),
  sourceRecordType: v.optional(v.string()),
  sourceRecordId: v.optional(v.string()),
  sourceBacklinks: v.optional(v.array(v.object({
    sourceRecordType: v.string(),
    sourceRecordId: v.string(),
    label: v.optional(v.string()),
  }))),
  latestSummaryId: v.optional(v.id("trajectorySummaries")),
  latestCompoundingScoreId: v.optional(v.id("trajectoryCompoundingScores")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity", ["entityType", "entityKey"])
  .index("by_type_updated", ["entityType", "updatedAt"])
  .index("by_source", ["sourceRecordType", "sourceRecordId"]);

export const trajectorySpans = defineTable({
  entityKey: v.string(),
  entityType: trajectoryEntityType,
  spanKey: v.string(),
  parentSpanKey: v.optional(v.string()),
  traceKey: v.optional(v.string()),
  sessionKey: v.optional(v.string()),
  spanType: v.string(),
  name: v.string(),
  status: v.string(),
  summary: v.string(),
  score: v.optional(v.number()),
  evidenceCompletenessScore: v.optional(v.number()),
  sourceRefs: v.optional(v.array(trajectorySourceRef)),
  sourceRecordType: v.string(),
  sourceRecordId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity_created", ["entityType", "entityKey", "createdAt"])
  .index("by_source", ["sourceRecordType", "sourceRecordId"])
  .index("by_trace", ["traceKey", "createdAt"]);

export const trajectoryEvidenceBundles = defineTable({
  entityKey: v.string(),
  entityType: trajectoryEntityType,
  bundleKey: v.string(),
  title: v.string(),
  summary: v.string(),
  bundleType: v.string(),
  sourceRefs: v.array(trajectorySourceRef),
  sourceRecordType: v.string(),
  sourceRecordId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity_created", ["entityType", "entityKey", "createdAt"])
  .index("by_source", ["sourceRecordType", "sourceRecordId"]);

export const trajectoryJudgeVerdicts = defineTable({
  entityKey: v.string(),
  entityType: trajectoryEntityType,
  verdictKey: v.string(),
  verdict: v.string(),
  summary: v.string(),
  confidence: v.optional(v.number()),
  recommendation: v.optional(v.string()),
  criteriaPassed: v.optional(v.number()),
  criteriaTotal: v.optional(v.number()),
  sourceRecordType: v.string(),
  sourceRecordId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity_created", ["entityType", "entityKey", "createdAt"])
  .index("by_source", ["sourceRecordType", "sourceRecordId"])
  .index("by_verdict", ["verdict", "createdAt"]);

export const trajectoryFeedbackEvents = defineTable({
  entityKey: v.string(),
  entityType: trajectoryEntityType,
  eventType: v.string(),
  status: v.string(),
  title: v.string(),
  summary: v.string(),
  observationWindowStartAt: v.number(),
  observationWindowEndAt: v.number(),
  observedAt: v.number(),
  outcomeScore: v.optional(v.number()),
  scoreDelta: v.optional(v.number()),
  sourceRecordType: v.optional(v.string()),
  sourceRecordId: v.optional(v.string()),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity_observed", ["entityType", "entityKey", "observedAt"])
  .index("by_event_type", ["eventType", "createdAt"])
  .index("by_source", ["sourceRecordType", "sourceRecordId"]);

export const trajectoryInterventionEvents = defineTable({
  entityKey: v.string(),
  entityType: trajectoryEntityType,
  title: v.string(),
  status: v.string(),
  actor: v.string(),
  summary: v.string(),
  rationale: v.string(),
  linkedSpanKeys: v.optional(v.array(v.string())),
  expectedWindowStartAt: v.number(),
  expectedWindowEndAt: v.number(),
  observedWindowStartAt: v.optional(v.number()),
  observedWindowEndAt: v.optional(v.number()),
  expectedScoreDelta: v.optional(v.number()),
  observedScoreDelta: v.optional(v.number()),
  sourceRecordType: v.optional(v.string()),
  sourceRecordId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity_created", ["entityType", "entityKey", "createdAt"])
  .index("by_actor_created", ["actor", "createdAt"])
  .index("by_source", ["sourceRecordType", "sourceRecordId"]);

export const trajectoryTrustNodes = defineTable({
  entityKey: v.string(),
  entityType: trajectoryEntityType,
  nodeKey: v.string(),
  nodeType: v.union(
    v.literal("person"),
    v.literal("institution"),
    v.literal("channel"),
    v.literal("platform"),
  ),
  label: v.string(),
  influenceScore: v.number(),
  notes: v.optional(v.string()),
  sourceRecordType: v.optional(v.string()),
  sourceRecordId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity_created", ["entityType", "entityKey", "createdAt"])
  .index("by_node_key", ["nodeKey"]);

export const trajectoryTrustEdges = defineTable({
  entityKey: v.string(),
  entityType: trajectoryEntityType,
  nodeKey: v.string(),
  edgeType: v.string(),
  summary: v.string(),
  leverageScore: v.number(),
  confidence: v.optional(v.number()),
  sourceRecordType: v.optional(v.string()),
  sourceRecordId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity_created", ["entityType", "entityKey", "createdAt"])
  .index("by_node_created", ["nodeKey", "createdAt"])
  .index("by_source", ["sourceRecordType", "sourceRecordId"]);

export const trajectorySummaries = defineTable({
  entityKey: v.string(),
  entityType: trajectoryEntityType,
  windowDays: v.number(),
  summary: v.string(),
  narrative: v.string(),
  nextReviewAt: v.number(),
  spanCount: v.number(),
  evidenceBundleCount: v.number(),
  verdictCount: v.number(),
  feedbackCount: v.number(),
  interventionCount: v.number(),
  benchmarkCount: v.number(),
  trustNodeCount: v.number(),
  trustEdgeCount: v.number(),
  topInterventions: v.array(v.object({
    title: v.string(),
    observedScoreDelta: v.optional(v.number()),
    status: v.string(),
  })),
  scoreBreakdown: v.object({
    spanQuality: scoreCard,
    evidenceCompleteness: scoreCard,
    adaptationVelocity: scoreCard,
    trustLeverage: scoreCard,
    interventionEffect: scoreCard,
    drift: scoreCard,
    rawCompounding: scoreCard,
    trustAdjustedCompounding: scoreCard,
  }),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity_window", ["entityType", "entityKey", "windowDays"])
  .index("by_updated", ["updatedAt"]);

export const trajectoryCompoundingScores = defineTable({
  entityKey: v.string(),
  entityType: trajectoryEntityType,
  windowDays: v.number(),
  rawScore: v.number(),
  rawLabel: trajectoryScoreLabel,
  rawExplanation: v.string(),
  trustAdjustedScore: v.number(),
  trustAdjustedLabel: trajectoryScoreLabel,
  trustAdjustedExplanation: v.string(),
  driftScore: v.number(),
  driftLabel: trajectoryScoreLabel,
  driftExplanation: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity_window", ["entityType", "entityKey", "windowDays"])
  .index("by_score", ["trustAdjustedScore", "updatedAt"]);

export const trajectoryBenchmarkRuns = defineTable({
  entityKey: v.string(),
  entityType: trajectoryEntityType,
  benchmarkKey: v.string(),
  benchmarkLabel: v.string(),
  benchmarkFamily: v.string(),
  verdict: v.string(),
  summary: v.string(),
  overallUplift: v.optional(v.number()),
  deltaFromPrevious: v.optional(v.number()),
  sourceRecordType: v.string(),
  sourceRecordId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity_created", ["entityType", "entityKey", "createdAt"])
  .index("by_verdict_created", ["verdict", "createdAt"])
  .index("by_source", ["sourceRecordType", "sourceRecordId"]);
