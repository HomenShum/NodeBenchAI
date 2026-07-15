/**
 * pulseReports.ts — daily-regenerated "what changed" summary per
 * entity. See `schema.ts::pulseReports` for the row shape.
 *
 * V1 scope:
 *   - One manual `generatePulseForEntity` mutation (user-triggered)
 *   - Queries for: today's pulse per entity, historical pulse,
 *     unread count for the nav badge, cross-entity digest feed
 *   - Changes computed from: new diligenceProjections rows today,
 *     new agentActions rows today, new productBlocks today
 *
 * V2 (deferred): schedule daily cron that walks each tracked entity
 * and generates pulse automatically. V1 gives us the surface + data
 * shape so the cron is a later additive change.
 *
 * Invariants (agentic_reliability):
 *   - BOUND: summary capped at ~32KB
 *   - HONEST_STATUS: status enum is {generating | ready | failed}
 *   - DETERMINISTIC: dateKey derived from Date.now() + fixed UTC
 *     day-boundary math so same run on same day dedupes
 *   - Idempotent: a second generate call for the same day returns
 *     the existing row instead of creating a duplicate
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import {
  requireProductIdentity,
  resolveProductIdentitySafely,
} from "./helpers";

const MAX_PULSE_MARKDOWN_BYTES = 32 * 1024;
const MAX_LIST_LIMIT = 50;

/** Derive the UTC dateKey for a given timestamp. Same day = same key. */
function dateKeyFor(tsMs: number): string {
  const d = new Date(tsMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * `generatePulseForEntity` — build or return today's pulse for one
 * entity. Idempotent per (owner, entity, dateKey). V1 body is a
 * short summary derived from the day's changes; a future action
 * can upgrade this to a full agent-authored narrative.
 */
export const generatePulseForEntity = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entitySlug: v.string(),
    /** Optional override date (for backfill). Default: today UTC. */
    atTimestampMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey;
    const now = args.atTimestampMs ?? Date.now();
    const dateKey = dateKeyFor(now);

    // Idempotency: one pulse per (ownerKey, entitySlug, dateKey).
    const existing = await ctx.db
      .query("pulseReports")
      .withIndex("by_owner_entity_date", (q) =>
        q
          .eq("ownerKey", ownerKey)
          .eq("entitySlug", args.entitySlug)
          .eq("dateKey", dateKey),
      )
      .first();
    if (existing) return existing._id;

    // V1 change detection — count recently-updated rows that matter
    // to this entity. Bounded scans via indexes; no cross-user reads.
    const dayMs = 24 * 60 * 60 * 1000;
    const sinceMs = now - dayMs;

    const entity = await ctx.db
      .query("productEntities")
      .withIndex("by_owner_slug", (q) =>
        q.eq("ownerKey", ownerKey).eq("slug", args.entitySlug),
      )
      .first();
    if (!entity) throw new Error("entity not found");

    const recentProjections = await ctx.db
      .query("diligenceProjections")
      .withIndex("by_owner_entity_updated", (q) =>
        q.eq("ownerKey", ownerKey).eq("entityId", entity._id),
      )
      .order("desc")
      .take(200);
    const newProjections = recentProjections.filter(
      (p: any) =>
        (p.producerAssurance === "internal_structuring_v1" ||
          p.producerAssurance === "internal_canonical_v1") &&
        (p.updatedAt ?? p.createdAt ?? 0) >= sinceMs,
    );

    const recentActions = await ctx.db
      .query("agentActions")
      .withIndex("by_owner_time", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .take(200);
    const newActions = recentActions.filter(
      (a: any) => a.entitySlug === args.entitySlug && a.createdAt >= sinceMs,
    );

    const materialChangeCount = newProjections.filter(
      (p: any) =>
        p.overallTier === "verified" || p.overallTier === "corroborated",
    ).length;

    // V1 markdown summary — deterministic from counts + a few headers.
    // V2 can upgrade this with an agent-authored narrative.
    const lines: string[] = [];
    lines.push(`# Pulse — ${args.entitySlug}`);
    lines.push(``);
    lines.push(
      `**${dateKey}** · ${newProjections.length} new finding${newProjections.length === 1 ? "" : "s"} · ${newActions.length} action${newActions.length === 1 ? "" : "s"} · ${materialChangeCount} material`,
    );
    lines.push(``);
    if (newProjections.length === 0 && newActions.length === 0) {
      lines.push(`_No activity in the last 24 hours._`);
    } else {
      if (newProjections.length > 0) {
        lines.push(`## New findings`);
        for (const p of newProjections.slice(0, 12)) {
          const tier = (p as any).overallTier ?? "unverified";
          const header = ((p as any).headerText ?? p.blockType ?? "finding")
            .toString()
            .slice(0, 120);
          lines.push(`- **${p.blockType}** (${tier}) — ${header}`);
        }
      }
      if (newActions.length > 0) {
        lines.push(``);
        lines.push(`## Recent actions`);
        for (const a of newActions.slice(0, 8)) {
          lines.push(`- ${(a as any).summary?.slice(0, 140) ?? a.kind}`);
        }
      }
    }
    const summaryMarkdown = lines.join("\n").slice(0, MAX_PULSE_MARKDOWN_BYTES);

    const insertedId = await ctx.db.insert("pulseReports", {
      ownerKey,
      userId: (identity.rawUserId ?? undefined) as any,
      entitySlug: args.entitySlug,
      dateKey,
      status: "ready",
      summaryMarkdown,
      changeCount: newProjections.length + newActions.length,
      materialChangeCount,
      generatedAt: now,
    });
    return insertedId;
  },
});

