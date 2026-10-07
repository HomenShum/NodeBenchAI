/**
 * Unified ActionSpan — the atomic unit of observable work.
 *
 * Closes Gap #3 from the Time Compounding Deep Review by defining a single
 * canonical shape that both `trajectorySpans` and mission `runSteps` can
 * project into. This is a READ-ONLY adapter layer — it does NOT modify
 * existing schemas or stored data.
 *
 * The 15 fields come from the "Letting Time Be A Compounding Factor to
 * Success" document: startTime, endTime, actorIdentity, environment, inputs,
 * observedStateBefore, observedStateAfter, toolCalls, evidenceRefs,
 * successCriteria, judgeResult, replayPath, cost, confidence,
 * escalationStatus.
 */

import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";

// ---------------------------------------------------------------------------
// 1. ActorIdentity — who performed the action
// ---------------------------------------------------------------------------

export type ActorIdentity = "human" | "agent" | "mixed";

// ---------------------------------------------------------------------------
// 2. EvidenceRef — pointer to a screenshot, log, trace, or external artifact
// ---------------------------------------------------------------------------

export type EvidenceRef = {
  label: string;
  href?: string;
  kind?: string; // "screenshot" | "log" | "trace" | "artifact" | custom
  note?: string;
};

// ---------------------------------------------------------------------------
// 3. JudgeResult — outcome of evaluation on this span
// ---------------------------------------------------------------------------

export type JudgeResult = {
  verdict: string; // "pass" | "partial" | "fail" | "completed" | "failed" etc.
  confidence?: number; // 0..1
  reasoning?: string;
  criteriaPassed?: number;
  criteriaTotal?: number;
};

// ---------------------------------------------------------------------------
// 4. CostRecord — token and dollar cost of executing this span
// ---------------------------------------------------------------------------

export type CostRecord = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  latencyMs?: number;
};

// ---------------------------------------------------------------------------
// 5. EscalationStatus — current escalation state
// ---------------------------------------------------------------------------

export type EscalationStatus =
  | "none"
  | "pending_human_review"
  | "escalated"
  | "retrying"
  | "failed_permanent";

// ---------------------------------------------------------------------------
// 6. ActionSpan — the unified 15-field type
// ---------------------------------------------------------------------------

export type ActionSpan = {
  /** Unique identifier for tracing (spanKey or taskId:stepNumber) */
  id: string;

  /** Source table for provenance ("trajectorySpans" | "runSteps") */
  source: "trajectorySpans" | "runSteps";

  // --- The 15 canonical fields ---

  /** 1. When this span started (epoch ms) */
  startTime: number;

  /** 2. When this span ended (epoch ms); null if still running */
  endTime: number | null;

  /** 3. Who performed the action */
  actorIdentity: ActorIdentity;

  /** 4. Execution environment label (model name, agent ID, or session key) */
  environment: string | null;

  /** 5. What went in — free-form description of the action + its target */
  inputs: string;

  /** 6. Observed state before execution (null when not captured) */
  observedStateBefore: string | null;

  /** 7. Observed state after execution (summary / resultSummary) */
  observedStateAfter: string | null;

  /** 8. Tools invoked during this span */
  toolCalls: string[];

  /** 9. Evidence references (screenshots, logs, traces) */
  evidenceRefs: EvidenceRef[];

  /** 10. Success criteria that apply to this span */
  successCriteria: string[];

  /** 11. Judge evaluation result */
  judgeResult: JudgeResult | null;

  /** 12. Path to replay this span (traceKey + spanKey or missionId + taskId + step) */
  replayPath: Record<string, string>;

  /** 13. Cost of executing this span */
  cost: CostRecord;

  /** 14. Overall confidence in the span's outcome (0..1) */
  confidence: number | null;

  /** 15. Whether this span needs human escalation */
  escalationStatus: EscalationStatus;
};

// ---------------------------------------------------------------------------
// 7. Convex validator for ActionSpan (for use in Convex function args/returns)
// ---------------------------------------------------------------------------

