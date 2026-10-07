"use node";
/**
 * Search Fusion Actions
 *
 * Convex actions for multi-source search fusion.
 * Includes observability persistence, rate limiting, and caching.
 *
 * @module search/fusion/actions
 */

import { action } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { v } from "convex/values";
import { SearchOrchestrator } from "./orchestrator";
import type { SearchMode, SearchSource, SearchResponse, FusionSearchPayload } from "./types";
import { generateCacheKey, CACHE_TTL_MS } from "./cache";
import { wrapSearchResponse, FUSION_SEARCH_PAYLOAD_VERSION } from "./types";
import { isFusionSearchEnabled } from "../../../lib/featureFlags";

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATORS
// ═══════════════════════════════════════════════════════════════════════════

const searchModeValidator = v.union(
  v.literal("fast"),
  v.literal("balanced"),
  v.literal("comprehensive")
);

const searchSourceValidator = v.union(
  // FREE-FIRST web sources
  v.literal("brave"),
  v.literal("serper"),
  v.literal("tavily"),
  // Paid fallback
  v.literal("linkup"),
  // Specialized sources
  v.literal("sec"),
  v.literal("rag"),
  v.literal("documents"),
  v.literal("news"),
  v.literal("youtube"),
  v.literal("arxiv")
);

const contentTypeValidator = v.union(
  v.literal("text"),
  v.literal("pdf"),
  v.literal("video"),
  v.literal("image"),
  v.literal("filing"),
  v.literal("news")
);

const searchResultValidator = v.object({
  id: v.string(),
  source: searchSourceValidator,
  title: v.string(),
  snippet: v.string(),
  url: v.optional(v.string()),
  documentId: v.optional(v.id("documents")),
  score: v.number(),
  originalRank: v.number(),
  fusedRank: v.optional(v.number()),
  contentType: contentTypeValidator,
  publishedAt: v.optional(v.string()),
  author: v.optional(v.string()),
  metadata: v.optional(v.any()),
  highlights: v.optional(v.array(v.string())),
});

const searchResponseValidator = v.object({
  results: v.array(searchResultValidator),
  totalBeforeFusion: v.number(),
  mode: searchModeValidator,
  sourcesQueried: v.array(searchSourceValidator),
  timing: v.any(), // Record<SearchSource, number>
  totalTimeMs: v.number(),
  reranked: v.boolean(),
  errors: v.optional(v.array(v.object({
    source: searchSourceValidator,
    error: v.string(),
  }))),
});

/**
 * Versioned payload validator for FusionSearchPayload.
 * This is the contract shared with UI consumers.
 */
