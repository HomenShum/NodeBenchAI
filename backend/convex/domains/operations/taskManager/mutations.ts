/**
 * Task Manager Mutations
 *
 * CRUD operations for task sessions, traces, and spans.
 * Designed for integration with existing agent infrastructure.
 */

import { v } from "convex/values";
import { mutation, internalMutation } from "../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id, Doc } from "../../../_generated/dataModel";
import { appendNodeKitRunEvent } from "./nodeKitRunEvents";

const oracleSourceRefValidator = v.object({
  label: v.string(),
  href: v.optional(v.string()),
  note: v.optional(v.string()),
  kind: v.optional(v.string()),
});

const executionTraceStageValidator = v.union(
  v.literal("ingest"),
  v.literal("inspect"),
  v.literal("research"),
  v.literal("propose"),
  v.literal("edit"),
  v.literal("verify"),
  v.literal("export"),
  v.literal("summarize"),
);

const executionTraceStepTypeValidator = v.union(
  v.literal("task_started"),
  v.literal("file_loaded"),
  v.literal("sheet_inspected"),
  v.literal("format_detected"),
  v.literal("research_query_executed"),
  v.literal("evidence_attached"),
  v.literal("decision_recorded"),
  v.literal("cells_updated"),
  v.literal("comment_added"),
  v.literal("style_changed"),
  v.literal("render_generated"),
  v.literal("issue_detected"),
  v.literal("issue_fixed"),
  v.literal("verification_passed"),
  v.literal("artifact_exported"),
  v.literal("task_completed"),
);

const verificationStatusValidator = v.union(
  v.literal("passed"),
  v.literal("warning"),
  v.literal("failed"),
  v.literal("fixed"),
);

type ExecutionTraceStage =
  | "ingest"
  | "inspect"
  | "research"
  | "propose"
  | "edit"
  | "verify"
  | "export"
  | "summarize";

type ExecutionTraceStepType =
  | "task_started"
  | "file_loaded"
  | "sheet_inspected"
  | "format_detected"
  | "research_query_executed"
  | "evidence_attached"
  | "decision_recorded"
  | "cells_updated"
  | "comment_added"
  | "style_changed"
  | "render_generated"
  | "issue_detected"
  | "issue_fixed"
  | "verification_passed"
  | "artifact_exported"
  | "task_completed";

type VerificationStatus = "passed" | "warning" | "failed" | "fixed";

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// UTILITY FUNCTIONS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * Generate a unique trace ID (OpenTelemetry-compatible format)
 */
