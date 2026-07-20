/**
 * Fusion Search Tool
 * 
 * Agent tool for multi-source search with fusion.
 * 
 * @module tools/search/fusionSearchTool
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api } from "../../_generated/api";

/**
 * Fusion search tool for agents.
 * Searches across multiple sources (LinkUp, SEC, RAG, documents) with RRF fusion.
 */
export const fusionSearch = createTool({
  description: `Search across multiple sources with intelligent fusion. 
Use this for comprehensive research queries that benefit from multiple perspectives.

Modes:
- "fast": Single source (LinkUp), fastest response
- "balanced": 3 sources with RRF fusion, good balance
- "comprehensive": All sources with LLM reranking, highest quality

Examples:
- "What is Apple's latest earnings?" → balanced mode
- "AAPL SEC filings 10-K" → comprehensive mode (includes SEC)
- "quick news about Tesla" → fast mode`,

  args: z.object({
    query: z.string().describe("Search query"),
    mode: z.enum(["fast", "balanced", "comprehensive"])
      .default("balanced")
      .describe("Search mode: fast (1 source), balanced (3 sources), comprehensive (all + reranking)"),
    maxResults: z.number().optional().default(10)
      .describe("Maximum results to return"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      const fusionPayload = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
        query: args.query,
        mode: args.mode,
        maxTotal: args.maxResults,
      });

      // Extract SearchResponse from versioned FusionSearchPayload
      const response = fusionPayload.payload;

      if (response.results.length === 0) {
        return `No results found for "${args.query}". Try a different query or search mode.`;
      }

      const embeddedFusionPayload = [
        "<!-- FUSION_SEARCH_DATA",
        JSON.stringify(fusionPayload),
        "-->",
      ].join("\n");

      const sourceGalleryItems = response.results
        .filter((r: { url?: string }) => typeof r.url === "string" && r.url.length > 0)
	        .map((r: { title: string; url: string; snippet?: string; publishedAt?: string }) => {
          let domain: string | undefined;
          try {
            domain = new URL(r.url).hostname.replace(/^www\./, "");
          } catch {
            domain = undefined;
          }
          return {
            title: r.title,
            url: r.url,
            domain,
            description: r.snippet ? r.snippet.slice(0, 240) : undefined,
	            publishedAt: r.publishedAt,
          };
        });

      const embeddedSourceGallery = [
        "<!-- SOURCE_GALLERY_DATA",
        JSON.stringify(sourceGalleryItems),
        "-->",
      ].join("\n");

      // Format results for agent consumption
      const formattedResults = response.results.map((r: { id: string; title: string; source: string; contentType: string; url?: string; snippet: string; publishedAt?: string }, i: number) => {
        const parts = [
          `${i + 1}. **${r.title}**`,
          `   Id: ${r.id}`,
          `   Source: ${r.source} | Type: ${r.contentType}`,
        ];
        
        if (r.url) parts.push(`   URL: ${r.url}`);
        if (r.snippet) parts.push(`   ${r.snippet.slice(0, 200)}...`);
        if (r.publishedAt) parts.push(`   Published: ${r.publishedAt}`);
        
        return parts.join("\n");
      });

      const summary = [
        `## Search Results for "${args.query}"`,
        `Mode: ${response.mode} | Sources: ${response.sourcesQueried.join(", ")}`,
        `Found ${response.results.length} results (${response.totalBeforeFusion} before fusion)`,
        `Time: ${response.totalTimeMs}ms | Reranked: ${response.reranked}`,
        "",
        "Tip: In your final answer, cite sources using `{{cite:<Id>|<Label>|type:source}}`.",
        "",
        ...formattedResults,
        "",
        embeddedFusionPayload,
        embeddedSourceGallery,
      ];

      return summary.join("\n");
    } catch (error) {
      console.error("[fusionSearch tool] Error:", error);
      return `Search failed: ${error}. Please try again.`;
    }
  },
});

/**
 * Quick search tool for fast single-source queries.
 */
export const quickSearch = createTool({
  description: `Quick search using a single source for fast responses.
Use this for simple queries where speed matters more than comprehensiveness.`,

  args: z.object({
    query: z.string().describe("Search query"),
    maxResults: z.number().optional().default(5)
      .describe("Maximum results to return"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      const fusionPayload = await ctx.runAction(api.domains.search.fusion.actions.quickSearch, {
        query: args.query,
        maxResults: args.maxResults,
      });

      // Extract results from versioned FusionSearchPayload
      const response = fusionPayload.payload;
      const results = response.results;

      if (results.length === 0) {
        return `No results found for "${args.query}".`;
      }

      const embeddedFusionPayload = [
        "<!-- FUSION_SEARCH_DATA",
        JSON.stringify(fusionPayload),
        "-->",
      ].join("\n");

      const sourceGalleryItems = results
        .filter((r: { url?: string }) => typeof r.url === "string" && r.url.length > 0)
	        .map((r: { title: string; url: string; snippet?: string; publishedAt?: string }) => {
          let domain: string | undefined;
          try {
            domain = new URL(r.url).hostname.replace(/^www\./, "");
          } catch {
            domain = undefined;
          }
          return {
            title: r.title,
            url: r.url,
            domain,
            description: r.snippet ? r.snippet.slice(0, 240) : undefined,
	            publishedAt: r.publishedAt,
          };
        });

      const embeddedSourceGallery = [
        "<!-- SOURCE_GALLERY_DATA",
        JSON.stringify(sourceGalleryItems),
        "-->",
      ].join("\n");

      const formatted = results.map((r: { id: string; title: string; url?: string }, i: number) =>
        `${i + 1}. ${r.title} (Id: ${r.id})${r.url ? ` - ${r.url}` : ""}`
      );

      return [
        `Quick search results for "${args.query}":`,
        ...formatted,
        "",
        "Tip: In your final answer, cite sources using `{{cite:<Id>|<Label>|type:source}}`.",
        "",
        embeddedFusionPayload,
        embeddedSourceGallery,
      ].join("\n");
    } catch (error) {
      console.error("[quickSearch tool] Error:", error);
      return `Quick search failed: ${error}`;
    }
  },
});
