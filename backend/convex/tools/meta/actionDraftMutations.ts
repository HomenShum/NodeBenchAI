/**
 * Action Draft Mutations
 *
 * Mutations for managing action drafts (write operation confirmation flow).
 * Part of the progressive disclosure risk tier enforcement.
 */

import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL MUTATIONS (for gateway use)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new action draft for a write/destructive operation.
 */
export const createActionDraft = internalMutation({
  args: {
    sessionId: v.string(),
    userId: v.optional(v.id("users")),
    toolName: v.string(),
    args: v.string(), // JSON-stringified arguments
    riskTier: v.union(v.literal("write"), v.literal("destructive")),
    actionSummary: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"actionDrafts">> => {
    const draftId = await ctx.db.insert("actionDrafts", {
      sessionId: args.sessionId,
      userId: args.userId,
      toolName: args.toolName,
      args: args.args,
      riskTier: args.riskTier,
      actionSummary: args.actionSummary,
      status: "pending",
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
    });

    console.log(`[actionDraft] Created draft ${draftId} for ${args.toolName} (${args.riskTier})`);
    return draftId;
  },
});

/**
 * Get an action draft by ID.
 */
export const getActionDraft = internalQuery({
  args: {
    draftId: v.id("actionDrafts"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.draftId) as Doc<"actionDrafts"> | null;
  },
});

/**
 * Confirm an action draft and mark it as executed.
 */
export const confirmActionDraft = internalMutation({
  args: {
    draftId: v.id("actionDrafts"),
    executedResult: v.optional(v.string()), // JSON-stringified result
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    const draft = await ctx.db.get(args.draftId) as Doc<"actionDrafts"> | null;

    if (!draft) {
      return { success: false, error: "Draft not found" };
    }

    if (draft.status !== "pending") {
      return { success: false, error: `Draft already ${draft.status}` };
    }

    if (draft.expiresAt < Date.now()) {
      await ctx.db.patch(args.draftId, { status: "expired" });
      return { success: false, error: "Draft has expired" };
    }

    await ctx.db.patch(args.draftId, {
      status: "confirmed",
      executedAt: Date.now(),
      executedResult: args.executedResult,
    });

    console.log(`[actionDraft] Confirmed draft ${args.draftId}`);
    return { success: true };
  },
});

/**
 * Deny an action draft.
 */
export const denyActionDraft = internalMutation({
  args: {
    draftId: v.id("actionDrafts"),
    reason: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    const draft = await ctx.db.get(args.draftId) as Doc<"actionDrafts"> | null;

    if (!draft) {
      return { success: false, error: "Draft not found" };
    }

    if (draft.status !== "pending") {
      return { success: false, error: `Draft already ${draft.status}` };
    }

    await ctx.db.patch(args.draftId, {
      status: "denied",
      deniedReason: args.reason,
    });

    console.log(`[actionDraft] Denied draft ${args.draftId}: ${args.reason}`);
    return { success: true };
  },
});

/**
 * Expire all pending drafts that have passed their expiration time.
 */
export const expireOldDrafts = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const now = Date.now();
    const pendingDrafts = await ctx.db
      .query("actionDrafts")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    let expired = 0;
    for (const draft of pendingDrafts) {
      if (draft.expiresAt < now) {
        await ctx.db.patch(draft._id, { status: "expired" });
        expired++;
      }
    }

    if (expired > 0) {
      console.log(`[actionDraft] Expired ${expired} old drafts`);
    }
    return expired;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC QUERIES (for UI)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * List pending action drafts for a session (for UI confirmation flow).
 */
export const listPendingDrafts = query({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const drafts = await ctx.db
      .query("actionDrafts")
      .withIndex("by_session_status", (q) =>
        q.eq("sessionId", args.sessionId).eq("status", "pending")
      )
      .collect();

    // Filter out expired ones
    const now = Date.now();
    return drafts.filter((d: Doc<"actionDrafts">) => d.expiresAt > now);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC MUTATIONS (for UI confirmation)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * User confirms an action draft from the UI.
 */
export const userConfirmDraft = mutation({
  args: {
    draftId: v.id("actionDrafts"),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    const draft = await ctx.db.get(args.draftId) as Doc<"actionDrafts"> | null;

    if (!draft) {
      return { success: false, error: "Draft not found" };
    }

    if (draft.status !== "pending") {
      return { success: false, error: `Action already ${draft.status}` };
    }

    if (draft.expiresAt < Date.now()) {
      await ctx.db.patch(args.draftId, { status: "expired" });
      return { success: false, error: "Action has expired. Please try again." };
    }

    // Mark as confirmed - the gateway will handle execution
    await ctx.db.patch(args.draftId, {
      status: "confirmed",
      executedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * User denies an action draft from the UI.
 */
export const userDenyDraft = mutation({
  args: {
    draftId: v.id("actionDrafts"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const draft = await ctx.db.get(args.draftId) as Doc<"actionDrafts"> | null;

    if (!draft) {
      return { success: false };
    }

    if (draft.status !== "pending") {
      return { success: false };
    }

    await ctx.db.patch(args.draftId, {
      status: "denied",
      deniedReason: args.reason || "User declined",
    });

    return { success: true };
  },
});
