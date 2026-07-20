import { defineTable } from "convex/server";
import { v } from "convex/values";

export const tasteBenchScenarioIdValidator = v.union(
  v.literal("app-01-founder-weekly-reset"),
  v.literal("app-02-pre-delegation-packet"),
  v.literal("app-03-important-change-review"),
  v.literal("app-04-competitor-supermemory"),
  v.literal("app-05-banker-anthropic"),
  v.literal("app-06-student-shopify"),
);

export const tasteBenchDimensionValidator = v.union(
  v.literal("narrative"),
  v.literal("visual_semantics"),
  v.literal("composition"),
  v.literal("craft"),
  v.literal("trust"),
  v.literal("interaction"),
);

export const tasteBenchCorrectionKindValidator = v.union(
  v.literal("reduced_density"),
  v.literal("strengthened_hierarchy"),
  v.literal("changed_visual_encoding"),
  v.literal("corrected_audience_level"),
  v.literal("factual"),
  v.literal("source"),
  v.literal("scope"),
  v.literal("tone"),
  v.literal("other"),
);

export const tasteBenchOperationalEventTypeValidator = v.union(
  v.literal("direction_generated"),
  v.literal("direction_viewed"),
  v.literal("direction_selected"),
  v.literal("direction_rejected"),
  v.literal("operation_accepted"),
  v.literal("operation_changed"),
  v.literal("operation_undone"),
  v.literal("approval_interrupted"),
  v.literal("proposal_invalid"),
  v.literal("proposal_retried"),
  v.literal("reviewable_output"),
  v.literal("artifact_exported"),
  v.literal("artifact_presented"),
  v.literal("artifact_reused"),
  v.literal("artifact_refreshed"),
);

export const tasteBenchRuns = defineTable({
  userId: v.id("users"),
  scenarioId: tasteBenchScenarioIdValidator,
  catalogVersion: v.literal("tastebench-v1"),
  baselineArtifactId: v.id("dogfoodQaRuns"),
  candidateArtifactId: v.id("dogfoodQaRuns"),
  slotAArtifactId: v.id("dogfoodQaRuns"),
  slotBArtifactId: v.id("dogfoodQaRuns"),
  slotAContains: v.union(v.literal("baseline"), v.literal("candidate")),
  audience: v.union(
    v.literal("founder"),
    v.literal("researcher"),
    v.literal("banker"),
    v.literal("student"),
  ),
  expectedOutcome: v.string(),
  expectedPrimitiveCoverage: v.array(v.string()),
  evidencePack: v.object({
    source: v.literal("dogfood_qa_runs"),
    evidencePackRef: v.string(),
    artifactIds: v.array(v.id("dogfoodQaRuns")),
  }),
  createdAt: v.number(),
})
  .index("by_user_created", ["userId", "createdAt"])
  .index("by_user_scenario_created", ["userId", "scenarioId", "createdAt"]);

export const tasteBenchEvents = defineTable({
  userId: v.id("users"),
  runId: v.id("tasteBenchRuns"),
  eventId: v.string(),
  sequence: v.number(),
  eventType: v.union(
    v.literal("run_started"),
    tasteBenchOperationalEventTypeValidator,
    v.literal("correction_recorded"),
    v.literal("run_completed"),
    v.literal("run_abandoned"),
  ),
  comparison: v.optional(
    v.object({
      presentedChoice: v.union(
        v.literal("a"),
        v.literal("b"),
        v.literal("tie"),
        v.literal("both_fail"),
      ),
      storedChoice: v.union(
        v.literal("baseline"),
        v.literal("candidate"),
        v.literal("tie"),
        v.literal("both_fail"),
      ),
      reason: v.string(),
      dimensions: v.array(tasteBenchDimensionValidator),
    }),
  ),
  correction: v.optional(
    v.object({
      classification: tasteBenchCorrectionKindValidator,
      note: v.string(),
      dimensions: v.array(tasteBenchDimensionValidator),
      beforeArtifactId: v.id("dogfoodQaRuns"),
      afterArtifactId: v.id("dogfoodQaRuns"),
    }),
  ),
  operational: v.optional(
    v.object({
      subjectRef: v.optional(v.string()),
      detail: v.optional(v.string()),
      dimensions: v.optional(v.array(tasteBenchDimensionValidator)),
      artifactSlot: v.optional(v.union(v.literal("a"), v.literal("b"))),
      source: v.object({
        kind: v.union(
          v.literal("autonomy_proposal"),
          v.literal("autonomy_receipt"),
          v.literal("execution_trace"),
          v.literal("dogfood_telemetry"),
        ),
        receiptRef: v.string(),
        runRef: v.optional(v.string()),
      }),
    }),
  ),
  abandonReason: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_run_sequence", ["runId", "sequence"])
  .index("by_user_created", ["userId", "createdAt"])
  .index("by_event_id", ["eventId"]);
