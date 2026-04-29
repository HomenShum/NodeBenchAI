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

function clampScratchpad(input: string | undefined): string | undefined {
  if (!input) return undefined;
  if (input.length <= MAX_SCRATCHPAD_BYTES) return input;
  return input.slice(0, MAX_SCRATCHPAD_BYTES - 3) + "…";
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
    idempotencyKey: v.string(),
  },
  returns: v.object({
    pipelineRunId: v.id("pipelineRuns"),
    runId: v.string(),
    created: v.boolean(),
    status: v.string(),
  }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .first();
    if (existing) {
      return {
        pipelineRunId: existing._id,
        runId: existing.runId,
        created: false,
        status: existing.status,
      };
    }
    const id = await ctx.db.insert("pipelineRuns", {
      pipelineKind: args.pipelineKind,
      status: "queued",
      verdict: "in_progress",
      title: args.title,
      spec: args.spec,
      modelId: args.modelId,
      ownerKey: args.ownerKey,
      createdAt: Date.now(),
      runId: args.runId,
      idempotencyKey: args.idempotencyKey,
    });
    return { pipelineRunId: id, runId: args.runId, created: true, status: "queued" };
  },
});

export const transitionRunStatus = internalMutation({
  args: {
    pipelineRunId: v.id("pipelineRuns"),
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
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.pipelineRunId, { outputDocumentId: args.documentId });
    return { ok: true };
  },
});
