import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../../_generated/server";
import type { Doc } from "../../../_generated/dataModel";
import { recomputeSourceSearchableText } from "../../search/searchableTextRecompute";

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

export const findByUrlAndHash = internalQuery({
  args: {
    sourceUrl: v.optional(v.string()),
    contentHash: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("sourceArtifacts"),
      contentHash: v.string(),
      sourceUrl: v.optional(v.string()),
      fetchedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const url = normalizeUrl(args.sourceUrl);
    const existing = await ctx.db
      .query("sourceArtifacts")
      .withIndex("by_sourceUrl_hash", (q) => q.eq("sourceUrl", url).eq("contentHash", args.contentHash))
      .order("desc")
      .first() as Doc<"sourceArtifacts"> | null;
    if (!existing) return null;
    return { _id: existing._id, contentHash: existing.contentHash, sourceUrl: existing.sourceUrl, fetchedAt: existing.fetchedAt };
  },
});

export const upsertSourceArtifact = internalMutation({
  args: {
    runId: v.optional(v.id("agentRuns")),
    sourceType: v.union(
      v.literal("url_fetch"),
      v.literal("api_response"),
      v.literal("file_upload"),
      v.literal("extracted_text"),
      v.literal("video_transcript")
    ),
    sourceUrl: v.optional(v.string()),
    rawContent: v.optional(v.string()),
    rawStorageId: v.optional(v.id("_storage")),
    mimeType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    title: v.optional(v.string()),
    extractedData: v.optional(v.any()),
    fetchedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    contentHash: v.optional(v.string()),
  },
  returns: v.object({
    id: v.id("sourceArtifacts"),
    created: v.boolean(),
    contentHash: v.string(),
  }),
  handler: async (ctx, args) => {
    const fetchedAt = args.fetchedAt ?? Date.now();
    const sourceUrl = normalizeUrl(args.sourceUrl);
    const computedHash =
      args.contentHash ??
      (await sha256Hex(
        JSON.stringify({
          sourceType: args.sourceType,
          sourceUrl,
          rawContent: args.rawContent ?? "",
          extractedData: args.extractedData ?? null,
        })
      ));

    if (sourceUrl) {
      const existing = await ctx.db
        .query("sourceArtifacts")
        .withIndex("by_sourceUrl_hash", (q) => q.eq("sourceUrl", sourceUrl).eq("contentHash", computedHash))
        .first() as Doc<"sourceArtifacts"> | null;
      if (existing) return { id: existing._id, created: false, contentHash: computedHash };
    }

    // Fallback dedupe by hash only (covers cases without a URL).
    const byHash = await ctx.db.query("sourceArtifacts").withIndex("by_hash", (q) => q.eq("contentHash", computedHash)).first() as Doc<"sourceArtifacts"> | null;
    if (byHash && !sourceUrl) return { id: byHash._id, created: false, contentHash: computedHash };

    const id = await ctx.db.insert("sourceArtifacts", {
      runId: args.runId,
      sourceType: args.sourceType,
      sourceUrl,
      contentHash: computedHash,
      rawContent: args.rawContent,
      rawStorageId: args.rawStorageId,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      title: args.title,
      extractedData: args.extractedData,
      // PR D: populate searchableText for the federated `search_sources`
      // index. Sources are de-facto public artifacts of crawled URLs, so
      // both anonymous and authenticated callers can search them.
      searchableText: recomputeSourceSearchableText({
        title: args.title,
        sourceUrl,
        mimeType: args.mimeType,
      }),
      fetchedAt,
      expiresAt: args.expiresAt,
    });
    return { id, created: true, contentHash: computedHash };
  },
});

/**
 * Get artifact by ID with full provenance details.
 * Used for citation popovers and audit trails.
 */
export const getArtifactById = internalQuery({
  args: {
    artifactId: v.id("sourceArtifacts"),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("sourceArtifacts"),
      sourceType: v.string(),
      sourceUrl: v.optional(v.string()),
      contentHash: v.string(),
      rawContent: v.optional(v.string()),
      rawStorageId: v.optional(v.id("_storage")),
      mimeType: v.optional(v.string()),
      sizeBytes: v.optional(v.number()),
      title: v.optional(v.string()),
      extractedData: v.optional(v.any()),
      fetchedAt: v.number(),
      expiresAt: v.optional(v.number()),
      runId: v.optional(v.id("agentRuns")),
    })
  ),
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId) as Doc<"sourceArtifacts"> | null;
    if (!artifact) return null;
    return {
      _id: artifact._id,
      sourceType: artifact.sourceType,
      sourceUrl: artifact.sourceUrl,
      contentHash: artifact.contentHash,
      rawContent: artifact.rawContent,
      rawStorageId: (artifact as any).rawStorageId,
      mimeType: (artifact as any).mimeType,
      sizeBytes: (artifact as any).sizeBytes,
      title: (artifact as any).title,
      extractedData: artifact.extractedData,
      fetchedAt: artifact.fetchedAt,
      expiresAt: artifact.expiresAt,
      runId: artifact.runId,
    };
  },
});

/**
 * List recent artifacts for a given source type.
 * Useful for debugging and monitoring ingestion pipelines.
 */
export const listRecentArtifacts = internalQuery({
  args: {
    sourceType: v.optional(v.union(
      v.literal("url_fetch"),
      v.literal("api_response"),
      v.literal("file_upload"),
      v.literal("extracted_text"),
      v.literal("video_transcript")
    )),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({
    _id: v.id("sourceArtifacts"),
    sourceType: v.string(),
    sourceUrl: v.optional(v.string()),
    contentHash: v.string(),
    fetchedAt: v.number(),
    extractedDataPreview: v.optional(v.string()),
  })),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const recent = await ctx.db.query("sourceArtifacts").order("desc").take(limit * 2);

    const filtered = args.sourceType
      ? recent.filter(r => r.sourceType === args.sourceType)
      : recent;

    return filtered.slice(0, limit).map(artifact => ({
      _id: artifact._id,
      sourceType: artifact.sourceType,
      sourceUrl: artifact.sourceUrl,
      contentHash: artifact.contentHash,
      fetchedAt: artifact.fetchedAt,
      extractedDataPreview: artifact.extractedData
        ? JSON.stringify(artifact.extractedData).substring(0, 200) + "..."
        : undefined,
    }));
  },
});

export const countSince = internalQuery({
  args: {
    sinceMs: v.number(),
    sourceType: v.optional(
      v.union(
        v.literal("url_fetch"),
        v.literal("api_response"),
        v.literal("file_upload"),
        v.literal("extracted_text"),
        v.literal("video_transcript")
      )
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    // No index on fetchedAt alone; use by_sourceUrl index when available.
    // For a simple smoke check, scan recent records by hash index is not helpful.
    // Keep it bounded: count in the last ~300 records by created time via by_sourceUrl (requires a url),
    // so instead do a bounded full scan by iterating a small window via any index.
    // Convex doesn't support full table scans efficiently; here we rely on a bounded approach:
    // query by_hash with ordering is not supported, so we query by_sourceUrl with a dummy filter is not possible.
    // Practical compromise: return 0 if there are no records since; use dedicated checks that query by url+hash.
    //
    // This query is used only for E2E sanity, not production logic.
    const recent = await ctx.db.query("sourceArtifacts").order("desc").take(200);
    return recent.filter((r) => r.fetchedAt >= args.sinceMs && (!args.sourceType || r.sourceType === args.sourceType)).length;
  },
});
