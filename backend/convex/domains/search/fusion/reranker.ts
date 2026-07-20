/**
 * LLM Reranker
 * 
 * Uses LLM to rerank search results for improved relevance.
 * 
 * @module search/fusion/reranker
 */

import { generateObject } from "ai";
import { z } from "zod";
import type { SearchResult } from "./types";
import { getLanguageModelSafe, DEFAULT_MODEL } from "../../agents/mcp_tools/models";

// ═══════════════════════════════════════════════════════════════════════════
// RERANKING SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

const rerankSchema = z.object({
  rankings: z.array(z.object({
    id: z.string().describe("Result ID"),
    relevanceScore: z.number().min(0).max(1).describe("Relevance score 0-1"),
    reasoning: z.string().optional().describe("Brief reasoning for score"),
  })),
});

// ═══════════════════════════════════════════════════════════════════════════
// RERANKER CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class LLMReranker {
  private maxResultsToRerank = 20; // Limit to control token usage
  
  /**
   * Rerank search results using LLM.
   * Returns results sorted by LLM-assigned relevance scores.
   */
  async rerank(
    query: string,
    results: SearchResult[],
    maxResults: number
  ): Promise<SearchResult[]> {
    if (results.length === 0) return [];
    
    // Limit results to rerank (token budget)
    const toRerank = results.slice(0, this.maxResultsToRerank);
    
    console.log(`[LLMReranker] Reranking ${toRerank.length} results for: "${query}"`);
    const startTime = Date.now();
    
    try {
      const model = getLanguageModelSafe(DEFAULT_MODEL);
      
      // Build context for LLM
      const resultContext = toRerank.map((r, i) => ({
        id: r.id,
        index: i + 1,
        title: r.title,
        snippet: r.snippet.slice(0, 200),
        source: r.source,
        contentType: r.contentType,
      }));
      
      const { object } = await generateObject({
        model,
        schema: rerankSchema,
        prompt: `You are a search result reranker. Given a query and search results, score each result's relevance from 0 to 1.

Query: "${query}"

Search Results:
${resultContext.map(r => `[${r.index}] ${r.title}
   Source: ${r.source} | Type: ${r.contentType}
   Snippet: ${r.snippet}...`).join("\n\n")}

Score each result based on:
1. Direct relevance to the query
2. Information quality and specificity
3. Source credibility
4. Recency (if applicable)

Return rankings for all ${toRerank.length} results.`,
      });
      
      const elapsed = Date.now() - startTime;
      console.log(`[LLMReranker] Reranking completed in ${elapsed}ms`);
      
      // Apply LLM scores and sort
      const scoreMap = new Map(object.rankings.map(r => [r.id, r.relevanceScore]));
      
      const reranked = toRerank
        .map(result => ({
          ...result,
          score: scoreMap.get(result.id) ?? result.score,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults)
        .map((result, index) => ({
          ...result,
          fusedRank: index + 1,
        }));
      
      return reranked;
    } catch (error) {
      console.error("[LLMReranker] Reranking failed, returning original order:", error);
      // Fallback to original order
      return results.slice(0, maxResults);
    }
  }
}

export const llmReranker = new LLMReranker();