export const actionSpanValidator = v.object({
  id: v.string(),
  source: v.union(v.literal("trajectorySpans"), v.literal("runSteps")),
  startTime: v.number(),
  endTime: v.union(v.number(), v.null()),
  actorIdentity: v.union(
    v.literal("human"),
    v.literal("agent"),
    v.literal("mixed"),
  ),
  environment: v.union(v.string(), v.null()),
  inputs: v.string(),
  observedStateBefore: v.union(v.string(), v.null()),
  observedStateAfter: v.union(v.string(), v.null()),
  toolCalls: v.array(v.string()),
  evidenceRefs: v.array(
    v.object({
      label: v.string(),
      href: v.optional(v.string()),
      kind: v.optional(v.string()),
      note: v.optional(v.string()),
    }),
  ),
  successCriteria: v.array(v.string()),
  judgeResult: v.union(
    v.object({
      verdict: v.string(),
      confidence: v.optional(v.number()),
      reasoning: v.optional(v.string()),
      criteriaPassed: v.optional(v.number()),
      criteriaTotal: v.optional(v.number()),
    }),
    v.null(),
  ),
  replayPath: v.any(),
  cost: v.object({
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
  }),
  confidence: v.union(v.number(), v.null()),
  escalationStatus: v.union(
    v.literal("none"),
    v.literal("pending_human_review"),
    v.literal("escalated"),
    v.literal("retrying"),
    v.literal("failed_permanent"),
  ),
});

// ---------------------------------------------------------------------------
// 8. Converter: trajectorySpans → ActionSpan
// ---------------------------------------------------------------------------

/**
 * Convert a trajectorySpans document into the unified ActionSpan shape.
 *
 * Field mapping:
 * - startTime        ← createdAt
 * - endTime          ← updatedAt (null if same as createdAt)
 * - actorIdentity    ← inferred from spanType ("agent" for most, "human" for review/intervention)
 * - environment      ← sessionKey ?? traceKey
 * - inputs           ← name (the span action label)
 * - observedStateAfter ← summary
 * - evidenceRefs     ← sourceRefs
 * - judgeResult      ← score + status
 * - replayPath       ← traceKey + spanKey + parentSpanKey
 * - confidence       ← evidenceCompletenessScore
 * - escalationStatus ← derived from status
 */
export function trajectorySpanToActionSpan(
  span: Doc<"trajectorySpans">,
): ActionSpan {
  const humanSpanTypes = new Set([
    "review",
    "intervention",
    "feedback",
    "sniff_check",
    "human_review",
  ]);
  const actorIdentity: ActorIdentity = humanSpanTypes.has(span.spanType)
    ? "human"
    : "agent";

  const evidenceRefs: EvidenceRef[] = (span.sourceRefs ?? []).map((ref) => ({
    label: ref.label,
    href: ref.href ?? undefined,
    kind: ref.kind ?? undefined,
    note: ref.note ?? undefined,
  }));

  const judgeResult: JudgeResult | null =
    span.score !== undefined || span.status
      ? {
          verdict: span.status,
          confidence: span.score ?? undefined,
        }
      : null;

  const replayPath: Record<string, string> = {
    entityKey: span.entityKey,
    entityType: span.entityType,
    spanKey: span.spanKey,
  };
  if (span.traceKey) replayPath.traceKey = span.traceKey;
  if (span.parentSpanKey) replayPath.parentSpanKey = span.parentSpanKey;
  if (span.sessionKey) replayPath.sessionKey = span.sessionKey;

  let escalationStatus: EscalationStatus = "none";
  if (span.status === "failed") escalationStatus = "failed_permanent";
  else if (span.status === "retrying") escalationStatus = "retrying";
  else if (span.status === "escalated") escalationStatus = "escalated";

  return {
    id: span.spanKey,
    source: "trajectorySpans",
    startTime: span.createdAt,
    endTime: span.updatedAt !== span.createdAt ? span.updatedAt : null,
    actorIdentity,
    environment: span.sessionKey ?? span.traceKey ?? null,
    inputs: span.name,
    observedStateBefore: null,
    observedStateAfter: span.summary,
    toolCalls: [],
    evidenceRefs,
    successCriteria: [],
    judgeResult,
    replayPath,
    cost: {},
    confidence: span.evidenceCompletenessScore ?? null,
    escalationStatus,
  };
}

