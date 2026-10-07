// convex/tools/linkupSearch.ts
// Linkup search tool for Agent component
// Provides web search capabilities using Linkup's advanced search API
// 
// IMPORTANT: This tool returns CONTRACTED SOURCES via artifacts.
// URLs are persisted to artifact store and returned as sourceArtifactIds.
// The LLM should NEVER construct URLs - only reference tool output.

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../../_generated/api";
import { generateCacheKey, getTTL } from "../../globalResearch/cacheSimple";

import { v } from "convex/values";

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface LinkupSearchResult {
  answer?: string;
  sources?: Array<{
    name: string;
    url: string;
    snippet: string;
    publishedAt?: string;
  }>;
  results?: Array<{
    type: "text" | "image" | "video" | "audio";
    name: string;
    url: string;
    content?: string;
    thumbnail?: string;
    publishedAt?: string;
    published_at?: string;
    date?: string;
  }>;
  // Structured output (when outputType: "structured")
  structured?: Record<string, unknown>;
}

/**
 * Helper to extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return '';
  }
}

function getPublishedAt(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  const v = obj["publishedAt"] ?? obj["published_at"] ?? obj["date"];
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}

function filterLinkupImagesByQuery<T extends { url: string; name?: string }>(
  images: T[],
  query: string,
): T[] {
  const q = (query || "").toLowerCase();
  const tokens = q
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 4)
    .filter((t) => !["with", "from", "that", "this", "about", "image", "images", "photo", "photos", "picture", "pictures"].includes(t));

  if (tokens.length === 0) return images;

  return images.filter((img) => {
    const hay = `${img.name ?? ""} ${img.url}`.toLowerCase();
    return tokens.some((t) => hay.includes(t));
  });
}

/**
 * Search the web using Linkup's AI-optimized search API
 * 
 * This tool searches the web and returns VERIFIED sources.
 * All URLs are persisted to the artifact store - the LLM should
 * reference sources by name, NOT by constructing URLs.
 * 
 * CRITICAL: Use fromDate/toDate for time-bounded queries like
 * "funding this week" or "news from yesterday".
 */
