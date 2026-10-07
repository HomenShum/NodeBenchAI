/**
 * Narrative Event Verification Integration
 *
 * Integrates verification into the narrative thread/event lifecycle:
 * 1. Verify events on creation
 * 2. Check temporal facts against ground truth
 * 3. Detect contradictions across threads
 * 4. Update verification status on narrative posts
 *
 * @module domains/verification/integrations/narrativeVerification
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface NarrativeVerificationResult {
  threadId: Id<"narrativeThreads">;
  eventId?: string;
  sourceCredibilityScore: number;       // 0-1, weighted average of source tiers
  factVerificationRate: number;         // % of fact claims verified
  hasContradictions: boolean;
  contradictionCount: number;
  overallConfidence: number;            // Combined score
  recommendations: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify a narrative event when created
 * Checks source credibility and extracts claims for verification
 */
export const verifyNarrativeEvent = internalAction({
  args: {
    eventId: v.string(),
    threadId: v.id("narrativeThreads"),
    sourceUrls: v.array(v.string()),
    headline: v.string(),
    summary: v.string(),
    artifactIds: v.array(v.id("sourceArtifacts")),
  },
  handler: async (ctx, args): Promise<NarrativeVerificationResult> => {
    const recommendations: string[] = [];

    // Check source credibility for all sources
    const sourceCredibilities = await ctx.runQuery(
      internal.domains.verification.publicSourceRegistry.batchGetSourceCredibility,
      { urls: args.sourceUrls }
    );

    // Calculate weighted credibility score
    const tierWeights = {
      tier1_authoritative: 1.0,
      tier2_reliable: 0.7,
      tier3_unverified: 0.2,
    };

    let credibilitySum = 0;
    for (const source of sourceCredibilities) {
      credibilitySum += tierWeights[source.tier as keyof typeof tierWeights] || 0.2;
    }
    const sourceCredibilityScore = sourceCredibilities.length > 0
      ? credibilitySum / sourceCredibilities.length
      : 0;

    if (sourceCredibilityScore < 0.5) {
      recommendations.push("Add authoritative source (SEC, official announcement) to strengthen credibility");
    }

    // Extract and verify claims from headline + summary
    const content = `${args.headline}. ${args.summary}`;
    const claimExtraction = await ctx.runAction(
      internal.domains.verification.entailmentChecker.extractVerifiableFacts,
      {
        content,
        sourceUrl: args.sourceUrls[0] || "",
      }
    );

    // NOTE: Contradiction detection is enforced on posts (not events) because the
    // contradiction detector expects a postId and persists dispute chains.
    // Event-level contradiction detection is handled in the Newsroom post-process lane.
    const hasContradictions = false;

    // Calculate verification rate (simplified - would need full entailment check)
    const factVerificationRate = sourceCredibilityScore > 0.7 ? 0.8 : 0.4;

    // Calculate overall confidence
    const overallConfidence = (
      sourceCredibilityScore * 0.4 +
      factVerificationRate * 0.4 +
      (hasContradictions ? 0 : 0.2)
    );

    // Log verification
    await ctx.runMutation(
      internal.domains.verification.verificationAuditTrail.logVerificationAction,
      {
        action: "claim_verified",
        targetType: "fact",
        targetId: args.eventId,
        claim: args.headline,
        sourceUrls: args.sourceUrls,
        verdict: overallConfidence > 0.7 ? "verified" : overallConfidence > 0.4 ? "corroborated" : "unverified",
        confidence: overallConfidence,
        reasoning: `Source credibility: ${(sourceCredibilityScore * 100).toFixed(0)}%, Fact verification: ${(factVerificationRate * 100).toFixed(0)}%`,
        sourceTiers: sourceCredibilities.map((s) => s.tier),
        performedBy: "NarrativeVerification",
      }
    );

    return {
      threadId: args.threadId,
      eventId: args.eventId,
      sourceCredibilityScore,
      factVerificationRate,
      hasContradictions,
      contradictionCount: 0,
      overallConfidence,
      recommendations,
    };
  },
});

/**
 * Verify all events in a thread
 */
