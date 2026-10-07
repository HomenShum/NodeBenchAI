/**
 * Semantic Deduplicator for Narrative Posts
 *
 * Implements 2-stage deduplication for narrative posts:
 * 1. Cheap gate: Content hash + URL normalization + title similarity
 * 2. Semantic gate: LLM-as-judge for materiality determination
 *
 * Returns: "new" | "duplicate" | "update" | "contradiction"
 *
 * @module domains/research/semanticDeduplicator
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

// Note: findByContentHash and findSimilarPosts queries are in semanticDeduplicatorQueries.ts
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ClassificationResult =
  | "new" // No match, create new post
  | "duplicate" // Exact or near duplicate, skip
  | "update" // Same topic with material changes, create superseding post
  | "contradiction"; // Conflicts with existing content, needs adjudication

export interface ClassifyResult {
  type: ClassificationResult;
  matchId?: Id<"narrativePosts">;
  similarity?: number;
  diffSummary?: string[];
  conflictDetails?: string;
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * FNV-1a 32-bit hash
 */
function fnv1a32Hex(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Normalize text for comparison
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compute content hash from post content
 */
function computeContentHash(content: string, postType: string): string {
  const normalized = normalizeText(content);
  return fnv1a32Hex(`${postType}:${normalized}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 2: SEMANTIC GATE (LLM-as-judge)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * LLM judge to determine relationship between posts
 */
export const llmClassifyMateriality = internalAction({
  args: {
    newContent: v.string(),
    newTitle: v.optional(v.string()),
    newPostType: v.string(),
    existingContent: v.string(),
    existingTitle: v.optional(v.string()),
    existingPostType: v.string(),
    threadContext: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const prompt = `You are a deduplication judge for a knowledge management system. Analyze whether the NEW post is a duplicate, update, or contradiction of the EXISTING post.

EXISTING POST:
Type: ${args.existingPostType}
${args.existingTitle ? `Title: ${args.existingTitle}` : ""}
Content: ${args.existingContent.slice(0, 2000)}

NEW POST:
Type: ${args.newPostType}
${args.newTitle ? `Title: ${args.newTitle}` : ""}
Content: ${args.newContent.slice(0, 2000)}

${args.threadContext ? `THREAD CONTEXT:\n${args.threadContext}` : ""}

Determine the relationship:
1. DUPLICATE: Same information, no new content worth keeping
2. UPDATE: Same topic but with material new information or corrections
3. CONTRADICTION: Claims conflict with existing post
4. NEW: Sufficiently different topic, not related

For UPDATE, list what changed.
For CONTRADICTION, explain the conflict.

Respond with JSON only:
{
  "classification": "duplicate" | "update" | "contradiction" | "new",
  "confidence": 0.0-1.0,
  "diffSummary": ["change 1", "change 2"] (for updates only),
  "conflictDetails": "..." (for contradictions only),
  "reasoning": "brief explanation"
}`;

    try {
      const result = await generateText({
        model: openai.chat("gpt-5.4-nano"),
        prompt,
        temperature: 0.1,
      });

      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          classification: "new" as ClassificationResult,
          confidence: 0.5,
          reasoning: "Failed to parse LLM response",
        };
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error("[llmClassifyMateriality] Error:", error);
      // Fall back to heuristic
      return {
        classification: "new" as ClassificationResult,
        confidence: 0.5,
        reasoning: "LLM unavailable, defaulting to new",
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MAIN CLASSIFIER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Classify a candidate post against existing thread content.
 * 2-stage: cheap hash/similarity gate, then LLM semantic gate.
 */
export const classifyCandidate = internalAction({
  args: {
    threadId: v.id("narrativeThreads"),
    content: v.string(),
    title: v.optional(v.string()),
    postType: v.string(),
  },
  returns: v.object({
    type: v.union(
      v.literal("new"),
      v.literal("duplicate"),
      v.literal("update"),
      v.literal("contradiction")
    ),
    matchId: v.optional(v.id("narrativePosts")),
    similarity: v.optional(v.number()),
    diffSummary: v.optional(v.array(v.string())),
    conflictDetails: v.optional(v.string()),
    confidence: v.number(),
  }),
  handler: async (ctx, args): Promise<ClassifyResult> => {
    // Stage 1a: Content hash check
    const contentHash = computeContentHash(args.content, args.postType);
    const hashMatch = await ctx.runQuery(
      internal.domains.research.semanticDeduplicatorQueries.findByContentHash,
      {
        threadId: args.threadId,
        contentHash,
      }
    );

    if (hashMatch) {
      return {
        type: "duplicate",
        matchId: hashMatch._id,
        similarity: 1.0,
        confidence: 0.99,
      };
    }

    // Stage 1b: Similarity check
    const similarPosts = await ctx.runQuery(
      internal.domains.research.semanticDeduplicatorQueries.findSimilarPosts,
      {
        threadId: args.threadId,
        content: args.content,
        title: args.title,
        lookbackHours: 72,
      }
    );

    if (similarPosts.length === 0) {
      // No similar posts found
      return {
        type: "new",
        confidence: 0.95,
      };
    }

    // Stage 2: LLM semantic gate for top candidate
    const topCandidate = similarPosts[0];

    // Skip LLM if similarity is very high (likely duplicate)
    if (topCandidate.similarity > 0.85) {
      return {
        type: "duplicate",
        matchId: topCandidate._id,
        similarity: topCandidate.similarity,
        confidence: 0.9,
      };
    }

    // Get thread context for LLM
    const thread = await ctx.runQuery(
      internal.domains.narrative.queries.posts.getThreadContextInternal,
      { threadId: args.threadId }
    );

    const threadContext = thread
      ? `Current thesis: ${thread.thread.thesis}\nRecent post count: ${thread.stats.totalPosts}`
      : undefined;

    // LLM judge
    const llmResult = await ctx.runAction(
      internal.domains.research.semanticDeduplicator.llmClassifyMateriality,
      {
        newContent: args.content,
        newTitle: args.title,
        newPostType: args.postType,
        existingContent: topCandidate.content,
        existingTitle: topCandidate.title,
        existingPostType: topCandidate.postType,
        threadContext,
      }
    );

    return {
      type: llmResult.classification,
      matchId: llmResult.classification !== "new" ? topCandidate._id : undefined,
      similarity: topCandidate.similarity,
      diffSummary: llmResult.diffSummary,
      conflictDetails: llmResult.conflictDetails,
      confidence: llmResult.confidence,
    };
  },
});

/**
 * Batch classify multiple candidates (for efficiency)
 */
export const batchClassifyCandidates = internalAction({
  args: {
    threadId: v.id("narrativeThreads"),
    candidates: v.array(v.object({
      content: v.string(),
      title: v.optional(v.string()),
      postType: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const results: ClassifyResult[] = [];

    for (const candidate of args.candidates) {
      const result = await ctx.runAction(
        internal.domains.research.semanticDeduplicator.classifyCandidate,
        {
          threadId: args.threadId,
          ...candidate,
        }
      );
      results.push(result);
    }

    return results;
  },
});
