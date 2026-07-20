/**
 * Funding Detection
 *
 * Scans feed items for funding announcements and extracts structured data.
 * Uses pattern matching and optional LLM extraction.
 */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";

// Funding keywords with weight
const FUNDING_PATTERNS = {
  // Strong indicators (high confidence)
  strong: [
    /raises?\s+\$?\d+\.?\d*\s*(million|billion|m|b|mn|bn)/i,
    /secures?\s+\$?\d+\.?\d*\s*(million|billion|m|b|mn|bn)/i,
    /closes?\s+\$?\d+\.?\d*\s*(million|billion|m|b|mn|bn)/i,
    /funding\s+round/i,
    /series\s+[a-e](\s+round)?/i,
    /seed\s+(round|funding|investment)/i,
    /pre-?seed/i,
  ],
  // Medium indicators
  medium: [
    /venture\s+capital/i,
    /led\s+by\s+[A-Z]/i, // "led by [Investor]"
    /investment\s+from/i,
    /backed\s+by/i,
    /funding/i,
    /investors?\s+include/i,
  ],
  // Weak indicators (context dependent)
  weak: [
    /valuation/i,
    /capital/i,
    /growth\s+equity/i,
  ],
};

// Amount extraction patterns
const AMOUNT_PATTERNS = [
  /\$(\d+(?:\.\d+)?)\s*(million|billion|m|b|mn|bn)/i,
  /(\d+(?:\.\d+)?)\s*(million|billion|m|b|mn|bn)\s*(?:dollars?|USD)?/i,
];

// Round type detection
const ROUND_TYPE_PATTERNS: [RegExp, string][] = [
  [/pre-?seed/i, "pre-seed"],
  [/seed\s+(round|funding|stage)/i, "seed"],
  [/series\s+a\b/i, "series-a"],
  [/series\s+b\b/i, "series-b"],
  [/series\s+c\b/i, "series-c"],
  [/series\s+[d-z]\b/i, "series-d-plus"],
  [/growth\s+(round|equity)/i, "growth"],
  [/debt\s+financing/i, "debt"],
];

// Investor extraction patterns
const INVESTOR_PATTERNS = [
  /led\s+by\s+([A-Z][A-Za-z\s&]+?)(?:\s+and|\s+with|,|\.|$)/i,
  /investors?\s+(?:include|including)\s+([A-Z][A-Za-z\s,&]+?)(?:\.|$)/i,
  /participated\s+(?:include|including)\s+([A-Z][A-Za-z\s,&]+?)(?:\.|$)/i,
  /backed\s+by\s+([A-Z][A-Za-z\s&]+?)(?:\s+and|\s+with|,|\.|$)/i,
];

interface FundingCandidate {
  feedItemId: Id<"feedItems">;
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  confidence: number;
  extractedData: {
    companyName?: string;
    amountRaw?: string;
    amountUsd?: number;
    roundType?: string;
    leadInvestors?: string[];
    sector?: string;
  };
}

function normalizeAmount(raw: string): number | undefined {
  const match = raw.match(/(\d+(?:\.\d+)?)\s*(million|billion|m|b|mn|bn)/i);
  if (!match) return undefined;

  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  if (unit.startsWith("b")) {
    return value * 1_000_000_000;
  } else {
    return value * 1_000_000;
  }
}

function extractRoundType(text: string): string {
  for (const [pattern, roundType] of ROUND_TYPE_PATTERNS) {
    if (pattern.test(text)) {
      return roundType;
    }
  }
  return "unknown";
}

function extractInvestors(text: string): string[] {
  const investors: string[] = [];

  for (const pattern of INVESTOR_PATTERNS) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      // Split by common separators
      const parts = match[1]
        .split(/,\s*|\s+and\s+/i)
        .map((s) => s.trim())
        .filter((s) => s.length > 2 && /^[A-Z]/.test(s));
      investors.push(...parts);
    }
  }

  return [...new Set(investors)].slice(0, 5);
}

function calculateConfidence(text: string): number {
  let score = 0;
  let matches = 0;

  for (const pattern of FUNDING_PATTERNS.strong) {
    if (pattern.test(text)) {
      score += 0.3;
      matches++;
    }
  }

  for (const pattern of FUNDING_PATTERNS.medium) {
    if (pattern.test(text)) {
      score += 0.15;
      matches++;
    }
  }

  for (const pattern of FUNDING_PATTERNS.weak) {
    if (pattern.test(text)) {
      score += 0.05;
      matches++;
    }
  }

  // Normalize to 0-1 range
  return Math.min(score, 1);
}

