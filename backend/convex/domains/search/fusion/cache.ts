/**
 * Search Fusion Cache
 * 
 * TTL-based caching layer for search results to prevent repeated web calls.
 * 
 * Cache key: hash(query + sources + mode)
 * TTL: 1 hour (fast), 6 hours (balanced), 12 hours (comprehensive)
 * 
 * @module search/fusion/cache
 */

import { internalMutation, internalQuery } from "../../../_generated/server";
import { v } from "convex/values";
import { Doc } from "../../../_generated/dataModel";
import type { SearchMode, SearchResponse } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// CACHE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export const CACHE_TTL_MS = {
  fast: 60 * 60 * 1000,              // 1 hour
  balanced: 6 * 60 * 60 * 1000,      // 6 hours
  comprehensive: 12 * 60 * 60 * 1000, // 12 hours
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// CACHE KEY GENERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a cache key from query parameters.
 * Simple hash function for cache key generation.
 */
export function generateCacheKey(
  query: string,
  mode: SearchMode,
  sources: string[]
): string {
  const normalized = `${query.toLowerCase().trim()}|${mode}|${sources.sort().join(",")}`;
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `cache_${Math.abs(hash).toString(36)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE GET
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get cached search results if available and not expired.
 */
export const getCachedResults = internalQuery({
  args: {
    cacheKey: v.string(),
  },
  returns: v.union(
    v.object({
      hit: v.literal(true),
      results: v.string(), // JSON-stringified SearchResponse
      age: v.number(),     // Age in ms
    }),
    v.object({
      hit: v.literal(false),
    })
  ),
  handler: async (ctx, args) => {
    const now = Date.now();
    
    const cached = await ctx.db
      .query("searchFusionCache")
      .withIndex("by_cache_key", (q) => q.eq("cacheKey", args.cacheKey))
      .first() as Doc<"searchFusionCache"> | null;

    if (!cached) {
      return { hit: false as const };
    }

    // Check if expired
    if (cached.expiresAt < now) {
      return { hit: false as const };
    }
    
    return {
      hit: true as const,
      results: cached.results,
      age: now - cached.createdAt,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CACHE SET
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Store search results in cache.
 */
export const setCachedResults = internalMutation({
  args: {
    cacheKey: v.string(),
    query: v.string(),
    mode: v.string(),
    sources: v.array(v.string()),
    results: v.string(), // JSON-stringified SearchResponse
    resultCount: v.number(),
    ttlMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // Check if entry already exists
    const existing = await ctx.db
      .query("searchFusionCache")
      .withIndex("by_cache_key", (q) => q.eq("cacheKey", args.cacheKey))
      .first() as Doc<"searchFusionCache"> | null;

    if (existing) {
      // Update existing entry
      await ctx.db.patch(existing._id, {
        results: args.results,
        resultCount: args.resultCount,
        createdAt: now,
        expiresAt: now + args.ttlMs,
        hitCount: (existing.hitCount || 0),
      });
    } else {
      // Create new entry
      await ctx.db.insert("searchFusionCache", {
        cacheKey: args.cacheKey,
        query: args.query,
        mode: args.mode,
        sources: args.sources,
        results: args.results,
        resultCount: args.resultCount,
        createdAt: now,
        expiresAt: now + args.ttlMs,
        hitCount: 0,
      });
    }
    
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CACHE HIT TRACKING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Increment cache hit count for analytics.
 */
export const incrementCacheHit = internalMutation({
  args: {
    cacheKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cached = await ctx.db
      .query("searchFusionCache")
      .withIndex("by_cache_key", (q) => q.eq("cacheKey", args.cacheKey))
      .first() as Doc<"searchFusionCache"> | null;

    if (cached) {
      await ctx.db.patch(cached._id, {
        hitCount: (cached.hitCount || 0) + 1,
      });
    }

    return null;
  },
});
