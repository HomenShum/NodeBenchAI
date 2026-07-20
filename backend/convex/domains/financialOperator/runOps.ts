/**
 * Financial Operator Console — runs + steps CRUD.
 *
 * Run lifecycle: created → planning → running → (awaiting_approval | completed | error)
 * Each run has an append-only stream of typed steps that the chat renders
 * as cards (run_brief, tool_call, extraction, validation, calculation,
 * evidence, artifact, approval_request, result).
 *
 * Pattern: scratchpad-first + orchestrator-workers (per .claude/rules).
 * Append-only — never mutate prior steps; new state = new step.
 *
 * Reliability:
 *   - BOUND: per-run step count capped at MAX_STEPS_PER_RUN
 *   - HONEST_STATUS: errors set status="error" with errorMessage; never fake success
 *   - DETERMINISTIC: seq monotonic per run via nextSeq counter on the run row
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

// BOUND — protects DB + UI from runaway agents.
const MAX_STEPS_PER_RUN = 200;

const TASK_TYPE_VALIDATOR = v.union(
  v.literal("financial_metric_extraction"),
  v.literal("financial_data_cleanup"),
  v.literal("covenant_compliance"),
  v.literal("variance_analysis"),
  v.literal("custom"),
);

const RUN_STATUS_VALIDATOR = v.union(
  v.literal("created"),
  v.literal("planning"),
  v.literal("running"),
  v.literal("awaiting_approval"),
  v.literal("completed"),
  v.literal("rejected"),
  v.literal("error"),
);

const STEP_KIND_VALIDATOR = v.union(
  v.literal("run_brief"),
  v.literal("tool_call"),
  v.literal("extraction"),
  v.literal("validation"),
  v.literal("calculation"),
  v.literal("evidence"),
  v.literal("artifact"),
  v.literal("approval_request"),
  v.literal("result"),
);

const STEP_STATUS_VALIDATOR = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("complete"),
  v.literal("error"),
  v.literal("needs_review"),
  v.literal("approved"),
  v.literal("rejected"),
);

/* ------------------------------------------------------------------ */
/* MUTATIONS                                                           */
/* ------------------------------------------------------------------ */

export const createRun = mutation({
  args: {
    userId: v.optional(v.id("users")),
    threadId: v.optional(v.string()),
    taskType: TASK_TYPE_VALIDATOR,
    goal: v.string(),
    files: v.optional(
      v.array(
        v.object({
          name: v.string(),
          kind: v.string(),
          sizeBytes: v.optional(v.number()),
        }),
      ),
    ),
    totalSteps: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const runId = await ctx.db.insert("financialOperatorRuns", {
      userId: args.userId,
      threadId: args.threadId,
      taskType: args.taskType,
      goal: args.goal,
      files: args.files,
      status: "created",
      totalSteps: args.totalSteps,
      nextSeq: 0,
      createdAt: now,
      updatedAt: now,
    });
    return runId;
  },
});

export const updateRunStatus = mutation({
  args: {
    runId: v.id("financialOperatorRuns"),
    status: RUN_STATUS_VALIDATOR,
    finalSummary: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    artifacts: v.optional(
      v.array(
        v.object({
          kind: v.string(),
          label: v.string(),
          artifactRef: v.optional(v.string()),
          url: v.optional(v.string()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new Error(`Run not found: ${args.runId}`);
    }
    const updates: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };
    if (args.finalSummary !== undefined) updates.finalSummary = args.finalSummary;
    if (args.errorMessage !== undefined) updates.errorMessage = args.errorMessage;
    if (args.artifacts !== undefined) updates.artifacts = args.artifacts;
    await ctx.db.patch(args.runId, updates);
  },
});

/**
 * Append a typed step to a run. Bounded by MAX_STEPS_PER_RUN.
 * `seq` is assigned server-side from the run's `nextSeq` counter.
 */
export const appendStep = mutation({
  args: {
    runId: v.id("financialOperatorRuns"),
    kind: STEP_KIND_VALIDATOR,
    status: STEP_STATUS_VALIDATOR,
    title: v.string(),
    payload: v.optional(v.any()),
    durationMs: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new Error(`Run not found: ${args.runId}`);
    }
    const currentSeq = run.nextSeq ?? 0;
    if (currentSeq >= MAX_STEPS_PER_RUN) {
      // BOUND: refuse rather than degrade silently. HONEST_STATUS.
      throw new Error(
        `Run ${args.runId} exceeded ${MAX_STEPS_PER_RUN} steps (cap)`,
      );
    }
    const now = Date.now();
    const stepId = await ctx.db.insert("financialOperatorSteps", {
      runId: args.runId,
      seq: currentSeq,
      kind: args.kind,
      status: args.status,
      title: args.title,
      payload: args.payload,
      durationMs: args.durationMs,
      errorMessage: args.errorMessage,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.runId, {
      nextSeq: currentSeq + 1,
      updatedAt: now,
    });
    return { stepId, seq: currentSeq };
  },
});

/**
 * Patch an existing step's status (e.g. running → complete, or → approved).
 * Used to flip an approval_request step after the user clicks a button.
 */
export const updateStepStatus = mutation({
  args: {
    stepId: v.id("financialOperatorSteps"),
    status: STEP_STATUS_VALIDATOR,
    payloadPatch: v.optional(v.any()),
    durationMs: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.stepId);
    if (!step) {
      throw new Error(`Step not found: ${args.stepId}`);
    }
    const updates: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };
    if (args.durationMs !== undefined) updates.durationMs = args.durationMs;
    if (args.errorMessage !== undefined) {
      updates.errorMessage = args.errorMessage;
    }
    if (args.payloadPatch !== undefined) {
      // Shallow merge — caller is responsible for shape.
      const current = (step.payload as Record<string, unknown> | undefined) ?? {};
      updates.payload = { ...current, ...(args.payloadPatch as object) };
    }
    await ctx.db.patch(args.stepId, updates);
  },
});

/* ------------------------------------------------------------------ */
/* QUERIES                                                             */
/* ------------------------------------------------------------------ */

export const getRun = query({
  args: { runId: v.id("financialOperatorRuns") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.runId);
  },
});

export const listSteps = query({
  args: { runId: v.id("financialOperatorRuns") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("financialOperatorSteps")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});

export const listRecentRuns = query({
  args: {
    userId: v.optional(v.id("users")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cap = Math.min(args.limit ?? 20, 100); // BOUND
    if (args.userId) {
      return await ctx.db
        .query("financialOperatorRuns")
        .withIndex("by_user_createdAt", (q) =>
          q.eq("userId", args.userId as Id<"users">),
        )
        .order("desc")
        .take(cap);
    }
    return await ctx.db
      .query("financialOperatorRuns")
      .order("desc")
      .take(cap);
  },
});