function extractAmount(text: string): { raw: string; usd: number } | undefined {
  for (const pattern of AMOUNT_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      const raw = match[0];
      const usd = normalizeAmount(raw);
      if (usd) {
        return { raw, usd };
      }
    }
  }
  return undefined;
}

function extractCompanyName(title: string): string | undefined {
  // Try to extract company name from title patterns like:
  // "CompanyName raises $X million..."
  // "CompanyName secures Series A..."
  // Also handles compound titles: "X offloads..., Y secures $60M"

  // Patterns for company at start of title
  const startPatterns = [
    /^([A-Z][A-Za-z0-9\s]+?)\s+raises?\s/i,
    /^([A-Z][A-Za-z0-9\s]+?)\s+secures?\s/i,
    /^([A-Z][A-Za-z0-9\s]+?)\s+closes?\s/i,
    /^([A-Z][A-Za-z0-9\s]+?)\s+announces?\s/i,
    /^([A-Z][A-Za-z0-9\s]+?)\s+lands?\s/i,
    /^([A-Z][A-Za-z0-9\s]+?)\s+bags?\s/i,
  ];

  for (const pattern of startPatterns) {
    const match = pattern.exec(title);
    if (match && match[1]) {
      const name = match[1].trim();
      if (name.length > 2 && name.length < 50) {
        return name;
      }
    }
  }

  // Patterns for company mid-title (after comma, "and", etc.)
  const midPatterns = [
    /,\s*([A-Z][A-Za-z0-9]+)\s+(?:raises?|secures?|closes?|lands?|bags?)\s+\$?\d/i,
    /;\s*([A-Z][A-Za-z0-9]+)\s+(?:raises?|secures?|closes?|lands?|bags?)\s+\$?\d/i,
    /and\s+([A-Z][A-Za-z0-9]+)\s+(?:raises?|secures?|closes?|lands?|bags?)\s+\$?\d/i,
  ];

  for (const pattern of midPatterns) {
    const match = pattern.exec(title);
    if (match && match[1]) {
      const name = match[1].trim();
      if (name.length > 2 && name.length < 50) {
        return name;
      }
    }
  }

  // Try to find company name before funding amount
  const beforeAmountPattern = /([A-Z][A-Za-z0-9]+)\s+(?:gets?|receives?|obtains?|wins?)\s+\$?\d/i;
  const beforeAmountMatch = beforeAmountPattern.exec(title);
  if (beforeAmountMatch && beforeAmountMatch[1]) {
    const name = beforeAmountMatch[1].trim();
    if (name.length > 2 && name.length < 50) {
      return name;
    }
  }

  return undefined;
}

/**
 * Scan recent feed items for funding candidates.
 */
export const detectFundingCandidates = internalAction({
  args: {
    lookbackHours: v.optional(v.number()),
    limit: v.optional(v.number()),
    minConfidence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const lookbackMs = (args.lookbackHours ?? 24) * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;
    const minConfidence = args.minConfidence ?? 0.3;

    // Get recent feed items
    const recentItems = await ctx.runQuery(
      internal.domains.enrichment.fundingDetection.getRecentFeedItems,
      { cutoff, limit: args.limit ?? 100 }
    );

    const candidates: FundingCandidate[] = [];

    for (const item of recentItems) {
      const text = `${item.title} ${item.summary || ""}`;
      const confidence = calculateConfidence(text);

      if (confidence < minConfidence) continue;

      const amount = extractAmount(text);
      const roundType = extractRoundType(text);
      const investors = extractInvestors(text);
      const companyName = extractCompanyName(item.title);

      candidates.push({
        feedItemId: item._id,
        title: item.title,
        url: item.url || "",
        source: item.source,
        publishedAt: new Date(item.publishedAt).getTime(),
        confidence,
        extractedData: {
          companyName,
          amountRaw: amount?.raw,
          amountUsd: amount?.usd,
          roundType,
          leadInvestors: investors,
        },
      });
    }

    // Sort by confidence descending
    candidates.sort((a, b) => b.confidence - a.confidence);

    console.log(`[fundingDetection] Found ${candidates.length} candidates from ${recentItems.length} items`);

    // Enqueue for enrichment
    if (candidates.length > 0) {
      const toEnqueue = candidates.slice(0, 20).map((c) => c.feedItemId);
      const result = await ctx.runMutation(
        internal.domains.enrichment.enrichmentQueue.bulkEnqueueFundingDetection,
        {
          feedItemIds: toEnqueue,
          priority: 5,
        }
      );
      console.log(`[fundingDetection] Enqueued ${result.enqueued} jobs for enrichment`);
    }

    return {
      scanned: recentItems.length,
      candidates: candidates.length,
      topCandidates: candidates.slice(0, 10).map((c) => ({
        title: c.title,
        confidence: c.confidence,
        companyName: c.extractedData.companyName,
        amount: c.extractedData.amountRaw,
        roundType: c.extractedData.roundType,
      })),
    };
  },
});

