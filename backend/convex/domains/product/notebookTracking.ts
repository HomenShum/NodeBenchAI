/**
 * notebookTracking.ts — "track this entity" subscriptions.
 *
 * Closes framework audit violation #5 (TRANSITION Report -> Nudge).
 *
 * Data model
 *   productNudgeSubscriptions: one row per (ownerKey, entityId). See
 *   convex/domains/product/schema.ts for the full shape.
 *
 * Public surface
 *   - isSubscribedToEntity (query):  UI toggle initial state
 *   - subscribeToEntity (mutation):  create-or-touch the subscription
 *   - unsubscribeFromEntity (mutation): remove
 *   - listMySubscriptions (query):   for a future "tracked entities"
 *                                    section of the nudges surface
 *
 * Internal surface
 *   - scanAndDispatch (internalMutation): scheduled by the cron in
 *     convex/crons.ts; walks subscriptions, detects new agent content
 *     since lastNotifiedAt, posts one ntfy per subscription, bumps
 *     the timestamp.
 *
 * Kill switch: NOTEBOOK_TRACKING_ENABLED=false (Convex env) makes every
 * mutation return {ok:false, code:"DISABLED"} and the dispatcher a no-op.
 */

import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { internalMutation, mutation, query } from "../../_generated/server";
import { requireProductIdentity } from "./helpers";

// Local ConvexError shim — matches the pattern in blocks.ts, avoids a
// Convex-bundler tsc bug that trips on `import { ConvexError } from "convex/values"`.
class ProductConvexError<T extends Record<string, unknown>> extends Error {
  name = "ConvexError";
  data: T;
  constructor(data: T) {
    super(JSON.stringify(data));
    this.data = data;
    (this as Record<PropertyKey, unknown>)[Symbol.for("ConvexError")] = true;
  }
}

const DEFAULT_MIN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function isEnabled(): boolean {
  const flag = process.env.NOTEBOOK_TRACKING_ENABLED;
  return flag !== "false" && flag !== "0";
}

// ─────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────

export const isSubscribedToEntity = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entitySlug: v.string(),
  },
  returns: v.object({
    subscribed: v.boolean(),
    subscriptionId: v.union(v.id("productNudgeSubscriptions"), v.null()),
  }),
  handler: async (ctx, args) => {
    if (!isEnabled()) return { subscribed: false, subscriptionId: null };
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const entity = await ctx.db
      .query("productEntities")
      .withIndex("by_owner_slug", (q) =>
        q.eq("ownerKey", identity.ownerKey!).eq("slug", args.entitySlug),
      )
      .first();
    if (!entity) return { subscribed: false, subscriptionId: null };

    const sub = await ctx.db
      .query("productNudgeSubscriptions")
      .withIndex("by_owner_entity", (q) =>
        q.eq("ownerKey", identity.ownerKey!).eq("entityId", entity._id),
      )
      .first();
    return {
      subscribed: sub !== null,
      subscriptionId: sub ? sub._id : null,
    };
  },
});

export const listMySubscriptions = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      _id: v.id("productNudgeSubscriptions"),
      entitySlug: v.string(),
      entityName: v.string(),
      channel: v.union(v.literal("ntfy"), v.literal("email"), v.literal("slack")),
      createdAt: v.number(),
      updatedAt: v.number(),
      lastNotifiedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    if (!isEnabled()) return [];
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const rows = await ctx.db
      .query("productNudgeSubscriptions")
      .withIndex("by_owner_updated", (q) => q.eq("ownerKey", identity.ownerKey!))
      .order("desc")
      .take(100);
    return rows.map((r) => ({
      _id: r._id,
      entitySlug: r.entitySlug,
      entityName: r.entityName,
      channel: r.channel,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      lastNotifiedAt: r.lastNotifiedAt,
    }));
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────

export const subscribeToEntity = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entitySlug: v.string(),
    channel: v.optional(v.union(v.literal("ntfy"), v.literal("email"), v.literal("slack"))),
    ntfyUrl: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    code: v.optional(v.string()),
    subscriptionId: v.union(v.id("productNudgeSubscriptions"), v.null()),
  }),
  handler: async (ctx, args) => {
    if (!isEnabled()) {
      return { ok: false, code: "DISABLED", subscriptionId: null };
    }
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const entity = await ctx.db
      .query("productEntities")
      .withIndex("by_owner_slug", (q) =>
        q.eq("ownerKey", identity.ownerKey!).eq("slug", args.entitySlug),
      )
      .first();
    if (!entity) {
      throw new ProductConvexError({ code: "ENTITY_NOT_FOUND", slug: args.entitySlug });
    }

    const existing = await ctx.db
      .query("productNudgeSubscriptions")
      .withIndex("by_owner_entity", (q) =>
        q.eq("ownerKey", identity.ownerKey!).eq("entityId", entity._id),
      )
      .first();

    const now = Date.now();
    if (existing) {
      // Already subscribed — touch updatedAt so the user can tell the
      // subscription is fresh. Do NOT reset lastNotifiedAt; that would
      // cause a dispatch-storm on every re-click.
      await ctx.db.patch(existing._id, {
        updatedAt: now,
        channel: args.channel ?? existing.channel,
        ntfyUrl: args.ntfyUrl ?? existing.ntfyUrl,
      });
      return { ok: true, code: "ALREADY_SUBSCRIBED", subscriptionId: existing._id };
    }

    const subscriptionId = await ctx.db.insert("productNudgeSubscriptions", {
      ownerKey: identity.ownerKey!,
      entityId: entity._id,
      entitySlug: entity.slug,
      entityName: entity.name,
      channel: args.channel ?? "ntfy",
      ntfyUrl: args.ntfyUrl,
      createdAt: now,
      updatedAt: now,
      lastNotifiedAt: now, // first run will not replay pre-subscription history
      minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
    });
    return { ok: true, subscriptionId };
  },
});

