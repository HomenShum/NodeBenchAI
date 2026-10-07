/**
 * Document Discovery - Smart Recommendations using X Algorithm Patterns
 * Phase 3 Implementation
 *
 * Provides personalized document recommendations using:
 * - Two-tower embeddings for candidate retrieval
 * - Phoenix ML for relevance scoring
 * - Engagement-driven ranking
 * - Diversity filtering to avoid filter bubbles
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
  mutation,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const DISCOVERY_CONFIG = {
  /** Candidate pool size for retrieval */
  candidatePoolSize: 50,

  /** Final recommendation count */
  recommendationCount: 10,

  /** Diversity threshold (cosine similarity) */
  diversityThreshold: 0.85, // Avoid items too similar to each other

  /** Phoenix scoring weights */
  scoringWeights: {
    semanticSimilarity: 0.35,  // Two-tower embedding similarity
    recencyBoost: 0.20,        // Recent documents get boost
    engagementSignals: 0.30,   // Historical engagement data
    diversity: 0.15,           // Penalize too-similar items
  },

  /** Refresh interval (10 minutes) */
  refreshIntervalMs: 10 * 60 * 1000,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface DocumentCandidate {
  documentId: string;
  title: string;
  summary: string;
  snippet?: string;
  authorId: string;
  createdAt: number;
  source?: "semantic" | "trending" | "collaborative";
  embedding?: number[]; // Two-tower document embedding
}

export interface ScoredDocument extends DocumentCandidate {
  phoenixScore: number;
  relevanceReason: string;
  engagementPrediction: {
    view: number;
    click: number;
    save: number;
    share: number;
  };
  source: "semantic" | "trending" | "collaborative";
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 1: CANDIDATE RETRIEVAL (Two-Tower Embeddings)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get user interests embedding (tower 1)
 * In production, this would use actual embeddings
 */
export const getUserInterestsEmbedding = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, { userId }): Promise<number[] | null> => {
    const user = await ctx.db.get(userId);
    if (!user) return null;

    // TODO: Build real user embedding from:
    // - Documents they've created/saved
    // - Engagement history
    // - Explicit preferences
    // For now, return null to skip embedding-based retrieval
    return null;
  },
});

/**
 * Get candidate documents by semantic similarity
 * Uses vector search when embeddings available
 */
export const getCandidatesBySemanticSimilarity = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.number(),
  },
  handler: async (ctx, { userId, limit }): Promise<DocumentCandidate[]> => {
    const candidates: DocumentCandidate[] = [];

    // Get recent documents as candidates
    // TODO: Replace with vector search when embeddings are implemented
    const recentDocs = await ctx.db
      .query("documents")
      .withIndex("by_creation_time")
      .order("desc")
      .filter((q) => q.neq(q.field("createdBy"), userId)) // Exclude user's own docs
      .take(Math.floor(limit / 2));

    for (const doc of recentDocs) {
      candidates.push({
        documentId: doc._id,
        title: doc.title || "Untitled",
        summary: doc.summary || "",
        snippet: doc.content?.substring(0, 200),
        authorId: doc.createdBy,
        createdAt: doc._creationTime,
        source: "semantic",
      });
    }

    // Also get feed items (external articles) for discovery
    const feedItems = await ctx.db
      .query("feedItems")
      .withIndex("by_creation_time")
      .order("desc")
      .take(Math.floor(limit / 2));

    for (const item of feedItems) {
      candidates.push({
        documentId: item._id,
        title: item.title || "Untitled",
        summary: item.summary || "Article from external source",
        snippet: item.summary?.substring(0, 200),
        authorId: "external" as any,
        createdAt: item.createdAt || item._creationTime,
        source: "semantic",
      });
    }

    return candidates;
  },
});

/**
 * Get trending documents (high engagement)
 */
