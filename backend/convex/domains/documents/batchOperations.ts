import { v } from "convex/values";
import { mutation } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc, Id } from "../../_generated/dataModel";

export const bulkArchive = mutation({
  args: {
    documentIds: v.array(v.id("documents")),
  },
  returns: v.object({ succeeded: v.number(), failed: v.number() }),
  handler: async (ctx, { documentIds }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    let succeeded = 0;
    let failed = 0;

    for (const id of documentIds) {
      const doc = (await ctx.db.get(id)) as Doc<"documents"> | null;
      if (!doc || doc.createdBy !== userId) {
        failed++;
        continue;
      }
      await ctx.db.patch(id, { isArchived: true });
      succeeded++;
    }

    return { succeeded, failed };
  },
});

export const bulkRestore = mutation({
  args: {
    documentIds: v.array(v.id("documents")),
  },
  returns: v.object({ succeeded: v.number(), failed: v.number() }),
  handler: async (ctx, { documentIds }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    let succeeded = 0;
    let failed = 0;

    for (const id of documentIds) {
      const doc = (await ctx.db.get(id)) as Doc<"documents"> | null;
      if (!doc || doc.createdBy !== userId) {
        failed++;
        continue;
      }
      await ctx.db.patch(id, { isArchived: false });
      succeeded++;
    }

    return { succeeded, failed };
  },
});

export const bulkToggleFavorite = mutation({
  args: {
    documentIds: v.array(v.id("documents")),
    favorite: v.optional(v.boolean()),
  },
  returns: v.object({ succeeded: v.number(), failed: v.number() }),
  handler: async (ctx, { documentIds, favorite }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    let succeeded = 0;
    let failed = 0;

    for (const id of documentIds) {
      const doc = (await ctx.db.get(id)) as Doc<"documents"> | null;
      if (!doc || doc.createdBy !== userId) {
        failed++;
        continue;
      }
      const newVal = favorite !== undefined ? favorite : !doc.isFavorite;
      await ctx.db.patch(id, { isFavorite: newVal });
      succeeded++;
    }

    return { succeeded, failed };
  },
});

export const bulkMoveToFolder = mutation({
  args: {
    documentIds: v.array(v.id("documents")),
    folderId: v.id("folders"),
  },
  returns: v.object({ succeeded: v.number(), failed: v.number() }),
  handler: async (ctx, { documentIds, folderId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const folder = await ctx.db.get(folderId);
    if (!folder || (folder as any).userId !== userId) {
      throw new Error("Folder not found or unauthorized");
    }

    let succeeded = 0;
    let failed = 0;

    for (const documentId of documentIds) {
      const doc = (await ctx.db.get(documentId)) as Doc<"documents"> | null;
      if (!doc || doc.createdBy !== userId) {
        failed++;
        continue;
      }

      // Skip if already in folder
      const existing = await ctx.db
        .query("documentFolders")
        .withIndex("by_document_folder", (q) =>
          q.eq("documentId", documentId).eq("folderId", folderId)
        )
        .first();

      if (!existing) {
        await ctx.db.insert("documentFolders", {
          documentId,
          folderId,
          userId,
          addedAt: Date.now(),
        });
      }
      succeeded++;
    }

    await ctx.db.patch(folderId, { updatedAt: Date.now() } as any);
    return { succeeded, failed };
  },
});

export const bulkDelete = mutation({
  args: {
    documentIds: v.array(v.id("documents")),
  },
  returns: v.object({ succeeded: v.number(), failed: v.number() }),
  handler: async (ctx, { documentIds }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    let succeeded = 0;
    let failed = 0;

    for (const id of documentIds) {
      const doc = (await ctx.db.get(id)) as Doc<"documents"> | null;
      if (!doc || doc.createdBy !== userId) {
        failed++;
        continue;
      }
      if (!doc.isArchived) {
        failed++;
        continue;
      }
      await ctx.db.delete(id);
      succeeded++;
    }

    return { succeeded, failed };
  },
});
