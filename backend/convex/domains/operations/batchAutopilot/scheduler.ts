import { v } from "convex/values";
import { internalMutation } from "../../../_generated/server";
import { internal } from "../../../_generated/api";

/** Max concurrent runs per sweep to prevent thundering herd */
const MAX_CONCURRENT_PER_SWEEP = 5;

/** Auto-disable after this many consecutive failures */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Sweep cron: runs every 15 minutes.
 * Finds schedules whose nextRunAt has passed and kicks off batch runs.
 */
export const sweepPendingRuns = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Query schedules that are enabled and due
    const pendingSchedules = await ctx.db
      .query("batchAutopilotSchedules")
      .withIndex("by_next_run", (q) =>
        q.eq("isEnabled", true).lte("nextRunAt", now)
      )
      .take(MAX_CONCURRENT_PER_SWEEP);

    let triggered = 0;

    for (const schedule of pendingSchedules) {
      // Skip if too many consecutive failures (auto-disable)
      if (schedule.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        await ctx.db.patch(schedule._id, {
          isEnabled: false,
          updatedAt: now,
        });
        console.log(`[batchAutopilot] Auto-disabled schedule ${schedule._id} after ${MAX_CONSECUTIVE_FAILURES} failures`);
        continue;
      }

      // Determine the delta window
      const windowStartAt = schedule.lastRunAt || schedule.createdAt;
      const windowEndAt = now;

      // Create a run entry
      const runId = await ctx.db.insert("batchAutopilotRuns", {
        userId: schedule.userId,
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

      // Schedule the runner action (runs immediately)
      await ctx.scheduler.runAfter(0, internal.domains.batchAutopilot.runner.executeBatchRun, {
        runId,
      });

      // Update schedule: advance nextRunAt with jitter (±5min)
      const jitterMs = Math.floor(Math.random() * 600000) - 300000; // ±5min
      const nextRunAt = now + schedule.intervalMs + jitterMs;
      await ctx.db.patch(schedule._id, {
        lastRunAt: now,
        nextRunAt,
        updatedAt: now,
      });

      triggered++;
    }

    if (triggered > 0) {
      console.log(`[batchAutopilot] Sweep triggered ${triggered} batch runs`);
    }
  },
});

/**
 * Internal: mark a run as completed and reset failure count
 */
export const markRunCompleted = internalMutation({
  args: {
    runId: v.id("batchAutopilotRuns"),
    briefMarkdown: v.optional(v.string()),
    briefDocumentId: v.optional(v.id("documents")),
    deltaSummary: v.optional(v.string()),
    feedItemsCount: v.number(),
    signalsCount: v.number(),
    narrativeEventsCount: v.number(),
    tokensUsed: v.number(),
    modelCallsCount: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;

    await ctx.db.patch(args.runId, {
      status: "completed",
      completedAt: Date.now(),
      briefMarkdown: args.briefMarkdown,
      briefDocumentId: args.briefDocumentId,
      deltaSummary: args.deltaSummary,
      feedItemsCount: args.feedItemsCount,
      signalsCount: args.signalsCount,
      narrativeEventsCount: args.narrativeEventsCount,
      tokensUsed: args.tokensUsed,
      modelCallsCount: args.modelCallsCount,
    });

    // Reset consecutive failures on the schedule
    const schedule = await ctx.db.get(run.scheduleId);
    if (schedule) {
      await ctx.db.patch(schedule._id, {
        consecutiveFailures: 0,
        updatedAt: Date.now(),
      });
    }
  },
});

/**
 * Internal: mark a run as failed and increment failure count
 */
export const markRunFailed = internalMutation({
  args: {
    runId: v.id("batchAutopilotRuns"),
    error: v.string(),
    tokensUsed: v.optional(v.number()),
    modelCallsCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;

    await ctx.db.patch(args.runId, {
      status: "failed",
      completedAt: Date.now(),
      error: args.error,
      tokensUsed: args.tokensUsed ?? run.tokensUsed,
      modelCallsCount: args.modelCallsCount ?? run.modelCallsCount,
    });

    // Increment consecutive failures on the schedule
    const schedule = await ctx.db.get(run.scheduleId);
    if (schedule) {
      await ctx.db.patch(schedule._id, {
        consecutiveFailures: schedule.consecutiveFailures + 1,
        updatedAt: Date.now(),
      });
    }
  },
});

/**
 * Internal: update run status (for progress tracking)
 */
export const updateRunStatus = internalMutation({
  args: {
    runId: v.id("batchAutopilotRuns"),
    status: v.string(),
  },
  handler: async (ctx, { runId, status }) => {
    await ctx.db.patch(runId, { status });
  },
});