// ---------------------------------------------------------------------------
// 9. Converter: runSteps → ActionSpan
// ---------------------------------------------------------------------------

/**
 * Convert a mission runSteps document into the unified ActionSpan shape.
 *
 * Field mapping:
 * - startTime        ← createdAt
 * - endTime          ← createdAt + latencyMs (null if latencyMs missing)
 * - actorIdentity    ← "agent" (all run steps are agent-executed)
 * - environment      ← modelUsed
 * - inputs           ← action + target + reason
 * - observedStateAfter ← resultSummary
 * - toolCalls        ← [toolUsed] if present
 * - evidenceRefs     ← evidenceRefs + artifactIds
 * - judgeResult      ← status
 * - replayPath       ← missionId + taskId + stepNumber
 * - cost             ← inputTokens + outputTokens + costUsd + latencyMs
 * - confidence       ← null (no per-step confidence in current schema)
 * - escalationStatus ← derived from status + errorCategory
 */
export function runStepToActionSpan(
  step: Doc<"runSteps">,
): ActionSpan {
  const toolCalls: string[] = [];
  if (step.toolUsed) toolCalls.push(step.toolUsed);

  const evidenceRefs: EvidenceRef[] = [
    ...(step.evidenceRefs ?? []).map((ref) => ({
      label: ref.label,
      href: ref.href ?? undefined,
      kind: ref.kind ?? undefined,
    })),
    ...(step.artifactIds ?? []).map((id) => ({
      label: `artifact:${id}`,
      kind: "artifact" as const,
    })),
  ];

  const inputParts = [step.action];
  if (step.target) inputParts.push(`target: ${step.target}`);
  inputParts.push(`reason: ${step.reason}`);

  const judgeResult: JudgeResult | null = {
    verdict: step.status,
    reasoning: step.errorMessage ?? undefined,
  };

  const replayPath: Record<string, string> = {
    missionId: String(step.missionId),
    taskId: String(step.taskId),
    stepNumber: String(step.stepNumber),
  };
  if (step.receiptId) replayPath.receiptId = step.receiptId;

  const totalTokens =
    step.inputTokens !== undefined && step.outputTokens !== undefined
      ? step.inputTokens + step.outputTokens
      : undefined;

  const cost: CostRecord = {
    inputTokens: step.inputTokens ?? undefined,
    outputTokens: step.outputTokens ?? undefined,
    totalTokens,
    costUsd: step.costUsd ?? undefined,
    latencyMs: step.latencyMs ?? undefined,
  };

  let escalationStatus: EscalationStatus = "none";
  if (step.status === "failed") {
    escalationStatus =
      step.errorCategory === "permanent" ||
      step.errorCategory === "hallucination" ||
      step.errorCategory === "contract_violation"
        ? "failed_permanent"
        : step.errorCategory === "transient" || step.errorCategory === "rate_limit"
          ? "retrying"
          : "escalated";
  } else if (step.status === "retrying") {
    escalationStatus = "retrying";
  }

  return {
    id: `${String(step.taskId)}:${step.stepNumber}`,
    source: "runSteps",
    startTime: step.createdAt,
    endTime: step.latencyMs != null ? step.createdAt + step.latencyMs : null,
    actorIdentity: "agent",
    environment: step.modelUsed ?? null,
    inputs: inputParts.join(" | "),
    observedStateBefore: null,
    observedStateAfter: step.resultSummary ?? null,
    toolCalls,
    evidenceRefs,
    successCriteria: [],
    judgeResult,
    replayPath,
    cost,
    confidence: null,
    escalationStatus,
  };
}
