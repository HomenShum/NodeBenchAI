/**
 * News Search Adapter
 * 
 * Aggregates news from multiple sources using NewsAPI or similar.
 * Falls back to LinkUp with news filter if NewsAPI key is not configured.
 * 
 * @module search/fusion/adapters/newsAdapter
 */

import type { SearchResult, SearchSourceAdapter, SearchAdapterOptions } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// NEWSAPI TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface NewsApiArticle {
  source: { id: string | null; name: string };
  author: string | null;
  title: string;
  description: string | null;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  content: string | null;
}

interface NewsApiResponse {
  status: string;
  totalResults: number;
  articles: NewsApiArticle[];
}

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export class NewsAdapter implements SearchSourceAdapter {
  source = "news" as const;
  
  private apiKey: string | undefined;
  private linkupApiKey: string | undefined;
  
  constructor() {
    this.apiKey = process.env.NEWSAPI_KEY;
    this.linkupApiKey = process.env.LINKUP_API_KEY;
  }
  
  isAvailable(): boolean {
    // Available if either NewsAPI or LinkUp is configured
    return !!(this.apiKey || this.linkupApiKey);
  }
  
  async search(query: string, options: SearchAdapterOptions): Promise<SearchResult[]> {
    const startTime = Date.now();
    
    // Try NewsAPI first, fall back to LinkUp
    if (this.apiKey) {
      return this.searchNewsApi(query, options, startTime);
    } else if (this.linkupApiKey) {
      return this.searchLinkupNews(query, options, startTime);
    }
    
    return [];
  }
  
  private async searchNewsApi(
    query: string,
    options: SearchAdapterOptions,
    startTime: number
  ): Promise<SearchResult[]> {
    try {
      const params = new URLSearchParams({
        q: query,
        pageSize: Math.min(options.maxResults, 100).toString(),
        sortBy: "relevancy",
        language: "en",
        apiKey: this.apiKey!,
      });

      // Add date filters
      if (options.dateRange?.start) {
        params.append("from", options.dateRange.start);
      }
      if (options.dateRange?.end) {
        params.append("to", options.dateRange.end);
      }

      const response = await fetch(
        `https://newsapi.org/v2/everything?${params}`,
        { method: "GET" }
      );

      if (!response.ok) {
        console.error(`[NewsAdapter] NewsAPI error: ${response.status}`);
        // Fall back to LinkUp if NewsAPI fails
        if (this.linkupApiKey) {
          return this.searchLinkupNews(query, options, startTime);
        }
        return [];
      }

      const data: NewsApiResponse = await response.json();
      const elapsed = Date.now() - startTime;
      console.log(`[NewsAdapter] NewsAPI completed in ${elapsed}ms, ${data.articles?.length || 0} results`);

      return this.normalizeNewsApiResults(data.articles || [], options.maxResults);
    } catch (error) {
      console.error("[NewsAdapter] NewsAPI search failed:", error);
      return [];
    }
  }
  
  private async searchLinkupNews(
    query: string,
    options: SearchAdapterOptions,
    startTime: number
  ): Promise<SearchResult[]> {
    try {
      // Use LinkUp with news-focused query
      const response = await fetch("https://api.linkup.so/v1/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.linkupApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: `${query} news`,
          depth: "standard",
          outputType: "searchResults",
          maxResults: options.maxResults,
        }),
      });

      if (!response.ok) {
        console.error(`[NewsAdapter] LinkUp error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      const elapsed = Date.now() - startTime;
      const sources = data.sources || data.results || [];
      console.log(`[NewsAdapter] LinkUp news completed in ${elapsed}ms, ${sources.length} results`);

      return this.normalizeLinkupResults(sources, options.maxResults);
    } catch (error) {
      console.error("[NewsAdapter] LinkUp news search failed:", error);
      return [];
    }
  }

  private normalizeNewsApiResults(articles: NewsApiArticle[], maxResults: number): SearchResult[] {
    return articles.slice(0, maxResults).map((article, index) => ({
      id: `news-${Date.now()}-${index}`,
      source: "news" as const,
      title: article.title || "Untitled",
      snippet: article.description || article.content?.substring(0, 200) || "",
      url: article.url,
      score: 1 - index / articles.length,
      originalRank: index + 1,
      contentType: "news" as const,
      publishedAt: article.publishedAt,
      author: article.author || article.source?.name || "Unknown",
      metadata: { sourceName: article.source?.name, imageUrl: article.urlToImage },
    }));
  }

  private normalizeLinkupResults(sources: any[], maxResults: number): SearchResult[] {
    // Filter for news-like URLs
    const newsSources = sources.filter((s) => {
      const url = (s.url || "").toLowerCase();
      return url.match(/news|reuters|bloomberg|wsj|cnbc|bbc|cnn|nytimes|theguardian/);
    });
    const toUse = newsSources.length > 0 ? newsSources : sources;
    return toUse.slice(0, maxResults).map((source, index) => ({
      id: `news-linkup-${Date.now()}-${index}`,
      source: "news" as const,
      title: source.name || "Untitled",
      snippet: source.snippet || source.content || "",
      url: source.url,
      score: 1 - index / toUse.length,
      originalRank: index + 1,
      contentType: "news" as const,
      metadata: { rawSource: source },
    }));
  }
}

// Export singleton instance
export const newsAdapter = new NewsAdapter();

