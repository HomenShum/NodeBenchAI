/**
 * Hybrid Search Queries and Mutations
 *
 * Contains database operations for hybrid search that run in the Convex runtime.
 * Actions that require Node.js (OpenAI, crypto) are in hybridSearch.ts
 */

import { v } from "convex/values";
import { query, internalQuery, internalMutation } from "../../_generated/server";
import { Doc } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Cache TTL in milliseconds (1 hour) */
const CACHE_TTL_MS = 3600000;

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface CachedSearchResult {
  toolName: string;
  score: number;
  matchType: "keyword" | "semantic" | "hybrid";
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a deterministic hash for cache lookup
 * Uses a simple string hash that works in Convex runtime (no Node.js crypto)
 */
function generateCacheKey(queryStr: string, category?: string): string {
  const normalized = `${queryStr.toLowerCase().trim()}|${category || ""}`;
  // Simple hash function (djb2 algorithm)
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash) + normalized.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Get cached search results if available and not expired
 */
export const getCachedSearchResults = internalQuery({
  args: {
    query: v.string(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    hit: boolean;
    results?: CachedSearchResult[];
    age?: number;
  }> => {
    const queryHash = generateCacheKey(args.query, args.category);
    const now = Date.now();

    const cached = await ctx.db
      .query("toolSearchCache")
      .withIndex("by_hash", (q) => q.eq("queryHash", queryHash))
      .first() as Doc<"toolSearchCache"> | null;

    if (!cached) {
      return { hit: false };
    }

    if (cached.expiresAt < now) {
      return { hit: false };
    }

    return {
      hit: true,
      results: cached.results as CachedSearchResult[],
      age: now - (cached.expiresAt - CACHE_TTL_MS),
    };
  },
});

/**
 * Store search results in cache
 */
export const setCachedSearchResults = internalMutation({
  args: {
    query: v.string(),
    category: v.optional(v.string()),
    results: v.array(v.object({
      toolName: v.string(),
      score: v.number(),
      matchType: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const queryHash = generateCacheKey(args.query, args.category);
    const now = Date.now();
    const expiresAt = now + CACHE_TTL_MS;

    const existing = await ctx.db
      .query("toolSearchCache")
      .withIndex("by_hash", (q) => q.eq("queryHash", queryHash))
      .first() as Doc<"toolSearchCache"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        results: args.results,
        expiresAt,
      });
    } else {
      await ctx.db.insert("toolSearchCache", {
        queryHash,
        queryText: args.query,
        category: args.category,
        results: args.results,
        expiresAt,
      });
    }

    return { cached: true, expiresAt };
  },
});

/**
 * Remove expired cache entries
 */
export const invalidateExpiredCache = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let deleted = 0;

    const expired = await ctx.db
      .query("toolSearchCache")
      .withIndex("by_expiry")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();

    for (const entry of expired) {
      await ctx.db.delete(entry._id);
      deleted++;
    }

    return { deleted, timestamp: now };
  },
});

/**
 * Get cache statistics
 */
