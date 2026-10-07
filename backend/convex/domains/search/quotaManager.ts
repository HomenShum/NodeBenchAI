/**
 * Search Quota Manager
 *
 * Tracks usage across FREE-tier search APIs and manages fallback.
 * Enables FREE-FIRST strategy: exhaust free tiers before paid APIs.
 *
 * FREE TIER QUOTAS (Monthly):
 * - Brave Search: 2,000 queries/month
 * - Serper: 2,500 queries/month
 * - Tavily: 1,000 credits/month
 * - Exa AI: 2,000 one-time (not monthly reset)
 * - Linkup: Pay per use (fallback)
 *
 * @module search/quotaManager
 */

import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// QUOTA CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export type SearchProvider = "brave" | "serper" | "tavily" | "exa" | "linkup";

interface ProviderQuota {
  monthlyLimit: number;
  resetType: "monthly" | "one-time" | "unlimited";
  costPerQuery: number; // In cents, 0 for free tier
  priority: number; // Lower = higher priority (use first)
}

export const PROVIDER_QUOTAS: Record<SearchProvider, ProviderQuota> = {
  brave: {
    monthlyLimit: 2000,
    resetType: "monthly",
    costPerQuery: 0,
    priority: 1,
  },
  serper: {
    monthlyLimit: 2500,
    resetType: "monthly",
    costPerQuery: 0,
    priority: 2,
  },
  tavily: {
    monthlyLimit: 1000,
    resetType: "monthly",
    costPerQuery: 0,
    priority: 3,
  },
  exa: {
    monthlyLimit: 2000,
    resetType: "one-time",
    costPerQuery: 0,
    priority: 4,
  },
  linkup: {
    monthlyLimit: -1, // Unlimited (pay per use)
    resetType: "unlimited",
    costPerQuery: 55, // ~€0.55 = 55 cents
    priority: 5,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// QUOTA STATE QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get current month's usage for a provider.
 */
export const getProviderUsage = query({
  args: {
    provider: v.string(),
  },
  handler: async (ctx, args) => {
    const provider = args.provider as SearchProvider;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

    const usage = await ctx.db
      .query("searchQuotaUsage")
      .withIndex("by_provider_month", (q) =>
        q.eq("provider", provider).eq("monthKey", monthStart)
      )
      .first() as Doc<"searchQuotaUsage"> | null;

    const quota = PROVIDER_QUOTAS[provider];
    const usedQueries = usage?.usedQueries || 0;
    const remaining = quota.monthlyLimit === -1 ? Infinity : quota.monthlyLimit - usedQueries;

    return {
      provider,
      usedQueries,
      monthlyLimit: quota.monthlyLimit,
      remaining,
      percentUsed: quota.monthlyLimit === -1 ? 0 : (usedQueries / quota.monthlyLimit) * 100,
      resetType: quota.resetType,
      monthKey: monthStart,
    };
  },
});

/**
 * Get usage summary for all providers.
 */
export const getAllProvidersUsage = query({
  args: {},
  handler: async (ctx) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

    const providers: SearchProvider[] = ["brave", "serper", "tavily", "exa", "linkup"];
    const results: Array<{
      provider: SearchProvider;
      usedQueries: number;
      monthlyLimit: number;
      remaining: number;
      percentUsed: number;
      costPerQuery: number;
      isFree: boolean;
      priority: number;
    }> = [];

    for (const provider of providers) {
      const usage = await ctx.db
        .query("searchQuotaUsage")
        .withIndex("by_provider_month", (q) =>
          q.eq("provider", provider).eq("monthKey", monthStart)
        )
        .first() as Doc<"searchQuotaUsage"> | null;

      const quota = PROVIDER_QUOTAS[provider];
      const usedQueries = usage?.usedQueries || 0;
      const remaining = quota.monthlyLimit === -1 ? Infinity : quota.monthlyLimit - usedQueries;

      results.push({
        provider,
        usedQueries,
        monthlyLimit: quota.monthlyLimit,
        remaining,
        percentUsed: quota.monthlyLimit === -1 ? 0 : (usedQueries / quota.monthlyLimit) * 100,
        costPerQuery: quota.costPerQuery,
        isFree: quota.costPerQuery === 0,
        priority: quota.priority,
      });
    }

    // Sort by priority (free providers first)
    return results.sort((a, b) => a.priority - b.priority);
  },
});

/**
 * Get next available FREE provider (for FREE-FIRST strategy).
 */
export const getNextFreeProvider = internalQuery({
  args: {},
  handler: async (ctx): Promise<SearchProvider | null> => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

    // Check providers in priority order
    const freeProviders: SearchProvider[] = ["brave", "serper", "tavily", "exa"];

    for (const provider of freeProviders) {
      const quota = PROVIDER_QUOTAS[provider];

      const usage = await ctx.db
        .query("searchQuotaUsage")
        .withIndex("by_provider_month", (q) =>
          q.eq("provider", provider).eq("monthKey", monthStart)
        )
        .first() as Doc<"searchQuotaUsage"> | null;

      const usedQueries = usage?.usedQueries || 0;
      const remaining = quota.monthlyLimit - usedQueries;

      if (remaining > 0) {
        return provider;
      }
    }

    // All free providers exhausted, return null (caller should use paid)
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUOTA TRACKING MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Increment usage count for a provider.
 */
export const trackSearchUsage = internalMutation({
  args: {
    provider: v.string(),
    queries: v.optional(v.number()),
    success: v.boolean(),
    responseTimeMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const provider = args.provider as SearchProvider;
    const queries = args.queries || 1;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

    // Find or create usage record
    const existing = await ctx.db
      .query("searchQuotaUsage")
      .withIndex("by_provider_month", (q) =>
        q.eq("provider", provider).eq("monthKey", monthStart)
      )
      .first() as Doc<"searchQuotaUsage"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        usedQueries: existing.usedQueries + queries,
        successfulQueries: args.success
          ? (existing.successfulQueries || 0) + queries
          : existing.successfulQueries || 0,
        failedQueries: !args.success
          ? (existing.failedQueries || 0) + queries
          : existing.failedQueries || 0,
        lastUsedAt: Date.now(),
        totalResponseTimeMs: (existing.totalResponseTimeMs || 0) + (args.responseTimeMs || 0),
      });
    } else {
      await ctx.db.insert("searchQuotaUsage", {
        provider,
        monthKey: monthStart,
        usedQueries: queries,
        successfulQueries: args.success ? queries : 0,
        failedQueries: !args.success ? queries : 0,
        lastUsedAt: Date.now(),
        totalResponseTimeMs: args.responseTimeMs || 0,
      });
    }
  },
});

