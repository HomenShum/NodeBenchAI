/**
 * For You Feed - Phoenix ML Ranking with X Algorithm Patterns
 * Phase 2 Implementation
 *
 * Provides personalized content discovery using:
 * - Candidate Sourcing (Thunder pattern): In-network, out-of-network, trending
 * - Phoenix ML Ranking: Grok-powered relevance scoring
 * - Home Mixer: 50/50 in-network/out-of-network orchestration
 * - Engagement Tracking: Multi-action prediction
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import type { VerificationSignals } from "../verification/integrations/feedVerification";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type CandidateSource = "in_network" | "out_of_network" | "trending";
export type ItemType = "document" | "agent" | "repository" | "update" | "feed_item";

export interface FeedCandidate {
  itemId: string;
  itemType: ItemType;
  source: CandidateSource;
  title: string;
  snippet: string;
  metadata: Record<string, any>;
  timestamp: number;
  dateString?: string; // YYYY-MM-DD for grouping
  /** Entity linking metadata (Wikidata IDs for canonical identification) */
  entityLinks?: {
    primary?: {
      wikidataId: string;
      canonicalName: string;
      entityType: "person" | "company" | "organization" | "location" | "other";
    };
    secondary?: Array<{
      wikidataId: string;
      canonicalName: string;
      entityType: "person" | "company" | "organization" | "location" | "other";
    }>;
  };
}

export interface RankedCandidate extends FeedCandidate {
  phoenixScore: number; // 0-100
  relevanceReason: string;
  engagementPrediction: {
    view: number; // 0-1 probability
    click: number;
    save: number;
    share: number;
  };
  /** Verification signals for insight+correctness ranking */
  verification?: {
    sourceTier: "tier1_authoritative" | "tier2_reliable" | "tier3_unverified";
    verificationStatus: "verified" | "corroborated" | "unverified" | "disputed";
    confidence: number;
    hasContradictions: boolean;
    badge: {
      type: "verified" | "reliable" | "needs_review" | "disputed" | "none";
      label: string;
      tooltip: string;
    };
  };
  /** Insight-optimized score (combines correctness + insight density) */
  insightScore?: number;
}

export interface DateGroup {
  dateString: string;
  displayLabel: string; // "Today", "Yesterday", "Jan 20", etc.
  items: RankedCandidate[];
}

export interface ForYouFeedResult {
  items: RankedCandidate[];
  dateGroups: DateGroup[]; // Items grouped by date for UI
  totalCandidates: number;
  mixRatio: {
    inNetwork: number;
    outOfNetwork: number;
    trending: number;
  };
  generatedAt: number;
  /** Verification quality metrics for the feed */
  verificationMetrics?: {
    verifiedCount: number;
    reliableCount: number;
    unverifiedCount: number;
    verificationRate: number;
    avgConfidence: number;
  };
}

/**
 * Helper to format date for display
 */
