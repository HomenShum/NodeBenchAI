/**
 * Tavily Search Adapter
 *
 * Adapts Tavily AI-native search API responses to unified SearchResult format.
 * FREE TIER: 1,000 credits/month (1 credit per basic search)
 *
 * Tavily is designed specifically for AI applications with:
 * - AI-optimized results formatted for LLM consumption
 * - Content extraction and summarization
 * - Semantic search capabilities
 *
 * @see https://docs.tavily.com/
 * @module search/fusion/adapters/tavilyAdapter
 */

import type { SearchResult, SearchSourceAdapter, SearchAdapterOptions } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// TAVILY RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
  raw_content?: string;
}

interface TavilySearchResponse {
  query: string;
  answer?: string;
  results: TavilySearchResult[];
  response_time?: number;
  images?: Array<{
    url: string;
    description?: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export class TavilyAdapter implements SearchSourceAdapter {
  source = "tavily" as const;

  /**
   * Get API key at runtime (not construction time).
   * This ensures env vars are available in Convex's Node runtime.
   */
  private getApiKey(): string | undefined {
    return process.env.TAVILY_API_KEY;
  }

  isAvailable(): boolean {
    return !!this.getApiKey();
  }

  async search(query: string, options: SearchAdapterOptions): Promise<SearchResult[]> {
    const apiKey = this.getApiKey();
    console.log(`[TavilyAdapter] API key available: ${!!apiKey}, length: ${apiKey?.length || 0}`);
    if (!apiKey) {
      console.warn("[TavilyAdapter] API key not configured");
      return [];
    }

    const startTime = Date.now();

    try {
      // Build request body
      const requestBody: Record<string, unknown> = {
        query,
        api_key: apiKey,
        max_results: options.maxResults || 10,
        search_depth: "basic", // Use basic to conserve credits (1 credit vs 2 for advanced)
        include_answer: true, // Get AI-generated answer
        include_raw_content: false, // Save credits by not fetching full content
        include_images: false,
      };

      // Add time-based filter if date range specified
      if (options.dateRange?.start) {
        const start = new Date(options.dateRange.start);
        const now = new Date();
        const daysDiff = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

        // Tavily uses days parameter
        if (daysDiff > 0) {
          requestBody.days = Math.min(daysDiff, 365); // Max 1 year
        }
      }

      // Determine topic based on content types
      if (options.contentTypes?.includes("news")) {
        requestBody.topic = "news";
      }

      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[TavilyAdapter] API error: ${response.status} ${errorText}`);
        return [];
      }

      const data: TavilySearchResponse = await response.json();
      const elapsed = Date.now() - startTime;

      console.log(`[TavilyAdapter] Search completed in ${elapsed}ms, ${data.results?.length || 0} results`);

      return this.normalizeResults(data, options.maxResults || 10);
    } catch (error) {
      console.error("[TavilyAdapter] Search failed:", error);
      return [];
    }
  }

  private normalizeResults(data: TavilySearchResponse, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    // Add AI answer as top result if available
    if (data.answer) {
      results.push({
        id: `tavily-answer-${Date.now()}`,
        source: "tavily" as any,
        title: "AI Summary",
        snippet: data.answer,
        score: 1.0, // Highest score for AI-generated answer
        originalRank: 0,
        contentType: "text",
        metadata: {
          isAiAnswer: true,
          query: data.query,
        },
      });
    }

    // Process search results
    if (data.results) {
      for (let i = 0; i < data.results.length && results.length < maxResults; i++) {
        const result = data.results[i];

        results.push({
          id: `tavily-${Date.now()}-${i}`,
          source: "tavily" as any,
          title: result.title || "Untitled",
          snippet: result.content || "",
          url: result.url,
          score: result.score || (1 - (i / Math.max(data.results.length, 1))),
          originalRank: i + 1,
          contentType: this.inferContentType(result.url),
          publishedAt: result.published_date,
          metadata: {
            tavilyScore: result.score,
            hasRawContent: !!result.raw_content,
          },
        });
      }
    }

    return results.slice(0, maxResults);
  }

  private inferContentType(url: string): SearchResult["contentType"] {
    if (!url) return "text";
    const lower = url.toLowerCase();
    if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "video";
    if (lower.includes(".pdf")) return "pdf";
    if (lower.match(/\.(jpg|jpeg|png|gif|webp)/)) return "image";
    if (lower.includes("sec.gov")) return "filing";
    if (lower.match(/news|reuters|bloomberg|wsj|cnbc|bbc|cnn|nytimes/)) return "news";
    return "text";
  }
}

// Export singleton instance
export const tavilyAdapter = new TavilyAdapter();
