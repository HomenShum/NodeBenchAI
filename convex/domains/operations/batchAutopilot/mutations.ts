import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, internalMutation } from "../../../_generated/server";
import { internal } from "../../../_generated/api";

/**
 * Create or update the autopilot schedule for the current user.
 */
export const upsertSchedule = mutation({
  args: {
    intervalMs: v.number(),
  },
  handler: async (ctx, { intervalMs }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Need an operator profile
    const profile = await ctx.db
      .query("operatorProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) throw new Error("Create an Operator Profile first");

    const now = Date.now();
    const existing = await ctx.db
      .query("batchAutopilotSchedules")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        intervalMs,
        nextRunAt: now + intervalMs,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("batchAutopilotSchedules", {
      userId,
      profileId: profile._id,
      intervalMs,
      isEnabled: true,
      nextRunAt: now + intervalMs,
      consecutiveFailures: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Toggle the autopilot schedule on/off.
 */
export const toggleEnabled = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const schedule = await ctx.db
      .query("batchAutopilotSchedules")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!schedule) throw new Error("No schedule found");

    const now = Date.now();
    await ctx.db.patch(schedule._id, {
      isEnabled: enabled,
      nextRunAt: enabled ? now + schedule.intervalMs : schedule.nextRunAt,
      consecutiveFailures: enabled ? 0 : schedule.consecutiveFailures,
      updatedAt: now,
    });
  },
});

/**
 * Trigger a manual batch run immediately.
 */
export const triggerManualRun = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await ctx.db
      .query("operatorProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) throw new Error("Create an Operator Profile first");

    let schedule = await ctx.db
      .query("batchAutopilotSchedules")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const now = Date.now();

    // Create schedule if it doesn't exist
    if (!schedule) {
      const scheduleId = await ctx.db.insert("batchAutopilotSchedules", {
        userId,
        profileId: profile._id,
        intervalMs: 43200000, // 12h default
        isEnabled: false,     // Manual trigger doesn't auto-enable
        nextRunAt: now + 43200000,
        consecutiveFailures: 0,
        createdAt: now,
        updatedAt: now,
      });
      schedule = (await ctx.db.get(scheduleId))!;
    }

    // Determine delta window
    const windowStartAt = schedule.lastRunAt || profile.createdAt;
    const windowEndAt = now;

    // Create run entry
    const runId = await ctx.db.insert("batchAutopilotRuns", {
      userId,
      scheduleId: schedule._id,
      status: "collecting",
      startedAt: now,
      windowStartAt,
      windowEndAt,
      feedItemsCount: 0,
      signalsCount: 0,
      narrativeEventsCount: 0,
      tokensUsed: 0,
      modelCallsCount: 0,
    });

    // Schedule the runner
    await ctx.scheduler.runAfter(0, internal.domains.batchAutopilot.runner.executeBatchRun, {
      runId,
    });

    // Update lastRunAt
    await ctx.db.patch(schedule._id, {
      lastRunAt: now,
      updatedAt: now,
    });

    return runId;
  },
});

/**
 * Internal: create a brief document
 */
export const _createBriefDocument = internalMutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    content: v.string(),
  },
  handler: async (ctx, { userId, title, content }) => {
    const now = Date.now();
    return await ctx.db.insert("documents", {
      title,
      content,
      contentPreview: content.slice(0, 500),
      isPublic: false,
      documentType: "text",
      tags: ["autopilot-brief", "generated"],
      createdAt: now,
      updatedAt: now,
    });
  },
});
