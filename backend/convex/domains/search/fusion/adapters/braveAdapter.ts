/**
 * Brave Search Adapter
 *
 * Adapts Brave Search API responses to unified SearchResult format.
 * FREE TIER: 2,000 queries/month
 *
 * @see https://brave.com/search/api/
 * @module search/fusion/adapters/braveAdapter
 */

import type { SearchResult, SearchSourceAdapter, SearchAdapterOptions } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// BRAVE RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
  age?: string;
  page_age?: string;
  language?: string;
  family_friendly?: boolean;
  extra_snippets?: string[];
}

interface BraveNewsResult {
  title: string;
  url: string;
  description: string;
  age?: string;
  source?: {
    name: string;
    url: string;
    favicon?: string;
  };
  thumbnail?: {
    src: string;
  };
}

interface BraveSearchResponse {
  type: "search";
  query?: {
    original: string;
    altered?: string;
  };
  web?: {
    type: "search";
    results: BraveWebResult[];
  };
  news?: {
    type: "news";
    results: BraveNewsResult[];
  };
  infobox?: {
    type: "infobox";
    title?: string;
    description?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export class BraveAdapter implements SearchSourceAdapter {
  source = "brave" as const;

  /**
   * Get API key at runtime (not construction time).
   * This ensures env vars are available in Convex's Node runtime.
   */
  private getApiKey(): string | undefined {
    return process.env.BRAVE_API_KEY;
  }

  isAvailable(): boolean {
    return !!this.getApiKey();
  }

  async search(query: string, options: SearchAdapterOptions): Promise<SearchResult[]> {
    const apiKey = this.getApiKey();
    console.log(`[BraveAdapter] API key available: ${!!apiKey}, length: ${apiKey?.length || 0}`);
    if (!apiKey) {
      console.warn("[BraveAdapter] API key not configured");
      return [];
    }

    const startTime = Date.now();

    try {
      // Build query params
      const params = new URLSearchParams({
        q: query,
        count: String(options.maxResults || 10),
        result_filter: "web,news",
        text_decorations: "false",
        safesearch: "moderate",
      });

      // Add freshness filter if date range specified
      if (options.dateRange?.start) {
        // Brave uses freshness parameter: pd (past day), pw (past week), pm (past month), py (past year)
        const start = new Date(options.dateRange.start);
        const now = new Date();
        const daysDiff = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

        if (daysDiff <= 1) {
          params.set("freshness", "pd");
        } else if (daysDiff <= 7) {
          params.set("freshness", "pw");
        } else if (daysDiff <= 30) {
          params.set("freshness", "pm");
        } else if (daysDiff <= 365) {
          params.set("freshness", "py");
        }
      }

      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": apiKey,
          },
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[BraveAdapter] API error: ${response.status} ${response.statusText}`);
        console.error(`[BraveAdapter] Error body: ${errorBody}`);
        return [];
      }

      const data: BraveSearchResponse = await response.json();
      const elapsed = Date.now() - startTime;

      const webCount = data.web?.results?.length || 0;
      const newsCount = data.news?.results?.length || 0;
      console.log(`[BraveAdapter] Search completed in ${elapsed}ms, ${webCount} web + ${newsCount} news results`);

      return this.normalizeResults(data, options.maxResults || 10);
    } catch (error) {
      console.error("[BraveAdapter] Search failed:", error);
      return [];
    }
  }

  private normalizeResults(data: BraveSearchResponse, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    // Process web results
    if (data.web?.results) {
      for (let i = 0; i < data.web.results.length && results.length < maxResults; i++) {
        const result = data.web.results[i];
        results.push({
          id: `brave-web-${Date.now()}-${i}`,
          source: "brave" as any,
          title: result.title || "Untitled",
          snippet: result.description || "",
          url: result.url,
          score: 1 - (i / Math.max(data.web.results.length, 1)),
          originalRank: i + 1,
          contentType: this.inferContentType(result.url),
          publishedAt: this.parseAge(result.age || result.page_age),
          metadata: {
            extraSnippets: result.extra_snippets,
            language: result.language,
            familyFriendly: result.family_friendly,
          },
        });
      }
    }

    // Process news results (interleave with web results)
    if (data.news?.results) {
      for (let i = 0; i < data.news.results.length && results.length < maxResults; i++) {
        const news = data.news.results[i];
        results.push({
          id: `brave-news-${Date.now()}-${i}`,
          source: "brave" as any,
          title: news.title || "Untitled",
          snippet: news.description || "",
          url: news.url,
          score: 0.9 - (i / Math.max(data.news.results.length, 1)) * 0.3, // Slightly lower than web
          originalRank: results.length + 1,
          contentType: "news",
          publishedAt: this.parseAge(news.age),
          author: news.source?.name,
          metadata: {
            sourceName: news.source?.name,
            sourceUrl: news.source?.url,
            thumbnail: news.thumbnail?.src,
          },
        });
      }
    }

    // Sort by score and limit
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
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

  private parseAge(age: string | undefined): string | undefined {
    if (!age) return undefined;

    // Brave returns ages like "2 hours ago", "3 days ago", etc.
    // Convert to ISO date string
    const now = new Date();
    const match = age.match(/(\d+)\s*(hour|day|week|month|year)s?\s*ago/i);

    if (match) {
      const [, value, unit] = match;
      const num = parseInt(value, 10);

      switch (unit.toLowerCase()) {
        case "hour":
          now.setHours(now.getHours() - num);
          break;
        case "day":
          now.setDate(now.getDate() - num);
          break;
        case "week":
          now.setDate(now.getDate() - num * 7);
          break;
        case "month":
          now.setMonth(now.getMonth() - num);
          break;
        case "year":
          now.setFullYear(now.getFullYear() - num);
          break;
      }

      return now.toISOString();
    }

    return undefined;
  }
}

// Export singleton instance
export const braveAdapter = new BraveAdapter();