export const getTrendingDocuments = internalQuery({
  args: {
    limit: v.number(),
  },
  handler: async (ctx, { limit }): Promise<DocumentCandidate[]> => {
    const candidates: DocumentCandidate[] = [];

    // APPROACH 1: Get documents with recent engagement
    const recentEngagements = await ctx.db
      .query("feedEngagements")
      .withIndex("by_action", (q) => q.eq("action", "save"))
      .order("desc")
      .take(limit * 2);

    // Group by document, count engagements
    const engagementCounts = new Map<string, number>();
    for (const engagement of recentEngagements) {
      const count = engagementCounts.get(engagement.itemId) || 0;
      engagementCounts.set(engagement.itemId, count + 1);
    }

    // Sort by engagement count
    const topDocIds = Array.from(engagementCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.floor(limit / 3))
      .map(([docId]) => docId);

    // Fetch document details
    for (const docId of topDocIds) {
      try {
        const doc = await ctx.db.get(docId as any);
        if (doc && "title" in doc) {
          candidates.push({
            documentId: docId,
            title: doc.title || "Untitled",
            summary: doc.summary || "",
            authorId: doc.createdBy,
            createdAt: doc._creationTime,
            source: "trending",
          });
        }
      } catch {
        // Skip invalid IDs
        continue;
      }
    }

    // APPROACH 2: Get recent documents from documents table
    const recentDocs = await ctx.db
      .query("documents")
      .order("desc")
      .filter((q) => q.eq(q.field("isArchived"), false))
      .take(Math.floor(limit / 3));

    for (const doc of recentDocs) {
      candidates.push({
        documentId: doc._id,
        title: doc.title || "Untitled",
        summary: doc.content?.substring(0, 200) || "No summary available",
        snippet: doc.content?.substring(0, 200),
        authorId: doc.createdBy,
        createdAt: doc._creationTime,
        source: "trending",
      });
    }

    // APPROACH 3: Get high-scoring feed items (external articles)
    const feedItems = await ctx.db
      .query("feedItems")
      .withIndex("by_creation_time")
      .order("desc")
      .filter((q) => q.gte(q.field("score"), 50))
      .take(Math.floor(limit / 3));

    for (const item of feedItems) {
      candidates.push({
        documentId: item._id,
        title: item.title || "Untitled",
        summary: item.summary || "Article from external source",
        snippet: item.summary?.substring(0, 200),
        authorId: "external" as any, // External content
        createdAt: item.createdAt || item._creationTime,
        source: "trending",
      });
    }

    return candidates;
  },
});

/**
 * Get collaborative filtering candidates (users like you also liked...)
 */
export const getCollaborativeFilteringCandidates = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.number(),
  },
  handler: async (ctx, { userId, limit }): Promise<DocumentCandidate[]> => {
    // Get user's engagement history
    const userEngagements = await ctx.db
      .query("feedEngagements")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);

    if (userEngagements.length === 0) {
      return [];
    }

    // Get other users who engaged with same items
    const itemIds = new Set(userEngagements.map((e) => e.itemId));
    const similarUserEngagements = await ctx.db
      .query("feedEngagements")
      .withIndex("by_item")
      .filter((q) => q.neq(q.field("userId"), userId))
      .take(100);

    // Find items these similar users engaged with
    const similarUserIds = new Set(
      similarUserEngagements
        .filter((e) => itemIds.has(e.itemId))
        .map((e) => e.userId)
    );

    const recommendedEngagements = similarUserEngagements
      .filter((e) => similarUserIds.has(e.userId) && !itemIds.has(e.itemId))
      .slice(0, limit);

    // Fetch document details
    const candidates: DocumentCandidate[] = [];
    for (const engagement of recommendedEngagements) {
      try {
        const doc = await ctx.db.get(engagement.itemId as any);
        if (doc && "title" in doc) {
          candidates.push({
            documentId: engagement.itemId,
            title: doc.title || "Untitled",
            summary: doc.summary || "",
            authorId: doc.createdBy,
            createdAt: doc._creationTime,
          });
        }
      } catch {
        continue;
      }
    }

    return candidates;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STEP 2: PHOENIX ML SCORING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Score candidates using Phoenix ML (Grok-powered)
 */
