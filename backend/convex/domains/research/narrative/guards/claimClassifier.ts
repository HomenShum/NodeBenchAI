/**
 * Claim Classification System
 *
 * Enforces editorial integrity by classifying each claim as:
 * - fact_claim: Must map to temporalFacts + evidenceArtifacts
 * - inference: Analysis based on evidence (flagged as inference)
 * - sentiment: Community opinion/discourse
 * - meta: About the narrative itself
 *
 * Industry standard patterns:
 * - Fact-checking methodology (IFCN principles)
 * - News agency editorial guidelines (Reuters, AP)
 * - Academic citation standards
 *
 * @module domains/narrative/guards/claimClassifier
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  internalAction,
} from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import type { Id } from "../../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ClaimType = "fact_claim" | "inference" | "sentiment" | "meta";

export interface ClassifiedClaim {
  sentenceIndex: number;
  sentenceText: string;
  claimType: ClaimType;
  confidence: number;
  indicators: string[];
  linkedFactIds?: string[];
  linkedArtifactIds?: string[];
  requiresVerification: boolean;
}

export interface ClaimClassificationResult {
  claims: ClassifiedClaim[];
  factClaimCount: number;
  inferenceCount: number;
  sentimentCount: number;
  metaCount: number;
  coverageScore: number; // 0-1, what % of fact claims have evidence
  unverifiedFactClaims: ClassifiedClaim[];
}

// ═══════════════════════════════════════════════════════════════════════════
// CLAIM DETECTION PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Patterns that indicate factual claims.
 * These MUST be backed by evidence.
 */
const FACT_CLAIM_PATTERNS = [
  // Reporting verbs
  /\b(announced|reported|confirmed|disclosed|revealed|filed|stated)\b/i,
  // Quantitative claims
  /\b(raised|valued at|worth|revenue of|profit of|grew by|declined by)\b/i,
  /\$[\d,]+(\.\d+)?\s*(million|billion|M|B|K)/i,
  /\b\d+(\.\d+)?%\b/,
  // Temporal claims
  /\b(on|in|as of)\s+(January|February|March|April|May|June|July|August|September|October|November|December|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4})\b/i,
  // Attribution to sources
  /\baccording to\b/i,
  /\b(sources?|officials?|spokesperson|CEO|CFO|founder)\s+(said|confirmed|told)\b/i,
  // Definitive statements
  /\b(is|are|was|were)\s+(the|a)\s+(largest|smallest|first|only|leading)\b/i,
];

/**
 * Patterns that indicate inference/analysis.
 * Should be flagged as interpretation.
 */
const INFERENCE_PATTERNS = [
  // Analysis verbs
  /\b(suggests?|indicates?|implies?|signals?|points? to)\b/i,
  // Hedging language
  /\b(likely|probably|possibly|perhaps|may|might|could|appears? to)\b/i,
  // Comparative analysis
  /\b(compared to|relative to|in contrast to|unlike)\b/i,
  // Causal claims without direct evidence
  /\b(because of|due to|as a result of|leading to|caused by)\b/i,
  // Future predictions
  /\b(will|would|expected to|projected to|forecast)\b/i,
  // Analysis framing
  /\b(analysis|interpretation|reading|assessment)\b/i,
];

/**
 * Patterns that indicate sentiment/opinion.
 * Should cite representative community sources.
 */
const SENTIMENT_PATTERNS = [
  // Opinion markers
  /\b(believe|think|feel|opinion|view|perspective)\b/i,
  // Sentiment words
  /\b(bullish|bearish|optimistic|pessimistic|excited|concerned|worried)\b/i,
  // Community reference
  /\b(community|users|investors|traders|analysts)\s+(are|seem|appear)\b/i,
  // Social proof
  /\b(trending|viral|popular|controversial|divisive)\b/i,
  // Evaluation
  /\b(good|bad|great|terrible|impressive|disappointing)\b/i,
];

