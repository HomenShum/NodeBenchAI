import { v } from "convex/values";
import { internalQuery } from "../../../_generated/server";
import type { Doc } from "../../../_generated/dataModel";

export const searchEvidenceChunks = internalQuery({
  args: {
    query: v.string(),
    runId: v.optional(v.id("agentRuns")),
    artifactId: v.optional(v.id("sourceArtifacts")),
    artifactIds: v.optional(v.array(v.id("sourceArtifacts"))),
    chunkVersion: v.optional(v.number()),
    maxResults: v.optional(v.number()),
    maxQuoteChars: v.optional(v.number()),
  },
  returns: v.array(
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
  handler: async (ctx, args) => {
    const chunkVersion = args.chunkVersion ?? 1;
    const maxResults = Math.max(1, Math.min(args.maxResults ?? 8, 20));
    const maxQuoteChars = Math.max(50, Math.min(args.maxQuoteChars ?? 600, 2000));

    const runSearch = async (filter: { runId?: any; artifactId?: any }) => {
      const docs = await ctx.db
        .query("artifactChunks")
        .withSearchIndex("search_text", (q) => {
          let search = q.search("text", args.query);
          if (filter.runId) search = search.eq("runId", filter.runId);
          if (filter.artifactId) search = search.eq("artifactId", filter.artifactId);
          search = search.eq("chunkVersion", chunkVersion);
          return search;
        })
        .take(maxResults);

      return docs as Doc<"artifactChunks">[];
    };

    let hits: Doc<"artifactChunks">[] = [];

    if (args.artifactId) {
      hits = await runSearch({ artifactId: args.artifactId });
    } else if (args.artifactIds && args.artifactIds.length > 0) {
      const perArtifact = Math.max(1, Math.ceil(maxResults / Math.min(args.artifactIds.length, 5)));
      const limited = args.artifactIds.slice(0, 5);
      const all: Doc<"artifactChunks">[] = [];
      for (const artifactId of limited) {
        const partial = await ctx.db
          .query("artifactChunks")
          .withSearchIndex("search_text", (q) => q.search("text", args.query).eq("artifactId", artifactId).eq("chunkVersion", chunkVersion))
          .take(perArtifact);
        all.push(...(partial as Doc<"artifactChunks">[]));
      }
      hits = all.slice(0, maxResults);
    } else if (args.runId) {
      hits = await runSearch({ runId: args.runId });
    } else {
      hits = await ctx.db
        .query("artifactChunks")
        .withSearchIndex("search_text", (q) => q.search("text", args.query).eq("chunkVersion", chunkVersion))
        .take(maxResults);
    }

    return hits.slice(0, maxResults).map((row) => ({
      chunkId: row._id,
      artifactId: row.artifactId,
      quote: (row.text ?? "").slice(0, maxQuoteChars),
      startOffset: row.startOffset,
      endOffset: row.endOffset,
      pageIndex: row.pageIndex,
      sourceUrl: row.sourceUrl,
      fetchedAt: row.fetchedAt,
      contentHash: row.contentHash,
    }));
  },
});

export const getEvidenceChunkById = internalQuery({
  args: { chunkId: v.id("artifactChunks") },
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
    const chunk = await ctx.db.get(args.chunkId) as Doc<"artifactChunks"> | null;
    if (!chunk) return null;
    return {
      chunkId: chunk._id,
      artifactId: chunk.artifactId,
      sourceUrl: chunk.sourceUrl,
      fetchedAt: chunk.fetchedAt,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      pageIndex: chunk.pageIndex,
      text: chunk.text,
      chunkKey: chunk.chunkKey,
      contentHash: chunk.contentHash,
    };
  },
});

export const countChunksForArtifact = internalQuery({
  args: { artifactId: v.id("sourceArtifacts"), chunkVersion: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const chunkVersion = args.chunkVersion ?? 1;
    const chunks = await ctx.db
      .query("artifactChunks")
      .withIndex("by_artifact_version_offset", (q) => q.eq("artifactId", args.artifactId).eq("chunkVersion", chunkVersion))
      .take(1);
    return chunks.length;
  },
});

export const listChunkIdsForArtifact = internalQuery({
  args: {
    artifactId: v.id("sourceArtifacts"),
    chunkVersion: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.id("artifactChunks")),
  handler: async (ctx, args) => {
    const chunkVersion = args.chunkVersion ?? 1;
    const limit = Math.max(1, Math.min(args.limit ?? 12, 100));
    const chunks = await ctx.db
      .query("artifactChunks")
      .withIndex("by_artifact_version_offset", (q) =>
        q.eq("artifactId", args.artifactId).eq("chunkVersion", chunkVersion),
      )
      .take(limit);
    return chunks.map((chunk) => chunk._id);
  },
});