function formatDateLabel(dateString: string): string {
  const date = new Date(dateString + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);

  if (dateOnly.getTime() === today.getTime()) {
    return "Today";
  } else if (dateOnly.getTime() === yesterday.getTime()) {
    return "Yesterday";
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

/** Verification badge type matching RankedCandidate interface */
type VerificationBadge = {
  type: "verified" | "reliable" | "needs_review" | "disputed" | "none";
  label: string;
  tooltip: string;
};

/**
 * Compute verification badge for UI display
 */
function computeVerificationBadge(
  sourceTier: "tier1_authoritative" | "tier2_reliable" | "tier3_unverified",
  insightDensity: number
): VerificationBadge {
  if (sourceTier === "tier1_authoritative") {
    return {
      type: "verified",
      label: "Verified",
      tooltip: "From authoritative source (SEC, FDA, official announcement)",
    };
  }

  if (sourceTier === "tier2_reliable") {
    return {
      type: "reliable",
      label: "Reliable",
      tooltip: "From reliable news source or verified expert",
    };
  }

  if (insightDensity >= 2) {
    return {
      type: "needs_review",
      label: "Unverified",
      tooltip: "High insight density but source not verified",
    };
  }

  return {
    type: "none",
    label: "",
    tooltip: "",
  };
}

/**
 * Group items by date
 */
function groupByDate(items: RankedCandidate[]): DateGroup[] {
  const groups = new Map<string, RankedCandidate[]>();

  for (const item of items) {
    const dateStr = item.dateString || getDateString(item.timestamp);
    if (!groups.has(dateStr)) {
      groups.set(dateStr, []);
    }
    groups.get(dateStr)!.push(item);
  }

  // Sort dates descending (most recent first)
  const sortedDates = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));

  return sortedDates.map(dateStr => ({
    dateString: dateStr,
    displayLabel: formatDateLabel(dateStr),
    items: groups.get(dateStr)!,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const FEED_CONFIG = {
  /** Default feed size */
  defaultFeedSize: 20,

  /** Candidate pool size (before ranking) */
  candidatePoolSize: 100,

  /** Target mix ratio (X algorithm 50/50 pattern) */
  targetMixRatio: {
    inNetwork: 0.5, // 50% from people you follow
    outOfNetwork: 0.4, // 40% discovery
    trending: 0.1, // 10% trending across platform
  },

  /** Phoenix ML ranking weights (engagement-optimized) */
  phoenixWeights: {
    recency: 0.2, // How recent is the content
    relevance: 0.4, // Semantic similarity to user interests
    engagement: 0.25, // Predicted engagement likelihood
    diversity: 0.15, // Avoid filter bubbles
  },

  /** Insight+Correctness ranking weights (quality-optimized) */
  insightWeights: {
    correctness: 0.4, // Verification status + source tier
    insightDensity: 0.3, // Verified claims per content length
    recency: 0.15, // Time decay (week-based)
    relevance: 0.15, // User interest alignment
  },

  /** Source credibility tiers for verification */
  sourceTiers: {
    authoritative: 1.0, // SEC, FDA, official announcements
    reliable: 0.7, // Major news outlets, verified experts
    unverified: 0.2, // Social media, unverified blogs
  },

  /** Enable insight-optimized ranking (vs pure engagement) */
  useInsightRanking: true,

  /** Max candidates to verify per feed generation */
  maxVerificationBatch: 30,

  /** Use free Grok models via OpenRouter for cost efficiency */
  useFreegrokModels: true,

  /** Refresh interval for feed regeneration (5 minutes) */
  feedRefreshMs: 5 * 60 * 1000,

  /** Enable entity linking enrichment for feed candidates */
  enableEntityEnrichment: true,

  /** Max candidates to enrich per feed generation (cost control) */
  maxEntityEnrichment: 15,

  /** Enable LLM judge validation for entity links (higher accuracy, more cost) */
  enableEntityValidation: false,

  /** Minimum confidence threshold to include entity link (0-1) */
  minEntityConfidence: 0.5,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// STEP 1: CANDIDATE SOURCING (Thunder Pattern)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get in-network candidates (content from people/agents you follow)
 */
export const getInNetworkCandidates = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.number(),
  },
  handler: async (ctx, { userId, limit }): Promise<FeedCandidate[]> => {
    const candidates: FeedCandidate[] = [];

    // TODO: Get user's followed agents/people
    // For now, return recent documents as proxy
    const recentDocs = await ctx.db
      .query("documents")
      .withIndex("by_creation_time")
      .order("desc")
      .take(limit);

    for (const doc of recentDocs) {
      candidates.push({
        itemId: doc._id,
        itemType: "document",
        source: "in_network",
        title: doc.title || "Untitled",
        snippet: doc.summary?.substring(0, 200) || "",
        metadata: {
          authorId: doc.userId,
          createdAt: doc._creationTime,
        },
        timestamp: doc._creationTime,
        dateString: getDateString(doc._creationTime),
      });
    }

    return candidates;
  },
});

/**
 * Helper to get date string from timestamp
 */
function getDateString(timestamp: number): string {
  return new Date(timestamp).toISOString().split("T")[0];
}

/**
 * Get out-of-network candidates (discovery from the wider platform)
 */
export const getOutOfNetworkCandidates = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.number(),
  },
  handler: async (ctx, { userId, limit }): Promise<FeedCandidate[]> => {
    const candidates: FeedCandidate[] = [];

    // Get recent industry updates
    const updates = await ctx.db
      .query("industryUpdates")
      .withIndex("by_scanned_at")
      .order("desc")
      .take(Math.floor(limit / 4));

    for (const update of updates) {
      candidates.push({
        itemId: update._id,
        itemType: "update",
        source: "out_of_network",
        title: update.title,
        snippet: update.summary?.substring(0, 200) || "",
        metadata: {
          provider: update.provider,
          relevance: update.relevance,
          url: update.url,
        },
        timestamp: update.scannedAt,
        dateString: getDateString(update.scannedAt),
      });
    }

    // Get feed items from external sources
    const feedItems = await ctx.db
      .query("feedItems")
      .withIndex("by_creation_time")
      .order("desc")
      .take(Math.floor(limit / 4));

    for (const item of feedItems) {
      const ts = item.createdAt || item._creationTime;
      candidates.push({
        itemId: item._id,
        itemType: "feed_item",
        source: "out_of_network",
        title: item.title || "Untitled",
        snippet: item.summary?.substring(0, 200) || "",
        metadata: {
          source: item.source,
          url: item.url,
          score: item.score,
        },
        timestamp: ts,
        dateString: getDateString(ts),
      });
    }

    // Include landing page signals (daily brief published content)
    const landingSignals = await ctx.db
      .query("landingPageLog")
      .withIndex("by_createdAt")
      .order("desc")
      .take(Math.floor(limit / 4));

    for (const signal of landingSignals) {
      candidates.push({
        itemId: signal._id,
        itemType: "update",
        source: "out_of_network",
        title: signal.title,
        snippet: signal.markdown?.substring(0, 200) || "",
        metadata: {
          kind: signal.kind,
          source: signal.source || "Daily Brief",
          url: signal.url,
          tags: signal.tags,
          day: signal.day,
        },
        timestamp: signal.createdAt,
        dateString: signal.day || getDateString(signal.createdAt),
      });
    }

    // NEW: Include LinkedIn funding posts with entity linking
    const linkedinPosts = await ctx.db
      .query("linkedinFundingPosts")
      .withIndex("by_postedAt")
      .order("desc")
      .take(Math.floor(limit / 4));

    for (const post of linkedinPosts) {
      // Build entity links if entityId (Wikidata ID) is available
      const entityLinks = post.entityId ? {
        primary: {
          wikidataId: post.entityId,
          canonicalName: post.companyName, // Will be enriched later if needed
          entityType: "company" as const,
        },
      } : undefined;

      candidates.push({
        itemId: post._id,
        itemType: "update",
        source: "out_of_network",
        title: `${post.companyName} raised ${post.amountRaw} (${post.roundType})`,
        snippet: post.contentSummary?.substring(0, 200) || `Funding announcement: ${post.companyName}`,
        metadata: {
          kind: "linkedin_funding",
          source: "LinkedIn",
          url: post.postUrl,
          sector: post.sector,
          roundType: post.roundType,
          amount: post.amountRaw,
          companyName: post.companyName,
          entityId: post.entityId, // Wikidata ID for canonical identification
        },
        timestamp: post.postedAt,
        dateString: getDateString(post.postedAt),
        entityLinks,
      });
    }

    return candidates;
  },
});

/**
 * Get trending candidates (hot content across the platform)
 */