/**
 * Reset usage for a provider (for testing or manual reset).
 */
export const resetProviderUsage = mutation({
  args: {
    provider: v.string(),
  },
  handler: async (ctx, args) => {
    const provider = args.provider as SearchProvider;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

    const existing = await ctx.db
      .query("searchQuotaUsage")
      .withIndex("by_provider_month", (q) =>
        q.eq("provider", provider).eq("monthKey", monthStart)
      )
      .first() as Doc<"searchQuotaUsage"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        usedQueries: 0,
        successfulQueries: 0,
        failedQueries: 0,
        totalResponseTimeMs: 0,
      });
    }

    return { reset: true, provider, monthKey: monthStart };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: FREE-FIRST PROVIDER SELECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get ordered list of providers to try (FREE-FIRST strategy).
 * Returns providers sorted by: free tier remaining > priority > cost.
 */
export const getProviderPriorityList = internalQuery({
  args: {},
  handler: async (ctx): Promise<SearchProvider[]> => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

    const providers: SearchProvider[] = ["brave", "serper", "tavily", "exa", "linkup"];
    const providerStats: Array<{
      provider: SearchProvider;
      remaining: number;
      priority: number;
      isFree: boolean;
    }> = [];

    for (const provider of providers) {
      const quota = PROVIDER_QUOTAS[provider];

      const usage = await ctx.db
        .query("searchQuotaUsage")
        .withIndex("by_provider_month", (q) =>
          q.eq("provider", provider).eq("monthKey", monthStart)
        )
        .first() as Doc<"searchQuotaUsage"> | null;

      const usedQueries = usage?.usedQueries || 0;
      const remaining = quota.monthlyLimit === -1 ? Infinity : quota.monthlyLimit - usedQueries;

      providerStats.push({
        provider,
        remaining,
        priority: quota.priority,
        isFree: quota.costPerQuery === 0,
      });
    }

    // Sort: free providers with remaining quota first, then by priority
    return providerStats
      .filter((p) => p.remaining > 0 || !p.isFree) // Include if has quota OR is paid
      .sort((a, b) => {
        // Free with quota first
        if (a.isFree && a.remaining > 0 && (!b.isFree || b.remaining <= 0)) return -1;
        if (b.isFree && b.remaining > 0 && (!a.isFree || a.remaining <= 0)) return 1;

        // Then by priority
        return a.priority - b.priority;
      })
      .map((p) => p.provider);
  },
});
