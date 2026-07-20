// convex/globalResearch/cacheSimple.ts
// Simple TTL cache for search results (MVP)
// Full response caching - artifact deduplication comes later

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { Doc } from "../_generated/dataModel";
import { hashSync } from "../../shared/artifacts";

// ═══════════════════════════════════════════════════════════════════════════
// TTL CONSTANTS (milliseconds)
// ═══════════════════════════════════════════════════════════════════════════

export const TTL = {
  /** News/temporal queries (has fromDate/toDate) */
  NEWS: 6 * 60 * 60 * 1000,           // 6 hours
  /** Funding-related queries */
  FUNDING: 24 * 60 * 60 * 1000,       // 24 hours
  /** General queries */
  DEFAULT: 24 * 60 * 60 * 1000,       // 24 hours
  /** Background/overview queries */
  BACKGROUND: 7 * 24 * 60 * 60 * 1000, // 7 days
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate cache key from query parameters.
 * Deterministic: same params → same key.
 */
export function generateCacheKey(
  toolName: string,
  query: string,
  params: Record<string, unknown>
): string {
  // Normalize query
  const normalizedQuery = query.toLowerCase().trim().replace(/\s+/g, " ");
  
  // Sort params for determinism
  const sortedParams = Object.keys(params)
    .sort()
    .map((k) => `${k}:${JSON.stringify(params[k])}`)
    .join("|");
  
  const input = `${toolName}|${normalizedQuery}|${sortedParams}`;
  return `qc_${hashSync(input)}`;
}

/**
 * Determine TTL based on query content.
 */
export function getTTL(query: string, hasDateFilter: boolean): number {
  const q = query.toLowerCase();
  
  // Temporal queries get short TTL
  if (
    hasDateFilter ||
    q.includes("today") ||
    q.includes("this week") ||
    q.includes("latest") ||
    q.includes("recent") ||
    q.includes("news")
  ) {
    return TTL.NEWS;
  }
  
  // Funding queries
  if (
    q.includes("funding") ||
    q.includes("raised") ||
    q.includes("series") ||
    q.includes("investment")
  ) {
    return TTL.FUNDING;
  }
  
  // Background/overview queries
  if (
    q.includes("overview") ||
    q.includes("background") ||
    q.includes("history") ||
    q.includes("founded") ||
    q.includes("about")
  ) {
    return TTL.BACKGROUND;
  }
  
  return TTL.DEFAULT;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check cache for a query. Returns cached response if valid.
 */
export const getCache = internalQuery({
  args: {
    queryKey: v.string(),
  },
  returns: v.union(
    v.object({
      hit: v.literal(true),
      response: v.string(),
      ageMs: v.number(),
    }),
    v.object({
      hit: v.literal(false),
    })
  ),
  handler: async (ctx, { queryKey }) => {
    const cached = await ctx.db
      .query("globalQueryCache")
      .withIndex("by_queryKey", (q) => q.eq("queryKey", queryKey))
      .first() as Doc<"globalQueryCache"> | null;

    if (!cached) {
      return { hit: false as const };
    }

    const now = Date.now();
    const ageMs = now - cached.completedAt;
    const isExpired = ageMs > cached.ttlMs;

    if (isExpired) {
      return { hit: false as const };
    }

    return {
      hit: true as const,
      response: cached.cachedResponse,
      ageMs,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Store a response in the cache.
 */
export const setCache = internalMutation({
  args: {
    queryKey: v.string(),
    toolName: v.string(),
    response: v.string(),
    ttlMs: v.number(),
  },
  handler: async (ctx, { queryKey, toolName, response, ttlMs }) => {
    const now = Date.now();

    // Check for existing entry
    const existing = await ctx.db
      .query("globalQueryCache")
      .withIndex("by_queryKey", (q) => q.eq("queryKey", queryKey))
      .first() as Doc<"globalQueryCache"> | null;

    if (existing) {
      // Update existing
      await ctx.db.patch(existing._id, {
        cachedResponse: response,
        completedAt: now,
        ttlMs,
      });
      return { action: "updated", id: existing._id };
    }

    // Insert new
    const id = await ctx.db.insert("globalQueryCache", {
      queryKey,
      toolName,
      cachedResponse: response,
      completedAt: now,
      ttlMs,
    });

    return { action: "inserted", id };
  },
});

/**
 * Invalidate a specific cache entry.
 */
export const invalidateCache = internalMutation({
  args: {
    queryKey: v.string(),
  },
  handler: async (ctx, { queryKey }) => {
    const cached = await ctx.db
      .query("globalQueryCache")
      .withIndex("by_queryKey", (q) => q.eq("queryKey", queryKey))
      .first() as Doc<"globalQueryCache"> | null;

    if (cached) {
      await ctx.db.delete(cached._id);
      return { deleted: true };
    }

    return { deleted: false };
  },
});

/**
 * Cleanup expired cache entries (for cron).
 */
export const cleanupExpiredCache = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    deleted: v.number(),
  }),
  handler: async (ctx, { batchSize = 100 }) => {
    const now = Date.now();
    
    // Get oldest entries first
    const entries = await ctx.db
      .query("globalQueryCache")
      .withIndex("by_completedAt")
      .order("asc")
      .take(batchSize * 2) as Doc<"globalQueryCache">[]; // Overfetch since we filter

    let deleted = 0;
    for (const entry of entries) {
      const isExpired = now - entry.completedAt > entry.ttlMs;
      if (isExpired) {
        await ctx.db.delete(entry._id);
        deleted++;
        if (deleted >= batchSize) break;
      }
    }

    return { deleted };
  },
});
