/**
 * Narrative Search Log Mutations
 *
 * Logs all searches performed by Newsroom agents for audit trail.
 */

import { v } from "convex/values";
import { mutation, internalMutation } from "../../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * FNV-1a 32-bit hash for stable ID generation
 */
function fnv1a32Hex(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Get ISO week number from timestamp
 */
function getWeekNumber(timestamp: number): string {
  const date = new Date(timestamp);
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, "0")}`;
}

/**
 * Log a search performed by an agent
 */
export const logSearch = internalMutation({
  args: {
    query: v.string(),
    searchType: v.union(
      v.literal("web_news"),
      v.literal("historical"),
      v.literal("entity_context"),
      v.literal("verification")
    ),
    resultCount: v.number(),
    resultUrls: v.array(v.string()),
    resultSnippets: v.optional(v.array(v.string())),
    narrativeThreadId: v.optional(v.id("narrativeThreads")),
    narrativeEventIds: v.optional(v.array(v.id("narrativeEvents"))),
    agentName: v.string(),
    workflowId: v.optional(v.string()),
    userId: v.id("users"),
  },
  returns: v.id("narrativeSearchLog"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const searchId = `nsl_${fnv1a32Hex(args.query + now)}`;
    const weekNumber = getWeekNumber(now);

    return await ctx.db.insert("narrativeSearchLog", {
      searchId,
      query: args.query,
      searchType: args.searchType,
      resultCount: args.resultCount,
      resultUrls: args.resultUrls,
      resultSnippets: args.resultSnippets,
      searchedAt: now,
      weekNumber,
      narrativeThreadId: args.narrativeThreadId,
      narrativeEventIds: args.narrativeEventIds,
      agentName: args.agentName,
      workflowId: args.workflowId,
      userId: args.userId,
      createdAt: now,
    });
  },
});

/**
 * Batch log searches (for efficiency)
 */
export const batchLogSearches = internalMutation({
  args: {
    searches: v.array(
      v.object({
        query: v.string(),
        searchType: v.union(
          v.literal("web_news"),
          v.literal("historical"),
          v.literal("entity_context"),
          v.literal("verification")
        ),
        resultCount: v.number(),
        resultUrls: v.array(v.string()),
        resultSnippets: v.optional(v.array(v.string())),
        narrativeThreadId: v.optional(v.id("narrativeThreads")),
        agentName: v.string(),
      })
    ),
    userId: v.id("users"),
    workflowId: v.optional(v.string()),
    weekNumber: v.optional(v.string()),
    searchedAt: v.optional(v.number()),
  },
  returns: v.array(v.id("narrativeSearchLog")),
  handler: async (ctx, args) => {
    const now = args.searchedAt ?? Date.now();
    const weekNumber = args.weekNumber ?? getWeekNumber(now);
    const ids: Array<any> = [];

    for (const search of args.searches) {
      const searchId = `nsl_${fnv1a32Hex(search.query + now + Math.random())}`;

      const id = await ctx.db.insert("narrativeSearchLog", {
        searchId,
        query: search.query,
        searchType: search.searchType,
        resultCount: search.resultCount,
        resultUrls: search.resultUrls,
        resultSnippets: search.resultSnippets,
        searchedAt: now,
        weekNumber,
        narrativeThreadId: search.narrativeThreadId,
        agentName: search.agentName,
        workflowId: args.workflowId,
        userId: args.userId,
        createdAt: now,
      });

      ids.push(id);
    }

    return ids;
  },
});

/**
 * Delete old search logs (for cleanup)
 */
export const deleteOldLogs = internalMutation({
  args: {
    olderThanDays: v.number(),
  },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.olderThanDays * 24 * 60 * 60 * 1000;

    // Get old logs in batches
    const oldLogs = await ctx.db
      .query("narrativeSearchLog")
      .filter((q) => q.lt(q.field("createdAt"), cutoff))
      .take(100);

    for (const log of oldLogs) {
      await ctx.db.delete(log._id);
    }

    return oldLogs.length;
  },
});
