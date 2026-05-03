/**
 * Pipeline Schedule
 *
 * CRUD + cron sweep for `scheduledPipelineRuns`. The hourly cron
 * `pipelineSchedules.runDuePipelineSchedules` finds enabled rows whose
 * `nextRunAt <= now`, kicks off the workflow via `startPipelineRun`,
 * and advances `nextRunAt` per the row's cadence.
 *
 * Cadence semantics:
 *   - "once"   → fire once, then `enabled=false`
 *   - "hourly" → +1h
 *   - "daily"  → +24h
 *   - "weekly" → +7d
 *
 * Idempotency: each pipeline kicks off via the workflow which uses the
 * pipeline's existing idempotency-keyed `createOrGetRun`. Re-running
 * the same schedule won't duplicate-create.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { DEFAULT_PIPELINE_MODEL_ROUTE } from "../agents/mcp_tools/models/modelResolver";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/* -------------------------------------------------------------------------- */
/*  Public CRUD                                                                */
/* -------------------------------------------------------------------------- */

export const createSchedule = mutation({
  args: {
    ownerKey: v.optional(v.string()),
    pipelineKind: v.union(
      v.literal("code_gen"),
      v.literal("design_gen"),
      v.literal("research"),
    ),
    spec: v.string(),
    title: v.optional(v.string()),
    modelId: v.optional(v.string()),
    cadence: v.union(
      v.literal("once"),
      v.literal("hourly"),
      v.literal("daily"),
      v.literal("weekly"),
    ),
    nextRunAt: v.optional(v.number()),
    options: v.optional(v.any()),
  },
  returns: v.object({ scheduleId: v.id("scheduledPipelineRuns") }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const scheduleId = await ctx.db.insert("scheduledPipelineRuns", {
      ownerKey: args.ownerKey,
      pipelineKind: args.pipelineKind,
      spec: args.spec,
      title: args.title,
      modelId: args.modelId ?? DEFAULT_PIPELINE_MODEL_ROUTE,
      cadence: args.cadence,
      enabled: true,
      nextRunAt: args.nextRunAt ?? now,
      options: args.options,
      createdAt: now,
      updatedAt: now,
    });
    return { scheduleId };
  },
});

export const setScheduleEnabled = mutation({
  args: {
    scheduleId: v.id("scheduledPipelineRuns"),
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.scheduleId, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const deleteSchedule = mutation({
  args: { scheduleId: v.id("scheduledPipelineRuns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.scheduleId);
    return null;
  },
});

export const listSchedules = query({
  args: { ownerKey: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("scheduledPipelineRuns"),
      ownerKey: v.optional(v.string()),
      pipelineKind: v.string(),
      spec: v.string(),
      title: v.optional(v.string()),
      modelId: v.string(),
      cadence: v.string(),
      enabled: v.boolean(),
      nextRunAt: v.number(),
      lastRunAt: v.optional(v.number()),
      lastRunId: v.optional(v.string()),
      lastStatus: v.optional(v.string()),
      options: v.optional(v.any()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 25, 100);
    let rows;
    if (args.ownerKey) {
      rows = await ctx.db
        .query("scheduledPipelineRuns")
        .withIndex("by_owner_createdAt", (q) => q.eq("ownerKey", args.ownerKey))
        .order("desc")
        .take(limit);
    } else {
      rows = await ctx.db.query("scheduledPipelineRuns").order("desc").take(limit);
    }
    return rows.map((r) => ({
      _id: r._id,
      ownerKey: r.ownerKey,
      pipelineKind: r.pipelineKind,
      spec: r.spec,
      title: r.title,
      modelId: r.modelId,
      cadence: r.cadence,
      enabled: r.enabled,
      nextRunAt: r.nextRunAt,
      lastRunAt: r.lastRunAt,
      lastRunId: r.lastRunId,
      lastStatus: r.lastStatus,
      options: r.options,
      createdAt: r.createdAt,
    }));
  },
});

/* -------------------------------------------------------------------------- */
/*  Internal: cron sweep                                                       */
/* -------------------------------------------------------------------------- */

export const findDueSchedules = internalMutation({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    // BOUND: cap how many we kick off in a single sweep so a backlog
    // can't overrun the workflow component.
    const due = await ctx.db
      .query("scheduledPipelineRuns")
      .withIndex("by_enabled_nextRunAt", (q) => q.eq("enabled", true))
      .order("asc")
      .take(50);
    return due.filter((row) => row.nextRunAt <= args.now);
  },
});

export const advanceSchedule = internalMutation({
  args: {
    scheduleId: v.id("scheduledPipelineRuns"),
    runId: v.string(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.scheduleId);
    if (!row) return { ok: false };

    const now = Date.now();
    let nextRunAt = row.nextRunAt;
    let enabled = row.enabled;
    switch (row.cadence) {
      case "once":
        enabled = false;
        break;
      case "hourly":
        nextRunAt = now + HOUR_MS;
        break;
      case "daily":
        nextRunAt = now + DAY_MS;
        break;
      case "weekly":
        nextRunAt = now + 7 * DAY_MS;
        break;
    }
    await ctx.db.patch(args.scheduleId, {
      enabled,
      nextRunAt,
      lastRunAt: now,
      lastRunId: args.runId,
      lastStatus: args.status,
      updatedAt: now,
    });
    return { ok: true };
  },
});

export const runDuePipelineSchedules = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.runMutation(
      internal.domains.pipelines.pipelineSchedule.findDueSchedules,
      { now },
    );

    const results: Array<{
      scheduleId: string;
      kicked: boolean;
      runId?: string;
      error?: string;
    }> = [];

    for (const schedule of due) {
      try {
        // Pull options off the schedule (e.g., depth: "deep" for research).
        const options = (schedule.options ?? {}) as Record<string, unknown>;

        // Each pipeline kind has slightly different args; the workflow
        // wrapper handles the shared subset.
        const result = await ctx.runMutation(
          internal.domains.pipelines.pipelineWorkflow.startPipelineRun as any,
          {
            pipelineKind: schedule.pipelineKind,
            spec: schedule.spec,
            title: schedule.title,
            modelId: schedule.modelId,
            ownerKey: schedule.ownerKey,
            forceFresh: false,
            ...options,
          },
        );
        const workflowId =
          typeof result === "object" && result !== null && "workflowId" in result
            ? String((result as any).workflowId)
            : "unknown";
        await ctx.runMutation(
          internal.domains.pipelines.pipelineSchedule.advanceSchedule,
          {
            scheduleId: schedule._id as Id<"scheduledPipelineRuns">,
            runId: workflowId,
            status: "kicked",
          },
        );
        results.push({ scheduleId: schedule._id, kicked: true, runId: workflowId });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await ctx.runMutation(
          internal.domains.pipelines.pipelineSchedule.advanceSchedule,
          {
            scheduleId: schedule._id as Id<"scheduledPipelineRuns">,
            runId: "",
            status: `error:${message.slice(0, 100)}`,
          },
        );
        results.push({ scheduleId: schedule._id, kicked: false, error: message });
      }
    }

    console.log(
      `[pipelineSchedule] swept ${due.length} due, kicked ${
        results.filter((r) => r.kicked).length
      }`,
    );
    return { count: due.length, results };
  },
});
