/**
 * Signal Ingester - Autonomous Signal Ingestion Pipeline
 * Deep Agents 3.0 - Continuous feed/event monitoring
 *
 * Ingests signals from multiple sources:
 * - Cron-triggered time-based signals
 * - RSS/Atom feed monitoring
 * - Webhook endpoints
 * - Internal Convex events
 * - Keyword mention tracking
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { SIGNAL_CONFIG } from "../../../config/autonomousConfig";
import type { Doc, Id } from "../../../_generated/dataModel";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

export interface SignalSource {
  type: "cron" | "rss" | "webhook" | "event" | "mention";
  sourceType: string;
  config: {
    schedule?: string; // Cron expression
    feedUrl?: string; // RSS/Atom feed
    webhookPath?: string; // Webhook endpoint
    eventPattern?: string; // Convex event pattern
    mentionTopics?: string[]; // Tracked keywords
  };
}

export interface RawSignal {
  source: string;
  sourceType: string;
  sourceUrl?: string;
  rawContent: string;
  title?: string;
}

/* ================================================================== */
/* SIGNAL SOURCES CONFIGURATION                                        */
/* ================================================================== */

export const SIGNAL_SOURCES: SignalSource[] = [
  // Time-based triggers (handled by cron jobs)
  { type: "cron", sourceType: "morning_brief", config: { schedule: "0 6 * * *" } },
  { type: "cron", sourceType: "evening_summary", config: { schedule: "0 18 * * *" } },
  { type: "cron", sourceType: "breaking_check", config: { schedule: "*/15 * * * *" } },

  // Feed-based triggers
  { type: "rss", sourceType: "fiercebiotech", config: { feedUrl: "https://www.fiercebiotech.com/rss.xml" } },
  { type: "rss", sourceType: "techcrunch", config: { feedUrl: "https://techcrunch.com/feed/" } },
  { type: "rss", sourceType: "hackernews", config: { feedUrl: "https://news.ycombinator.com/rss" } },
  { type: "rss", sourceType: "arxiv_cs_ai", config: { feedUrl: "https://export.arxiv.org/rss/cs.AI" } },

  // Event-based triggers
  { type: "event", sourceType: "funding_detected", config: { eventPattern: "entity:funding:*" } },
  { type: "event", sourceType: "entity_created", config: { eventPattern: "entity:created:*" } },

  // Mention-based triggers
  {
    type: "mention",
    sourceType: "security_alerts",
    config: { mentionTopics: ["CVE-*", "security breach", "data leak", "zero-day"] },
  },
  {
    type: "mention",
    sourceType: "funding_news",
    config: { mentionTopics: ["Series A", "Series B", "Series C", "IPO", "acquisition", "merger"] },
  },
];

/* ================================================================== */
/* UTILITY FUNCTIONS                                                   */
/* ================================================================== */

/**
 * Generate SHA-256 hash for content deduplication
 */
async function generateContentHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Classify signal urgency based on content keywords
 */
function classifyUrgency(
  content: string,
  title?: string
): "critical" | "high" | "medium" | "low" {
  const text = `${title || ""} ${content}`.toLowerCase();

  for (const keyword of SIGNAL_CONFIG.urgencyKeywords.critical) {
    if (text.includes(keyword.toLowerCase())) return "critical";
  }
  for (const keyword of SIGNAL_CONFIG.urgencyKeywords.high) {
    if (text.includes(keyword.toLowerCase())) return "high";
  }
  for (const keyword of SIGNAL_CONFIG.urgencyKeywords.medium) {
    if (text.includes(keyword.toLowerCase())) return "medium";
  }
  return "low";
}

/**
 * Estimate research depth based on content
 */
function estimateResearchDepth(
  content: string,
  title?: string
): "shallow" | "standard" | "deep" {
  const text = `${title || ""} ${content}`.toLowerCase();

  for (const keyword of SIGNAL_CONFIG.depthKeywords.deep) {
    if (text.includes(keyword.toLowerCase())) return "deep";
  }
  for (const keyword of SIGNAL_CONFIG.depthKeywords.shallow) {
    if (text.includes(keyword.toLowerCase())) return "shallow";
  }
  return "standard";
}

/* ================================================================== */
/* QUERIES                                                             */
/* ================================================================== */

/**
 * Check if a signal with this content hash already exists
 */