export const getTrendingCandidates = internalQuery({
  args: {
    limit: v.number(),
  },
  handler: async (ctx, { limit }): Promise<FeedCandidate[]> => {
    const candidates: FeedCandidate[] = [];

    // Get high-relevance industry updates
    const trending = await ctx.db
      .query("industryUpdates")
      .withIndex("by_relevance")
      .order("desc")
      .filter((q) => q.gte(q.field("relevance"), 80))
      .take(Math.floor(limit / 4));

    for (const item of trending) {
      candidates.push({
        itemId: item._id,
        itemType: "update",
        source: "trending",
        title: item.title,
        snippet: item.summary?.substring(0, 200) || "",
        metadata: {
          provider: item.provider,
          relevance: item.relevance,
          url: item.url,
        },
        timestamp: item.scannedAt,
        dateString: getDateString(item.scannedAt),
      });
    }

    // Get recent high-scoring feed items (TechCrunch, etc.)
    const feedItems = await ctx.db
      .query("feedItems")
      .withIndex("by_creation_time")
      .order("desc")
      .take(Math.floor(limit / 4));

    for (const item of feedItems) {
      const ts = item.createdAt || item._creationTime;
      candidates.push({
        itemId: item._id,
        itemType: "feed_item",
        source: "trending",
        title: item.title || "Untitled",
        snippet: item.summary?.substring(0, 200) || "",
        metadata: {
          source: item.source,
          url: item.url,
          score: item.score,
        },
        timestamp: ts,
        dateString: getDateString(ts),
      });
    }

    // Include daily brief memories (last 7 days for historical context)
    const dailyBriefMemories = await ctx.db
      .query("dailyBriefMemories")
      .order("desc")
      .take(7);

    for (const memory of dailyBriefMemories) {
      if (memory.features) {
        for (const feature of memory.features.slice(0, 3)) {
          // Only include passing or high-priority features
          if (feature.status === "passing" || (feature.priority && feature.priority >= 7)) {
            candidates.push({
              itemId: `brief-${memory._id}-${feature.id}`,
              itemType: "update",
              source: "trending",
              title: feature.name,
              snippet: feature.testCriteria?.substring(0, 200) || feature.notes || "",
              metadata: {
                kind: "daily_brief",
                type: feature.type,
                status: feature.status,
                priority: feature.priority,
                goal: memory.goal,
              },
              timestamp: feature.updatedAt || memory.generatedAt,
              dateString: memory.dateString,
            });
          }
        }
      }
    }

    // Include daily brief snapshots (dashboard summaries)
    const snapshots = await ctx.db
      .query("dailyBriefSnapshots")
      .withIndex("by_generated_at")
      .order("desc")
      .take(7);

    for (const snapshot of snapshots) {
      if (snapshot.sourceSummary?.topTrending) {
        candidates.push({
          itemId: `snapshot-${snapshot._id}`,
          itemType: "update",
          source: "trending",
          title: `Daily Brief: ${snapshot.dateString}`,
          snippet: `Top trends: ${snapshot.sourceSummary.topTrending.slice(0, 3).join(", ")}`,
          metadata: {
            kind: "daily_snapshot",
            totalItems: snapshot.sourceSummary.totalItems,
            bySource: snapshot.sourceSummary.bySource,
          },
          timestamp: snapshot.generatedAt,
          dateString: snapshot.dateString,
        });
      }
    }

    // Boost items with high engagement (feedback loop)
    const recentEngagements = await ctx.db
      .query("feedEngagements")
      .order("desc")
      .take(100);

    // Count engagements per item
    const engagementCounts = new Map<string, number>();
    for (const engagement of recentEngagements) {
      const count = engagementCounts.get(engagement.itemId) || 0;
      // Weight by action type: share > save > click > view
      const weight = engagement.action === "share" ? 4 :
                     engagement.action === "save" ? 3 :
                     engagement.action === "click" ? 2 : 1;
      engagementCounts.set(engagement.itemId, count + weight);
    }

    // Add engagement boost to metadata of existing candidates
    for (const candidate of candidates) {
      const boost = engagementCounts.get(candidate.itemId as string) || 0;
      if (boost > 0) {
        candidate.metadata = {
          ...candidate.metadata,
          engagementBoost: boost,
        };
      }
    }

    return candidates;
  },
});

/**
 * Aggregate all candidates from different sources
 */
export const getCandidates = internalAction({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, { userId }): Promise<FeedCandidate[]> => {
    const poolSize = FEED_CONFIG.candidatePoolSize;

    // Calculate source-specific limits based on target ratio
    const inNetworkLimit = Math.floor(poolSize * FEED_CONFIG.targetMixRatio.inNetwork);
    const outOfNetworkLimit = Math.floor(poolSize * FEED_CONFIG.targetMixRatio.outOfNetwork);
    const trendingLimit = Math.floor(poolSize * FEED_CONFIG.targetMixRatio.trending);

    // Fetch candidates in parallel
    const [inNetwork, outOfNetwork, trending] = await Promise.all([
      ctx.runQuery(internal.domains.research.forYouFeed.getInNetworkCandidates, {
        userId,
        limit: inNetworkLimit,
      }),
      ctx.runQuery(internal.domains.research.forYouFeed.getOutOfNetworkCandidates, {
        userId,
        limit: outOfNetworkLimit,
      }),
      ctx.runQuery(internal.domains.research.forYouFeed.getTrendingCandidates, {
        limit: trendingLimit,
      }),
    ]);

    return [...inNetwork, ...outOfNetwork, ...trending];
  },
});

/**
 * Enrich candidates with entity links (for candidates missing entityLinks)
 * Uses the entity linking service to resolve company names to Wikidata IDs
 *
 * Now uses LLM-calibrated confidence without heuristic adjustments.
 * Optionally validates links using LLM judge for higher accuracy.
 */
