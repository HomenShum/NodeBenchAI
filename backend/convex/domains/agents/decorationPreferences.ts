/**
 * decorationPreferences.ts — persistent per-user dismissal of inline
 * agent suggestions.
 *
 * Before this table, dismissals were client-only React state — a
 * user who dismissed a noisy suggestion would see it reappear on
 * every page refresh. That broke trust in the surface: the user
 * felt the agent wasn't listening.
 *
 * Now dismissals persist to `dismissedDecorations` and the render
 * path filters accordingly.
 *
 * Invariants (BOUND, HONEST_STATUS):
 *   - Dismissals are keyed by `(ownerKey, scratchpadRunId)` —
 *     a single run produces decorations across multiple block types;
 *     dismissing one block's decoration does NOT silence the others.
 *     If the user dismisses all block types from the same run, we
 *     still insert per (ownerKey, scratchpadRunId, blockType) so
 *     telemetry can distinguish.
 *   - `undismiss` is a real delete, not a soft flag — the user's
 *     mental model is "un-dismiss = show it again", and soft flags
 *     accumulate schema cruft.
 *   - `listDismissedForEntity` caps at 500 rows; a noisy entity
 *     can accumulate many runs but we don't need unbounded reads.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { requireProductIdentity, resolveProductIdentitySafely } from "../product/helpers";

const MAX_LIST_LIMIT = 500;

/**
 * `dismiss` — persist the user's "hide this suggestion" action.
 *
 * Idempotent: calling twice with the same (ownerKey, scratchpadRunId,
 * blockType) does NOT insert a duplicate; the first insert wins and
 * the second call is a no-op returning the existing row id.
 */
export const dismiss = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entitySlug: v.string(),
    scratchpadRunId: v.string(),
    blockType: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.anonymousSessionId ?? (identity.ownerKey as string);
    // Idempotency: check for existing row first.
    const existing = await ctx.db
      .query("dismissedDecorations")
      .withIndex("by_owner_run", (q) =>
        q.eq("ownerKey", ownerKey).eq("scratchpadRunId", args.scratchpadRunId),
      )
      .filter((q) => q.eq(q.field("blockType"), args.blockType))
      .first();
    if (existing) return existing._id;
    const insertedId = await ctx.db.insert("dismissedDecorations", {
      ownerKey,
      userId: (identity.rawUserId ?? undefined) as any,
      entitySlug: args.entitySlug,
      scratchpadRunId: args.scratchpadRunId,
      blockType: args.blockType,
      dismissedAt: Date.now(),
      reason: args.reason,
    });
    return insertedId;
  },
});

/**
 * `undismiss` — remove a dismissal. Real delete.
 */
export const undismiss = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    scratchpadRunId: v.string(),
    blockType: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.anonymousSessionId ?? (identity.ownerKey as string);
    const existing = await ctx.db
      .query("dismissedDecorations")
      .withIndex("by_owner_run", (q) =>
        q.eq("ownerKey", ownerKey).eq("scratchpadRunId", args.scratchpadRunId),
      )
      .filter((q) => q.eq(q.field("blockType"), args.blockType))
      .first();
    if (!existing) return null;
    await ctx.db.delete(existing._id);
    return existing._id;
  },
});

/**
 * `listDismissedForEntity` — set of (scratchpadRunId, blockType)
 * pairs the render path should filter out. Returned as a flat
 * array; UI builds a Set for O(1) lookup.
 */
export const listDismissedForEntity = query({
  args: {
    entitySlug: v.string(),
    anonymousSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await resolveProductIdentitySafely(ctx, args.anonymousSessionId);
    if (!identity) return [];
    const ownerKey = identity.anonymousSessionId ?? (identity.ownerKey as string);
    const rows = await ctx.db
      .query("dismissedDecorations")
      .withIndex("by_owner_entity", (q) =>
        q.eq("ownerKey", ownerKey).eq("entitySlug", args.entitySlug),
      )
      .take(MAX_LIST_LIMIT);
    return rows.map((r) => ({
      scratchpadRunId: r.scratchpadRunId,
      blockType: r.blockType,
      dismissedAt: r.dismissedAt,
    }));
  },
});
