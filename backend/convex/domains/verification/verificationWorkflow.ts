/**
 * Verification Workflow
 *
 * End-to-end claim verification pipeline that:
 * 1. Checks source credibility (publicSourceRegistry)
 * 2. Runs entailment checking (entailmentChecker)
 * 3. Cross-references with ground truth (groundTruthRegistry)
 * 4. Logs all decisions (verificationAuditTrail)
 *
 * Verdicts:
 * - VERIFIED: Tier1 source entails the claim
 * - CORROBORATED: Tier2 source entails the claim
 * - UNVERIFIED: No authoritative source found
 * - CONTRADICTED: Source contradicts the claim
 * - OUTDATED: Ground truth shows fact is superseded
 *
 * @module domains/verification/verificationWorkflow
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type VerificationVerdict =
  | "verified"
  | "corroborated"
  | "unverified"
  | "contradicted"
  | "outdated"
  | "insufficient";

export interface VerificationResult {
  verdict: VerificationVerdict;
  confidence: number;
  reasoning: string;
  sourceChecks: Array<{
    url: string;
    tier: string;
    entailment: string;
    confidence: number;
  }>;
  groundTruthMatch?: {
    factId: string;
    isActive: boolean;
    matchType: "exact" | "similar" | "conflicting";
  };
  recommendations: string[];
  auditId: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Full verification workflow for a claim
 */