export const linkupSearch = createTool({
  description: `Search the web for current information using Linkup's AI-optimized search.

IMPORTANT RULES:
1. Use fromDate/toDate for temporal queries ("past week", "today", "last month")
2. Sources are automatically persisted - DO NOT construct URLs yourself
3. Reference sources by name (e.g., "According to TechCrunch...") not by URL
4. Set includeImages=true ONLY when user explicitly asks for images/pictures

The tool returns verified sources that get stored in the artifact system.`,

  args: z.object({
    query: z.string().describe("The natural language search query. Be specific and detailed for best results."),
    depth: z.enum(["standard", "deep"]).default("standard").describe("Search depth: 'standard' (€0.005, faster), 'deep' (€0.05, more comprehensive)"),

    // NEW: Date filtering (critical for temporal queries)
    fromDate: z.string().optional().describe("Start date in ISO format YYYY-MM-DD. Use for 'past week', 'since Monday', etc."),
    toDate: z.string().optional().describe("End date in ISO format YYYY-MM-DD. Use for 'until yesterday', 'before Dec 1', etc."),

    // NEW: Output type selection
    outputType: z.enum(["sourcedAnswer", "searchResults"]).default("sourcedAnswer")
      .describe("'sourcedAnswer' returns natural language answer with citations. 'searchResults' returns raw chunks for grounding."),

    // NEW: Inline citations for sourcedAnswer
    includeInlineCitations: z.boolean().default(true)
      .describe("When true, answer includes [1], [2] markers mapped to sources. Recommended for traceability."),

    // NEW: Max results
    maxResults: z.number().optional().describe("Maximum number of results to return (default: API decides)"),

    // Source control (per Linkup API spec)
    includeSources: z.boolean().default(true)
      .describe("Include source URLs in response. Always true for traceability - sources stored in artifact system."),

    // Existing
    includeImages: z.boolean().default(false).describe("Set TRUE only when user explicitly asks for images, pictures, photos."),
    includeDomains: z.array(z.string()).optional().describe("Limit search to these domains (e.g., ['techcrunch.com', 'sec.gov'])"),
    excludeDomains: z.array(z.string()).optional().describe("Exclude these domains from search"),
  }),

  handler: async (ctx, args, options): Promise<string> => {
    const apiKey = process.env.LINKUP_API_KEY;
    const startTime = Date.now();
    let success = false;
    let imageCount = 0;
    let errorMsg: string | undefined;
    let cacheHit = false;

    if (!apiKey) {
      throw new Error("LINKUP_API_KEY environment variable is not set. Please add it to your Convex environment variables.");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CACHE CHECK (MVP: simple TTL cache)
    // ═══════════════════════════════════════════════════════════════════════
    const cacheKey = generateCacheKey("linkupSearch", args.query, {
      depth: args.depth,
      fromDate: args.fromDate,
      toDate: args.toDate,
      outputType: args.outputType,
      includeImages: args.includeImages,
      includeDomains: args.includeDomains,
      excludeDomains: args.excludeDomains,
    });

    try {
      const cached = await ctx.runQuery(internal.globalResearch.cacheSimple.getCache, {
        queryKey: cacheKey,
      });

      if (cached.hit) {
        console.log(`[linkupSearch] 🎯 Cache HIT for: "${args.query}" (age: ${Math.round(cached.ageMs / 1000)}s)`);
        cacheHit = true;
        return cached.response;
      }
    } catch (cacheError) {
      // Cache check failed - continue with API call
      console.warn(`[linkupSearch] Cache check failed:`, cacheError);
    }

    // Determine output type: use searchResults when images requested, otherwise use provided outputType
    const effectiveOutputType = args.includeImages ? "searchResults" : args.outputType;

    // Build request body with all Linkup API parameters
    const requestBody: Record<string, unknown> = {
      q: args.query,
      depth: args.depth,
      outputType: effectiveOutputType,
      includeImages: args.includeImages,
    };

    // Add optional parameters only if provided
    if (args.fromDate) requestBody.fromDate = args.fromDate;
    if (args.toDate) requestBody.toDate = args.toDate;
    if (args.includeInlineCitations !== undefined) requestBody.includeInlineCitations = args.includeInlineCitations;
    if (args.maxResults) requestBody.maxResults = args.maxResults;
    if (args.includeSources !== undefined) requestBody.includeSources = args.includeSources;
    if (args.includeDomains?.length) requestBody.includeDomains = args.includeDomains;
    if (args.excludeDomains?.length) requestBody.excludeDomains = args.excludeDomains;

    console.log(`[linkupSearch] Searching for: "${args.query}"`, {
      depth: args.depth,
      outputType: effectiveOutputType,
      fromDate: args.fromDate,
      toDate: args.toDate,
      includeInlineCitations: args.includeInlineCitations,
      includeImages: args.includeImages,
      maxResults: args.maxResults,
    });

    try {
      const response = await fetch("https://api.linkup.so/v1/search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: options.abortSignal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[linkupSearch] API error (${response.status}):`, errorText);
        throw new Error(`Linkup API error: ${response.status} ${response.statusText}`);
      }

      const data: LinkupSearchResult = await response.json();

      // Persist sourceArtifact for audit/replayability
      try {
        const rawContent = JSON.stringify(data);
        const contentHash = await sha256Hex(rawContent);
        await ctx.runMutation(internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact, {
          sourceType: "api_response",
          contentHash,
          rawContent,
          extractedData: {
            tool: "linkupSearch",
            query: args.query,
            depth: args.depth,
            totalResults: data.results?.length ?? 0,
            hasAnswer: !!data.answer,
          },
          fetchedAt: Date.now(),
        });
      } catch (err) {
        console.warn("[linkupSearch] Failed to persist artifact:", err);
      }

      // Filter results by type
      const textResults = data.results?.filter(r => r.type === "text") || [];
      const imageResults = data.results?.filter(r => r.type === "image") || [];
      const videoResults = data.results?.filter(r => r.type === "video") || [];
      const audioResults = data.results?.filter(r => r.type === "audio") || [];

      console.log(`[linkupSearch] ✅ Response received:`, {
        resultsTotal: data.results?.length || 0,
        textCount: textResults.length,
        imagesCount: imageResults.length,
        videosCount: videoResults.length,
        audiosCount: audioResults.length,
        hasAnswer: !!data.answer,
        hasSources: !!data.sources
      });

      // Debug: Log first image if present
      if (imageResults.length > 0) {
        console.log(`[linkupSearch] 📸 First image URL:`, imageResults[0].url);
        console.log(`[linkupSearch] 📸 First image name:`, imageResults[0].name);
      } else if (args.includeImages) {
        console.warn(`[linkupSearch] ⚠️ includeImages was TRUE but API returned 0 images!`);
      }

      // ═══════════════════════════════════════════════════════════════════════
      // FORMAT RESPONSE AS STRUCTURED OUTPUT
      // Frontend parses JSON directly, no regex needed
      // ═══════════════════════════════════════════════════════════════════════

      const citationMap: Array<{ marker: string; title: string; domain: string }> = [];

      // Process images
      let images: Array<{ url: string; alt: string; thumbnail?: string }> | undefined;
      if (imageResults.length > 0) {
        const filteredImages = filterLinkupImagesByQuery(imageResults, args.query);
        const chosenImages = (filteredImages.length > 0 ? filteredImages : imageResults).slice(0, 10);
        imageCount = chosenImages.length;
        images = chosenImages.map((image) => ({
          url: image.url,
          alt: image.name || "Image",
          thumbnail: image.thumbnail,
        }));
      }

      // Process videos
      let videos: Array<{ url: string; title: string; thumbnail?: string }> | undefined;
      if (videoResults.length > 0) {
        videos = videoResults.slice(0, 5).map((video) => ({
          url: video.url,
          title: video.name || "Video",
          thumbnail: video.thumbnail,
        }));
      }

      // Process audios
      let audios: Array<{ url: string; title: string }> | undefined;
      if (audioResults.length > 0) {
        audios = audioResults.slice(0, 5).map((audio) => ({
          url: audio.url,
          title: audio.name || "Audio",
        }));
      }

      // Process sources (from text results or sources array)
      let sources: Array<{ title: string; url: string; domain: string; description?: string; publishedAt?: string }> | undefined;

      if (textResults.length > 0 && !data.answer) {
        sources = textResults.slice(0, 10).map((text) => ({
          title: text.name,
          url: text.url,
          domain: extractDomain(text.url),
          description: text.content?.substring(0, 200) || '',
          publishedAt: getPublishedAt(text),
        }));
        // Build citation map
        textResults.slice(0, 5).forEach((text, idx) => {
          citationMap.push({ marker: `[${idx + 1}]`, title: text.name, domain: extractDomain(text.url) });
        });
      } else if (data.sources && data.sources.length > 0) {
        sources = data.sources.slice(0, 10).map((source) => ({
          title: source.name,
          url: source.url,
          domain: extractDomain(source.url),
          description: source.snippet?.substring(0, 200) || '',
          publishedAt: getPublishedAt(source),
        }));
        // Build citation map
        data.sources.slice(0, 5).forEach((source, idx) => {
          citationMap.push({ marker: `[${idx + 1}]`, title: source.name, domain: extractDomain(source.url) });
        });
      }

      // Build human-readable summary for LLM
      const summaryParts: string[] = [];

      if (sources && sources.length > 0) {
        const sourceList = sources.slice(0, 3).map((s, i) => `[${i + 1}] ${s.title} (${s.domain})`).join('\n');
        summaryParts.push(`Found ${sources.length} sources:\n${sourceList}${sources.length > 3 ? `\n...and ${sources.length - 3} more` : ''}`);
      }
      if (images && images.length > 0) {
        summaryParts.push(`Found ${images.length} images`);
      }
      if (videos && videos.length > 0) {
        summaryParts.push(`Found ${videos.length} videos`);
      }
      if (audios && audios.length > 0) {
        summaryParts.push(`Found ${audios.length} audio clips`);
      }

      const summary = summaryParts.length > 0
        ? `Web search for "${args.query}":\n${summaryParts.join('\n\n')}`
        : `No results found for "${args.query}"`;

      // Create structured output
      const structuredOutput = {
        kind: 'linkup_search_results' as const,
        version: 1,
        summary,
        data: {
          query: args.query,
          sources,
          images,
          videos,
          audios,
          citationKey: citationMap.length > 0 ? citationMap : undefined,
        },
      };

      success = true;
      const result = JSON.stringify(structuredOutput);

      // ═══════════════════════════════════════════════════════════════════════
      // CACHE STORE (MVP: simple TTL cache)
      // ═══════════════════════════════════════════════════════════════════════
      const hasDateFilter = !!(args.fromDate || args.toDate);
      const ttlMs = getTTL(args.query, hasDateFilter);

      try {
        await ctx.runMutation(internal.globalResearch.cacheSimple.setCache, {
          queryKey: cacheKey,
          toolName: "linkupSearch",
          response: result,
          ttlMs,
        });
        console.log(`[linkupSearch] 💾 Cached result (TTL: ${Math.round(ttlMs / 1000 / 60)}min)`);
      } catch (cacheStoreError) {
        // Cache store failed - not critical, just log
        console.warn(`[linkupSearch] Failed to cache result:`, cacheStoreError);
      }

      // Track API usage (asynchronously, don't wait)
      // Linkup Pricing (2025): €5/1,000 standard searches = ~$0.0055/search = 0.55 cents
      // Deep search would be ~5.5 cents but we only use standard
      const responseTime = Date.now() - startTime;
      ctx.scheduler.runAfter(0, "domains/billing/apiUsageTracking:trackApiUsage" as any, {
        apiName: "linkup",
        operation: "search",
        unitsUsed: 1,
        estimatedCost: 1, // 0.55 cents for standard, round up to 1 cent
        requestMetadata: { query: args.query, imageCount, depth: args.depth, cacheHit },
        success: true,
        responseTime,
      });

      return result;
    } catch (error) {
      errorMsg = error instanceof Error ? error.message : String(error);
      console.error("[linkupSearch] Error:", error);

      // Track failed API call (asynchronously)
      const responseTime = Date.now() - startTime;
      try {
        ctx.scheduler.runAfter(0, "domains/billing/apiUsageTracking:trackApiUsage" as any, {
          apiName: "linkup",
          operation: "search",
          unitsUsed: 0,
          estimatedCost: 0,
          requestMetadata: { query: args.query },
          success: false,
          errorMessage: errorMsg,
          responseTime,
        });
      } catch (trackError) {
        console.error("[linkupSearch] Failed to track error:", trackError);
      }

      throw error;
    }
  },
});
