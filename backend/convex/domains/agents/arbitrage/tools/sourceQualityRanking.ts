/**
 * Source Quality Ranking Tool
 * 
 * Scores and ranks sources based on type and recency.
 * Based on ARBITRAGE_AGENT_IMPLEMENTATION_PLAN.md
 */

import { z } from "zod";
import type { ActionCtx } from "../../../../_generated/server";
import { 
  SOURCE_QUALITY_SCORES, 
  QUALITY_TIERS,
  type SourceType,
  type SourceQualityInput 
} from "../config";

// Output types
export interface RankedSource {
  url: string;
  name: string;
  type: SourceType;
  baseScore: number;
  recencyBoost: number;
  totalScore: number;
  tier: "excellent" | "good" | "fair" | "poor";
  ageInDays: number | null;
}

export interface SourceQualityResult {
  rankedSources: RankedSource[];
  averageQualityScore: number;
  qualityTier: "excellent" | "good" | "fair" | "poor";
  countByType: {
    primary: number;
    secondary_reputable: number;
    secondary_general: number;
    tertiary: number;
  };
  summary: string;
}

/**
 * Calculate recency boost based on age
 */
function calculateRecencyBoost(timestamp?: number): { boost: number; ageInDays: number | null } {
  if (!timestamp) {
    return { boost: 0, ageInDays: null };
  }
  
  const now = Date.now();
  const ageMs = now - timestamp;
  const ageInDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  
  if (ageInDays <= 7) {
    return { boost: 10, ageInDays };
  } else if (ageInDays <= 30) {
    return { boost: 5, ageInDays };
  } else {
    return { boost: 0, ageInDays };
  }
}

/**
 * Determine quality tier from score
 */
function getQualityTier(score: number): "excellent" | "good" | "fair" | "poor" {
  if (score >= QUALITY_TIERS.EXCELLENT.min) return "excellent";
  if (score >= QUALITY_TIERS.GOOD.min) return "good";
  if (score >= QUALITY_TIERS.FAIR.min) return "fair";
  return "poor";
}

/**
 * Rank sources by quality
 */
export async function executeSourceQualityRanking(
  ctx: ActionCtx,
  args: SourceQualityInput
): Promise<SourceQualityResult> {
  console.log(`[sourceQualityRanking] Ranking ${args.sources.length} sources`);

  if (args.sources.length === 0) {
    return {
      rankedSources: [],
      averageQualityScore: 0,
      qualityTier: "poor",
      countByType: { primary: 0, secondary_reputable: 0, secondary_general: 0, tertiary: 0 },
      summary: "No sources to rank.",
    };
  }

  const countByType = {
    primary: 0,
    secondary_reputable: 0,
    secondary_general: 0,
    tertiary: 0,
  };

  const rankedSources: RankedSource[] = args.sources.map((source) => {
    const sourceType = source.type as SourceType;
    const baseScore = SOURCE_QUALITY_SCORES[sourceType] || 30;
    const { boost: recencyBoost, ageInDays } = calculateRecencyBoost(source.timestamp);
    const totalScore = Math.min(100, baseScore + recencyBoost); // Cap at 100
    const tier = getQualityTier(totalScore);

    // Count by type
    countByType[sourceType] = (countByType[sourceType] || 0) + 1;

    return {
      url: source.url,
      name: source.name,
      type: sourceType,
      baseScore,
      recencyBoost,
      totalScore,
      tier,
      ageInDays,
    };
  });

  // Sort by total score descending
  rankedSources.sort((a, b) => b.totalScore - a.totalScore);

  // Calculate average
  const totalScoreSum = rankedSources.reduce((sum, s) => sum + s.totalScore, 0);
  const averageQualityScore = Math.round(totalScoreSum / rankedSources.length);
  const qualityTier = getQualityTier(averageQualityScore);

  const summary = `Average quality: ${averageQualityScore}/100 (${qualityTier}). Sources: ${countByType.primary} primary, ${countByType.secondary_reputable + countByType.secondary_general} secondary, ${countByType.tertiary} tertiary.`;

  console.log(`[sourceQualityRanking] ${summary}`);

  return {
    rankedSources,
    averageQualityScore,
    qualityTier,
    countByType,
    summary,
  };
}

// Tool definition for AI SDK
export const sourceQualityRankingToolDefinition = {
  description: `Rank and score sources by quality and recency.
Scoring:
- PRIMARY (SEC, press releases): 95 base points
- SECONDARY REPUTABLE (Reuters, Bloomberg): 70 base points
- SECONDARY GENERAL (TechCrunch): 50 base points
- TERTIARY (blogs, social): 30 base points

Recency boost: +10 if <7 days, +5 if <30 days.
Returns ranked list with quality tiers (excellent/good/fair/poor).`,
  inputSchema: z.object({
    sources: z.array(z.object({
      url: z.string(),
      name: z.string(),
      type: z.enum(["primary", "secondary_reputable", "secondary_general", "tertiary"]),
      timestamp: z.number().optional(),
    })),
  }),
};
