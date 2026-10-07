/**
 * Comment Harvester Agent - Social Commentary Collection
 *
 * Pulls high-signal commentary from community sources and extracts
 * as evidence artifacts. Comments are NEVER treated as facts—they
 * represent sentiment, stance, and discourse evidence.
 *
 * Sources:
 * - Hacker News (HN)
 * - Reddit
 * - X/Twitter
 *
 * Outputs:
 * - Evidence artifacts (tier3_community credibility)
 * - Sentiment signals
 * - Notable quotes for narrative enrichment
 *
 * @module domains/narrative/newsroom/agents/commentHarvester
 */

import type { ActionCtx } from "../../../../../_generated/server";
import { internal } from "../../../../../_generated/api";
import type { NewsroomState } from "../state";

/**
 * Configuration for Comment Harvester
 */
export interface CommentHarvesterConfig {
  /** Enable Hacker News scraping */
  enableHN?: boolean;
  /** Enable Reddit scraping */
  enableReddit?: boolean;
  /** Enable X/Twitter scraping */
  enableX?: boolean;
  /** Minimum comment score/karma threshold */
  minScore?: number;
  /** Maximum comments to harvest per source */
  maxPerSource?: number;
  /** Lookback hours for recent comments */
  lookbackHours?: number;
}

const DEFAULT_CONFIG: Required<CommentHarvesterConfig> = {
  enableHN: true,
  enableReddit: true,
  enableX: false, // Requires API access
  minScore: 10,
  maxPerSource: 20,
  lookbackHours: 168, // 7 days
};

/**
 * Stance classification for comments
 */
type CommentStance = "bullish" | "bearish" | "neutral" | "questioning" | "skeptical";

/**
 * Harvested comment structure
 */
interface HarvestedComment {
  source: "hacker_news" | "reddit" | "twitter";
  url: string;
  author: string;
  content: string;
  score: number;
  timestamp: number;
  parentUrl?: string; // Original article/post being discussed
  stance: CommentStance;
  isNotableQuote: boolean;
  entityMentions: string[];
}

/**
 * Comment harvest result
 */
interface HarvestResult {
  comments: HarvestedComment[];
  sentimentSummary: {
    bullish: number;
    bearish: number;
    neutral: number;
    questioning: number;
    skeptical: number;
  };
  notableQuotes: Array<{
    quote: string;
    author: string;
    source: string;
    stance: CommentStance;
  }>;
  errors: string[];
}

/**
 * Classify comment stance using heuristics.
 * TODO: Replace with LLM-based classification for better accuracy.
 */
