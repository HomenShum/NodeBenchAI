// convex/tools/editDocumentMutations.ts
// Internal mutations and queries for document patch storage

import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

/**
 * Store a document edit patch for audit trail
 */
export const storeDocumentPatch = internalMutation({
  args: {
    documentId: v.string(),
    operations: v.any(), // Array of operations
    description: v.optional(v.string()),
    originalContent: v.optional(v.string()),
    newContentPreview: v.optional(v.string()),
    appliedCount: v.number(),
    failedCount: v.number(),
    threadId: v.optional(v.string()),
    runId: v.optional(v.string()),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const patchData: any = {
      documentId: args.documentId,
      operations: args.operations,
      appliedCount: args.appliedCount,
      failedCount: args.failedCount,
      createdAt: now,
    };

    if (args.description) patchData.description = args.description;
    if (args.originalContent) patchData.originalContentPreview = args.originalContent;
    if (args.newContentPreview) patchData.newContentPreview = args.newContentPreview;
    if (args.threadId) patchData.threadId = args.threadId;
    if (args.runId) patchData.runId = args.runId;
    if (args.userId) patchData.userId = args.userId;

    const id = await ctx.db.insert("documentPatches", patchData);

    console.log("[storeDocumentPatch] Patch stored", {
      id,
      documentId: args.documentId,
      appliedCount: args.appliedCount,
    });

    return id;
  },
});

/**
 * Get recent patches for a document
 */
export const getDocumentPatches = internalQuery({
  args: {
    documentId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;

    const patches = await ctx.db
      .query("documentPatches")
      .withIndex("by_document", q => q.eq("documentId", args.documentId))
      .order("desc")
      .take(limit);

    return patches;
  },
});

/**
 * Get all patches for a document (for full reconstruction)
 */
export const getAllDocumentPatches = internalQuery({
  args: {
    documentId: v.string(),
  },
  handler: async (ctx, args) => {
    const patches = await ctx.db
      .query("documentPatches")
      .withIndex("by_document", q => q.eq("documentId", args.documentId))
      .order("asc")
      .collect();

    return patches;
  },
});
