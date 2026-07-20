/**
 * Pipeline Runs Mutations
 *
 * Lifecycle CRUD for `pipelineRuns` + `pipelineSteps`. Idempotent:
 * `createOrGetRun` keys by sha256(kind + spec + ownerKey). Re-submits
 * with the same key return the existing run. Status transitions are
 * monotonic (queued → running → succeeded/failed/cancelled).
 *
 * Pattern: HONEST_STATUS — no terminal status returned on partial
 * failure. `recordRunFailure` always sets status="failed" + populates
 * `errorMessage`. Verdict tier follows agent_run_verdict_workflow.md.
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

const MAX_SCRATCHPAD_BYTES = 32_000;
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

function clampScratchpad(input: string | undefined): string | undefined {
  if (!input) return undefined;
  if (input.length <= MAX_SCRATCHPAD_BYTES) return input;
  return input.slice(0, MAX_SCRATCHPAD_BYTES - 3) + "…";
}

function executionFenceFailure(
  run: any,
  workflowExecutionKey: string,
  executionGeneration: number,
): string | undefined {
  if (
    typeof run.workflowExecutionKey === "string" &&
    run.workflowExecutionKey !== workflowExecutionKey
  ) {
    return "stale_workflow_execution";
  }
  if (
    typeof run.executionGeneration === "number" &&
    run.executionGeneration !== executionGeneration
  ) {
    return "stale_execution_generation";
  }
  return undefined;
}

async function clearPriorAttemptArtifacts(ctx: any, run: any): Promise<void> {
  const [steps, streams] = await Promise.all([
    ctx.db
      .query("pipelineSteps")
      .withIndex("by_run", (q: any) => q.eq("pipelineRunId", run._id))
      .collect(),
    ctx.db
      .query("pipelineRunStreams")
      .withIndex("by_pipelineRunId", (q: any) =>
        q.eq("pipelineRunId", run._id),
      )
      .collect(),
  ]);
  for (const step of steps) await ctx.db.delete(step._id);
  for (const stream of streams) await ctx.db.delete(stream._id);

  // Only delete a document created by this exact pipeline run. An unrelated
  // user document must never be removed merely because an id was linked.
  if (run.outputDocumentId) {
    const document = await ctx.db.get(run.outputDocumentId);
    if (document?.summary === `pipeline_run:${run.runId}`) {
      await ctx.db.delete(run.outputDocumentId);
    }
  }
}

export const createOrGetRun = internalMutation({
  args: {
    pipelineKind: v.union(
      v.literal("code_gen"),
      v.literal("design_gen"),
      v.literal("research"),
      v.literal("custom"),
    ),
    title: v.string(),
    spec: v.string(),
    modelId: v.string(),
    ownerKey: v.optional(v.string()),
    runId: v.string(),
    attemptKey: v.optional(v.string()),
    workflowExecutionKey: v.string(),
    idempotencyKey: v.string(),
  },
  returns: v.object({
    pipelineRunId: v.id("pipelineRuns"),
    runId: v.string(),
    created: v.boolean(),
    acquired: v.boolean(),
    restarted: v.boolean(),
    executionGeneration: v.number(),
    status: v.string(),
  }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .first();
    if (existing) {
      const generation = existing.executionGeneration ?? 1;
      const sameWorkflow =
        existing.workflowExecutionKey === args.workflowExecutionKey;
      const isTerminal = TERMINAL_STATUSES.has(existing.status);
      const canRestart =
        sameWorkflow && (isTerminal || existing.status === "queued");
      if (canRestart) {
        await clearPriorAttemptArtifacts(ctx, existing);
        const nextGeneration = isTerminal ? generation + 1 : generation;
        await ctx.db.patch(existing._id, {
          pipelineKind: args.pipelineKind,
          status: "running",
          verdict: "in_progress",
          title: args.title,
          spec: args.spec,
          modelId: args.modelId,
          ownerKey: args.ownerKey,
          startedAt: Date.now(),
          completedAt: undefined,
          durationMs: undefined,
          inputTokens: undefined,
          outputTokens: undefined,
          estimatedUsd: undefined,
          outputDocumentId: undefined,
          outputArchiveRowId: undefined,
          outputZipStorageId: undefined,
          errorMessage: undefined,
          runId: existing.runId,
          attemptKey: args.attemptKey,
          workflowExecutionKey: args.workflowExecutionKey,
          executionGeneration: nextGeneration,
          idempotencyKey: args.idempotencyKey,
        });
        return {
          pipelineRunId: existing._id,
          runId: existing.runId,
          created: false,
          acquired: true,
          restarted: isTerminal,
          executionGeneration: nextGeneration,
          status: "running",
        };
      }
      return {
        pipelineRunId: existing._id,
        runId: existing.runId,
        created: false,
        acquired: false,
        restarted: false,
        executionGeneration: generation,
        status: existing.status,
      };
    }
    const id = await ctx.db.insert("pipelineRuns", {
      pipelineKind: args.pipelineKind,
      status: "running",
      verdict: "in_progress",
      title: args.title,
      spec: args.spec,
      modelId: args.modelId,
      ownerKey: args.ownerKey,
      createdAt: Date.now(),
      startedAt: Date.now(),
      runId: args.runId,
      attemptKey: args.attemptKey,
      workflowExecutionKey: args.workflowExecutionKey,
      executionGeneration: 1,
      idempotencyKey: args.idempotencyKey,
    });
    return {
      pipelineRunId: id,
      runId: args.runId,
      created: true,
      acquired: true,
      restarted: false,
      executionGeneration: 1,
      status: "running",
    };
  },
});

export const transitionRunStatus = internalMutation({
  args: {
    pipelineRunId: v.id("pipelineRuns"),
    workflowExecutionKey: v.string(),
    executionGeneration: v.number(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    verdict: v.optional(
      v.union(
        v.literal("verified"),
        v.literal("provisionally_verified"),
        v.literal("needs_review"),
        v.literal("awaiting_approval"),
        v.literal("failed"),
        v.literal("in_progress"),
      ),
    ),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    estimatedUsd: v.optional(v.number()),
    outputDocumentId: v.optional(v.id("documents")),
    outputArchiveRowId: v.optional(v.id("linkedinPostArchive")),
    outputZipStorageId: v.optional(v.id("_storage")),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.pipelineRunId);
    if (!run) return { ok: false, reason: "run_not_found" };
    const fenceFailure = executionFenceFailure(
      run,
      args.workflowExecutionKey,
      args.executionGeneration,
    );
    if (fenceFailure) return { ok: false, reason: fenceFailure };
    if (TERMINAL_STATUSES.has(run.status)) {
      return args.status === run.status
        ? { ok: true, reason: "already_terminal" }
        : { ok: false, reason: `run_already_${run.status}` };
    }

    const now = Date.now();
    const patch: Record<string, unknown> = { status: args.status };
    if (args.verdict !== undefined) patch.verdict = args.verdict;
    if (args.inputTokens !== undefined) patch.inputTokens = args.inputTokens;
    if (args.outputTokens !== undefined) patch.outputTokens = args.outputTokens;
    if (args.estimatedUsd !== undefined) patch.estimatedUsd = args.estimatedUsd;
    if (args.outputDocumentId !== undefined) patch.outputDocumentId = args.outputDocumentId;
    if (args.outputArchiveRowId !== undefined) patch.outputArchiveRowId = args.outputArchiveRowId;
    if (args.outputZipStorageId !== undefined) patch.outputZipStorageId = args.outputZipStorageId;
    if (args.errorMessage !== undefined) patch.errorMessage = args.errorMessage;
    if (args.status === "succeeded") patch.errorMessage = undefined;

    if (args.status === "running" && !run.startedAt) {
      patch.startedAt = now;
    }
    if (
      (args.status === "succeeded" || args.status === "failed" || args.status === "cancelled") &&
      !run.completedAt
    ) {
      patch.completedAt = now;
      patch.durationMs = run.startedAt ? now - run.startedAt : undefined;
    }

    await ctx.db.patch(args.pipelineRunId, patch);
    return { ok: true };
  },
});

export const appendStep = internalMutation({
  args: {
    pipelineRunId: v.id("pipelineRuns"),
    workflowExecutionKey: v.string(),
    executionGeneration: v.number(),
    runId: v.string(),
    name: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("ok"),
      v.literal("error"),
      v.literal("skipped"),
    ),
    durationMs: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    estimatedUsd: v.optional(v.number()),
    modelId: v.optional(v.string()),
    scratchpad: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.pipelineRunId);
    if (!run) return { ok: false, reason: "run_not_found" };
    const fenceFailure = executionFenceFailure(
      run,
      args.workflowExecutionKey,
      args.executionGeneration,
    );
    if (fenceFailure) return { ok: false, reason: fenceFailure };
    if (run.status !== "running") {
      return { ok: false, reason: `run_is_${run.status}` };
    }
    // Determine next seq cheaply via the by_run index (already ordered).
    const last = await ctx.db
      .query("pipelineSteps")
      .withIndex("by_run", (q) => q.eq("pipelineRunId", args.pipelineRunId))
      .order("desc")
      .first();
    const seq = last ? last.seq + 1 : 0;
    const startedAt = Date.now() - (args.durationMs ?? 0);
    const id = await ctx.db.insert("pipelineSteps", {
      runId: args.runId,
      pipelineRunId: args.pipelineRunId,
      seq,
      name: args.name,
      status: args.status,
      startedAt,
      completedAt: Date.now(),
      durationMs: args.durationMs,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      estimatedUsd: args.estimatedUsd,
      modelId: args.modelId,
      scratchpad: clampScratchpad(args.scratchpad),
      errorMessage: args.errorMessage,
    });
    return { stepId: id, seq };
  },
});

export const linkRunToDocument = internalMutation({
  args: {
    pipelineRunId: v.id("pipelineRuns"),
    documentId: v.id("documents"),
    workflowExecutionKey: v.string(),
    executionGeneration: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.pipelineRunId);
    if (!run) return { ok: false, reason: "run_not_found" };
    const fenceFailure = executionFenceFailure(
      run,
      args.workflowExecutionKey,
      args.executionGeneration,
    );
    if (fenceFailure) return { ok: false, reason: fenceFailure };
    await ctx.db.patch(args.pipelineRunId, { outputDocumentId: args.documentId });
    return { ok: true };
  },
});