function classifyStance(content: string): CommentStance {
  const lowerContent = content.toLowerCase();

  // Bullish indicators
  const bullishPatterns = [
    /\b(bullish|optimistic|excited|promising|breakthrough|revolutionary)\b/,
    /\b(will (dominate|win|succeed)|game.?changer)\b/,
    /\b(incredible|amazing|impressive)\b/,
    /\b(bought|buying|long|invested)\b/,
  ];

  // Bearish indicators
  const bearishPatterns = [
    /\b(bearish|pessimistic|concerned|worried|overvalued)\b/,
    /\b(will (fail|crash|struggle)|bubble|hype)\b/,
    /\b(scam|fraud|ponzi)\b/,
    /\b(sold|selling|short|divested)\b/,
  ];

  // Questioning indicators
  const questioningPatterns = [
    /\?\s*$/,
    /\b(why|how|what if|wonder)\b/,
    /\b(anyone know|curious|confused)\b/,
  ];

  // Skeptical indicators
  const skepticalPatterns = [
    /\b(skeptical|doubtful|suspicious|questionable)\b/,
    /\b(not sure|don't believe|remains to be seen)\b/,
    /\b(overhyped|overrated|marketing)\b/,
  ];

  let bullishScore = 0;
  let bearishScore = 0;
  let questioningScore = 0;
  let skepticalScore = 0;

  for (const pattern of bullishPatterns) {
    if (pattern.test(lowerContent)) bullishScore++;
  }
  for (const pattern of bearishPatterns) {
    if (pattern.test(lowerContent)) bearishScore++;
  }
  for (const pattern of questioningPatterns) {
    if (pattern.test(lowerContent)) questioningScore++;
  }
  for (const pattern of skepticalPatterns) {
    if (pattern.test(lowerContent)) skepticalScore++;
  }

  // Determine dominant stance
  const scores = [
    { stance: "bullish" as CommentStance, score: bullishScore },
    { stance: "bearish" as CommentStance, score: bearishScore },
    { stance: "questioning" as CommentStance, score: questioningScore },
    { stance: "skeptical" as CommentStance, score: skepticalScore },
  ];

  const maxScore = Math.max(...scores.map((s) => s.score));
  if (maxScore === 0) return "neutral";

  const dominant = scores.find((s) => s.score === maxScore);
  return dominant?.stance || "neutral";
}

/**
 * Check if a comment is notable enough to quote directly.
 */
function isNotableQuote(comment: HarvestedComment): boolean {
  // Notable if:
  // 1. High score
  // 2. Strong stance (not neutral)
  // 3. Contains specific claims or predictions
  // 4. Reasonable length (not too short or too long)

  const contentLength = comment.content.length;
  const hasSpecificClaim = /\b(will|expect|predict|believe|think)\b/.test(comment.content);

  return (
    comment.score >= 50 &&
    comment.stance !== "neutral" &&
    hasSpecificClaim &&
    contentLength > 100 &&
    contentLength < 500
  );
}

/**
 * Extract entity mentions from comment text.
 */
function extractEntityMentions(content: string, targetEntities: string[]): string[] {
  const mentions: string[] = [];
  const lowerContent = content.toLowerCase();

  for (const entityKey of targetEntities) {
    // Parse entity key format: "type:identifier"
    const [, identifier] = entityKey.split(":");
    const searchTerm = (identifier || entityKey)
      .toLowerCase()
      .replace(/_/g, " ");

    if (lowerContent.includes(searchTerm)) {
      mentions.push(entityKey);
    }
  }

  return mentions;
}

/**
 * Simulated HN comment fetcher.
 * In production, this would use the HN API or Algolia.
 */
async function fetchHNComments(
  _ctx: ActionCtx,
  entityKeys: string[],
  _config: Required<CommentHarvesterConfig>
): Promise<HarvestedComment[]> {
  // Placeholder - would use HN Algolia API
  console.log(`[CommentHarvester] HN fetch for entities: ${entityKeys.join(", ")}`);

  // Return empty for now - in production would fetch real comments
  return [];
}

/**
 * Simulated Reddit comment fetcher.
 * In production, this would use the Reddit API.
 */
async function fetchRedditComments(
  _ctx: ActionCtx,
  entityKeys: string[],
  _config: Required<CommentHarvesterConfig>
): Promise<HarvestedComment[]> {
  // Placeholder - would use Reddit API
  console.log(`[CommentHarvester] Reddit fetch for entities: ${entityKeys.join(", ")}`);

  // Return empty for now - in production would fetch real comments
  return [];
}

/**
 * Simulated X/Twitter comment fetcher.
 * In production, this would use the X API.
 */
async function fetchXComments(
  _ctx: ActionCtx,
  entityKeys: string[],
  _config: Required<CommentHarvesterConfig>
): Promise<HarvestedComment[]> {
  // Placeholder - would use X API
  console.log(`[CommentHarvester] X/Twitter fetch for entities: ${entityKeys.join(", ")}`);

  // Return empty for now - in production would fetch real comments
  return [];
}

/**
 * Create evidence artifacts from harvested comments.
 */
async function createEvidenceArtifacts(
  ctx: ActionCtx,
  comments: HarvestedComment[]
): Promise<string[]> {
  const artifactIds: string[] = [];

  for (const comment of comments) {
    try {
      // Create evidence artifact (tier3_community)
      const result = await ctx.runMutation(
        internal.domains.narrative.mutations.evidence.createEvidenceArtifact,
        {
          url: comment.url,
          contentHash: `comment_${comment.source}_${comment.timestamp}`,
          publishedAt: comment.timestamp,
          extractedQuotes: [
            {
              text: comment.content,
              context: `${comment.source} comment by ${comment.author}`,
            },
          ],
          entities: comment.entityMentions,
          topics: [], // Could extract topics from content
          retrievalTrace: {
            searchQuery: undefined,
            agentName: "CommentHarvester",
            toolName: `${comment.source}_api`,
          },
          credibilityTier: "tier3_community",
        }
      );

      artifactIds.push(result.artifactId);
    } catch (error) {
      console.error(`[CommentHarvester] Error creating artifact:`, error);
    }
  }

  return artifactIds;
}

/**
 * Run Comment Harvester Agent
 *
 * @param ctx - Convex action context
 * @param state - Current newsroom state
 * @param config - Harvester configuration
 * @returns Harvest result with comments and sentiment analysis
 */
export async function runCommentHarvester(
  ctx: ActionCtx,
  state: NewsroomState,
  config: CommentHarvesterConfig = {}
): Promise<HarvestResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  console.log(`[CommentHarvester] Starting harvest for ${state.targetEntityKeys.length} entities`);

  const allComments: HarvestedComment[] = [];
  const errors: string[] = [];

  // Fetch from enabled sources
  if (cfg.enableHN) {
    try {
      const hnComments = await fetchHNComments(ctx, state.targetEntityKeys, cfg);
      allComments.push(...hnComments);
    } catch (error) {
      errors.push(`HN: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (cfg.enableReddit) {
    try {
      const redditComments = await fetchRedditComments(ctx, state.targetEntityKeys, cfg);
      allComments.push(...redditComments);
    } catch (error) {
      errors.push(`Reddit: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (cfg.enableX) {
    try {
      const xComments = await fetchXComments(ctx, state.targetEntityKeys, cfg);
      allComments.push(...xComments);
    } catch (error) {
      errors.push(`X: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Classify stances and identify notable quotes
  for (const comment of allComments) {
    comment.stance = classifyStance(comment.content);
    comment.isNotableQuote = isNotableQuote(comment);
    comment.entityMentions = extractEntityMentions(comment.content, state.targetEntityKeys);
  }

  // Calculate sentiment summary
  const sentimentSummary = {
    bullish: allComments.filter((c) => c.stance === "bullish").length,
    bearish: allComments.filter((c) => c.stance === "bearish").length,
    neutral: allComments.filter((c) => c.stance === "neutral").length,
    questioning: allComments.filter((c) => c.stance === "questioning").length,
    skeptical: allComments.filter((c) => c.stance === "skeptical").length,
  };

  // Extract notable quotes
  const notableQuotes = allComments
    .filter((c) => c.isNotableQuote)
    .slice(0, 10)
    .map((c) => ({
      quote: c.content,
      author: c.author,
      source: c.source,
      stance: c.stance,
    }));

  // Create evidence artifacts for notable comments
  if (notableQuotes.length > 0) {
    const notableComments = allComments.filter((c) => c.isNotableQuote);
    await createEvidenceArtifacts(ctx, notableComments);
  }

  console.log(`[CommentHarvester] Harvested ${allComments.length} comments`);
  console.log(`[CommentHarvester] Sentiment:`, sentimentSummary);
  console.log(`[CommentHarvester] Notable quotes: ${notableQuotes.length}`);

  return {
    comments: allComments,
    sentimentSummary,
    notableQuotes,
    errors,
  };
}

/**
 * Comment Harvester tool definition for use in LangGraph
 */
export const commentHarvesterTool = {
  name: "harvest_comments",
  description: "Harvest community commentary from HN, Reddit, X as evidence artifacts",
  parameters: {
    enableHN: {
      type: "boolean",
      description: "Enable Hacker News harvesting",
    },
    enableReddit: {
      type: "boolean",
      description: "Enable Reddit harvesting",
    },
    enableX: {
      type: "boolean",
      description: "Enable X/Twitter harvesting",
    },
    minScore: {
      type: "number",
      description: "Minimum comment score threshold",
    },
  },
};
