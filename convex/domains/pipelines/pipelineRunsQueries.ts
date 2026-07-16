/**
 * Pipeline Runs Queries
 *
 * Public read API for the Reports surface PipelineRunsView. All cost
 * fields are HONEST_SCORES — derived from real measured tokens, not
 * hardcoded.
 */

import { v } from "convex/values";
import { internalQuery, query } from "../../_generated/server";
import {
  pipelineOwnerMatches,
  requirePipelineCallerOwnerKey,
} from "./pipelineOwnership";

export const listRecentRuns = query({
  args: {
    limit: v.optional(v.number()),
    pipelineKind: v.optional(
      v.union(
        v.literal("code_gen"),
        v.literal("design_gen"),
        v.literal("research"),
        v.literal("custom"),
      ),
    ),
    anonymousSessionId: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      _id: v.id("pipelineRuns"),
      runId: v.string(),
      pipelineKind: v.string(),
      status: v.string(),
      verdict: v.optional(v.string()),
      title: v.string(),
      modelId: v.string(),
      createdAt: v.number(),
      durationMs: v.optional(v.number()),
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
      estimatedUsd: v.optional(v.number()),
      stepCount: v.number(),
      hasStream: v.boolean(),
      errorMessage: v.optional(v.string()),
      outputDocumentId: v.optional(v.id("documents")),
      bundleUrl: v.optional(v.union(v.null(), v.string())),
      imageUrl: v.optional(v.union(v.null(), v.string())),
    }),
  ),
  handler: async (ctx, args) => {
    const ownerKey = await requirePipelineCallerOwnerKey(
      ctx,
      args.anonymousSessionId,
    );
    const limit = Math.min(args.limit ?? 25, 100);
    const candidateLimit = args.pipelineKind ? Math.min(limit * 4, 400) : limit;
    const candidates = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_owner_createdAt", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .take(candidateLimit);
    const rows = args.pipelineKind
      ? candidates.filter((row) => row.pipelineKind === args.pipelineKind).slice(0, limit)
      : candidates;

    // Step counts via by_run index (cheap — bounded by step count per run).
    const out: Array<any> = [];
    for (const r of rows) {
      const steps = await ctx.db
        .query("pipelineSteps")
        .withIndex("by_run", (q) => q.eq("pipelineRunId", r._id))
        .collect();
      const stream = await ctx.db
        .query("pipelineRunStreams")
        .withIndex("by_runId_stepName", (q) => q.eq("runId", r.runId))
        .first();

      // Bundle + image URLs (resolved via Convex storage). Both are
      // optional — null when the run has no persisted bundle/image yet.
      let bundleUrl: string | null = null;
      let imageUrl: string | null = null;
      if (r.outputZipStorageId) {
        try {
          bundleUrl = await ctx.storage.getUrl(r.outputZipStorageId);
        } catch {
          bundleUrl = null;
        }
      }
      const imageStep = steps.find((s) => s.name === "design.image");
      if (imageStep?.scratchpad) {
        const m = imageStep.scratchpad.match(/image_storage_id=([a-z0-9]+)/i);
        if (m) {
          try {
            imageUrl = await ctx.storage.getUrl(m[1] as any);
          } catch {
            imageUrl = null;
          }
        }
      }

      out.push({
        _id: r._id,
        runId: r.runId,
        pipelineKind: r.pipelineKind,
        status: r.status,
        verdict: r.verdict,
        title: r.title,
        modelId: r.modelId,
        createdAt: r.createdAt,
        durationMs: r.durationMs,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        estimatedUsd: r.estimatedUsd,
        stepCount: steps.length,
        hasStream: Boolean(stream),
        errorMessage: r.errorMessage,
        outputDocumentId: r.outputDocumentId,
        bundleUrl,
        imageUrl,
      });
    }
    return out;
  },
});