const fusionSearchPayloadValidator = v.object({
  kind: v.literal("fusion_search_results"),
  version: v.number(),
  payload: searchResponseValidator,
  generatedAt: v.string(),
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute multi-source search with fusion.
 *
 * Returns a versioned FusionSearchPayload with discriminator for type-safe
 * consumption by UI components.
 *
 * @returns FusionSearchPayload with kind="fusion_search_results" and version=1
 */
export const fusionSearch = action({
  args: {
    query: v.string(),
    mode: v.optional(searchModeValidator),
    sources: v.optional(v.array(searchSourceValidator)),
    maxPerSource: v.optional(v.number()),
    maxTotal: v.optional(v.number()),
    enableReranking: v.optional(v.boolean()),
    contentTypes: v.optional(v.array(contentTypeValidator)),
    dateRange: v.optional(v.object({
      start: v.optional(v.string()),
      end: v.optional(v.string()),
    })),
    userId: v.optional(v.id("users")),
    threadId: v.optional(v.string()),
    skipRateLimit: v.optional(v.boolean()), // For internal/admin use
    skipCache: v.optional(v.boolean()),     // Force fresh results
    cacheOnly: v.optional(v.boolean()),     // Return cached results or empty response without provider calls
    allowPaidSearch: v.optional(v.boolean()), // Explicitly allow paid fallback providers such as Linkup
  },
  returns: fusionSearchPayloadValidator,
  handler: async (ctx, args) => {
    // ═══════════════════════════════════════════════════════════════════════
    // KILL SWITCH CHECK
    // ═══════════════════════════════════════════════════════════════════════
    if (!isFusionSearchEnabled()) {
      console.warn("[fusionSearch] DISABLED via ENABLE_FUSION_SEARCH=false");
      throw new Error(
        "Fusion search is currently disabled. Please try again later or contact support."
      );
    }

    const mode = (args.mode || "balanced") as SearchMode;
    const sources = (args.sources || []) as string[];
    const cacheSources = [
      ...sources,
      args.allowPaidSearch ? "__paid_allowed" : "__paid_disallowed",
    ];
    console.log(`[fusionSearch] Query: "${args.query}", Mode: ${mode}`);

    // Check rate limit (unless explicitly skipped)
    if (!args.skipRateLimit) {
      const rateLimitCheck = await ctx.runQuery(
        internal.domains.search.fusion.rateLimiter.checkRateLimit,
        {
          userId: args.userId,
          threadId: args.threadId,
          sources,
        }
      );

      if (!rateLimitCheck.allowed) {
        console.warn(`[fusionSearch] Rate limited: ${rateLimitCheck.reason}`);
        throw new Error(
          `Rate limit exceeded. ${rateLimitCheck.reason}. Retry after ${Math.ceil((rateLimitCheck.retryAfterMs || 0) / 1000)}s.`
        );
      }
    }

    // Check cache (unless explicitly skipped)
    const cacheKey = generateCacheKey(args.query, mode, cacheSources);
    if (!args.skipCache) {
      const cached = await ctx.runQuery(
        internal.domains.search.fusion.cache.getCachedResults,
        { cacheKey }
      );

      if (cached.hit) {
        console.log(`[fusionSearch] Cache HIT (age: ${cached.age}ms)`);
        // Increment hit count
        await ctx.runMutation(
          internal.domains.search.fusion.cache.incrementCacheHit,
          { cacheKey }
        );
        // Persist observability with cache hit flag
        const cachedResponse = JSON.parse(cached.results) as SearchResponse;
        await persistObservability(ctx, args.query, cachedResponse, args.userId, args.threadId, true);
        // Wrap cached response in versioned payload
        return wrapSearchResponse(cachedResponse);
      }
      console.log(`[fusionSearch] Cache MISS`);
    }

    if (args.cacheOnly) {
      console.log(`[fusionSearch] Cache-only miss; provider calls skipped`);
      return wrapSearchResponse({
        results: [],
        totalBeforeFusion: 0,
        mode,
        sourcesQueried: [],
        timing: {} as any,
        totalTimeMs: 0,
        reranked: false,
      });
    }

    const orchestrator = new SearchOrchestrator(ctx);

    const response = await orchestrator.search({
      query: args.query,
      mode,
      sources: args.sources as SearchSource[] | undefined,
      maxPerSource: args.maxPerSource,
      maxTotal: args.maxTotal,
      enableReranking: args.enableReranking,
      contentTypes: args.contentTypes,
      dateRange: args.dateRange,
      userId: args.userId,
      allowPaidSearch: args.allowPaidSearch,
    });

    // Log observability metrics
    console.log(`[fusionSearch] Results: ${response.results.length}/${response.totalBeforeFusion}`);
    console.log(`[fusionSearch] Timing:`, response.timing);
    console.log(`[fusionSearch] Total: ${response.totalTimeMs}ms, Reranked: ${response.reranked}`);

    // Store in cache
    const ttlMs = CACHE_TTL_MS[mode];
    await ctx.runMutation(
      internal.domains.search.fusion.cache.setCachedResults,
      {
        cacheKey,
        query: args.query,
        mode,
        sources: response.sourcesQueried,
        results: JSON.stringify(response),
        resultCount: response.results.length,
        ttlMs,
      }
    );

    // Persist observability data
    await persistObservability(ctx, args.query, response, args.userId, args.threadId, false);

    // Return versioned payload
    return wrapSearchResponse(response);
  },
});

/**
 * Quick search using fast mode (single source, no fusion).
 *
 * Returns a versioned FusionSearchPayload for consistency with fusionSearch.
 *
 * @returns FusionSearchPayload with kind="fusion_search_results" and version=1
 */
export const quickSearch = action({
  args: {
    query: v.string(),
    maxResults: v.optional(v.number()),
    userId: v.optional(v.id("users")),
    threadId: v.optional(v.string()),
    skipRateLimit: v.optional(v.boolean()),
    allowPaidSearch: v.optional(v.boolean()),
  },
  returns: fusionSearchPayloadValidator,
  handler: async (ctx, args) => {
    // ═══════════════════════════════════════════════════════════════════════
    // KILL SWITCH CHECK
    // ═══════════════════════════════════════════════════════════════════════
    if (!isFusionSearchEnabled()) {
      console.warn("[quickSearch] DISABLED via ENABLE_FUSION_SEARCH=false");
      throw new Error(
        "Fusion search is currently disabled. Please try again later or contact support."
      );
    }

    // Check rate limit (unless explicitly skipped)
    const rateLimitSources = args.allowPaidSearch
      ? ["rag", "documents", "brave", "serper", "tavily", "linkup"]
      : ["rag", "documents", "brave", "serper", "tavily"];
    if (!args.skipRateLimit) {
      const rateLimitCheck = await ctx.runQuery(
        internal.domains.search.fusion.rateLimiter.checkRateLimit,
        {
          userId: args.userId,
          threadId: args.threadId,
          sources: rateLimitSources,
        }
      );

      if (!rateLimitCheck.allowed) {
        console.warn(`[quickSearch] Rate limited: ${rateLimitCheck.reason}`);
        throw new Error(
          `Rate limit exceeded. ${rateLimitCheck.reason}. Retry after ${Math.ceil((rateLimitCheck.retryAfterMs || 0) / 1000)}s.`
        );
      }
    }

    const orchestrator = new SearchOrchestrator(ctx);
    const cacheSources = [
      ...rateLimitSources,
      args.allowPaidSearch ? "__paid_allowed" : "__paid_disallowed",
    ];
    const cacheKey = generateCacheKey(args.query, "fast", cacheSources);
    const cached = await ctx.runQuery(
      internal.domains.search.fusion.cache.getCachedResults,
      { cacheKey }
    );

    if (cached.hit) {
      console.log(`[quickSearch] Cache HIT (age: ${cached.age}ms)`);
      await ctx.runMutation(
        internal.domains.search.fusion.cache.incrementCacheHit,
        { cacheKey }
      );
      const cachedResponse = JSON.parse(cached.results) as SearchResponse;
      await persistObservability(ctx, args.query, cachedResponse, args.userId, args.threadId, true);
      return wrapSearchResponse(cachedResponse);
    }

    const response = await orchestrator.search({
      query: args.query,
      mode: "fast",
      maxTotal: args.maxResults || 10,
      allowPaidSearch: args.allowPaidSearch,
    });

    await ctx.runMutation(
      internal.domains.search.fusion.cache.setCachedResults,
      {
        cacheKey,
        query: args.query,
        mode: "fast",
        sources: response.sourcesQueried,
        results: JSON.stringify(response),
        resultCount: response.results.length,
        ttlMs: CACHE_TTL_MS.fast,
      }
    );

    // Persist observability data
    await persistObservability(ctx, args.query, response, args.userId, args.threadId, false);

    // Return versioned payload (same as fusionSearch for consistency)
    return wrapSearchResponse(response);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Persist observability data
// ═══════════════════════════════════════════════════════════════════════════

async function persistObservability(
  ctx: any,
  query: string,
  response: SearchResponse,
  userId?: any,
  threadId?: string,
  cacheHit?: boolean
) {
  try {
    // Build per-source results from timing and errors
    const sourceResults = Object.entries(response.timing).map(([source, latencyMs]) => {
      const error = response.errors?.find((e) => e.source === source);
      const sourceResultCount = response.results.filter((r) => r.source === source).length;
      return {
        source,
        latencyMs: latencyMs,
        resultCount: sourceResultCount,
        success: !error,
        errorMessage: error?.error,
        resultIds: response.results
          .filter((r) => r.source === source)
          .map((r) => r.id),
      };
    });

    await ctx.runMutation(internal.domains.search.fusion.observability.persistSearchRun, {
      userId,
      threadId,
      query,
      mode: response.mode,
      sourcesRequested: response.sourcesQueried, // We don't track requested separately yet
      sourcesQueried: response.sourcesQueried,
      totalResults: response.results.length,
      totalBeforeFusion: response.totalBeforeFusion,
      reranked: response.reranked,
      totalTimeMs: response.totalTimeMs,
      cacheHit,
      fusedResultIds: response.results.map((r) => r.id),
      sourceResults,
    });
  } catch (error) {
    // Don't fail the search if observability persistence fails
    console.warn("[fusionSearch] Failed to persist observability:", error);
  }
}