/**
 * Patterns that indicate meta-commentary.
 * About the narrative itself, not the subject.
 */
const META_PATTERNS = [
  // Self-reference
  /\b(this thread|this analysis|this update|we've been tracking)\b/i,
  // Narrative framing
  /\b(the narrative|the story|the saga|developments)\b/i,
  // Update markers
  /\b(update|revision|correction|clarification)\b/i,
  // Methodology
  /\b(sources|evidence|data|methodology)\b/i,
];

// ═══════════════════════════════════════════════════════════════════════════
// CLASSIFICATION LOGIC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Split text into sentences.
 */
function splitIntoSentences(text: string): string[] {
  // Split on sentence boundaries, keeping the delimiter
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10); // Filter out very short fragments
}

/**
 * Count pattern matches in text.
 */
function countPatternMatches(text: string, patterns: RegExp[]): number {
  return patterns.filter((p) => p.test(text)).length;
}

/**
 * Get matching pattern descriptions.
 */
function getMatchingIndicators(text: string, patterns: RegExp[]): string[] {
  return patterns
    .filter((p) => p.test(text))
    .map((p) => p.source.slice(0, 50)); // Truncate for readability
}

/**
 * Classify a single sentence.
 */
function classifySentence(
  sentence: string,
  index: number
): ClassifiedClaim {
  const factScore = countPatternMatches(sentence, FACT_CLAIM_PATTERNS);
  const inferenceScore = countPatternMatches(sentence, INFERENCE_PATTERNS);
  const sentimentScore = countPatternMatches(sentence, SENTIMENT_PATTERNS);
  const metaScore = countPatternMatches(sentence, META_PATTERNS);

  const totalScore = factScore + inferenceScore + sentimentScore + metaScore;

  // Determine dominant type
  let claimType: ClaimType;
  let confidence: number;
  let indicators: string[] = [];

  if (totalScore === 0) {
    // No patterns matched - default to inference (safest)
    claimType = "inference";
    confidence = 0.5;
    indicators = ["no_patterns_matched"];
  } else if (factScore >= inferenceScore && factScore >= sentimentScore && factScore >= metaScore) {
    claimType = "fact_claim";
    confidence = factScore / totalScore;
    indicators = getMatchingIndicators(sentence, FACT_CLAIM_PATTERNS);
  } else if (inferenceScore >= sentimentScore && inferenceScore >= metaScore) {
    claimType = "inference";
    confidence = inferenceScore / totalScore;
    indicators = getMatchingIndicators(sentence, INFERENCE_PATTERNS);
  } else if (sentimentScore >= metaScore) {
    claimType = "sentiment";
    confidence = sentimentScore / totalScore;
    indicators = getMatchingIndicators(sentence, SENTIMENT_PATTERNS);
  } else {
    claimType = "meta";
    confidence = metaScore / totalScore;
    indicators = getMatchingIndicators(sentence, META_PATTERNS);
  }

  return {
    sentenceIndex: index,
    sentenceText: sentence,
    claimType,
    confidence: Math.min(1, confidence),
    indicators,
    requiresVerification: claimType === "fact_claim",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASSIFICATION ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Classify all claims in a post.
 */
export const classifyPostClaims = internalAction({
  args: {
    postId: v.id("narrativePosts"),
    content: v.string(),
    existingArtifactIds: v.optional(v.array(v.string())),
  },
  returns: v.object({
    claims: v.array(
      v.object({
        sentenceIndex: v.number(),
        sentenceText: v.string(),
        claimType: v.union(
          v.literal("fact_claim"),
          v.literal("inference"),
          v.literal("sentiment"),
          v.literal("meta")
        ),
        confidence: v.number(),
        indicators: v.array(v.string()),
        linkedFactIds: v.optional(v.array(v.string())),
        linkedArtifactIds: v.optional(v.array(v.string())),
        requiresVerification: v.boolean(),
      })
    ),
    factClaimCount: v.number(),
    inferenceCount: v.number(),
    sentimentCount: v.number(),
    metaCount: v.number(),
    coverageScore: v.number(),
    unverifiedFactClaims: v.array(
      v.object({
        sentenceIndex: v.number(),
        sentenceText: v.string(),
        claimType: v.union(
          v.literal("fact_claim"),
          v.literal("inference"),
          v.literal("sentiment"),
          v.literal("meta")
        ),
        confidence: v.number(),
        indicators: v.array(v.string()),
        requiresVerification: v.boolean(),
      })
    ),
  }),
  handler: async (ctx, args): Promise<ClaimClassificationResult> => {
    const sentences = splitIntoSentences(args.content);
    const claims = sentences.map((s, i) => classifySentence(s, i));

    // Count by type
    const factClaimCount = claims.filter((c) => c.claimType === "fact_claim").length;
    const inferenceCount = claims.filter((c) => c.claimType === "inference").length;
    const sentimentCount = claims.filter((c) => c.claimType === "sentiment").length;
    const metaCount = claims.filter((c) => c.claimType === "meta").length;

    // Calculate coverage score
    const artifactCount = args.existingArtifactIds?.length || 0;
    const coverageScore =
      factClaimCount > 0
        ? Math.min(1, artifactCount / factClaimCount)
        : 1; // No fact claims = 100% coverage

    // Find unverified fact claims
    const unverifiedFactClaims = claims
      .filter((c) => c.claimType === "fact_claim" && !c.linkedArtifactIds?.length)
      .map((c) => ({
        sentenceIndex: c.sentenceIndex,
        sentenceText: c.sentenceText,
        claimType: c.claimType,
        confidence: c.confidence,
        indicators: c.indicators,
        requiresVerification: c.requiresVerification,
      }));

    return {
      claims,
      factClaimCount,
      inferenceCount,
      sentimentCount,
      metaCount,
      coverageScore,
      unverifiedFactClaims,
    };
  },
});

/**
 * Store claim classifications in database.
 */
export const storeClaimClassifications = internalMutation({
  args: {
    postId: v.id("narrativePosts"),
    claims: v.array(
      v.object({
        sentenceIndex: v.number(),
        sentenceText: v.string(),
        claimType: v.union(
          v.literal("fact_claim"),
          v.literal("inference"),
          v.literal("sentiment"),
          v.literal("meta")
        ),
        confidence: v.number(),
        linkedFactIds: v.optional(v.array(v.id("temporalFacts"))),
        linkedArtifactIds: v.optional(v.array(v.id("sourceArtifacts"))),
      })
    ),
    classifiedBy: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = Date.now();
    let created = 0;

    for (const claim of args.claims) {
      await ctx.db.insert("claimClassifications", {
        postId: args.postId,
        sentenceIndex: claim.sentenceIndex,
        sentenceText: claim.sentenceText,
        claimType: claim.claimType,
        confidence: claim.confidence,
        linkedFactIds: claim.linkedFactIds,
        linkedArtifactIds: claim.linkedArtifactIds,
        isVerified: false,
        classifiedAt: now,
        classifiedBy: args.classifiedBy,
      });
      created++;
    }

    return created;
  },
});

/**
 * Get unverified fact claims for a thread.
 */
export const getUnverifiedFactClaims = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("claimClassifications"),
      postId: v.id("narrativePosts"),
      sentenceText: v.string(),
      confidence: v.number(),
      classifiedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    // Get all posts for thread
    const posts = await ctx.db
      .query("narrativePosts")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();

    const postIds = new Set(posts.map((p) => p._id));

    // Get unverified fact claims
    const claims = await ctx.db
      .query("claimClassifications")
      .withIndex("by_unverified", (q) => q.eq("isVerified", false).eq("claimType", "fact_claim"))
      .take(limit * 2); // Fetch more to filter

    return claims
      .filter((c) => postIds.has(c.postId))
      .slice(0, limit)
      .map((c) => ({
        _id: c._id,
        postId: c.postId,
        sentenceText: c.sentenceText,
        confidence: c.confidence,
        classifiedAt: c.classifiedAt,
      }));
  },
});

