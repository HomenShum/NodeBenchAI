import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "../../_generated/server";
import { Id, Doc } from "../../_generated/dataModel";

export const clearFileChunks = internalMutation({
  args: { fileId: v.id("files") },
  returns: v.number(),
  handler: async (ctx, { fileId }) => {
    const existing = await ctx.db
      .query("chunks")
      .withIndex("by_file", (q) => q.eq("fileId", fileId))
      .collect();
    let count = 0;
    for (const ch of existing) {
      await ctx.db.delete(ch._id);
      count += 1;
    }
    return count;
  },
});

export const saveFileChunks = internalMutation({
  args: {
    fileId: v.id("files"),
    chunks: v.array(
      v.object({
        text: v.string(),
        embedding: v.array(v.number()),
        meta: v.optional(v.any()),
      })
    ),
  },
  returns: v.number(),
  handler: async (ctx, { fileId, chunks }) => {
    let inserted = 0;
    for (const ch of chunks) {
      await ctx.db.insert("chunks", { fileId, text: ch.text, embedding: ch.embedding, meta: ch.meta });
      inserted += 1;
    }
    return inserted;
  },
});

export const updateFileCache = internalMutation({
  args: {
    fileId: v.id("files"),
    patch: v.object({
      genaiFileName: v.optional(v.string()),
      genaiFileUri: v.optional(v.string()),
      cacheName: v.optional(v.string()),
      cacheExpiresAt: v.optional(v.number()),
      metadata: v.optional(v.any()),
      contentSummary: v.optional(v.string()),
      textPreview: v.optional(v.string()),
      analyzedAt: v.optional(v.number()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { fileId, patch }) => {
    const file = await ctx.db.get(fileId);
    if (!file) throw new Error("File not found");
    await ctx.db.patch(fileId, patch as Partial<Doc<"files">>);
    return null;
  },
});

export const listChunksByFile = internalQuery({
  args: { fileId: v.id("files"), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("chunks"),
      fileId: v.id("files"),
      text: v.string(),
      meta: v.optional(v.any()),
      embedding: v.array(v.number()),
    })
  ),
  handler: async (ctx, { fileId, limit }) => {
    const q = ctx.db.query("chunks").withIndex("by_file", (q) => q.eq("fileId", fileId));
    const rows = limit ? await q.take(limit) : await q.collect();
    return rows.map((r) => ({
      _id: r._id,
      fileId: r.fileId,
      text: r.text,
      meta: r.meta,
      embedding: r.embedding,
    }));
  },
});

export const listChunksByFiles = internalQuery({
  args: { fileIds: v.array(v.id("files")), limitPerFile: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("chunks"),
      fileId: v.id("files"),
      text: v.string(),
      meta: v.optional(v.any()),
      embedding: v.array(v.number()),
    })
  ),
  handler: async (ctx, { fileIds, limitPerFile }) => {
    const results: Array<{
      _id: Id<"chunks">;
      fileId: Id<"files">;
      text: string;
      meta?: any;
      embedding: number[];
    }> = [];
    for (const fileId of fileIds) {
      const q = ctx.db.query("chunks").withIndex("by_file", (q) => q.eq("fileId", fileId));
      const rows = limitPerFile ? await q.take(limitPerFile) : await q.collect();
      for (const r of rows) {
        results.push({ _id: r._id, fileId: r.fileId, text: r.text, meta: r.meta, embedding: r.embedding });
      }
    }
    return results;
  },
});

export const listChunksPublic = query({
  args: { fileId: v.id("files") },
  returns: v.array(
    v.object({
      _id: v.id("chunks"),
      fileId: v.id("files"),
      text: v.string(),
      meta: v.optional(v.any()),
    })
  ),
  handler: async (ctx, { fileId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("chunks")
      .withIndex("by_file", (q) => q.eq("fileId", fileId))
      .collect();
    return rows.map((r) => ({
      _id: r._id,
      fileId: r.fileId,
      text: r.text.slice(0, 200),
      meta: r.meta,
    }));
  },
});

export const getFilesBasic = internalQuery({
  args: { fileIds: v.array(v.id("files")) },
  returns: v.array(
    v.object({
      _id: v.id("files"),
      _creationTime: v.number(),
      userId: v.string(),
      fileName: v.string(),
      fileType: v.string(),
      mimeType: v.string(),
      fileSize: v.number(),
      contentSummary: v.optional(v.string()),
      textPreview: v.optional(v.string()),
      analysis: v.optional(v.string()),
      analyzedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, { fileIds }) => {
    const results: Doc<"files">[] = [];
    for (const id of fileIds) {
      const f = await ctx.db.get(id);
      if (f) results.push(f);
    }
    return results.map((f) => ({
      _id: f._id,
      _creationTime: f._creationTime,
      userId: f.userId,
      fileName: f.fileName,
      fileType: f.fileType,
      mimeType: f.mimeType,
      fileSize: f.fileSize,
      contentSummary: f.contentSummary,
      textPreview: f.textPreview,
      analysis: f.analysis,
      analyzedAt: f.analyzedAt,
    }));
  },
});

export const getFilesBasicPublic = query({
  args: { fileIds: v.array(v.id("files")) },
  returns: v.array(
    v.object({
      _id: v.id("files"),
      _creationTime: v.number(),
      userId: v.string(),
      fileName: v.string(),
      fileType: v.string(),
      mimeType: v.string(),
      fileSize: v.number(),
      contentSummary: v.optional(v.string()),
      textPreview: v.optional(v.string()),
      analysis: v.optional(v.string()),
      analyzedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, { fileIds }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }
    const results: Doc<"files">[] = [];
    for (const id of fileIds) {
      const f = await ctx.db.get(id) as Doc<"files"> | null;
      if (f && f.userId === identity.subject) {
        results.push(f);
      }
    }
    return results.map((f) => ({
      _id: f._id,
      _creationTime: f._creationTime,
      userId: f.userId,
      fileName: f.fileName,
      fileType: f.fileType,
      mimeType: f.mimeType,
      fileSize: f.fileSize,
      contentSummary: f.contentSummary,
      textPreview: f.textPreview,
      analysis: f.analysis,
      analyzedAt: f.analyzedAt,
    }));
  },
});
