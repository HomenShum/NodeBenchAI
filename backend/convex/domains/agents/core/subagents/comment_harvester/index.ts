/**
 * Comment Harvester Agent
 *
 * Extracts high-signal commentary as sentiment evidence from:
 * - Hacker News comments
 * - Reddit threads
 * - X/Twitter replies
 * - LinkedIn comments
 *
 * Rules:
 * - Never treats comments as facts (they are sentiment/stance evidence only)
 * - Extracts: recurring questions, consensus/dissent, notable quotes with provenance
 * - Attributes everything to source + timestamp
 * - Flags for credibility tier: verified_expert | industry_participant | general_public
 *
 * @module domains/agents/core/subagents/comment_harvester
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../../../../_generated/server";
import { internal } from "../../../../../_generated/api";

// Note: storeSentimentEvidence mutation is in mutations.ts (mutations cannot be in "use node" files)
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type Stance = "support" | "dissent" | "question" | "neutral";
export type CredibilityTier = "verified_expert" | "industry_participant" | "general_public";
export type SourcePlatform = "hackernews" | "reddit" | "twitter" | "linkedin" | "other";

export interface SentimentSignal {
  quote: string;
  stance: Stance;
  source: string; // e.g., "hn_comment_12345"
  sourceUrl?: string;
  platform: SourcePlatform;
  authorHandle?: string;
  authorCredibility: CredibilityTier;
  timestamp: number;
  upvotes?: number;
  replies?: number;
}

export interface HarvestResult {
  sentimentSignals: SentimentSignal[];
  consensusTopics: string[];
  openQuestions: string[];
  dissensusPoints: string[];
  summary: string;
}

export interface CommentSource {
  platform: SourcePlatform;
  url: string;
  title?: string;
  rawComments?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export interface CommentHarvesterConfig {
  model?: string;
  maxCommentsPerSource?: number;
  minUpvotesThreshold?: number;
  includeReplies?: boolean;
}

const DEFAULT_CONFIG: Required<CommentHarvesterConfig> = {
  model: "gpt-5.4-nano",
  maxCommentsPerSource: 50,
  minUpvotesThreshold: 2,
  includeReplies: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// COMMENT FETCHING (Stubs - would integrate with actual APIs)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch comments from Hacker News
 * In production, this would use the HN API
 */
async function fetchHNComments(storyId: string): Promise<string[]> {
  // Stub - would call https://hacker-news.firebaseio.com/v0/item/{id}.json
  console.log(`[CommentHarvester] Would fetch HN comments for story ${storyId}`);
  return [];
}

/**
 * Fetch comments from Reddit
 * In production, this would use the Reddit API
 */
async function fetchRedditComments(postUrl: string): Promise<string[]> {
  // Stub - would call Reddit API
  console.log(`[CommentHarvester] Would fetch Reddit comments for ${postUrl}`);
  return [];
}

/**
 * Fetch replies from Twitter/X
 * In production, this would use the Twitter API
 */
async function fetchTwitterReplies(tweetId: string): Promise<string[]> {
  // Stub - would call Twitter API
  console.log(`[CommentHarvester] Would fetch Twitter replies for ${tweetId}`);
  return [];
}

// ═══════════════════════════════════════════════════════════════════════════
// SENTIMENT ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build prompt for sentiment extraction
 */
function buildSentimentPrompt(
  topic: string,
  comments: string[],
  platform: SourcePlatform
): string {
  const commentsText = comments
    .slice(0, 30)
    .map((c, i) => `${i + 1}. ${c.slice(0, 500)}`)
    .join("\n\n");

  return `You are a sentiment analyst extracting public discourse signals.

## TOPIC
${topic}

## PLATFORM
${platform} (consider platform-specific communication styles)

## COMMENTS
${commentsText}

## TASK
Analyze these comments and extract:

1. **Sentiment Signals** - Notable quotes with stance classification
   - stance: "support" (agrees with topic), "dissent" (disagrees), "question" (asks for clarification), "neutral" (informational)
   - authorCredibility: "verified_expert" (clear domain expertise), "industry_participant" (works in related field), "general_public" (no special credentials)

2. **Consensus Topics** - Points where most commenters agree

3. **Open Questions** - Recurring questions that weren't answered

4. **Dissensus Points** - Topics with significant disagreement

IMPORTANT: Comments are OPINIONS, not facts. Never treat them as factual claims.

Return JSON:
{
  "sentimentSignals": [
    {
      "quote": "exact quote from comment",
      "stance": "support" | "dissent" | "question" | "neutral",
      "authorCredibility": "verified_expert" | "industry_participant" | "general_public",
      "commentIndex": 0
    }
  ],
  "consensusTopics": ["topic 1", "topic 2"],
  "openQuestions": ["question 1", "question 2"],
  "dissensusPoints": ["disagreement 1"],
  "summary": "Brief summary of public sentiment"
}`;
}

