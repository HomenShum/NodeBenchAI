/**
 * Narrative Event Queries
 *
 * Query operations for narrativeEvents table.
 */

import { v } from "convex/values";
import { query, internalQuery } from "../../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Get events for a thread
 */
export const getEventsByThread = query({
  args: {
    threadId: v.id("narrativeThreads"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("narrativeEvents")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(args.limit || 50);
  },
});

/**
 * Get events by week
 */
export const getEventsByWeek = query({
  args: {
    weekNumber: v.string(),
    significance: v.optional(
      v.union(
        v.literal("minor"),
        v.literal("moderate"),
        v.literal("major"),
        v.literal("plot_twist")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Get user's threads first
    const userThreads = await ctx.db
      .query("narrativeThreads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const threadIds = new Set(userThreads.map((t) => t._id));

    // Query events by week
    let eventsQuery = ctx.db
      .query("narrativeEvents")
      .withIndex("by_week", (q) => q.eq("weekNumber", args.weekNumber));

    if (args.significance) {
      eventsQuery = eventsQuery.filter((q) =>
        q.eq(q.field("significance"), args.significance)
      );
    }

    const events = await eventsQuery.take(args.limit || 100);

    // Filter to user's threads
    return events.filter((e) => threadIds.has(e.threadId));
  },
});

/**
 * Get recent events across all user's threads
 */
export const getRecentEvents = query({
  args: {
    limit: v.optional(v.number()),
    minSignificance: v.optional(
      v.union(
        v.literal("minor"),
        v.literal("moderate"),
        v.literal("major"),
        v.literal("plot_twist")
      )
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Get user's threads
    const userThreads = await ctx.db
      .query("narrativeThreads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const threadIds = new Set(userThreads.map((t) => t._id));

    // Get recent events by discovery time
    const events = await ctx.db
      .query("narrativeEvents")
      .withIndex("by_discovery")
      .order("desc")
      .take(200);

    // Filter to user's threads and significance
    const significanceLevels = ["minor", "moderate", "major", "plot_twist"];
    const minLevel = args.minSignificance
      ? significanceLevels.indexOf(args.minSignificance)
      : 0;

    const filtered = events.filter((e) => {
      if (!threadIds.has(e.threadId)) return false;
      const eventLevel = significanceLevels.indexOf(e.significance);
      return eventLevel >= minLevel;
    });

    return filtered.slice(0, args.limit || 50);
  },
});

/**
 * Get plot twists (significant narrative shifts)
 */
export const getPlotTwists = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Get user's threads
    const userThreads = await ctx.db
      .query("narrativeThreads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const threadIds = new Set(userThreads.map((t) => t._id));

    // Query plot twists
    const events = await ctx.db
      .query("narrativeEvents")
      .withIndex("by_significance", (q) => q.eq("significance", "plot_twist"))
      .order("desc")
      .take(100);

    // Filter to user's threads
    const filtered = events.filter((e) => threadIds.has(e.threadId));

    return filtered.slice(0, args.limit || 20);
  },
});

/**
 * Search events by headline
 */
export const searchEvents = query({
  args: {
    searchQuery: v.string(),
    threadId: v.optional(v.id("narrativeThreads")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!args.searchQuery.trim()) return [];

    let searchQuery = ctx.db
      .query("narrativeEvents")
      .withSearchIndex("search_headline", (q) => {
        let search = q.search("headline", args.searchQuery);
        if (args.threadId) {
          search = search.eq("threadId", args.threadId);
        }
        return search;
      });

    return await searchQuery.take(args.limit || 20);
  },
});

/**
 * Get event by ID
 */
export const getEvent = query({
  args: {
    eventId: v.id("narrativeEvents"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.eventId);
  },
});

/**
 * Internal: Get events for timeline grouping
 */
export const getEventsForTimeline = internalQuery({
  args: {
    threadIds: v.array(v.id("narrativeThreads")),
    startWeek: v.string(),
    endWeek: v.string(),
  },
  handler: async (ctx, args) => {
    const allEvents: any[] = [];

    for (const threadId of args.threadIds) {
      const events = await ctx.db
        .query("narrativeEvents")
        .withIndex("by_thread", (q) => q.eq("threadId", threadId))
        .filter((q) =>
          q.and(
            q.gte(q.field("weekNumber"), args.startWeek),
            q.lte(q.field("weekNumber"), args.endWeek)
          )
        )
        .collect();

      allEvents.push(...events);
    }

    // Sort by occurrence time
    allEvents.sort((a, b) => b.occurredAt - a.occurredAt);

    return allEvents;
  },
});

/**
 * Internal: Get events by week (no auth check)
 * Used by correlation detection action.
 */
export const internalGetEventsByWeek = internalQuery({
  args: {
    weekNumber: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("narrativeEvents")
      .withIndex("by_week", (q) => q.eq("weekNumber", args.weekNumber))
      .collect();
  },
});

/**
 * Get event statistics
 */
export const getEventStats = query({
  args: {
    threadId: v.optional(v.id("narrativeThreads")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        total: 0,
        bySignificance: {},
        verified: 0,
        withContradictions: 0,
      };
    }

    let events: any[];

    if (args.threadId) {
      events = await ctx.db
        .query("narrativeEvents")
        .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
        .collect();
    } else {
      // Get all events for user's threads
      const userThreads = await ctx.db
        .query("narrativeThreads")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();

      const threadIds = new Set(userThreads.map((t) => t._id));

      const allEvents = await ctx.db
        .query("narrativeEvents")
        .withIndex("by_discovery")
        .order("desc")
        .take(500);

      events = allEvents.filter((e) => threadIds.has(e.threadId));
    }

    const bySignificance: Record<string, number> = {};
    let verified = 0;
    let withContradictions = 0;

    for (const event of events) {
      bySignificance[event.significance] =
        (bySignificance[event.significance] || 0) + 1;
      if (event.isVerified) verified++;
      if (event.hasContradictions) withContradictions++;
    }

    return {
      total: events.length,
      bySignificance,
      verified,
      withContradictions,
    };
  },
});
