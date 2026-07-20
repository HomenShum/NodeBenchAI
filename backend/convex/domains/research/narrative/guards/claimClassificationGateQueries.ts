/**
 * Claim Classification Gate Queries
 *
 * Separated from claimClassificationGate.ts because queries cannot run in Node.js.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "../../../../_generated/server";
import type { Id } from "../../../../_generated/dataModel";

export type ClaimType = "fact_claim" | "inference" | "sentiment" | "meta";

/**
 * Store a classification
 */
export const storeClassification = internalMutation({
  args: {
    postId: v.id("narrativePosts"),
    sentenceIndex: v.number(),
    sentenceText: v.string(),
    claimType: v.string(),
    confidence: v.number(),
    classifiedBy: v.string(),
  },
  handler: async (ctx, args) => {
    // Check for existing
    const existing = await ctx.db
      .query("claimClassifications")
      .withIndex("by_post", q => q.eq("postId", args.postId).eq("sentenceIndex", args.sentenceIndex))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        claimType: args.claimType as ClaimType,
        confidence: args.confidence,
        classifiedAt: Date.now(),
        classifiedBy: args.classifiedBy,
      });
      return existing._id;
    }

    return await ctx.db.insert("claimClassifications", {
      postId: args.postId,
      sentenceIndex: args.sentenceIndex,
      sentenceText: args.sentenceText,
      claimType: args.claimType as ClaimType,
      confidence: args.confidence,
      isVerified: false,
      classifiedAt: Date.now(),
      classifiedBy: args.classifiedBy,
    });
  },
});

/**
 * Get classifications for a post
 */
export const getPostClassifications = internalQuery({
  args: {
    postId: v.id("narrativePosts"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("claimClassifications")
      .withIndex("by_post", q => q.eq("postId", args.postId))
      .collect();
  },
});

/**
 * Get contested facts that a post references
 */
export const getContestedFactsForPost = internalQuery({
  args: {
    postId: v.id("narrativePosts"),
  },
  handler: async (ctx, args) => {
    // Get post's linked facts
    const classifications = await ctx.db
      .query("claimClassifications")
      .withIndex("by_post", q => q.eq("postId", args.postId))
      .filter(q => q.eq(q.field("claimType"), "fact_claim"))
      .collect();

    const allFactIds = classifications
      .flatMap(c => c.linkedFactIds || [])
      .filter((id, i, arr) => arr.indexOf(id) === i);  // Dedupe

    // Check truth state for each
    const contested: Array<{
      factId: Id<"temporalFacts">;
      status: string;
      showInDefault: boolean;
      requiresContext: boolean;
      contextNote?: string;
      activeDisputeIds: Id<"narrativeDisputeChains">[];
    }> = [];
    for (const factId of allFactIds) {
      const truthState = await ctx.db
        .query("truthState")
        .withIndex("by_fact", q => q.eq("factId", factId))
        .first();

      if (truthState && truthState.status === "contested") {
        contested.push({
          factId,
          ...truthState,
        });
      }
    }

    return contested;
  },
});

/**
 * Get unverified fact claims needing attention
 */
export const getUnverifiedFactClaims = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("claimClassifications")
      .withIndex("by_unverified", q => q.eq("isVerified", false).eq("claimType", "fact_claim"))
      .take(args.limit || 50);
  },
});

/**
 * Link a fact claim to supporting evidence
 */
export const linkFactToEvidence = internalMutation({
  args: {
    postId: v.id("narrativePosts"),
    sentenceIndex: v.number(),
    factIds: v.array(v.id("temporalFacts")),
    artifactIds: v.array(v.id("sourceArtifacts")),
    verificationNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Find the classification
    const classification = await ctx.db
      .query("claimClassifications")
      .withIndex("by_post", q => q.eq("postId", args.postId).eq("sentenceIndex", args.sentenceIndex))
      .first();

    if (!classification) {
      throw new Error(`No classification found for post ${args.postId} sentence ${args.sentenceIndex}`);
    }

    if (classification.claimType !== "fact_claim") {
      throw new Error(`Cannot link evidence to non-fact claim (type: ${classification.claimType})`);
    }

    // Update with evidence links
    await ctx.db.patch(classification._id, {
      linkedFactIds: args.factIds,
      linkedArtifactIds: args.artifactIds,
      isVerified: args.factIds.length > 0 || args.artifactIds.length > 0,
      verificationNote: args.verificationNote,
    });

    return classification._id;
  },
});