export const checkDuplicateSignal = internalQuery({
  args: { contentHash: v.string() },
  handler: async (ctx, { contentHash }): Promise<boolean> => {
    const cutoff = Date.now() - SIGNAL_CONFIG.deduplicationWindowMs;
    const existing = await ctx.db
      .query("signals")
      .withIndex("by_contentHash", (q) => q.eq("contentHash", contentHash))
      .filter((q) => q.gt(q.field("createdAt"), cutoff))
      .first();
    return existing !== null;
  },
});

/**
 * Get pending signals for processing
 */
export const getPendingSignals = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 50 }): Promise<Doc<"signals">[]> => {
    return await ctx.db
      .query("signals")
      .withIndex("by_status", (q) => q.eq("processingStatus", "pending"))
      .order("asc")
      .take(limit) as Doc<"signals">[];
  },
});

export const getRecentSignals = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 100 }): Promise<Array<Doc<"signals"> & { ingestedAt: number; status: string }>> => {
    const boundedLimit = Math.min(Math.max(limit, 1), 500);
    const signals = await ctx.db.query("signals").take(1000) as Doc<"signals">[];
    return signals
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, boundedLimit)
      .map((signal) => ({
        ...signal,
        ingestedAt: signal.createdAt,
        status: signal.processingStatus,
      }));
  },
});

export const getUnprocessedSignals = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 50 }): Promise<Doc<"signals">[]> => {
    const boundedLimit = Math.min(Math.max(limit, 1), 500);
    const failed = await ctx.db
      .query("signals")
      .withIndex("by_status", (q) => q.eq("processingStatus", "failed"))
      .take(boundedLimit) as Doc<"signals">[];
    if (failed.length >= boundedLimit) return failed;

    const pending = await ctx.db
      .query("signals")
      .withIndex("by_status", (q) => q.eq("processingStatus", "pending"))
      .take(boundedLimit - failed.length) as Doc<"signals">[];
    return [...failed, ...pending];
  },
});

/**
 * Get signals by source type
 */
export const getSignalsBySource = internalQuery({
  args: {
    source: v.string(),
    limit: v.optional(v.number()),
    since: v.optional(v.number()),
  },
  handler: async (ctx, { source, limit = 100, since }): Promise<Doc<"signals">[]> => {
    let query = ctx.db
      .query("signals")
      .withIndex("by_source", (q) => q.eq("source", source));

    if (since) {
      query = query.filter((q) => q.gt(q.field("createdAt"), since));
    }

    return await query.order("desc").take(limit) as Doc<"signals">[];
  },
});

/* ================================================================== */
/* MUTATIONS                                                           */
/* ================================================================== */

/**
 * Create a new signal from raw input
 */
export const createSignal = internalMutation({
  args: {
    source: v.string(),
    sourceType: v.string(),
    sourceUrl: v.optional(v.string()),
    rawContent: v.string(),
    title: v.optional(v.string()),
    contentHash: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"signals">> => {
    const urgency = classifyUrgency(args.rawContent, args.title);
    const depth = estimateResearchDepth(args.rawContent, args.title);

    return await ctx.db.insert("signals", {
      source: args.source,
      sourceType: args.sourceType,
      sourceUrl: args.sourceUrl,
      rawContent: args.rawContent,
      title: args.title,
      contentHash: args.contentHash,
      processingStatus: "pending",
      urgency,
      estimatedResearchDepth: depth,
      createdAt: Date.now(),
      expiresAt: Date.now() + SIGNAL_CONFIG.signalTtlMs,
      retryCount: 0,
    });
  },
});

/**
 * Update signal processing status
 */
export const updateSignalStatus = internalMutation({
  args: {
    signalId: v.id("signals"),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("processed"),
      v.literal("failed"),
      v.literal("skipped")
    ),
    extractedEntities: v.optional(v.array(v.string())),
    suggestedPersonas: v.optional(v.array(v.string())),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const updates: Partial<Doc<"signals">> = {
      processingStatus: args.status,
    };

    if (args.status === "processed") {
      updates.processedAt = Date.now();
    }
    if (args.extractedEntities) {
      updates.extractedEntities = args.extractedEntities;
    }
    if (args.suggestedPersonas) {
      updates.suggestedPersonas = args.suggestedPersonas;
    }
    if (args.errorMessage) {
      updates.errorMessage = args.errorMessage;
    }

    await ctx.db.patch(args.signalId, updates);
  },
});

