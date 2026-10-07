/**
 * Public query/mutation wrappers for agent subsystems (lessons + budget).
 *
 * The lesson + budget Convex modules expose `internalQuery` / `internalMutation`
 * only — those cannot be called from React components.  This file re-exposes
 * the read paths the operator UI needs (LessonsPanel + ResilienceSettings)
 * as `query` / `mutation` with proper auth checks.
 *
 * Auth model: every read scopes to the current authenticated user; anonymous
 * visitors get an empty result for `listLessonsForThread` and a null for
 * `getBudgetSnapshot` so the UI degrades gracefully into seed/empty states.
 */
import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ─────────────────────────────────────────────────────────────────────────
// Lessons — public reads + writes for LessonsPanel
// ─────────────────────────────────────────────────────────────────────────

/**
 * List all lessons captured against a given thread, regardless of deprecated
 * state.  The UI filters by deprecated/type client-side.
 */
export const listLessonsForThread = query({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("agentLessons")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    return rows.sort((a, b) => b.capturedAt - a.capturedAt);
  },
});

/**
 * Pin or unpin a lesson.  Pinned lessons stay above the fold in the
 * system-prompt prefix during agent runs, even after expiration.
 */
export const pinLessonById = mutation({
  args: {
    lessonId: v.id("agentLessons"),
    pinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("not_authenticated");
    }
    await ctx.db.patch(args.lessonId, { pinned: args.pinned });
    return null;
  },
});

/**
 * Soft-delete a lesson (sets `deprecated: true`).  Capture writers and the
 * system-prompt builder respect this flag and ignore the row.
 */
export const deprecateLessonById = mutation({
  args: {
    lessonId: v.id("agentLessons"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("not_authenticated");
    }
    await ctx.db.patch(args.lessonId, { deprecated: true });
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Budget — public read for ResilienceSettings
// (write path is the existing public `upsertBudgetForOwner` mutation in
// budgetGate.ts)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Read the budget snapshot for the current authenticated owner.  Returns
 * null when not authenticated or no row yet exists.  The UI then renders
 * the "Get started" empty state.
 */
export const getBudgetSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const ownerKey = `user:${userId}`;
    const row = await ctx.db
      .query("userBudgets")
      .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey))
      .first();
    return row ?? null;
  },
});