function generateTraceId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "trace_";
  for (let i = 0; i < 32; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function appendMetadataList(
  existingMetadata: unknown,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const nextMetadata = toRecord(existingMetadata) ?? {};
  const existing = Array.isArray(nextMetadata[key]) ? [...(nextMetadata[key] as unknown[])] : [];
  existing.push(value);
  return {
    ...nextMetadata,
    [key]: existing,
  };
}

function uniqueSourceRefs(
  refs: Array<{
    label: string;
    href?: string;
    note?: string;
    kind?: string;
  }>,
) {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.label}|${ref.href ?? ""}|${ref.note ?? ""}|${ref.kind ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mapSessionTypeToExecutionType(
  type: Doc<"agentTaskSessions">["type"],
): "swarm" | "tree" | "chat" | "forecast_refresh" | "linkedin_post" {
  switch (type) {
    case "swarm":
      return "swarm";
    case "cron":
    case "scheduled":
      return "forecast_refresh";
    case "agent":
    case "manual":
    default:
      return "chat";
  }
}

function inferSpanTypeFromStage(
  stage: ExecutionTraceStage,
): Doc<"agentTaskSpans">["spanType"] {
  switch (stage) {
    case "research":
      return "retrieval";
    case "propose":
      return "generation";
    case "verify":
      return "guardrail";
    default:
      return "custom";
  }
}

async function getNextSpanSequence(
  ctx: { db: any },
  traceId: Id<"agentTaskTraces">,
) {
  const existingSpans = await ctx.db
    .query("agentTaskSpans")
    .withIndex("by_trace", (q: any) => q.eq("traceId", traceId))
    .collect();
  return existingSpans.length;
}

async function getSpanDepth(
  ctx: { db: any },
  parentSpanId?: Id<"agentTaskSpans">,
) {
  if (!parentSpanId) return 0;
  const parent = await ctx.db.get(parentSpanId);
  return parent ? parent.depth + 1 : 0;
}

async function appendTraceAuditEntry(
  ctx: { db: any },
  trace: Doc<"agentTaskTraces">,
  session: Doc<"agentTaskSessions">,
  spanSeq: number,
  toolName: string,
  toolParams: unknown,
  success: boolean,
  durationMs: number,
  description: string,
  summary: string,
) {
  await ctx.db.insert("traceAuditEntries", {
    executionId: trace.traceId,
    userId: session.userId,
    executionType: mapSessionTypeToExecutionType(session.type),
    workflowTag: trace.workflowName,
    seq: spanSeq,
    timestamp: Date.now(),
    choiceType: success ? "execute_data_op" : "finalize",
    toolName,
    toolParams,
    metadata: {
      durationMs,
      success,
      deliverySummary: summary,
      intendedState: description,
      actualState: summary,
    },
    description,
    createdAt: Date.now(),
  });
}

/**
 * Utility function to safely extract and validate user ID from authentication
 */
async function getSafeUserId(ctx: any): Promise<Id<"users"> | null> {
  const rawUserId = await getAuthUserId(ctx);
  if (!rawUserId) {
    return null;
  }

  // Handle malformed user IDs with pipe characters
  let userId: Id<"users">;
  if (typeof rawUserId === "string" && rawUserId.includes("|")) {
    const userIdPart = rawUserId.split("|")[0];
    if (!userIdPart || userIdPart.length < 10) {
      return null;
    }
    userId = userIdPart as Id<"users">;
  } else {
    userId = rawUserId;
  }

  return userId;
}

async function requireAuthenticatedUserId(ctx: any): Promise<Id<"users">> {
  const userId = await getSafeUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  return userId;
}

async function requireOwnedSession(
  ctx: { db: any },
  sessionId: Id<"agentTaskSessions">,
  userId: Id<"users">,
): Promise<Doc<"agentTaskSessions">> {
  const session = await ctx.db.get(sessionId) as Doc<"agentTaskSessions"> | null;
  if (!session || session.userId !== userId) {
    throw new Error("Session not found or unauthorized");
  }
  return session;
}

async function requireOwnedTrace(
  ctx: { db: any },
  traceId: Id<"agentTaskTraces">,
  userId: Id<"users">,
): Promise<{
  trace: Doc<"agentTaskTraces">;
  session: Doc<"agentTaskSessions">;
}> {
  const trace = await ctx.db.get(traceId) as Doc<"agentTaskTraces"> | null;
  if (!trace) {
    throw new Error("Trace not found or unauthorized");
  }
  const session = await requireOwnedSession(ctx, trace.sessionId, userId);
  return { trace, session };
}

async function requireOwnedSpan(
  ctx: { db: any },
  spanId: Id<"agentTaskSpans">,
  userId: Id<"users">,
): Promise<Doc<"agentTaskSpans">> {
  const span = await ctx.db.get(spanId) as Doc<"agentTaskSpans"> | null;
  if (!span) {
    throw new Error("Span not found or unauthorized");
  }
  await requireOwnedTrace(ctx, span.traceId, userId);
  return span;
}

async function assertOwnedDogfoodRun(
  ctx: { db: any },
  dogfoodRunId: Id<"dogfoodQaRuns"> | undefined,
  userId: Id<"users">,
) {
  if (!dogfoodRunId) return;
  const run = await ctx.db.get(dogfoodRunId) as Doc<"dogfoodQaRuns"> | null;
  if (!run || run.userId !== userId) {
    throw new Error("Dogfood run not found or unauthorized");
  }
}

async function assertOwnedAgentRun(
  ctx: { db: any },
  agentRunId: Id<"agentRuns"> | undefined,
  userId: Id<"users">,
) {
  if (!agentRunId) return;
  const run = await ctx.db.get(agentRunId) as Doc<"agentRuns"> | null;
  if (!run || run.userId !== userId) {
    throw new Error("Agent run not found or unauthorized");
  }
}

async function assertParentSpanInTrace(
  ctx: { db: any },
  parentSpanId: Id<"agentTaskSpans"> | undefined,
  traceId: Id<"agentTaskTraces">,
) {
  if (!parentSpanId) return;
  const parent = await ctx.db.get(parentSpanId) as Doc<"agentTaskSpans"> | null;
  if (!parent || parent.traceId !== traceId) {
    throw new Error("Parent span not found in trace");
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SESSION MUTATIONS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * Create a new task session
 * Used when starting agent runs, cron jobs, or manual tasks
 */
export const createSession = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    type: v.union(
      v.literal("manual"),
      v.literal("cron"),
      v.literal("scheduled"),
      v.literal("agent"),
      v.literal("swarm"),
    ),
    visibility: v.union(
      v.literal("public"),
      v.literal("private"),
    ),
    cronJobName: v.optional(v.string()),
    agentRunId: v.optional(v.id("agentRuns")),
    agentThreadId: v.optional(v.string()),
    swarmId: v.optional(v.string()),
    goalId: v.optional(v.string()),
    visionSnapshot: v.optional(v.string()),
    successCriteria: v.optional(v.array(v.string())),
    sourceRefs: v.optional(v.array(v.object({
      label: v.string(),
      href: v.optional(v.string()),
      note: v.optional(v.string()),
      kind: v.optional(v.string()),
    }))),
    crossCheckStatus: v.optional(v.union(
      v.literal("aligned"),
      v.literal("drifting"),
      v.literal("violated"),
    )),
    metadata: v.optional(v.any()),
  },
  returns: v.id("agentTaskSessions"),
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(ctx);
    await assertOwnedAgentRun(ctx, args.agentRunId, userId);
    const now = Date.now();

    const sessionId = await ctx.db.insert("agentTaskSessions", {
      title: args.title,
      description: args.description,
      type: args.type,
      visibility: args.visibility,
      userId,
      status: "pending",
      startedAt: now,
      cronJobName: args.cronJobName,
      agentRunId: args.agentRunId,
      agentThreadId: args.agentThreadId,
      swarmId: args.swarmId,
      goalId: args.goalId,
      visionSnapshot: args.visionSnapshot,
      successCriteria: args.successCriteria,
      sourceRefs: args.sourceRefs,
      crossCheckStatus: args.crossCheckStatus,
      metadata: args.metadata,
    });

    return sessionId;
  },
});