/**
 * Mark signal for retry
 */
export const markSignalForRetry = internalMutation({
  args: {
    signalId: v.id("signals"),
    error: v.string(),
  },
  handler: async (ctx, { signalId, error }): Promise<void> => {
    const signal = await ctx.db.get(signalId) as Doc<"signals"> | null;
    if (!signal) return;

    const retryCount = (signal.retryCount ?? 0) + 1;
    const maxRetries = 3;

    if (retryCount >= maxRetries) {
      await ctx.db.patch(signalId, {
        processingStatus: "failed",
        errorMessage: `Max retries exceeded. Last error: ${error}`,
        retryCount,
      });
    } else {
      await ctx.db.patch(signalId, {
        processingStatus: "pending",
        errorMessage: error,
        retryCount,
      });
    }
  },
});

/**
 * Clean up expired signals
 */
export const cleanupExpiredSignals = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const now = Date.now();
    const expiredSignals = await ctx.db
      .query("signals")
      .withIndex("by_expires")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .take(100) as Doc<"signals">[];

    for (const signal of expiredSignals) {
      await ctx.db.delete(signal._id);
    }

    return { deleted: expiredSignals.length };
  },
});

export const cleanupErrorSignals = internalMutation({
  args: {
    olderThanHours: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { olderThanHours = 24, limit = 100 }): Promise<number> => {
    const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000;
    const failedSignals = await ctx.db
      .query("signals")
      .withIndex("by_status", (q) => q.eq("processingStatus", "failed"))
      .filter((q) => q.lt(q.field("createdAt"), cutoff))
      .take(Math.min(Math.max(limit, 1), 500)) as Doc<"signals">[];

    for (const signal of failedSignals) {
      await ctx.db.delete(signal._id);
    }
    return failedSignals.length;
  },
});

/* ================================================================== */
/* ACTIONS - SIGNAL INGESTION                                          */
/* ================================================================== */

/**
 * Ingest a single signal from any source
 */
export const ingestSignal = internalAction({
  args: {
    source: v.string(),
    sourceType: v.string(),
    sourceUrl: v.optional(v.string()),
    rawContent: v.string(),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"signals"> | null> => {
    // Generate content hash for deduplication
    const contentHash = await generateContentHash(args.rawContent);

    // Check for duplicates
    const isDuplicate = await ctx.runQuery(
      internal.domains.signals.signalIngester.checkDuplicateSignal,
      { contentHash }
    );

    if (isDuplicate) {
      console.log(`[SignalIngester] Skipping duplicate signal: ${args.title || args.sourceType}`);
      return null;
    }

    // Create the signal
    const signalId = await ctx.runMutation(
      internal.domains.signals.signalIngester.createSignal,
      {
        source: args.source,
        sourceType: args.sourceType,
        sourceUrl: args.sourceUrl,
        rawContent: args.rawContent,
        title: args.title,
        contentHash,
      }
    );

    console.log(`[SignalIngester] Created signal ${signalId}: ${args.title || args.sourceType}`);

    // Schedule processing
    await ctx.scheduler.runAfter(
      0,
      internal.domains.signals.signalProcessor.processSignal,
      { signalId }
    );

    return signalId;
  },
});

/**
 * Ingest signals from an RSS feed
 */
export const ingestRssFeed = internalAction({
  args: {
    feedUrl: v.string(),
    sourceType: v.string(),
    maxItems: v.optional(v.number()),
  },
  handler: async (ctx, { feedUrl, sourceType, maxItems = 20 }): Promise<number> => {
    console.log(`[SignalIngester] Fetching RSS feed: ${feedUrl}`);

    try {
      const response = await fetch(feedUrl, {
        headers: {
          "User-Agent": "NodeBench/1.0 (Autonomous Agent Ecosystem)",
        },
      });

      if (!response.ok) {
        console.error(`[SignalIngester] Failed to fetch feed: ${response.status}`);
        return 0;
      }

      const text = await response.text();

      // Simple RSS parsing (for production, use a proper parser)
      const items = parseRssItems(text, maxItems);
      let ingested = 0;

      for (const item of items) {
        const signalId = await ctx.runAction(
          internal.domains.signals.signalIngester.ingestSignal,
          {
            source: "rss",
            sourceType,
            sourceUrl: item.link,
            rawContent: item.description || item.content || "",
            title: item.title,
          }
        );

        if (signalId) ingested++;
      }

      console.log(`[SignalIngester] Ingested ${ingested}/${items.length} items from ${sourceType}`);
      return ingested;
    } catch (error) {
      console.error(`[SignalIngester] Error fetching RSS feed:`, error);
      return 0;
    }
  },
});

/**
 * Simple RSS item parser (for basic feeds)
 */
function parseRssItems(
  xml: string,
  maxItems: number
): Array<{ title?: string; link?: string; description?: string; content?: string }> {
  const items: Array<{ title?: string; link?: string; description?: string; content?: string }> = [];

  // Extract <item> or <entry> blocks
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>|<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null && items.length < maxItems) {
    const itemContent = match[1] || match[2];

    const title = extractTag(itemContent, "title");
    const link = extractTag(itemContent, "link") || extractAttr(itemContent, "link", "href");
    const description = extractTag(itemContent, "description") || extractTag(itemContent, "summary");
    const content = extractTag(itemContent, "content:encoded") || extractTag(itemContent, "content");

    items.push({
      title: cleanHtml(title),
      link,
      description: cleanHtml(description),
      content: cleanHtml(content),
    });
  }

  return items;
}

