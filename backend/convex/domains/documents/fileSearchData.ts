import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../_generated/server";
import type { Id, Doc } from "../../_generated/dataModel";

export const getFileSearchStoreForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("fileSearchStores")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
  },
});

export const createFileSearchStore = internalMutation({
  args: { userId: v.id("users"), storeName: v.string() },
  handler: async (ctx, { userId, storeName }) => {
    const now = Date.now();
    await ctx.db.insert("fileSearchStores", {
      userId,
      storeName,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getDocumentForUpsert = internalQuery({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const doc = await ctx.db.get(documentId) as Doc<"documents"> | null;
    if (!doc) return null;

    let fileData: { storageId: Id<"_storage">; mimeType: string } | null = null;
    if (doc.documentType === "file" && doc.fileId) {
      const file = await ctx.db.get(doc.fileId) as Doc<"files"> | null;
      if (file?.storageId) {
        fileData = {
          storageId: file.storageId,
          mimeType: file.mimeType,
        };
      }
    }

    return {
      doc,
      fileData,
    };
  },
});

export const updateDocumentIndexedAt = internalMutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    await ctx.db.patch(documentId, { fileSearchIndexedAt: Date.now() });
  },
});