export const enrichCandidatesWithEntityLinks = internalAction({
  args: {
    candidates: v.array(v.any()),
    maxEnrich: v.optional(v.number()), // Limit how many to enrich (cost control)
    enableValidation: v.optional(v.boolean()), // Enable LLM judge validation
    minConfidence: v.optional(v.number()), // Minimum confidence to include
  },
  handler: async (ctx, args): Promise<FeedCandidate[]> => {
    const {
      candidates,
      maxEnrich = FEED_CONFIG.maxEntityEnrichment,
      enableValidation = FEED_CONFIG.enableEntityValidation,
      minConfidence = FEED_CONFIG.minEntityConfidence,
    } = args;

    const enriched: FeedCandidate[] = [];
    let enrichCount = 0;
    let validatedCount = 0;

    for (const candidate of candidates) {
      // Skip if already has entity links
      if (candidate.entityLinks?.primary) {
        enriched.push(candidate);
        continue;
      }

      // Only enrich certain types that have company/entity references
      const isEnrichable =
        candidate.metadata?.kind === "linkedin_funding" ||
        candidate.metadata?.companyName ||
        candidate.itemType === "update";

      if (!isEnrichable || enrichCount >= maxEnrich) {
        enriched.push(candidate);
        continue;
      }

      // Extract entity name from candidate
      const entityName =
        candidate.metadata?.companyName ||
        extractCompanyFromTitle(candidate.title);

      if (!entityName) {
        enriched.push(candidate);
        continue;
      }

      try {
        // Call entity linking service (uses LLM-calibrated confidence)
        const linkResult = await ctx.runAction(
          internal.domains.enrichment.entityLinkingService.linkEntity,
          {
            name: entityName,
            context: candidate.snippet || candidate.title,
            expectedType: "company",
            sourceType: "feedItem",
            sourceId: String(candidate.itemId),
            mentionType: "primary",
          }
        );

        enrichCount++;

        // Apply confidence threshold
        if (!linkResult.found || !linkResult.wikidataId || linkResult.confidence < minConfidence) {
          enriched.push(candidate);
          continue;
        }

        // Optional: Validate using LLM judge for high-confidence links
        let isValidated = false;
        if (enableValidation && validatedCount < 5) { // Limit validation calls
          try {
            const validation = await ctx.runAction(
              internal.domains.enrichment.entityLinkingJudge.validateEntityLink,
              {
                query: entityName,
                context: candidate.snippet || candidate.title,
                linkedWikidataId: linkResult.wikidataId,
                linkedName: linkResult.canonicalName || entityName,
                linkedDescription: linkResult.description,
                originalConfidence: linkResult.confidence,
              }
            );
            validatedCount++;
            isValidated = validation.isCorrect;

            // Skip if validation fails
            if (!validation.isCorrect && validation.judgeConfidence > 0.7) {
              console.log(`[forYouFeed] Entity validation failed for ${entityName}: ${validation.reasoning}`);
              enriched.push(candidate);
              continue;
            }
          } catch (validationError) {
            console.warn(`[forYouFeed] Validation error for ${entityName}:`, validationError);
            // Continue without validation
          }
        }

        enriched.push({
          ...candidate,
          entityLinks: {
            primary: {
              wikidataId: linkResult.wikidataId,
              canonicalName: linkResult.canonicalName || entityName,
              entityType: (linkResult.entityType || "company") as "person" | "company" | "organization" | "location" | "other",
            },
          },
          metadata: {
            ...candidate.metadata,
            entityId: linkResult.wikidataId,
            entityConfidence: linkResult.confidence,
            entityValidated: isValidated,
          },
          });
      } catch (error) {
        console.error(`[forYouFeed] Entity enrichment failed for ${entityName}:`, error);
        enriched.push(candidate);
      }
    }

    console.log(`[forYouFeed] Enriched ${enrichCount} candidates with entity links (${validatedCount} validated)`);
    return enriched;
  },
});

/**
 * Helper to extract company name from title
 */
