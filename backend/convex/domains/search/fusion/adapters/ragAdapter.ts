/**
 * RAG Search Adapter
 * 
 * Adapts internal Convex RAG search to unified SearchResult format.
 * Uses hybrid BM25 + vector search with RRF fusion.
 * 
 * @module search/fusion/adapters/ragAdapter
 */

import type { ActionCtx } from "../../../../_generated/server";
import type { Id } from "../../../../_generated/dataModel";
import type { SearchResult, SearchSourceAdapter, SearchAdapterOptions } from "../types";
import { internal } from "../../../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// RAG RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface RagCandidate {
  documentId: Id<"documents">;
  title: string;
  snippet?: string;
  score?: number;
  source?: "vector" | "keyword" | "hybrid";
  highlights?: string[];
  rank?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * RAG Adapter requires ActionCtx to call internal Convex actions.
 * Unlike other adapters, this one needs to be instantiated per-request.
 */
export class RagAdapter implements SearchSourceAdapter {
  source = "rag" as const;
  
  private ctx: ActionCtx;
  
  constructor(ctx: ActionCtx) {
    this.ctx = ctx;
  }
  
  isAvailable(): boolean {
    // RAG is always available if we have a context
    return !!this.ctx;
  }
  
  async search(query: string, options: SearchAdapterOptions): Promise<SearchResult[]> {
    const startTime = Date.now();
    
    try {
      // Call the internal RAG search action
      const result = await this.ctx.runAction(
        internal.domains.search.rag.answerQuestionViaRAG,
        { prompt: query }
      );
      
      const elapsed = Date.now() - startTime;
      console.log(`[RagAdapter] Search completed in ${elapsed}ms, ${result.candidateDocs?.length || 0} results`);
      
      return this.normalizeResults(result.candidateDocs || [], options.maxResults);
    } catch (error) {
      console.error("[RagAdapter] Search failed:", error);
      return [];
    }
  }
  
  private normalizeResults(candidates: RagCandidate[], maxResults: number): SearchResult[] {
    return candidates.slice(0, maxResults).map((candidate, index) => ({
      id: `rag-${candidate.documentId}`,
      source: "rag" as const,
      title: candidate.title || "Untitled Document",
      snippet: candidate.snippet || "",
      documentId: candidate.documentId,
      score: candidate.score ?? (1 - index / candidates.length),
      originalRank: candidate.rank ?? (index + 1),
      contentType: "text" as const,
      highlights: candidate.highlights,
      metadata: {
        searchSource: candidate.source,
      },
    }));
  }
}

/**
 * Factory function to create RAG adapter with context.
 * Use this in Convex actions.
 */
export function createRagAdapter(ctx: ActionCtx): RagAdapter {
  return new RagAdapter(ctx);
}

