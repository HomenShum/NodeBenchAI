/**
 * Document Search Adapter
 * 
 * Adapts direct Convex document search to unified SearchResult format.
 * Uses full-text search on document titles and content.
 * 
 * @module search/fusion/adapters/documentAdapter
 */

import type { ActionCtx } from "../../../../_generated/server";
import type { Id } from "../../../../_generated/dataModel";
import type { SearchResult, SearchSourceAdapter, SearchAdapterOptions } from "../types";
import { api } from "../../../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENT RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface DocumentSearchResult {
  _id: Id<"documents">;
  title: string;
  content?: string;
  type?: string;
  createdAt?: number;
  updatedAt?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Document Adapter requires ActionCtx to call Convex queries.
 */
export class DocumentAdapter implements SearchSourceAdapter {
  source = "documents" as const;
  
  private ctx: ActionCtx;
  
  constructor(ctx: ActionCtx) {
    this.ctx = ctx;
  }
  
  isAvailable(): boolean {
    return !!this.ctx;
  }
  
  async search(query: string, options: SearchAdapterOptions): Promise<SearchResult[]> {
    const startTime = Date.now();

    try {
      // Use the document search query (getSearch in documents.ts)
      const results = await this.ctx.runQuery(
        api.domains.documents.documents.getSearch,
        {
          query,
          ...(options.userId && { userId: options.userId }),
        }
      );

      const elapsed = Date.now() - startTime;
      console.log(`[DocumentAdapter] Search completed in ${elapsed}ms, ${results?.length || 0} results`);

      // Limit results to maxResults
      return this.normalizeResults((results || []).slice(0, options.maxResults), options.maxResults);
    } catch (error) {
      console.error("[DocumentAdapter] Search failed:", error);
      return [];
    }
  }
  
  private normalizeResults(docs: DocumentSearchResult[], maxResults: number): SearchResult[] {
    return docs.slice(0, maxResults).map((doc, index) => ({
      id: `doc-${doc._id}`,
      source: "documents" as const,
      title: doc.title || "Untitled",
      snippet: this.extractSnippet(doc.content),
      documentId: doc._id,
      score: 1 - (index / docs.length),
      originalRank: index + 1,
      contentType: this.mapDocType(doc.type),
      publishedAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : undefined,
      metadata: {
        type: doc.type,
        updatedAt: doc.updatedAt,
      },
    }));
  }
  
  private extractSnippet(content?: string): string {
    if (!content) return "";
    
    // Try to parse as JSON (TipTap format)
    try {
      const parsed = JSON.parse(content);
      if (parsed.content) {
        // Extract text from TipTap nodes
        const texts: string[] = [];
        this.extractTextFromNodes(parsed.content, texts);
        return texts.join(" ").slice(0, 300);
      }
    } catch {
      // Not JSON, use raw content
    }
    
    return content.slice(0, 300);
  }
  
  private extractTextFromNodes(nodes: any[], texts: string[]): void {
    for (const node of nodes) {
      if (node.text) texts.push(node.text);
      if (node.content) this.extractTextFromNodes(node.content, texts);
    }
  }
  
  private mapDocType(type?: string): SearchResult["contentType"] {
    switch (type) {
      case "pdf": return "pdf";
      case "video": return "video";
      case "image": return "image";
      default: return "text";
    }
  }
}

/**
 * Factory function to create Document adapter with context.
 */
export function createDocumentAdapter(ctx: ActionCtx): DocumentAdapter {
  return new DocumentAdapter(ctx);
}

