import { defineTable } from "convex/server";
import { v } from "convex/values";

const sourceRef = v.object({
  label: v.string(),
  href: v.optional(v.string()),
  note: v.optional(v.string()),
  lineStart: v.optional(v.number()),
  lineEnd: v.optional(v.number()),
});

export const timeSeriesObservations = defineTable({
  streamKey: v.string(),
  sourceType: v.union(
    v.literal("slack"),
    v.literal("github"),
    v.literal("jira"),
    v.literal("web"),
    v.literal("document"),
    v.literal("manual"),
    v.literal("system"),
  ),
  sourceId: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  entityKey: v.optional(v.string()),
  observationType: v.union(
    v.literal("numeric"),
    v.literal("categorical"),
    v.literal("event"),
    v.literal("text"),
  ),
  observedAt: v.number(),
  ingestionRunId: v.optional(v.string()),
  valueNumber: v.optional(v.number()),
  valueText: v.optional(v.string()),
  valueJson: v.optional(v.any()),
  units: v.optional(v.string()),
  headline: v.optional(v.string()),
  summary: v.optional(v.string()),
  sourceExcerpt: v.optional(v.string()),
  sourceRefs: v.optional(v.array(sourceRef)),
  tags: v.optional(v.array(v.string())),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_stream_time", ["streamKey", "observedAt"])
  .index("by_entity_time", ["entityKey", "observedAt"])
  .index("by_source_type_time", ["sourceType", "observedAt"])
  .index("by_ingestion_run", ["ingestionRunId", "observedAt"]);

export const timeSeriesSignals = defineTable({
  signalKey: v.string(),
  streamKey: v.string(),
  entityKey: v.optional(v.string()),
  signalType: v.union(
    v.literal("momentum"),
    v.literal("regime_shift"),
    v.literal("anomaly"),
    v.literal("causal_hint"),
    v.literal("opportunity_window"),
    v.literal("risk_window"),
  ),
  status: v.union(
    v.literal("open"),
    v.literal("watch"),
    v.literal("resolved"),
    v.literal("dismissed"),
  ),
  detectedAt: v.number(),
  windowStartAt: v.optional(v.number()),
  windowEndAt: v.optional(v.number()),
  confidence: v.number(),
  severity: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
  summary: v.string(),
  plainEnglish: v.string(),
  evidenceObservationIds: v.optional(v.array(v.id("timeSeriesObservations"))),
  sourceRefs: v.optional(v.array(sourceRef)),
  recommendedAction: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_stream_detected", ["streamKey", "detectedAt"])
  .index("by_entity_detected", ["entityKey", "detectedAt"])
  .index("by_status_detected", ["status", "detectedAt"])
  .index("by_signal_key", ["signalKey"]);

export const causalChains = defineTable({
  chainKey: v.string(),
  title: v.string(),
  entityKey: v.optional(v.string()),
  rootQuestion: v.string(),
  status: v.union(
    v.literal("draft"),
    v.literal("validated"),
    v.literal("contested"),
  ),
  timeframeStartAt: v.optional(v.number()),
  timeframeEndAt: v.optional(v.number()),
  summary: v.string(),
  plainEnglish: v.string(),
  outcome: v.optional(v.string()),
  nodes: v.array(v.object({
    timestamp: v.number(),
    label: v.string(),
    description: v.string(),
    evidenceObservationIds: v.optional(v.array(v.id("timeSeriesObservations"))),
  })),
  sourceRefs: v.optional(v.array(sourceRef)),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_chain_key", ["chainKey"])
  .index("by_status_created", ["status", "createdAt"])
  .index("by_entity_created", ["entityKey", "createdAt"]);

export const zeroDraftArtifacts = defineTable({
  artifactKey: v.string(),
  artifactType: v.union(
    v.literal("slack_message"),
    v.literal("email"),
    v.literal("spec_doc"),
    v.literal("pr_draft"),
    v.literal("architecture_note"),
    v.literal("career_plan"),
    v.literal("content_brief"),
  ),
  status: v.union(
    v.literal("draft"),
    v.literal("pending_approval"),
    v.literal("approved"),
    v.literal("sent"),
    v.literal("archived"),
  ),
  title: v.string(),
  summary: v.string(),
  plainEnglish: v.string(),
  targetAudience: v.optional(v.string()),
  bodyMarkdown: v.string(),
  linkedSignalIds: v.optional(v.array(v.id("timeSeriesSignals"))),
  linkedChainId: v.optional(v.id("causalChains")),
  sourceRefs: v.optional(v.array(sourceRef)),
  createdAt: v.number(),
  updatedAt: v.number(),
  approvedAt: v.optional(v.number()),
})
  .index("by_artifact_key", ["artifactKey"])
  .index("by_status_created", ["status", "createdAt"])
  .index("by_type_created", ["artifactType", "createdAt"]);

export const proofPacks = defineTable({
  packKey: v.string(),
  subjectType: v.union(
    v.literal("deployment"),
    v.literal("career_move"),
    v.literal("content_release"),
    v.literal("research_run"),
    v.literal("agent_loop"),
  ),
  subjectId: v.string(),
  status: v.union(
    v.literal("draft"),
    v.literal("ready"),
    v.literal("approved"),
    v.literal("rejected"),
  ),
  summary: v.string(),
  checklist: v.array(v.object({
    label: v.string(),
    passed: v.boolean(),
    note: v.optional(v.string()),
  })),
  sourceRefs: v.optional(v.array(sourceRef)),
  dogfoodRunId: v.optional(v.id("dogfoodQaRuns")),
  taskSessionId: v.optional(v.id("agentTaskSessions")),
  zeroDraftArtifactIds: v.optional(v.array(v.id("zeroDraftArtifacts"))),
  metrics: v.optional(v.object({
    totalTokens: v.optional(v.number()),
    totalDurationMs: v.optional(v.number()),
    estimatedCostUsd: v.optional(v.number()),
  })),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_pack_key", ["packKey"])
  .index("by_status_created", ["status", "createdAt"])
  .index("by_subject", ["subjectType", "subjectId"]);

/* ================================================================== */
/* ENTERPRISE SPEC DOCS                                                */
/* ================================================================== */

const specCheckResult = v.object({
  passed: v.boolean(),
  actualValue: v.optional(v.number()),
  evidence: v.optional(v.string()),
  screenshotUrl: v.optional(v.string()),
  videoClipUrl: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  durationMs: v.optional(v.number()),
  verifiedAt: v.number(),
});

const specCheck = v.object({
  checkId: v.string(),
  category: v.union(
    v.literal("functional"),
    v.literal("security"),
    v.literal("performance"),
    v.literal("accessibility"),
    v.literal("compliance"),
    v.literal("data_integrity"),
    v.literal("ux_quality"),
  ),
  title: v.string(),
  description: v.string(),
  verificationMethod: v.union(
    v.literal("automated_test"),
    v.literal("visual_qa"),
    v.literal("video_qa"),
    v.literal("manual_review"),
    v.literal("metric_threshold"),
    v.literal("playwright_assertion"),
  ),
  threshold: v.optional(v.object({
    metric: v.string(),
    operator: v.union(v.literal("gt"), v.literal("gte"), v.literal("lt"), v.literal("lte"), v.literal("eq")),
    value: v.number(),
    units: v.optional(v.string()),
  })),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("passed"),
    v.literal("failed"),
    v.literal("skipped"),
    v.literal("blocked"),
  ),
  result: v.optional(specCheckResult),
  priority: v.union(v.literal("P0"), v.literal("P1"), v.literal("P2"), v.literal("P3")),
});

export const specDocs = defineTable({
  specKey: v.string(),
  title: v.string(),
  description: v.string(),
  projectId: v.optional(v.string()),
  clientOrg: v.optional(v.string()),
  contractValue: v.optional(v.number()),
  deadline: v.optional(v.number()),
  target: v.object({
    environment: v.union(
      v.literal("staging"),
      v.literal("production"),
      v.literal("preview"),
      v.literal("canary"),
    ),
    url: v.optional(v.string()),
    branch: v.optional(v.string()),
    commitSha: v.optional(v.string()),
    deployedAt: v.optional(v.number()),
  }),
  checks: v.array(specCheck),
  complianceFrameworks: v.optional(v.array(v.union(
    v.literal("SOC2"),
    v.literal("HIPAA"),
    v.literal("GDPR"),
    v.literal("ISO27001"),
    v.literal("PCI_DSS"),
    v.literal("FedRAMP"),
  ))),
  status: v.union(
    v.literal("draft"),
    v.literal("executing"),
    v.literal("finalized"),
    v.literal("blocked"),
  ),
  overallVerdict: v.union(
    v.literal("pending"),
    v.literal("passed"),
    v.literal("failed"),
  ),
  passRate: v.number(),
  totalChecks: v.number(),
  passedChecks: v.number(),
  failedChecks: v.number(),
  proofPackId: v.optional(v.id("proofPacks")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_spec_key", ["specKey"])
  .index("by_status", ["status", "createdAt"])
  .index("by_client", ["clientOrg", "createdAt"]);
