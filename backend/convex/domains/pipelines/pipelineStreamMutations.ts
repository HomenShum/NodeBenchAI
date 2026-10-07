/**
 * Pipeline Stream Mutations
 *
 * Reactive partial-text streaming for pipeline steps. Mirrors the
 * `@convex-dev/persistent-text-streaming` chunk-append shape, but uses
 * a plain Convex table so any pipeline `internalAction` can stream
 * without an HTTP entry point.
 *
 * Pattern: append-then-replace. Each call concatenates a new delta
 * onto `partialText` and bumps `updatedAt`. Clients subscribed via
 * `getPipelineStream` see the text grow in real-time.
 *
 * Bounded: partialText is capped at MAX_STREAM_BYTES to prevent OOM
 * under long-running pipelines (BOUND invariant).
 */

import { v } from "convex/values";
import { internalMutation, query } from "../../_generated/server";
import {
  pipelineOwnerMatches,
  requirePipelineCallerOwnerKey,
} from "./pipelineOwnership";

const MAX_STREAM_BYTES = 64_000;

function streamFenceFailure(
  run: any,
  workflowExecutionKey: string,
  executionGeneration: number,
): string | undefined {
  if (!run) return "run_not_found";
  if (run.workflowExecutionKey !== workflowExecutionKey) {
    return "stale_workflow_execution";
  }
  if (run.executionGeneration !== executionGeneration) {
    return "stale_execution_generation";
  }
  if (run.status !== "running") return `run_is_${run.status}`;
  return undefined;
}

export const startPipelineStream = internalMutation({
  args: {
    pipelineRunId: v.id("pipelineRuns"),
    runId: v.string(),
    stepName: v.string(),
    workflowExecutionKey: v.string(),
    executionGeneration: v.number(),
  },
  returns: v.id("pipelineRunStreams"),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.pipelineRunId);
    const fenceFailure = streamFenceFailure(
      run,
      args.workflowExecutionKey,
      args.executionGeneration,
    );
    if (fenceFailure) throw new Error(fenceFailure);
    // Idempotent: if a row already exists for (runId, stepName), reset
    // it so a re-run starts fresh. Avoids cross-run text bleed.
    const existing = await ctx.db
      .query("pipelineRunStreams")
      .withIndex("by_runId_stepName", (q) =>
        q.eq("runId", args.runId).eq("stepName", args.stepName),
      )
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        partialText: "",
        status: "streaming",
        startedAt: now,
        updatedAt: now,
        errorMessage: undefined,
        workflowExecutionKey: args.workflowExecutionKey,
        executionGeneration: args.executionGeneration,
      });
      return existing._id;
    }
    return await ctx.db.insert("pipelineRunStreams", {
      runId: args.runId,
      pipelineRunId: args.pipelineRunId,
      workflowExecutionKey: args.workflowExecutionKey,
      executionGeneration: args.executionGeneration,
      stepName: args.stepName,
      partialText: "",
      status: "streaming",
      startedAt: now,
      updatedAt: now,
    });
  },
});

export const appendPipelineStreamChunk = internalMutation({
  args: {
    streamId: v.id("pipelineRunStreams"),
    delta: v.string(),
    workflowExecutionKey: v.string(),
    executionGeneration: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.streamId);
    if (!row) return { ok: false, reason: "not_found" };
    const run = await ctx.db.get(row.pipelineRunId);
    const fenceFailure = streamFenceFailure(
      run,
      args.workflowExecutionKey,
      args.executionGeneration,
    );
    if (fenceFailure) return { ok: false, reason: fenceFailure };
    if (
      row.workflowExecutionKey !== args.workflowExecutionKey ||
      row.executionGeneration !== args.executionGeneration
    ) {
      return { ok: false, reason: "stale_stream_generation" };
    }
    if (row.status !== "streaming") {
      // Refuse to append to a closed stream — HONEST_STATUS.
      return { ok: false, reason: `stream_is_${row.status}` };
    }
    const next = row.partialText + args.delta;
    const clamped =
      next.length > MAX_STREAM_BYTES
        ? next.slice(0, MAX_STREAM_BYTES - 3) + "..."
        : next;
    await ctx.db.patch(args.streamId, {
      partialText: clamped,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const finalizePipelineStream = internalMutation({
  args: {
    streamId: v.id("pipelineRunStreams"),
    status: v.union(v.literal("complete"), v.literal("error")),
    errorMessage: v.optional(v.string()),
    workflowExecutionKey: v.string(),
    executionGeneration: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.streamId);
    if (!row) return { ok: false, reason: "not_found" };
    const run = await ctx.db.get(row.pipelineRunId);
    const fenceFailure = streamFenceFailure(
      run,
      args.workflowExecutionKey,
      args.executionGeneration,
    );
    if (fenceFailure) return { ok: false, reason: fenceFailure };
    if (
      row.workflowExecutionKey !== args.workflowExecutionKey ||
      row.executionGeneration !== args.executionGeneration
    ) {
      return { ok: false, reason: "stale_stream_generation" };
    }
    await ctx.db.patch(args.streamId, {
      status: args.status,
      updatedAt: Date.now(),
      errorMessage: args.errorMessage,
    });
    return { ok: true };
  },
});

/* -------------------------------------------------------------------------- */
/*  Public: client subscribes via this query                                   */
/* -------------------------------------------------------------------------- */

export const getPipelineStream = query({
  args: {
    runId: v.string(),
    stepName: v.optional(v.string()),
    anonymousSessionId: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("pipelineRunStreams"),
      runId: v.string(),
      stepName: v.string(),
      partialText: v.string(),
      status: v.string(),
      startedAt: v.number(),
      updatedAt: v.number(),
      errorMessage: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const ownerKey = await requirePipelineCallerOwnerKey(
      ctx,
      args.anonymousSessionId,
    );
    const run = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();
    if (!pipelineOwnerMatches(run, ownerKey)) return null;

    let row;
    if (args.stepName) {
      row = await ctx.db
        .query("pipelineRunStreams")
        .withIndex("by_runId_stepName", (q) =>
          q.eq("runId", args.runId).eq("stepName", args.stepName!),
        )
        .first();
    } else {
      // Latest stream for this run (most recent updatedAt) — used by the
      // panel to show whichever step is currently streaming.
      const all = await ctx.db
        .query("pipelineRunStreams")
        .withIndex("by_runId_stepName", (q) => q.eq("runId", args.runId))
        .collect();
      all.sort((a, b) => b.updatedAt - a.updatedAt);
      row = all[0];
    }
    if (!row) return null;
    return {
      _id: row._id,
      runId: row.runId,
      stepName: row.stepName,
      partialText: row.partialText,
      status: row.status,
      startedAt: row.startedAt,
      updatedAt: row.updatedAt,
      errorMessage: row.errorMessage,
    };
  },
});
