/**
 * Evidence Tools
 *
 * Provides bounded, citation-friendly retrieval over stored sourceArtifacts.
 * These tools intentionally return small evidence bundles (chunk IDs + quotes),
 * not full raw blobs.
 */

"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";

export const indexArtifact = action({
  args: {
    artifactId: v.id("sourceArtifacts"),
    chunkVersion: v.optional(v.number()),
  },
  returns: v.object({
    ok: v.boolean(),
    artifactId: v.id("sourceArtifacts"),
    chunkCount: v.optional(v.number()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const res = await ctx.runAction(internal.domains.artifacts.evidenceIndexActions.indexArtifact, {
      artifactId: args.artifactId,
      chunkVersion: args.chunkVersion,
    });
    return {
      ok: res.ok,
      artifactId: res.artifactId,
      chunkCount: res.chunkCount,
      error: res.error,
    };
  },
});

export const searchEvidence = action({
  args: {
    query: v.string(),
    runId: v.optional(v.id("agentRuns")),
    artifactId: v.optional(v.id("sourceArtifacts")),
    artifactIds: v.optional(v.array(v.id("sourceArtifacts"))),
    ensureIndexed: v.optional(v.boolean()),
    maxResults: v.optional(v.number()),
    maxQuoteChars: v.optional(v.number()),
  },
  returns: v.object({
    evidencePackId: v.optional(v.id("evidencePacks")),
    results: v.array(
      v.object({
        chunkId: v.id("artifactChunks"),
        artifactId: v.id("sourceArtifacts"),
        quote: v.string(),
        startOffset: v.optional(v.number()),
        endOffset: v.optional(v.number()),
        pageIndex: v.optional(v.number()),
        sourceUrl: v.optional(v.string()),
        fetchedAt: v.number(),
        contentHash: v.string(),
      })
    ),
  }),
  handler: async (ctx, args) => {
    const ensureIndexed = args.ensureIndexed ?? true;

    const artifactIdsToEnsure: any[] = [];
    if (args.artifactId) artifactIdsToEnsure.push(args.artifactId);
    if (args.artifactIds) artifactIdsToEnsure.push(...args.artifactIds);

    if (ensureIndexed) {
      for (const artifactId of artifactIdsToEnsure.slice(0, 5)) {
        const hasAny = await ctx.runQuery(internal.domains.artifacts.evidenceSearch.countChunksForArtifact, {
          artifactId,
        });
        if (hasAny === 0) {
          await ctx.runAction(internal.domains.artifacts.evidenceIndexActions.indexArtifact, { artifactId });
        }
      }
    }

    const results = await ctx.runQuery(internal.domains.artifacts.evidenceSearch.searchEvidenceChunks, {
      query: args.query,
      runId: args.runId,
      artifactId: args.artifactId,
      artifactIds: args.artifactIds,
      maxResults: args.maxResults,
      maxQuoteChars: args.maxQuoteChars,
    });

    let evidencePackId: any = undefined;
    if (args.runId) {
      evidencePackId = await ctx.runMutation(internal.domains.artifacts.evidencePacks.createEvidencePack, {
        runId: args.runId,
        query: args.query,
        scope: {
          artifactId: args.artifactId,
          artifactIds: args.artifactIds,
        },
        chunkIds: results.map((r) => r.chunkId),
      });
    }

    return { evidencePackId, results };
  },
});

export const getEvidenceChunk = action({
  args: {
    chunkId: v.id("artifactChunks"),
    maxChars: v.optional(v.number()),
  },
  returns: v.union(
    v.null(),
    v.object({
      chunkId: v.id("artifactChunks"),
      artifactId: v.id("sourceArtifacts"),
      sourceUrl: v.optional(v.string()),
      fetchedAt: v.number(),
      startOffset: v.optional(v.number()),
      endOffset: v.optional(v.number()),
      pageIndex: v.optional(v.number()),
      text: v.string(),
      chunkKey: v.string(),
      contentHash: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const chunk = await ctx.runQuery(internal.domains.artifacts.evidenceSearch.getEvidenceChunkById, {
      chunkId: args.chunkId,
    });
    if (!chunk) return null;

    const maxChars = Math.max(100, Math.min(args.maxChars ?? 8000, 40000));
    return { ...chunk, text: chunk.text.slice(0, maxChars) };
  },
});
