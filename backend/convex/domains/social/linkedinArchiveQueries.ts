/**
 * LinkedIn Post Archive Queries
 *
 * Unified queries for browsing all LinkedIn posts across all post types.
 * Reads from the linkedinPostArchive table and also provides backfill
 * from the 5 specialized tables + digestCache for historical data.
 */

import { v } from "convex/values";
import { query, internalQuery } from "../../_generated/server";

function getDedupeKey(post: {
  dateString: string;
  persona: string;
  postType: string;
  content: string;
  postId?: string;
  metadata?: any;
}): string {
  const postId = typeof post.postId === "string" ? post.postId.trim() : "";
  if (postId) return `postId|${postId}`;
  const meta: any = post.metadata;
  const part = typeof meta?.part === "number" ? meta.part : "";
  return `${post.dateString}|${post.persona}|${post.postType}|${part}|${post.content}`;
}

function dedupeArchivePosts<T extends {
  dateString: string;
  persona: string;
  postType: string;
  content: string;
  postId?: string;
  metadata?: any;
}>(
  posts: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of posts) {
    const key = getDedupeKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * Get archived posts with optional filtering by type and date range.
 * Returns posts in reverse chronological order.
 */
export const getArchivedPosts = query({
  args: {
    postType: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    dedupe: v.optional(v.boolean()),
  },
  returns: v.object({
    posts: v.array(v.object({
      _id: v.id("linkedinPostArchive"),
      dateString: v.string(),
      persona: v.string(),
      postType: v.string(),
      content: v.string(),
      postId: v.optional(v.string()),
      postUrl: v.optional(v.string()),
      factCheckCount: v.optional(v.number()),
      metadata: v.optional(v.any()),
      postedAt: v.number(),
    })),
    nextCursor: v.optional(v.string()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const limit = args.limit || 50;
    const dedupe = args.dedupe ?? true;
    const cursor = typeof args.cursor === "string" ? args.cursor : null;

    let postsQuery;
    if (args.postType) {
      postsQuery = ctx.db
        .query("linkedinPostArchive")
        .withIndex("by_type", (q) => q.eq("postType", args.postType!))
        .order("desc");
    } else {
      postsQuery = ctx.db
        .query("linkedinPostArchive")
        .withIndex("by_postedAt")
        .order("desc");
    }

    // If deduping, over-fetch to preserve a stable page size after removing dupes.
    const fetchSize = dedupe ? Math.min(limit * 3, 500) : limit;
    const page = await postsQuery.paginate({ cursor, numItems: fetchSize });
    const maybeDeduped = dedupe ? dedupeArchivePosts(page.page) : page.page;
    const resultPosts = maybeDeduped.slice(0, limit);

    return {
      posts: resultPosts.map((p) => ({
        _id: p._id,
        dateString: p.dateString,
        persona: p.persona,
        postType: p.postType,
        content: p.content,
        postId: p.postId,
        postUrl: p.postUrl,
        factCheckCount: p.factCheckCount,
        metadata: p.metadata,
        postedAt: p.postedAt,
      })),
      nextCursor: page.isDone ? undefined : page.continueCursor,
      hasMore: !page.isDone,
    };
  },
});

/**
 * Get archive stats - counts by type and recent activity summary.
 */
export const getArchiveStats = query({
  args: {
    dedupe: v.optional(v.boolean()),
  },
  returns: v.object({
    totalPosts: v.number(),
    byType: v.array(v.object({
      postType: v.string(),
      count: v.number(),
    })),
    recentDates: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const dedupe = args.dedupe ?? true;
    const allPosts = await ctx.db
      .query("linkedinPostArchive")
      .withIndex("by_postedAt")
      .order("desc")
      .take(500);

    const posts = dedupe ? dedupeArchivePosts(allPosts) : allPosts;

    // Count by type
    const typeCounts = new Map<string, number>();
    const dateSet = new Set<string>();

    for (const post of posts) {
      typeCounts.set(post.postType, (typeCounts.get(post.postType) || 0) + 1);
      dateSet.add(post.dateString);
    }

    const byType = Array.from(typeCounts.entries())
      .map(([postType, count]) => ({ postType, count }))
      .sort((a, b) => b.count - a.count);

    const recentDates = Array.from(dateSet).sort().reverse().slice(0, 14);

    return {
      totalPosts: posts.length,
      byType,
      recentDates,
    };
  },
});

/**
 * Get posts for a specific date, grouped by type.
 */
export const getPostsByDate = query({
  args: {
    dateString: v.string(),
    dedupe: v.optional(v.boolean()),
  },
  returns: v.array(v.object({
    _id: v.id("linkedinPostArchive"),
    dateString: v.string(),
    persona: v.string(),
    postType: v.string(),
    content: v.string(),
    postId: v.optional(v.string()),
    postUrl: v.optional(v.string()),
    factCheckCount: v.optional(v.number()),
    metadata: v.optional(v.any()),
    postedAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const dedupe = args.dedupe ?? true;
    const posts = await ctx.db
      .query("linkedinPostArchive")
      .withIndex("by_date", (q) => q.eq("dateString", args.dateString))
      .order("desc")
      .collect();

    const maybeDeduped = dedupe ? dedupeArchivePosts(posts) : posts;

    return maybeDeduped.map((p) => ({
      _id: p._id,
      dateString: p.dateString,
      persona: p.persona,
      postType: p.postType,
      content: p.content,
      postId: p.postId,
      postUrl: p.postUrl,
      factCheckCount: p.factCheckCount,
      metadata: p.metadata,
      postedAt: p.postedAt,
    }));
  },
});

/**
 * Get recent posts for pre-post verification (variety check).
 * Returns posts from the last N days for topic overlap detection.
 */
export const getRecentPostsForVerification = internalQuery({
  args: { lookbackDays: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.lookbackDays * 24 * 60 * 60 * 1000;
    const posts = await ctx.db
      .query("linkedinPostArchive")
      .withIndex("by_postedAt")
      .order("desc")
      .take(50);

    // Filter in code since Convex index predicates don't support gte on ordered queries
    return posts
      .filter((p) => p.postedAt >= cutoff)
      .map((p) => ({
        _id: p._id,
        dateString: p.dateString,
        persona: p.persona,
        postType: p.postType,
        content: p.content,
        postedAt: p.postedAt,
      }));
  },
});

/**
 * Internal query for the funding-tracker backfill: returns all
 * `funding_tracker` rows so the action can detect broken posts
 * (containing "0 sources" or placeholder strings) and rewrite content
 * + structured metadata against the current pipeline.
 */
export const getAllFundingTrackerPostsForBackfill = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("linkedinPostArchive"),
      dateString: v.string(),
      persona: v.string(),
      postType: v.string(),
      content: v.string(),
      postedAt: v.number(),
      metadata: v.optional(v.any()),
    }),
  ),
  handler: async (ctx) => {
    const posts = await ctx.db
      .query("linkedinPostArchive")
      .withIndex("by_type", (q) => q.eq("postType", "funding_tracker"))
      .order("desc")
      .take(500);
    return posts.map((p) => ({
      _id: p._id,
      dateString: p.dateString,
      persona: p.persona,
      postType: p.postType,
      content: p.content,
      postedAt: p.postedAt,
      metadata: p.metadata,
    }));
  },
});