export const scoreWithPhoenixML = internalAction({
  args: {
    userId: v.id("users"),
    candidates: v.array(v.any()),
  },
  handler: async (ctx, { userId, candidates }): Promise<ScoredDocument[]> => {
    if (candidates.length === 0) {
      return [];
    }

    const user = await ctx.runQuery(internal.domains.auth.auth.getUserById, { userId });
    if (!user) {
      throw new Error("User not found");
    }

    // Build Phoenix ML prompt
    const prompt = `You are Phoenix ML, X's advanced ranking system for document discovery.

User Context:
- User ID: ${userId}
- Interests: ${user.preferences?.interests?.join(", ") || "general tech, AI"}

Candidate Documents (${candidates.length}):
${candidates.map((c: DocumentCandidate, idx: number) => `
${idx + 1}. "${c.title}"
   Summary: ${c.summary || "No summary"}
   Age: ${Math.round((Date.now() - c.createdAt) / (1000 * 60 * 60))} hours
   Source: semantic
`).join("\n")}

Task: Score these documents for this specific user using multi-action prediction.

Scoring Criteria:
1. Semantic Relevance (35%): Match to user interests
2. Recency Boost (20%): Newer gets slight boost
3. Engagement Signals (30%): Predicted engagement
4. Diversity (15%): Avoid filter bubbles

For each document, provide:
1. phoenixScore (0-100): Overall relevance
2. relevanceReason (15-20 words): Why relevant to this user
3. engagementPrediction: {view: 0-1, click: 0-1, save: 0-1, share: 0-1}

Return JSON array sorted by phoenixScore (highest first):
[
  {
    "idx": 1,
    "phoenixScore": 92,
    "relevanceReason": "...",
    "engagement": {"view": 0.95, "click": 0.75, "save": 0.45, "share": 0.25}
  },
  ...
]`;

    try {
      const response = await ctx.runAction(
        internal.domains.models.autonomousModelResolver.executeWithFallback,
        {
          taskType: "research",
          messages: [
            { role: "system", content: "You are Phoenix ML, X's document ranking algorithm." },
            { role: "user", content: prompt },
          ],
          maxTokens: 2000,
          temperature: 0.3,
        }
      );

      const scores = JSON.parse(response.content) as Array<{
        idx: number;
        phoenixScore: number;
        relevanceReason: string;
        engagement: {
          view: number;
          click: number;
          save: number;
          share: number;
        };
      }>;

      const scored: ScoredDocument[] = scores.map((s) => {
        const candidate = candidates[s.idx - 1] as DocumentCandidate & { source?: string };
        return {
          ...candidate,
          phoenixScore: s.phoenixScore,
          relevanceReason: s.relevanceReason,
          engagementPrediction: s.engagement,
          source: (candidate.source as any) || "semantic",
        };
      });

      return scored;
    } catch (error) {
      console.error("[documentDiscovery] Phoenix scoring failed:", error);
      // Fallback: recency-based scoring
      return candidates.map((c: DocumentCandidate, idx: number) => ({
        ...c,
        phoenixScore: 100 - idx,
        relevanceReason: "Fallback ranking (scoring service unavailable)",
        engagementPrediction: {
          view: 0.5,
          click: 0.3,
          save: 0.1,
          share: 0.05,
        },
        source: "semantic" as const,
      }));
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STEP 3: DIVERSITY FILTERING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply diversity filtering to avoid filter bubbles
 * Removes items too similar to each other
 */
export const applyDiversityFilter = internalAction({
  args: {
    scored: v.array(v.any()),
    targetCount: v.number(),
  },
  handler: async (ctx, { scored, targetCount }): Promise<ScoredDocument[]> => {
    if (scored.length <= targetCount) {
      return scored;
    }

    const diversified: ScoredDocument[] = [];
    const selectedTitles: string[] = [];

    for (const doc of scored) {
      if (diversified.length >= targetCount) break;

      // Check if too similar to already selected docs
      const tooSimilar = selectedTitles.some((title) => {
        const similarity = calculateTitleSimilarity(title, doc.title);
        return similarity > DISCOVERY_CONFIG.diversityThreshold;
      });

      if (!tooSimilar) {
        diversified.push(doc);
        selectedTitles.push(doc.title);
      }
    }

    // If we filtered too much, backfill with remaining highest-scored items
    if (diversified.length < targetCount) {
      const remaining = scored.filter((d) => !diversified.includes(d));
      diversified.push(...remaining.slice(0, targetCount - diversified.length));
    }

    return diversified;
  },
});

/**
 * Simple title similarity (Jaccard similarity of words)
 */
function calculateTitleSimilarity(title1: string, title2: string): number {
  const words1 = new Set(title1.toLowerCase().split(/\s+/));
  const words2 = new Set(title2.toLowerCase().split(/\s+/));

  const intersection = new Set([...words1].filter((w) => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN DISCOVERY PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate personalized document recommendations
 * Complete X algorithm pipeline: Retrieval → Ranking → Diversity
 */
export const generateDocumentRecommendations = internalAction({
  args: {
    userId: v.id("users"),
    count: v.optional(v.number()),
  },
  handler: async (ctx, { userId, count = DISCOVERY_CONFIG.recommendationCount }) => {
    console.log(`[documentDiscovery] Generating recommendations for user ${userId}`);

    // STEP 1: Candidate Retrieval
    const [semantic, trending, collaborative] = await Promise.all([
      ctx.runQuery(internal.domains.research.documentDiscovery.getCandidatesBySemanticSimilarity, {
        userId,
        limit: Math.floor(DISCOVERY_CONFIG.candidatePoolSize * 0.5),
      }),
      ctx.runQuery(internal.domains.research.documentDiscovery.getTrendingDocuments, {
        limit: Math.floor(DISCOVERY_CONFIG.candidatePoolSize * 0.3),
      }),
      ctx.runQuery(internal.domains.research.documentDiscovery.getCollaborativeFilteringCandidates, {
        userId,
        limit: Math.floor(DISCOVERY_CONFIG.candidatePoolSize * 0.2),
      }),
    ]);

    // Tag candidates with source
    const candidates = [
      ...semantic.map((c) => ({ ...c, source: "semantic" as const })),
      ...trending.map((c) => ({ ...c, source: "trending" as const })),
      ...collaborative.map((c) => ({ ...c, source: "collaborative" as const })),
    ];

    console.log(`[documentDiscovery] Retrieved ${candidates.length} candidates`);

    if (candidates.length === 0) {
      return [];
    }

    // STEP 2: Phoenix ML Scoring
    const scored = await ctx.runAction(
      internal.domains.research.documentDiscovery.scoreWithPhoenixML,
      { userId, candidates }
    );

    console.log(`[documentDiscovery] Scored ${scored.length} documents`);

    // STEP 3: Diversity Filtering
    const diversified = await ctx.runAction(
      internal.domains.research.documentDiscovery.applyDiversityFilter,
      { scored, targetCount: count }
    );

    console.log(`[documentDiscovery] Diversified to ${diversified.length} recommendations`);

    // Store recommendations
    await ctx.runMutation(internal.domains.research.documentDiscovery.saveRecommendations, {
      userId,
      recommendations: diversified,
    });

    return diversified;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get document recommendations for current user
 */
export const getDocumentRecommendations = query({
  args: {
    count: v.optional(v.number()),
  },
  handler: async (ctx, { count = 10 }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    // Look up user by email (users table uses Convex Auth, no by_token index)
    const user = identity.email
      ? await ctx.db
          .query("users")
          .filter((q) => q.eq(q.field("email"), identity.email))
          .first()
      : null;

    if (!user) {
      return [];
    }

    // Check for cached recommendations
    const cached = await ctx.db
      .query("documentRecommendations")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(count);

    const now = Date.now();
    const needsRefresh =
      cached.length === 0 ||
      now - cached[0].generatedAt > DISCOVERY_CONFIG.refreshIntervalMs;

    if (needsRefresh) {
      // Trigger async regeneration
      ctx.scheduler.runAfter(
        0,
        internal.domains.research.documentDiscovery.generateDocumentRecommendations,
        { userId: user._id, count }
      );
    }

    return cached;
  },
});

/**
 * Record engagement with recommended document
 */
export const recordRecommendationEngagement = mutation({
  args: {
    documentId: v.id("documents"),
    action: v.union(
      v.literal("view"),
      v.literal("click"),
      v.literal("save"),
      v.literal("share")
    ),
  },
  handler: async (ctx, { documentId, action }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return;

    // Look up user by email (users table uses Convex Auth, no by_token index)
    const user = identity.email
      ? await ctx.db
          .query("users")
          .filter((q) => q.eq(q.field("email"), identity.email))
          .first()
      : null;

    if (!user) return;

    await ctx.db.insert("feedEngagements", {
      userId: user._id,
      itemId: documentId,
      action,
      timestamp: Date.now(),
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Save recommendations to cache
 */
export const saveRecommendations = internalMutation({
  args: {
    userId: v.id("users"),
    recommendations: v.array(v.any()),
  },
  handler: async (ctx, { userId, recommendations }) => {
    // Clear old recommendations
    const old = await ctx.db
      .query("documentRecommendations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    for (const rec of old) {
      await ctx.db.delete(rec._id);
    }

    // Insert new recommendations
    for (const rec of recommendations) {
      await ctx.db.insert("documentRecommendations", {
        userId,
        documentId: rec.documentId as any,
        phoenixScore: rec.phoenixScore,
        relevanceReason: rec.relevanceReason,
        engagementPrediction: rec.engagementPrediction,
        source: rec.source,
        generatedAt: Date.now(),
      });
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST QUERIES (for debugging without auth)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test query to verify candidate sourcing works (no auth required)
 */
export const testDocumentCandidates = query({
  args: {},
  handler: async (ctx) => {
    const trending = await ctx.runQuery(
      internal.domains.research.documentDiscovery.getTrendingDocuments,
      { limit: 10 }
    );

    // Get a sample user for semantic search
    const sampleUser = await ctx.db.query("users").first();
    let semantic: DocumentCandidate[] = [];
    if (sampleUser) {
      semantic = await ctx.runQuery(
        internal.domains.research.documentDiscovery.getCandidatesBySemanticSimilarity,
        { userId: sampleUser._id, limit: 10 }
      );
    }

    return {
      trendingCount: trending.length,
      trendingSample: trending[0],
      semanticCount: semantic.length,
      semanticSample: semantic[0],
    };
  },
});
