/**
 * pendingEdits.ts - Backend operations for Deep Agent document editing
 * 
 * This module implements the round-trip pattern for agent-generated edits:
 * 1. Agent creates pending edit instruction via createPendingEdit
 * 2. Client subscribes via getPendingEditsForDocument (real-time)
 * 3. Client applies edit via PmBridge and reports result via reportEditResult
 * 4. Agent monitors failed edits for self-correction
 */

import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id, Doc } from "../../_generated/dataModel";

/**
 * Get all pending or failed edits for a document
 * Client subscribes to this for real-time updates
 */
export const getPendingEditsForDocument = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Get pending and failed edits for this document owned by user
    const edits = await ctx.db
      .query("pendingDocumentEdits")
      .withIndex("by_document_status", (q) =>
        q.eq("documentId", args.documentId)
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), userId),
          q.or(
            q.eq(q.field("status"), "pending"),
            q.eq(q.field("status"), "failed")
          )
        )
      )
      .collect();

    return edits;
  },
});

/**
 * Get all edits for a specific agent thread
 */
export const getEditsForThread = query({
  args: { agentThreadId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    return await ctx.db
      .query("pendingDocumentEdits")
      .withIndex("by_thread", (q) => q.eq("agentThreadId", args.agentThreadId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();
  },
});

/**
 * Report edit result from client after PmBridge application attempt
 */
export const reportEditResult = mutation({
  args: {
    editId: v.id("pendingDocumentEdits"),
    success: v.boolean(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const edit = await ctx.db.get(args.editId) as Doc<"pendingDocumentEdits"> | null;
    if (!edit) throw new Error("Edit not found");
    if (edit.userId !== userId) throw new Error("Not authorized");

    await ctx.db.patch(args.editId, {
      status: args.success ? "applied" : "failed",
      errorMessage: args.errorMessage,
      appliedAt: args.success ? Date.now() : undefined,
    });

    return { success: true };
  },
});

/**
 * Cancel all pending edits for a thread
 */
export const cancelAllForThread = mutation({
  args: { agentThreadId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const edits = await ctx.db
      .query("pendingDocumentEdits")
      .withIndex("by_thread", (q) => q.eq("agentThreadId", args.agentThreadId))
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), userId),
          q.eq(q.field("status"), "pending")
        )
      )
      .collect();

    for (const edit of edits) {
      await ctx.db.patch(edit._id, { status: "cancelled" });
    }

    return { cancelledCount: edits.length };
  },
});

/**
 * Retry a failed edit (resets status to pending)
 */
export const retryEdit = mutation({
  args: { editId: v.id("pendingDocumentEdits") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const edit = await ctx.db.get(args.editId) as Doc<"pendingDocumentEdits"> | null;
    if (!edit) throw new Error("Edit not found");
    if (edit.userId !== userId) throw new Error("Not authorized");
    if (edit.status !== "failed") throw new Error("Can only retry failed edits");

    await ctx.db.patch(args.editId, {
      status: "pending",
      errorMessage: undefined,
      retryCount: (edit.retryCount || 0) + 1,
    });

    return { success: true };
  },
});

/**
 * Create a pending edit (Internal - called by agent tools)
 */
export const createPendingEdit = internalMutation({
  args: {
    documentId: v.id("documents"),
    userId: v.id("users"),
    agentThreadId: v.string(),
    documentVersion: v.number(),
    operation: v.object({
      type: v.literal("anchoredReplace"),
      anchor: v.string(),
      search: v.string(),
      replace: v.string(),
      sectionHint: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const editId = await ctx.db.insert("pendingDocumentEdits", {
      documentId: args.documentId,
      userId: args.userId,
      agentThreadId: args.agentThreadId,
      documentVersion: args.documentVersion,
      operation: args.operation,
      status: "pending",
      retryCount: 0,
      createdAt: Date.now(),
    });

    return { editId };
  },
});

/**
 * Get failed edits for a specific anchor (for agent self-correction)
 */
export const getFailedEditForAnchor = internalQuery({
  args: {
    documentId: v.id("documents"),
    anchor: v.string(),
  },
  handler: async (ctx, args) => {
    const edits = await ctx.db
      .query("pendingDocumentEdits")
      .withIndex("by_document_status", (q) =>
        q.eq("documentId", args.documentId).eq("status", "failed")
      )
      .filter((q) => q.eq(q.field("operation.anchor"), args.anchor))
      .first();

    return edits;
  },
});

/**
 * Get edit statistics for a thread (for progress reporting)
 */
export const getEditStatsForThread = internalQuery({
  args: { agentThreadId: v.string() },
  handler: async (ctx, args) => {
    const edits = await ctx.db
      .query("pendingDocumentEdits")
      .withIndex("by_thread", (q) => q.eq("agentThreadId", args.agentThreadId))
      .collect();

    return {
      total: edits.length,
      pending: edits.filter((e) => e.status === "pending").length,
      applied: edits.filter((e) => e.status === "applied").length,
      failed: edits.filter((e) => e.status === "failed").length,
      cancelled: edits.filter((e) => e.status === "cancelled").length,
    };
  },
});

/**
 * Mark edit as stale (document changed since planning)
 */
export const markEditStale = internalMutation({
  args: {
    editId: v.id("pendingDocumentEdits"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.editId, {
      status: "stale",
      errorMessage: args.errorMessage,
    });
  },
});

