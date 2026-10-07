/**
 * blipQueries.ts - Query operations for blips feed
 *
 * Feed queries with persona lens application at read time.
 */

import { v } from "convex/values";
import { query, internalQuery } from "../../_generated/server";
import { Id, Doc } from "../../_generated/dataModel";

// ============================================================================
// Public Queries
// ============================================================================

/**
 * Get blips feed with optional persona lens
 */
export const getBlipsFeed = query({
  args: {
    personaId: v.optional(v.string()),
    category: v.optional(v.string()),
    wordCount: v.optional(v.union(v.literal(5), v.literal(10), v.literal(20))),
    limit: v.optional(v.number()),
    cursor: v.optional(v.number()),  // publishedAt for pagination
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 50);
    const wordCount = args.wordCount ?? 10;

    // Build query
    let blipsQuery = ctx.db.query("meaningBlips");

    if (args.category) {
      blipsQuery = blipsQuery.withIndex("by_category", (q) =>
        q.eq("category", args.category!)
      );
    } else {
      blipsQuery = blipsQuery.withIndex("by_published");
    }

    // Apply cursor for pagination
    if (args.cursor) {
      blipsQuery = blipsQuery.filter((q) =>
        q.lt(q.field("publishedAt"), args.cursor!)
      );
    }

    const blips = await blipsQuery.order("desc").take(limit + 1);

    // Determine if there are more results
    const hasMore = blips.length > limit;
    const resultBlips = hasMore ? blips.slice(0, limit) : blips;

    // Fetch news items for all blips
    const newsItemIds = [...new Set(resultBlips.map((b) => b.newsItemId))];
    const newsItems: (Doc<"newsItems"> | null)[] = await Promise.all(
      newsItemIds.map((id) => ctx.db.get(id) as Promise<Doc<"newsItems"> | null>)
    );
    const validNewsItems = newsItems.filter((n): n is Doc<"newsItems"> => n !== null);
    const newsItemMap = new Map(validNewsItems.map((n) => [n._id, n]));

    // If persona specified, fetch persona lenses
    let personaLensMap = new Map<string, any>();
    if (args.personaId) {
      const lenses = await Promise.all(
        resultBlips.map((b) =>
          ctx.db
            .query("personaLenses")
            .withIndex("by_blip_persona", (q) =>
              q.eq("blipId", b._id).eq("personaId", args.personaId!)
            )
            .first()
        )
      );
      for (let i = 0; i < resultBlips.length; i++) {
        if (lenses[i]) {
          personaLensMap.set(resultBlips[i]._id, lenses[i]);
        }
      }
    }

    // Build response items
    const items = resultBlips.map((blip) => {
      const newsItem = newsItemMap.get(blip.newsItemId);
      const personaLens = personaLensMap.get(blip._id);

      // Select text based on word count
      let text: string;
      switch (wordCount) {
        case 5:
          text = blip.headline;
          break;
        case 20:
          text = blip.context;
          break;
        case 10:
        default:
          text = blip.summary;
      }

      return {
        blip,
        newsItem,
        personaLens,
        text,
      };
    });

    return {
      items,
      hasMore,
      nextCursor: hasMore ? resultBlips[limit - 1]?.publishedAt : undefined,
    };
  },
});

/**
 * Get trending blips (highest engagement)
 */
export const getTrendingBlips = query({
  args: {
    timeWindow: v.optional(v.union(v.literal("1h"), v.literal("24h"), v.literal("7d"))),
    personaId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 10, 30);
    const timeWindow = args.timeWindow ?? "24h";

    // Calculate time threshold
    const now = Date.now();
    let threshold: number;
    switch (timeWindow) {
      case "1h":
        threshold = now - 60 * 60 * 1000;
        break;
      case "7d":
        threshold = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case "24h":
      default:
        threshold = now - 24 * 60 * 60 * 1000;
    }

    // Get blips by engagement score within time window
    const blips = await ctx.db
      .query("meaningBlips")
      .withIndex("by_relevance")
      .filter((q) => q.gte(q.field("publishedAt"), threshold))
      .order("desc")
      .take(limit);

    // Fetch news items
    const newsItemIds = [...new Set(blips.map((b) => b.newsItemId))];
    const newsItems: (Doc<"newsItems"> | null)[] = await Promise.all(
      newsItemIds.map((id) => ctx.db.get(id) as Promise<Doc<"newsItems"> | null>)
    );
    const validNewsItems = newsItems.filter((n): n is Doc<"newsItems"> => n !== null);
    const newsItemMap = new Map(validNewsItems.map((n) => [n._id, n]));

    // Fetch persona lenses if specified
    let personaLensMap = new Map<string, any>();
    if (args.personaId) {
      const lenses = await Promise.all(
        blips.map((b) =>
          ctx.db
            .query("personaLenses")
            .withIndex("by_blip_persona", (q) =>
              q.eq("blipId", b._id).eq("personaId", args.personaId!)
            )
            .first()
        )
      );
      for (let i = 0; i < blips.length; i++) {
        if (lenses[i]) {
          personaLensMap.set(blips[i]._id, lenses[i]);
        }
      }
    }

    return blips.map((blip) => ({
      blip,
      newsItem: newsItemMap.get(blip.newsItemId),
      personaLens: personaLensMap.get(blip._id),
      text: blip.summary,
    }));
  },
});

