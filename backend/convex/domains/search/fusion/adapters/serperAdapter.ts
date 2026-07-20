/**
 * Serper (Google SERP) Adapter
 *
 * Adapts Serper API responses to unified SearchResult format.
 * FREE TIER: 2,500 queries/month
 *
 * @see https://serper.dev/
 * @module search/fusion/adapters/serperAdapter
 */

import type { SearchResult, SearchSourceAdapter, SearchAdapterOptions } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// SERPER RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface SerperOrganicResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
  date?: string;
  sitelinks?: Array<{
    title: string;
    link: string;
  }>;
}

interface SerperNewsResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
  source?: string;
  imageUrl?: string;
  position: number;
}

interface SerperSearchResponse {
  searchParameters?: {
    q: string;
    type?: string;
    num?: number;
  };
  organic?: SerperOrganicResult[];
  news?: SerperNewsResult[];
  answerBox?: {
    title?: string;
    snippet?: string;
    link?: string;
  };
  knowledgeGraph?: {
    title?: string;
    description?: string;
    website?: string;
  };
  credits?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export class SerperAdapter implements SearchSourceAdapter {
  source = "serper" as const;

  /**
   * Get API key at runtime (not construction time).
   * This ensures env vars are available in Convex's Node runtime.
   */
  private getApiKey(): string | undefined {
    return process.env.SERPER_API_KEY;
  }

  isAvailable(): boolean {
    return !!this.getApiKey();
  }

  async search(query: string, options: SearchAdapterOptions): Promise<SearchResult[]> {
    const apiKey = this.getApiKey();
    console.log(`[SerperAdapter] API key available: ${!!apiKey}, length: ${apiKey?.length || 0}`);
    if (!apiKey) {
      console.warn("[SerperAdapter] API key not configured");
      return [];
    }

    const startTime = Date.now();

    try {
      // Build request body
      const requestBody: Record<string, unknown> = {
        q: query,
        num: options.maxResults || 10,
      };

      // Add time-based filter if date range specified
      if (options.dateRange?.start) {
        const start = new Date(options.dateRange.start);
        const now = new Date();
        const daysDiff = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

        // Serper uses tbs parameter for time-based search
        // d = past 24 hours, w = past week, m = past month, y = past year
        if (daysDiff <= 1) {
          requestBody.tbs = "qdr:d";
        } else if (daysDiff <= 7) {
          requestBody.tbs = "qdr:w";
        } else if (daysDiff <= 30) {
          requestBody.tbs = "qdr:m";
        } else if (daysDiff <= 365) {
          requestBody.tbs = "qdr:y";
        }
      }

      const response = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[SerperAdapter] API error: ${response.status} ${response.statusText}`);
        console.error(`[SerperAdapter] Error body: ${errorBody}`);
        return [];
      }

      const data: SerperSearchResponse = await response.json();
      const elapsed = Date.now() - startTime;

      const organicCount = data.organic?.length || 0;
      const newsCount = data.news?.length || 0;
      console.log(`[SerperAdapter] Search completed in ${elapsed}ms, ${organicCount} organic + ${newsCount} news results`);

      return this.normalizeResults(data, options.maxResults || 10);
    } catch (error) {
      console.error("[SerperAdapter] Search failed:", error);
      return [];
    }
  }

  private normalizeResults(data: SerperSearchResponse, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    // Process organic results
    if (data.organic) {
      for (const result of data.organic) {
        if (results.length >= maxResults) break;

        results.push({
          id: `serper-organic-${Date.now()}-${result.position}`,
          source: "serper" as any,
          title: result.title || "Untitled",
          snippet: result.snippet || "",
          url: result.link,
          score: 1 - (result.position / Math.max(data.organic.length, 1)),
          originalRank: result.position,
          contentType: this.inferContentType(result.link),
          publishedAt: result.date ? this.parseDate(result.date) : undefined,
          metadata: {
            sitelinks: result.sitelinks,
          },
        });
      }
    }

    // Process news results (interleave)
    if (data.news) {
      for (const news of data.news) {
        if (results.length >= maxResults) break;

        results.push({
          id: `serper-news-${Date.now()}-${news.position}`,
          source: "serper" as any,
          title: news.title || "Untitled",
          snippet: news.snippet || "",
          url: news.link,
          score: 0.85 - (news.position / Math.max(data.news.length, 1)) * 0.3,
          originalRank: results.length + 1,
          contentType: "news",
          publishedAt: news.date ? this.parseDate(news.date) : undefined,
          author: news.source,
          metadata: {
            sourceName: news.source,
            imageUrl: news.imageUrl,
          },
        });
      }
    }

    // Add answer box if present (high priority)
    if (data.answerBox && results.length < maxResults) {
      results.unshift({
        id: `serper-answerbox-${Date.now()}`,
        source: "serper" as any,
        title: data.answerBox.title || "Featured Answer",
        snippet: data.answerBox.snippet || "",
        url: data.answerBox.link,
        score: 1.0, // Highest score for answer box
        originalRank: 0,
        contentType: "text",
        metadata: {
          isAnswerBox: true,
        },
      });
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

  private parseDate(dateStr: string): string | undefined {
    if (!dateStr) return undefined;

    // Serper returns dates like "2 days ago", "Jan 15, 2024", etc.
    const now = new Date();

    // Handle relative dates
    const relativeMatch = dateStr.match(/(\d+)\s*(hour|day|week|month|year)s?\s*ago/i);
    if (relativeMatch) {
      const [, value, unit] = relativeMatch;
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

    // Try parsing as absolute date
    try {
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    } catch {
      // Ignore parse errors
    }

    return undefined;
  }
}

// Export singleton instance
export const serperAdapter = new SerperAdapter();
