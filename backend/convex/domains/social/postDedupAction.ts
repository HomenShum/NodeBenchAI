"use node";
/**
 * Post Deduplication Action - LLM-as-Judge (Stage 2)
 *
 * Compares a new post candidate against prior posts to determine:
 * - DUPLICATE: Skip posting (semantically identical)
 * - UPDATE: Post with reference to prior (new material info)
 * - NEW: Post as new (different event)
 * - CONTRADICTS_PRIOR: Flag for review
 * - INCONCLUSIVE: Fall back to time-based heuristic
 *
 * Position bias mitigation: Runs comparison twice with swapped order
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import {
  getLlmModel,
  resolveModelAlias,
  getModelWithFailover,
} from "../../../shared/llm/modelCatalog";
import { generateDedupJudgePrompt, type DedupVerdict } from "./postDedup";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface JudgeResponse {
  verdict: DedupVerdict;
  reasoning: string;
  confidence: number;
  keyDifferences: string[];
}

interface DedupJudgmentResult {
  verdict: DedupVerdict;
  comparedToPostId?: string;
  reasoning?: string;
  confidence?: number;
  diffSummary?: string;
  judgedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM Judge Implementation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Call LLM to judge dedup verdict.
 */
async function callDedupJudge(prompt: string): Promise<JudgeResponse> {
  const { model: modelName, provider } = getModelWithFailover(
    resolveModelAlias(getLlmModel("judge"))
  );

  try {
    let content: string | undefined;

    if (provider === "anthropic") {
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      const response = await anthropic.messages.create({
        model: modelName,
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      });
      content =
        response.content[0]?.type === "text"
          ? response.content[0].text
          : undefined;
    } else if (provider === "gemini") {
      const google = createGoogleGenerativeAI({
        apiKey: process.env.GEMINI_API_KEY,
      });
      const result = await generateText({
        model: google(modelName),
        prompt,
        maxOutputTokens: 300,
      });
      content = result.text;
    } else {
      // OpenAI
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await openai.chat.completions.create({
        model: modelName,
        max_completion_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      });
      content = response.choices[0]?.message?.content?.trim();
    }

    if (!content) {
      throw new Error("Empty response from dedup judge");
    }

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in judge response");
    }

    const result = JSON.parse(jsonMatch[0]) as JudgeResponse;

    // Validate verdict
    const validVerdicts: DedupVerdict[] = [
      "NEW",
      "UPDATE",
      "DUPLICATE",
      "CONTRADICTS_PRIOR",
      "INCONCLUSIVE",
    ];
    if (!validVerdicts.includes(result.verdict)) {
      throw new Error(`Invalid verdict: ${result.verdict}`);
    }

    // Clamp confidence
    result.confidence = Math.max(0, Math.min(1, result.confidence || 0.5));

    return result;
  } catch (error) {
    console.error("[postDedupAction] Judge error:", error);
    return {
      verdict: "INCONCLUSIVE",
      reasoning: `Judge failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      confidence: 0.3,
      keyDifferences: [],
    };
  }
}

/**
 * Run dedup judge with position bias mitigation.
 * Runs comparison twice with swapped order and reconciles.
 */
async function judgeDedupWithBiasMitigation(
  newPost: {
    companyName: string;
    roundType: string;
    amountRaw: string;
    contentSummary?: string;
    claims?: Array<{
      claimType: string;
      subject: string;
      predicate: string;
      object: string;
      confidence?: number;
    }>;
  },
  priorPost: {
    postId: string;
    companyName: string;
    roundType: string;
    amountRaw: string;
    contentSummary?: string;
    claims?: Array<{
      claimType: string;
      subject: string;
      predicate: string;
      object: string;
      confidence?: number;
    }>;
    postedAt: number;
  }
): Promise<JudgeResponse> {
  // Run both orderings in parallel
  const [resultNormal, resultSwapped] = await Promise.all([
    callDedupJudge(
      generateDedupJudgePrompt(newPost, priorPost as any, false)
    ),
    callDedupJudge(
      generateDedupJudgePrompt(newPost, priorPost as any, true)
    ),
  ]);

  // If both agree, use that verdict
  if (resultNormal.verdict === resultSwapped.verdict) {
    return {
      verdict: resultNormal.verdict,
      reasoning: resultNormal.reasoning,
      confidence: (resultNormal.confidence + resultSwapped.confidence) / 2,
      keyDifferences: [
        ...new Set([
          ...resultNormal.keyDifferences,
          ...resultSwapped.keyDifferences,
        ]),
      ],
    };
  }

  // Disagreement - use the one with higher confidence, or mark inconclusive
  const confDiff = Math.abs(resultNormal.confidence - resultSwapped.confidence);
  if (confDiff > 0.3) {
    // Clear winner by confidence
    const winner =
      resultNormal.confidence > resultSwapped.confidence
        ? resultNormal
        : resultSwapped;
    return {
      ...winner,
      reasoning: `${winner.reasoning} (position bias check: other ordering gave ${
        resultNormal.confidence > resultSwapped.confidence
          ? resultSwapped.verdict
          : resultNormal.verdict
      })`,
      confidence: winner.confidence * 0.9, // Slight penalty for disagreement
    };
  }

  // Close call - mark as inconclusive
  return {
    verdict: "INCONCLUSIVE",
    reasoning: `Position bias detected: ${resultNormal.verdict} vs ${resultSwapped.verdict}`,
    confidence: 0.4,
    keyDifferences: [
      ...new Set([
        ...resultNormal.keyDifferences,
        ...resultSwapped.keyDifferences,
      ]),
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Embedding Generation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate embedding for post content.
 */
async function generatePostEmbedding(
  contentSummary: string
): Promise<number[]> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model =
    process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

  try {
    const response = await openai.embeddings.create({
      model,
      input: contentSummary,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error("[postDedupAction] Embedding error:", error);
    return [];
  }
}

/**
 * Generate canonical content summary for a funding post.
 */
function generateContentSummary(post: {
  companyName: string;
  roundType: string;
  amountRaw: string;
  sector?: string;
}): string {
  return `${post.companyName} raised ${post.amountRaw} in ${post.roundType}${
    post.sector ? ` (${post.sector})` : ""
  }`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Actions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Full 2-stage dedup check for a new post candidate.
 * Stage 1: Retrieve candidates (hard key + semantic)
 * Stage 2: LLM-as-judge on top candidate
 */
export const checkDedup = internalAction({
  args: {
    companyName: v.string(),
    roundType: v.string(),
    amountRaw: v.string(),
    sector: v.optional(v.string()),
    entityId: v.optional(v.string()),
    eventKey: v.optional(v.string()),
    contentSummary: v.optional(v.string()),
    claims: v.optional(
      v.array(
        v.object({
          claimType: v.string(),
          subject: v.string(),
          predicate: v.string(),
          object: v.string(),
          confidence: v.optional(v.number()),
        })
      )
    ),
    skipLlmJudge: v.optional(v.boolean()),
    lookbackDays: v.optional(v.number()),
  },
  returns: v.object({
    shouldPost: v.boolean(),
    verdict: v.string(),
    reasoning: v.optional(v.string()),
    confidence: v.optional(v.number()),
    priorPostId: v.optional(v.string()),
    diffSummary: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
    usedFallback: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const startTime = Date.now();

    // Generate content summary if not provided
    const contentSummary =
      args.contentSummary ||
      generateContentSummary({
        companyName: args.companyName,
        roundType: args.roundType,
        amountRaw: args.amountRaw,
        sector: args.sector,
      });

    // Generate embedding for semantic search
    const embedding = await generatePostEmbedding(contentSummary);

    // Stage 1: Retrieve candidates
    const candidates = await ctx.runQuery(
      internal.domains.social.postDedup.findDedupCandidates,
      {
        companyName: args.companyName,
        entityId: args.entityId,
        eventKey: args.eventKey,
        embedding: embedding.length > 0 ? embedding : undefined,
        sectorCategory: args.sector,
        lookbackDays: args.lookbackDays ?? 90,
        maxCandidates: 10,
      }
    );

    // No candidates = NEW post
    if (candidates.length === 0) {
      console.log(
        `[postDedupAction] No candidates found for ${args.companyName} - marking as NEW`
      );
      return {
        shouldPost: true,
        verdict: "NEW",
        reasoning: "No prior posts found for this company/event",
        confidence: 0.95,
        embedding,
        usedFallback: false,
      };
    }

    // If skipLlmJudge, use time-based fallback
    if (args.skipLlmJudge) {
      const fallbackResult = await ctx.runQuery(
        internal.domains.social.postDedup.checkTimeBasedDedup,
        {
          companyName: args.companyName,
          roundType: args.roundType,
          lookbackDays: args.lookbackDays ?? 21,
        }
      );

      return {
        shouldPost: !fallbackResult.isDuplicate,
        verdict: fallbackResult.isDuplicate ? "DUPLICATE" : "NEW",
        reasoning: fallbackResult.reason,
        confidence: 0.7,
        priorPostId: fallbackResult.priorPostId,
        embedding,
        usedFallback: true,
      };
    }

    // Stage 2: LLM-as-judge on top candidate
    const topCandidate = candidates[0];
    console.log(
      `[postDedupAction] Judging ${args.companyName} against prior post ${topCandidate.postId}`
    );

    try {
      const judgment = await judgeDedupWithBiasMitigation(
        {
          companyName: args.companyName,
          roundType: args.roundType,
          amountRaw: args.amountRaw,
          contentSummary,
          claims: args.claims,
        },
        {
          postId: topCandidate.postId,
          companyName: topCandidate.companyName,
          roundType: topCandidate.roundType,
          amountRaw: topCandidate.amountRaw,
          contentSummary: topCandidate.contentSummary,
          claims: topCandidate.claims,
          postedAt: topCandidate.postedAt,
        }
      );

      const elapsed = Date.now() - startTime;
      console.log(
        `[postDedupAction] Verdict: ${judgment.verdict} (${judgment.confidence.toFixed(2)}) in ${elapsed}ms`
      );

      // Determine if we should post
      const shouldPost =
        judgment.verdict === "NEW" ||
        judgment.verdict === "UPDATE" ||
        judgment.verdict === "CONTRADICTS_PRIOR";

      // Generate diff summary for UPDATE/CONTRADICTS
      const diffSummary =
        judgment.keyDifferences.length > 0
          ? judgment.keyDifferences.join("; ")
          : undefined;

      return {
        shouldPost,
        verdict: judgment.verdict,
        reasoning: judgment.reasoning,
        confidence: judgment.confidence,
        priorPostId: topCandidate.postId,
        diffSummary,
        embedding,
        usedFallback: false,
      };
    } catch (error) {
      console.error("[postDedupAction] LLM judge failed, using fallback:", error);

      // Fallback to time-based check
      const fallbackResult = await ctx.runQuery(
        internal.domains.social.postDedup.checkTimeBasedDedup,
        {
          companyName: args.companyName,
          roundType: args.roundType,
          lookbackDays: args.lookbackDays ?? 21,
        }
      );

      return {
        shouldPost: !fallbackResult.isDuplicate,
        verdict: fallbackResult.isDuplicate ? "DUPLICATE" : "NEW",
        reasoning: `LLM judge failed, using time-based fallback: ${fallbackResult.reason}`,
        confidence: 0.6,
        priorPostId: fallbackResult.priorPostId,
        embedding,
        usedFallback: true,
      };
    }
  },
});

/**
 * Batch check multiple candidates and return only those that should be posted.
 */
export const batchCheckDedup = internalAction({
  args: {
    candidates: v.array(
      v.object({
        companyName: v.string(),
        roundType: v.string(),
        amountRaw: v.string(),
        sector: v.optional(v.string()),
        entityId: v.optional(v.string()),
        eventKey: v.optional(v.string()),
        fundingEventId: v.optional(v.id("fundingEvents")),
      })
    ),
    lookbackDays: v.optional(v.number()),
    maxPosts: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      companyName: v.string(),
      roundType: v.string(),
      amountRaw: v.string(),
      sector: v.optional(v.string()),
      fundingEventId: v.optional(v.id("fundingEvents")),
      verdict: v.string(),
      reasoning: v.optional(v.string()),
      confidence: v.optional(v.number()),
      priorPostId: v.optional(v.string()),
      diffSummary: v.optional(v.string()),
      embedding: v.optional(v.array(v.float64())),
    })
  ),
  handler: async (ctx, args) => {
    const maxPosts = args.maxPosts ?? 10;
    const results: Array<{
      companyName: string;
      roundType: string;
      amountRaw: string;
      sector?: string;
      fundingEventId?: any;
      verdict: string;
      reasoning?: string;
      confidence?: number;
      priorPostId?: string;
      diffSummary?: string;
      embedding?: number[];
    }> = [];

    for (const candidate of args.candidates) {
      if (results.length >= maxPosts) break;

      const result = await ctx.runAction(
        internal.domains.social.postDedupAction.checkDedup,
        {
          companyName: candidate.companyName,
          roundType: candidate.roundType,
          amountRaw: candidate.amountRaw,
          sector: candidate.sector,
          entityId: candidate.entityId,
          eventKey: candidate.eventKey,
          lookbackDays: args.lookbackDays,
        }
      );

      if (result.shouldPost) {
        results.push({
          companyName: candidate.companyName,
          roundType: candidate.roundType,
          amountRaw: candidate.amountRaw,
          sector: candidate.sector,
          fundingEventId: candidate.fundingEventId,
          verdict: result.verdict,
          reasoning: result.reasoning,
          confidence: result.confidence,
          priorPostId: result.priorPostId,
          diffSummary: result.diffSummary,
          embedding: result.embedding,
        });
      } else {
        console.log(
          `[postDedupAction] Skipping ${candidate.companyName}: ${result.verdict}`
        );
      }
    }

    return results;
  },
});

/**
 * Backfill embeddings for existing posts without them.
 */
export const backfillEmbeddings = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.object({
    processed: v.number(),
    updated: v.number(),
    errors: v.number(),
  }),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    // Get posts without embeddings
    const posts = await ctx.runQuery(
      internal.domains.social.postDedup.getPostsWithoutEmbeddings,
      { limit }
    );

    let updated = 0;
    let errors = 0;

    for (const post of posts) {
      try {
        const contentSummary = generateContentSummary({
          companyName: post.companyName,
          roundType: post.roundType,
          amountRaw: post.amountRaw,
          sector: post.sector,
        });

        const embedding = await generatePostEmbedding(contentSummary);

        if (embedding.length > 0) {
          await ctx.runMutation(
            internal.domains.social.postDedup.updatePostEmbedding,
            {
              postId: post._id,
              contentSummary,
              embedding,
            }
          );
          updated++;
        }
      } catch (error) {
        console.error(
          `[postDedupAction] Backfill error for ${post.companyName}:`,
          error
        );
        errors++;
      }
    }

    return {
      processed: posts.length,
      updated,
      errors,
    };
  },
});
