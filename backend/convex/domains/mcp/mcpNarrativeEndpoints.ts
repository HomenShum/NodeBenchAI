/**
 * MCP-safe narrative endpoints.
 * Internal query variants that accept explicit userId for MCP gateway dispatch.
 * Source logic from: narrative/queries/posts.ts, narrative/queries/disputes.ts
 */

import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";

/**
 * Get posts for a thread — accepts explicit userId for private thread access.
 * Source: narrative/queries/posts.ts:32-76
 */
export const mcpGetThreadPosts = internalQuery({
  args: {
    userId: v.string(),
    threadId: v.id("narrativeThreads"),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    postType: v.optional(v.string()),
    includeReplies: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) return [];

    // Check access for private threads
    if (!thread.isPublic && thread.userId !== args.userId) {
      return [];
    }

    const allPosts = await ctx.db
      .query("narrativePosts")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(args.limit || 50);

    const topLevelPosts = args.includeReplies
      ? allPosts
      : allPosts.filter((p) => !p.parentPostId);

    const filteredPosts = args.postType
      ? topLevelPosts.filter((p) => p.postType === args.postType)
      : topLevelPosts;

    return args.offset ? filteredPosts.slice(args.offset) : filteredPosts;
  },
});

/**
 * Get open disputes — accepts explicit userId to bypass auth gate.
 * Source: narrative/queries/disputes.ts:54-67
 */
export const mcpGetOpenDisputes = internalQuery({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("narrativeDisputeChains")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("desc")
      .take(args.limit || 50);
  },
});

/**
 * Get contradictory posts — accepts explicit userId for user thread filtering.
 * Source: narrative/queries/posts.ts:182-221
 */
export const mcpGetContradictoryPosts = internalQuery({
  args: {
    userId: v.string(),
    threadId: v.optional(v.id("narrativeThreads")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.threadId) {
      const posts = await ctx.db
        .query("narrativePosts")
        .withIndex("by_thread", (q) => q.eq("threadId", args.threadId!))
        .order("desc")
        .take(200);

      return posts
        .filter((p) => p.hasContradictions)
        .slice(0, args.limit || 20);
    }

    // Get user's threads
    const userThreads = await ctx.db
      .query("narrativeThreads")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const threadIds = new Set(userThreads.map((t) => t._id));

    const allPosts = await ctx.db
      .query("narrativePosts")
      .order("desc")
      .take(500);

    return allPosts
      .filter((p) => p.hasContradictions && threadIds.has(p.threadId))
      .slice(0, args.limit || 20);
  },
});
