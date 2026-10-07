import { v } from "convex/values";
import { query, mutation, internalMutation } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "../../_generated/dataModel";

// TTL for cached digest summaries (4 hours)
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * Get cached digest summary if available and valid
 * Returns null if cache miss or expired
 */
export const getCachedDigestSummary = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const today = new Date().toISOString().split('T')[0];

    // Try user-specific cache first
    if (userId) {
      const userCache = await ctx.db
        .query("digestSummaryCache")
        .withIndex("by_date_user", (q) =>
          q.eq("dateString", today).eq("userId", userId as any)
        )
        .first() as Doc<"digestSummaryCache"> | null;

      if (userCache && userCache.expiresAt > Date.now()) {
        return {
          summary: userCache.summary,
          generatedAt: userCache.generatedAt,
          isFromCache: true,
        };
      }
    }

    // Fall back to global cache (anonymous users or no user cache)
    const globalCache = await ctx.db
      .query("digestSummaryCache")
      .withIndex("by_date", (q) => q.eq("dateString", today))
      .filter((q) => q.eq(q.field("userId"), undefined))
      .first() as Doc<"digestSummaryCache"> | null;

    if (globalCache && globalCache.expiresAt > Date.now()) {
      return {
        summary: globalCache.summary,
        generatedAt: globalCache.generatedAt,
        isFromCache: true,
      };
    }

    return null;
  },
});

/**
 * Save generated digest summary to cache
 */
export const cacheDigestSummary = mutation({
  args: {
    summary: v.string(),
    dataHash: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const today = new Date().toISOString().split('T')[0];
    const now = Date.now();

    // Check if we already have a cache entry for today
    const existingQuery = userId
      ? ctx.db
        .query("digestSummaryCache")
        .withIndex("by_date_user", (q) =>
          q.eq("dateString", today).eq("userId", userId as any)
        )
      : ctx.db
        .query("digestSummaryCache")
        .withIndex("by_date", (q) => q.eq("dateString", today))
        .filter((q) => q.eq(q.field("userId"), undefined));

    const existing = await existingQuery.first() as Doc<"digestSummaryCache"> | null;

    if (existing) {
      // Update existing cache entry
      await ctx.db.patch(existing._id, {
        summary: args.summary,
        dataHash: args.dataHash,
        generatedAt: now,
        expiresAt: now + CACHE_TTL_MS,
        hitCount: (existing.hitCount ?? 0) + 1,
      });
      return existing._id;
    }

    // Create new cache entry
    const insertDoc: Record<string, any> = {
      dateString: today,
      summary: args.summary,
      dataHash: args.dataHash,
      generatedAt: now,
      expiresAt: now + CACHE_TTL_MS,
      hitCount: 0,
    };
    if (userId) {
      insertDoc.userId = userId as any;
    }
    return await ctx.db.insert("digestSummaryCache", insertDoc as any);
  },
});

/**
 * Internal mutation to clean up expired cache entries
 */
export const cleanupExpiredCache = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("digestSummaryCache")
      .withIndex("by_expires_at")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .take(100);

    for (const entry of expired) {
      await ctx.db.delete(entry._id);
    }

    return { deleted: expired.length };
  },
});

// Get digest data from feed items filtered by user's tracked topics
export const getDigestData = query({
  args: {},
  handler: async (ctx) => {
    // Get user's tracked hashtags from preferences
    const userId = await getAuthUserId(ctx);
    let trackedHashtags: string[] = [];

    if (userId) {
      const prefs = await ctx.db
        .query("userPreferences")
        .withIndex("by_user", (q) => q.eq("userId", userId as any))
        .first() as Doc<"userPreferences"> | null;
      trackedHashtags = prefs?.trackedHashtags ?? [];
    }

    // Get recent feed items (last 24 hours) - PRIORITIZE RECENCY
    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
    const feedItems = await ctx.db
      .query("feedItems")
      .order("desc") // Order by _creationTime (most recent first)
      .filter((q) => q.gte(q.field("_creationTime"), cutoff24h))
      .take(50);

    // Categorize items
    const marketMovers: typeof feedItems = [];
    const watchlistRelevant: typeof feedItems = [];
    const riskAlerts: typeof feedItems = [];

    const riskKeywords = ['risk', 'concern', 'decline', 'fall', 'regulation', 'investigation', 'lawsuit', 'warning', 'alert'];
    const marketKeywords = ['market', 'stock', 'nasdaq', 's&p', 'dow', 'futures', 'treasury', 'yield', 'fed', 'rate'];

    for (const item of feedItems) {
      const titleLower = item.title.toLowerCase();
      const tagsLower = item.tags.map((t: any) => t.toLowerCase());
      const allText = `${titleLower} ${tagsLower.join(' ')}`;

      // Check if item matches user's tracked topics
      const matchesWatchlist = trackedHashtags.some(hashtag =>
        allText.includes(hashtag.toLowerCase())
      );

      // Categorize
      if (riskKeywords.some(k => allText.includes(k))) {
        riskAlerts.push(item);
      } else if (matchesWatchlist) {
        watchlistRelevant.push(item);
      } else if (marketKeywords.some(k => allText.includes(k))) {
        marketMovers.push(item);
      } else {
        // Default to market movers if no specific category
        marketMovers.push(item);
      }
    }

    // Get today's personal overlay
    let personalOverlay = null;
    if (userId) {
      const todayString = new Date().toISOString().split('T')[0];
      personalOverlay = await ctx.db
        .query("dailyBriefPersonalOverlays")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", userId as any).eq("dateString", todayString)
        )
        .order("desc")
        .first();
    }

    return {
      trackedHashtags,
      marketMovers: marketMovers.slice(0, 5),
      watchlistRelevant: watchlistRelevant.slice(0, 5),
      riskAlerts: riskAlerts.slice(0, 3),
      personalOverlay,
      lastUpdated: Date.now(),
    };
  },
});