function extractTag(xml: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}[^>]*>(?:<!\\\[CDATA\\\[)?([\s\S]*?)(?:\\\]\\\]>)?<\/${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : undefined;
}

function extractAttr(xml: string, tag: string, attr: string): string | undefined {
  const regex = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i");
  const match = xml.match(regex);
  return match ? match[1] : undefined;
}

function cleanHtml(text?: string): string | undefined {
  if (!text) return undefined;
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&[^;]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ingest all configured RSS feeds
 */
export const ingestAllRssFeeds = internalAction({
  args: {},
  handler: async (ctx): Promise<{ total: number }> => {
    const rssFeeds = SIGNAL_SOURCES.filter((s) => s.type === "rss");
    let total = 0;

    for (const feed of rssFeeds) {
      if (feed.config.feedUrl) {
        const count = await ctx.runAction(
          internal.domains.signals.signalIngester.ingestRssFeed,
          {
            feedUrl: feed.config.feedUrl,
            sourceType: feed.sourceType,
          }
        );
        total += count;
      }
    }

    console.log(`[SignalIngester] Total signals ingested: ${total}`);
    return { total };
  },
});

/**
 * Ingest from existing feed items (bridge from existing feedItems table)
 */
export const ingestFromFeedItems = internalAction({
  args: {
    since: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { since, limit = 50 }): Promise<number> => {
    // Query recent feed items that haven't been converted to signals
    const feedItems = await ctx.runQuery(
      internal.domains.signals.signalIngester.getRecentFeedItems,
      { since, limit }
    );

    let ingested = 0;
    for (const item of feedItems) {
      const signalId = await ctx.runAction(
        internal.domains.signals.signalIngester.ingestSignal,
        {
          source: "feedItem",
          sourceType: item.feedType || "unknown",
          sourceUrl: item.url,
          rawContent: item.content || item.description || "",
          title: item.title,
        }
      );

      if (signalId) ingested++;
    }

    return ingested;
  },
});

/**
 * Query recent feed items (helper for ingestFromFeedItems)
 */
export const getRecentFeedItems = internalQuery({
  args: {
    since: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { since, limit = 50 }) => {
    const cutoff = since || Date.now() - 24 * 60 * 60 * 1000; // Default: last 24 hours

    return await ctx.db
      .query("feedItems")
      .order("desc")
      .filter((q) => q.gt(q.field("_creationTime"), cutoff))
      .take(limit) as Doc<"feedItems">[];
  },
});

/**
 * Main signal ingestion tick - called by cron
 */
export const tickSignalIngestion = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    console.log("[SignalIngester] Starting signal ingestion tick...");

    // 1. Ingest all RSS feeds
    await ctx.runAction(internal.domains.signals.signalIngester.ingestAllRssFeeds, {});

    // 2. Ingest from existing feed items (bridge)
    await ctx.runAction(internal.domains.signals.signalIngester.ingestFromFeedItems, {});

    // 3. Cleanup expired signals
    const cleanup = await ctx.runMutation(
      internal.domains.signals.signalIngester.cleanupExpiredSignals,
      {}
    );

    console.log(`[SignalIngester] Tick complete. Cleaned up ${cleanup.deleted} expired signals.`);
  },
});
