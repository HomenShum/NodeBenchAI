// convex/domains/verification/claimVerifications.ts
// Queries for claim verification results
// Used by UI to display verification badges on EvidenceChips

import { v } from "convex/values";
import { query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ═══════════════════════════════════════════════════════════════════════════
// AUTH HELPER
// ═══════════════════════════════════════════════════════════════════════════

async function getSafeUserId(ctx: any): Promise<string | null> {
  const rawUserId = await getAuthUserId(ctx);
  if (!rawUserId) return null;
  
  if (typeof rawUserId === 'string' && rawUserId.includes('|')) {
    return rawUserId.split('|')[0] || null;
  }
  return rawUserId;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all verifications for a run
 */
export const getVerificationsByRun = query({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (!userId) return [];
    
    return await ctx.db
      .query("claimVerifications")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});

/**
 * Get verifications for a specific fact
 */
export const getVerificationsForFact = query({
  args: {
    runId: v.string(),
    factId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (!userId) return [];
    
    return await ctx.db
      .query("claimVerifications")
      .withIndex("by_run_fact", (q) => 
        q.eq("runId", args.runId).eq("factId", args.factId)
      )
      .collect();
  },
});

/**
 * Get verification for a specific fact + artifact pair
 */
export const getVerificationForFactArtifact = query({
  args: {
    runId: v.string(),
    factId: v.string(),
    artifactId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("claimVerifications")
      .withIndex("by_run_fact_artifact", (q) => 
        q.eq("runId", args.runId)
         .eq("factId", args.factId)
         .eq("artifactId", args.artifactId)
      )
      .first();
  },
});

/**
 * Get verification summary for a run
 * Returns aggregate counts by verdict
 */
export const getVerificationSummary = query({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (!userId) return null;
    
    const verifications = await ctx.db
      .query("claimVerifications")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    
    if (verifications.length === 0) {
      return {
        total: 0,
        supported: 0,
        notFound: 0,
        contradicted: 0,
        inaccessible: 0,
        averageConfidence: 0,
      };
    }
    
    const summary = {
      total: verifications.length,
      supported: 0,
      notFound: 0,
      contradicted: 0,
      inaccessible: 0,
      averageConfidence: 0,
    };
    
    let totalConfidence = 0;
    
    for (const v of verifications) {
      totalConfidence += v.confidence;
      switch (v.verdict) {
        case "supported":
          summary.supported++;
          break;
        case "not_found":
          summary.notFound++;
          break;
        case "contradicted":
          summary.contradicted++;
          break;
        case "inaccessible":
          summary.inaccessible++;
          break;
      }
    }
    
    summary.averageConfidence = totalConfidence / verifications.length;
    
    return summary;
  },
});

/**
 * Get all artifacts with their verification health for a run
 */
export const getArtifactsWithHealth = query({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (!userId) return [];
    
    const artifacts = await ctx.db
      .query("artifacts")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    
    // Filter to user's artifacts and return with health
    return artifacts
      .filter(a => a.userId === userId)
      .map(a => ({
        artifactId: a.artifactId,
        title: a.title,
        canonicalUrl: a.canonicalUrl,
        verificationHealth: a.verificationHealth || "unknown",
        lastVerificationAt: a.lastVerificationAt,
      }));
  },
});
