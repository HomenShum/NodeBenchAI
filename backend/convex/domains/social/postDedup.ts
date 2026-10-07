/**
 * 2-Stage Post Deduplication System
 *
 * Stage 1: Cheap, high-recall candidate retrieval
 *   1a. Hard key match: entityId + eventKey exact match
 *   1b. Semantic similarity: vector search on post embeddings
 *
 * Stage 2: LLM-as-judge on shortlist (high precision)
 *   Compare (new_candidate, prior_post) pairs
 *   Output: DUPLICATE | UPDATE | NEW | CONTRADICTS_PRIOR | INCONCLUSIVE
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TIMING WINDOWS (Research-Backed)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. Legacy/Fallback (time-based only): 21 days
 *    - SEC Form D filing deadline: 15 days after first sale of securities
 *    - Strategic delay buffer: +6 days for leaked→confirmed gap
 *    - Reference: https://techcrunch.com/2019/03/28/how-to-delay-your-form-ds/
 *
 * 2. Event-level (same-round semantic dedup): 90 days
 *    - Second closes typically occur 60-90 days after first close
 *    - Catches: first close → second close updates for same round
 *    - 50-60% of seed deals are never publicly disclosed (TechCrunch)
 *
 * 3. Entity-level (cross-round tracking): 180 days
 *    - Startup funding cycles: Seed → Series A typically 12-18 months
 *    - Enables: "Previously raised $X in Seed" narrative references
 *    - Catches: rapid-fire fundraising (back-to-back rounds in 6 months)
 *
 * References:
 * - Position bias mitigation: swap order in comparisons
 * - Near-duplicate detection: SimHash, MinHash for future optimization
 * - Funding timing: https://carta.com/blog/equity-funding-life-cycle/
 */

import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type DedupVerdict =
  | "NEW"              // First-ever post for this event
  | "UPDATE"           // Same event, but new material info worth posting
  | "DUPLICATE"        // Semantically identical, skip
  | "CONTRADICTS_PRIOR" // Contradicts previous post (rare but important)
  | "INCONCLUSIVE";    // Judge couldn't decide confidently

export interface DedupCandidate {
  postId: Id<"linkedinFundingPosts">;
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
  matchType: "hard_key" | "semantic" | "company_name";
  similarityScore?: number;
}

export interface DedupJudgment {
  verdict: DedupVerdict;
  comparedToPostId?: Id<"linkedinFundingPosts">;
  reasoning?: string;
  confidence?: number;
  judgedAt: number;
}

