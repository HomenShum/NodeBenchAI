/**
 * Narrative Posts Queries
 *
 * Query operations for narrativePosts table.
 * Supports the "internal X/Reddit" pattern for viewing posts, replies, and disputes.
 */

import { v } from "convex/values";
import { query, internalQuery } from "../../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc, Id } from "../../../../_generated/dataModel";

/**
 * Post type filter validator
 */
const postTypeValidator = v.union(
  v.literal("delta_update"),
  v.literal("thesis_revision"),
  v.literal("evidence_addition"),
  v.literal("counterpoint"),
  v.literal("question"),
  v.literal("correction")
);

// ============================================================================
// PUBLIC QUERIES (User-facing)
// ============================================================================

/**
 * Get posts for a thread (main timeline view)
 */
export const getThreadPosts = query({
  args: {
    threadId: v.id("narrativeThreads"),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    postType: v.optional(postTypeValidator),
    includeReplies: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Verify thread exists and user has access
    const thread = await ctx.db.get(args.threadId);
    if (!thread) return [];

    const userId = await getAuthUserId(ctx);

    // Check access for private threads
    if (!thread.isPublic && thread.userId !== userId) {
      return [];
    }

    // Get top-level posts (no parent)
    let postsQuery = ctx.db
      .query("narrativePosts")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("desc");

    const allPosts = await postsQuery.take(args.limit || 50);

    // Filter to top-level only if not including replies
    const topLevelPosts = args.includeReplies
      ? allPosts
      : allPosts.filter((p) => !p.parentPostId);

    // Filter by type if specified
    const filteredPosts = args.postType
      ? topLevelPosts.filter((p) => p.postType === args.postType)
      : topLevelPosts;

    // Apply offset
    const offsetPosts = args.offset
      ? filteredPosts.slice(args.offset)
      : filteredPosts;

    return offsetPosts;
  },
});

/**
 * Get a single post by ID
 */
export const getPost = query({
  args: {
    postId: v.id("narrativePosts"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.postId);
  },
});

/**
 * Get replies to a post (threaded view)
 */
export const getPostReplies = query({
  args: {
    parentPostId: v.id("narrativePosts"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const replies = await ctx.db
      .query("narrativePosts")
      .withIndex("by_parent", (q) => q.eq("parentPostId", args.parentPostId))
      .order("asc")
      .take(args.limit || 100);

    return replies;
  },
});

/**
 * Get post with its full reply tree (recursive)
 */
export const getPostWithReplies = query({
  args: {
    postId: v.id("narrativePosts"),
    maxDepth: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) return null;

    const maxDepth = args.maxDepth || 3;

    async function fetchReplies(parentId: Id<"narrativePosts">, depth: number): Promise<any[]> {
      if (depth >= maxDepth) return [];

      const replies = await ctx.db
        .query("narrativePosts")
        .withIndex("by_parent", (q) => q.eq("parentPostId", parentId))
        .order("asc")
        .take(50);

      return Promise.all(
        replies.map(async (reply) => ({
          ...reply,
          replies: await fetchReplies(reply._id, depth + 1),
        }))
      );
    }

    return {
      ...post,
      replies: await fetchReplies(args.postId, 0),
    };
  },
});

/**
 * Get posts that need adjudication (for moderation dashboard)
 */
export const getPostsNeedingAdjudication = query({
  args: {
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

    // Get posts needing adjudication
    const posts = await ctx.db
      .query("narrativePosts")
      .withIndex("by_adjudication", (q) => q.eq("requiresAdjudication", true))
      .order("desc")
      .take(args.limit || 50);

    // Filter to user's threads
    return posts.filter((p) => threadIds.has(p.threadId));
  },
});

/**
 * Get posts with contradictions
 */
