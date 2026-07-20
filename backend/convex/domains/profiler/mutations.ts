/**
 * Convex mutations for the Founder Operating Profiler.
 *
 * Two write paths:
 * 1. logProfilerEvent — individual tool call / query event
 * 2. logSessionSummary — end-of-session aggregate
 *
 * These are called from the Vercel serverless search route
 * via ConvexHttpClient to persist profiler data beyond cold starts.
 */

import { mutation } from "../../_generated/server";
import { v } from "convex/values";

export const logProfilerEvent = mutation({
  args: {
    sessionId: v.string(),
    surface: v.string(),
    integrationPath: v.string(),
    toolName: v.string(),
    toolInputSummary: v.optional(v.string()),
    latencyMs: v.number(),
    estimatedCostUsd: v.number(),
    success: v.boolean(),
    isDuplicate: v.boolean(),
    modelUsed: v.optional(v.string()),
    tokenIn: v.optional(v.number()),
    tokenOut: v.optional(v.number()),
    classification: v.optional(v.string()),
    query: v.optional(v.string()),
    fingerprint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("profilerEvents", {
      ...args,
      timestamp: Date.now(),
    });
  },
});

export const logSessionSummary = mutation({
  args: {
    sessionId: v.string(),
    surface: v.string(),
    roleInferred: v.string(),
    totalCalls: v.number(),
    totalCostUsd: v.number(),
    totalLatencyMs: v.number(),
    redundantCalls: v.number(),
    uniqueTools: v.array(v.string()),
    topToolChain: v.optional(v.string()),
    classification: v.optional(v.string()),
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("profilerSessionSummaries", {
      ...args,
      timestamp: Date.now(),
    });
  },
});
