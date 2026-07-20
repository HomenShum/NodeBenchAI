/**
 * Narrative Thread Queries
 *
 * Query operations for narrativeThreads table.
 */

import { v } from "convex/values";
import { query, internalQuery } from "../../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Get all threads for the current user
 */
export const getMyThreads = query({
  args: {
    limit: v.optional(v.number()),
    phase: v.optional(
      v.union(
        v.literal("emerging"),
        v.literal("escalating"),
        v.literal("climax"),
        v.literal("resolution"),
        v.literal("dormant")
      )
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    let threadsQuery = ctx.db
      .query("narrativeThreads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc");

    const threads = await threadsQuery.take(args.limit || 50);

    // Filter by phase if specified
    if (args.phase) {
      return threads.filter((t) => t.currentPhase === args.phase);
    }

    return threads;
  },
});

/**
 * Get public threads for discovery
 */
export const getPublicThreads = query({
  args: {
    limit: v.optional(v.number()),
    phase: v.optional(
      v.union(
        v.literal("emerging"),
        v.literal("escalating"),
        v.literal("climax"),
        v.literal("resolution"),
        v.literal("dormant")
      )
    ),
  },
  handler: async (ctx, args) => {
    let threadsQuery = ctx.db
      .query("narrativeThreads")
      .withIndex("by_public", (q) => q.eq("isPublic", true))
      .order("desc");

    const threads = await threadsQuery.take(args.limit || 50);

    if (args.phase) {
      return threads.filter((t) => t.currentPhase === args.phase);
    }

    return threads;
  },
});

/**
 * Get a thread by ID
 */
export const getThread = query({
  args: {
    threadId: v.id("narrativeThreads"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.threadId);
  },
});

/**
 * Get a thread by slug
 */
export const getThreadBySlug = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("narrativeThreads")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
  },
});

/**
 * Get threads for an entity
 */
export const getThreadsByEntity = query({
  args: {
    entityKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Note: This requires scanning since entityKeys is an array
    // For production, consider a separate index table
    const allThreads = await ctx.db
      .query("narrativeThreads")
      .order("desc")
      .take(200);

    const matchingThreads = allThreads.filter((t) =>
      t.entityKeys.includes(args.entityKey)
    );

    return matchingThreads.slice(0, args.limit || 20);
  },
});

/**
 * Internal: Get threads by entity for agent use
 */
export const getThreadsByEntityInternal = internalQuery({
  args: {
    entityKey: v.string(),
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userThreads = await ctx.db
      .query("narrativeThreads")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(100);

    const matchingThreads = userThreads.filter((t) =>
      t.entityKeys.includes(args.entityKey)
    );

    return matchingThreads.slice(0, args.limit || 10);
  },
});

/**
 * Get threads with their events (for timeline display)
 */
export const getThreadsWithEvents = query({
  args: {
    entityKeys: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Get user's threads
    const threads = await ctx.db
      .query("narrativeThreads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(args.limit || 20);

    // Filter by entity keys if specified
    const filteredThreads = args.entityKeys
      ? threads.filter((t) =>
          t.entityKeys.some((ek) => args.entityKeys!.includes(ek))
        )
      : threads;

    // Enrich with events and sentiment
    const enrichedThreads = await Promise.all(
      filteredThreads.map(async (thread) => {
        const events = await ctx.db
          .query("narrativeEvents")
          .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
          .order("desc")
          .take(50);

        const sentiment = await ctx.db
          .query("narrativeSentiment")
          .withIndex("by_thread_week", (q) => q.eq("threadId", thread._id))
          .order("desc")
          .take(12);

        return {
          ...thread,
          events,
          sentiment,
        };
      })
    );

    return enrichedThreads;
  },
});

/**
 * Search threads by name
 */
export const searchThreads = query({
  args: {
    searchQuery: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!args.searchQuery.trim()) return [];

    const results = await ctx.db
      .query("narrativeThreads")
      .withSearchIndex("search_name", (q) =>
        q.search("name", args.searchQuery)
      )
      .take(args.limit || 20);

    return results;
  },
});

/**
 * Get thread statistics for dashboard
 */
export const getThreadStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        total: 0,
        byPhase: {},
        recentActivity: 0,
        plotTwists: 0,
      };
    }

    const threads = await ctx.db
      .query("narrativeThreads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const byPhase: Record<string, number> = {};
    let recentActivity = 0;
    let plotTwists = 0;

    for (const thread of threads) {
      byPhase[thread.currentPhase] = (byPhase[thread.currentPhase] || 0) + 1;
      if (thread.latestEventAt > oneWeekAgo) {
        recentActivity++;
      }
      plotTwists += thread.plotTwistCount;
    }

    return {
      total: threads.length,
      byPhase,
      recentActivity,
      plotTwists,
    };
  },
});
