/**
 * arXiv Search Adapter
 * 
 * Adapts arXiv API responses to unified SearchResult format.
 * Uses the arXiv Atom API: https://arxiv.org/help/api/
 * 
 * @module search/fusion/adapters/arxivAdapter
 */

import type { SearchResult, SearchSourceAdapter, SearchAdapterOptions } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// ARXIV API HELPERS
// ═══════════════════════════════════════════════════════════════════════════

interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  published: string;
  updated: string;
  authors: string[];
  pdfLink: string;
  absLink: string;
  categories: string[];
}

/**
 * Parse arXiv Atom XML response into structured entries.
 * arXiv uses Atom XML format, not JSON.
 */
function parseArxivXml(xml: string): ArxivEntry[] {
  const entries: ArxivEntry[] = [];
  
  // Simple regex-based parsing for arXiv Atom feed
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  
  while ((match = entryRegex.exec(xml)) !== null) {
    const entryXml = match[1];
    
    // Extract fields with simple regex
    const getId = (xml: string) => xml.match(/<id>(.*?)<\/id>/)?.[1] || "";
    const getTitle = (xml: string) => xml.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, " ").trim() || "";
    const getSummary = (xml: string) => xml.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, " ").trim() || "";
    const getPublished = (xml: string) => xml.match(/<published>(.*?)<\/published>/)?.[1] || "";
    const getUpdated = (xml: string) => xml.match(/<updated>(.*?)<\/updated>/)?.[1] || "";
    
    // Extract authors
    const authorRegex = /<author>[\s\S]*?<name>(.*?)<\/name>[\s\S]*?<\/author>/g;
    const authors: string[] = [];
    let authorMatch;
    while ((authorMatch = authorRegex.exec(entryXml)) !== null) {
      authors.push(authorMatch[1]);
    }
    
    // Extract links
    const pdfMatch = entryXml.match(/<link.*?title="pdf".*?href="(.*?)"/);
    const absMatch = entryXml.match(/<link.*?type="text\/html".*?href="(.*?)"/);
    
    // Extract categories
    const categoryRegex = /<category.*?term="(.*?)"/g;
    const categories: string[] = [];
    let catMatch;
    while ((catMatch = categoryRegex.exec(entryXml)) !== null) {
      categories.push(catMatch[1]);
    }
    
    entries.push({
      id: getId(entryXml),
      title: getTitle(entryXml),
      summary: getSummary(entryXml),
      published: getPublished(entryXml),
      updated: getUpdated(entryXml),
      authors,
      pdfLink: pdfMatch?.[1] || "",
      absLink: absMatch?.[1] || getId(entryXml),
      categories,
    });
  }
  
  return entries;
}

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export class ArxivAdapter implements SearchSourceAdapter {
  source = "arxiv" as const;
  
  // arXiv API is public, no API key needed
  isAvailable(): boolean {
    return true;
  }
  
  async search(query: string, options: SearchAdapterOptions): Promise<SearchResult[]> {
    const startTime = Date.now();
    
    try {
      // Build arXiv API query
      // https://arxiv.org/help/api/user-manual
      const searchQuery = encodeURIComponent(query.replace(/[^\w\s]/g, " "));
      const maxResults = Math.min(options.maxResults, 50); // arXiv max is 50 per request
      
      const url = `https://export.arxiv.org/api/query?search_query=all:${searchQuery}&start=0&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;
      
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/atom+xml" },
      });

      if (!response.ok) {
        console.error(`[ArxivAdapter] API error: ${response.status}`);
        return [];
      }

      const xml = await response.text();
      const entries = parseArxivXml(xml);
      
      const elapsed = Date.now() - startTime;
      console.log(`[ArxivAdapter] Search completed in ${elapsed}ms, ${entries.length} results`);

      return this.normalizeResults(entries, options.maxResults);
    } catch (error) {
      console.error("[ArxivAdapter] Search failed:", error);
      return [];
    }
  }

  private normalizeResults(entries: ArxivEntry[], maxResults: number): SearchResult[] {
    return entries.slice(0, maxResults).map((entry, index) => ({
      id: `arxiv-${entry.id.split("/abs/")[1] || index}`,
      source: "arxiv" as const,
      title: entry.title,
      snippet: entry.summary.substring(0, 400),
      url: entry.absLink,
      score: 1 - index / entries.length,
      originalRank: index + 1,
      contentType: "pdf" as const,
      publishedAt: entry.published,
      author: entry.authors.slice(0, 3).join(", ") + (entry.authors.length > 3 ? " et al." : ""),
      metadata: {
        pdfUrl: entry.pdfLink,
        authors: entry.authors,
        categories: entry.categories,
        arxivId: entry.id,
      },
    }));
  }
}

// Export singleton instance
export const arxivAdapter = new ArxivAdapter();