export interface CandidateInput {
  companyName: string;
  companyNameNormalized?: string;
  entityId?: string;
  eventKey?: string;
  roundType: string;
  amountRaw: string;
  contentSummary?: string;
  embedding?: number[];
  claims?: Array<{
    claimType: string;
    subject: string;
    predicate: string;
    object: string;
    confidence?: number;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize company name for deduplication.
 */
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[,.]$/g, "")
    .replace(
      /\s+(inc|corp|llc|ltd|co|company|technologies|technology|labs|ai|io)\.?$/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generate a canonical event key for hard-match dedup.
 * Format: "{entityId}:{roundType}:{yearMonth}"
 */
export function generateEventKey(
  entityId: string,
  roundType: string,
  date: Date = new Date()
): string {
  const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const normalizedRound = roundType.toLowerCase().replace(/[^a-z0-9]/g, "-");
  return `${entityId}:${normalizedRound}:${yearMonth}`;
}

/**
 * Compute cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 1: Candidate Retrieval (High Recall)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stage 1a: Hard key match - exact match on entityId or eventKey.
 * Returns posts with matching identifiers.
 */
export const findHardKeyMatches = internalQuery({
  args: {
    entityId: v.optional(v.string()),
    eventKey: v.optional(v.string()),
    companyNameNormalized: v.string(),
    lookbackDays: v.optional(v.number()),
    // Extended window for entity-level (cross-round) matching
    // Research: second closes 60-90 days after first; cross-round refs need 6mo+
    entityLookbackDays: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      postId: v.id("linkedinFundingPosts"),
      companyName: v.string(),
      roundType: v.string(),
      amountRaw: v.string(),
      contentSummary: v.optional(v.string()),
      claims: v.optional(v.any()),
      postedAt: v.number(),
      matchType: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    // Event-level: 90 days catches second closes (60-90 days post-first-close)
    const eventLookbackMs = (args.lookbackDays ?? 90) * 24 * 60 * 60 * 1000;
    // Entity-level: 180 days for cross-round progression (Seed → Series A tracking)
    const entityLookbackMs = (args.entityLookbackDays ?? 180) * 24 * 60 * 60 * 1000;
    const eventCutoffTime = Date.now() - eventLookbackMs;
    const entityCutoffTime = Date.now() - entityLookbackMs;
    const candidates: Array<{
      postId: Id<"linkedinFundingPosts">;
      companyName: string;
      roundType: string;
      amountRaw: string;
      contentSummary?: string;
      claims?: any;
      postedAt: number;
      matchType: string;
    }> = [];
    const seenIds = new Set<string>();

    // 1a-i: Match by eventKey (most specific - same event, use 90-day window)
    if (args.eventKey) {
      const eventKeyMatches = await ctx.db
        .query("linkedinFundingPosts")
        .withIndex("by_eventKey", (q) => q.eq("eventKey", args.eventKey))
        .filter((q) => q.gte(q.field("postedAt"), eventCutoffTime))
        .order("desc")
        .take(limit);

      for (const post of eventKeyMatches) {
        if (!seenIds.has(post._id)) {
          seenIds.add(post._id);
          candidates.push({
            postId: post._id,
            companyName: post.companyName,
            roundType: post.roundType,
            amountRaw: post.amountRaw,
            contentSummary: post.contentSummary,
            claims: post.claims,
            postedAt: post.postedAt,
            matchType: "hard_key",
          });
        }
      }
    }

    // 1a-ii: Match by entityId (cross-round tracking - use 180-day window)
    if (args.entityId && candidates.length < limit) {
      const entityMatches = await ctx.db
        .query("linkedinFundingPosts")
        .withIndex("by_entityId", (q) => q.eq("entityId", args.entityId))
        .filter((q) => q.gte(q.field("postedAt"), entityCutoffTime))
        .order("desc")
        .take(limit);

      for (const post of entityMatches) {
        if (!seenIds.has(post._id)) {
          seenIds.add(post._id);
          candidates.push({
            postId: post._id,
            companyName: post.companyName,
            roundType: post.roundType,
            amountRaw: post.amountRaw,
            contentSummary: post.contentSummary,
            claims: post.claims,
            postedAt: post.postedAt,
            matchType: "hard_key",
          });
        }
      }
    }

    // 1a-iii: Fallback to normalized company name (cross-round - use 180-day window)
    if (candidates.length < limit) {
      const companyMatches = await ctx.db
        .query("linkedinFundingPosts")
        .withIndex("by_company", (q) =>
          q.eq("companyNameNormalized", args.companyNameNormalized)
        )
        .filter((q) => q.gte(q.field("postedAt"), entityCutoffTime))
        .order("desc")
        .take(limit);

      for (const post of companyMatches) {
        if (!seenIds.has(post._id)) {
          seenIds.add(post._id);
          candidates.push({
            postId: post._id,
            companyName: post.companyName,
            roundType: post.roundType,
            amountRaw: post.amountRaw,
            contentSummary: post.contentSummary,
            claims: post.claims,
            postedAt: post.postedAt,
            matchType: "company_name",
          });
        }
      }
    }

    return candidates.slice(0, limit);
  },
});

/**
 * Stage 1b: Semantic similarity search using vector index.
 * Returns posts with similar content embeddings.
 */
export const findSemanticMatches = internalQuery({
  args: {
    embedding: v.array(v.float64()),
    sectorCategory: v.optional(v.string()),
    limit: v.optional(v.number()),
    minSimilarity: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      postId: v.id("linkedinFundingPosts"),
      companyName: v.string(),
      roundType: v.string(),
      amountRaw: v.string(),
      contentSummary: v.optional(v.string()),
      claims: v.optional(v.any()),
      postedAt: v.number(),
      matchType: v.string(),
      similarityScore: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const minSimilarity = args.minSimilarity ?? 0.75;

    // Vector search on the embedding index
    const results = await ctx.db
      .query("linkedinFundingPosts")
      .withSearchIndex("by_embedding", (q) =>
        args.sectorCategory
          ? q.vector("embedding", args.embedding).filter("sectorCategory", args.sectorCategory)
          : q.vector("embedding", args.embedding)
      )
      .take(limit * 2); // Take more to filter by similarity

    const candidates: Array<{
      postId: Id<"linkedinFundingPosts">;
      companyName: string;
      roundType: string;
      amountRaw: string;
      contentSummary?: string;
      claims?: any;
      postedAt: number;
      matchType: string;
      similarityScore: number;
    }> = [];

    for (const post of results) {
      // Compute actual similarity if embedding exists
      const similarity = post.embedding
        ? cosineSimilarity(args.embedding, post.embedding)
        : 0;

      if (similarity >= minSimilarity) {
        candidates.push({
          postId: post._id,
          companyName: post.companyName,
          roundType: post.roundType,
          amountRaw: post.amountRaw,
          contentSummary: post.contentSummary,
          claims: post.claims,
          postedAt: post.postedAt,
          matchType: "semantic",
          similarityScore: similarity,
        });
      }
    }

    // Sort by similarity score descending
    candidates.sort((a, b) => b.similarityScore - a.similarityScore);

    return candidates.slice(0, limit);
  },
});

/**
 * Combined Stage 1: Retrieve all candidates using both hard key and semantic match.
 * Merges results and deduplicates.
 */
export const findDedupCandidates = internalQuery({
  args: {
    companyName: v.string(),
    entityId: v.optional(v.string()),
    eventKey: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
    sectorCategory: v.optional(v.string()),
    // Event-level (same-round dedup): 90 days catches second closes
    lookbackDays: v.optional(v.number()),
    // Entity-level (cross-round tracking): 180 days for Seed→A progressions
    entityLookbackDays: v.optional(v.number()),
    maxCandidates: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      postId: v.id("linkedinFundingPosts"),
      companyName: v.string(),
      roundType: v.string(),
      amountRaw: v.string(),
      contentSummary: v.optional(v.string()),
      claims: v.optional(v.any()),
      postedAt: v.number(),
      matchType: v.string(),
      similarityScore: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const maxCandidates = args.maxCandidates ?? 15;
    const normalized = normalizeCompanyName(args.companyName);

    // Stage 1a: Hard key matches
    const hardKeyResults = await ctx.runQuery(
      internal.domains.social.postDedup.findHardKeyMatches,
      {
        entityId: args.entityId,
        eventKey: args.eventKey,
        companyNameNormalized: normalized,
        lookbackDays: args.lookbackDays,
        entityLookbackDays: args.entityLookbackDays,
        limit: maxCandidates,
      }
    );

    const seenIds = new Set<string>();
    const candidates: Array<{
      postId: Id<"linkedinFundingPosts">;
      companyName: string;
      roundType: string;
      amountRaw: string;
      contentSummary?: string;
      claims?: any;
      postedAt: number;
      matchType: string;
      similarityScore?: number;
    }> = [];

    // Add hard key matches first (higher priority)
    for (const result of hardKeyResults) {
      seenIds.add(result.postId);
      candidates.push({
        ...result,
        similarityScore: undefined,
      });
    }

    // Stage 1b: Semantic matches (if embedding provided)
    if (args.embedding && args.embedding.length > 0) {
      const semanticResults = await ctx.runQuery(
        internal.domains.social.postDedup.findSemanticMatches,
        {
          embedding: args.embedding,
          sectorCategory: args.sectorCategory,
          limit: maxCandidates,
          minSimilarity: 0.70, // Lower threshold for candidate retrieval
        }
      );

      for (const result of semanticResults) {
        if (!seenIds.has(result.postId)) {
          seenIds.add(result.postId);
          candidates.push(result);
        }
      }
    }

    // Sort: hard_key matches first, then by similarity/recency
    candidates.sort((a, b) => {
      // Hard key matches always first
      if (a.matchType === "hard_key" && b.matchType !== "hard_key") return -1;
      if (b.matchType === "hard_key" && a.matchType !== "hard_key") return 1;

      // Then by similarity if both are semantic
      if (a.similarityScore !== undefined && b.similarityScore !== undefined) {
        return b.similarityScore - a.similarityScore;
      }

      // Finally by recency
      return b.postedAt - a.postedAt;
    });

    return candidates.slice(0, maxCandidates);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Stage 2: LLM-as-Judge (High Precision) - Prompt Templates
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate the LLM prompt for dedup judgment.
 * Implements position bias mitigation by randomizing order.
 */
export function generateDedupJudgePrompt(
  newPost: CandidateInput,
  priorPost: DedupCandidate,
  swapOrder: boolean = false
): string {
  const postA = swapOrder
    ? { label: "POST_A", ...priorPost, isNew: false }
    : { label: "POST_A", ...newPost, isNew: true };

  const postB = swapOrder
    ? { label: "POST_B", ...newPost, isNew: true }
    : { label: "POST_B", ...priorPost, isNew: false };

  const formatPost = (post: typeof postA) => `
### ${post.label} ${post.isNew ? "(Candidate)" : "(Published)"}
**Company:** ${post.companyName}
**Round:** ${post.roundType}
**Amount:** ${post.amountRaw}
${post.contentSummary ? `**Summary:** ${post.contentSummary}` : ""}
${
  post.claims && post.claims.length > 0
    ? `**Claims:**
${post.claims.map((c) => `- ${c.claimType}: ${c.subject} ${c.predicate} ${c.object}`).join("\n")}`
    : ""
}
`;

  return `You are an expert deduplication judge for a financial news service. Compare two posts about company funding events and determine the relationship.

## Posts to Compare
${formatPost(postA)}
${formatPost(postB)}

## Decision Criteria

1. **DUPLICATE**: The posts describe the exact same funding event with no material difference.
   - Same company, same round, same amount, same key investors
   - Minor wording differences don't count as updates

2. **UPDATE**: The ${swapOrder ? "POST_A" : "POST_B"} (candidate) contains new, material information about the same event.
   - New investor revealed
   - Valuation now disclosed
   - Deal terms clarified
   - Status changed (e.g., "in talks" → "closed")

3. **NEW**: The posts describe different funding events.
   - Different funding rounds (Series A vs Series B)
   - Different time periods (raised again after significant time)
   - Different amounts that aren't corrections

4. **CONTRADICTS_PRIOR**: The candidate contradicts the published post.
   - Conflicting amounts for the same round
   - Different lead investors claimed
   - Timeline contradictions

5. **INCONCLUSIVE**: Cannot determine with confidence.
   - Insufficient information
   - Ambiguous company names
   - Partial information in both

## Response Format

Respond with a JSON object:
{
  "verdict": "DUPLICATE" | "UPDATE" | "NEW" | "CONTRADICTS_PRIOR" | "INCONCLUSIVE",
  "reasoning": "Brief explanation (1-2 sentences)",
  "confidence": 0.0 to 1.0,
  "keyDifferences": ["list", "of", "material", "differences"] // empty if DUPLICATE
}

Only output the JSON, no additional text.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Mutations for Recording Dedup Results
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update a post with dedup judgment after Stage 2.
 */
export const recordDedupJudgment = internalMutation({
  args: {
    postId: v.id("linkedinFundingPosts"),
    judgment: v.object({
      verdict: v.union(
        v.literal("NEW"),
        v.literal("UPDATE"),
        v.literal("DUPLICATE"),
        v.literal("CONTRADICTS_PRIOR"),
        v.literal("INCONCLUSIVE")
      ),
      comparedToPostId: v.optional(v.id("linkedinFundingPosts")),
      reasoning: v.optional(v.string()),
      confidence: v.optional(v.number()),
      judgedAt: v.number(),
    }),
    supersedesPostId: v.optional(v.id("linkedinFundingPosts")),
    diffSummary: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.postId, {
      dedupJudgment: args.judgment,
      supersedesPostId: args.supersedesPostId,
      diffSummary: args.diffSummary,
    });
  },
});

/**
 * Store embedding and claims for a post (for future dedup).
 */
export const updatePostEmbedding = internalMutation({
  args: {
    postId: v.id("linkedinFundingPosts"),
    entityId: v.optional(v.string()),
    eventKey: v.optional(v.string()),
    contentSummary: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { postId, ...updates } = args;
    // Filter out undefined values
    const patch: Record<string, any> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        patch[key] = value;
      }
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(postId, patch);
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Circuit Breaker: Time-based Fallback
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fallback dedup check when LLM judge fails or is unavailable.
 * Uses simple time-based heuristic with normalized company name.
 */
export const checkTimeBasedDedup = internalQuery({
  args: {
    companyName: v.string(),
    roundType: v.string(),
    lookbackDays: v.optional(v.number()),
  },
  returns: v.object({
    isDuplicate: v.boolean(),
    reason: v.string(),
    priorPostId: v.optional(v.id("linkedinFundingPosts")),
    priorPostedAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    // 21-day window: SEC Form D = 15 days + announcement/leak-to-confirm gap
    // Research: https://techcrunch.com/2019/03/28/how-to-delay-your-form-ds/
    const lookbackDays = args.lookbackDays ?? 21;
    const normalized = normalizeCompanyName(args.companyName);
    const cutoffTime = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

    const priorPost = await ctx.db
      .query("linkedinFundingPosts")
      .withIndex("by_company_round", (q) =>
        q.eq("companyNameNormalized", normalized).eq("roundType", args.roundType)
      )
      .filter((q) => q.gte(q.field("postedAt"), cutoffTime))
      .order("desc")
      .first();

    if (priorPost) {
      return {
        isDuplicate: true,
        reason: `Posted ${Math.round((Date.now() - priorPost.postedAt) / (1000 * 60 * 60 * 24))} days ago`,
        priorPostId: priorPost._id,
        priorPostedAt: priorPost.postedAt,
      };
    }

    return {
      isDuplicate: false,
      reason: "No matching post in lookback window",
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Public Query for Dashboard/Debugging
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get dedup statistics for monitoring.
 */
export const getDedupStats = query({
  args: {
    lookbackDays: v.optional(v.number()),
  },
  returns: v.object({
    totalPosts: v.number(),
    postsWithEmbeddings: v.number(),
    postsWithJudgments: v.number(),
    verdictBreakdown: v.object({
      NEW: v.number(),
      UPDATE: v.number(),
      DUPLICATE: v.number(),
      CONTRADICTS_PRIOR: v.number(),
      INCONCLUSIVE: v.number(),
    }),
    avgConfidence: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const lookbackMs = (args.lookbackDays ?? 30) * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - lookbackMs;

    const posts = await ctx.db
      .query("linkedinFundingPosts")
      .withIndex("by_postedAt")
      .filter((q) => q.gte(q.field("postedAt"), cutoffTime))
      .collect();

    const verdictCounts = {
      NEW: 0,
      UPDATE: 0,
      DUPLICATE: 0,
      CONTRADICTS_PRIOR: 0,
      INCONCLUSIVE: 0,
    };

    let postsWithEmbeddings = 0;
    let postsWithJudgments = 0;
    let totalConfidence = 0;
    let confidenceCount = 0;

    for (const post of posts) {
      if (post.embedding && post.embedding.length > 0) {
        postsWithEmbeddings++;
      }

      if (post.dedupJudgment) {
        postsWithJudgments++;
        const verdict = post.dedupJudgment.verdict;
        if (verdict in verdictCounts) {
          verdictCounts[verdict as keyof typeof verdictCounts]++;
        }
        if (post.dedupJudgment.confidence !== undefined) {
          totalConfidence += post.dedupJudgment.confidence;
          confidenceCount++;
        }
      }
    }

    return {
      totalPosts: posts.length,
      postsWithEmbeddings,
      postsWithJudgments,
      verdictBreakdown: verdictCounts,
      avgConfidence:
        confidenceCount > 0 ? totalConfidence / confidenceCount : undefined,
    };
  },
});

/**
 * Get posts without embeddings for backfill.
 */
export const getPostsWithoutEmbeddings = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("linkedinFundingPosts"),
      companyName: v.string(),
      roundType: v.string(),
      amountRaw: v.string(),
      sector: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    // Get recent posts and filter for those without embeddings
    const posts = await ctx.db
      .query("linkedinFundingPosts")
      .withIndex("by_postedAt")
      .order("desc")
      .take(limit * 3); // Take more since we'll filter

    const postsWithoutEmbeddings = posts
      .filter((p) => !p.embedding || p.embedding.length === 0)
      .slice(0, limit);

    return postsWithoutEmbeddings.map((p) => ({
      _id: p._id,
      companyName: p.companyName,
      roundType: p.roundType,
      amountRaw: p.amountRaw,
      sector: p.sector,
    }));
  },
});
