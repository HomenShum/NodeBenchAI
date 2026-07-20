import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { query, internalQuery } from "../../../_generated/server";

/**
 * Get the autopilot schedule for the current user.
 */
export const getSchedule = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    return await ctx.db
      .query("batchAutopilotSchedules")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

/**
 * Get recent batch runs for the current user.
 */
export const getRecentRuns = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    return await ctx.db
      .query("batchAutopilotRuns")
      .withIndex("by_started")
      .order("desc")
      .filter((q) => q.eq(q.field("userId"), userId))
      .take(limit || 20);
  },
});

// ── Internal queries (for runner/scheduler) ─────────────────────────────────

export const _getRunById = internalQuery({
  args: { runId: v.id("batchAutopilotRuns") },
  handler: async (ctx, { runId }) => {
    return await ctx.db.get(runId);
  },
});

export const _getScheduleById = internalQuery({
  args: { scheduleId: v.id("batchAutopilotSchedules") },
  handler: async (ctx, { scheduleId }) => {
    return await ctx.db.get(scheduleId);
  },
});
