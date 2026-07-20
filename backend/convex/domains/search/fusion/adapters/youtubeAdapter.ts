/**
 * YouTube Search Adapter
 * 
 * Adapts YouTube Data API v3 responses to unified SearchResult format.
 * Reuses logic from convex/tools/media/youtubeSearch.ts
 * 
 * @module search/fusion/adapters/youtubeAdapter
 */

import type { SearchResult, SearchSourceAdapter, SearchAdapterOptions } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// YOUTUBE API TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface YouTubeSearchResult {
  items: Array<{
    id: {
      videoId: string;
    };
    snippet: {
      publishedAt: string;
      title: string;
      description: string;
      channelTitle: string;
      thumbnails: {
        medium?: { url: string };
        default?: { url: string };
      };
    };
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export class YouTubeAdapter implements SearchSourceAdapter {
  source = "youtube" as const;
  
  private apiKey: string | undefined;
  
  constructor() {
    this.apiKey = process.env.YOUTUBE_API_KEY;
  }
  
  isAvailable(): boolean {
    return !!this.apiKey;
  }
  
  async search(query: string, options: SearchAdapterOptions): Promise<SearchResult[]> {
    if (!this.apiKey) {
      console.warn("[YouTubeAdapter] API key not configured");
      return [];
    }
    
    const startTime = Date.now();
    
    try {
      const params = new URLSearchParams({
        part: "snippet",
        q: query,
        type: "video",
        maxResults: Math.min(options.maxResults, 25).toString(), // YouTube API max is 50
        order: "relevance",
        key: this.apiKey,
      });

      // Add date filter if provided
      if (options.dateRange?.start) {
        params.append("publishedAfter", new Date(options.dateRange.start).toISOString());
      }
      if (options.dateRange?.end) {
        params.append("publishedBefore", new Date(options.dateRange.end).toISOString());
      }

      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?${params}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
        }
      );

      if (!response.ok) {
        console.error(`[YouTubeAdapter] API error: ${response.status}`);
        return [];
      }

      const data: YouTubeSearchResult = await response.json();
      const elapsed = Date.now() - startTime;
      console.log(`[YouTubeAdapter] Search completed in ${elapsed}ms, ${data.items?.length || 0} results`);

      return this.normalizeResults(data, options.maxResults);
    } catch (error) {
      console.error("[YouTubeAdapter] Search failed:", error);
      return [];
    }
  }

  private normalizeResults(data: YouTubeSearchResult, maxResults: number): SearchResult[] {
    if (!data.items || data.items.length === 0) return [];

    return data.items.slice(0, maxResults).map((item, index) => ({
      id: `youtube-${item.id.videoId}`,
      source: "youtube" as const,
      title: item.snippet.title,
      snippet: item.snippet.description?.substring(0, 300) || "",
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      score: 1 - index / data.items.length,
      originalRank: index + 1,
      contentType: "video" as const,
      publishedAt: item.snippet.publishedAt,
      author: item.snippet.channelTitle,
      metadata: {
        videoId: item.id.videoId,
        channelTitle: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
      },
    }));
  }
}

// Export singleton instance
export const youtubeAdapter = new YouTubeAdapter();

