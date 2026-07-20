// convex/searchCache.ts - Global search result caching with versioning
import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import { Doc } from "../../_generated/dataModel";

// Maximum number of versions to keep (prevent unbounded array growth)
const MAX_VERSIONS = 30;
// Maximum search results to return (prevent scanning too many records)
const MAX_SEARCH_RESULTS = 50;

/**
 * Get cached search result by prompt
 * Optimized: Uses index for O(1) lookup
 */
export const getCachedSearch = query({
    args: { prompt: v.string() },
    handler: async (ctx, { prompt }) => {
        const normalized = prompt.trim().toLowerCase();
        return await ctx.db
            .query("searchCache")
            .withIndex("by_prompt", (q) => q.eq("prompt", normalized))
            .first() as Doc<"searchCache"> | null;
    }
});

/**
 * Save or update a search result
 * Optimized: Conditional logic to avoid unnecessary queries
 */
export const saveSearchResult = mutation({
    args: {
        prompt: v.string(),
        threadId: v.string(),
        isUpdate: v.boolean(),
        summary: v.optional(v.string())
    },
    handler: async (ctx, { prompt, threadId, isUpdate, summary }) => {
        const normalized = prompt.trim().toLowerCase();
        const existing = await ctx.db
            .query("searchCache")
            .withIndex("by_prompt", (q) => q.eq("prompt", normalized))
            .first() as Doc<"searchCache"> | null;

        const today = new Date().toISOString().split('T')[0];
        const now = Date.now();

        if (existing && isUpdate) {
            // Append new version (keep only last MAX_VERSIONS)
            const newVersion = {
                date: today,
                threadId,
                summary: summary || "Latest updates",
                timestamp: now
            };

            // Keep only the most recent versions to prevent unbounded growth
            const updatedVersions = [...existing.versions, newVersion].slice(-MAX_VERSIONS);

            await ctx.db.patch(existing._id, {
                threadId,
                lastUpdated: now,
                searchCount: existing.searchCount + 1,
                versions: updatedVersions
            });
            return existing._id;
        } else if (!existing) {
            // Create new cache entry
            const newId = await ctx.db.insert("searchCache", {
                prompt: normalized,
                threadId,
                lastUpdated: now,
                searchCount: 1,
                isPublic: true, // All searches are public by default
                createdAt: now,
                versions: [{
                    date: today,
                    threadId,
                    summary: summary || "Initial search",
                    timestamp: now
                }]
            });
            return newId;
        } else {
            // Same-day hit, just increment count (optimized: minimal patch)
            await ctx.db.patch(existing._id, {
                searchCount: existing.searchCount + 1,
                lastUpdated: now
            });
            return existing._id;
        }
    }
});

/**
 * Get popular searches for landing page showcase
 * Optimized: Hard limit to prevent scanning too many records
 */
export const getPopularSearches = query({
    args: { limit: v.optional(v.number()) },
    handler: async (ctx, { limit }) => {
        // Enforce maximum limit for performance
        const safeLimit = Math.min(limit ?? 10, MAX_SEARCH_RESULTS);

        return await ctx.db
            .query("searchCache")
            .withIndex("by_public", (q) => q.eq("isPublic", true))
            .order("desc")
            .take(safeLimit);
    }
});

/**
 * Get recent searches
 * Optimized: Hard limit to prevent scanning too many records
 */
export const getRecentSearches = query({
    args: { limit: v.optional(v.number()) },
    handler: async (ctx, { limit }) => {
        // Enforce maximum limit for performance
        const safeLimit = Math.min(limit ?? 10, MAX_SEARCH_RESULTS);

        return await ctx.db
            .query("searchCache")
            .withIndex("by_updated")
            .order("desc")
            .take(safeLimit);
    }
});

/**
 * Check if cache is stale (older than 24 hours)
 * Optimized: Returns only essential fields to minimize data transfer
 */
export const isCacheStale = query({
    args: { prompt: v.string() },
    handler: async (ctx, { prompt }) => {
        const normalized = prompt.trim().toLowerCase();
        const cached = await ctx.db
            .query("searchCache")
            .withIndex("by_prompt", (q) => q.eq("prompt", normalized))
            .first() as Doc<"searchCache"> | null;

        if (!cached) {
            return { exists: false, isStale: false };
        }

        const ageHours = (Date.now() - cached.lastUpdated) / (1000 * 60 * 60);
        return {
            exists: true,
            isStale: ageHours >= 24,
            ageHours,
            threadId: cached.threadId,
            // Only return last 5 versions to minimize data transfer
            versions: cached.versions.slice(-5)
        };
    }
});
