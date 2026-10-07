import { v } from "convex/values";
import { internalMutation, mutation, query } from "../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

function utcDayString(ms = Date.now()): string {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const kindValidator = v.union(
  v.literal("signal"),
  v.literal("funding"),
  v.literal("brief"),
  v.literal("note"),
  v.literal("system"),
);

/**
 * Public read: list entries for a day, newest first.
 * Intended for the public `#signals` route.
 */
export const listPublic = query({
  args: {
    day: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("landingPageLog"),
      day: v.string(),
      kind: kindValidator,
      title: v.string(),
      markdown: v.string(),
      source: v.optional(v.string()),
      url: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      agentThreadId: v.optional(v.string()),
      meta: v.optional(v.any()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const day = args.day ?? utcDayString();
    const limit = args.limit && args.limit > 0 ? Math.min(args.limit, 500) : 200;

    const rows = await ctx.db
      .query("landingPageLog")
      .withIndex("by_day_createdAt", (q) => q.eq("day", day))
      .order("desc")
      .take(limit);

    // Public view strips user identifiers.
    return rows.map((r) => ({
      _id: r._id,
      day: r.day,
      kind: r.kind,
      title: r.title,
      markdown: r.markdown,
      source: r.source,
      url: r.url,
      tags: r.tags,
      agentThreadId: r.agentThreadId,
      meta: r.meta,
      createdAt: r.createdAt,
    }));
  },
});

/**
 * Authenticated append.
 */
export const appendFromUser = mutation({
  args: {
    day: v.optional(v.string()),
    kind: kindValidator,
    title: v.string(),
    markdown: v.string(),
    source: v.optional(v.string()),
    url: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    agentThreadId: v.optional(v.string()),
    meta: v.optional(v.any()),
  },
  returns: v.id("landingPageLog"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const now = Date.now();
    const id = await ctx.db.insert("landingPageLog", {
      day: args.day ?? utcDayString(now),
      kind: args.kind,
      title: args.title,
      markdown: args.markdown,
      source: args.source,
      url: args.url,
      tags: args.tags,
      userId,
      anonymousSessionId: undefined,
      agentThreadId: args.agentThreadId,
      meta: args.meta,
      createdAt: now,
    });
    return id;
  },
});

/**
 * Anonymous append (rate-limited by anonymousSessionId + day).
 */
export const appendFromAnonymous = mutation({
  args: {
    anonymousSessionId: v.string(),
    day: v.optional(v.string()),
    kind: kindValidator,
    title: v.string(),
    markdown: v.string(),
    source: v.optional(v.string()),
    url: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    agentThreadId: v.optional(v.string()),
    meta: v.optional(v.any()),
  },
  returns: v.id("landingPageLog"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const day = args.day ?? utcDayString(now);

    // Simple durable rate limit: max N entries per anon session per day.
    const limitPerDay = 50;
    const existing = await ctx.db
      .query("landingPageLog")
      .withIndex("by_anon_day_createdAt", (q) =>
        q.eq("anonymousSessionId", args.anonymousSessionId).eq("day", day),
      )
      .take(limitPerDay + 1);
    if (existing.length > limitPerDay) {
      throw new Error("Anonymous rate limit exceeded");
    }

    const id = await ctx.db.insert("landingPageLog", {
      day,
      kind: args.kind,
      title: args.title,
      markdown: args.markdown,
      source: args.source,
      url: args.url,
      tags: args.tags,
      userId: undefined,
      anonymousSessionId: args.anonymousSessionId,
      agentThreadId: args.agentThreadId,
      meta: args.meta,
      createdAt: now,
    });
    return id;
  },
});

/**
 * System append for crons/workflows (no auth).
 */
export const appendSystem = internalMutation({
  args: {
    day: v.optional(v.string()),
    kind: kindValidator,
    title: v.string(),
    markdown: v.string(),
    source: v.optional(v.string()),
    url: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    agentThreadId: v.optional(v.string()),
    meta: v.optional(v.any()),
  },
  returns: v.id("landingPageLog"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("landingPageLog", {
      day: args.day ?? utcDayString(now),
      kind: args.kind,
      title: args.title,
      markdown: args.markdown,
      source: args.source,
      url: args.url,
      tags: args.tags,
      userId: undefined,
      anonymousSessionId: undefined,
      agentThreadId: args.agentThreadId,
      meta: args.meta,
      createdAt: now,
    });
    return id;
  },
});
