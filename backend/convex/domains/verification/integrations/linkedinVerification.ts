/**
 * LinkedIn Post Verification Integration
 *
 * Connects the verification system to LinkedIn funding/FDA/clinical posts.
 * Automatically:
 * 1. Extracts claims from LinkedIn posts
 * 2. Cross-references with SEC EDGAR for funding claims
 * 3. Cross-references with FDA/ClinicalTrials for regulatory claims
 * 4. Stores verification results in audit trail
 *
 * @module domains/verification/integrations/linkedinVerification
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface LinkedInVerificationResult {
  postId: string;
  postType: "funding" | "fda" | "clinical" | "research" | "ma";
  companyName: string;
  claims: Array<{
    claim: string;
    claimType: string;
    verified: boolean;
    confidence: number;
    authoritativeSource?: string;
    reasoning: string;
  }>;
  overallVerdict: "verified" | "partially_verified" | "unverified" | "needs_review";
  suggestedSources: string[];
  auditId: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNDING POST VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify a LinkedIn funding post against SEC EDGAR and other sources
 */
export const verifyFundingPost = internalAction({
  args: {
    postId: v.string(),
    companyName: v.string(),
    roundType: v.optional(v.string()),
    amountRaw: v.optional(v.string()),
    amountUsd: v.optional(v.number()),
    postUrl: v.string(),
    postContent: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<LinkedInVerificationResult> => {
    const claims: LinkedInVerificationResult["claims"] = [];
    const suggestedSources: string[] = [];

    // Get entity info for SEC lookup
    const entityInfo = await ctx.runQuery(
      internal.domains.verification.groundTruthRegistry.getKnownEntity,
      { entityKey: args.companyName }
    );

    // Build claims from post data
    if (args.amountRaw || args.amountUsd) {
      claims.push({
        claim: `${args.companyName} raised ${args.amountRaw || `$${args.amountUsd}`} in ${args.roundType || "funding round"}`,
        claimType: "funding_amount",
        verified: false,
        confidence: 0,
        reasoning: "Pending verification",
      });
    }

    // Check SEC for public companies
    if (entityInfo.found && entityInfo.identifiers?.cik) {
      suggestedSources.push(
        `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${entityInfo.identifiers.cik}&type=8-K&dateb=&owner=include&count=10`
      );

      // For public companies, funding rounds often appear in 8-K filings
      claims[0] = {
        ...claims[0],
        authoritativeSource: "SEC EDGAR (pending verification)",
        reasoning: `Company has CIK ${entityInfo.identifiers.cik}. Check recent 8-K filings for funding announcements.`,
      };
    } else {
      // Private company - check Crunchbase/PitchBook suggestions
      suggestedSources.push(
        `https://www.crunchbase.com/textsearch?q=${encodeURIComponent(args.companyName)}`
      );
      claims[0] = {
        ...claims[0],
        reasoning: "Private company. Verify against official press release or Crunchbase.",
      };
    }

    // Cross-reference with ground truth
    const groundTruth = await ctx.runQuery(
      internal.domains.verification.groundTruthRegistry.getActiveFactsForSubject,
      {
        subject: args.companyName,
        category: "funding_round",
      }
    );

    if (groundTruth.facts.length > 0) {
      // Check if this matches existing verified facts
      const matchingFact = groundTruth.facts.find(
        (f) => f.claim.toLowerCase().includes(args.roundType?.toLowerCase() || "")
      );

      if (matchingFact) {
        claims[0] = {
          ...claims[0],
          verified: true,
          confidence: 0.9,
          authoritativeSource: matchingFact.sourceUrl,
          reasoning: `Matches verified ground truth fact (${matchingFact.factId})`,
        };
      }
    }

    // Determine overall verdict
    const verifiedCount = claims.filter((c) => c.verified).length;
    let overallVerdict: LinkedInVerificationResult["overallVerdict"];

    if (verifiedCount === claims.length && claims.length > 0) {
      overallVerdict = "verified";
    } else if (verifiedCount > 0) {
      overallVerdict = "partially_verified";
    } else if (entityInfo.found) {
      overallVerdict = "needs_review";
    } else {
      overallVerdict = "unverified";
    }

    // Log to audit trail
    const auditResult = await ctx.runMutation(
      internal.domains.verification.verificationAuditTrail.logVerificationAction,
      {
        action: verifiedCount > 0 ? "claim_verified" : "source_checked",
        targetType: "source",
        targetId: args.postId,
        claim: claims[0]?.claim,
        sourceUrls: [args.postUrl, ...suggestedSources],
        verdict: overallVerdict,
        confidence: claims[0]?.confidence || 0,
        reasoning: claims.map((c) => c.reasoning).join("; "),
        performedBy: "LinkedInVerification",
        metadata: {
          companyName: args.companyName,
          roundType: args.roundType,
          amountRaw: args.amountRaw,
          hasCik: !!entityInfo.identifiers?.cik,
        },
      }
    );

    return {
      postId: args.postId,
      postType: "funding",
      companyName: args.companyName,
      claims,
      overallVerdict,
      suggestedSources,
      auditId: auditResult.auditId,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// FDA/CLINICAL POST VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify a LinkedIn FDA/clinical post against FDA.gov and ClinicalTrials.gov
 */
export const verifyRegulatoryPost = internalAction({
  args: {
    postId: v.string(),
    postType: v.union(v.literal("fda"), v.literal("clinical")),
    companyName: v.string(),
    drugName: v.optional(v.string()),
    indication: v.optional(v.string()),
    trialPhase: v.optional(v.string()),
    approvalType: v.optional(v.string()),
    postUrl: v.string(),
  },
  handler: async (ctx, args): Promise<LinkedInVerificationResult> => {
    const claims: LinkedInVerificationResult["claims"] = [];
    const suggestedSources: string[] = [];

    if (args.postType === "fda") {
      // FDA approval claim
      if (args.drugName && args.approvalType) {
        claims.push({
          claim: `${args.drugName} received ${args.approvalType} from FDA`,
          claimType: "fda_approval",
          verified: false,
          confidence: 0,
          reasoning: "Check FDA Drug Approvals database",
        });

        suggestedSources.push(
          `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=`
        );
      }

      // Add FDA Orange Book search
      suggestedSources.push(
        `https://www.accessdata.fda.gov/scripts/cder/ob/search_product.cfm`
      );
    } else if (args.postType === "clinical") {
      // Clinical trial claim
      if (args.drugName && args.trialPhase) {
        claims.push({
          claim: `${args.drugName} ${args.trialPhase} trial results for ${args.indication || "condition"}`,
          claimType: "clinical_trial",
          verified: false,
          confidence: 0,
          reasoning: "Check ClinicalTrials.gov registry",
        });

        suggestedSources.push(
          `https://clinicaltrials.gov/search?term=${encodeURIComponent(args.drugName)}&cond=${encodeURIComponent(args.indication || "")}`
        );
      }
    }

    // Check ground truth for regulatory facts
    const groundTruth = await ctx.runQuery(
      internal.domains.verification.groundTruthRegistry.getActiveFactsForSubject,
      {
        subject: args.companyName,
        category: "regulatory_approval",
      }
    );

    if (groundTruth.facts.length > 0 && args.drugName) {
      const matchingFact = groundTruth.facts.find(
        (f) => f.claim.toLowerCase().includes(args.drugName!.toLowerCase())
      );

      if (matchingFact) {
        claims[0] = {
          ...claims[0],
          verified: true,
          confidence: 0.95,
          authoritativeSource: matchingFact.sourceUrl,
          reasoning: `Matches verified FDA fact (${matchingFact.factId})`,
        };
      }
    }

    // Determine verdict
    const verifiedCount = claims.filter((c) => c.verified).length;
    let overallVerdict: LinkedInVerificationResult["overallVerdict"];

    if (verifiedCount === claims.length && claims.length > 0) {
      overallVerdict = "verified";
    } else if (verifiedCount > 0) {
      overallVerdict = "partially_verified";
    } else {
      overallVerdict = "needs_review";
    }

    // Log to audit trail
    const auditResult = await ctx.runMutation(
      internal.domains.verification.verificationAuditTrail.logVerificationAction,
      {
        action: verifiedCount > 0 ? "claim_verified" : "source_checked",
        targetType: "source",
        targetId: args.postId,
        claim: claims[0]?.claim,
        sourceUrls: [args.postUrl, ...suggestedSources],
        verdict: overallVerdict,
        confidence: claims[0]?.confidence || 0,
        reasoning: claims.map((c) => c.reasoning).join("; "),
        performedBy: "RegulatoryVerification",
        metadata: {
          postType: args.postType,
          companyName: args.companyName,
          drugName: args.drugName,
          indication: args.indication,
        },
      }
    );

    return {
      postId: args.postId,
      postType: args.postType,
      companyName: args.companyName,
      claims,
      overallVerdict,
      suggestedSources,
      auditId: auditResult.auditId,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// BATCH VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Batch verify multiple LinkedIn posts
 */
export const batchVerifyLinkedInPosts = internalAction({
  args: {
    posts: v.array(
      v.object({
        postId: v.string(),
        postType: v.union(
          v.literal("funding"),
          v.literal("fda"),
          v.literal("clinical"),
          v.literal("research"),
          v.literal("ma")
        ),
        companyName: v.string(),
        postUrl: v.string(),
        metadata: v.optional(v.any()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const results: LinkedInVerificationResult[] = [];

    for (const post of args.posts) {
      let result: LinkedInVerificationResult;

      if (post.postType === "funding") {
        result = await ctx.runAction(
          internal.domains.verification.integrations.linkedinVerification.verifyFundingPost,
          {
            postId: post.postId,
            companyName: post.companyName,
            postUrl: post.postUrl,
            roundType: post.metadata?.roundType,
            amountRaw: post.metadata?.amountRaw,
            amountUsd: post.metadata?.amountUsd,
          }
        );
      } else if (post.postType === "fda" || post.postType === "clinical") {
        result = await ctx.runAction(
          internal.domains.verification.integrations.linkedinVerification.verifyRegulatoryPost,
          {
            postId: post.postId,
            postType: post.postType,
            companyName: post.companyName,
            postUrl: post.postUrl,
            drugName: post.metadata?.drugName,
            indication: post.metadata?.indication,
            trialPhase: post.metadata?.trialPhase,
            approvalType: post.metadata?.approvalType,
          }
        );
      } else {
        // Generic verification for research/M&A posts
        result = {
          postId: post.postId,
          postType: post.postType,
          companyName: post.companyName,
          claims: [],
          overallVerdict: "needs_review",
          suggestedSources: [],
          auditId: `pending_${Date.now()}`,
        };
      }

      results.push(result);
    }

    // Summary stats
    const verified = results.filter((r) => r.overallVerdict === "verified").length;
    const partial = results.filter((r) => r.overallVerdict === "partially_verified").length;
    const needsReview = results.filter((r) => r.overallVerdict === "needs_review").length;
    const unverified = results.filter((r) => r.overallVerdict === "unverified").length;

    return {
      results,
      summary: {
        total: results.length,
        verified,
        partiallyVerified: partial,
        needsReview,
        unverified,
        verificationRate: (verified + partial) / results.length,
      },
    };
  },
});