function extractCompanyFromTitle(title: string): string | null {
  // Common patterns: "Company raised $X", "Company announces", "Company closes"
  const patterns = [
    /^([A-Z][a-zA-Z0-9\s]+)\s+(?:raised|raises|closes|secures|announces)/i,
    /^([A-Z][a-zA-Z0-9\s]+),?\s+the\s+/i,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 2: PHOENIX ML RANKING (Grok-Powered)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rank candidates using Phoenix ML with Grok model
 * Predicts relevance and engagement likelihood
 */
export const rankWithPhoenix = internalAction({
  args: {
    userId: v.id("users"),
    candidates: v.array(v.any()),
  },
  handler: async (ctx, { userId, candidates }): Promise<RankedCandidate[]> => {
    // Get user profile for personalization
    const user = await ctx.runQuery(internal.domains.auth.auth.getUserById, { userId });
    if (!user) {
      throw new Error("User not found");
    }

    // Use free Grok model via autonomous resolver
    const model = await ctx.runQuery(
      internal.domains.models.autonomousModelResolver.selectModelForTask,
      {
        taskType: "research",
        requireToolUse: false,
      }
    );

    // Build ranking prompt (Phoenix ML pattern with insight+correctness optimization)
    const prompt = `You are Phoenix ML, an advanced ranking system optimized for INSIGHT DENSITY and CORRECTNESS.

RANKING PHILOSOPHY:
- Prioritize factual accuracy over engagement bait
- Verified claims from authoritative sources rank higher
- Insight density = actionable facts per minute of reading
- Contradicted or disputed content ranks lower

User Context:
- User ID: ${userId}
- Interests: ${user.preferences?.interests?.join(", ") || "general tech"}

Candidates to rank (${candidates.length} items):
${candidates.map((c: FeedCandidate, idx: number) => `
${idx + 1}. [${c.source}] ${c.title}
   Type: ${c.itemType}
   Snippet: ${c.snippet}
   Age: ${Math.round((Date.now() - c.timestamp) / (1000 * 60 * 60))} hours old
   Source: ${(c.metadata as Record<string, unknown>)?.source || (c.metadata as Record<string, unknown>)?.provider || "unknown"}
`).join("\n")}

Task: Rank by INSIGHT + CORRECTNESS using this scoring:
- Correctness (40%): Is content from authoritative source? Verifiable claims?
- Insight Density (30%): Novel facts, actionable conclusions per reading time
- Relevance (15%): User interest alignment
- Recency (15%): Freshness with 1-week decay

For each candidate, evaluate:
1. phoenixScore (0-100): Combined insight+correctness score
2. sourceCredibility: "authoritative" | "reliable" | "unverified"
3. insightDensity (0-5): Insights per minute estimate
4. engagement prediction (0-1 each): {view, click, save, share}
5. relevanceReason (10-15 words): Why this matters

Return JSON array ordered by phoenixScore:
[
  {
    "idx": 1,
    "phoenixScore": 95,
    "sourceCredibility": "authoritative",
    "insightDensity": 3.2,
    "relevanceReason": "...",
    "engagement": {"view": 0.9, "click": 0.8, "save": 0.5, "share": 0.3}
  },
  ...
]`;

    try {
      const response = await ctx.runAction(
        internal.domains.models.autonomousModelResolver.executeWithFallback,
        {
          taskType: "research",
          messages: [
            { role: "system", content: "You are Phoenix ML, X's ranking algorithm." },
            { role: "user", content: prompt },
          ],
          maxTokens: 2000,
          temperature: 0.3,
        }
      );

      // Parse rankings
      const rankings = JSON.parse(response.content) as Array<{
        idx: number;
        phoenixScore: number;
        sourceCredibility?: "authoritative" | "reliable" | "unverified";
        insightDensity?: number;
        relevanceReason: string;
        engagement: {
          view: number;
          click: number;
          save: number;
          share: number;
        };
      }>;

      // Map back to candidates with verification signals
      const ranked: RankedCandidate[] = rankings.map((r) => {
        const candidate = candidates[r.idx - 1] as FeedCandidate;

        // Prefer real verification enrichment if present; otherwise fall back to LLM-provided sourceCredibility.
        const existingVerification = (candidate as any).verification as VerificationSignals | undefined;

        const sourceTierMap: Record<string, VerificationSignals["sourceTier"]> = {
          authoritative: "tier1_authoritative",
          reliable: "tier2_reliable",
          unverified: "tier3_unverified",
        };

        const fallbackTier =
          sourceTierMap[r.sourceCredibility || "unverified"] || "tier3_unverified";

        const sourceTier = existingVerification?.sourceTier ?? fallbackTier;
        const badge = computeVerificationBadge(sourceTier, r.insightDensity || 0);
        const verification: VerificationSignals = existingVerification
          ? { ...existingVerification, badge }
          : {
              sourceTier,
              verificationStatus:
                sourceTier === "tier1_authoritative"
                  ? ("verified" as const)
                  : sourceTier === "tier2_reliable"
                    ? ("corroborated" as const)
                    : ("unverified" as const),
              confidence:
                sourceTier === "tier1_authoritative"
                  ? 0.9
                  : sourceTier === "tier2_reliable"
                    ? 0.7
                    : 0.3,
              hasContradictions: false,
              verifiedClaimCount: 0,
              totalClaimCount: 0,
              authoritativeSourceUrls: [],
              badge,
            };

        return {
          ...candidate,
          phoenixScore: r.phoenixScore,
          relevanceReason: r.relevanceReason,
          engagementPrediction: r.engagement,
          verification,
          insightScore: r.insightDensity ? r.insightDensity * 20 : undefined, // Normalize to 0-100
        };
      });

      return ranked;
    } catch (error) {
      console.error("[forYouFeed] Phoenix ranking failed:", error);
      // Fallback: simple recency-based ranking with default verification
      return candidates.map((c: FeedCandidate) => ({
        ...c,
        phoenixScore: 50,
        relevanceReason: "Fallback ranking (ranking service unavailable)",
        engagementPrediction: {
          view: 0.5,
          click: 0.3,
          save: 0.1,
          share: 0.05,
        },
        verification: {
          sourceTier: "tier3_unverified" as const,
          verificationStatus: "unverified" as const,
          confidence: 0,
          hasContradictions: false,
          badge: {
            type: "none" as const,
            label: "",
            tooltip: "",
          },
        },
      }));
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STEP 3: HOME MIXER ORCHESTRATION (50/50 Mix)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mix ranked candidates to achieve target ratio
 * Implements X's Home Mixer pattern
 */
export const mixFeed = internalAction({
  args: {
    ranked: v.array(v.any()),
    targetSize: v.number(),
  },
  handler: async (ctx, { ranked, targetSize }): Promise<RankedCandidate[]> => {
    // Separate by source
    const bySource = {
      in_network: ranked.filter((c: RankedCandidate) => c.source === "in_network"),
      out_of_network: ranked.filter((c: RankedCandidate) => c.source === "out_of_network"),
      trending: ranked.filter((c: RankedCandidate) => c.source === "trending"),
    };

    // Calculate target counts
    const targets = {
      in_network: Math.floor(targetSize * FEED_CONFIG.targetMixRatio.inNetwork),
      out_of_network: Math.floor(targetSize * FEED_CONFIG.targetMixRatio.outOfNetwork),
      trending: Math.floor(targetSize * FEED_CONFIG.targetMixRatio.trending),
    };

    // Select top items from each source
    const mixed: RankedCandidate[] = [];

    // Add in-network items
    mixed.push(...bySource.in_network.slice(0, targets.in_network));

    // Add out-of-network items
    mixed.push(...bySource.out_of_network.slice(0, targets.out_of_network));

    // Add trending items
    mixed.push(...bySource.trending.slice(0, targets.trending));

    // Interleave to avoid source clustering (X's mixing strategy)
    const interleaved: RankedCandidate[] = [];
    const maxLength = Math.max(
      mixed.filter((c) => c.source === "in_network").length,
      mixed.filter((c) => c.source === "out_of_network").length,
      mixed.filter((c) => c.source === "trending").length
    );

    for (let i = 0; i < maxLength; i++) {
      const inNetworkItem = bySource.in_network[i];
      const outOfNetworkItem = bySource.out_of_network[i];
      const trendingItem = bySource.trending[i];

      if (inNetworkItem) interleaved.push(inNetworkItem);
      if (outOfNetworkItem) interleaved.push(outOfNetworkItem);
      if (trendingItem) interleaved.push(trendingItem);
    }

    return interleaved.slice(0, targetSize);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FEED GENERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate personalized For You feed
 * Complete X algorithm pipeline: Thunder → Phoenix → Home Mixer
 */
export const generateForYouFeed = internalAction({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { userId, limit = FEED_CONFIG.defaultFeedSize }): Promise<ForYouFeedResult> => {
    console.log(`[forYouFeed] Generating feed for user ${userId}`);

    // STEP 1: Candidate Sourcing (Thunder)
    let candidates = await ctx.runAction(
      internal.domains.research.forYouFeed.getCandidates,
      { userId }
    );

    console.log(`[forYouFeed] Sourced ${candidates.length} candidates`);

    // STEP 1.5: Entity Link Enrichment (optional)
    if (FEED_CONFIG.enableEntityEnrichment) {
      candidates = await ctx.runAction(
        internal.domains.research.forYouFeed.enrichCandidatesWithEntityLinks,
        { candidates, maxEnrich: FEED_CONFIG.maxEntityEnrichment }
      );
      console.log(`[forYouFeed] Entity enrichment complete`);
    }

    // STEP 1.75: Verification Enrichment (quality signals)
    if (FEED_CONFIG.useInsightRanking) {
      candidates = await ctx.runAction(
        internal.domains.verification.integrations.feedVerification.enrichCandidatesWithVerification,
        { candidates, maxToVerify: FEED_CONFIG.maxVerificationBatch }
      );
      console.log(`[forYouFeed] Verification enrichment complete`);
    }

    // STEP 2: Phoenix ML Ranking
    const ranked = await ctx.runAction(
      internal.domains.research.forYouFeed.rankWithPhoenix,
      { userId, candidates }
    );

    console.log(`[forYouFeed] Ranked ${ranked.length} candidates`);

    // STEP 3: Home Mixer Orchestration
    const mixed = await ctx.runAction(
      internal.domains.research.forYouFeed.mixFeed,
      { ranked, targetSize: limit }
    );

    console.log(`[forYouFeed] Mixed to ${mixed.length} items`);

    // Calculate actual mix ratio
    const sourceCount = {
      in_network: mixed.filter((c) => c.source === "in_network").length,
      out_of_network: mixed.filter((c) => c.source === "out_of_network").length,
      trending: mixed.filter((c) => c.source === "trending").length,
    };

    const total = mixed.length;
    const mixRatio = {
      inNetwork: sourceCount.in_network / total,
      outOfNetwork: sourceCount.out_of_network / total,
      trending: sourceCount.trending / total,
    };

    // Compute verification metrics
    const verifiedCount = mixed.filter(
      (c) => c.verification?.sourceTier === "tier1_authoritative"
    ).length;
    const reliableCount = mixed.filter(
      (c) => c.verification?.sourceTier === "tier2_reliable"
    ).length;
    const unverifiedCount = mixed.filter(
      (c) => c.verification?.sourceTier === "tier3_unverified" || !c.verification
    ).length;
    const avgConfidence = mixed.reduce(
      (sum, c) => sum + (c.verification?.confidence || 0), 0
    ) / (total || 1);

    const verificationMetrics = {
      verifiedCount,
      reliableCount,
      unverifiedCount,
      verificationRate: (verifiedCount + reliableCount) / (total || 1),
      avgConfidence,
    };

    console.log(`[forYouFeed] Verification metrics: ${JSON.stringify(verificationMetrics)}`);

    // Group items by date
    const dateGroups = groupByDate(mixed);

    // Store feed for caching
    await ctx.runMutation(internal.domains.research.forYouFeed.saveFeedSnapshot, {
      userId,
      items: mixed,
      dateGroups,
      mixRatio,
    });

    return {
      items: mixed,
      dateGroups,
      totalCandidates: candidates.length,
      mixRatio,
      generatedAt: Date.now(),
      verificationMetrics,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get For You feed (public query)
 */
export const getForYouFeed = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit = 20 }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        items: [],
        dateGroups: [],
        totalCandidates: 0,
        mixRatio: { inNetwork: 0, outOfNetwork: 0, trending: 0 },
        generatedAt: Date.now(),
      };
    }

    // Look up user by email (users table uses Convex Auth, no by_token index)
    const user = identity.email
      ? await ctx.db
          .query("users")
          .filter((q) => q.eq(q.field("email"), identity.email))
          .first()
      : null;

    if (!user) {
      return {
        items: [],
        dateGroups: [],
        totalCandidates: 0,
        mixRatio: { inNetwork: 0, outOfNetwork: 0, trending: 0 },
        generatedAt: Date.now(),
      };
    }

    // Check for cached feed
    const cached = await ctx.db
      .query("forYouFeedSnapshots")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();

    const now = Date.now();
    const needsRefresh =
      !cached || now - cached.generatedAt > FEED_CONFIG.feedRefreshMs;

    if (needsRefresh) {
      // Trigger async feed generation
      ctx.scheduler.runAfter(0, internal.domains.research.forYouFeed.generateForYouFeed, {
        userId: user._id,
        limit,
      });
    }

    // Return cached feed (or empty if no cache yet)
    // If no dateGroups cached, compute them from items
    const items = cached?.items || [];
    const dateGroups = cached?.dateGroups || groupByDate(items as RankedCandidate[]);

    return {
      items,
      dateGroups,
      totalCandidates: cached?.totalCandidates || 0,
      mixRatio: cached?.mixRatio || { inNetwork: 0, outOfNetwork: 0, trending: 0 },
      generatedAt: cached?.generatedAt || now,
    };
  },
});

/**
 * Get public For You feed (no auth required)
 * Returns trending and out-of-network content for anonymous users
 */
export const getPublicForYouFeed = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit = 50 }) => {
    // Get trending candidates directly (no user context needed)
    const trending = await ctx.runQuery(
      internal.domains.research.forYouFeed.getTrendingCandidates,
      { limit: Math.floor(limit / 2) }
    );

    // Get a sample user to fetch out-of-network (or just use trending if no users)
    const sampleUser = await ctx.db.query("users").first();
    let outOfNetwork: FeedCandidate[] = [];

    if (sampleUser) {
      outOfNetwork = await ctx.runQuery(
        internal.domains.research.forYouFeed.getOutOfNetworkCandidates,
        { userId: sampleUser._id, limit: Math.floor(limit / 2) }
      );
    }

    // Combine and dedupe by itemId
    const seen = new Set<string>();
    const combined: FeedCandidate[] = [];

    for (const item of [...trending, ...outOfNetwork]) {
      const id = typeof item.itemId === 'string' ? item.itemId : String(item.itemId);
      if (!seen.has(id)) {
        seen.add(id);
        combined.push(item);
      }
    }

    // Sort by timestamp (most recent first) and limit
    const sorted = combined
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);

    // Add default ranking properties for UI compatibility
    const withDefaults = sorted.map(item => ({
      ...item,
      phoenixScore: 50,
      relevanceReason: "Public feed item",
      engagementPrediction: { view: 0.5, click: 0.3, save: 0.1, share: 0.05 },
      verification: {
        sourceTier: "tier3_unverified" as const,
        verificationStatus: "unverified" as const,
        confidence: 0,
        hasContradictions: false,
        badge: {
          type: "none" as const,
          label: "",
          tooltip: "",
        },
      },
    })) as RankedCandidate[];

    // Group by date
    const dateGroups = groupByDate(withDefaults);

    // Calculate mix ratio
    const sourceCount = {
      in_network: 0,
      out_of_network: sorted.filter((c) => c.source === "out_of_network").length,
      trending: sorted.filter((c) => c.source === "trending").length,
    };

    const total = sorted.length || 1;
    const mixRatio = {
      inNetwork: 0,
      outOfNetwork: sourceCount.out_of_network / total,
      trending: sourceCount.trending / total,
    };

    return {
      items: withDefaults,
      dateGroups,
      totalCandidates: combined.length,
      mixRatio,
      generatedAt: Date.now(),
      isPublic: true,
    };
  },
});

/**
 * Record engagement event
 */
export const recordEngagement = mutation({
  args: {
    itemId: v.string(),
    action: v.union(
      v.literal("view"),
      v.literal("click"),
      v.literal("save"),
      v.literal("share")
    ),
  },
  handler: async (ctx, { itemId, action }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Look up user by email (users table uses Convex Auth, no by_token index)
    const user = identity.email
      ? await ctx.db
          .query("users")
          .filter((q) => q.eq(q.field("email"), identity.email))
          .first()
      : null;

    if (!user) return;

    await ctx.db.insert("feedEngagements", {
      userId: user._id,
      itemId,
      action,
      timestamp: Date.now(),
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST QUERIES (for debugging without auth)
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// RELATED FEEDS (Google Image Search Pattern)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get related feed items based on similarity to a source item
 * Similar to Google Image Search's "Related Images" feature
 *
 * Matching strategies:
 * 1. Same tags (highest weight)
 * 2. Same source/provider
 * 3. Same item type
 * 4. Similar timestamp (within 7 days)
 * 5. Title/snippet keyword overlap
 */
export const getRelatedFeedItems = query({
  args: {
    sourceItemId: v.string(),
    sourceType: v.optional(v.string()),
    sourceTags: v.optional(v.array(v.string())),
    sourceTitle: v.optional(v.string()),
    sourceProvider: v.optional(v.string()),
    sourceTimestamp: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const {
      sourceItemId,
      sourceType,
      sourceTags = [],
      sourceTitle = "",
      sourceProvider,
      sourceTimestamp,
      limit = 8,
    } = args;

    // Extract keywords from title for matching
    const titleKeywords = sourceTitle
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);

    // Collect candidates from multiple sources
    const candidates: Array<{
      item: RankedCandidate;
      score: number;
      matchReasons: string[];
    }> = [];

    // 1. Search feedItems table
    const feedItems = await ctx.db
      .query("feedItems")
      .withIndex("by_creation_time")
      .order("desc")
      .take(100);

    for (const item of feedItems) {
      if (item._id === sourceItemId) continue;

      const matchReasons: string[] = [];
      let score = 0;

      // Tag matching (highest weight)
      const itemTags = item.tags || [];
      const tagOverlap = sourceTags.filter((t) =>
        itemTags.some((it: string) => it.toLowerCase() === t.toLowerCase())
      );
      if (tagOverlap.length > 0) {
        score += tagOverlap.length * 25;
        matchReasons.push(`Tags: ${tagOverlap.join(", ")}`);
      }

      // Source matching
      if (sourceProvider && item.source === sourceProvider) {
        score += 15;
        matchReasons.push(`Same source: ${sourceProvider}`);
      }

      // Type matching
      if (sourceType && item.type === sourceType) {
        score += 10;
        matchReasons.push(`Same type: ${sourceType}`);
      }

      // Title keyword matching
      const itemTitle = (item.title || "").toLowerCase();
      const keywordMatches = titleKeywords.filter((kw) => itemTitle.includes(kw));
      if (keywordMatches.length > 0) {
        score += keywordMatches.length * 8;
        matchReasons.push(`Keywords: ${keywordMatches.join(", ")}`);
      }

      // Recency bonus (within 7 days of source)
      if (sourceTimestamp) {
        const itemTs = item.createdAt || item._creationTime;
        const daysDiff = Math.abs(itemTs - sourceTimestamp) / (1000 * 60 * 60 * 24);
        if (daysDiff <= 7) {
          score += Math.max(0, 10 - daysDiff);
          matchReasons.push("Recent");
        }
      }

      if (score > 0) {
        candidates.push({
          item: {
            itemId: item._id,
            itemType: (item.type as ItemType) || "feed_item",
            source: "out_of_network",
            title: item.title || "Untitled",
            snippet: item.summary?.substring(0, 150) || "",
            metadata: {
              source: item.source,
              url: item.url,
              tags: item.tags,
            },
            timestamp: item.createdAt || item._creationTime,
            dateString: getDateString(item.createdAt || item._creationTime),
            phoenixScore: score,
            relevanceReason: matchReasons[0] || "Related content",
            engagementPrediction: { view: 0.6, click: 0.4, save: 0.2, share: 0.1 },
          },
          score,
          matchReasons,
        });
      }
    }

    // 2. Search industryUpdates table
    const updates = await ctx.db
      .query("industryUpdates")
      .withIndex("by_scanned_at")
      .order("desc")
      .take(50);

    for (const update of updates) {
      if (update._id === sourceItemId) continue;

      const matchReasons: string[] = [];
      let score = 0;

      // Provider matching
      if (sourceProvider && update.provider === sourceProvider) {
        score += 15;
        matchReasons.push(`Same provider: ${sourceProvider}`);
      }

      // Title keyword matching
      const updateTitle = (update.title || "").toLowerCase();
      const keywordMatches = titleKeywords.filter((kw) => updateTitle.includes(kw));
      if (keywordMatches.length > 0) {
        score += keywordMatches.length * 10;
        matchReasons.push(`Keywords: ${keywordMatches.join(", ")}`);
      }

      // High relevance bonus
      if (update.relevance && update.relevance >= 70) {
        score += 5;
        matchReasons.push("High relevance");
      }

      if (score > 0) {
        candidates.push({
          item: {
            itemId: update._id,
            itemType: "update",
            source: "out_of_network",
            title: update.title,
            snippet: update.summary?.substring(0, 150) || "",
            metadata: {
              provider: update.provider,
              url: update.url,
              relevance: update.relevance,
            },
            timestamp: update.scannedAt,
            dateString: getDateString(update.scannedAt),
            phoenixScore: score,
            relevanceReason: matchReasons[0] || "Industry update",
            engagementPrediction: { view: 0.5, click: 0.35, save: 0.15, share: 0.08 },
          },
          score,
          matchReasons,
        });
      }
    }

    // 3. Search landingPageLog (daily brief items)
    const landingItems = await ctx.db
      .query("landingPageLog")
      .withIndex("by_createdAt")
      .order("desc")
      .take(30);

    for (const item of landingItems) {
      if (item._id === sourceItemId) continue;

      const matchReasons: string[] = [];
      let score = 0;

      // Tag matching
      const itemTags = item.tags || [];
      const tagOverlap = sourceTags.filter((t) =>
        itemTags.some((it: string) => it.toLowerCase() === t.toLowerCase())
      );
      if (tagOverlap.length > 0) {
        score += tagOverlap.length * 20;
        matchReasons.push(`Tags: ${tagOverlap.join(", ")}`);
      }

      // Title keyword matching
      const itemTitle = (item.title || "").toLowerCase();
      const keywordMatches = titleKeywords.filter((kw) => itemTitle.includes(kw));
      if (keywordMatches.length > 0) {
        score += keywordMatches.length * 8;
        matchReasons.push(`Keywords: ${keywordMatches.join(", ")}`);
      }

      if (score > 0) {
        candidates.push({
          item: {
            itemId: item._id,
            itemType: "update",
            source: "trending",
            title: item.title,
            snippet: item.markdown?.substring(0, 150) || "",
            metadata: {
              kind: item.kind,
              source: item.source || "Daily Brief",
              url: item.url,
              tags: item.tags,
            },
            timestamp: item.createdAt,
            dateString: item.day || getDateString(item.createdAt),
            phoenixScore: score,
            relevanceReason: matchReasons[0] || "Daily brief",
            engagementPrediction: { view: 0.55, click: 0.38, save: 0.18, share: 0.1 },
          },
          score,
          matchReasons,
        });
      }
    }

    // Sort by score and return top results
    candidates.sort((a, b) => b.score - a.score);

    const results = candidates.slice(0, limit).map((c) => ({
      ...c.item,
      matchScore: c.score,
      matchReasons: c.matchReasons,
    }));

    return {
      items: results,
      totalCandidates: candidates.length,
      sourceItemId,
    };
  },
});

/**
 * Test query to verify candidate sourcing works (no auth required)
 */
export const testCandidateSourcing = query({
  args: {},
  handler: async (ctx) => {
    const trending = await ctx.runQuery(internal.domains.research.forYouFeed.getTrendingCandidates, {
      limit: 10,
    });

    // Get a sample user to test out-of-network
    const sampleUser = await ctx.db.query("users").first();
    let outOfNetwork: FeedCandidate[] = [];
    if (sampleUser) {
      outOfNetwork = await ctx.runQuery(internal.domains.research.forYouFeed.getOutOfNetworkCandidates, {
        userId: sampleUser._id,
        limit: 10,
      });
    }

    return {
      trendingCount: trending.length,
      trendingSample: trending[0],
      outOfNetworkCount: outOfNetwork.length,
      outOfNetworkSample: outOfNetwork[0],
    };
  },
});