export const getRunDetail = query({
  args: {
    runId: v.string(),
    anonymousSessionId: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      run: v.object({
        _id: v.id("pipelineRuns"),
        runId: v.string(),
        pipelineKind: v.string(),
        status: v.string(),
        verdict: v.optional(v.string()),
        title: v.string(),
        spec: v.string(),
        modelId: v.string(),
        createdAt: v.number(),
        startedAt: v.optional(v.number()),
        completedAt: v.optional(v.number()),
        durationMs: v.optional(v.number()),
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
        estimatedUsd: v.optional(v.number()),
        errorMessage: v.optional(v.string()),
        outputDocumentId: v.optional(v.id("documents")),
        outputArchiveRowId: v.optional(v.id("linkedinPostArchive")),
        outputZipStorageId: v.optional(v.id("_storage")),
      }),
      steps: v.array(
        v.object({
          _id: v.id("pipelineSteps"),
          seq: v.number(),
          name: v.string(),
          status: v.string(),
          startedAt: v.number(),
          completedAt: v.optional(v.number()),
          durationMs: v.optional(v.number()),
          inputTokens: v.optional(v.number()),
          outputTokens: v.optional(v.number()),
          estimatedUsd: v.optional(v.number()),
          modelId: v.optional(v.string()),
          scratchpad: v.optional(v.string()),
          errorMessage: v.optional(v.string()),
        }),
      ),
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

    const stepDocs = await ctx.db
      .query("pipelineSteps")
      .withIndex("by_run", (q) => q.eq("pipelineRunId", run._id))
      .collect();
    stepDocs.sort((a, b) => a.seq - b.seq);

    return {
      run: {
        _id: run._id,
        runId: run.runId,
        pipelineKind: run.pipelineKind,
        status: run.status,
        verdict: run.verdict,
        title: run.title,
        spec: run.spec,
        modelId: run.modelId,
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        durationMs: run.durationMs,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        estimatedUsd: run.estimatedUsd,
        errorMessage: run.errorMessage,
        outputDocumentId: run.outputDocumentId,
        outputArchiveRowId: run.outputArchiveRowId,
        outputZipStorageId: run.outputZipStorageId,
      },
      steps: stepDocs.map((s) => ({
        _id: s._id,
        seq: s.seq,
        name: s.name,
        status: s.status,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        durationMs: s.durationMs,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        estimatedUsd: s.estimatedUsd,
        modelId: s.modelId,
        scratchpad: s.scratchpad,
        errorMessage: s.errorMessage,
      })),
    };
  },
});

/**
 * Get a download URL for a pipelineRuns row's persisted bundle. Returns
 * null if the run has no `outputZipStorageId` or the storage ref is
 * stale. The frontend uses this to render a "Download bundle" link.
 */
export const getRunBundleDownloadUrl = query({
  args: {
    runId: v.string(),
    anonymousSessionId: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      bundleUrl: v.union(v.null(), v.string()),
      imageUrl: v.union(v.null(), v.string()),
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
    const bundleUrl = run.outputZipStorageId
      ? await ctx.storage.getUrl(run.outputZipStorageId)
      : null;
    // Design pipeline writes the image as the most recent step's
    // scratchpad ref (`image_storage_id=...`); cheaper to just look at
    // the steps table.
    let imageUrl: string | null = null;
    const steps = await ctx.db
      .query("pipelineSteps")
      .withIndex("by_run", (q) => q.eq("pipelineRunId", run._id))
      .collect();
    for (const step of steps) {
      if (step.name !== "design.image") continue;
      const m = step.scratchpad?.match(/image_storage_id=([a-z0-9]+)/i);
      if (m) {
        try {
          imageUrl = await ctx.storage.getUrl(m[1] as any);
        } catch {
          imageUrl = null;
        }
      }
    }
    return { bundleUrl, imageUrl };
  },
});

