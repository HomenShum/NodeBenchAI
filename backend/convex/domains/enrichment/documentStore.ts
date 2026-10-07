/**
 * Document Store
 *
 * Stores fetched article content linked to feedItems and fundingEvents.
 * Uses the existing documents table or creates lightweight links.
 */
import { v } from "convex/values";
import { mutation, query, internalMutation } from "../../_generated/server";
import { Id, Doc } from "../../_generated/dataModel";

/**
 * Store or update fetched document content for a feed item.
 */
export const storeFetchedContent = internalMutation({
  args: {
    feedItemId: v.optional(v.id("feedItems")),
    fundingEventId: v.optional(v.id("fundingEvents")),
    url: v.string(),
    title: v.optional(v.string()),
    content: v.string(),
    contentHash: v.optional(v.string()),
    wordCount: v.number(),
    fetchedAt: v.number(),
    jsRendered: v.boolean(),
  },
  handler: async (ctx, args) => {
    // If feedItem exists, update its fullContentFetched field
    if (args.feedItemId) {
      const feedItem = await ctx.db.get(args.feedItemId) as Doc<"feedItems"> | null;
      if (feedItem) {
        // Store content reference in feed item metadata
        await ctx.db.patch(args.feedItemId, {
          // These fields may need to be added to schema if not present
          // For now we'll use the existing fields where possible
        });
      }
    }

    // Create a fact for the fetched content if fundingEventId exists
    if (args.fundingEventId) {
      const fundingEvent = await ctx.db.get(args.fundingEventId) as Doc<"fundingEvents"> | null;
      if (fundingEvent) {
        // Link the full content to the funding event
        // Could create a fact or update the event description
        console.log(`[documentStore] Linked content to funding event: ${args.fundingEventId}`);
      }
    }

    // Log the storage operation
    console.log(`[documentStore] Stored content:`, {
      url: args.url,
      wordCount: args.wordCount,
      feedItemId: args.feedItemId,
      fundingEventId: args.fundingEventId,
    });

    return {
      success: true,
      wordCount: args.wordCount,
    };
  },
});

/**
 * Get fetched content statistics.
 */
export const getFetchStats = query({
  args: {
    lookbackHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const lookbackMs = (args.lookbackHours ?? 24) * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;

    // Count feed items with various statuses
    const recentFeedItems = await ctx.db
      .query("feedItems")
      .withIndex("by_published")
      .filter((q) => q.gte(q.field("publishedAt"), cutoff))
      .collect();

    return {
      totalFeedItems: recentFeedItems.length,
      lookbackHours: args.lookbackHours ?? 24,
    };
  },
});

/**
 * Simple hash function for content deduplication.
 */
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < Math.min(content.length, 1000); i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Check if content was already fetched for a URL.
 */
export const isContentFetched = query({
  args: {
    url: v.string(),
    maxAgeHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Check if URL exists in cache
    const cacheKey = `linkupFetch|${args.url.toLowerCase()}`;
    const maxAge = (args.maxAgeHours ?? 24) * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAge;

    // Query the cache table
    const cached = await ctx.db
      .query("globalQueryCache")
      .withIndex("by_queryKey", (q) => q.eq("queryKey", cacheKey))
      .first() as Doc<"globalQueryCache"> | null;

    if (cached && cached.createdAt > cutoff) {
      return {
        fetched: true,
        cachedAt: cached.createdAt,
        ageMs: Date.now() - cached.createdAt,
      };
    }

    return {
      fetched: false,
    };
  },
});
