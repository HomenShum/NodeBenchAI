// convex/schema/apiUsage.ts
// Schema for tracking API usage per user

import { defineTable } from "convex/server";
import { v } from "convex/values";

export const apiUsageTable = defineTable({
  userId: v.id("users"),
  apiName: v.string(), // "linkup", "youtube", "openai", etc.
  operation: v.string(), // "search", "embed", etc.
  timestamp: v.number(),
  
  // Cost tracking
  unitsUsed: v.optional(v.number()), // API-specific units (YouTube: query units, etc.)
  estimatedCost: v.optional(v.number()), // In USD cents
  
  // Request details
  requestMetadata: v.optional(v.object({
    query: v.optional(v.string()),
    maxResults: v.optional(v.number()),
    model: v.optional(v.string()),
    tokensUsed: v.optional(v.number()),
    imageCount: v.optional(v.number()),
    videoCount: v.optional(v.number()),
  })),
  
  // Response details
  success: v.boolean(),
  errorMessage: v.optional(v.string()),
  responseTime: v.optional(v.number()), // milliseconds
})
  .index("by_user", ["userId"])
  .index("by_user_and_api", ["userId", "apiName"])
  .index("by_user_and_timestamp", ["userId", "timestamp"])
  .index("by_api_and_timestamp", ["apiName", "timestamp"]);

// Daily aggregates for faster queries
export const apiUsageDailyTable = defineTable({
  userId: v.id("users"),
  apiName: v.string(),
  date: v.string(), // YYYY-MM-DD format
  
  totalCalls: v.number(),
  successfulCalls: v.number(),
  failedCalls: v.number(),
  totalUnitsUsed: v.number(),
  totalCost: v.number(), // In USD cents
  
  // Breakdown by operation
  operationBreakdown: v.optional(v.object({
    search: v.optional(v.number()),
    embed: v.optional(v.number()),
    generate: v.optional(v.number()),
  })),
})
  .index("by_user", ["userId"])
  .index("by_user_and_date", ["userId", "date"])
  .index("by_user_api_date", ["userId", "apiName", "date"]);