export const getRunSummaryStats = query({
  args: { anonymousSessionId: v.optional(v.string()) },
  returns: v.object({
    totalRuns: v.number(),
    succeeded: v.number(),
    failed: v.number(),
    inProgress: v.number(),
    totalEstimatedUsd: v.number(),
    avgDurationMs: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const ownerKey = await requirePipelineCallerOwnerKey(
      ctx,
      args.anonymousSessionId,
    );
    const recent = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_owner_createdAt", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .take(200);
    const succeeded = recent.filter((r) => r.status === "succeeded").length;
    const failed = recent.filter((r) => r.status === "failed").length;
    const inProgress = recent.filter(
      (r) => r.status === "running" || r.status === "queued",
    ).length;
    const totalEstimatedUsd = recent.reduce(
      (s, r) => s + (typeof r.estimatedUsd === "number" ? r.estimatedUsd : 0),
      0,
    );
    const completed = recent.filter((r) => typeof r.durationMs === "number");
    const avgDurationMs = completed.length
      ? completed.reduce((s, r) => s + (r.durationMs ?? 0), 0) / completed.length
      : undefined;
    return {
      totalRuns: recent.length,
      succeeded,
      failed,
      inProgress,
      totalEstimatedUsd,
      avgDurationMs,
    };
  },
});

/**
 * Secret-gated service bridges use explicit internal reads. They must supply
 * the server-derived service owner key and cannot reopen the public ownerKey
 * surface.
 */
export const listRecentRunsInternal = internalQuery({
  args: {
    ownerKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 25, 100);
    const rows = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_owner_createdAt", (q) => q.eq("ownerKey", args.ownerKey))
      .order("desc")
      .take(limit);

    const output: Array<any> = [];
    for (const run of rows) {
      const steps = await ctx.db
        .query("pipelineSteps")
        .withIndex("by_run", (q) => q.eq("pipelineRunId", run._id))
        .collect();
      let bundleUrl: string | null = null;
      let imageUrl: string | null = null;
      if (run.outputZipStorageId) {
        try {
          bundleUrl = await ctx.storage.getUrl(run.outputZipStorageId);
        } catch {
          bundleUrl = null;
        }
      }
      const imageStep = steps.find((step) => step.name === "design.image");
      const imageStorageId = imageStep?.scratchpad?.match(
        /image_storage_id=([a-z0-9]+)/i,
      )?.[1];
      if (imageStorageId) {
        try {
          imageUrl = await ctx.storage.getUrl(imageStorageId as any);
        } catch {
          imageUrl = null;
        }
      }
      output.push({
        _id: run._id,
        runId: run.runId,
        pipelineKind: run.pipelineKind,
        status: run.status,
        verdict: run.verdict,
        title: run.title,
        modelId: run.modelId,
        createdAt: run.createdAt,
        durationMs: run.durationMs,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        estimatedUsd: run.estimatedUsd,
        stepCount: steps.length,
        errorMessage: run.errorMessage,
        outputDocumentId: run.outputDocumentId,
        bundleUrl,
        imageUrl,
      });
    }
    return output;
  },
});

export const getRunDetailInternal = internalQuery({
  args: { runId: v.string(), ownerKey: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();
    if (!pipelineOwnerMatches(run, args.ownerKey)) return null;

    const stepDocs = await ctx.db
      .query("pipelineSteps")
      .withIndex("by_run", (q) => q.eq("pipelineRunId", run._id))
      .collect();
    stepDocs.sort((a, b) => a.seq - b.seq);
    return {
      run: {
        _id: run._id,
        runId: run.runId,
        pipelineKind: run.pipelineKind,
        status: run.status,
        verdict: run.verdict,
        title: run.title,
        spec: run.spec,
        modelId: run.modelId,
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        durationMs: run.durationMs,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        estimatedUsd: run.estimatedUsd,
        errorMessage: run.errorMessage,
        outputDocumentId: run.outputDocumentId,
        outputArchiveRowId: run.outputArchiveRowId,
        outputZipStorageId: run.outputZipStorageId,
      },
      steps: stepDocs.map((step) => ({
        _id: step._id,
        seq: step.seq,
        name: step.name,
        status: step.status,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        durationMs: step.durationMs,
        inputTokens: step.inputTokens,
        outputTokens: step.outputTokens,
        estimatedUsd: step.estimatedUsd,
        modelId: step.modelId,
        scratchpad: step.scratchpad,
        errorMessage: step.errorMessage,
      })),
    };
  },
});
