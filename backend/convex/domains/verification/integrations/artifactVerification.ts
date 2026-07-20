/**
 * Source Artifact Verification Integration
 *
 * Provides verification hooks for source artifacts.
 * When artifacts are created or accessed:
 * 1. Checks source credibility tier
 * 2. Extracts verifiable claims from content
 * 3. Cross-references with ground truth
 * 4. Attaches verification metadata to artifacts
 *
 * @module domains/verification/integrations/artifactVerification
 */

"use node";

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ArtifactVerificationResult {
  artifactId: Id<"sourceArtifacts">;
  sourceUrl: string;
  credibilityTier: string;
  category: string;
  canSupportFactClaims: boolean;
  extractedClaims: Array<{
    claim: string;
    claimType: string;
    confidence: number;
  }>;
  verificationStatus: "verified" | "pending" | "unverifiable";
  auditId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// ARTIFACT VERIFICATION HOOKS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify a source artifact on creation
 * Call this after upsertSourceArtifact to add verification metadata
 */
export const verifyArtifactOnCreate = internalAction({
  args: {
    artifactId: v.id("sourceArtifacts"),
    sourceUrl: v.string(),
    content: v.optional(v.string()),
    extractClaims: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ArtifactVerificationResult> => {
    // Get source credibility
    const credibility = await ctx.runQuery(
      internal.domains.verification.publicSourceRegistry.getSourceCredibility,
      { url: args.sourceUrl }
    );

    const extractedClaims: ArtifactVerificationResult["extractedClaims"] = [];

    // Extract claims if content provided and requested
    if (args.content && args.extractClaims) {
      const extracted = await ctx.runAction(
        internal.domains.verification.entailmentChecker.extractVerifiableFacts,
        {
          content: args.content,
          sourceUrl: args.sourceUrl,
        }
      );

      if (extracted.facts) {
        for (const fact of extracted.facts) {
          extractedClaims.push({
            claim: fact.claimText,
            claimType: fact.claimType,
            confidence: fact.extractionConfidence,
          });
        }
      }
    }

    // Determine verification status
    let verificationStatus: ArtifactVerificationResult["verificationStatus"];
    if (credibility.tier === "tier1_authoritative") {
      verificationStatus = "verified";
    } else if (credibility.canSupportFactClaims) {
      verificationStatus = "pending";
    } else {
      verificationStatus = "unverifiable";
    }

    // Log to audit trail
    const auditResult = await ctx.runMutation(
      internal.domains.verification.verificationAuditTrail.logSourceCheck,
      {
        sourceUrl: args.sourceUrl,
        domain: credibility.domain || new URL(args.sourceUrl).hostname,
        tier: credibility.tier,
        category: credibility.category,
        canSupportFactClaims: credibility.canSupportFactClaims,
        performedBy: "ArtifactVerification",
      }
    );

    return {
      artifactId: args.artifactId,
      sourceUrl: args.sourceUrl,
      credibilityTier: credibility.tier,
      category: credibility.category,
      canSupportFactClaims: credibility.canSupportFactClaims,
      extractedClaims,
      verificationStatus,
      auditId: auditResult.auditId,
    };
  },
});

/**
 * Batch verify multiple artifacts
 */
export const batchVerifyArtifacts = internalAction({
  args: {
    artifacts: v.array(
      v.object({
        artifactId: v.id("sourceArtifacts"),
        sourceUrl: v.string(),
        content: v.optional(v.string()),
      })
    ),
    extractClaims: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const results: ArtifactVerificationResult[] = [];

    for (const artifact of args.artifacts) {
      const result = await ctx.runAction(
        internal.domains.verification.integrations.artifactVerification.verifyArtifactOnCreate,
        {
          artifactId: artifact.artifactId,
          sourceUrl: artifact.sourceUrl,
          content: artifact.content,
          extractClaims: args.extractClaims,
        }
      );
      results.push(result);
    }

    // Summary by tier
    const byTier = {
      tier1_authoritative: results.filter((r) => r.credibilityTier === "tier1_authoritative").length,
      tier2_reliable: results.filter((r) => r.credibilityTier === "tier2_reliable").length,
      tier3_unverified: results.filter((r) => r.credibilityTier === "tier3_unverified").length,
    };

    return {
      results,
      summary: {
        total: results.length,
        byTier,
        verifiable: byTier.tier1_authoritative + byTier.tier2_reliable,
        unverifiable: byTier.tier3_unverified,
      },
    };
  },
});

/**
 * Get verification status for an artifact
 */
export const getArtifactVerificationStatus = internalAction({
  args: {
    artifactId: v.id("sourceArtifacts"),
  },
  handler: async (ctx, args) => {
    // Get artifact info
    const artifact = await ctx.runQuery(
      internal.domains.artifacts.sourceArtifacts.getArtifactById,
      { id: args.artifactId }
    );

    if (!artifact || !artifact.sourceUrl) {
      return {
        artifactId: args.artifactId,
        status: "unknown",
        reason: "Artifact not found or has no source URL",
      };
    }

    // Check audit history
    const auditHistory = await ctx.runQuery(
      internal.domains.verification.verificationAuditTrail.getAuditLogForTarget,
      {
        targetType: "source",
        targetId: artifact.sourceUrl,
      }
    );

    if (auditHistory.entries.length > 0) {
      const latest = auditHistory.entries[0];
      return {
        artifactId: args.artifactId,
        sourceUrl: artifact.sourceUrl,
        status: latest.verdict,
        lastChecked: latest.performedAt,
        checkCount: auditHistory.entries.length,
        tier: latest.sourceTiers?.[0],
      };
    }

    // No audit history - check credibility
    const credibility = await ctx.runQuery(
      internal.domains.verification.publicSourceRegistry.getSourceCredibility,
      { url: artifact.sourceUrl }
    );

    return {
      artifactId: args.artifactId,
      sourceUrl: artifact.sourceUrl,
      status: "unchecked",
      tier: credibility.tier,
      canSupportFactClaims: credibility.canSupportFactClaims,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// ARTIFACT CLAIM BINDING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Bind claims in a post to supporting artifacts
 * This creates the evidence chain: claim → artifact → source
 */
export const bindClaimsToArtifacts = internalAction({
  args: {
    postId: v.id("narrativePosts"),
    claims: v.array(
      v.object({
        sentenceIndex: v.number(),
        claim: v.string(),
      })
    ),
    artifactIds: v.array(v.id("sourceArtifacts")),
  },
  handler: async (ctx, args) => {
    const bindings: Array<{
      sentenceIndex: number;
      claim: string;
      supportingArtifacts: Array<{
        artifactId: Id<"sourceArtifacts">;
        entailment: string;
        confidence: number;
      }>;
    }> = [];

    for (const claimData of args.claims) {
      const supportingArtifacts: Array<{
        artifactId: Id<"sourceArtifacts">;
        entailment: string;
        confidence: number;
      }> = [];

      // Check each artifact for entailment
      for (const artifactId of args.artifactIds) {
        const artifact = await ctx.runQuery(
          internal.domains.artifacts.sourceArtifacts.getArtifactById,
          { id: artifactId }
        );

        if (artifact?.rawContent) {
          const entailment = await ctx.runAction(
            internal.domains.verification.entailmentChecker.checkEntailment,
            {
              claim: claimData.claim,
              sourceContent: artifact.rawContent,
              sourceUrl: artifact.sourceUrl || "",
            }
          );

          if (entailment.verdict === "entailed") {
            supportingArtifacts.push({
              artifactId,
              entailment: entailment.verdict,
              confidence: entailment.confidence,
            });
          }
        }
      }

      bindings.push({
        sentenceIndex: claimData.sentenceIndex,
        claim: claimData.claim,
        supportingArtifacts,
      });
    }

    // Update claim classifications with linked artifacts
    for (const binding of bindings) {
      if (binding.supportingArtifacts.length > 0) {
        await ctx.runMutation(
          internal.domains.narrative.guards.claimClassificationGateQueries.linkFactToEvidence,
          {
            postId: args.postId,
            sentenceIndex: binding.sentenceIndex,
            factIds: [],
            artifactIds: binding.supportingArtifacts.map((a) => a.artifactId),
            verificationNote: `Entailed by ${binding.supportingArtifacts.length} source(s)`,
          }
        );
      }
    }

    return {
      postId: args.postId,
      bindings,
      totalClaims: args.claims.length,
      boundClaims: bindings.filter((b) => b.supportingArtifacts.length > 0).length,
      unboundClaims: bindings.filter((b) => b.supportingArtifacts.length === 0).length,
    };
  },
});
