/**
 * MCP-safe verification endpoints.
 * Internal query variants that accept explicit userId for MCP gateway dispatch.
 * Source logic from: verification/claimVerifications.ts, verification/facts.ts
 */

import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";

/**
 * Get verification summary for a run — bypasses getSafeUserId gate.
 * Source: verification/claimVerifications.ts:89-143
 */
export const mcpGetVerificationSummary = internalQuery({
  args: {
    userId: v.string(),
    runId: v.string(),
  },
  handler: async (ctx, { runId }) => {
    const verifications = await ctx.db
      .query("claimVerifications")
      .withIndex("by_run", (q) => q.eq("runId", runId))
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

    for (const ver of verifications) {
      totalConfidence += ver.confidence;
      switch (ver.verdict) {
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
 * Get verifications for a specific fact — bypasses getSafeUserId gate.
 * Source: verification/claimVerifications.ts:46-61
 */
export const mcpGetVerificationsForFact = internalQuery({
  args: {
    userId: v.string(),
    runId: v.string(),
    factId: v.string(),
  },
  handler: async (ctx, { runId, factId }) => {
    return await ctx.db
      .query("claimVerifications")
      .withIndex("by_run_fact", (q) =>
        q.eq("runId", runId).eq("factId", factId)
      )
      .collect();
  },
});

/**
 * Get all artifacts with their verification health for a run.
 * Source: verification/claimVerifications.ts:149-169
 */
export const mcpGetArtifactsWithHealth = internalQuery({
  args: {
    userId: v.string(),
    runId: v.string(),
  },
  handler: async (ctx, { userId, runId }) => {
    const artifacts = await ctx.db
      .query("artifacts")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect();

    return artifacts
      .filter((a: any) => a.userId === userId)
      .map((a: any) => ({
        artifactId: a.artifactId,
        title: a.title,
        canonicalUrl: a.canonicalUrl,
        verificationHealth: a.verificationHealth || "unknown",
        lastVerificationAt: a.lastVerificationAt,
      }));
  },
});

/**
 * Get all facts for a run — bypasses getSafeUserId gate.
 * Source: verification/facts.ts:31-39
 */
export const mcpGetFactsByRun = internalQuery({
  args: {
    userId: v.string(),
    runId: v.string(),
  },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query("facts")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect();
  },
});
