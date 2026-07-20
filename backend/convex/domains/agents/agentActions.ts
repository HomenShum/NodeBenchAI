/**
 * agentActions.ts — unified structured action log across three surfaces.
 *
 * Pattern: Anthropic trace events + NodeBench `surfaceOrigin` tag.
 *
 * Every structured action the user takes via an agent — accepting an
 * inline notebook decoration, dismissing a suggestion, asking the
 * side-panel drawer a follow-up, submitting a chat-page message —
 * lands here as a single row with `surfaceOrigin` set to one of
 * `inline | drawer | chat`.
 *
 * Why one table for three surfaces:
 *   - The drawer can now show "earlier today I accepted a founder
 *     tier on Acme" even when the accept happened inline in the
 *     notebook, not in the drawer.
 *   - Telemetry + product analytics stop being surface-fragmented.
 *   - When a canonical `agentThreads` / `agentMessages` migration
 *     lands, this table's `threadId` column is already the join key.
 *
 * Invariants (HONEST_STATUS, BOUND, DETERMINISTIC):
 *   - `kind` is a bounded enum (no freeform strings).
 *   - Every list query caps at 100 rows via `.take()`.
 *   - `createdAt` is `Date.now()` at mutation time — monotonic per
 *     ordered reads because rows are inserted, not backdated.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { requireProductIdentity, resolveProductIdentitySafely, resolveProductReadOwnerKeys } from "../product/helpers";

/** Bounded enum mirroring `schema.ts::agentActions.kind`. */
const kindValidator = v.union(
  v.literal("decoration_accepted"),
  v.literal("decoration_dismissed"),
  v.literal("decoration_refreshed"),
  v.literal("decoration_asked_about"),
  v.literal("block_added"),
  v.literal("block_edited"),
  v.literal("message_sent"),
);

const surfaceValidator = v.union(
  v.literal("inline"),
  v.literal("drawer"),
  v.literal("chat"),
);

const MAX_LIST_LIMIT = 100;

/**
 * `log` — record one structured agent action.
 *
 * Returns the inserted row id. Mutation body is deliberately
 * minimal: no fan-out, no scheduled work. If you want a follow-on
 * side effect (e.g., notify the drawer), call a separate mutation
 * or action after this one.
 */
export const log = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    surfaceOrigin: surfaceValidator,
    kind: kindValidator,
    summary: v.string(),
    // Linking — all optional because different kinds carry different FKs.
    threadId: v.optional(v.string()),
    entitySlug: v.optional(v.string()),
    blockId: v.optional(v.string()),
    scratchpadRunId: v.optional(v.string()),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.anonymousSessionId ?? (identity.ownerKey as string);
    const insertedId = await ctx.db.insert("agentActions", {
      ownerKey,
      userId: (identity.rawUserId ?? undefined) as any,
      surfaceOrigin: args.surfaceOrigin,
      threadId: args.threadId,
      entitySlug: args.entitySlug,
      blockId: args.blockId,
      scratchpadRunId: args.scratchpadRunId,
      kind: args.kind,
      summary: args.summary.slice(0, 500), // BOUND the summary string
      payload: args.payload,
      createdAt: Date.now(),
    });
    return insertedId;
  },
});

/**
 * `listRecentForOwner` — recent actions for the current identity.
 *
 * Used by the drawer to show an "activity" list: "2 min ago you
 * accepted founder on Acme, 5 min ago you dismissed product on Acme".
 * This is the seam that lets the drawer feel connected to inline AI.
 */
export const listRecentForOwner = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await resolveProductIdentitySafely(ctx, args.anonymousSessionId);
    if (!identity) return [];
    const ownerKey = identity.anonymousSessionId ?? (identity.ownerKey as string);
    const limit = Math.min(args.limit ?? 20, MAX_LIST_LIMIT);
    const rows = await ctx.db
      .query("agentActions")
      .withIndex("by_owner_time", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .take(limit);
    return rows;
  },
});

/**
 * `listForEntity` — actions for one entity, across all surfaces.
 *
 * Used by the entity notebook's activity rail (future) and by the
 * drawer when opened with an entity context.
 */
export const listForEntity = query({
  args: {
    entitySlug: v.string(),
    anonymousSessionId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ownerKeys = await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);
    if (ownerKeys.length === 0) return [];
    const limit = Math.min(args.limit ?? 50, MAX_LIST_LIMIT);
    const rows = await ctx.db
      .query("agentActions")
      .withIndex("by_entity_time", (q) => q.eq("entitySlug", args.entitySlug))
      .order("desc")
      .take(limit);
    // Filter to owner set (entity could be shared across owners; we only
    // show actions performed by people in the current read-access set).
    const ownerSet = new Set(ownerKeys);
    return rows.filter((r) => ownerSet.has(r.ownerKey));
  },
});

/**
 * `listForThread` — actions that reference one agent thread. Used
 * when the drawer wants to render structured actions inline with
 * chat messages (e.g., a small "decoration accepted" chip appears
 * between user turn and agent turn).
 */
export const listForThread = query({
  args: {
    threadId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, MAX_LIST_LIMIT);
    const rows = await ctx.db
      .query("agentActions")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(limit);
    return rows;
  },
});