/**
 * Get single blip with full verification data (for popover)
 */
export const getBlipWithVerification = query({
  args: {
    blipId: v.id("meaningBlips"),
    personaId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const blip = await ctx.db.get(args.blipId) as Doc<"meaningBlips"> | null;
    if (!blip) return null;

    // Get news item
    const newsItem = await ctx.db.get(blip.newsItemId);

    // Get all claim spans for this news item
    const claims = await ctx.db
      .query("claimSpans")
      .withIndex("by_news_item", (q) => q.eq("newsItemId", blip.newsItemId))
      .collect();

    // Get verifications for all claims
    const verifications = await Promise.all(
      claims
        .filter((c) => c.verificationId)
        .map((c) => ctx.db.get(c.verificationId!))
    );

    // Get persona lens if specified
    let personaLens = null;
    if (args.personaId) {
      personaLens = await ctx.db
        .query("personaLenses")
        .withIndex("by_blip_persona", (q) =>
          q.eq("blipId", args.blipId).eq("personaId", args.personaId!)
        )
        .first();
    }

    return {
      blip,
      newsItem,
      claims,
      verifications: verifications.filter(Boolean),
      personaLens,
    };
  },
});

/**
 * Get blips by category
 */
export const getBlipsByCategory = query({
  args: {
    category: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 50);

    const blips = await ctx.db
      .query("meaningBlips")
      .withIndex("by_category", (q) => q.eq("category", args.category))
      .order("desc")
      .take(limit);

    return blips;
  },
});

/**
 * Get feed stats
 */
export const getFeedStats = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    // Count recent blips
    const recentBlips = await ctx.db
      .query("meaningBlips")
      .withIndex("by_published")
      .filter((q) => q.gte(q.field("publishedAt"), dayAgo))
      .collect();

    // Count by category
    const categoryCount: Record<string, number> = {};
    for (const blip of recentBlips) {
      categoryCount[blip.category] = (categoryCount[blip.category] || 0) + 1;
    }

    // Count verified vs unverified
    const verified = recentBlips.filter(
      (b) => b.verificationSummary.overallConfidence >= 0.7
    ).length;

    return {
      totalLast24h: recentBlips.length,
      byCategory: categoryCount,
      verified,
      unverified: recentBlips.length - verified,
      avgConfidence:
        recentBlips.length > 0
          ? recentBlips.reduce(
              (sum, b) => sum + b.verificationSummary.overallConfidence,
              0
            ) / recentBlips.length
          : 0,
    };
  },
});

// ============================================================================
// Internal Queries
// ============================================================================

/**
 * Get news items pending processing
 */
export const getPendingNewsItems = internalQuery({
  args: {
    status: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    const items = await ctx.db
      .query("newsItems")
      .withIndex("by_status", (q) => q.eq("processingStatus", args.status as any))
      .take(limit);

    return items;
  },
});

/**
 * Get claims for a news item
 */
export const getClaimsForNewsItem = internalQuery({
  args: {
    newsItemId: v.id("newsItems"),
  },
  handler: async (ctx, args) => {
    const claims = await ctx.db
      .query("claimSpans")
      .withIndex("by_news_item", (q) => q.eq("newsItemId", args.newsItemId))
      .collect();

    return claims;
  },
});

/**
 * Get unverified claims
 */
export const getUnverifiedClaims = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    const claims = await ctx.db
      .query("claimSpans")
      .withIndex("by_verification", (q) => q.eq("verificationStatus", "unverified"))
      .take(limit);

    return claims;
  },
});

/**
 * Get blip by news item
 */
export const getBlipForNewsItem = internalQuery({
  args: {
    newsItemId: v.id("newsItems"),
  },
  handler: async (ctx, args) => {
    const blip = await ctx.db
      .query("meaningBlips")
      .withIndex("by_news_item", (q) => q.eq("newsItemId", args.newsItemId))
      .first();

    return blip;
  },
});

/**
 * Get news item by source ID
 */
export const getNewsItemBySourceId = internalQuery({
  args: {
    sourceId: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("newsItems")
      .withIndex("by_source_id", (q) => q.eq("sourceId", args.sourceId))
      .first();

    return item;
  },
});
