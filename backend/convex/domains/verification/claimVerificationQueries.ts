// convex/domains/verification/claimVerificationQueries.ts
// Internal queries and mutations for claim verification (non-Node file)

import { v } from "convex/values";
import { internalQuery, internalMutation } from "../../_generated/server";
import { Doc } from "../../_generated/dataModel";

/**
 * Internal query to get artifact for verification
 */
export const getArtifactForVerification = internalQuery({
  args: {
    runId: v.string(),
    artifactId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("artifacts")
      .withIndex("by_run_artifact", (q) =>
        q.eq("runId", args.runId).eq("artifactId", args.artifactId)
      )
      .first() as Doc<"artifacts"> | null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Store verification result
 */
export const storeVerification = internalMutation({
  args: {
    runId: v.string(),
    factId: v.string(),
    artifactId: v.string(),
    verdict: v.union(
      v.literal("supported"),
      v.literal("not_found"),
      v.literal("contradicted"),
      v.literal("inaccessible")
    ),
    confidence: v.number(),
    explanation: v.optional(v.string()),
    snippet: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check if verification already exists
    const existing = await ctx.db
      .query("claimVerifications")
      .withIndex("by_run_fact_artifact", (q) =>
        q.eq("runId", args.runId).eq("factId", args.factId).eq("artifactId", args.artifactId)
      )
      .first() as Doc<"claimVerifications"> | null;

    if (existing) {
      // Update existing verification
      await ctx.db.patch(existing._id, {
        verdict: args.verdict,
        confidence: args.confidence,
        explanation: args.explanation,
        snippet: args.snippet,
        createdAt: Date.now(),
      });
      return { action: "updated", id: existing._id };
    }

    // Insert new verification
    const id = await ctx.db.insert("claimVerifications", {
      runId: args.runId,
      factId: args.factId,
      artifactId: args.artifactId,
      verdict: args.verdict,
      confidence: args.confidence,
      explanation: args.explanation,
      snippet: args.snippet,
      createdAt: Date.now(),
    });

    return { action: "created", id };
  },
});

/**
 * Update artifact verification health
 */
export const updateArtifactHealth = internalMutation({
  args: {
    runId: v.string(),
    artifactId: v.string(),
  },
  handler: async (ctx, args) => {
    // Get all verifications for this artifact
    const verifications = await ctx.db
      .query("claimVerifications")
      .withIndex("by_artifact", (q) => q.eq("artifactId", args.artifactId))
      .collect();

    if (verifications.length === 0) return;

    // Determine health based on verdicts (worst wins)
    let health: "has_supported" | "has_not_found" | "has_contradicted" = "has_supported";
    let hasContradicted = false;
    let hasNotFound = false;
    
    for (const v of verifications) {
      if (v.verdict === "contradicted") {
        hasContradicted = true;
        break;
      }
      if (v.verdict === "not_found") {
        hasNotFound = true;
      }
    }
    
    if (hasContradicted) {
      health = "has_contradicted";
    } else if (hasNotFound) {
      health = "has_not_found";
    }

    // Update artifact
    const artifact = await ctx.db
      .query("artifacts")
      .withIndex("by_run_artifact", (q) =>
        q.eq("runId", args.runId).eq("artifactId", args.artifactId)
      )
      .first() as Doc<"artifacts"> | null;

    if (artifact) {
      await ctx.db.patch(artifact._id, {
        verificationHealth: health,
        lastVerificationAt: Date.now(),
      });
    }
  },
});
