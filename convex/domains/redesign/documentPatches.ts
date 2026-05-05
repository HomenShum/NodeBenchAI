/**
 * Redesign Sprint S5 — document patches queries + mutations.
 *
 * Powers the bidirectional contract for chat / agent → document edits.
 * Replaces the in-memory pendingPatches queue in ReportNotebookView.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const listPending = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("redesignDocumentPatches")
      .withIndex("by_document_status", (q) =>
        q.eq("documentId", args.documentId).eq("status", "pending"))
      .order("desc")
      .take(20);
    return rows.filter((r) => r.userId === userId);
  },
});

export const listForUser = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("redesignDocumentPatches")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "pending"))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const propose = mutation({
  args: {
    documentId: v.id("documents"),
    source: v.union(v.literal("chat"), v.literal("agent")),
    label: v.string(),
    preview: v.string(),
    html: v.string(),
    pipelineRunId: v.optional(v.id("pipelineRuns")),
    batchAutopilotRunId: v.optional(v.id("batchAutopilotRuns")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Auth required");
    const id = await ctx.db.insert("documentPatches", {
      documentId: args.documentId,
      userId,
      source: args.source,
      label: args.label.slice(0, 200),
      preview: args.preview.slice(0, 500),
      html: args.html,
      pipelineRunId: args.pipelineRunId,
      batchAutopilotRunId: args.batchAutopilotRunId,
      status: "pending",
      proposedAt: Date.now(),
    });
    return id;
  },
});

export const accept = mutation({
  args: {
    patchId: v.id("redesignDocumentPatches"),
    /** If user edited the proposed HTML before accepting, persist their version. */
    acceptedHtml: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Auth required");
    const patch = await ctx.db.get(args.patchId);
    if (!patch || patch.userId !== userId) throw new Error("Patch not found");
    await ctx.db.patch(args.patchId, {
      status: args.acceptedHtml ? "edited_then_accepted" : "accepted",
      resolvedAt: Date.now(),
      acceptedHtml: args.acceptedHtml,
    });
    return args.patchId;
  },
});

export const reject = mutation({
  args: { patchId: v.id("redesignDocumentPatches") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Auth required");
    const patch = await ctx.db.get(args.patchId);
    if (!patch || patch.userId !== userId) throw new Error("Patch not found");
    await ctx.db.patch(args.patchId, { status: "rejected", resolvedAt: Date.now() });
    return args.patchId;
  },
});