/**
 * Query helper to get recent feed items.
 */
export const getRecentFeedItems = internalQuery({
  args: {
    cutoff: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("feedItems")
      .withIndex("by_published")
      .order("desc")
      .filter((q) => q.gte(q.field("publishedAt"), new Date(args.cutoff).toISOString()))
      .take(args.limit);
  },
});

/**
 * Process a single feed item for funding detection.
 * Called by the enrichment worker.
 */
export const processFeedItemForFunding = internalAction({
  args: {
    feedItemId: v.id("feedItems"),
  },
  handler: async (ctx, args) => {
    // Get the feed item
    const feedItem = await ctx.runQuery(
      internal.domains.enrichment.fundingDetection.getFeedItem,
      { feedItemId: args.feedItemId }
    );

    if (!feedItem) {
      throw new Error(`Feed item not found: ${args.feedItemId}`);
    }

    const text = `${feedItem.title} ${feedItem.summary || ""}`;
    const confidence = calculateConfidence(text);

    // If confidence is low, skip
    if (confidence < 0.3) {
      return {
        detected: false,
        confidence,
        reason: "Confidence below threshold",
      };
    }

    // Extract structured data
    const amount = extractAmount(text);
    const roundType = extractRoundType(text);
    const investors = extractInvestors(text);
    const companyName = extractCompanyName(feedItem.title);

    // If we have a URL, fetch full content for better extraction
    let enrichedData: {
      fullContentFetched: boolean;
      amountRaw: string | undefined;
      amountUsd: number | undefined;
      leadInvestors: string[];
    } | null = null;
    if (feedItem.url) {
      try {
        const fullContent = await ctx.runAction(
          internal.tools.media.linkupFetch.linkupFetchInternal,
          { url: feedItem.url, feedItemId: args.feedItemId }
        );

        // Re-extract from full content
        const fullText = fullContent.content || "";
        const fullAmount = extractAmount(fullText) || amount;
        const fullInvestors = extractInvestors(fullText);

        enrichedData = {
          fullContentFetched: true,
          amountRaw: fullAmount?.raw || amount?.raw,
          amountUsd: fullAmount?.usd || amount?.usd,
          leadInvestors: fullInvestors.length > 0 ? fullInvestors : investors,
        };
      } catch (error) {
        console.warn(`[fundingDetection] Failed to fetch full content:`, error);
      }
    }

    // Create funding event if confidence is high enough
    // Lower threshold (0.4) if we have amount data, higher (0.5) if no company name
    const hasAmount = amount?.usd || enrichedData?.amountUsd;
    const confidenceThreshold = companyName ? 0.4 : (hasAmount ? 0.5 : 0.6);

    if (confidence >= confidenceThreshold && (companyName || hasAmount)) {
      // Use a placeholder name if we couldn't extract one but have other signals
      const finalCompanyName = companyName || `Unknown Company (${amount?.raw || "funding"})`;

      const fundingEvent = await ctx.runMutation(
        internal.domains.enrichment.fundingMutations.createFundingEvent,
        {
          companyName: finalCompanyName,
          roundType: roundType as any,
          amountRaw: enrichedData?.amountRaw || amount?.raw || "Unknown",
          amountUsd: enrichedData?.amountUsd || amount?.usd,
          announcedAt: new Date(feedItem.publishedAt).getTime(),
          leadInvestors: enrichedData?.leadInvestors || investors,
          sourceUrls: feedItem.url ? [feedItem.url] : [],
          sourceNames: [feedItem.source],
          confidence,
          feedItemIds: [args.feedItemId],
        }
      );

      return {
        detected: true,
        confidence,
        fundingEventId: fundingEvent,
        extractedData: {
          companyName: finalCompanyName,
          roundType,
          amount: enrichedData?.amountRaw || amount?.raw,
          investors: enrichedData?.leadInvestors || investors,
        },
      };
    }

    return {
      detected: false,
      confidence,
      extractedData: {
        companyName,
        roundType,
        amount: amount?.raw,
        investors,
      },
    };
  },
});

/**
 * Query helper to get a single feed item.
 */
export const getFeedItem = internalQuery({
  args: {
    feedItemId: v.id("feedItems"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.feedItemId);
  },
});