export const getToolSearchCacheStats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const allEntries = await ctx.db.query("toolSearchCache").collect();

    const valid = allEntries.filter((e) => e.expiresAt > now);
    const expired = allEntries.filter((e) => e.expiresAt <= now);

    const ages = valid.map((e) => now - (e.expiresAt - CACHE_TTL_MS));
    const avgAge = ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 0;

    const queries = valid.map((e) => e.queryText);

    return {
      totalEntries: allEntries.length,
      validEntries: valid.length,
      expiredEntries: expired.length,
      avgAgeMs: Math.round(avgAge),
      avgAgeMinutes: Math.round(avgAge / 60000),
      recentQueries: queries.slice(0, 10),
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// KEYWORD SEARCH (BM25 via Convex searchIndex)
// ═══════════════════════════════════════════════════════════════════════════

export const keywordSearchTools = internalQuery({
  args: {
    query: v.string(),
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { query: queryStr, category, limit = 20 } = args;

    // Search description field
    const descriptionQuery = ctx.db
      .query("toolRegistry")
      .withSearchIndex("search_description", (q) => {
        const search = q.search("description", queryStr);
        return category ? search.eq("category", category) : search;
      });

    const descResults = await descriptionQuery.take(limit);

    // Search keywords field
    const keywordsQuery = ctx.db
      .query("toolRegistry")
      .withSearchIndex("search_keywords", (q) => {
        const search = q.search("keywordsText", queryStr);
        return category ? search.eq("category", category) : search;
      });

    const keywordResults = await keywordsQuery.take(limit);

    // Merge and deduplicate results
    const seen = new Set<string>();
    const merged: Array<{
      toolName: string;
      description: string;
      category: string;
      categoryName: string;
      usageCount: number;
      rank: number;
    }> = [];

    // Add description results first (higher priority)
    for (let i = 0; i < descResults.length; i++) {
      const doc = descResults[i];
      if (!seen.has(doc.toolName)) {
        seen.add(doc.toolName);
        merged.push({
          toolName: doc.toolName,
          description: doc.description,
          category: doc.category,
          categoryName: doc.categoryName,
          usageCount: doc.usageCount,
          rank: i + 1,
        });
      }
    }

    // Add keyword results
    for (let i = 0; i < keywordResults.length; i++) {
      const doc = keywordResults[i];
      if (!seen.has(doc.toolName)) {
        seen.add(doc.toolName);
        merged.push({
          toolName: doc.toolName,
          description: doc.description,
          category: doc.category,
          categoryName: doc.categoryName,
          usageCount: doc.usageCount,
          rank: descResults.length + i + 1,
        });
      }
    }

    return merged.slice(0, limit);
  },
});

/**
 * Clear all cache entries (admin operation)
 */
export const clearToolSearchCache = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allEntries = await ctx.db.query("toolSearchCache").collect();

    for (const entry of allEntries) {
      await ctx.db.delete(entry._id);
    }

    return { cleared: allEntries.length };
  },
});

// NOTE: semanticSearchTools has been moved to hybridSearch.ts as an action
// because vectorSearch is only available in actions, not queries

/**
 * Get tool by ID (internal helper for vector search results)
 */
export const getToolByIdInternal = internalQuery({
  args: {
    toolId: v.id("toolRegistry"),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.toolId) as Doc<"toolRegistry"> | null;
    if (!doc) return null;
    return {
      toolName: doc.toolName,
      description: doc.description,
      category: doc.category,
      categoryName: doc.categoryName,
      usageCount: doc.usageCount,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// USAGE TRACKING
// ═══════════════════════════════════════════════════════════════════════════

export const recordToolUsage = internalMutation({
  args: {
    toolName: v.string(),
    queryText: v.string(),
    wasSuccessful: v.boolean(),
    executionTimeMs: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Record usage event (schema uses wasSuccessful, executionTimeMs, queryText)
    await ctx.db.insert("toolUsage", {
      toolName: args.toolName,
      queryText: args.queryText,
      wasSuccessful: args.wasSuccessful,
      executionTimeMs: args.executionTimeMs,
      errorMessage: args.errorMessage,
    });

    // Update tool's usage count
    const tool = await ctx.db
      .query("toolRegistry")
      .withIndex("by_toolName", (q) => q.eq("toolName", args.toolName))
      .first() as Doc<"toolRegistry"> | null;

    if (tool) {
      await ctx.db.patch(tool._id, {
        usageCount: tool.usageCount + 1,
      });
    }

    return { recorded: true };
  },
});

export const getToolUsageStats = internalQuery({
  args: {
    toolName: v.string(),
    sinceDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { toolName, sinceDays = 7 } = args;
    const since = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

    // Use by_tool index and filter by _creationTime
    const usages = await ctx.db
      .query("toolUsage")
      .withIndex("by_tool", (q) => q.eq("toolName", toolName))
      .filter((q) => q.gte(q.field("_creationTime"), since))
      .collect();

    const successful = usages.filter((u) => u.wasSuccessful);
    const failed = usages.filter((u) => !u.wasSuccessful);

    const durations = successful
      .filter((u) => u.executionTimeMs !== undefined)
      .map((u) => u.executionTimeMs!);

    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    return {
      totalCalls: usages.length,
      successCount: successful.length,
      failureCount: failed.length,
      successRate: usages.length > 0 ? successful.length / usages.length : 0,
      avgDurationMs: Math.round(avgDuration),
      recentErrors: failed.slice(-5).map((u) => u.errorMessage),
    };
  },
});
