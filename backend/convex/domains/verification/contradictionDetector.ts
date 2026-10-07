/**
 * Contradiction Detector
 *
 * Detects contradictions between:
 * - New posts and existing posts in a thread
 * - New posts and temporal facts
 * - Claims within the same thread
 *
 * When contradictions are found, creates dispute chain entries
 * for HITL resolution.
 *
 * @module domains/verification/contradictionDetector
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

// Note: getThreadClaims and getPostsNeedingCheck queries are in contradictionDetectorQueries.ts
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ExtractedClaim {
  claim: string;
  context: string;
  sourcePostId?: Id<"narrativePosts">;
  sourceFactId?: Id<"temporalFacts">;
  confidence: number;
}

export interface Contradiction {
  existingClaim: ExtractedClaim;
  newClaim: ExtractedClaim;
  contradictionType: "direct" | "temporal" | "quantitative" | "logical";
  severity: "low" | "medium" | "high" | "critical";
  explanation: string;
  confidence: number;
}

export interface DetectionResult {
  hasContradictions: boolean;
  contradictions: Contradiction[];
  claimsExtracted: number;
  postsAnalyzed: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLAIM EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract factual claims from text content
 */
export const extractClaims = internalAction({
  args: {
    content: v.string(),
    sourceType: v.union(v.literal("post"), v.literal("fact")),
    sourceId: v.string(),
  },
  handler: async (_ctx, args) => {
    const prompt = `Extract all factual claims from the following text. Focus on:
- Numerical claims (dates, amounts, percentages)
- Entity relationships (X acquired Y, X partnered with Y)
- Status claims (X is true, Y happened)
- Temporal claims (X will happen, Y happened on date)

TEXT:
${args.content.slice(0, 3000)}

Return JSON array of claims:
[
  {
    "claim": "The specific factual claim",
    "context": "Surrounding context for the claim",
    "confidence": 0.0-1.0
  }
]

Only include verifiable factual claims, not opinions or speculation.`;

    try {
      const result = await generateText({
        model: openai.chat("gpt-5.4-nano"),
        prompt,
        temperature: 0.1,
      });

      const jsonMatch = result.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return [];
      }

      const claims = JSON.parse(jsonMatch[0]);
      return claims.map((c: any) => ({
        claim: c.claim,
        context: c.context,
        [`source${args.sourceType === "post" ? "PostId" : "FactId"}`]: args.sourceId,
        confidence: c.confidence,
      }));
    } catch (error) {
      console.error("[extractClaims] Error:", error);
      return [];
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CONTRADICTION DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compare claims to find contradictions using LLM
 */
export const findClaimContradictions = internalAction({
  args: {
    newClaims: v.array(v.object({
      claim: v.string(),
      context: v.string(),
      confidence: v.number(),
    })),
    existingClaims: v.array(v.object({
      claim: v.string(),
      context: v.optional(v.string()),
      sourceType: v.string(),
      sourceId: v.string(),
      confidence: v.number(),
    })),
  },
  handler: async (_ctx, args) => {
    if (args.newClaims.length === 0 || args.existingClaims.length === 0) {
      return [];
    }

    const prompt = `You are a fact-checker. Compare these NEW CLAIMS against EXISTING CLAIMS and identify any contradictions.

NEW CLAIMS:
${args.newClaims.map((c, i) => `${i + 1}. "${c.claim}" (context: ${c.context})`).join("\n")}

EXISTING CLAIMS:
${args.existingClaims.slice(0, 20).map((c, i) => `${i + 1}. "${c.claim}" [${c.sourceType}:${c.sourceId}]`).join("\n")}

Find contradictions where:
- Direct contradiction: opposite claims about the same fact
- Temporal contradiction: conflicting dates or sequences
- Quantitative contradiction: conflicting numbers
- Logical contradiction: claims that can't both be true

Return JSON array (empty if no contradictions):
[
  {
    "newClaimIndex": 0,
    "existingClaimIndex": 0,
    "contradictionType": "direct" | "temporal" | "quantitative" | "logical",
    "severity": "low" | "medium" | "high" | "critical",
    "explanation": "Why these claims contradict",
    "confidence": 0.0-1.0
  }
]`;

    try {
      const result = await generateText({
        model: openai.chat("gpt-5.4-nano"),
        prompt,
        temperature: 0.1,
      });

      const jsonMatch = result.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return [];
      }

      const contradictions = JSON.parse(jsonMatch[0]);

      return contradictions.map((c: any) => ({
        existingClaim: {
          claim: args.existingClaims[c.existingClaimIndex]?.claim || "",
          context: args.existingClaims[c.existingClaimIndex]?.context || "",
          confidence: args.existingClaims[c.existingClaimIndex]?.confidence || 0,
        },
        newClaim: {
          claim: args.newClaims[c.newClaimIndex]?.claim || "",
          context: args.newClaims[c.newClaimIndex]?.context || "",
          confidence: args.newClaims[c.newClaimIndex]?.confidence || 0,
        },
        contradictionType: c.contradictionType,
        severity: c.severity,
        explanation: c.explanation,
        confidence: c.confidence,
      }));
    } catch (error) {
      console.error("[findClaimContradictions] Error:", error);
      return [];
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MAIN DETECTION PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect contradictions for a new post against thread content
 */
export const detectContradictions = internalAction({
  args: {
    threadId: v.id("narrativeThreads"),
    postId: v.id("narrativePosts"),
    content: v.string(),
  },
  returns: v.object({
    hasContradictions: v.boolean(),
    contradictionCount: v.number(),
    disputeIds: v.array(v.id("narrativeDisputeChains")),
  }),
  handler: async (ctx, args) => {
    // Step 1: Extract claims from new post
    const newClaims = await ctx.runAction(
      internal.domains.verification.contradictionDetector.extractClaims,
      {
        content: args.content,
        sourceType: "post",
        sourceId: args.postId,
      }
    );

    if (newClaims.length === 0) {
      return {
        hasContradictions: false,
        contradictionCount: 0,
        disputeIds: [],
      };
    }

    // Step 2: Get existing claims from thread
    const threadData = await ctx.runQuery(
      internal.domains.verification.contradictionDetectorQueries.getThreadClaims,
      {
        threadId: args.threadId,
        lookbackDays: 30,
      }
    );

    // Build existing claims list from posts and facts
    const existingClaims: any[] = [];

    for (const post of threadData.posts) {
      // Extract claims from each post (simplified - in production, cache these)
      const postClaims = await ctx.runAction(
        internal.domains.verification.contradictionDetector.extractClaims,
        {
          content: post.content,
          sourceType: "post",
          sourceId: post._id,
        }
      );

      existingClaims.push(...postClaims.map((c: any) => ({
        ...c,
        sourceType: "post",
        sourceId: post._id,
      })));
    }

    // Add facts as claims
    for (const fact of threadData.facts) {
      existingClaims.push({
        claim: fact.claim,
        context: `Valid from ${new Date(fact.validFrom).toISOString()}`,
        sourceType: "fact",
        sourceId: fact._id,
        confidence: fact.confidence,
      });
    }

    if (existingClaims.length === 0) {
      return {
        hasContradictions: false,
        contradictionCount: 0,
        disputeIds: [],
      };
    }

    // Step 3: Find contradictions
    const contradictions = await ctx.runAction(
      internal.domains.verification.contradictionDetector.findClaimContradictions,
      {
        newClaims: newClaims.map((c: any) => ({
          claim: c.claim,
          context: c.context,
          confidence: c.confidence,
        })),
        existingClaims: existingClaims.slice(0, 30),
      }
    );

    if (contradictions.length === 0) {
      return {
        hasContradictions: false,
        contradictionCount: 0,
        disputeIds: [],
      };
    }

    // Step 4: Create dispute chain entries for each contradiction
    const disputeIds: Id<"narrativeDisputeChains">[] = [];

    for (const contradiction of contradictions) {
      if (contradiction.severity === "low" && contradiction.confidence < 0.7) {
        continue; // Skip low-confidence minor contradictions
      }

      const disputeId = await ctx.runMutation(
        internal.domains.narrative.mutations.disputes.createDisputeInternal,
        {
          targetType: "post",
          targetId: args.postId,
          disputeType: "factual_error",
          originalClaim: contradiction.existingClaim.claim,
          challengeClaim: contradiction.newClaim.claim,
          evidenceArtifactIds: [],
          agentName: "ContradictionDetector",
        }
      );

      disputeIds.push(disputeId);
    }

    // Step 5: Mark the post as having contradictions
    if (disputeIds.length > 0) {
      await ctx.runMutation(
        internal.domains.narrative.mutations.posts.markContradictions,
        {
          postId: args.postId,
          hasContradictions: true,
          requiresAdjudication: true,
        }
      );
    }

    return {
      hasContradictions: disputeIds.length > 0,
      contradictionCount: disputeIds.length,
      disputeIds,
    };
  },
});

/**
 * Batch check multiple posts for contradictions
 */
export const batchDetectContradictions = internalAction({
  args: {
    threadId: v.id("narrativeThreads"),
    postIds: v.array(v.id("narrativePosts")),
  },
  handler: async (ctx, args) => {
    const results: {
      postId: Id<"narrativePosts">;
      hasContradictions: boolean;
      contradictionCount: number;
      disputeIds: Id<"narrativeDisputeChains">[];
    }[] = [];

    for (const postId of args.postIds) {
      const post = await ctx.runQuery(
        internal.domains.narrative.queries.posts.getPost,
        { postId }
      );

      if (!post) continue;

      const result = await ctx.runAction(
        internal.domains.verification.contradictionDetector.detectContradictions,
        {
          threadId: args.threadId,
          postId,
          content: post.content,
        }
      );

      results.push({
        postId,
        ...result,
      });
    }

    return results;
  },
});

// Note: getPostsNeedingCheck query is in contradictionDetectorQueries.ts
