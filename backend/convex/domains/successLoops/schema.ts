import { defineTable } from "convex/server";
import { v } from "convex/values";

const successLoopType = v.union(
  v.literal("problem_selection"),
  v.literal("activation"),
  v.literal("retained_value"),
  v.literal("outcome_attribution"),
  v.literal("distribution_proof"),
  v.literal("revenue_expansion"),
  v.literal("market_sensing"),
  v.literal("organization_learning"),
);

const successLoopHealth = v.union(
  v.literal("strengthening"),
  v.literal("mixed"),
  v.literal("weakening"),
  v.literal("missing"),
);

const sourceRef = v.object({
  label: v.string(),
  href: v.optional(v.string()),
  note: v.optional(v.string()),
  kind: v.optional(v.string()),
});

const metricDefinition = v.object({
  key: v.string(),
  label: v.string(),
  description: v.optional(v.string()),
  unit: v.optional(v.string()),
  targetDirection: v.union(v.literal("higher"), v.literal("lower"), v.literal("balanced")),
});

const metricValue = v.object({
  key: v.string(),
  label: v.string(),
  value: v.number(),
  displayValue: v.string(),
  score: v.number(),
  unit: v.optional(v.string()),
  source: v.union(v.literal("observed"), v.literal("proxy"), v.literal("manual"), v.literal("missing")),
  targetDirection: v.union(v.literal("higher"), v.literal("lower"), v.literal("balanced")),
  note: v.optional(v.string()),
});

export const successLoopRegistry = defineTable({
  loopId: v.string(),
  loopType: successLoopType,
  entityType: v.string(),
  entityKey: v.string(),
  goal: v.string(),
  owner: v.string(),
  reviewCadence: v.string(),
  leadingMetrics: v.array(metricDefinition),
  laggingMetrics: v.array(metricDefinition),
  interventionTypes: v.array(v.string()),
  currentState: v.string(),
  status: successLoopHealth,
  score: v.number(),
  lastReviewAt: v.optional(v.number()),
  nextReviewAt: v.number(),
  notes: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_loop_id", ["loopId"])
  .index("by_entity_loop", ["entityType", "entityKey", "loopType"])
  .index("by_status_review", ["status", "nextReviewAt"]);

export const successLoopEvents = defineTable({
  loopId: v.string(),
  loopType: successLoopType,
  entityType: v.string(),
  entityKey: v.string(),
  eventKind: v.union(
    v.literal("observation"),
    v.literal("intervention"),
    v.literal("frozen_decision"),
    v.literal("outcome"),
    v.literal("comparison_verdict"),
  ),
  eventType: v.string(),
  title: v.string(),
  summary: v.string(),
  confidence: v.optional(v.number()),
  metricKey: v.optional(v.string()),
  metricValue: v.optional(v.number()),
  sourceRefs: v.optional(v.array(sourceRef)),
  metadata: v.optional(v.any()),
  observedAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_loop_observed", ["loopId", "observedAt"])
  .index("by_entity_observed", ["entityType", "entityKey", "observedAt"])
  .index("by_kind_observed", ["eventKind", "observedAt"]);

export const successLoopExperiments = defineTable({
  experimentKey: v.string(),
  loopId: v.string(),
  loopType: successLoopType,
  entityType: v.string(),
  entityKey: v.string(),
  title: v.string(),
  hypothesis: v.string(),
  owner: v.string(),
  status: v.union(
    v.literal("planned"),
    v.literal("running"),
    v.literal("validated"),
    v.literal("rejected"),
    v.literal("watch"),
  ),
  expectedEffect: v.string(),
  observationWindowDays: v.number(),
  expectedMetricKeys: v.array(v.string()),
  observedMetricKeys: v.optional(v.array(v.string())),
  baselineSummary: v.optional(v.string()),
  outcomeSummary: v.optional(v.string()),
  observedDelta: v.optional(v.number()),
  sourceRefs: v.optional(v.array(sourceRef)),
  startedAt: v.number(),
  endedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_loop_created", ["loopId", "createdAt"])
  .index("by_entity_created", ["entityType", "entityKey", "createdAt"])
  .index("by_status_created", ["status", "createdAt"]);

export const frozenDecisions = defineTable({
  decisionKey: v.string(),
  loopId: v.optional(v.string()),
  loopType: v.optional(successLoopType),
  entityType: v.string(),
  entityKey: v.string(),
  decisionType: v.union(
    v.literal("strategy"),
    v.literal("launch"),
    v.literal("pricing"),
    v.literal("gtm"),
    v.literal("product"),
    v.literal("workflow"),
  ),
  title: v.string(),
  hypothesis: v.string(),
  recommendation: v.string(),
  expectedOutcomeSummary: v.optional(v.string()),
  observationWindowDays: v.optional(v.number()),
  owner: v.string(),
  confidence: v.number(),
  limitations: v.array(v.string()),
  alternatives: v.optional(v.array(v.string())),
  sourceRefs: v.optional(v.array(sourceRef)),
  status: v.union(v.literal("frozen"), v.literal("linked"), v.literal("superseded")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_decision_key", ["decisionKey"])
  .index("by_entity_created", ["entityType", "entityKey", "createdAt"])
  .index("by_loop_created", ["loopType", "createdAt"]);

export const successOutcomeLinks = defineTable({
  decisionKey: v.string(),
  loopId: v.optional(v.string()),
  loopType: v.optional(successLoopType),
  entityType: v.string(),
  entityKey: v.string(),
  outcomeType: v.string(),
  title: v.string(),
  actualOutcome: v.string(),
  comparisonVerdict: v.union(
    v.literal("validated"),
    v.literal("partially_validated"),
    v.literal("invalidated"),
    v.literal("inconclusive"),
  ),
  confidence: v.optional(v.number()),
  outcomeMetrics: v.optional(v.array(metricValue)),
  sourceRefs: v.optional(v.array(sourceRef)),
  observedAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_decision_observed", ["decisionKey", "observedAt"])
  .index("by_entity_observed", ["entityType", "entityKey", "observedAt"])
  .index("by_verdict_observed", ["comparisonVerdict", "observedAt"]);
