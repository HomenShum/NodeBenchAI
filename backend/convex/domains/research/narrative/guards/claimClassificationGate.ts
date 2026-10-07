/**
 * Claim Classification Gate
 *
 * Enforces editorial integrity by classifying every thesis sentence as:
 * - fact_claim: Must map to temporalFacts + evidenceArtifacts
 * - inference: Analysis based on evidence, must cite supporting sources
 * - sentiment: Community opinion/discourse, must cite representative sources
 * - meta: About the narrative itself
 *
 * P0 ship blocker: Narrative cannot publish if fact_claim_coverage < threshold
 * or if contested facts are presented without dispute context.
 *
 * @module domains/narrative/guards/claimClassificationGate
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import type { Id } from "../../../../_generated/dataModel";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

// Note: Queries and mutations are in claimClassificationGateQueries.ts

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ClaimType = "fact_claim" | "inference" | "sentiment" | "meta";

export interface ClassifiedSentence {
  index: number;
  text: string;
  claimType: ClaimType;
  confidence: number;
  requiresEvidence: boolean;
  suggestedFactIds?: string[];
  reasoning: string;
}

export interface ClassificationResult {
  sentences: ClassifiedSentence[];
  factClaimCount: number;
  factClaimCoverage: number;  // 0-1
  unverifiedFactClaims: number;
  hasContestedFacts: boolean;
  isPublishable: boolean;
  blockReasons: string[];
}

export interface PublicationGateConfig {
  minFactClaimCoverage: number;       // Minimum % of content that must be fact claims
  requireAllFactsVerified: boolean;
  allowContestedFactsWithContext: boolean;
  maxUnverifiedFactClaims: number;
}

const DEFAULT_GATE_CONFIG: PublicationGateConfig = {
  minFactClaimCoverage: 0.3,          // At least 30% fact claims
  requireAllFactsVerified: false,
  allowContestedFactsWithContext: true,
  maxUnverifiedFactClaims: 5,
};

// ═══════════════════════════════════════════════════════════════════════════
// SENTENCE EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Split content into sentences for classification
 */
function extractSentences(content: string): string[] {
  // Simple sentence boundary detection
  const sentences = content
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 10);  // Filter out very short fragments

  return sentences;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Classify sentences in a post using LLM
 */