export const getContradictoryPosts = query({
  args: {
    threadId: v.optional(v.id("narrativeThreads")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    if (args.threadId) {
      // Get contradictory posts for specific thread
      const posts = await ctx.db
        .query("narrativePosts")
        .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
        .order("desc")
        .take(200);

      return posts
        .filter((p) => p.hasContradictions)
        .slice(0, args.limit || 20);
    }

    // Get all user's threads
    const userThreads = await ctx.db
      .query("narrativeThreads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const threadIds = new Set(userThreads.map((t) => t._id));

    // Scan for contradictory posts (could be optimized with dedicated index)
    const allPosts = await ctx.db
      .query("narrativePosts")
      .order("desc")
      .take(500);

    return allPosts
      .filter((p) => p.hasContradictions && threadIds.has(p.threadId))
      .slice(0, args.limit || 20);
  },
});

/**
 * Get post version history (supersession chain)
 */
export const getPostVersionHistory = query({
  args: {
    postId: v.id("narrativePosts"),
  },
  handler: async (ctx, args) => {
    const currentPost = await ctx.db.get(args.postId);
    if (!currentPost) return [];

    const history: Doc<"narrativePosts">[] = [currentPost];

    // Walk back through supersedes chain
    let currentId = currentPost.supersedes;
    while (currentId) {
      const prevPost = await ctx.db.get(currentId);
      if (!prevPost) break;
      history.push(prevPost);
      currentId = prevPost.supersedes;
    }

    // Walk forward through supersededBy chain
    currentId = currentPost.supersededBy;
    const forward: Doc<"narrativePosts">[] = [];
    while (currentId) {
      const nextPost = await ctx.db.get(currentId);
      if (!nextPost) break;
      forward.unshift(nextPost);
      currentId = nextPost.supersededBy;
    }

    return [...forward, ...history];
  },
});

/**
 * Get recent posts by author type (agent vs human)
 */
export const getPostsByAuthorType = query({
  args: {
    authorType: v.union(v.literal("agent"), v.literal("human")),
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

    const posts = await ctx.db
      .query("narrativePosts")
      .withIndex("by_author", (q) => q.eq("authorType", args.authorType))
      .order("desc")
      .take(200);

    return posts
      .filter((p) => threadIds.has(p.threadId))
      .slice(0, args.limit || 50);
  },
});

/**
 * Get thesis revision history for a thread
 */
export const getThesisRevisions = query({
  args: {
    threadId: v.id("narrativeThreads"),
  },
  handler: async (ctx, args) => {
    const revisions = await ctx.db
      .query("narrativePosts")
      .withIndex("by_type", (q) => q.eq("postType", "thesis_revision"))
      .order("asc")
      .take(100);

    return revisions.filter((r) => r.threadId === args.threadId);
  },
});

// ============================================================================
// INTERNAL QUERIES (Agent-facing)
// ============================================================================

/**
 * Get thread context for Thread Curator agent
 */
export const getThreadContextInternal = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) return null;

    // Get recent posts
    const recentPosts = await ctx.db
      .query("narrativePosts")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(20);

    // Get thesis revisions
    const thesisRevisions = recentPosts.filter(
      (p) => p.postType === "thesis_revision"
    );

    // Get open disputes
    const disputes = await ctx.db
      .query("narrativeDisputeChains")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("desc")
      .take(100);

    const threadDisputes = disputes.filter(
      (d) => d.targetType === "post" && recentPosts.some((p) => p._id === d.targetId)
    );

    return {
      thread,
      recentPosts,
      thesisRevisions,
      openDisputes: threadDisputes,
      stats: {
        totalPosts: recentPosts.length,
        agentPosts: recentPosts.filter((p) => p.authorType === "agent").length,
        humanPosts: recentPosts.filter((p) => p.authorType === "human").length,
        needsAdjudication: recentPosts.filter((p) => p.requiresAdjudication).length,
      },
    };
  },
});

/**
 * Get posts for semantic deduplication check
 */
export const getRecentPostsForDedup = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
    lookbackHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - (args.lookbackHours || 24) * 60 * 60 * 1000;

    const recentPosts = await ctx.db
      .query("narrativePosts")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(50);

    return recentPosts.filter((p) => p.createdAt >= cutoff);
  },
});

/**
 * Get all posts for a thread (for contradiction detection)
 */
export const getAllThreadPostsInternal = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("narrativePosts")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .collect();
  },
});

/**
 * Get post by stable postId (for external references)
 */
export const getPostByStableId = internalQuery({
  args: {
    postId: v.string(),
  },
  handler: async (ctx, args) => {
    // Would need a separate index for this in production
    const posts = await ctx.db
      .query("narrativePosts")
      .order("desc")
      .take(1000);

    return posts.find((p) => p.postId === args.postId) || null;
  },
});