/**
 * Verify a fact claim by linking to evidence.
 */
export const verifyFactClaim = internalMutation({
  args: {
    claimId: v.id("claimClassifications"),
    linkedFactIds: v.optional(v.array(v.id("temporalFacts"))),
    linkedArtifactIds: v.optional(v.array(v.id("sourceArtifacts"))),
    verificationNote: v.optional(v.string()),
    verifiedBy: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const claim = await ctx.db.get(args.claimId);
    if (!claim) return false;

    await ctx.db.patch(args.claimId, {
      linkedFactIds: args.linkedFactIds,
      linkedArtifactIds: args.linkedArtifactIds,
      isVerified: true,
      verificationNote: args.verificationNote,
    });

    return true;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PUBLISHING GATE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a post meets fact coverage requirements for publishing.
 * This is the "Narrative Compilation Gate".
 */
export const checkPublishingEligibility = internalAction({
  args: {
    postId: v.id("narrativePosts"),
    content: v.string(),
    citationIds: v.array(v.string()),
    minCoverageScore: v.optional(v.number()),
  },
  returns: v.object({
    eligible: v.boolean(),
    coverageScore: v.number(),
    factClaimCount: v.number(),
    citationCount: v.number(),
    issues: v.array(v.string()),
    recommendations: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const minCoverage = args.minCoverageScore ?? 0.8; // 80% default

    // Classify claims
    const classification = await ctx.runAction(
      internal.domains.narrative.guards.claimClassifier.classifyPostClaims,
      {
        postId: args.postId,
        content: args.content,
        existingArtifactIds: args.citationIds,
      }
    );

    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check coverage
    if (classification.coverageScore < minCoverage) {
      issues.push(
        `Fact claim coverage (${(classification.coverageScore * 100).toFixed(0)}%) ` +
          `below minimum (${(minCoverage * 100).toFixed(0)}%)`
      );
      recommendations.push(
        `Add ${Math.ceil(classification.factClaimCount * minCoverage) - args.citationIds.length} ` +
          `more citations to reach ${(minCoverage * 100).toFixed(0)}% coverage`
      );
    }

    // Check for unverified fact claims
    if (classification.unverifiedFactClaims.length > 0) {
      issues.push(
        `${classification.unverifiedFactClaims.length} fact claims without linked evidence`
      );
      recommendations.push(
        "Link evidence to each fact claim or rephrase as inference"
      );
    }

    // Check for contested facts (would need truth state lookup)
    // This is a placeholder for full implementation

    const eligible = issues.length === 0;

    return {
      eligible,
      coverageScore: classification.coverageScore,
      factClaimCount: classification.factClaimCount,
      citationCount: args.citationIds.length,
      issues,
      recommendations,
    };
  },
});

/**
 * Get claim type breakdown for a post.
 */
export const getClaimBreakdown = internalQuery({
  args: {
    postId: v.id("narrativePosts"),
  },
  returns: v.object({
    factClaims: v.number(),
    inferences: v.number(),
    sentiments: v.number(),
    meta: v.number(),
    verified: v.number(),
    unverified: v.number(),
  }),
  handler: async (ctx, args) => {
    const claims = await ctx.db
      .query("claimClassifications")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .collect();

    return {
      factClaims: claims.filter((c) => c.claimType === "fact_claim").length,
      inferences: claims.filter((c) => c.claimType === "inference").length,
      sentiments: claims.filter((c) => c.claimType === "sentiment").length,
      meta: claims.filter((c) => c.claimType === "meta").length,
      verified: claims.filter((c) => c.isVerified).length,
      unverified: claims.filter((c) => !c.isVerified && c.claimType === "fact_claim").length,
    };
  },
});
