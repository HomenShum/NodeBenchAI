/**
 * Daily Brief Domain Memory Queries
 *
 * Public queries are used by the frontend Brief tab.
 * Internal queries support initializer/worker actions.
 */

import { v } from "convex/values";
import { query, internalQuery } from "../../_generated/server";

// ---------------------------------------------------------------------------
// Internal helpers for actions
// ---------------------------------------------------------------------------

export const getSnapshotById = internalQuery({
  args: { snapshotId: v.id("dailyBriefSnapshots") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.snapshotId);
  },
});

export const getMemoryBySnapshot = internalQuery({
  args: { snapshotId: v.id("dailyBriefSnapshots") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("dailyBriefMemories")
      .withIndex("by_snapshot", (q) => q.eq("snapshotId", args.snapshotId))
      .order("desc")
      .first();
  },
});

export const getMemoryByIdInternal = internalQuery({
  args: { memoryId: v.id("dailyBriefMemories") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.memoryId);
  },
});

export const getLatestMemoryInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("dailyBriefMemories")
      .withIndex("by_generated_at")
      .order("desc")
      .first();
  },
});

export const listMemoriesByDateStringInternal = internalQuery({
  args: { dateString: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 25, 100);
    return await ctx.db
      .query("dailyBriefMemories")
      .withIndex("by_date_string", (q) => q.eq("dateString", args.dateString))
      .order("desc")
      .take(limit);
  },
});

export const getPreviousSnapshotInternal = internalQuery({
  args: { dateString: v.string() }, // YYYY-MM-DD
  handler: async (ctx, args) => {
    const date = new Date(args.dateString + "T00:00:00.000Z");
    const prev = new Date(date.getTime() - 24 * 60 * 60 * 1000);
    const prevDateString = prev.toISOString().split("T")[0];

    return await ctx.db
      .query("dailyBriefSnapshots")
      .withIndex("by_date_string", (q) => q.eq("dateString", prevDateString))
      .order("desc")
      .first();
  },
});

// ---------------------------------------------------------------------------
// Public queries for UI
// ---------------------------------------------------------------------------

export const getLatestMemory = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("dailyBriefMemories")
      .withIndex("by_generated_at")
      .order("desc")
      .first();
  },
});

export const getMemoryByDateString = query({
  args: { dateString: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("dailyBriefMemories")
      .withIndex("by_date_string", (q) => q.eq("dateString", args.dateString))
      .order("desc")
      .first();
  },
});

export const getMemoryById = query({
  args: { memoryId: v.id("dailyBriefMemories") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.memoryId);
  },
});

export const listTaskResultsByMemory = query({
  args: { memoryId: v.id("dailyBriefMemories") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("dailyBriefTaskResults")
      .withIndex("by_memory", (q) => q.eq("memoryId", args.memoryId))
      .order("desc")
      .take(100);
  },
});
