"use node";

/**
 * Hybrid Search Actions (Node.js Runtime)
 *
 * Contains actions that require Node.js (OpenAI).
 * Queries and mutations are in hybridSearchQueries.ts
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import OpenAI from "openai";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface HybridSearchResult {
  toolName: string;
  description: string;
  category: string;
  categoryName: string;
  score: number;
  matchType: "keyword" | "semantic" | "hybrid";
  keywordScore?: number;
  semanticScore?: number;
  usageCount?: number;
}

export interface RankedItem {
  toolName: string;
  score: number;
}

export interface CachedSearchResult {
  toolName: string;
  score: number;
  matchType: "keyword" | "semantic" | "hybrid";
}

export interface KeywordSearchItem {
  toolName: string;
  description: string;
  category: string;
  categoryName: string;
  usageCount: number;
  rank: number;
}

export interface SemanticSearchItem {
  toolName: string;
  description: string;
  category: string;
  categoryName: string;
  usageCount: number;
  score: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// RECIPROCAL RANK FUSION (RRF)
// ═══════════════════════════════════════════════════════════════════════════

export function reciprocalRankFusion(
  rankedLists: Array<Array<RankedItem>>,
  k: number = 60
): RankedItem[] {
  const scoreMap = new Map<string, number>();
  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const rrfScore = 1 / (k + rank + 1);
      const current = scoreMap.get(item.toolName) || 0;
      scoreMap.set(item.toolName, current + rrfScore);
    }
  }
  return Array.from(scoreMap.entries())
    .map(([toolName, score]) => ({ toolName, score }))
    .sort((a, b) => b.score - a.score);
}

export function weightedFusion(
  keywordResults: Array<{ toolName: string; score: number }>,
  semanticResults: Array<{ toolName: string; score: number }>,
  keywordWeight: number = 0.5,
  semanticWeight: number = 0.5
): RankedItem[] {
  const scoreMap = new Map<string, { keyword: number; semantic: number }>();
  const maxKeyword = Math.max(...keywordResults.map(r => r.score), 1);
  const maxSemantic = Math.max(...semanticResults.map(r => r.score), 1);
  for (const r of keywordResults) {
    scoreMap.set(r.toolName, { keyword: r.score / maxKeyword, semantic: 0 });
  }
  for (const r of semanticResults) {
    const existing = scoreMap.get(r.toolName) || { keyword: 0, semantic: 0 };
    existing.semantic = r.score / maxSemantic;
    scoreMap.set(r.toolName, existing);
  }
  return Array.from(scoreMap.entries())
    .map(([toolName, scores]) => ({
      toolName,
      score: scores.keyword * keywordWeight + scores.semantic * semanticWeight,
    }))
    .sort((a, b) => b.score - a.score);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HYBRID SEARCH ACTION
// ═══════════════════════════════════════════════════════════════════════════

export const hybridSearchTools = internalAction({
  args: {
    query: v.string(),
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
    fusionMethod: v.optional(v.union(v.literal("rrf"), v.literal("weighted"))),
    rrfK: v.optional(v.number()),
    keywordWeight: v.optional(v.number()),
    semanticWeight: v.optional(v.number()),
    usePopularityBoost: v.optional(v.boolean()),
    includeDebug: v.optional(v.boolean()),
    skipCache: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{
    results: HybridSearchResult[];
    cached?: boolean;
    debug?: {
      keywordCount: number;
      semanticCount: number;
      fusionMethod: string;
      queryEmbeddingTime?: number;
      cacheHit?: boolean;
      cacheAge?: number;
    };
  }> => {
    const {
      query,
      category,
      limit = 5,
      fusionMethod = "rrf",
      rrfK = 60,
      keywordWeight = 0.5,
      semanticWeight = 0.5,
      usePopularityBoost = true,
      includeDebug = false,
      skipCache = false,
    } = args;

    // Check cache first
    if (!skipCache) {
      try {
        const cached = await ctx.runQuery(
          internal.tools.meta.hybridSearchQueries.getCachedSearchResults,
          { query, category }
        );
        if (cached.hit && cached.results) {
          const cachedResults: HybridSearchResult[] = cached.results.slice(0, limit).map((r: CachedSearchResult) => ({
            toolName: r.toolName,
            description: "",
            category: "",
            categoryName: "",
            score: r.score,
            matchType: r.matchType,
          }));
          return { results: cachedResults, cached: true };
        }
      } catch (error) {
        console.warn("[hybridSearchTools] Cache lookup failed:", error);
      }
    }

    // Generate query embedding
    const embeddingStartTime = Date.now();
    let queryEmbedding: number[] = [];

    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: query,
      });
      queryEmbedding = embeddingResponse.data[0].embedding;
    } catch (error) {
      console.warn("[hybridSearchTools] Embedding generation failed:", error);
    }

    const embeddingTime = Date.now() - embeddingStartTime;

    // Run keyword search
    const keywordResults: KeywordSearchItem[] = await ctx.runQuery(
      internal.tools.meta.hybridSearchQueries.keywordSearchTools,
      { query, category, limit: 20 }
    );

    // Run semantic search (if embedding was generated)
    // Note: vectorSearch is only available in actions, so we do it inline here
    let semanticResults: SemanticSearchItem[] = [];

    if (queryEmbedding.length > 0) {
      try {
        const vectorResults = await ctx.vectorSearch("toolRegistry", "by_embedding", {
          vector: queryEmbedding,
          limit: 20,
          filter: category
            ? (q: any) => q.eq("category", category)
            : undefined,
        });

        // Fetch full documents for results
        const toolsWithDetails = await Promise.all(
          vectorResults.map(async (result: any) => {
            const doc = await ctx.runQuery(
              internal.tools.meta.hybridSearchQueries.getToolByIdInternal,
              { toolId: result._id }
            );
            return doc ? {
              toolName: doc.toolName,
              description: doc.description,
              category: doc.category,
              categoryName: doc.categoryName,
              usageCount: doc.usageCount,
              score: result._score,
            } : null;
          })
        );

        semanticResults = toolsWithDetails.filter((t): t is NonNullable<typeof t> => t !== null);
      } catch (error) {
        console.warn("[hybridSearchTools] Vector search failed:", error);
      }
    }

    // Apply fusion
    let fusedResults: RankedItem[];

    if (fusionMethod === "rrf") {
      const keywordRanked = keywordResults.map((r, idx) => ({
        toolName: r.toolName,
        score: keywordResults.length - idx,
      }));
      const semanticRanked = semanticResults.map(r => ({
        toolName: r.toolName,
        score: r.score,
      }));
      fusedResults = reciprocalRankFusion([keywordRanked, semanticRanked], rrfK);
    } else {
      const keywordScored = keywordResults.map((r, idx) => ({
        toolName: r.toolName,
        score: 1 / (1 + idx * 0.1),
      }));
      const semanticScored = semanticResults.map(r => ({
        toolName: r.toolName,
        score: r.score,
      }));
      fusedResults = weightedFusion(keywordScored, semanticScored, keywordWeight, semanticWeight);
    }

    // Build result details map
    const detailsMap = new Map<string, {
      description: string;
      category: string;
      categoryName: string;
      usageCount: number;
      keywordRank?: number;
      semanticScore?: number;
    }>();

    keywordResults.forEach((r, idx) => {
      detailsMap.set(r.toolName, {
        description: r.description,
        category: r.category,
        categoryName: r.categoryName,
        usageCount: r.usageCount,
        keywordRank: idx + 1,
      });
    });

    semanticResults.forEach(r => {
      const existing = detailsMap.get(r.toolName);
      if (existing) {
        existing.semanticScore = r.score;
      } else {
        detailsMap.set(r.toolName, {
          description: r.description,
          category: r.category,
          categoryName: r.categoryName,
          usageCount: r.usageCount,
          semanticScore: r.score,
        });
      }
    });

    // Apply popularity boost and build final results
    const results: HybridSearchResult[] = [];

    for (const fused of fusedResults.slice(0, limit)) {
      const details = detailsMap.get(fused.toolName);
      if (!details) continue;

      let finalScore = fused.score;
      if (usePopularityBoost && details.usageCount > 0) {
        finalScore *= 1 + Math.log(1 + details.usageCount) * 0.05;
      }

      const hasKeyword = details.keywordRank !== undefined;
      const hasSemantic = details.semanticScore !== undefined;
      const matchType: "keyword" | "semantic" | "hybrid" =
        hasKeyword && hasSemantic ? "hybrid" :
        hasKeyword ? "keyword" : "semantic";

      results.push({
        toolName: fused.toolName,
        description: details.description,
        category: details.category,
        categoryName: details.categoryName,
        score: finalScore,
        matchType,
        keywordScore: details.keywordRank ? 1 / details.keywordRank : undefined,
        semanticScore: details.semanticScore,
        usageCount: details.usageCount,
      });
    }

    results.sort((a, b) => b.score - a.score);

    // Store results in cache
    if (!skipCache && results.length > 0) {
      try {
        await ctx.runMutation(
          internal.tools.meta.hybridSearchQueries.setCachedSearchResults,
          {
            query,
            category,
            results: results.map((r) => ({
              toolName: r.toolName,
              score: r.score,
              matchType: r.matchType,
            })),
          }
        );
      } catch (error) {
        console.warn("[hybridSearchTools] Cache storage failed:", error);
      }
    }

    return {
      results,
      cached: false,
      ...(includeDebug && {
        debug: {
          keywordCount: keywordResults.length,
          semanticCount: semanticResults.length,
          fusionMethod,
          queryEmbeddingTime: embeddingTime,
          cacheHit: false,
        },
      }),
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// EMBEDDING GENERATION
// ═══════════════════════════════════════════════════════════════════════════

export const generateToolEmbedding = internalAction({
  args: {
    toolName: v.string(),
    description: v.string(),
    keywords: v.array(v.string()),
    examples: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<number[]> => {
    const { description, keywords, examples = [] } = args;
    const textParts = [description, ...keywords, ...examples];
    const combinedText = textParts.join(" ");

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: combinedText,
    });

    return response.data[0].embedding;
  },
});