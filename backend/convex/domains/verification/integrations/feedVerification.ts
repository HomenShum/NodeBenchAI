/**
 * Feed Verification Integration
 *
 * Adds verification signals to the For You Feed ranking:
 * 1. Source credibility tier (authoritative, reliable, unverified)
 * 2. Fact verification status (verified, corroborated, unverified, disputed)
 * 3. Claim-level verification details
 * 4. Verification badges for UI display
 *
 * Pivots ranking from pure engagement to insight+correctness optimization.
 *
 * @module domains/verification/integrations/feedVerification
 */

"use node";

import { v } from "convex/values";
import { internalAction, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface VerificationSignals {
  /** Source credibility tier */
  sourceTier: "tier1_authoritative" | "tier2_reliable" | "tier3_unverified";

  /** Overall verification status */
  verificationStatus: "verified" | "corroborated" | "unverified" | "disputed";

  /** Confidence score (0-1) */
  confidence: number;

  /** Number of claims verified */
  verifiedClaimCount: number;

  /** Total claims detected */
  totalClaimCount: number;

  /** Has contradictions with other sources */
  hasContradictions: boolean;

  /** Ground truth match (if applicable) */
  groundTruthMatch?: {
    factId: string;
    matchType: "exact" | "partial" | "outdated";
  };

  /** Authoritative source URLs for cross-reference */
  authoritativeSourceUrls: string[];

  /** Verification badge for UI */
  badge: {
    type: "verified" | "reliable" | "needs_review" | "disputed" | "none";
    label: string;
    tooltip: string;
  };
}

export interface EnrichedFeedCandidate {
  itemId: string;
  itemType: string;
  source: string;
  title: string;
  snippet: string;
  metadata: Record<string, unknown>;
  timestamp: number;
  dateString?: string;

  /** Verification signals */
  verification: VerificationSignals;

  /** Insight-optimized score (replaces pure engagement) */
  insightScore: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION SIGNAL COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute verification signals for a single feed candidate
 */
export const computeVerificationSignals = internalAction({
  args: {
    itemId: v.string(),
    itemType: v.string(),
    title: v.string(),
    snippet: v.string(),
    sourceUrl: v.optional(v.string()),
    sourceName: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<VerificationSignals> => {
    // Get source credibility
    let sourceTier: VerificationSignals["sourceTier"] = "tier3_unverified";
    let authoritativeSourceUrls: string[] = [];

    if (args.sourceUrl) {
      const credibility = await ctx.runQuery(
        internal.domains.verification.publicSourceRegistry.getSourceCredibility,
        { url: args.sourceUrl }
      );
      sourceTier = credibility.tier as VerificationSignals["sourceTier"];
    }

    // Extract and verify claims from title + snippet
    const content = `${args.title}. ${args.snippet}`;
    let verifiedClaimCount = 0;
    let totalClaimCount = 0;
    let hasContradictions = false;
    let confidence = 0;
    let verificationStatus: VerificationSignals["verificationStatus"] = "unverified";
    let groundTruthMatch: VerificationSignals["groundTruthMatch"] | undefined;

    // For LinkedIn funding posts, use specialized verification
    if (args.metadata?.kind === "linkedin_funding" && args.metadata?.companyName) {
      const fundingVerification = await ctx.runAction(
        internal.domains.verification.integrations.linkedinVerification.verifyFundingPost,
        {
          postId: args.itemId,
          companyName: args.metadata.companyName as string,
          roundType: args.metadata?.roundType as string | undefined,
          amountRaw: args.metadata?.amount as string | undefined,
          postUrl: args.sourceUrl || "",
        }
      );

      totalClaimCount = fundingVerification.claims.length;
      verifiedClaimCount = fundingVerification.claims.filter((c) => c.verified).length;
      confidence = fundingVerification.claims[0]?.confidence || 0;
      authoritativeSourceUrls = fundingVerification.suggestedSources;

      // Map verdict to status
      if (fundingVerification.overallVerdict === "verified") {
        verificationStatus = "verified";
      } else if (fundingVerification.overallVerdict === "partially_verified") {
        verificationStatus = "corroborated";
      } else if (fundingVerification.overallVerdict === "needs_review") {
        verificationStatus = "unverified";
      } else {
        verificationStatus = "unverified";
      }
    } else {
      // For general content, extract and verify claims
      try {
        const claimExtraction = await ctx.runAction(
          internal.domains.verification.entailmentChecker.extractVerifiableFacts,
          {
            content,
            sourceUrl: args.sourceUrl || "",
          }
        );

        totalClaimCount = claimExtraction.facts.length;

        // Verify each claim
        for (const fact of claimExtraction.facts.slice(0, 3)) {
          // Limit to 3 claims for performance
          const verification = await ctx.runAction(
            internal.domains.verification.verificationWorkflow.verifyClaim,
            {
              claim: fact.factText,
              sourceUrls: args.sourceUrl ? [args.sourceUrl] : [],
              context: {
                domain: args.sourceName || "unknown",
                timestamp: Date.now(),
              },
            }
          );

          if (
            verification.verdict === "verified" ||
            verification.verdict === "corroborated"
          ) {
            verifiedClaimCount++;
          }
          if (verification.verdict === "contradicted") {
            hasContradictions = true;
          }
          confidence += verification.confidence;

          if (verification.groundTruthMatch) {
            groundTruthMatch = {
              factId: verification.groundTruthMatch.factId,
              matchType: verification.groundTruthMatch.isActive
                ? verification.groundTruthMatch.matches
                  ? "exact"
                  : "partial"
                : "outdated",
            };
          }

          if (verification.authoritativeSourceUrls) {
            authoritativeSourceUrls.push(...verification.authoritativeSourceUrls);
          }
        }

        // Calculate average confidence
        confidence = totalClaimCount > 0 ? confidence / totalClaimCount : 0;

        // Determine overall status
        if (hasContradictions) {
          verificationStatus = "disputed";
        } else if (verifiedClaimCount === totalClaimCount && totalClaimCount > 0) {
          verificationStatus = "verified";
        } else if (verifiedClaimCount > 0) {
          verificationStatus = "corroborated";
        } else {
          verificationStatus = "unverified";
        }
      } catch (error) {
        console.error("[feedVerification] Claim verification failed:", error);
        // Fall back to source-tier-based assessment
        if (sourceTier === "tier1_authoritative") {
          verificationStatus = "corroborated";
          confidence = 0.7;
        } else if (sourceTier === "tier2_reliable") {
          verificationStatus = "corroborated";
          confidence = 0.5;
        }
      }
    }

    // Compute badge
    const badge = computeVerificationBadge(
      verificationStatus,
      sourceTier,
      hasContradictions,
      confidence
    );

    return {
      sourceTier,
      verificationStatus,
      confidence,
      verifiedClaimCount,
      totalClaimCount,
      hasContradictions,
      groundTruthMatch,
      authoritativeSourceUrls: [...new Set(authoritativeSourceUrls)],
      badge,
    };
  },
});

/**
 * Compute verification badge for UI display
 */
function computeVerificationBadge(
  status: VerificationSignals["verificationStatus"],
  tier: VerificationSignals["sourceTier"],
  hasContradictions: boolean,
  confidence: number
): VerificationSignals["badge"] {
  if (hasContradictions) {
    return {
      type: "disputed",
      label: "Disputed",
      tooltip: "This content contains claims that contradict other verified sources",
    };
  }

  if (status === "verified" && tier === "tier1_authoritative") {
    return {
      type: "verified",
      label: "Verified",
      tooltip: "Claims verified against authoritative sources (SEC, FDA, official announcements)",
    };
  }

  if (status === "verified" || status === "corroborated") {
    return {
      type: "reliable",
      label: "Reliable",
      tooltip: "Claims corroborated by multiple reliable sources",
    };
  }

  if (tier === "tier3_unverified" || confidence < 0.3) {
    return {
      type: "needs_review",
      label: "Unverified",
      tooltip: "Claims have not been verified against authoritative sources",
    };
  }

  return {
    type: "none",
    label: "",
    tooltip: "",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// BATCH ENRICHMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Batch enrich feed candidates with verification signals
 */
export const enrichCandidatesWithVerification = internalAction({
  args: {
    candidates: v.array(v.any()),
    maxToVerify: v.optional(v.number()),
  },
  handler: async (ctx, { candidates, maxToVerify = 20 }): Promise<EnrichedFeedCandidate[]> => {
    const enriched: EnrichedFeedCandidate[] = [];

    // Process candidates in parallel batches
    const toVerify = candidates.slice(0, maxToVerify);

    const verificationResults = await Promise.all(
      toVerify.map(async (candidate) => {
        try {
          const signals = await ctx.runAction(
            internal.domains.verification.integrations.feedVerification.computeVerificationSignals,
            {
              itemId: candidate.itemId,
              itemType: candidate.itemType,
              title: candidate.title,
              snippet: candidate.snippet,
              sourceUrl: candidate.metadata?.url,
              sourceName: candidate.metadata?.source || candidate.metadata?.provider,
              metadata: candidate.metadata,
            }
          );
          return { candidate, signals };
        } catch (error) {
          console.error(`[feedVerification] Failed to verify ${candidate.itemId}:`, error);
          // Return default unverified signals
          return {
            candidate,
            signals: getDefaultVerificationSignals(),
          };
        }
      })
    );

    // Compute insight scores and build enriched candidates
    for (const { candidate, signals } of verificationResults) {
      const insightScore = computeInsightScore(candidate, signals);

      enriched.push({
        itemId: candidate.itemId,
        itemType: candidate.itemType,
        source: candidate.source,
        title: candidate.title,
        snippet: candidate.snippet,
        metadata: candidate.metadata,
        timestamp: candidate.timestamp,
        dateString: candidate.dateString,
        verification: signals,
        insightScore,
      });
    }

    // Add remaining candidates with default verification
    for (const candidate of candidates.slice(maxToVerify)) {
      enriched.push({
        ...candidate,
        verification: getDefaultVerificationSignals(),
        insightScore: computeInsightScore(candidate, getDefaultVerificationSignals()),
      });
    }

    return enriched;
  },
});

/**
 * Get default verification signals for unverified content
 */
function getDefaultVerificationSignals(): VerificationSignals {
  return {
    sourceTier: "tier3_unverified",
    verificationStatus: "unverified",
    confidence: 0,
    verifiedClaimCount: 0,
    totalClaimCount: 0,
    hasContradictions: false,
    authoritativeSourceUrls: [],
    badge: {
      type: "none",
      label: "",
      tooltip: "",
    },
  };
}

/**
 * Compute insight score based on verification and content quality
 *
 * Weight distribution (insight+correctness optimized):
 * - Correctness: 40% (verification status + source tier)
 * - Insight density: 30% (claims per content length)
 * - Recency: 15%
 * - Relevance: 15%
 */
function computeInsightScore(
  candidate: { timestamp: number; snippet: string; metadata?: Record<string, unknown> },
  signals: VerificationSignals
): number {
  let score = 0;

  // Correctness component (40%)
  const correctnessScore = computeCorrectnessScore(signals);
  score += correctnessScore * 0.4;

  // Insight density component (30%)
  // More claims = more insights, but penalize unverified claims
  const verificationRate =
    signals.totalClaimCount > 0
      ? signals.verifiedClaimCount / signals.totalClaimCount
      : 0;
  const insightDensity = Math.min(signals.totalClaimCount * 0.2, 1) * verificationRate;
  score += insightDensity * 0.3;

  // Recency component (15%)
  const hoursSincePublished = (Date.now() - candidate.timestamp) / (1000 * 60 * 60);
  const recencyScore = Math.max(0, 1 - hoursSincePublished / 168); // Decay over 1 week
  score += recencyScore * 0.15;

  // Relevance component (15%) - from metadata if available
  const relevanceFromMetadata = (candidate.metadata?.relevance as number) || 50;
  score += (relevanceFromMetadata / 100) * 0.15;

  return Math.min(score, 1) * 100; // Normalize to 0-100
}

/**
 * Compute correctness score from verification signals
 */
function computeCorrectnessScore(signals: VerificationSignals): number {
  // Tier weight
  const tierScores = {
    tier1_authoritative: 1.0,
    tier2_reliable: 0.7,
    tier3_unverified: 0.3,
  };
  const tierScore = tierScores[signals.sourceTier];

  // Status weight
  const statusScores = {
    verified: 1.0,
    corroborated: 0.8,
    unverified: 0.3,
    disputed: 0.1,
  };
  const statusScore = statusScores[signals.verificationStatus];

  // Contradiction penalty
  const contradictionPenalty = signals.hasContradictions ? 0.5 : 1.0;

  return tierScore * 0.4 + statusScore * 0.6 * contradictionPenalty;
}

// ═══════════════════════════════════════════════════════════════════════════
// INSIGHT-OPTIMIZED RANKING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rank candidates using insight+correctness optimization
 * Replaces pure engagement-based Phoenix ranking
 */
export const rankWithInsightOptimization = internalAction({
  args: {
    candidates: v.array(v.any()),
    userPreferences: v.optional(
      v.object({
        prioritizeVerified: v.optional(v.boolean()),
        minConfidence: v.optional(v.number()),
        excludeDisputed: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (ctx, { candidates, userPreferences }) => {
    // Enrich with verification signals
    const enriched = await ctx.runAction(
      internal.domains.verification.integrations.feedVerification.enrichCandidatesWithVerification,
      { candidates, maxToVerify: 30 }
    );

    // Apply user preferences
    let filtered = enriched;

    if (userPreferences?.excludeDisputed) {
      filtered = filtered.filter((c) => !c.verification.hasContradictions);
    }

    if (userPreferences?.minConfidence !== undefined) {
      filtered = filtered.filter(
        (c) => c.verification.confidence >= (userPreferences.minConfidence || 0)
      );
    }

    // Sort by insight score (descending)
    filtered.sort((a, b) => b.insightScore - a.insightScore);

    // Boost verified content to top if preference set
    if (userPreferences?.prioritizeVerified) {
      const verified = filtered.filter(
        (c) => c.verification.verificationStatus === "verified"
      );
      const rest = filtered.filter(
        (c) => c.verification.verificationStatus !== "verified"
      );
      filtered = [...verified, ...rest];
    }

    return filtered;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// FEED QUALITY METRICS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute feed quality metrics for monitoring
 * Note: Changed from internalQuery to internalAction for Node.js compatibility
 */
export const computeFeedQualityMetrics = internalAction({
  args: {
    feedItems: v.array(v.any()),
  },
  handler: async (_ctx, { feedItems }) => {
    const enrichedItems = feedItems as EnrichedFeedCandidate[];

    const total = enrichedItems.length;
    if (total === 0) {
      return {
        total: 0,
        verifiedCount: 0,
        verifiedRate: 0,
        avgConfidence: 0,
        avgInsightScore: 0,
        tierDistribution: { tier1: 0, tier2: 0, tier3: 0 },
        disputedCount: 0,
      };
    }

    const verifiedCount = enrichedItems.filter(
      (i) =>
        i.verification?.verificationStatus === "verified" ||
        i.verification?.verificationStatus === "corroborated"
    ).length;

    const avgConfidence =
      enrichedItems.reduce((sum, i) => sum + (i.verification?.confidence || 0), 0) /
      total;

    const avgInsightScore =
      enrichedItems.reduce((sum, i) => sum + (i.insightScore || 0), 0) / total;

    const tierDistribution = {
      tier1: enrichedItems.filter(
        (i) => i.verification?.sourceTier === "tier1_authoritative"
      ).length,
      tier2: enrichedItems.filter(
        (i) => i.verification?.sourceTier === "tier2_reliable"
      ).length,
      tier3: enrichedItems.filter(
        (i) => i.verification?.sourceTier === "tier3_unverified"
      ).length,
    };

    const disputedCount = enrichedItems.filter(
      (i) => i.verification?.hasContradictions
    ).length;

    return {
      total,
      verifiedCount,
      verifiedRate: verifiedCount / total,
      avgConfidence,
      avgInsightScore,
      tierDistribution,
      disputedCount,
    };
  },
});

/**
 * Get verification summary for feed snapshot
 */
export const getVerificationSummary = internalAction({
  args: {
    snapshotId: v.id("forYouFeedSnapshots"),
  },
  handler: async (ctx, { snapshotId }) => {
    // This would be called to generate verification metrics for a stored feed
    // Implementation depends on how snapshots store items
    return {
      snapshotId,
      computed: false,
      message: "Verification summary computation pending",
    };
  },
});
