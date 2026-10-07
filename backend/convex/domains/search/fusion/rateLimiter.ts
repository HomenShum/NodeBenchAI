/**
 * Rate Limiter for Search Fusion
 * 
 * Implements token bucket rate limiting for:
 * - Per-user rate limiting (max searches per minute)
 * - Per-provider rate limiting (prevent API abuse)
 * - Thread-level concurrency control
 * 
 * @module search/fusion/rateLimiter
 */

import { internalMutation, internalQuery } from "../../../_generated/server";
import { v } from "convex/values";
import type { Id } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMIT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export const RATE_LIMITS = {
  // Per-user limits
  user: {
    maxRequestsPerMinute: 10,
    maxRequestsPerHour: 100,
    maxConcurrentSearches: 3,
  },
  // Per-provider limits (to prevent API abuse)
  provider: {
    brave: { maxRequestsPerMinute: 20 },
    serper: { maxRequestsPerMinute: 20 },
    tavily: { maxRequestsPerMinute: 20 },
    exa: { maxRequestsPerMinute: 20 },
    linkup: { maxRequestsPerMinute: 30 },
    sec: { maxRequestsPerMinute: 20 },
    youtube: { maxRequestsPerMinute: 50 },
    arxiv: { maxRequestsPerMinute: 30 },
    news: { maxRequestsPerMinute: 30 },
    rag: { maxRequestsPerMinute: 100 }, // Internal, higher limit
    documents: { maxRequestsPerMinute: 100 }, // Internal, higher limit
  },
  // Thread-level limits
  thread: {
    maxConcurrentSearches: 3,
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMIT CHECK (Query)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a user can perform a search (rate limit check).
 * Returns { allowed: true } or { allowed: false, retryAfterMs, reason }.
 */
export const checkRateLimit = internalQuery({
  args: {
    userId: v.optional(v.id("users")),
    threadId: v.optional(v.string()),
    sources: v.array(v.string()),
  },
  returns: v.object({
    allowed: v.boolean(),
    retryAfterMs: v.optional(v.number()),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;

    // Check user rate limit
    if (args.userId) {
      const recentUserSearches = await ctx.db
        .query("searchRuns")
        .withIndex("by_user_timestamp", (q) =>
          q.eq("userId", args.userId).gte("timestamp", oneMinuteAgo)
        )
        .collect();

      if (recentUserSearches.length >= RATE_LIMITS.user.maxRequestsPerMinute) {
        const oldestSearch = recentUserSearches[0];
        const retryAfterMs = oldestSearch.timestamp + 60 * 1000 - now;
        return {
          allowed: false,
          retryAfterMs: Math.max(0, retryAfterMs),
          reason: `Rate limit exceeded: max ${RATE_LIMITS.user.maxRequestsPerMinute} searches per minute`,
        };
      }

      // Check hourly limit
      const hourlySearches = await ctx.db
        .query("searchRuns")
        .withIndex("by_user_timestamp", (q) =>
          q.eq("userId", args.userId).gte("timestamp", oneHourAgo)
        )
        .collect();

      if (hourlySearches.length >= RATE_LIMITS.user.maxRequestsPerHour) {
        const oldestSearch = hourlySearches[0];
        const retryAfterMs = oldestSearch.timestamp + 60 * 60 * 1000 - now;
        return {
          allowed: false,
          retryAfterMs: Math.max(0, retryAfterMs),
          reason: `Rate limit exceeded: max ${RATE_LIMITS.user.maxRequestsPerHour} searches per hour`,
        };
      }
    }

    // Check thread concurrency
    if (args.threadId) {
      // Count in-flight searches for this thread (searches started in last 30s without completion)
      const recentThreadSearches = await ctx.db
        .query("searchRuns")
        .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
        .filter((q) => q.gte(q.field("timestamp"), now - 30 * 1000))
        .collect();

      if (recentThreadSearches.length >= RATE_LIMITS.thread.maxConcurrentSearches) {
        return {
          allowed: false,
          retryAfterMs: 5000, // Retry in 5 seconds
          reason: `Concurrency limit: max ${RATE_LIMITS.thread.maxConcurrentSearches} concurrent searches per thread`,
        };
      }
    }

    // All checks passed
    return { allowed: true };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDER RATE LIMIT CHECK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a specific provider can be queried (provider-level rate limit).
 */
export const checkProviderRateLimit = internalQuery({
  args: {
    source: v.string(),
  },
  returns: v.object({
    allowed: v.boolean(),
    retryAfterMs: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const source = args.source as keyof typeof RATE_LIMITS.provider;
    const limit = RATE_LIMITS.provider[source]?.maxRequestsPerMinute ?? 30;

    // Count recent requests to this provider (use _creationTime since no timestamp field)
    const recentProviderRequests = await ctx.db
      .query("searchRunResults")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .filter((q) => q.gte(q.field("_creationTime"), oneMinuteAgo))
      .collect();

    if (recentProviderRequests.length >= limit) {
      const oldest = recentProviderRequests[0];
      const retryAfterMs = oldest._creationTime + 60 * 1000 - now;
      return {
        allowed: false,
        retryAfterMs: Math.max(0, retryAfterMs),
      };
    }

    return { allowed: true };
  },
});
