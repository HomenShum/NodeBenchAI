import { v } from "convex/values";
import { internalMutation } from "../../../_generated/server";
import type { Doc } from "../../../_generated/dataModel";

const DEFAULT_CHUNK_VERSION = 1;

export const startArtifactIndexJob = internalMutation({
  args: {
    artifactId: v.id("sourceArtifacts"),
    contentHash: v.string(),
    chunkVersion: v.optional(v.number()),
  },
  returns: v.object({
    jobId: v.id("artifactIndexJobs"),
    alreadySucceeded: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const chunkVersion = args.chunkVersion ?? DEFAULT_CHUNK_VERSION;

    const existing = await ctx.db
      .query("artifactIndexJobs")
      .withIndex("by_artifact_hash_version", (q) =>
        q.eq("artifactId", args.artifactId).eq("contentHash", args.contentHash).eq("chunkVersion", chunkVersion)
      )
      .order("desc")
      .first() as Doc<"artifactIndexJobs"> | null;

    if (existing && existing.status === "succeeded") {
      return { jobId: existing._id, alreadySucceeded: true };
    }

    const now = Date.now();
    const jobId = await ctx.db.insert("artifactIndexJobs", {
      artifactId: args.artifactId,
      contentHash: args.contentHash,
      chunkVersion,
      status: "running",
      attempts: (existing?.attempts ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
    });

    return { jobId, alreadySucceeded: false };
  },
});

export const finishArtifactIndexJob = internalMutation({
  args: {
    jobId: v.id("artifactIndexJobs"),
    status: v.union(v.literal("succeeded"), v.literal("failed")),
    error: v.optional(v.string()),
    chunkCount: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: args.status,
      error: args.error,
      chunkCount: args.chunkCount,
      latencyMs: args.latencyMs,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const replaceArtifactChunks = internalMutation({
  args: {
    artifactId: v.id("sourceArtifacts"),
    runId: v.optional(v.id("agentRuns")),
    sourceUrl: v.optional(v.string()),
    fetchedAt: v.number(),
    contentHash: v.string(),
    chunkVersion: v.number(),
    chunks: v.array(
      v.object({
        chunkKey: v.string(),
        startOffset: v.optional(v.number()),
        endOffset: v.optional(v.number()),
        pageIndex: v.optional(v.number()),
        text: v.string(),
        chunkHash: v.string(),
      })
    ),
  },
  returns: v.object({ deleted: v.number(), inserted: v.number() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("artifactChunks")
      .withIndex("by_artifact_version_offset", (q) =>
        q.eq("artifactId", args.artifactId).eq("chunkVersion", args.chunkVersion)
      )
      .collect();

    for (const row of existing) {
      await ctx.db.delete(row._id);
    }

    const now = Date.now();
    let inserted = 0;
    for (const chunk of args.chunks) {
      await ctx.db.insert("artifactChunks", {
        artifactId: args.artifactId,
        runId: args.runId,
        sourceUrl: args.sourceUrl,
        fetchedAt: args.fetchedAt,
        contentHash: args.contentHash,
        chunkVersion: args.chunkVersion,
        chunkKey: chunk.chunkKey,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        pageIndex: chunk.pageIndex,
        text: chunk.text,
        chunkHash: chunk.chunkHash,
        createdAt: now,
      });
      inserted++;
    }

    return { deleted: existing.length, inserted };
  },
});