export const unsubscribeFromEntity = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entitySlug: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    code: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    if (!isEnabled()) return { ok: false, code: "DISABLED" };
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const entity = await ctx.db
      .query("productEntities")
      .withIndex("by_owner_slug", (q) =>
        q.eq("ownerKey", identity.ownerKey!).eq("slug", args.entitySlug),
      )
      .first();
    if (!entity) return { ok: true, code: "ENTITY_NOT_FOUND" };

    const existing = await ctx.db
      .query("productNudgeSubscriptions")
      .withIndex("by_owner_entity", (q) =>
        q.eq("ownerKey", identity.ownerKey!).eq("entityId", entity._id),
      )
      .first();
    if (!existing) return { ok: true, code: "NOT_SUBSCRIBED" };

    await ctx.db.delete(existing._id);
    return { ok: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Internal dispatcher — called by convex/crons.ts on a schedule.
// Batches up to 50 subscriptions per tick so one slow POST can't block
// the rest. Fail-open on ntfy failure: skip the subscription, do NOT
// bump lastNotifiedAt so the next tick retries.
// ─────────────────────────────────────────────────────────────────────────

export const scanAndDispatch = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    dispatched: v.number(),
    skipped: v.number(),
    errors: v.number(),
  }),
  handler: async (ctx, args) => {
    if (!isEnabled()) {
      return { scanned: 0, dispatched: 0, skipped: 0, errors: 0 };
    }

    const batchSize = Math.min(args.batchSize ?? 50, 200);
    const now = Date.now();

    // Oldest-lastNotifiedAt first — fairness across subscriptions.
    const subs = await ctx.db
      .query("productNudgeSubscriptions")
      .withIndex("by_last_notified")
      .order("asc")
      .take(batchSize);

    let dispatched = 0;
    let skipped = 0;
    let errors = 0;

    for (const sub of subs) {
      try {
        // Rate-limit guard: is enough time elapsed since the last fire?
        const minInterval = sub.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
        if (now - sub.lastNotifiedAt < minInterval) {
          skipped += 1;
          continue;
        }

        // Is there any agent-authored block newer than lastNotifiedAt?
        const recentAgentBlock = await findNewestAgentBlock(
          ctx,
          sub.entityId,
          sub.lastNotifiedAt,
        );
        if (!recentAgentBlock) {
          // No new content — bump lastNotifiedAt to avoid re-scanning this
          // subscription every tick for the same negative result.
          await ctx.db.patch(sub._id, { lastNotifiedAt: now });
          skipped += 1;
          continue;
        }

        // Dispatch. ntfy-first; email/slack left as future work.
        if (sub.channel === "ntfy") {
          const dispatchUrl = sub.ntfyUrl ?? process.env.OPS_NTFY_URL;
          if (!dispatchUrl) {
            // Channel configured but no URL available — skip and log.
            skipped += 1;
            continue;
          }
          const body =
            `Agent just updated "${sub.entityName}".\n` +
            `Open: /entity/${sub.entitySlug}`;
          try {
            await fetch(dispatchUrl, {
              method: "POST",
              headers: {
                Title: `[Track] ${sub.entityName}`.slice(0, 250),
                Priority: "3",
                Tags: "notebook,page_with_curl",
              },
              body,
            });
            dispatched += 1;
            await ctx.db.patch(sub._id, { lastNotifiedAt: now });
          } catch {
            // Fail-open: leave lastNotifiedAt unchanged so next tick retries.
            errors += 1;
          }
        } else {
          // email/slack not yet wired — bump timestamp so we don't
          // bombard ntfy with "can't dispatch" entries.
          skipped += 1;
          await ctx.db.patch(sub._id, { lastNotifiedAt: now });
        }
      } catch {
        errors += 1;
      }
    }

    return { scanned: subs.length, dispatched, skipped, errors };
  },
});

async function findNewestAgentBlock(
  ctx: { db: { query: (name: string) => unknown } },
  entityId: Id<"productEntities">,
  since: number,
): Promise<Doc<"productBlocks"> | null> {
  // The `by_owner_entity` index on productBlocks orders by
  // (ownerKey, entityId, positionInt, positionFrac). For newness we need
  // a different sort — we scan, filter by updatedAt, and take the first
  // hit. Batch is cheap because entities rarely have >1000 blocks.
  const anyDb = (ctx.db as unknown as {
    query: (n: string) => {
      withIndex: (
        i: string,
        f: (q: {
          eq: (k: string, v: unknown) => {
            eq: (k: string, v: unknown) => unknown;
          };
        }) => unknown,
      ) => { collect: () => Promise<Doc<"productBlocks">[]> };
    };
  }).query("productBlocks");
  // We can't narrow by (ownerKey, entityId) without the ownerKey. Instead
  // we rely on the `by_entity` index if available, otherwise full collect.
  // The schema declares `by_owner_entity` but not `by_entity`, so we
  // collect then filter — fine at current scale.
  const all = await (
    anyDb as unknown as { collect: () => Promise<Doc<"productBlocks">[]> }
  ).collect();
  const candidates = all
    .filter(
      (b) =>
        b.entityId === entityId &&
        !b.deletedAt &&
        b.authorKind === "agent" &&
        b.updatedAt > since,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return candidates[0] ?? null;
}