export const verifyClaim = internalAction({
  args: {
    claim: v.string(),
    subject: v.string(),
    claimType: v.string(),
    sources: v.array(
      v.object({
        url: v.string(),
        content: v.string(),
      })
    ),
    requireTier1: v.optional(v.boolean()),
    performedBy: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<VerificationResult> => {
    const performer = args.performedBy ?? "VerificationWorkflow";
    const requireTier1 = args.requireTier1 ?? false;
    const sourceChecks: VerificationResult["sourceChecks"] = [];
    const recommendations: string[] = [];

    // Step 1: Check source credibility
    for (const source of args.sources) {
      const credibility = await ctx.runQuery(
        internal.domains.verification.publicSourceRegistry.getSourceCredibility,
        { url: source.url }
      );

      sourceChecks.push({
        url: source.url,
        tier: credibility.tier,
        entailment: "pending",
        confidence: 0,
      });
    }

    // Step 2: Run entailment checking
    const entailmentResult = await ctx.runAction(
      internal.domains.verification.entailmentChecker.checkEntailmentMultiSource,
      {
        claim: args.claim,
        sources: args.sources.map((s, i) => ({
          url: s.url,
          content: s.content,
          tier: sourceChecks[i].tier,
        })),
      }
    );

    // Update source checks with entailment results
    for (let i = 0; i < entailmentResult.results.length; i++) {
      sourceChecks[i].entailment = entailmentResult.results[i].result.verdict;
      sourceChecks[i].confidence = entailmentResult.results[i].result.confidence;
    }

    // Step 3: Check ground truth
    const groundTruthFacts = await ctx.runQuery(
      internal.domains.verification.groundTruthRegistry.getActiveFactsForSubject,
      {
        subject: args.subject,
        category: args.claimType,
      }
    );

    let groundTruthMatch: VerificationResult["groundTruthMatch"];
    if (groundTruthFacts.facts.length > 0) {
      // Simple string matching for now - could be enhanced with semantic similarity
      const claimLower = args.claim.toLowerCase();
      for (const fact of groundTruthFacts.facts) {
        if (fact.claim.toLowerCase().includes(claimLower.slice(0, 50)) ||
            claimLower.includes(fact.claim.toLowerCase().slice(0, 50))) {
          groundTruthMatch = {
            factId: fact.factId,
            isActive: !fact.expirationDate,
            matchType: fact.expirationDate ? "conflicting" : "similar",
          };
          break;
        }
      }
    }

    // Step 4: Determine verdict
    let verdict: VerificationVerdict;
    let confidence: number;
    let reasoning: string;

    const tier1Entailed = sourceChecks.filter(
      (s) => s.tier === "tier1_authoritative" && s.entailment === "entailed"
    );
    const tier2Entailed = sourceChecks.filter(
      (s) => s.tier === "tier2_reliable" && s.entailment === "entailed"
    );
    const contradicted = sourceChecks.filter((s) => s.entailment === "contradicted");

    if (groundTruthMatch && !groundTruthMatch.isActive) {
      verdict = "outdated";
      confidence = 0.9;
      reasoning = `Ground truth shows this fact was superseded (${groundTruthMatch.factId})`;
    } else if (contradicted.length > 0) {
      verdict = "contradicted";
      confidence = Math.max(...contradicted.map((s) => s.confidence));
      reasoning = `Source ${contradicted[0].url} contradicts the claim`;
    } else if (tier1Entailed.length > 0) {
      verdict = "verified";
      confidence = Math.max(...tier1Entailed.map((s) => s.confidence));
      reasoning = `Tier1 authoritative source (${tier1Entailed[0].url}) entails the claim`;
    } else if (tier2Entailed.length > 0 && !requireTier1) {
      verdict = "corroborated";
      confidence = Math.max(...tier2Entailed.map((s) => s.confidence));
      reasoning = `Tier2 reliable source (${tier2Entailed[0].url}) corroborates the claim`;
    } else if (tier2Entailed.length > 0 && requireTier1) {
      verdict = "insufficient";
      confidence = 0.5;
      reasoning = "Only tier2 sources available, but tier1 required";
      recommendations.push("Find authoritative source (SEC filing, official announcement)");
    } else {
      verdict = "unverified";
      confidence = 0.3;
      reasoning = "No authoritative source entails the claim";
      recommendations.push("Add authoritative source before publishing as fact");
    }

    // Step 5: Cross-reference suggestions
    const crossRef = await ctx.runAction(
      internal.domains.verification.entailmentChecker.crossReferenceWithAuthoritativeSources,
      {
        claim: args.claim,
        subject: args.subject,
        claimType: args.claimType,
        existingSources: args.sources.map((s) => s.url),
      }
    );

    if (crossRef.missingSources.length > 0) {
      recommendations.push(
        `Check: ${crossRef.missingSources.map((s) => s.name).join(", ")}`
      );
    }

    // Step 6: Log to audit trail
    const auditResult = await ctx.runMutation(
      internal.domains.verification.verificationAuditTrail.logClaimVerification,
      {
        claimId: `claim_${Date.now()}`,
        claim: args.claim,
        sourceUrls: args.sources.map((s) => s.url),
        sourceTiers: sourceChecks.map((s) => s.tier),
        verdict,
        confidence,
        reasoning,
        performedBy: performer,
        entailmentResults: entailmentResult,
      }
    );

    return {
      verdict,
      confidence,
      reasoning,
      sourceChecks,
      groundTruthMatch,
      recommendations,
      auditId: auditResult.auditId,
    };
  },
});

/**
 * Quick credibility check for a URL
 */
export const quickCredibilityCheck = internalAction({
  args: {
    url: v.string(),
    performedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const performer = args.performedBy ?? "VerificationWorkflow";

    const credibility = await ctx.runQuery(
      internal.domains.verification.publicSourceRegistry.getSourceCredibility,
      { url: args.url }
    );

    // Log the check
    await ctx.runMutation(
      internal.domains.verification.verificationAuditTrail.logSourceCheck,
      {
        sourceUrl: args.url,
        domain: credibility.domain ?? new URL(args.url).hostname,
        tier: credibility.tier,
        category: credibility.category,
        canSupportFactClaims: credibility.canSupportFactClaims,
        performedBy: performer,
      }
    );

    return credibility;
  },
});

/**
 * Batch verify multiple claims
 */
export const batchVerifyClaims = internalAction({
  args: {
    claims: v.array(
      v.object({
        claim: v.string(),
        subject: v.string(),
        claimType: v.string(),
        sources: v.array(
          v.object({
            url: v.string(),
            content: v.string(),
          })
        ),
      })
    ),
    requireTier1: v.optional(v.boolean()),
    performedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const results: Array<{
      claim: string;
      result: VerificationResult;
    }> = [];

    for (const claimData of args.claims) {
      const result = await ctx.runAction(
        internal.domains.verification.verificationWorkflow.verifyClaim,
        {
          claim: claimData.claim,
          subject: claimData.subject,
          claimType: claimData.claimType,
          sources: claimData.sources,
          requireTier1: args.requireTier1,
          performedBy: args.performedBy,
        }
      );

      results.push({
        claim: claimData.claim,
        result,
      });
    }

    // Summary stats
    const verified = results.filter((r) => r.result.verdict === "verified").length;
    const corroborated = results.filter((r) => r.result.verdict === "corroborated").length;
    const unverified = results.filter((r) => r.result.verdict === "unverified").length;
    const contradicted = results.filter((r) => r.result.verdict === "contradicted").length;

    return {
      results,
      summary: {
        total: results.length,
        verified,
        corroborated,
        unverified,
        contradicted,
        verificationRate: (verified + corroborated) / results.length,
      },
    };
  },
});

/**
 * Get verification status for a post
 */
export const getPostVerificationStatus = internalAction({
  args: {
    postId: v.id("narrativePosts"),
  },
  handler: async (ctx, args) => {
    // Get post classifications
    const classifications = await ctx.runQuery(
      internal.domains.narrative.guards.claimClassificationGateQueries.getPostClassifications,
      { postId: args.postId }
    );

    const factClaims = classifications.filter((c) => c.claimType === "fact_claim");
    const verifiedCount = factClaims.filter((c) => c.isVerified).length;
    const unverifiedCount = factClaims.length - verifiedCount;

    // Get audit history for each claim
    const auditHistory: Array<{
      sentenceIndex: number;
      latestVerdict: string;
      verificationCount: number;
    }> = [];
    for (const claim of factClaims) {
      const audit = await ctx.runQuery(
        internal.domains.verification.verificationAuditTrail.getAuditLogForTarget,
        {
          targetType: "claim",
          targetId: `${args.postId}_${claim.sentenceIndex}`,
        }
      );
      if (audit.entries.length > 0) {
        auditHistory.push({
          sentenceIndex: claim.sentenceIndex,
          latestVerdict: audit.entries[0].verdict,
          verificationCount: audit.entries.length,
        });
      }
    }

    return {
      postId: args.postId,
      totalClaims: classifications.length,
      factClaims: factClaims.length,
      verifiedCount,
      unverifiedCount,
      verificationRate: factClaims.length > 0 ? verifiedCount / factClaims.length : 0,
      auditHistory,
    };
  },
});