/**
 * Extract sentiment signals from comments using LLM
 */
export const analyzeSentiment = internalAction({
  args: {
    topic: v.string(),
    comments: v.array(v.string()),
    platform: v.union(
      v.literal("hackernews"),
      v.literal("reddit"),
      v.literal("twitter"),
      v.literal("linkedin"),
      v.literal("other")
    ),
    sourceUrl: v.optional(v.string()),
    config: v.optional(v.object({
      model: v.optional(v.string()),
    })),
  },
  handler: async (_ctx, args) => {
    const config = { ...DEFAULT_CONFIG, ...args.config };

    if (args.comments.length === 0) {
      return {
        sentimentSignals: [],
        consensusTopics: [],
        openQuestions: [],
        dissensusPoints: [],
        summary: "No comments to analyze",
      };
    }

    const prompt = buildSentimentPrompt(args.topic, args.comments, args.platform);

    try {
      const result = await generateText({
        model: openai.chat(config.model),
        prompt,
        temperature: 0.2,
      });

      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          sentimentSignals: [],
          consensusTopics: [],
          openQuestions: [],
          dissensusPoints: [],
          summary: "Failed to parse LLM response",
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Enrich signals with platform-specific metadata
      const signals: SentimentSignal[] = (parsed.sentimentSignals || []).map((s: any) => ({
        quote: s.quote,
        stance: s.stance,
        source: `${args.platform}_comment_${s.commentIndex || 0}`,
        sourceUrl: args.sourceUrl,
        platform: args.platform,
        authorCredibility: s.authorCredibility || "general_public",
        timestamp: Date.now(),
      }));

      return {
        sentimentSignals: signals,
        consensusTopics: parsed.consensusTopics || [],
        openQuestions: parsed.openQuestions || [],
        dissensusPoints: parsed.dissensusPoints || [],
        summary: parsed.summary || "",
      };
    } catch (error) {
      console.error("[CommentHarvester] Sentiment analysis error:", error);
      return {
        sentimentSignals: [],
        consensusTopics: [],
        openQuestions: [],
        dissensusPoints: [],
        summary: "Error during analysis",
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HARVEST PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Full harvest pipeline for a discussion URL
 */
export const harvestComments = internalAction({
  args: {
    threadId: v.id("narrativeThreads"),
    topic: v.string(),
    sources: v.array(v.object({
      platform: v.union(
        v.literal("hackernews"),
        v.literal("reddit"),
        v.literal("twitter"),
        v.literal("linkedin"),
        v.literal("other")
      ),
      url: v.string(),
      rawComments: v.optional(v.array(v.string())),
    })),
  },
  handler: async (ctx, args) => {
    const allResults: HarvestResult[] = [];

    for (const source of args.sources) {
      // Get comments (use provided or fetch)
      let comments = source.rawComments || [];

      if (comments.length === 0) {
        // Would fetch from API in production
        switch (source.platform) {
          case "hackernews":
            // Extract story ID from URL
            const hnMatch = source.url.match(/item\?id=(\d+)/);
            if (hnMatch) {
              comments = await fetchHNComments(hnMatch[1]);
            }
            break;
          case "reddit":
            comments = await fetchRedditComments(source.url);
            break;
          case "twitter":
            const twitterMatch = source.url.match(/status\/(\d+)/);
            if (twitterMatch) {
              comments = await fetchTwitterReplies(twitterMatch[1]);
            }
            break;
        }
      }

      // Analyze sentiment
      const result = await ctx.runAction(
        internal.domains.agents.core.subagents.comment_harvester.analyzeSentiment,
        {
          topic: args.topic,
          comments,
          platform: source.platform,
          sourceUrl: source.url,
        }
      );

      allResults.push(result);

      // Store if we got signals
      if (result.sentimentSignals.length > 0) {
        await ctx.runMutation(
          internal.domains.agents.core.subagents.comment_harvester.mutations.storeSentimentEvidence,
          {
            threadId: args.threadId,
            harvestResult: result,
            sourceUrl: source.url,
            platform: source.platform,
          }
        );
      }
    }

    // Aggregate results
    const aggregated: HarvestResult = {
      sentimentSignals: allResults.flatMap(r => r.sentimentSignals),
      consensusTopics: [...new Set(allResults.flatMap(r => r.consensusTopics))],
      openQuestions: [...new Set(allResults.flatMap(r => r.openQuestions))],
      dissensusPoints: [...new Set(allResults.flatMap(r => r.dissensusPoints))],
      summary: allResults.map(r => r.summary).filter(Boolean).join(" | "),
    };

    return {
      sourcesProcessed: args.sources.length,
      totalSignals: aggregated.sentimentSignals.length,
      result: aggregated,
    };
  },
});
