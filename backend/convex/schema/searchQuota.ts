// convex/schema/searchQuota.ts
// Schema for tracking search API quota usage (FREE-FIRST strategy)

import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Monthly quota tracking per search provider.
 * Enables FREE-FIRST strategy: exhaust free tiers before paid APIs.
 *
 * FREE TIER QUOTAS:
 * - brave: 2,000/month
 * - serper: 2,500/month
 * - tavily: 1,000/month
 * - exa: 2,000 one-time
 * - linkup: unlimited (pay per use)
 */
export const searchQuotaUsageTable = defineTable({
  provider: v.string(), // "brave" | "serper" | "tavily" | "exa" | "linkup"
  monthKey: v.string(), // "2026-01" format for monthly reset

  // Usage counts
  usedQueries: v.number(),
  successfulQueries: v.optional(v.number()),
  failedQueries: v.optional(v.number()),

  // Timestamps
  lastUsedAt: v.optional(v.number()),

  // Performance metrics
  totalResponseTimeMs: v.optional(v.number()),
})
  .index("by_provider", ["provider"])
  .index("by_provider_month", ["provider", "monthKey"])
  .index("by_month", ["monthKey"]);
