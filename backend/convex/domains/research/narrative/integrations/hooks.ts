/**
 * Narrative Integration Hooks
 *
 * Real-time integration hooks that push content from other pipelines
 * into the DRANE narrative system. These hooks are called when content
 * is created in source systems (LinkedIn, Briefs, Feed) to enable
 * immediate narrative event creation instead of waiting for weekly cron.
 *
 * Hook Types:
 * - onFundingPostCreated: LinkedIn funding post → NarrativeEvent
 * - onBriefGenerated: Daily brief → NarrativeEvent (high priority only)
 * - onFeedItemRanked: ForYouFeed item → NarrativeEvent (high score only)
 *
 * @module domains/narrative/integrations/hooks
 */

import { v } from "convex/values";
import { internalMutation, internalAction } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import type { Id } from "../../../../_generated/dataModel";
import { fnv1a32Hex } from "../adapters/types";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Thresholds for triggering narrative events
 */
const INTEGRATION_CONFIG = {
  /** Minimum funding amount (in millions) to create narrative event */
  fundingMinAmountMillions: 10,
  /** Minimum brief feature priority to create narrative event */
  briefMinPriority: 7,
  /** Minimum phoenix score to create narrative event */
  feedMinPhoenixScore: 75,
  /** Enable/disable real-time hooks (can be toggled for testing) */
  enabled: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// ENTITY EXTRACTION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Known company patterns for entity extraction
 */
const COMPANY_PATTERNS = [
  "OpenAI", "Google", "Microsoft", "Apple", "Meta", "Amazon",
  "Anthropic", "xAI", "Tesla", "Nvidia", "DeepSeek", "Mistral",
  "Perplexity", "Cohere", "Hugging Face", "Stability AI", "Midjourney",
  "Databricks", "Snowflake", "Palantir", "Stripe", "SpaceX",
  "Figma", "Notion", "Linear", "Vercel", "Supabase", "Convex",
];

/**
 * Extract entity keys from text content
 */
function extractEntityKeys(content: string): string[] {
  const entities: string[] = [];
  const lowerContent = content.toLowerCase();

  for (const company of COMPANY_PATTERNS) {
    if (lowerContent.includes(company.toLowerCase())) {
      entities.push(`company:${company.toLowerCase().replace(/\s+/g, "_")}`);
    }
  }

  return [...new Set(entities)];
}

/**
 * Parse funding amount from string (e.g., "$500M" → 500)
 */
function parseFundingAmountMillions(amount: string): number {
  const cleaned = amount.replace(/[,$]/g, "").trim().toUpperCase();

  // Handle different formats: "500M", "1.5B", "500 million", etc.
  const match = cleaned.match(/^([\d.]+)\s*(M|MILLION|B|BILLION)?$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = (match[2] || "M").toUpperCase();

  if (unit.startsWith("B")) {
    return value * 1000; // Billions to millions
  }
  return value;
}

/**
 * Determine event significance from funding amount
 */
function fundingToSignificance(
  amountMillions: number
): "minor" | "moderate" | "major" | "plot_twist" {
  if (amountMillions >= 100) return "plot_twist";
  if (amountMillions >= 50) return "major";
  if (amountMillions >= 10) return "moderate";
  return "minor";
}

/**
 * Get current week number in ISO format (YYYY-Www)
 */
function getCurrentWeekNumber(): string {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - jan1.getTime()) / 86400000);
  const weekNum = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${weekNum.toString().padStart(2, "0")}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// LINKEDIN FUNDING POST HOOK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hook called when a LinkedIn funding post is created.
 * Creates a narrative event immediately for significant funding rounds.
 */
export const onFundingPostCreated = internalMutation({
  args: {
    postId: v.id("linkedinFundingPosts"),
    companyName: v.string(),
    fundingAmount: v.string(),
    fundingRound: v.optional(v.string()),
    investors: v.optional(v.array(v.string())),
    linkedinUrl: v.string(),
    publishedAt: v.number(),
  },
  returns: v.union(v.id("narrativeEvents"), v.null()),
  handler: async (ctx, args) => {
    if (!INTEGRATION_CONFIG.enabled) {
      console.log("[NarrativeHook] Hooks disabled, skipping funding post");
      return null;
    }

    const amountMillions = parseFundingAmountMillions(args.fundingAmount);

    // Skip low-value rounds
    if (amountMillions < INTEGRATION_CONFIG.fundingMinAmountMillions) {
      console.log(
        `[NarrativeHook] Skipping funding post: $${amountMillions}M < $${INTEGRATION_CONFIG.fundingMinAmountMillions}M threshold`
      );
      return null;
    }

    const significance = fundingToSignificance(amountMillions);
    const entityKey = `company:${args.companyName.toLowerCase().replace(/\s+/g, "_")}`;
    const weekNumber = getCurrentWeekNumber();

    // Find or create thread for this entity
    let thread = await ctx.db
      .query("narrativeThreads")
      .withIndex("by_entity", (q) => q.eq("primaryEntityKey", entityKey))
      .first();

    if (!thread) {
      // Create new thread for this company
      const threadId = `nt_${fnv1a32Hex(entityKey + Date.now())}`;
      const newThreadId = await ctx.db.insert("narrativeThreads", {
        threadId,
        name: `${args.companyName} Funding Journey`,
        slug: `${args.companyName.toLowerCase().replace(/\s+/g, "-")}-funding`,
        primaryEntityKey: entityKey,
        entityKeys: [entityKey],
        topicTags: ["funding", "venture-capital"],
        thesis: `Tracking ${args.companyName}'s funding and growth trajectory.`,
        currentPhase: "emerging",
        firstEventAt: args.publishedAt,
        latestEventAt: args.publishedAt,
        eventCount: 0,
        plotTwistCount: 0,
        quality: {
          hasMultipleSources: false,
          hasRecentActivity: true,
          hasVerifiedClaims: false,
          hasCounterNarrative: false,
        },
        isPublic: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      thread = await ctx.db.get(newThreadId);
    }

    if (!thread) {
      console.error("[NarrativeHook] Failed to create/find thread");
      return null;
    }

    // Build headline
    const roundText = args.fundingRound ? ` ${args.fundingRound}` : "";
    const headline = `${args.companyName} raises ${args.fundingAmount}${roundText}`;

    // Build summary with investor info
    let summary = `${args.companyName} has raised ${args.fundingAmount}`;
    if (args.fundingRound) {
      summary += ` in a ${args.fundingRound} round`;
    }
    if (args.investors && args.investors.length > 0) {
      summary += `. Investors include ${args.investors.slice(0, 3).join(", ")}`;
      if (args.investors.length > 3) {
        summary += ` and ${args.investors.length - 3} others`;
      }
    }
    summary += ".";

    // Create narrative event
    const eventId = `ne_${fnv1a32Hex(headline + args.publishedAt)}`;
    const narrativeEventId = await ctx.db.insert("narrativeEvents", {
      eventId,
      threadId: thread._id,
      headline,
      summary,
      significance,
      occurredAt: args.publishedAt,
      discoveredAt: Date.now(),
      weekNumber,
      sourceUrls: [args.linkedinUrl],
      sourceNames: ["LinkedIn"],
      citationIds: [`websrc_${fnv1a32Hex(args.linkedinUrl)}`],
      discoveredByAgent: "LinkedInFundingHook",
      agentConfidence: 0.95,
      isVerified: false,
      hasContradictions: false,
      createdAt: Date.now(),
    });

    // Update thread metrics
    await ctx.db.patch(thread._id, {
      latestEventAt: args.publishedAt,
      eventCount: (thread.eventCount || 0) + 1,
      plotTwistCount:
        significance === "plot_twist"
          ? (thread.plotTwistCount || 0) + 1
          : thread.plotTwistCount,
      quality: {
        ...thread.quality,
        hasRecentActivity: true,
      },
      updatedAt: Date.now(),
    });

    // Create temporal fact for funding
    const factId = `tf_${fnv1a32Hex(entityKey + "raised_funding" + args.publishedAt)}`;
    await ctx.db.insert("temporalFacts", {
      factId,
      threadId: thread._id,
      claimText: headline,
      subject: entityKey,
      predicate: "raised_funding",
      object: `${args.fundingAmount}${roundText}`,
      validFrom: args.publishedAt,
      observedAt: Date.now(),
      recordedAt: Date.now(),
      confidence: 0.95,
      sourceEventIds: [narrativeEventId],
      weekNumber,
      createdAt: Date.now(),
    });

    console.log(
      `[NarrativeHook] Created funding event: ${headline} (${significance})`
    );

    return narrativeEventId;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// DAILY BRIEF HOOK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hook called when a daily brief is generated.
 * Creates narrative events for high-priority features.
 */
export const onBriefGenerated = internalMutation({
  args: {
    briefId: v.id("dailyBriefMemories"),
    features: v.array(
      v.object({
        headline: v.string(),
        summary: v.string(),
        priority: v.number(),
        status: v.optional(v.string()),
        sourceUrls: v.optional(v.array(v.string())),
        type: v.optional(v.string()),
      })
    ),
    generatedAt: v.number(),
  },
  returns: v.object({
    eventsCreated: v.number(),
    eventIds: v.array(v.id("narrativeEvents")),
  }),
  handler: async (ctx, args) => {
    if (!INTEGRATION_CONFIG.enabled) {
      console.log("[NarrativeHook] Hooks disabled, skipping brief");
      return { eventsCreated: 0, eventIds: [] };
    }

    const eventIds: Id<"narrativeEvents">[] = [];
    const weekNumber = getCurrentWeekNumber();

    // Filter high-priority features
    const highPriorityFeatures = args.features.filter(
      (f) =>
        f.priority >= INTEGRATION_CONFIG.briefMinPriority ||
        (f.status === "passing" && f.priority >= 5)
    );

    for (const feature of highPriorityFeatures) {
      const entityKeys = extractEntityKeys(feature.headline + " " + feature.summary);

      if (entityKeys.length === 0) {
        // Skip if no known entities found
        continue;
      }

      const primaryEntityKey = entityKeys[0];

      // Find or create thread
      let thread = await ctx.db
        .query("narrativeThreads")
        .withIndex("by_entity", (q) => q.eq("primaryEntityKey", primaryEntityKey))
        .first();

      if (!thread) {
        const entityName = primaryEntityKey.split(":")[1]?.replace(/_/g, " ") || "Unknown";
        const threadId = `nt_${fnv1a32Hex(primaryEntityKey + Date.now())}`;
        const newThreadId = await ctx.db.insert("narrativeThreads", {
          threadId,
          name: `${entityName} Research Thread`,
          slug: `${entityName.toLowerCase().replace(/\s+/g, "-")}-research`,
          primaryEntityKey,
          entityKeys,
          topicTags: feature.type ? [feature.type] : ["research"],
          thesis: `Tracking developments related to ${entityName}.`,
          currentPhase: "emerging",
          firstEventAt: args.generatedAt,
          latestEventAt: args.generatedAt,
          eventCount: 0,
          plotTwistCount: 0,
          quality: {
            hasMultipleSources: (feature.sourceUrls?.length || 0) > 1,
            hasRecentActivity: true,
            hasVerifiedClaims: false,
            hasCounterNarrative: false,
          },
          isPublic: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        thread = await ctx.db.get(newThreadId);
      }

      if (!thread) continue;

      // Determine significance from priority
      const significance: "minor" | "moderate" | "major" | "plot_twist" =
        feature.priority >= 9
          ? "major"
          : feature.priority >= 7
            ? "moderate"
            : "minor";

      // Create event
      const eventId = `ne_${fnv1a32Hex(feature.headline + args.generatedAt)}`;
      const narrativeEventId = await ctx.db.insert("narrativeEvents", {
        eventId,
        threadId: thread._id,
        headline: feature.headline,
        summary: feature.summary,
        significance,
        occurredAt: args.generatedAt,
        discoveredAt: Date.now(),
        weekNumber,
        sourceUrls: feature.sourceUrls || [],
        sourceNames: ["Daily Brief"],
        citationIds: (feature.sourceUrls || []).map(
          (url) => `websrc_${fnv1a32Hex(url)}`
        ),
        discoveredByAgent: "DailyBriefHook",
        agentConfidence: 0.85,
        isVerified: false,
        hasContradictions: false,
        createdAt: Date.now(),
      });

      eventIds.push(narrativeEventId);

      // Update thread
      await ctx.db.patch(thread._id, {
        latestEventAt: args.generatedAt,
        eventCount: (thread.eventCount || 0) + 1,
        quality: {
          ...thread.quality,
          hasRecentActivity: true,
          hasMultipleSources:
            thread.quality.hasMultipleSources ||
            (feature.sourceUrls?.length || 0) > 1,
        },
        updatedAt: Date.now(),
      });
    }

    console.log(
      `[NarrativeHook] Brief processed: ${eventIds.length} events from ${highPriorityFeatures.length} high-priority features`
    );

    return { eventsCreated: eventIds.length, eventIds };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// FEED ITEM HOOK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hook called when a feed item receives a high phoenix score.
 * Creates narrative event and context enrichment.
 */
export const onFeedItemRanked = internalMutation({
  args: {
    itemId: v.string(),
    title: v.string(),
    summary: v.optional(v.string()),
    phoenixScore: v.number(),
    entityRefs: v.optional(v.array(v.string())),
    sourceUrl: v.optional(v.string()),
    categoryType: v.optional(v.string()),
    emotion: v.optional(v.string()),
    rankedAt: v.number(),
  },
  returns: v.union(v.id("narrativeEvents"), v.null()),
  handler: async (ctx, args) => {
    if (!INTEGRATION_CONFIG.enabled) {
      console.log("[NarrativeHook] Hooks disabled, skipping feed item");
      return null;
    }

    // Skip low-score items
    if (args.phoenixScore < INTEGRATION_CONFIG.feedMinPhoenixScore) {
      return null;
    }

    const entityKeys =
      args.entityRefs ||
      extractEntityKeys(args.title + " " + (args.summary || ""));

    if (entityKeys.length === 0) {
      return null;
    }

    const primaryEntityKey = entityKeys[0];
    const weekNumber = getCurrentWeekNumber();

    // Find thread
    let thread = await ctx.db
      .query("narrativeThreads")
      .withIndex("by_entity", (q) => q.eq("primaryEntityKey", primaryEntityKey))
      .first();

    if (!thread) {
      // For feed items, don't create new threads - only enrich existing ones
      console.log(
        `[NarrativeHook] No thread for ${primaryEntityKey}, skipping feed item`
      );
      return null;
    }

    // Determine significance from score
    const significance: "minor" | "moderate" | "major" =
      args.phoenixScore >= 90 ? "major" : args.phoenixScore >= 80 ? "moderate" : "minor";

    // Create event
    const eventId = `ne_${fnv1a32Hex(args.title + args.rankedAt)}`;
    const narrativeEventId = await ctx.db.insert("narrativeEvents", {
      eventId,
      threadId: thread._id,
      headline: args.title,
      summary: args.summary || args.title,
      significance,
      occurredAt: args.rankedAt,
      discoveredAt: Date.now(),
      weekNumber,
      sourceUrls: args.sourceUrl ? [args.sourceUrl] : [],
      sourceNames: ["ForYouFeed"],
      citationIds: args.sourceUrl ? [`websrc_${fnv1a32Hex(args.sourceUrl)}`] : [],
      discoveredByAgent: "FeedRankingHook",
      agentConfidence: args.phoenixScore / 100,
      isVerified: false,
      hasContradictions: false,
      createdAt: Date.now(),
    });

    // Update thread
    await ctx.db.patch(thread._id, {
      latestEventAt: args.rankedAt,
      eventCount: (thread.eventCount || 0) + 1,
      quality: {
        ...thread.quality,
        hasRecentActivity: true,
      },
      updatedAt: Date.now(),
    });

    // Store context enrichment for sentiment tracking
    if (args.emotion) {
      await ctx.db.insert("narrativeSentiment", {
        threadId: thread._id,
        entityKey: primaryEntityKey,
        weekNumber,
        overallSentiment: emotionToSentiment(args.emotion),
        sentimentScore: emotionToScore(args.emotion),
        sentimentDelta: 0, // Would need historical comparison
        mentionCount: 1,
        sourceCount: args.sourceUrl ? 1 : 0,
        representativeQuotes: [],
        topTopics: args.categoryType ? [args.categoryType] : [],
        createdAt: Date.now(),
      });
    }

    console.log(
      `[NarrativeHook] Feed item created event: ${args.title} (score: ${args.phoenixScore})`
    );

    return narrativeEventId;
  },
});

/**
 * Map emotion color to sentiment
 */
function emotionToSentiment(
  emotion: string
): "very_negative" | "negative" | "neutral" | "positive" | "very_positive" {
  switch (emotion.toLowerCase()) {
    case "green":
    case "positive":
      return "positive";
    case "red":
    case "negative":
      return "negative";
    case "yellow":
    case "cautious":
      return "neutral";
    case "blue":
    case "calm":
      return "neutral";
    default:
      return "neutral";
  }
}

/**
 * Map emotion to sentiment score
 */
function emotionToScore(emotion: string): number {
  switch (emotion.toLowerCase()) {
    case "green":
    case "positive":
      return 0.7;
    case "red":
    case "negative":
      return -0.5;
    case "yellow":
    case "cautious":
      return 0.1;
    default:
      return 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FEED PROCESSING (Scheduled/On-Demand)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process recent feed items with high phoenix scores into narrative events.
 * Called from a daily cron or on-demand. This is a pull-based alternative
 * to real-time hooks since ForYouFeed scores items at query time.
 */
export const processFeedItemsToNarrative = internalAction({
  args: {
    lookbackDays: v.optional(v.number()),
    minPhoenixScore: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    processed: v.number(),
    created: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    const lookbackDays = args.lookbackDays || 1;
    const minScore = args.minPhoenixScore || INTEGRATION_CONFIG.feedMinPhoenixScore;

    // Get recent feed candidates
    const candidates = await ctx.runQuery(
      internal.domains.narrative.adapters.pipelineQueries.getRecentFeedCandidates,
      { lookbackDays, minPhoenixScore: minScore }
    );

    let created = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      if (args.dryRun) {
        console.log(`[FeedProcess] Would process: ${candidate.title} (score: ${candidate.phoenixScore})`);
        skipped++;
        continue;
      }

      const result = await ctx.runMutation(
        internal.domains.narrative.integrations.hooks.onFeedItemRanked,
        {
          itemId: String(candidate._id),
          title: candidate.title || "Untitled",
          summary: candidate.summary,
          phoenixScore: candidate.phoenixScore || 0,
          entityRefs: candidate.entityRefs,
          sourceUrl: candidate.url,
          categoryType: candidate.categoryType,
          emotion: candidate.emotion,
          rankedAt: candidate.createdAt || Date.now(),
        }
      );

      if (result) {
        created++;
      } else {
        skipped++;
      }
    }

    console.log(
      `[FeedProcess] Complete: ${candidates.length} items processed, ${created} created, ${skipped} skipped`
    );

    return { processed: candidates.length, created, skipped };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// BATCH PROCESSING FOR EXISTING CONTENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Backfill narrative events from existing LinkedIn funding posts.
 * Useful for initial setup or catching up after hook deployment.
 */
export const backfillFundingPosts = internalAction({
  args: {
    lookbackDays: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    processed: v.number(),
    created: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    const lookbackMs = (args.lookbackDays || 30) * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;

    // Get recent funding posts
    const posts = await ctx.runQuery(
      internal.domains.narrative.adapters.pipelineQueries.getRecentFundingPosts,
      { lookbackDays: args.lookbackDays || 30 }
    );

    let created = 0;
    let skipped = 0;

    for (const post of posts) {
      if (args.dryRun) {
        console.log(`[Backfill] Would process: ${post.companyName} - ${post.amount}`);
        skipped++;
        continue;
      }

      const result = await ctx.runMutation(
        internal.domains.narrative.integrations.hooks.onFundingPostCreated,
        {
          postId: post._id,
          companyName: post.companyName,
          fundingAmount: post.amount,
          fundingRound: post.round,
          investors: post.investors,
          linkedinUrl: post.linkedinUrl || "",
          publishedAt: post.publishedAt || Date.now(),
        }
      );

      if (result) {
        created++;
      } else {
        skipped++;
      }
    }

    console.log(
      `[Backfill] Complete: ${posts.length} posts processed, ${created} created, ${skipped} skipped`
    );

    return { processed: posts.length, created, skipped };
  },
});
