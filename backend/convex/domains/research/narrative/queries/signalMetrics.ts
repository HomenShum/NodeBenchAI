/**
 * Narrative Signal Metrics Queries (Phase 7)
 *
 * Read operations for narrativeSignalMetrics table.
 * Supports: listing by thread, domain, hypothesis, and time window.
 *
 * @module domains/narrative/queries/signalMetrics
 */

import { v } from "convex/values";
import { query, internalQuery } from "../../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

const domainValidator = v.union(
  v.literal("attention"),
  v.literal("policy"),
  v.literal("labor"),
  v.literal("market"),
  v.literal("sentiment")
);

/**
 * Get signal metrics for a thread by domain
 */
export const getByThreadAndDomain = query({
  args: {
    threadId: v.id("narrativeThreads"),
    domain: domainValidator,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread not found");
    if (!thread.isPublic && thread.userId !== userId) throw new Error("Not authorized");

    return await ctx.db
      .query("narrativeSignalMetrics")
      .withIndex("by_thread", (q) =>
        q.eq("threadId", args.threadId).eq("domain", args.domain)
      )
      .order("desc")
      .take(args.limit ?? 50);
  },
});

/**
 * Get all metrics for a domain (cross-thread, for dashboard)
 */
export const getByDomain = query({
  args: {
    domain: domainValidator,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    return await ctx.db
      .query("narrativeSignalMetrics")
      .withIndex("by_domain", (q) => q.eq("domain", args.domain))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

/**
 * Get signal metrics summary for a thread (all domains)
 */
export const getThreadSignalSummary = query({
  args: {
    threadId: v.id("narrativeThreads"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread not found");
    if (!thread.isPublic && thread.userId !== userId) throw new Error("Not authorized");

    const domains = ["attention", "policy", "labor", "market", "sentiment"] as const;
    const summary: Record<string, { latest: number | null; metricCount: number; avgConfidence: number }> = {};

    for (const domain of domains) {
      const metrics = await ctx.db
        .query("narrativeSignalMetrics")
        .withIndex("by_thread", (q) =>
          q.eq("threadId", args.threadId).eq("domain", domain)
        )
        .order("desc")
        .take(10);

      summary[domain] = {
        latest: metrics[0]?.value ?? null,
        metricCount: metrics.length,
        avgConfidence: metrics.length > 0
          ? metrics.reduce((sum, m) => sum + m.confidence, 0) / metrics.length
          : 0,
      };
    }

    return { threadId: args.threadId, domains: summary };
  },
});

/**
 * Internal: Get metrics for hypothesis evaluation
 */
export const getByHypothesisInternal = internalQuery({
  args: {
    hypothesisId: v.string(),
    domain: v.optional(domainValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let q = ctx.db
      .query("narrativeSignalMetrics")
      .withIndex("by_domain", (q) =>
        args.domain ? q.eq("domain", args.domain) : q
      )
      .order("desc");

    const results = await q.take(args.limit ?? 100);
    // Filter by hypothesisId in-memory since the compound index isn't guaranteed
    return results.filter((m) => m.hypothesisId === args.hypothesisId);
  },
});

/**
 * Internal: Get metrics for a thread (all domains, for agent pipeline)
 */
export const getByThreadInternal = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
    domain: v.optional(domainValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.domain) {
      return await ctx.db
        .query("narrativeSignalMetrics")
        .withIndex("by_thread", (q) =>
          q.eq("threadId", args.threadId).eq("domain", args.domain!)
        )
        .order("desc")
        .take(args.limit ?? 50);
    }

    // All domains — collect from each
    const domains = ["attention", "policy", "labor", "market", "sentiment"] as const;
    const firstDomain = await ctx.db
      .query("narrativeSignalMetrics")
      .withIndex("by_thread", (q) =>
        q.eq("threadId", args.threadId).eq("domain", "attention")
      )
      .order("desc")
      .take(args.limit ?? 10);
    const all = [...firstDomain];
    for (const domain of domains.slice(1)) {
      const metrics = await ctx.db
        .query("narrativeSignalMetrics")
        .withIndex("by_thread", (q) =>
          q.eq("threadId", args.threadId).eq("domain", domain)
        )
        .order("desc")
        .take(args.limit ?? 10);
      all.push(...metrics);
    }
    return all;
  },
});