/**
 * `getPulseForEntity` — today's (or a specific day's) pulse for an
 * entity. Returns null if not yet generated.
 */
export const getPulseForEntity = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entitySlug: v.string(),
    dateKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await resolveProductIdentitySafely(
      ctx,
      args.anonymousSessionId,
    );
    if (!identity.ownerKey) return null;
    const ownerKey = identity.ownerKey;
    const key = args.dateKey ?? dateKeyFor(Date.now());
    const row = await ctx.db
      .query("pulseReports")
      .withIndex("by_owner_entity_date", (q) =>
        q
          .eq("ownerKey", ownerKey)
          .eq("entitySlug", args.entitySlug)
          .eq("dateKey", key),
      )
      .first();
    return row ?? null;
  },
});

/**
 * `listPulsesForEntity` — historical pulse rows for an entity, most
 * recent first. Used for the scrub-back picker on the pulse page.
 */
export const listPulsesForEntity = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entitySlug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await resolveProductIdentitySafely(
      ctx,
      args.anonymousSessionId,
    );
    if (!identity.ownerKey) return [];
    const ownerKey = identity.ownerKey;
    const limit = Math.min(args.limit ?? 14, MAX_LIST_LIMIT);
    const rows = await ctx.db
      .query("pulseReports")
      .withIndex("by_owner_entity_date", (q) =>
        q.eq("ownerKey", ownerKey).eq("entitySlug", args.entitySlug),
      )
      .order("desc")
      .take(limit);
    return rows;
  },
});

/**
 * `listRecentPulsesForOwner` — cross-entity feed for the /pulse
 * route. Supports the "here's what's new on everything you watch"
 * view.
 */
export const listRecentPulsesForOwner = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await resolveProductIdentitySafely(
      ctx,
      args.anonymousSessionId,
    );
    if (!identity.ownerKey) return [];
    const ownerKey = identity.ownerKey;
    const limit = Math.min(args.limit ?? 25, MAX_LIST_LIMIT);
    const rows = await ctx.db
      .query("pulseReports")
      .withIndex("by_owner_date", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .take(limit);
    return rows;
  },
});

/**
 * `unreadPulseCount` — drives the nav badge that tells users
 * "there's new pulse activity you haven't seen." Counts pulses
 * without `readAt`.
 */
export const unreadPulseCount = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await resolveProductIdentitySafely(
      ctx,
      args.anonymousSessionId,
    );
    if (!identity.ownerKey) return 0;
    const ownerKey = identity.ownerKey;
    const rows = await ctx.db
      .query("pulseReports")
      .withIndex("by_unread", (q) => q.eq("ownerKey", ownerKey))
      .take(100);
    return rows.filter((r) => r.readAt == null && r.changeCount > 0).length;
  },
});

/** Mark a pulse as read (dismiss the unread badge). */
export const markPulseRead = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    pulseId: v.id("pulseReports"),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey;
    const row = await ctx.db.get(args.pulseId);
    if (!row || row.ownerKey !== ownerKey) return null;
    if (row.readAt) return row._id;
    await ctx.db.patch(args.pulseId, { readAt: Date.now() });
    return row._id;
  },
});
