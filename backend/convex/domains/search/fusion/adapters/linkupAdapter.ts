/**
 * LinkUp Search Adapter
 * 
 * Adapts LinkUp API responses to unified SearchResult format.
 * 
 * @module search/fusion/adapters/linkupAdapter
 */

import type { SearchResult, SearchSourceAdapter, SearchAdapterOptions } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// LINKUP RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface LinkupSource {
  name: string;
  url: string;
  snippet?: string;
}

interface LinkupSearchResponse {
  answer?: string;
  sources?: LinkupSource[];
  results?: Array<{
    name: string;
    url: string;
    content?: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export class LinkupAdapter implements SearchSourceAdapter {
  source = "linkup" as const;
  
  private apiKey: string | undefined;
  
  constructor() {
    this.apiKey = process.env.LINKUP_API_KEY;
  }
  
  isAvailable(): boolean {
    return !!this.apiKey;
  }
  
  async search(query: string, options: SearchAdapterOptions): Promise<SearchResult[]> {
    if (!this.apiKey) {
      console.warn("[LinkupAdapter] API key not configured");
      return [];
    }
    
    const startTime = Date.now();
    
    try {
      const response = await fetch("https://api.linkup.so/v1/search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: query,
          depth: "standard",
          outputType: "searchResults",
          includeSources: true,
          maxResults: options.maxResults,
          ...(options.dateRange?.start && { fromDate: options.dateRange.start }),
          ...(options.dateRange?.end && { toDate: options.dateRange.end }),
        }),
      });
      
      if (!response.ok) {
        console.error(`[LinkupAdapter] API error: ${response.status}`);
        return [];
      }
      
      const data: LinkupSearchResponse = await response.json();
      const elapsed = Date.now() - startTime;
      console.log(`[LinkupAdapter] Search completed in ${elapsed}ms, ${data.sources?.length || 0} results`);
      
      return this.normalizeResults(data, options.maxResults);
    } catch (error) {
      console.error("[LinkupAdapter] Search failed:", error);
      return [];
    }
  }
  
  private normalizeResults(data: LinkupSearchResponse, maxResults: number): SearchResult[] {
    const sources = data.sources || data.results || [];
    
    return sources.slice(0, maxResults).map((source, index) => ({
      id: `linkup-${Date.now()}-${index}`,
      source: "linkup" as const,
      title: source.name || "Untitled",
      snippet: (source as any).snippet || (source as any).content || "",
      url: source.url,
      score: 1 - (index / sources.length), // Decay score by rank
      originalRank: index + 1,
      contentType: this.inferContentType(source.url),
      metadata: {
        rawSource: source,
      },
    }));
  }
  
  private inferContentType(url: string): SearchResult["contentType"] {
    if (!url) return "text";
    const lower = url.toLowerCase();
    if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "video";
    if (lower.includes(".pdf")) return "pdf";
    if (lower.match(/\.(jpg|jpeg|png|gif|webp)/)) return "image";
    if (lower.includes("sec.gov")) return "filing";
    if (lower.match(/news|reuters|bloomberg|wsj|cnbc/)) return "news";
    return "text";
  }
}

// Export singleton instance
export const linkupAdapter = new LinkupAdapter();

