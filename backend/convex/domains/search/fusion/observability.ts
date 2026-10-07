/**
 * Search Fusion Observability
 * 
 * Mutations and queries for persisting and analyzing search run data.
 * Tracks per-source timing, errors, result counts, and fused result IDs.
 * 
 * @module search/fusion/observability
 */

import { mutation, query, internalMutation } from "../../../_generated/server";
import { v } from "convex/values";
import type { Id } from "../../../_generated/dataModel";
import type { SearchResponse, SearchSource } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface PersistSearchRunInput {
  userId?: Id<"users">;
  threadId?: string;
  query: string;
  response: SearchResponse;
  cacheHit?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Persist a search run and its per-source results.
 * Called after each fusion search completes.
 */
export const persistSearchRun = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    threadId: v.optional(v.string()),
    query: v.string(),
    mode: v.string(),
    sourcesRequested: v.array(v.string()),
    sourcesQueried: v.array(v.string()),
    totalResults: v.number(),
    totalBeforeFusion: v.number(),
    reranked: v.boolean(),
    totalTimeMs: v.number(),
    cacheHit: v.optional(v.boolean()),
    fusedResultIds: v.optional(v.array(v.string())),
    // Per-source data
    sourceResults: v.array(v.object({
      source: v.string(),
      latencyMs: v.number(),
      resultCount: v.number(),
      success: v.boolean(),
      errorMessage: v.optional(v.string()),
      resultIds: v.optional(v.array(v.string())),
    })),
  },
  handler: async (ctx, args) => {
    const timestamp = Date.now();
    
    // Create the main search run record
    const searchRunId = await ctx.db.insert("searchRuns", {
      userId: args.userId,
      threadId: args.threadId,
      query: args.query,
      mode: args.mode,
      sourcesRequested: args.sourcesRequested,
      sourcesQueried: args.sourcesQueried,
      totalResults: args.totalResults,
      totalBeforeFusion: args.totalBeforeFusion,
      reranked: args.reranked,
      totalTimeMs: args.totalTimeMs,
      cacheHit: args.cacheHit,
      timestamp,
      fusedResultIds: args.fusedResultIds,
    });
    
    // Create per-source result records
    for (const sourceResult of args.sourceResults) {
      await ctx.db.insert("searchRunResults", {
        searchRunId,
        source: sourceResult.source,
        latencyMs: sourceResult.latencyMs,
        resultCount: sourceResult.resultCount,
        success: sourceResult.success,
        errorMessage: sourceResult.errorMessage,
        resultIds: sourceResult.resultIds,
      });
    }
    
    return searchRunId;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get recent search runs for a user.
 */
export const getRecentSearchRuns = query({
  args: {
    userId: v.optional(v.id("users")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    
    if (args.userId) {
      return await ctx.db
        .query("searchRuns")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .order("desc")
        .take(limit);
    }
    
    return await ctx.db
      .query("searchRuns")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit);
  },
});

/**
 * Get per-source results for a specific search run.
 */
export const getSearchRunResults = query({
  args: { searchRunId: v.id("searchRuns") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("searchRunResults")
      .withIndex("by_search_run", (q) => q.eq("searchRunId", args.searchRunId))
      .collect();
  },
});

/**
 * Get search performance analytics by source.
 */
export const getSourceAnalytics = query({
  args: {
    source: v.optional(v.string()),
    since: v.optional(v.number()), // timestamp
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    const since = args.since ?? Date.now() - 24 * 60 * 60 * 1000; // Last 24h
    
    let results;
    if (args.source) {
      const sourceFilter = args.source; // Capture to satisfy TS narrowing
      results = await ctx.db
        .query("searchRunResults")
        .withIndex("by_source", (q) => q.eq("source", sourceFilter))
        .take(limit);
    } else {
      results = await ctx.db.query("searchRunResults").take(limit);
    }
    // Compute analytics per source
    const analytics: Record<string, { count: number; avgLatency: number; successRate: number; totalResults: number }> = {};
    for (const r of results) {
      if (!analytics[r.source]) analytics[r.source] = { count: 0, avgLatency: 0, successRate: 0, totalResults: 0 };
      analytics[r.source].count++;
      analytics[r.source].avgLatency += r.latencyMs;
      analytics[r.source].successRate += r.success ? 1 : 0;
      analytics[r.source].totalResults += r.resultCount;
    }
    // Finalize averages
    for (const source of Object.keys(analytics)) {
      const a = analytics[source];
      a.avgLatency = Math.round(a.avgLatency / a.count);
      a.successRate = Math.round((a.successRate / a.count) * 100);
    }
    return analytics;
  },
});