export const classifySentences = internalAction({
  args: {
    postId: v.id("narrativePosts"),
    content: v.string(),
    threadContext: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ClassificationResult> => {
    const sentences = extractSentences(args.content);

    if (sentences.length === 0) {
      return {
        sentences: [],
        factClaimCount: 0,
        factClaimCoverage: 0,
        unverifiedFactClaims: 0,
        hasContestedFacts: false,
        isPublishable: false,
        blockReasons: ["No classifiable sentences found"],
      };
    }

    const prompt = `You are an editorial fact-checker. Classify each sentence by its claim type:

CLAIM TYPES:
1. fact_claim: A verifiable factual assertion (dates, numbers, events, entity relationships)
   - Examples: "OpenAI raised $6.6B in October 2024", "NVIDIA's H100 uses TSMC 4N process"
   - REQUIRES: Must be verifiable against primary sources

2. inference: Analysis or conclusion based on evidence
   - Examples: "This suggests the market is shifting toward...", "Based on these metrics, we can conclude..."
   - REQUIRES: Must cite supporting evidence

3. sentiment: Community opinion, market sentiment, or discourse summary
   - Examples: "Developers on HN are skeptical...", "The general consensus is..."
   - REQUIRES: Must cite representative sources

4. meta: Statements about the narrative itself
   - Examples: "This report covers...", "In the following section..."
   - Does not require evidence

SENTENCES TO CLASSIFY:
${sentences.map((s, i) => `[${i}] ${s}`).join("\n")}

${args.threadContext ? `THREAD CONTEXT:\n${args.threadContext}` : ""}

For each sentence, provide:
- The claim type
- Confidence (0-1)
- Whether evidence is required
- Brief reasoning

Return JSON array:
[
  {
    "index": 0,
    "claimType": "fact_claim" | "inference" | "sentiment" | "meta",
    "confidence": 0.9,
    "requiresEvidence": true,
    "reasoning": "Contains specific date and funding amount"
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
        return {
          sentences: [],
          factClaimCount: 0,
          factClaimCoverage: 0,
          unverifiedFactClaims: 0,
          hasContestedFacts: false,
          isPublishable: false,
          blockReasons: ["Failed to parse classification response"],
        };
      }

      const classifications = JSON.parse(jsonMatch[0]);
      const classifiedSentences: ClassifiedSentence[] = classifications.map((c: any, i: number) => ({
        index: c.index ?? i,
        text: sentences[c.index ?? i] || "",
        claimType: c.claimType as ClaimType,
        confidence: c.confidence,
        requiresEvidence: c.requiresEvidence,
        reasoning: c.reasoning,
      }));

      // Store classifications
      for (const cs of classifiedSentences) {
        await ctx.runMutation(
          internal.domains.narrative.guards.claimClassificationGateQueries.storeClassification,
          {
            postId: args.postId,
            sentenceIndex: cs.index,
            sentenceText: cs.text,
            claimType: cs.claimType,
            confidence: cs.confidence,
            classifiedBy: "ClaimClassificationGate",
          }
        );
      }

      // Calculate metrics
      const factClaims = classifiedSentences.filter(s => s.claimType === "fact_claim");
      const factClaimCoverage = sentences.length > 0 ? factClaims.length / sentences.length : 0;

      return {
        sentences: classifiedSentences,
        factClaimCount: factClaims.length,
        factClaimCoverage,
        unverifiedFactClaims: factClaims.length,  // All start unverified
        hasContestedFacts: false,  // Will be checked separately
        isPublishable: true,  // Will be validated by gate check
        blockReasons: [],
      };
    } catch (error) {
      console.error("[classifySentences] Error:", error);
      return {
        sentences: [],
        factClaimCount: 0,
        factClaimCoverage: 0,
        unverifiedFactClaims: 0,
        hasContestedFacts: false,
        isPublishable: false,
        blockReasons: [`Classification error: ${error}`],
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PUBLICATION GATE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a post passes the publication gate
 */
export const checkPublicationGate = internalAction({
  args: {
    postId: v.id("narrativePosts"),
    config: v.optional(v.object({
      minFactClaimCoverage: v.number(),
      requireAllFactsVerified: v.boolean(),
      allowContestedFactsWithContext: v.boolean(),
      maxUnverifiedFactClaims: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const config = args.config || DEFAULT_GATE_CONFIG;
    const blockReasons: string[] = [];

    // Get post classifications
    const classifications = await ctx.runQuery(
      internal.domains.narrative.guards.claimClassificationGateQueries.getPostClassifications,
      { postId: args.postId }
    );

    if (classifications.length === 0) {
      blockReasons.push("Post has not been classified yet");
      return { isPublishable: false, blockReasons };
    }

    // Calculate coverage
    const factClaims = classifications.filter(c => c.claimType === "fact_claim");
    const factClaimCoverage = factClaims.length / classifications.length;

    if (factClaimCoverage < config.minFactClaimCoverage) {
      blockReasons.push(
        `Fact claim coverage ${(factClaimCoverage * 100).toFixed(1)}% is below minimum ${(config.minFactClaimCoverage * 100).toFixed(1)}%`
      );
    }

    // Check verification status
    const unverifiedFactClaims = factClaims.filter(c => !c.isVerified);
    if (config.requireAllFactsVerified && unverifiedFactClaims.length > 0) {
      blockReasons.push(`${unverifiedFactClaims.length} fact claims are unverified`);
    }

    if (unverifiedFactClaims.length > config.maxUnverifiedFactClaims) {
      blockReasons.push(
        `${unverifiedFactClaims.length} unverified fact claims exceeds limit of ${config.maxUnverifiedFactClaims}`
      );
    }

    // Check for contested facts
    const contestedFacts = await ctx.runQuery(
      internal.domains.narrative.guards.claimClassificationGateQueries.getContestedFactsForPost,
      { postId: args.postId }
    );

    if (contestedFacts.length > 0) {
      if (!config.allowContestedFactsWithContext) {
        blockReasons.push(`Post contains ${contestedFacts.length} contested facts`);
      } else {
        // Check if context is provided
        const withoutContext = contestedFacts.filter(f => !f.contextNote);
        if (withoutContext.length > 0) {
          blockReasons.push(
            `${withoutContext.length} contested facts lack required dispute context`
          );
        }
      }
    }

    return {
      isPublishable: blockReasons.length === 0,
      blockReasons,
      metrics: {
        totalSentences: classifications.length,
        factClaimCount: factClaims.length,
        factClaimCoverage,
        unverifiedCount: unverifiedFactClaims.length,
        contestedCount: contestedFacts.length,
      },
    };
  },
});

// Note: Queries and mutations are in claimClassificationGateQueries.ts
// - storeClassification
// - getPostClassifications
// - getContestedFactsForPost
// - getUnverifiedFactClaims
// - linkFactToEvidence
