/**
 * Trace Persistence and Querying
 *
 * Stores OpenTelemetry traces in Convex for:
 * - Historical analysis
 * - Cost tracking
 * - Performance monitoring
 * - Debugging production issues
 * - Export to external platforms (Langfuse, Datadog)
 */

import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Trace, AggregatedMetrics } from "./telemetry";
import { aggregateTraces } from "./telemetry";

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA (Add to convex/schema.ts)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * traces table:
 *   traceId: string (indexed)
 *   name: string (indexed) - e.g., "swarm_execution", "workflow_daily_brief"
 *   startTime: number (indexed)
 *   endTime?: number
 *   status: string ("running" | "completed" | "error")
 *   userId?: string (indexed)
 *   sessionId?: string (indexed)
 *   tags: string[] (indexed)
 *   metadata: object
 *   spans: array of spans
 *   totalCost?: number
 *   totalTokens?: number
 *   error?: string
 *   createdAt: number
 */

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS - Save Traces
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Save trace to database (called at end of operation)
 */
export const saveTrace = internalMutation({
  args: {
    trace: v.object({
      traceId: v.string(),
      name: v.string(),
      startTime: v.number(),
      endTime: v.optional(v.number()),
      level: v.union(
        v.literal("DEBUG"),
        v.literal("INFO"),
        v.literal("WARNING"),
        v.literal("ERROR")
      ),
      metadata: v.object({
        userId: v.optional(v.string()),
        sessionId: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
        metadata: v.optional(v.any()),
      }),
      spans: v.array(v.any()), // Full span objects
      totalCost: v.optional(v.number()),
      totalTokens: v.optional(v.number()),
      status: v.union(v.literal("running"), v.literal("completed"), v.literal("error")),
      error: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const traceId = await ctx.db.insert("traces", {
      ...args.trace,
      createdAt: Date.now(),
    });

    // Optionally export to external platform
    // await ctx.scheduler.runAfter(0, internal.observability.exportToLangfuse, { traceId });

    return traceId;
  },
});

/**
 * Update existing trace (for long-running operations)
 */
export const updateTrace = internalMutation({
  args: {
    traceId: v.string(),
    updates: v.object({
      endTime: v.optional(v.number()),
      status: v.optional(v.union(v.literal("running"), v.literal("completed"), v.literal("error"))),
      totalCost: v.optional(v.number()),
      totalTokens: v.optional(v.number()),
      error: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const trace = await ctx.db
      .query("traces")
      .withIndex("by_trace_id", (q) => q.eq("traceId", args.traceId))
      .first();

    if (!trace) {
      throw new Error(`Trace ${args.traceId} not found`);
    }

    await ctx.db.patch(trace._id, args.updates);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES - Retrieve Traces
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get trace by ID
 */
export const getTrace = query({
  args: { traceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("traces")
      .withIndex("by_trace_id", (q) => q.eq("traceId", args.traceId))
      .first();
  },
});

/**
 * List recent traces (for dashboard)
 */
export const listRecentTraces = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(v.union(v.literal("running"), v.literal("completed"), v.literal("error"))),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    let query = ctx.db.query("traces").withIndex("by_start_time").order("desc");

    const traces = await query.take(limit * 2); // Over-fetch for filtering

    // Filter by status and userId
    let filtered = traces;
    if (args.status) {
      filtered = filtered.filter((t) => t.status === args.status);
    }
    if (args.userId) {
      filtered = filtered.filter((t) => t.metadata.userId === args.userId);
    }

    return filtered.slice(0, limit);
  },
});

/**
 * Get traces by session (for conversation view)
 */
export const getTracesBySession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("traces")
      .withIndex("by_session_id", (q) => q.eq("metadata.sessionId", args.sessionId))
      .order("asc")
      .collect();
  },
});

/**
 * Search traces by name/tags
 */
export const searchTraces = query({
  args: {
    name: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    startTimeFrom: v.optional(v.number()),
    startTimeTo: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 100;

    let query = ctx.db.query("traces");

    // Filter by name
    if (args.name) {
      query = query.withIndex("by_name", (q) => q.eq("name", args.name));
    } else {
      query = query.withIndex("by_start_time");
    }

    let traces = await query.take(limit * 2);

    // Filter by time range
    if (args.startTimeFrom) {
      traces = traces.filter((t) => t.startTime >= args.startTimeFrom!);
    }
    if (args.startTimeTo) {
      traces = traces.filter((t) => t.startTime <= args.startTimeTo!);
    }

    // Filter by tags (any tag matches)
    if (args.tags && args.tags.length > 0) {
      traces = traces.filter((t) =>
        t.metadata.tags?.some((tag) => args.tags!.includes(tag))
      );
    }

    return traces.slice(0, limit);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// ANALYTICS QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get aggregated metrics for time period
 */
export const getAggregatedMetrics = query({
  args: {
    startTime: v.number(),
    endTime: v.number(),
    groupBy: v.optional(v.union(v.literal("hour"), v.literal("day"), v.literal("week"))),
  },
  handler: async (ctx, args) => {
    const traces = await ctx.db
      .query("traces")
      .withIndex("by_start_time")
      .filter((q) =>
        q.and(
          q.gte(q.field("startTime"), args.startTime),
          q.lte(q.field("startTime"), args.endTime)
        )
      )
      .collect();

    return aggregateTraces(traces as any[]);
  },
});

/**
 * Get cost breakdown by model
 */
export const getCostByModel = query({
  args: {
    startTime: v.number(),
    endTime: v.number(),
  },
  handler: async (ctx, args) => {
    const traces = await ctx.db
      .query("traces")
      .withIndex("by_start_time")
      .filter((q) =>
        q.and(
          q.gte(q.field("startTime"), args.startTime),
          q.lte(q.field("startTime"), args.endTime)
        )
      )
      .collect();

    const costByModel: Record<string, { cost: number; requests: number; tokens: number }> = {};

    for (const trace of traces) {
      for (const span of trace.spans) {
        const model = span.attributes["llm.model"];
        const cost = span.attributes["llm.cost.total"] || 0;
        const tokens = span.attributes["llm.usage.total_tokens"] || 0;

        if (model) {
          if (!costByModel[model]) {
            costByModel[model] = { cost: 0, requests: 0, tokens: 0 };
          }
          costByModel[model].cost += cost;
          costByModel[model].requests += 1;
          costByModel[model].tokens += tokens;
        }
      }
    }

    return Object.entries(costByModel)
      .map(([model, stats]) => ({
        model,
        ...stats,
        avgCostPerRequest: stats.cost / stats.requests,
      }))
      .sort((a, b) => b.cost - a.cost);
  },
});

/**
 * Get cost breakdown by user
 */
export const getCostByUser = query({
  args: {
    startTime: v.number(),
    endTime: v.number(),
  },
  handler: async (ctx, args) => {
    const traces = await ctx.db
      .query("traces")
      .withIndex("by_start_time")
      .filter((q) =>
        q.and(
          q.gte(q.field("startTime"), args.startTime),
          q.lte(q.field("startTime"), args.endTime)
        )
      )
      .collect();

    const costByUser: Record<string, { cost: number; requests: number; tokens: number }> = {};

    for (const trace of traces) {
      const userId = trace.metadata.userId || "anonymous";
      const cost = trace.totalCost || 0;
      const tokens = trace.totalTokens || 0;

      if (!costByUser[userId]) {
        costByUser[userId] = { cost: 0, requests: 0, tokens: 0 };
      }
      costByUser[userId].cost += cost;
      costByUser[userId].requests += 1;
      costByUser[userId].tokens += tokens;
    }

    return Object.entries(costByUser)
      .map(([userId, stats]) => ({
        userId,
        ...stats,
        avgCostPerRequest: stats.cost / stats.requests,
      }))
      .sort((a, b) => b.cost - a.cost);
  },
});

/**
 * Get cache hit rate over time
 */
export const getCacheHitRate = query({
  args: {
    startTime: v.number(),
    endTime: v.number(),
  },
  handler: async (ctx, args) => {
    const traces = await ctx.db
      .query("traces")
      .withIndex("by_start_time")
      .filter((q) =>
        q.and(
          q.gte(q.field("startTime"), args.startTime),
          q.lte(q.field("startTime"), args.endTime)
        )
      )
      .collect();

    let totalInputTokens = 0;
    let cacheHitTokens = 0;
    let cacheWriteTokens = 0;
    let totalCost = 0;
    let costWithoutCache = 0;

    for (const trace of traces) {
      for (const span of trace.spans) {
        const inputTokens = span.attributes["llm.usage.input_tokens"] || 0;
        const cacheRead = span.attributes["llm.usage.cache_read_tokens"] || 0;
        const cacheWrite = span.attributes["llm.usage.cache_write_tokens"] || 0;
        const cost = span.attributes["llm.cost.total"] || 0;

        totalInputTokens += inputTokens;
        cacheHitTokens += cacheRead;
        cacheWriteTokens += cacheWrite;
        totalCost += cost;

        // Estimate cost without caching (assume $3/M for Claude Sonnet)
        const model = span.attributes["llm.model"] || "";
        const inputRate = model.includes("opus") ? 15 : model.includes("haiku") ? 1 : 3;
        const outputTokens = span.attributes["llm.usage.output_tokens"] || 0;
        const outputRate = model.includes("opus") ? 75 : model.includes("haiku") ? 5 : 15;

        costWithoutCache += ((inputTokens * inputRate) + (outputTokens * outputRate)) / 1_000_000;
      }
    }

    const cacheHitRate = totalInputTokens > 0 ? (cacheHitTokens / totalInputTokens) * 100 : 0;
    const estimatedSavings = costWithoutCache - totalCost;
    const savingsRate = costWithoutCache > 0 ? (estimatedSavings / costWithoutCache) * 100 : 0;

    return {
      totalInputTokens,
      cacheHitTokens,
      cacheWriteTokens,
      cacheHitRate, // %
      totalCost,
      costWithoutCache,
      estimatedSavings, // USD
      savingsRate, // %
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Delete traces older than N days (scheduled cleanup)
 */
export const deleteOldTraces = internalMutation({
  args: {
    olderThanDays: v.number(),
  },
  handler: async (ctx, args) => {
    const cutoffTime = Date.now() - args.olderThanDays * 24 * 60 * 60 * 1000;

    const oldTraces = await ctx.db
      .query("traces")
      .withIndex("by_start_time")
      .filter((q) => q.lt(q.field("startTime"), cutoffTime))
      .collect();

    for (const trace of oldTraces) {
      await ctx.db.delete(trace._id);
    }

    return { deleted: oldTraces.length };
  },
});