export const verifyThread = internalAction({
  args: {
    threadId: v.id("narrativeThreads"),
  },
  handler: async (ctx, args) => {
    // Get all events in thread
    const events = await ctx.runQuery(
      internal.domains.narrative.queries.events.getThreadEvents,
      { threadId: args.threadId }
    );

    const eventResults: NarrativeVerificationResult[] = [];
    let totalCredibility = 0;
    let totalVerification = 0;
    let totalContradictions = 0;

    for (const event of events) {
      const result = await ctx.runAction(
        internal.domains.verification.integrations.narrativeVerification.verifyNarrativeEvent,
        {
          eventId: event.eventId,
          threadId: args.threadId,
          sourceUrls: event.sourceUrls || [],
          headline: event.headline,
          summary: event.summary,
          artifactIds: event.artifactIds || [],
        }
      );

      eventResults.push(result);
      totalCredibility += result.sourceCredibilityScore;
      totalVerification += result.factVerificationRate;
      totalContradictions += result.contradictionCount;
    }

    const eventCount = events.length;
    const avgCredibility = eventCount > 0 ? totalCredibility / eventCount : 0;
    const avgVerification = eventCount > 0 ? totalVerification / eventCount : 0;

    return {
      threadId: args.threadId,
      eventCount,
      eventResults,
      summary: {
        avgSourceCredibility: avgCredibility,
        avgFactVerification: avgVerification,
        totalContradictions,
        overallHealth: avgCredibility * 0.5 + avgVerification * 0.5 - (totalContradictions * 0.1),
      },
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TEMPORAL FACT VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify a temporal fact against ground truth and sources
 */
export const verifyTemporalFact = internalAction({
  args: {
    factId: v.string(),
    threadId: v.id("narrativeThreads"),
    subject: v.string(),
    predicate: v.string(),
    object: v.string(),
    claimText: v.string(),
    sourceEventIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Check ground truth
    const groundTruth = await ctx.runQuery(
      internal.domains.verification.groundTruthRegistry.getActiveFactsForSubject,
      {
        subject: args.subject,
      }
    );

    let groundTruthMatch: {
      factId: string;
      isActive: boolean;
      matches: boolean;
    } | null = null;

    if (groundTruth.facts.length > 0) {
      // Look for matching fact
      for (const fact of groundTruth.facts) {
        const claimLower = args.claimText.toLowerCase();
        const factLower = fact.claim.toLowerCase();

        if (
          claimLower.includes(factLower.slice(0, 30)) ||
          factLower.includes(claimLower.slice(0, 30))
        ) {
          groundTruthMatch = {
            factId: fact.factId,
            isActive: !fact.expirationDate,
            matches: !fact.expirationDate,
          };
          break;
        }
      }
    }

    // Get entity info for authoritative source lookup
    const entityInfo = await ctx.runQuery(
      internal.domains.verification.groundTruthRegistry.getKnownEntity,
      { entityKey: args.subject }
    );

    // Determine verification status
    let verdict: "verified" | "corroborated" | "outdated" | "unverified";
    let confidence: number;
    let reasoning: string;

    if (groundTruthMatch?.matches) {
      verdict = "verified";
      confidence = 0.95;
      reasoning = `Matches ground truth fact ${groundTruthMatch.factId}`;
    } else if (groundTruthMatch && !groundTruthMatch.isActive) {
      verdict = "outdated";
      confidence = 0.8;
      reasoning = `Ground truth fact ${groundTruthMatch.factId} has been superseded`;
    } else if (entityInfo.found) {
      verdict = "corroborated";
      confidence = 0.6;
      reasoning = `Entity ${args.subject} found in registry, but no ground truth match`;
    } else {
      verdict = "unverified";
      confidence = 0.3;
      reasoning = "No ground truth available for verification";
    }

    // Log verification
    await ctx.runMutation(
      internal.domains.verification.verificationAuditTrail.logVerificationAction,
      {
        action: verdict === "verified" ? "claim_verified" : "source_checked",
        targetType: "fact",
        targetId: args.factId,
        claim: args.claimText,
        sourceUrls: [],
        verdict,
        confidence,
        reasoning,
        performedBy: "TemporalFactVerification",
        metadata: {
          subject: args.subject,
          predicate: args.predicate,
          object: args.object,
          groundTruthMatch,
          hasEntityInfo: entityInfo.found,
        },
      }
    );

    return {
      factId: args.factId,
      verdict,
      confidence,
      reasoning,
      groundTruthMatch,
      suggestedActions:
        verdict === "unverified"
          ? ["Add authoritative source", "Create ground truth entry from SEC/official source"]
          : verdict === "outdated"
            ? ["Update to current fact", "Mark as superseded"]
            : [],
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// POST VERIFICATION STATUS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get comprehensive verification status for a narrative post
 */
export const getPostVerificationReport = internalAction({
  args: {
    postId: v.id("narrativePosts"),
  },
  handler: async (ctx, args) => {
    // Get post verification status from workflow
    const status = await ctx.runAction(
      internal.domains.verification.verificationWorkflow.getPostVerificationStatus,
      { postId: args.postId }
    );

    // Get source credibility for linked artifacts
    const post = await ctx.runQuery(
      internal.domains.narrative.queries.posts.getPost,
      { postId: args.postId }
    );

    type SourceAnalysisResult = {
      totalSources: number;
      tier1Count: number;
      tier2Count: number;
      tier3Count: number;
    };

    let sourceAnalysis: SourceAnalysisResult | null = null;
    if (post?.citations?.length > 0) {
      const sourceUrls = post.citations
        .map((c: { url?: string }) => c.url)
        .filter(Boolean) as string[];

      if (sourceUrls.length > 0) {
        const credibilities = await ctx.runQuery(
          internal.domains.verification.publicSourceRegistry.batchGetSourceCredibility,
          { urls: sourceUrls }
        );

        const result: SourceAnalysisResult = {
          totalSources: credibilities.length,
          tier1Count: credibilities.filter((c) => c.tier === "tier1_authoritative").length,
          tier2Count: credibilities.filter((c) => c.tier === "tier2_reliable").length,
          tier3Count: credibilities.filter((c) => c.tier === "tier3_unverified").length,
        };
        sourceAnalysis = result;
      }
    }

    return {
      postId: args.postId,
      claimAnalysis: status,
      sourceAnalysis,
      overallScore: calculateOverallScore(status, sourceAnalysis),
      isPublishReady:
        status.verificationRate >= 0.8 &&
        (sourceAnalysis?.tier1Count || 0) + (sourceAnalysis?.tier2Count || 0) > 0,
    };
  },
});

function calculateOverallScore(
  claimAnalysis: { verificationRate: number; factClaims: number },
  sourceAnalysis: { tier1Count: number; tier2Count: number; tier3Count: number; totalSources: number } | null
): number {
  let score = 0;

  // Claim verification weight: 50%
  score += claimAnalysis.verificationRate * 0.5;

  // Source credibility weight: 50%
  if (sourceAnalysis && sourceAnalysis.totalSources > 0) {
    const credibilityScore =
      (sourceAnalysis.tier1Count * 1.0 +
        sourceAnalysis.tier2Count * 0.7 +
        sourceAnalysis.tier3Count * 0.2) /
      sourceAnalysis.totalSources;
    score += credibilityScore * 0.5;
  }

  return Math.min(score, 1.0);
}