/**
 * Update session status (for starting, completing, failing)
 */
async function updateSessionStatusForOwner(
  ctx: { db: any },
  args: any,
  userId: Id<"users">,
) {
  const session = await requireOwnedSession(ctx, args.sessionId, userId);
  await assertOwnedDogfoodRun(ctx, args.dogfoodRunId, userId);

  const updates: Partial<Doc<"agentTaskSessions">> = {
    status: args.status,
  };

  if (["completed", "failed", "cancelled"].includes(args.status)) {
    updates.completedAt = Date.now();
    updates.totalDurationMs = Date.now() - session.startedAt;
  }

  if (args.errorMessage) updates.errorMessage = args.errorMessage;
  if (args.errorStack) updates.errorStack = args.errorStack;
  if (args.crossCheckStatus) updates.crossCheckStatus = args.crossCheckStatus;
  if (args.deltaFromVision !== undefined) updates.deltaFromVision = args.deltaFromVision;
  if (args.dogfoodRunId) updates.dogfoodRunId = args.dogfoodRunId;

  await ctx.db.patch(args.sessionId, updates);
}

export const updateSessionStatus = mutation({
  args: {
    sessionId: v.id("agentTaskSessions"),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    errorMessage: v.optional(v.string()),
    errorStack: v.optional(v.string()),
    crossCheckStatus: v.optional(v.union(
      v.literal("aligned"),
      v.literal("drifting"),
      v.literal("violated"),
    )),
    deltaFromVision: v.optional(v.string()),
    dogfoodRunId: v.optional(v.id("dogfoodQaRuns")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(ctx);
    await updateSessionStatusForOwner(ctx, args, userId);
  },
});

/**
 * Update session metrics (aggregated from traces/spans)
 */
async function updateSessionMetricsForOwner(
  ctx: { db: any },
  args: any,
  userId: Id<"users">,
) {
  await requireOwnedSession(ctx, args.sessionId, userId);
  await ctx.db.patch(args.sessionId, {
    totalTokens: args.totalTokens,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    toolsUsed: args.toolsUsed,
    agentsInvolved: args.agentsInvolved,
    estimatedCostUsd: args.estimatedCostUsd,
  });
}

export const updateSessionMetrics = mutation({
  args: {
    sessionId: v.id("agentTaskSessions"),
    totalTokens: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    toolsUsed: v.optional(v.array(v.string())),
    agentsInvolved: v.optional(v.array(v.string())),
    estimatedCostUsd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(ctx);
    await updateSessionMetricsForOwner(ctx, args, userId);
  },
});

export const updateSessionOracleContext = mutation({
  args: {
    sessionId: v.id("agentTaskSessions"),
    goalId: v.optional(v.string()),
    visionSnapshot: v.optional(v.string()),
    successCriteria: v.optional(v.array(v.string())),
    sourceRefs: v.optional(v.array(v.object({
      label: v.string(),
      href: v.optional(v.string()),
      note: v.optional(v.string()),
      kind: v.optional(v.string()),
    }))),
    crossCheckStatus: v.optional(v.union(
      v.literal("aligned"),
      v.literal("drifting"),
      v.literal("violated"),
    )),
    deltaFromVision: v.optional(v.string()),
    dogfoodRunId: v.optional(v.id("dogfoodQaRuns")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(ctx);
    const session = await requireOwnedSession(ctx, args.sessionId, userId);
    await assertOwnedDogfoodRun(ctx, args.dogfoodRunId, userId);

    await ctx.db.patch(args.sessionId, {
      goalId: args.goalId ?? session.goalId,
      visionSnapshot: args.visionSnapshot ?? session.visionSnapshot,
      successCriteria: args.successCriteria ?? session.successCriteria,
      sourceRefs: args.sourceRefs ?? session.sourceRefs,
      crossCheckStatus: args.crossCheckStatus ?? session.crossCheckStatus,
      deltaFromVision: args.deltaFromVision ?? session.deltaFromVision,
      dogfoodRunId: args.dogfoodRunId ?? session.dogfoodRunId,
    });
  },
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// INTERNAL SESSION MUTATIONS (for cron wrapper and actions)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * Start a new task session (internal, for use in actions)
 */
export const startSession = internalMutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    type: v.union(
      v.literal("manual"),
      v.literal("cron"),
      v.literal("scheduled"),
      v.literal("agent"),
      v.literal("swarm"),
    ),
    visibility: v.union(
      v.literal("public"),
      v.literal("private"),
    ),
    cronJobName: v.optional(v.string()),
    agentRunId: v.optional(v.id("agentRuns")),
    agentThreadId: v.optional(v.string()),
    swarmId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.id("agentTaskSessions"),
  handler: async (ctx, args) => {
    const now = Date.now();

    const sessionId = await ctx.db.insert("agentTaskSessions", {
      title: args.title,
      description: args.description,
      type: args.type,
      visibility: args.visibility,
      status: "running",
      startedAt: now,
      cronJobName: args.cronJobName,
      agentRunId: args.agentRunId,
      agentThreadId: args.agentThreadId,
      swarmId: args.swarmId,
      metadata: args.metadata,
    });

    return sessionId;
  },
});

/**
 * Complete a task session successfully (internal, for use in actions)
 */
export const completeSession = internalMutation({
  args: {
    sessionId: v.id("agentTaskSessions"),
    completedAt: v.number(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    toolsUsed: v.optional(v.array(v.string())),
    agentsInvolved: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const totalTokens = (args.inputTokens ?? 0) + (args.outputTokens ?? 0);
    const totalDurationMs = args.completedAt - session.startedAt;

    await ctx.db.patch(args.sessionId, {
      status: "completed",
      completedAt: args.completedAt,
      totalDurationMs,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      totalTokens,
      toolsUsed: args.toolsUsed,
      agentsInvolved: args.agentsInvolved,
      metadata: args.metadata ? { ...session.metadata, ...args.metadata } : undefined,
    });
  },
});

/**
 * Fail a task session (internal, for use in actions)
 */
export const failSession = internalMutation({
  args: {
    sessionId: v.id("agentTaskSessions"),
    completedAt: v.number(),
    errorMessage: v.string(),
    errorStack: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    toolsUsed: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const totalTokens = (args.inputTokens ?? 0) + (args.outputTokens ?? 0);
    const totalDurationMs = args.completedAt - session.startedAt;

    await ctx.db.patch(args.sessionId, {
      status: "failed",
      completedAt: args.completedAt,
      totalDurationMs,
      errorMessage: args.errorMessage,
      errorStack: args.errorStack,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      totalTokens,
      toolsUsed: args.toolsUsed,
    });
  },
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TRACE MUTATIONS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * Create a new trace within a session
 */
export const createTrace = mutation({
  args: {
    sessionId: v.id("agentTaskSessions"),
    workflowName: v.string(),
    groupId: v.optional(v.string()),
    model: v.optional(v.string()),
    goalId: v.optional(v.string()),
    visionSnapshot: v.optional(v.string()),
    successCriteria: v.optional(v.array(v.string())),
    sourceRefs: v.optional(v.array(v.object({
      label: v.string(),
      href: v.optional(v.string()),
      note: v.optional(v.string()),
      kind: v.optional(v.string()),
    }))),
    crossCheckStatus: v.optional(v.union(
      v.literal("aligned"),
      v.literal("drifting"),
      v.literal("violated"),
    )),
    metadata: v.optional(v.any()),
  },
  returns: v.id("agentTaskTraces"),
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(ctx);
    const session = await requireOwnedSession(ctx, args.sessionId, userId);
    const traceId = generateTraceId();
    const now = Date.now();

    const id = await ctx.db.insert("agentTaskTraces", {
      sessionId: args.sessionId,
      traceId,
      workflowName: args.workflowName,
      groupId: args.groupId,
      goalId: args.goalId,
      visionSnapshot: args.visionSnapshot,
      successCriteria: args.successCriteria,
      sourceRefs: args.sourceRefs,
      crossCheckStatus: args.crossCheckStatus,
      status: "running",
      startedAt: now,
      model: args.model,
      metadata: args.metadata,
    });

    await appendNodeKitRunEvent(ctx, {
      sessionId: args.sessionId,
      traceId: id,
      userId,
      runId: traceId,
      eventType: "run.started",
      recordedAt: now,
      payload: {
        workflowName: args.workflowName,
        sessionType: session.type,
        sessionStartedAt: session.startedAt,
        ...(args.groupId === undefined ? {} : { groupId: args.groupId }),
        ...(args.model === undefined ? {} : { model: args.model }),
        ...(args.goalId === undefined ? {} : { goalId: args.goalId }),
      },
      allowLegacySkip: false,
    });

    return id;
  },
});

/**
 * Complete a trace
 */
async function completeTraceForOwner(
  ctx: { db: any },
  args: any,
  userId: Id<"users">,
) {
  const { trace, session } = await requireOwnedTrace(
    ctx,
    args.traceId,
    userId,
  );
  await assertOwnedDogfoodRun(ctx, args.dogfoodRunId, userId);
  if (trace.status !== "running") {
    const expectedStatus = args.status === "completed" ? "completed" : "error";
    if (trace.status === expectedStatus) return;
    throw new Error(`Trace is already terminal with status ${trace.status}`);
  }
  const now = Date.now();

  await appendNodeKitRunEvent(ctx, {
    sessionId: session._id,
    traceId: args.traceId,
    userId,
    runId: trace.traceId,
    eventType: args.status === "completed" ? "run.completed" : "run.failed",
    recordedAt: now,
    payload: {
      status: args.status,
      totalDurationMs: now - trace.startedAt,
      ...(args.crossCheckStatus === undefined
        ? {}
        : { crossCheckStatus: args.crossCheckStatus }),
      ...(args.deltaFromVision === undefined
        ? {}
        : { deltaFromVision: args.deltaFromVision }),
      ...(args.dogfoodRunId === undefined
        ? {}
        : { dogfoodRunId: String(args.dogfoodRunId) }),
    },
  });

  await ctx.db.patch(args.traceId, {
    status: args.status,
    endedAt: now,
    totalDurationMs: now - trace.startedAt,
    tokenUsage: args.tokenUsage,
    estimatedCostUsd: args.estimatedCostUsd,
    crossCheckStatus: args.crossCheckStatus ?? trace.crossCheckStatus,
    deltaFromVision: args.deltaFromVision ?? trace.deltaFromVision,
    dogfoodRunId: args.dogfoodRunId ?? trace.dogfoodRunId,
  });
}

export const completeTrace = mutation({
  args: {
    traceId: v.id("agentTaskTraces"),
    status: v.union(v.literal("completed"), v.literal("error")),
    tokenUsage: v.optional(v.object({
      input: v.number(),
      output: v.number(),
      total: v.number(),
    })),
    estimatedCostUsd: v.optional(v.number()),
    crossCheckStatus: v.optional(v.union(
      v.literal("aligned"),
      v.literal("drifting"),
      v.literal("violated"),
    )),
    deltaFromVision: v.optional(v.string()),
    dogfoodRunId: v.optional(v.id("dogfoodQaRuns")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(ctx);
    await completeTraceForOwner(ctx, args, userId);
  },
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SPAN MUTATIONS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * Create a new span within a trace
 */
export const createSpan = mutation({
  args: {
    traceId: v.id("agentTaskTraces"),
    parentSpanId: v.optional(v.id("agentTaskSpans")),
    spanType: v.union(
      v.literal("agent"),
      v.literal("generation"),
      v.literal("tool"),
      v.literal("guardrail"),
      v.literal("handoff"),
      v.literal("retrieval"),
      v.literal("delegation"),
      v.literal("custom"),
    ),
    name: v.string(),
    data: v.optional(v.any()),
    metadata: v.optional(v.any()),
  },
  returns: v.id("agentTaskSpans"),
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(ctx);
    const { trace, session } = await requireOwnedTrace(
      ctx,
      args.traceId,
      userId,
    );
    await assertParentSpanInTrace(ctx, args.parentSpanId, args.traceId);
    const seq = await getNextSpanSequence(ctx, args.traceId);
    const depth = await getSpanDepth(ctx, args.parentSpanId);
    const startedAt = Date.now();

    const id = await ctx.db.insert("agentTaskSpans", {
      traceId: args.traceId,
      parentSpanId: args.parentSpanId,
      seq,
      depth,
      spanType: args.spanType,
      name: args.name,
      status: "running",
      startedAt,
      data: args.data,
      metadata: args.metadata,
    });

    await appendNodeKitRunEvent(ctx, {
      sessionId: session._id,
      traceId: args.traceId,
      userId,
      runId: trace.traceId,
      eventType: "span.started",
      recordedAt: startedAt,
      payload: {
        spanId: String(id),
        spanSequence: seq,
        depth,
        spanType: args.spanType,
        name: args.name,
        ...(args.parentSpanId === undefined
          ? {}
          : { parentSpanId: String(args.parentSpanId) }),
        ...(args.data === undefined ? {} : { data: args.data }),
        ...(args.metadata === undefined ? {} : { metadata: args.metadata }),
      },
    });

    return id;
  },
});

async function recordStepForOwner(
  ctx: { db: any },
  args: any,
  userId: Id<"users">,
) {
  const { trace, session } = await requireOwnedTrace(ctx, args.traceId, userId);
  await assertParentSpanInTrace(ctx, args.parentSpanId, args.traceId);

  const seq = await getNextSpanSequence(ctx, args.traceId);
  const depth = await getSpanDepth(ctx, args.parentSpanId);
  const startedAt = args.startedAt ?? Date.now();
  const endedAt = args.endedAt ?? startedAt;
  const durationMs = Math.max(0, endedAt - startedAt);
  const stepPayload = {
    stage: args.stage,
    type: args.type,
    title: args.title,
    tool: args.tool,
    action: args.action,
    target: args.target,
    resultSummary: args.resultSummary,
    evidenceRefs: args.evidenceRefs ?? [],
    artifactsOut: args.artifactsOut ?? [],
    verification: args.verification ?? [],
    confidence: args.confidence,
  };

  const spanId = await ctx.db.insert("agentTaskSpans", {
    traceId: args.traceId,
    parentSpanId: args.parentSpanId,
    seq,
    depth,
    spanType: inferSpanTypeFromStage(args.stage),
    name: args.title,
    status: "completed",
    startedAt,
    endedAt,
    durationMs,
    data: { executionTraceStep: stepPayload },
    metadata: {
      summary: args.resultSummary,
      ...toRecord(args.metadata),
    },
  });

  await appendTraceAuditEntry(
    ctx,
    trace,
    session,
    seq,
    args.tool,
    { action: args.action, target: args.target },
    true,
    durationMs,
    `${args.title} (${args.stage})`,
    args.resultSummary,
  );

  await appendNodeKitRunEvent(ctx, {
    sessionId: session._id,
    traceId: args.traceId,
    userId,
    runId: trace.traceId,
    eventType: "step.recorded",
    recordedAt: endedAt,
    payload: {
      spanId: String(spanId),
      spanSequence: seq,
      startedAt,
      endedAt,
      durationMs,
      ...stepPayload,
      ...(args.parentSpanId === undefined
        ? {}
        : { parentSpanId: String(args.parentSpanId) }),
      ...(args.metadata === undefined ? {} : { metadata: args.metadata }),
    },
  });

  return spanId;
}

export const recordStep = mutation({
  args: {
    traceId: v.id("agentTaskTraces"),
    parentSpanId: v.optional(v.id("agentTaskSpans")),
    stage: executionTraceStageValidator,
    type: executionTraceStepTypeValidator,
    title: v.string(),
    tool: v.string(),
    action: v.string(),
    target: v.string(),
    resultSummary: v.string(),
    evidenceRefs: v.optional(v.array(v.string())),
    artifactsOut: v.optional(v.array(v.string())),
    verification: v.optional(v.array(v.string())),
    confidence: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  returns: v.id("agentTaskSpans"),
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(ctx);
    return recordStepForOwner(ctx, args, userId);
  },
});

async function recordDecisionForOwner(
  ctx: { db: any },
  args: any,
  userId: Id<"users">,
) {
  const { trace, session } = await requireOwnedTrace(
    ctx,
    args.traceId,
    userId,
  );
  const recordedAt = Date.now();
  const decision = {
    decisionType: args.decisionType,
    statement: args.statement,
    basis: args.basis,
    evidenceRefs: args.evidenceRefs ?? [],
    alternativesConsidered: args.alternativesConsidered ?? [],
    confidence: args.confidence,
    limitations: args.limitations ?? [],
    recordedAt,
  };

  const metadata = appendMetadataList(trace.metadata, "executionTraceDecisions", decision);
  metadata.decisions = metadata.executionTraceDecisions;
  await ctx.db.patch(args.traceId, { metadata });
  await appendNodeKitRunEvent(ctx, {
    sessionId: session._id,
    traceId: args.traceId,
    userId,
    runId: trace.traceId,
    eventType: "decision.recorded",
    recordedAt,
    payload: decision,
  });
  return args.traceId;
}

export const recordDecision = mutation({
  args: {
    traceId: v.id("agentTaskTraces"),
    decisionType: v.string(),
    statement: v.string(),
    basis: v.array(v.string()),
    evidenceRefs: v.optional(v.array(v.string())),
    alternativesConsidered: v.optional(v.array(v.string())),
    confidence: v.optional(v.number()),
    limitations: v.optional(v.array(v.string())),
  },
  returns: v.id("agentTaskTraces"),
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(ctx);
    return recordDecisionForOwner(ctx, args, userId);
  },
});

async function recordVerificationForOwner(
  ctx: { db: any },
  args: any,
  userId: Id<"users">,
) {
  const { trace, session } = await requireOwnedTrace(ctx, args.traceId, userId);
  const verification = {
    label: args.label,
    status: args.status,
    details: args.details,
    relatedArtifactIds: args.relatedArtifactIds ?? [],
    recordedAt: Date.now(),
  };

  const metadata = appendMetadataList(trace.metadata, "executionTraceVerificationChecks", verification);
  metadata.verificationChecks = metadata.executionTraceVerificationChecks;
  await ctx.db.patch(args.traceId, { metadata });

  if (args.createGuardrailSpan ?? true) {
    const seq = await getNextSpanSequence(ctx, args.traceId);
    await ctx.db.insert("agentTaskSpans", {
      traceId: args.traceId,
      seq,
      depth: 0,
      spanType: "guardrail",
      name: args.label,
      status: args.status === "failed" ? "error" : "completed",
      startedAt: Date.now(),
      endedAt: Date.now(),
      durationMs: 0,
      data: {
        executionTraceVerification: verification,
        executionTraceStep: {
          stage: "verify",
          type: args.status === "fixed" ? "issue_fixed" : args.status === "failed" ? "issue_detected" : "verification_passed",
          title: args.label,
          tool: "verification",
          action: "record_verification",
          target: args.label,
          resultSummary: args.details,
          evidenceRefs: [],
          artifactsOut: args.relatedArtifactIds ?? [],
          verification: [args.details],
        },
      },
      metadata: { summary: args.details },
      error: args.status === "failed" ? { message: args.details } : undefined,
    });

    await appendTraceAuditEntry(
      ctx,
      trace,
      session,
      seq,
      "verification",
      { label: args.label, status: args.status },
      args.status !== "failed",
      0,
      `Verification recorded: ${args.label}`,
      args.details,
    );
  }

  await appendNodeKitRunEvent(ctx, {
    sessionId: session._id,
    traceId: args.traceId,
    userId,
    runId: trace.traceId,
    eventType: "verification.recorded",
    recordedAt: verification.recordedAt,
    payload: verification,
  });

  return args.traceId;
}

export const recordVerification = mutation({
  args: {
    traceId: v.id("agentTaskTraces"),
    label: v.string(),
    status: verificationStatusValidator,
    details: v.string(),
    relatedArtifactIds: v.optional(v.array(v.string())),
    createGuardrailSpan: v.optional(v.boolean()),
  },
  returns: v.id("agentTaskTraces"),
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(ctx);
    return recordVerificationForOwner(ctx, args, userId);
  },
});

async function attachEvidenceForOwner(
  ctx: { db: any },
  args: any,
  userId: Id<"users">,
) {
  const { trace, session } = await requireOwnedTrace(
    ctx,
    args.traceId,
    userId,
  );
  const recordedAt = Date.now();
  const evidence = {
    title: args.title,
    summary: args.summary,
    sourceRefs: args.sourceRefs,
    supportedClaims: args.supportedClaims ?? [],
    unsupportedClaims: args.unsupportedClaims ?? [],
    recordedAt,
  };

  const metadata = appendMetadataList(trace.metadata, "executionTraceEvidence", evidence);
  metadata.evidenceCatalog = metadata.executionTraceEvidence;
  const mergedSourceRefs = uniqueSourceRefs([...(trace.sourceRefs ?? []), ...args.sourceRefs]);

  await ctx.db.patch(args.traceId, { metadata, sourceRefs: mergedSourceRefs });
  await appendNodeKitRunEvent(ctx, {
    sessionId: session._id,
    traceId: args.traceId,
    userId,
    runId: trace.traceId,
    eventType: "evidence.attached",
    recordedAt,
    payload: evidence,
  });
  return args.traceId;
}

export const attachEvidence = mutation({
  args: {
    traceId: v.id("agentTaskTraces"),
    title: v.string(),
    summary: v.string(),
    sourceRefs: v.array(oracleSourceRefValidator),
    supportedClaims: v.optional(v.array(v.string())),
    unsupportedClaims: v.optional(v.array(v.string())),
  },
  returns: v.id("agentTaskTraces"),
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(ctx);
    return attachEvidenceForOwner(ctx, args, userId);
  },
});

async function requestTraceApprovalForOwner(
  ctx: { db: any },
  args: any,
  userId: Id<"users">,
) {
  const session = await requireOwnedSession(ctx, args.sessionId, userId);
  let ownedTrace: Doc<"agentTaskTraces"> | null = null;
  if (args.traceId) {
    const { trace } = await requireOwnedTrace(ctx, args.traceId, userId);
    if (trace.sessionId !== args.sessionId) {
      throw new Error("Trace does not belong to session");
    }
    ownedTrace = trace;
  }

  const threadId = session.agentThreadId ?? `task-session:${String(args.sessionId)}`;
  const recordedAt = Date.now();
  const approvalId = await ctx.db.insert("toolApprovals", {
    userId,
    threadId,
    toolName: args.toolName,
    toolArgs: {
      ...(toRecord(args.toolArgs) ?? {}),
      justification: args.justification,
      sessionId: String(args.sessionId),
      traceId: args.traceId ? String(args.traceId) : undefined,
    },
    status: "pending",
    riskLevel: args.riskLevel,
    reason: args.justification,
    createdAt: recordedAt,
  });

  if (args.traceId && ownedTrace) {
    const metadata = appendMetadataList(ownedTrace.metadata, "executionTraceApprovals", {
      approvalId: String(approvalId),
      toolName: args.toolName,
      riskLevel: args.riskLevel,
      justification: args.justification,
      status: "pending",
      recordedAt,
    });
    await ctx.db.patch(args.traceId, { metadata });
    await appendNodeKitRunEvent(ctx, {
      sessionId: session._id,
      traceId: args.traceId,
      userId,
      runId: ownedTrace.traceId,
      eventType: "approval.requested",
      recordedAt,
      payload: {
        approvalId: String(approvalId),
        toolName: args.toolName,
        riskLevel: args.riskLevel,
        justification: args.justification,
        toolArgs: args.toolArgs ?? null,
      },
    });
  }

  return approvalId;
}

export const requestTraceApproval = mutation({
  args: {
    sessionId: v.id("agentTaskSessions"),
    traceId: v.optional(v.id("agentTaskTraces")),
    toolName: v.string(),
    toolArgs: v.optional(v.any()),
    riskLevel: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    justification: v.string(),
  },
  returns: v.id("toolApprovals"),
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(ctx);
    return requestTraceApprovalForOwner(ctx, args, userId);
  },
});

// Secret-gated MCP/service callers receive their userId from the gateway.
// These internal paths preserve execution-trace workflows without making
// owner identity forgeable through the public Convex API.
export const updateSessionStatusForService = internalMutation({
  args: {
    userId: v.string(),
    sessionId: v.id("agentTaskSessions"),
    status: v.union(v.literal("pending"), v.literal("running"), v.literal("completed"), v.literal("failed"), v.literal("cancelled")),
    errorMessage: v.optional(v.string()),
    errorStack: v.optional(v.string()),
    crossCheckStatus: v.optional(v.union(v.literal("aligned"), v.literal("drifting"), v.literal("violated"))),
    deltaFromVision: v.optional(v.string()),
    dogfoodRunId: v.optional(v.id("dogfoodQaRuns")),
  },
  handler: async (ctx, args) =>
    updateSessionStatusForOwner(ctx, args, args.userId as Id<"users">),
});

export const updateSessionMetricsForService = internalMutation({
  args: {
    userId: v.string(),
    sessionId: v.id("agentTaskSessions"),
    totalTokens: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    toolsUsed: v.optional(v.array(v.string())),
    agentsInvolved: v.optional(v.array(v.string())),
    estimatedCostUsd: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    updateSessionMetricsForOwner(ctx, args, args.userId as Id<"users">),
});

export const completeTraceForService = internalMutation({
  args: {
    userId: v.string(),
    traceId: v.id("agentTaskTraces"),
    status: v.union(v.literal("completed"), v.literal("error")),
    tokenUsage: v.optional(v.object({ input: v.number(), output: v.number(), total: v.number() })),
    estimatedCostUsd: v.optional(v.number()),
    crossCheckStatus: v.optional(v.union(v.literal("aligned"), v.literal("drifting"), v.literal("violated"))),
    deltaFromVision: v.optional(v.string()),
    dogfoodRunId: v.optional(v.id("dogfoodQaRuns")),
  },
  handler: async (ctx, args) =>
    completeTraceForOwner(ctx, args, args.userId as Id<"users">),
});

// One service-owned run must not expose a completed trace with a still-running session.
// Both existing lifecycle operations share this Convex transaction and roll back together.
export const completeExecutionRunForService = internalMutation({
  args: {
    userId: v.string(),
    traceId: v.id("agentTaskTraces"),
    status: v.union(v.literal("completed"), v.literal("error")),
    tokenUsage: v.optional(v.object({ input: v.number(), output: v.number(), total: v.number() })),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const trace = await ctx.db.get(args.traceId);
    if (!trace) throw new Error("Trace not found or unauthorized");
    await completeTraceForOwner(ctx, args, args.userId as Id<"users">);
    await updateSessionStatusForOwner(ctx, { sessionId: trace.sessionId, status: args.status === "completed" ? "completed" : "failed", errorMessage: args.errorMessage }, args.userId as Id<"users">);
  },
});

export const recordStepForService = internalMutation({
  args: {
    userId: v.string(),
    traceId: v.id("agentTaskTraces"),
    parentSpanId: v.optional(v.id("agentTaskSpans")),
    stage: executionTraceStageValidator,
    type: executionTraceStepTypeValidator,
    title: v.string(),
    tool: v.string(),
    action: v.string(),
    target: v.string(),
    resultSummary: v.string(),
    evidenceRefs: v.optional(v.array(v.string())),
    artifactsOut: v.optional(v.array(v.string())),
    verification: v.optional(v.array(v.string())),
    confidence: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  returns: v.id("agentTaskSpans"),
  handler: async (ctx, args) =>
    recordStepForOwner(ctx, args, args.userId as Id<"users">),
});

export const recordDecisionForService = internalMutation({
  args: {
    userId: v.string(),
    traceId: v.id("agentTaskTraces"),
    decisionType: v.string(),
    statement: v.string(),
    basis: v.array(v.string()),
    evidenceRefs: v.optional(v.array(v.string())),
    alternativesConsidered: v.optional(v.array(v.string())),
    confidence: v.optional(v.number()),
    limitations: v.optional(v.array(v.string())),
  },
  returns: v.id("agentTaskTraces"),
  handler: async (ctx, args) =>
    recordDecisionForOwner(ctx, args, args.userId as Id<"users">),
});

export const recordVerificationForService = internalMutation({
  args: {
    userId: v.string(),
    traceId: v.id("agentTaskTraces"),
    label: v.string(),
    status: verificationStatusValidator,
    details: v.string(),
    relatedArtifactIds: v.optional(v.array(v.string())),
    createGuardrailSpan: v.optional(v.boolean()),
  },
  returns: v.id("agentTaskTraces"),
  handler: async (ctx, args) =>
    recordVerificationForOwner(ctx, args, args.userId as Id<"users">),
});

export const attachEvidenceForService = internalMutation({
  args: {
    userId: v.string(),
    traceId: v.id("agentTaskTraces"),
    title: v.string(),
    summary: v.string(),
    sourceRefs: v.array(oracleSourceRefValidator),
    supportedClaims: v.optional(v.array(v.string())),
    unsupportedClaims: v.optional(v.array(v.string())),
  },
  returns: v.id("agentTaskTraces"),
  handler: async (ctx, args) =>
    attachEvidenceForOwner(ctx, args, args.userId as Id<"users">),
});

export const requestTraceApprovalForService = internalMutation({
  args: {
    userId: v.string(),
    sessionId: v.id("agentTaskSessions"),
    traceId: v.optional(v.id("agentTaskTraces")),
    toolName: v.string(),
    toolArgs: v.optional(v.any()),
    riskLevel: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    justification: v.string(),
  },
  returns: v.id("toolApprovals"),
  handler: async (ctx, args) =>
    requestTraceApprovalForOwner(ctx, args, args.userId as Id<"users">),
});

/**
 * Complete a span
 */
export const completeSpan = mutation({
  args: {
    spanId: v.id("agentTaskSpans"),
    status: v.union(v.literal("completed"), v.literal("error")),
    data: v.optional(v.any()),
    error: v.optional(v.object({
      message: v.string(),
      code: v.optional(v.string()),
      stack: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(ctx);
    const span = await requireOwnedSpan(ctx, args.spanId, userId);
    const { trace, session } = await requireOwnedTrace(
      ctx,
      span.traceId,
      userId,
    );

    const now = Date.now();

    await ctx.db.patch(args.spanId, {
      status: args.status,
      endedAt: now,
      durationMs: now - span.startedAt,
      data: args.data ?? span.data,
      error: args.error,
    });
    await appendNodeKitRunEvent(ctx, {
      sessionId: session._id,
      traceId: span.traceId,
      userId,
      runId: trace.traceId,
      eventType: "span.completed",
      recordedAt: now,
      payload: {
        spanId: String(args.spanId),
        spanSequence: span.seq,
        status: args.status,
        durationMs: now - span.startedAt,
        ...(args.data === undefined ? {} : { data: args.data }),
        ...(args.error === undefined ? {} : { error: args.error }),
      },
    });
  },
});
