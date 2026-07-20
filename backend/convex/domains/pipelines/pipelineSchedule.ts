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
import {
  pipelineOwnerMatches,
  requireAuthenticatedPipelineOwnerKey,
} from "./pipelineOwnership";
import { normalizePipelineLaunchText } from "./pipelineAdmission";
import { buildScheduleOccurrenceAttemptKey } from "./pipelineAttempt";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_PIPELINE_SCHEDULES_PER_OWNER = 20;

/* -------------------------------------------------------------------------- */
/*  Public CRUD                                                                */
/* -------------------------------------------------------------------------- */

export const createSchedule = mutation({
  args: {
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
    options: v.optional(
      v.object({
        linkupDepth: v.optional(
          v.union(v.literal("standard"), v.literal("deep")),
        ),
      }),
    ),
  },
  returns: v.object({ scheduleId: v.id("scheduledPipelineRuns") }),
  handler: async (ctx, args) => {
    const ownerKey = await requireAuthenticatedPipelineOwnerKey(ctx);
    const launchText = normalizePipelineLaunchText(args);
    const existingSchedules = await ctx.db
      .query("scheduledPipelineRuns")
      .withIndex("by_owner_createdAt", (q) => q.eq("ownerKey", ownerKey))
      .take(MAX_PIPELINE_SCHEDULES_PER_OWNER);
    if (existingSchedules.length >= MAX_PIPELINE_SCHEDULES_PER_OWNER) {
      throw new Error(
        `Schedule limit reached (${MAX_PIPELINE_SCHEDULES_PER_OWNER}). Delete an existing schedule first`,
      );
    }
    const now = Date.now();
    const scheduleId = await ctx.db.insert("scheduledPipelineRuns", {
      ownerKey,
      pipelineKind: args.pipelineKind,
      spec: launchText.spec,
      title: launchText.title,
      modelId: launchText.modelId ?? DEFAULT_PIPELINE_MODEL_ROUTE,
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
    const ownerKey = await requireAuthenticatedPipelineOwnerKey(ctx);
    const schedule = await ctx.db.get(args.scheduleId);
    if (!pipelineOwnerMatches(schedule, ownerKey)) {
      throw new Error("Schedule not found or unauthorized");
    }
    await ctx.db.patch(args.scheduleId, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const deleteSchedule = mutation({
  args: {
    scheduleId: v.id("scheduledPipelineRuns"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerKey = await requireAuthenticatedPipelineOwnerKey(ctx);
    const schedule = await ctx.db.get(args.scheduleId);
    if (!pipelineOwnerMatches(schedule, ownerKey)) {
      throw new Error("Schedule not found or unauthorized");
    }
    await ctx.db.delete(args.scheduleId);
    return null;
  },
});

export const listSchedules = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("scheduledPipelineRuns"),
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
    const ownerKey = await requireAuthenticatedPipelineOwnerKey(ctx);
    const limit = Math.min(args.limit ?? 25, 100);
    const rows = await ctx.db
      .query("scheduledPipelineRuns")
      .withIndex("by_owner_createdAt", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .take(limit);
    return rows.map((r) => ({
      _id: r._id,
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
    return due.filter(
      (row) =>
        row.nextRunAt <= args.now &&
        typeof row.ownerKey === "string" &&
        /^user:/.test(row.ownerKey),
    );
  },
});

export const advanceSchedule = internalMutation({
  args: {
    scheduleId: v.id("scheduledPipelineRuns"),
    dueNextRunAt: v.number(),
    runId: v.string(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.scheduleId);
    if (!row) return { ok: false };
    if (row.nextRunAt !== args.dueNextRunAt) {
      return { ok: false, reason: "occurrence_already_advanced" };
    }

    const now = Date.now();
    let nextRunAt = row.nextRunAt;
    let enabled = row.enabled;
    switch (row.cadence) {
      case "once":
        enabled = false;
        break;
      case "hourly":
        nextRunAt = args.dueNextRunAt + HOUR_MS;
        break;
      case "daily":
        nextRunAt = args.dueNextRunAt + DAY_MS;
        break;
      case "weekly":
        nextRunAt = args.dueNextRunAt + 7 * DAY_MS;
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
        const dueNextRunAt = schedule.nextRunAt;
        const attemptKey = buildScheduleOccurrenceAttemptKey(
          String(schedule._id),
          dueNextRunAt,
        );
        // Pull options off the schedule (e.g., depth: "deep" for research).
        const options = (schedule.options ?? {}) as {
          linkupDepth?: "standard" | "deep";
        };

        // Each pipeline kind has slightly different args; the workflow
        // wrapper handles the shared subset.
        const result = await ctx.runMutation(
          internal.domains.pipelines.pipelineWorkflow.startPipelineRunInternal as any,
          {
            pipelineKind: schedule.pipelineKind,
            spec: schedule.spec,
            title: schedule.title,
            modelId: schedule.modelId,
            ownerKey: schedule.ownerKey,
            forceFresh: true,
            attemptKey,
            linkupDepth: options.linkupDepth,
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
            dueNextRunAt,
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
            dueNextRunAt: schedule.nextRunAt,
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
