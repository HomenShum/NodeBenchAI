/**
 * Pipeline Runs Queries
 *
 * Public read API for the Reports surface PipelineRunsView. All cost
 * fields are HONEST_SCORES — derived from real measured tokens, not
 * hardcoded.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";

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
    ownerKey: v.optional(v.string()),
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
      ownerKey: v.optional(v.string()),
      createdAt: v.number(),
      durationMs: v.optional(v.number()),
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
      estimatedUsd: v.optional(v.number()),
      stepCount: v.number(),
      errorMessage: v.optional(v.string()),
      outputDocumentId: v.optional(v.id("documents")),
      bundleUrl: v.optional(v.union(v.null(), v.string())),
      imageUrl: v.optional(v.union(v.null(), v.string())),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 25, 100);

    let q;
    if (args.ownerKey) {
      q = ctx.db
        .query("pipelineRuns")
        .withIndex("by_owner_createdAt", (q) => q.eq("ownerKey", args.ownerKey))
        .order("desc");
    } else if (args.pipelineKind) {
      q = ctx.db
        .query("pipelineRuns")
        .withIndex("by_kind_createdAt", (q) => q.eq("pipelineKind", args.pipelineKind!))
        .order("desc");
    } else {
      q = ctx.db.query("pipelineRuns").order("desc");
    }

    const rows = await q.take(limit);

    // Step counts via by_run index (cheap — bounded by step count per run).
    const out: Array<any> = [];
    for (const r of rows) {
      const steps = await ctx.db
        .query("pipelineSteps")
        .withIndex("by_run", (q) => q.eq("pipelineRunId", r._id))
        .collect();

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
        ownerKey: r.ownerKey,
        createdAt: r.createdAt,
        durationMs: r.durationMs,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        estimatedUsd: r.estimatedUsd,
        stepCount: steps.length,
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
  args: { runId: v.string() },
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
        ownerKey: v.optional(v.string()),
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
    const run = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();
    if (!run) return null;

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
        ownerKey: run.ownerKey,
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
  args: { runId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      bundleUrl: v.union(v.null(), v.string()),
      imageUrl: v.union(v.null(), v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();
    if (!run) return null;
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
  args: {},
  returns: v.object({
    totalRuns: v.number(),
    succeeded: v.number(),
    failed: v.number(),
    inProgress: v.number(),
    totalEstimatedUsd: v.number(),
    avgDurationMs: v.optional(v.number()),
  }),
  handler: async (ctx) => {
    const recent = await ctx.db.query("pipelineRuns").order("desc").take(200);
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