/**
 * Get the freshest critical signals for PersonalPulse.
 * Prioritizes recency and criticality over score.
 * Supports all personas with diverse sources.
 *
 * INCREASED: Now fetches 100+ feed items, 15 funding events, 25 signals
 * to serve LinkedIn posts and all persona types.
 */
export const getFreshCriticalSignals = query({
  args: {
    lookbackHours: v.optional(v.number()),
    maxSignals: v.optional(v.number()), // How many signals to return (default 25)
    category: v.optional(v.string()), // Optional category filter
  },
  handler: async (ctx, args) => {
    // INCREASED: Default 48h lookback (up from 24h) for more content
    const lookbackMs = (args.lookbackHours ?? 48) * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;
    const maxSignals = args.maxSignals ?? 25; // Default 25 signals (up from 5)

    // Get user's tracked hashtags
    const userId = await getAuthUserId(ctx);
    let trackedHashtags: string[] = [];
    if (userId) {
      const prefs = await ctx.db
        .query("userPreferences")
        .withIndex("by_user", (q) => q.eq("userId", userId as any))
        .first() as Doc<"userPreferences"> | null;
      trackedHashtags = prefs?.trackedHashtags ?? [];
    }

    // 1. Get freshest feed items - INCREASED from 30 to 150 for all personas
    let feedQuery = ctx.db
      .query("feedItems")
      .order("desc")
      .filter((q) => q.gte(q.field("_creationTime"), cutoff));

    const freshFeedItems = await feedQuery.take(150);

    // 2. Get recent funding events - INCREASED from 5 to 20
    const fundingCutoff = Date.now() - 72 * 60 * 60 * 1000; // 72h for funding (less frequent)
    const fundingEvents = await ctx.db
      .query("fundingEvents")
      .withIndex("by_announcedAt")
      .order("desc")
      .filter((q) => q.gte(q.field("announcedAt"), fundingCutoff))
      .take(20);

    // 3. Get recent signals from signal ingester - INCREASED from 10 to 30
    const recentSignals = await ctx.db
      .query("signals")
      .order("desc")
      .filter((q) => q.gte(q.field("createdAt"), cutoff))
      .take(30);

    // Format critical signals
    const criticalSignals: Array<{
      id: string;
      type: 'feed' | 'funding' | 'signal';
      title: string;
      summary?: string;
      source: string;
      url?: string;
      timestamp: number;
      tags?: string[];
      category?: string;
      score?: number;
      matchesUserTopics: boolean;
    }> = [];

    // Filter by category if specified
    const categoryFilter = args.category?.toLowerCase();

    // Add fresh feed items - now adding many more
    for (const item of freshFeedItems) {
      // Category filter
      if (categoryFilter && item.category?.toLowerCase() !== categoryFilter) {
        continue;
      }

      const matchesTopics = trackedHashtags.some(tag =>
        item.title?.toLowerCase().includes(tag.toLowerCase()) ||
        item.tags?.some((t: string) => t.toLowerCase().includes(tag.toLowerCase()))
      );

      criticalSignals.push({
        id: item._id,
        type: 'feed',
        title: item.title,
        summary: item.summary || undefined,
        source: item.source || 'News',
        url: item.url || undefined,
        timestamp: item._creationTime,
        tags: item.tags,
        category: item.category,
        score: item.score,
        matchesUserTopics: matchesTopics,
      });
    }

    // Add funding events (critical for banker, VC, corp dev personas)
    for (const event of fundingEvents) {
      const fundingTitle = `${event.companyName} raises ${event.amountRaw} (${event.roundType})`;
      criticalSignals.push({
        id: event._id,
        type: 'funding',
        title: fundingTitle,
        summary: event.leadInvestors?.length
          ? `Led by ${event.leadInvestors.slice(0, 2).join(', ')}`
          : undefined,
        source: 'Funding',
        url: event.sourceUrls?.[0] || undefined,
        timestamp: event.announcedAt,
        tags: [event.sector || 'Startup', event.roundType].filter(Boolean),
        category: 'startups',
        score: event.confidence * 100,
        matchesUserTopics: false,
      });
    }

    // Add signals from signal ingester
    for (const signal of recentSignals) {
      criticalSignals.push({
        id: signal._id,
        type: 'signal',
        title: signal.title || 'Signal',
        summary: signal.summary || undefined,
        source: signal.sourceType || 'Signal',
        url: signal.sourceUrl || undefined,
        timestamp: signal.createdAt,
        tags: signal.tags || [],
        category: signal.category || 'tech',
        score: signal.score || 50,
        matchesUserTopics: false,
      });
    }

    // Sort by timestamp (most recent first) and take maxSignals
    criticalSignals.sort((a, b) => b.timestamp - a.timestamp);
    const topSignals = criticalSignals.slice(0, maxSignals);

    // Calculate time since freshest item
    const freshestTimestamp = Math.max(
      ...topSignals.map(s => s.timestamp),
      0
    );
    const ageMs = freshestTimestamp ? Date.now() - freshestTimestamp : null;
    const ageHours = ageMs ? Math.round(ageMs / (60 * 60 * 1000)) : null;

    // Source diversity stats
    const sourceStats = topSignals.reduce((acc, s) => {
      acc[s.source] = (acc[s.source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      signals: topSignals,
      freshestAgeHours: ageHours,
      totalFeedItems: freshFeedItems.length,
      totalFundingEvents: fundingEvents.length,
      totalSignals: recentSignals.length,
      totalAvailable: criticalSignals.length,
      trackedHashtags,
      sourceStats,
      lastUpdated: Date.now(),
    };
  },
});

/**
 * Get encounter data for the daily digest.
 * Aggregates encounters from Slack and email captures.
 *
 * @module domains/ai/morningDigestQueries
 */
export const getEncounterDigestData = query({
  args: {
    lookbackHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        encounters: [],
        byCompany: {},
        totalParticipants: 0,
        followUpsNeeded: 0,
        summary: null,
      };
    }

    const lookbackMs = (args.lookbackHours ?? 24) * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;

    // Get Slack encounters
    const slackEncounters = await ctx.db
      .query("userEvents")
      .withIndex("by_user_sourceType", (q) =>
        q.eq("userId", userId as any).eq("sourceType", "slack" as any)
      )
      .filter((q) => q.gte(q.field("createdAt"), cutoff))
      .order("desc")
      .take(50);

    // Get email forward encounters
    const emailEncounters = await ctx.db
      .query("userEvents")
      .withIndex("by_user_sourceType", (q) =>
        q.eq("userId", userId as any).eq("sourceType", "email_forward" as any)
      )
      .filter((q) => q.gte(q.field("createdAt"), cutoff))
      .order("desc")
      .take(50);

    // Combine and sort by creation time
    const allEncounters = [...slackEncounters, ...emailEncounters]
      .sort((a, b) => b.createdAt - a.createdAt);

    // Group by company
    const byCompany: Record<string, typeof allEncounters> = {};
    const uniqueParticipants = new Set<string>();

    for (const enc of allEncounters) {
      const encounter = enc.encounter;
      if (!encounter) continue;

      // Track participants
      for (const p of encounter.participants || []) {
        uniqueParticipants.add(p.name);
      }

      // Group by company
      for (const c of encounter.companies || []) {
        if (!byCompany[c.name]) {
          byCompany[c.name] = [];
        }
        byCompany[c.name].push(enc);
      }
    }

    // Count follow-ups needed
    const followUpsNeeded = allEncounters.filter(
      (e) => e.encounter?.followUpRequested
    ).length;

    return {
      encounters: allEncounters.map((e) => ({
        _id: e._id,
        title: e.title,
        createdAt: e.createdAt,
        sourceType: e.sourceType,
        encounter: e.encounter,
      })),
      byCompany,
      totalParticipants: uniqueParticipants.size,
      followUpsNeeded,
      lastUpdated: Date.now(),
    };
  },
});
