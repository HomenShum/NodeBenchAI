/**
 * Mission Execution Schema — Layer A + C tables
 *
 * Covers: missions, task plans, subtask assignments, run steps,
 * judge reviews, retry attempts, sniff checks, and merge boundaries.
 *
 * These tables formalize the planner → worker → judge → merge flow
 * described in the NodeBench v2 architecture (sections 4, 5, 6, 14, 15).
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Missions — top-level goal containers (distinct from individual runs)
// ---------------------------------------------------------------------------

export const missions = defineTable({
  missionKey: v.string(),
  title: v.string(),
  description: v.string(),
  missionType: v.union(
    v.literal("investigation"),
    v.literal("company_direction"),
    v.literal("repo_shift"),
    v.literal("document_enrichment"),
    v.literal("app_building"),
    v.literal("operational_monitor"),
    v.literal("custom"),
  ),
  status: v.union(
    v.literal("draft"),
    v.literal("planned"),
    v.literal("executing"),
    v.literal("judging"),
    v.literal("sniff_check"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("cancelled"),
  ),
  owner: v.optional(v.string()),
  successCriteria: v.array(v.object({
    criterion: v.string(),
    verifiabilityTier: v.union(
      v.literal("machine_checkable"),
      v.literal("expert_checkable"),
      v.literal("human_sniff_check"),
    ),
    met: v.optional(v.boolean()),
    evidence: v.optional(v.string()),
  })),
  outputContract: v.optional(v.object({
    requiredArtifacts: v.array(v.string()),
    requiredEvidenceCount: v.optional(v.number()),
    requiredConfidenceFloor: v.optional(v.number()),
    formatSchema: v.optional(v.string()),
  })),
  budgetTokens: v.optional(v.number()),
  budgetCostUsd: v.optional(v.number()),
  timeoutMs: v.optional(v.number()),
  entityKey: v.optional(v.string()),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
})
  .index("by_status_updated", ["status", "updatedAt"])
  .index("by_type_updated", ["missionType", "updatedAt"])
  .index("by_mission_key", ["missionKey"])
  .index("by_entity_key", ["entityKey"]);

// ---------------------------------------------------------------------------
// Task Plans — decomposed mission subtasks with dependency DAG
// ---------------------------------------------------------------------------

export const taskPlans = defineTable({
  missionId: v.id("missions"),
  taskKey: v.string(),
  title: v.string(),
  description: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("blocked"),
    v.literal("in_progress"),
    v.literal("judging"),
    v.literal("sniff_check"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("skipped"),
  ),
  order: v.number(),
  dependsOn: v.array(v.string()),
  assignedAgent: v.optional(v.string()),
  assignedModel: v.optional(v.string()),
  verifiabilityTier: v.union(
    v.literal("machine_checkable"),
    v.literal("expert_checkable"),
    v.literal("human_sniff_check"),
  ),
  judgeMethod: v.union(
    v.literal("compile_test"),
    v.literal("rubric_8point"),
    v.literal("expert_review"),
    v.literal("human_review"),
    v.literal("auto_pass"),
  ),
  retryBudget: v.number(),
  retryCount: v.number(),
  requiresHumanSniffCheck: v.boolean(),
  toolsetAllowlist: v.optional(v.array(v.string())),
  stakesLevel: v.union(
    v.literal("low"),
    v.literal("medium"),
    v.literal("high"),
  ),
  estimatedTokens: v.optional(v.number()),
  estimatedMs: v.optional(v.number()),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
})
  .index("by_mission_status", ["missionId", "status"])
  .index("by_mission_order", ["missionId", "order"])
  .index("by_task_key", ["taskKey"]);

// ---------------------------------------------------------------------------
// Run Steps — individual execution steps within a task
// ---------------------------------------------------------------------------

export const runSteps = defineTable({
  taskId: v.id("taskPlans"),
  missionId: v.id("missions"),
  stepNumber: v.number(),
  action: v.string(),
  target: v.optional(v.string()),
  reason: v.string(),
  toolUsed: v.optional(v.string()),
  modelUsed: v.optional(v.string()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  latencyMs: v.optional(v.number()),
  costUsd: v.optional(v.number()),
  status: v.union(
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("retrying"),
  ),
  resultSummary: v.optional(v.string()),
  artifactIds: v.optional(v.array(v.string())),
  evidenceRefs: v.optional(v.array(v.object({
    label: v.string(),
    href: v.optional(v.string()),
    kind: v.optional(v.string()),
  }))),
  receiptId: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  errorCategory: v.optional(v.union(
    v.literal("transient"),
    v.literal("permanent"),
    v.literal("rate_limit"),
    v.literal("timeout"),
    v.literal("contract_violation"),
    v.literal("hallucination"),
  )),
  createdAt: v.number(),
})
  .index("by_task_step", ["taskId", "stepNumber"])
  .index("by_mission_created", ["missionId", "createdAt"]);

// ---------------------------------------------------------------------------
// Judge Reviews — structured evaluation of task outputs
// ---------------------------------------------------------------------------

export const judgeReviews = defineTable({
  taskId: v.id("taskPlans"),
  missionId: v.id("missions"),
  judgeModel: v.string(),
  verdict: v.union(
    v.literal("pass"),
    v.literal("partial"),
    v.literal("fail"),
    v.literal("escalate"),
  ),
  criteria: v.object({
    taskCompleted: v.boolean(),
    outputCorrect: v.boolean(),
    evidenceCited: v.boolean(),
    noHallucination: v.boolean(),
    toolsUsedEfficiently: v.boolean(),
    contractFollowed: v.boolean(),
    budgetRespected: v.boolean(),
    noForbiddenActions: v.boolean(),
  }),
  customCriteria: v.optional(v.array(v.object({
    name: v.string(),
    passed: v.boolean(),
    reasoning: v.optional(v.string()),
  }))),
  compositeConfidence: v.number(),
  reasoning: v.string(),
  failures: v.optional(v.array(v.string())),
  recommendation: v.union(
    v.literal("promote"),
    v.literal("retry"),
    v.literal("escalate_human"),
    v.literal("fail_permanent"),
  ),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  costUsd: v.optional(v.number()),
  latencyMs: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_task", ["taskId"])
  .index("by_mission_verdict", ["missionId", "verdict"])
  .index("by_verdict_created", ["verdict", "createdAt"]);

// ---------------------------------------------------------------------------
// Retry Attempts — tracks why retries happened and outcomes
// ---------------------------------------------------------------------------

export const retryAttempts = defineTable({
  taskId: v.id("taskPlans"),
  missionId: v.id("missions"),
  attemptNumber: v.number(),
  triggerReason: v.string(),
  errorCategory: v.union(
    v.literal("transient"),
    v.literal("permanent"),
    v.literal("rate_limit"),
    v.literal("timeout"),
    v.literal("contract_violation"),
    v.literal("judge_fail"),
  ),
  previousJudgeReviewId: v.optional(v.id("judgeReviews")),
  outcome: v.union(
    v.literal("success"),
    v.literal("fail_retry"),
    v.literal("fail_exhausted"),
  ),
  backoffMs: v.number(),
  tokensUsed: v.optional(v.number()),
  costUsd: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_task_attempt", ["taskId", "attemptNumber"])
  .index("by_mission_created", ["missionId", "createdAt"]);

// ---------------------------------------------------------------------------
// Sniff Checks — human review queue for high-stakes outputs
// ---------------------------------------------------------------------------

export const sniffChecks = defineTable({
  taskId: v.id("taskPlans"),
  missionId: v.id("missions"),
  status: v.union(
    v.literal("pending"),
    v.literal("approved"),
    v.literal("rejected"),
    v.literal("needs_revision"),
    v.literal("expired"),
  ),
  reviewType: v.union(
    v.literal("correctness"),
    v.literal("credibility"),
    v.literal("feasibility"),
    v.literal("overclaiming"),
    v.literal("strategic_fit"),
    v.literal("irreversible_action"),
    v.literal("general"),
  ),
  outputSummary: v.string(),
  evidenceSummary: v.optional(v.string()),
  limitationsSummary: v.optional(v.string()),
  reviewerNotes: v.optional(v.string()),
  reviewedBy: v.optional(v.string()),
  assignedTo: v.optional(v.string()),
  expiresAt: v.optional(v.number()),
  createdAt: v.number(),
  resolvedAt: v.optional(v.number()),
})
  .index("by_status_created", ["status", "createdAt"])
  .index("by_mission_status", ["missionId", "status"])
  .index("by_assigned_status", ["assignedTo", "status"]);

// ---------------------------------------------------------------------------
// Merge Boundaries — tracks what was merged and how conflicts resolved
// ---------------------------------------------------------------------------

export const mergeBoundaries = defineTable({
  missionId: v.id("missions"),
  sourceTaskIds: v.array(v.id("taskPlans")),
  mergeStrategy: v.union(
    v.literal("consensus"),
    v.literal("highest_confidence"),
    v.literal("union_dedupe"),
    v.literal("manual"),
  ),
  conflictsDetected: v.number(),
  conflictsResolved: v.number(),
  conflictDetails: v.optional(v.array(v.object({
    description: v.string(),
    resolution: v.string(),
    chosenSource: v.optional(v.string()),
  }))),
  mergedArtifactIds: v.optional(v.array(v.string())),
  judgeReviewId: v.optional(v.id("judgeReviews")),
  createdAt: v.number(),
})
  .index("by_mission_created", ["missionId", "createdAt"]);

// ---------------------------------------------------------------------------
// Policy Registry — defines allowed/denied actions and gating rules
// ---------------------------------------------------------------------------

export const agentPolicies = defineTable({
  policyKey: v.string(),
  name: v.string(),
  description: v.string(),
  version: v.number(),
  rules: v.array(v.object({
    action: v.string(),
    effect: v.union(v.literal("allow"), v.literal("deny"), v.literal("require_approval")),
    conditions: v.optional(v.any()),
    stakesLevel: v.optional(v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
    )),
  })),
  scope: v.union(
    v.literal("global"),
    v.literal("mission_type"),
    v.literal("agent"),
    v.literal("custom"),
  ),
  scopeValue: v.optional(v.string()),
  active: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_policy_key", ["policyKey"])
  .index("by_scope_active", ["scope", "active"]);

// ---------------------------------------------------------------------------
// Passport Enforcement Logs -- audit trail for tool dispatch permission checks
// ---------------------------------------------------------------------------

export const passportEnforcementLogs = defineTable({
  agentId: v.string(),
  toolName: v.string(),
  decision: v.union(v.literal("allowed"), v.literal("denied"), v.literal("escalated")),
  reason: v.string(),
  trustTier: v.string(),
  policyKey: v.optional(v.string()),
  missionId: v.optional(v.id("missions")),
  spendCheckResult: v.optional(v.object({
    totalSpent: v.number(),
    limit: v.number(),
    withinBudget: v.boolean(),
  })),
  createdAt: v.number(),
})
  .index("by_agent_created", ["agentId", "createdAt"])
  .index("by_mission", ["missionId", "createdAt"])
  .index("by_decision", ["decision", "createdAt"]);

// ---------------------------------------------------------------------------
// Pre-Execution Gates — "should I act?" evaluation before task dispatch
// ---------------------------------------------------------------------------

export const preExecutionGates = defineTable({
  missionId: v.optional(v.id("missions")),
  promptHash: v.string(),
  prompt: v.string(),
  gates: v.object({
    opportunity_identified: v.boolean(),
    unique_value: v.boolean(),
    actionable_outcome: v.boolean(),
    right_audience: v.boolean(),
    information_not_lost: v.boolean(),
  }),
  disqualifiers: v.object({
    already_resolved: v.boolean(),
    social_only: v.boolean(),
    bot_already_replied: v.boolean(),
    sensitive_topic: v.boolean(),
    rapid_fire: v.boolean(),
    command_word: v.boolean(),
  }),
  decision: v.union(v.literal("proceed"), v.literal("skip"), v.literal("escalate")),
  reasoning: v.string(),
  gatesPassed: v.number(),
  disqualifiersTriggered: v.array(v.string()),
  latencyMs: v.number(),
  createdAt: v.number(),
})
  .index("by_mission", ["missionId", "createdAt"])
  .index("by_decision", ["decision", "createdAt"])
  .index("by_prompt_hash", ["promptHash", "createdAt"]);

// ---------------------------------------------------------------------------
// Decision Memory — fingerprinted prior decisions for institutional memory
// ---------------------------------------------------------------------------

export const decisionMemory = defineTable({
  fingerprint: v.string(),
  entityRef: v.optional(v.string()),
  actionType: v.string(),
  domain: v.string(),
  verdict: v.string(),
  confidence: v.number(),
  reasoning: v.string(),
  rubricVersion: v.optional(v.number()),
  sourceJudgeReviewId: v.optional(v.id("judgeReviews")),
  sourceMissionId: v.optional(v.id("missions")),
  createdAt: v.number(),
})
  .index("by_fingerprint", ["fingerprint", "createdAt"])
  .index("by_domain_action", ["domain", "actionType", "createdAt"])
  .index("by_entity", ["entityRef", "createdAt"])
  .index("by_source_mission", ["sourceMissionId", "createdAt"]);

// ---------------------------------------------------------------------------
// Consistency Alerts — cross-agent decision conflict detection
// ---------------------------------------------------------------------------

export const consistencyAlerts = defineTable({
  scenarioFingerprint: v.string(),
  agentA: v.string(),
  agentB: v.string(),
  verdictA: v.string(),
  verdictB: v.string(),
  confidenceA: v.number(),
  confidenceB: v.number(),
  missionIdA: v.optional(v.id("missions")),
  missionIdB: v.optional(v.id("missions")),
  conflictType: v.union(
    v.literal("verdict_mismatch"),
    v.literal("confidence_divergence"),
    v.literal("recommendation_conflict"),
  ),
  severity: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  resolvedAt: v.optional(v.number()),
  resolvedBy: v.optional(v.string()),
  resolution: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_fingerprint", ["scenarioFingerprint", "createdAt"])
  .index("by_unresolved", ["resolvedAt", "createdAt"])
  .index("by_severity", ["severity", "resolvedAt", "createdAt"]);
