/**
 * pipelineReliability — Convex persistence + triage for the async retry
 * layer backing the structuring-pass pipeline.
 *
 * Covers two tables introduced for .claude/rules/async_reliability.md:
 *
 *   pipelineDeadLetters — fingerprint-grouped terminal failures
 *     - recordDeadLetter(fingerprint, ...) → upsert: increment occurrenceCount
 *     - listOpenDeadLetters() → triage queue (BOUND at 100)
 *     - acknowledgeDeadLetter({ id }) → status = "acknowledged"
 *     - resolveDeadLetter({ id, note }) → status = "resolved"
 *
 *   pipelineRetries — scheduled retry queue
 *     - scheduleRetry(entitySlug, blockType, nextAttemptAt, ...)
 *     - scanDueRetries() → rows where status="scheduled" && nextAttemptAt <= now
 *     - completeRetry({ id })
 *     - cancelForEntity(entitySlug) — user deleted the entity
 *
 * Role (agentic_reliability.md):
 *   - BOUND: every list caps at <=100
 *   - HONEST_STATUS: statuses are bounded enums; no status="ok" fallback
 *   - DETERMINISTIC: fingerprint is injected by the pure retryPolicy module
 *   - ERROR_BOUNDARY: mutations throw on invalid input; the orchestrator
 *     wraps all calls so the structuring pass is never killed by a DLQ
 *     write failure.
 */

import { v } from "convex/values";
import { internalMutation, mutation, query } from "../../_generated/server";

const MAX_LIST = 100;

const DLQ_STATUS = v.union(
  v.literal("open"),
  v.literal("acknowledged"),
  v.literal("resolved"),
);

const RETRY_STATUS = v.union(
  v.literal("scheduled"),
  v.literal("in_flight"),
  v.literal("completed"),
  v.literal("canceled"),
  v.literal("dead_lettered"),
);

/* ==========================================================================
 * Dead letter queue
 * ========================================================================== */

/**
 * Upsert a dead-letter row by fingerprint. Fingerprinting happens in the
 * pure retryPolicy module; this function just stores.
 *
 * Called by internalAction code paths (hence internalMutation).
 */
export const recordDeadLetter = internalMutation({
  args: {
    fingerprint: v.string(),
    errorClass: v.string(),
    source: v.string(),
    messageStem: v.string(),
    sampleEntitySlug: v.optional(v.string()),
    sampleScratchpadRunId: v.optional(v.string()),
    sampleErrorJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.fingerprint.trim().length === 0) {
      throw new Error("recordDeadLetter: fingerprint required");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("pipelineDeadLetters")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", args.fingerprint))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeen: now,
        occurrenceCount: existing.occurrenceCount + 1,
        // If it was resolved and returned, reopen it — the bug is back.
        status: existing.status === "resolved" ? "open" : existing.status,
        sampleEntitySlug: args.sampleEntitySlug ?? existing.sampleEntitySlug,
        sampleScratchpadRunId:
          args.sampleScratchpadRunId ?? existing.sampleScratchpadRunId,
        sampleErrorJson: args.sampleErrorJson ?? existing.sampleErrorJson,
      });
      return { id: existing._id, status: "incremented" as const };
    }
    const id = await ctx.db.insert("pipelineDeadLetters", {
      fingerprint: args.fingerprint,
      errorClass: args.errorClass,
      source: args.source,
      messageStem: args.messageStem,
      firstSeen: now,
      lastSeen: now,
      occurrenceCount: 1,
      sampleEntitySlug: args.sampleEntitySlug,
      sampleScratchpadRunId: args.sampleScratchpadRunId,
      sampleErrorJson: args.sampleErrorJson,
      status: "open",
    });
    return { id, status: "created" as const };
  },
});

export const listOpenDeadLetters = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cap = Math.max(1, Math.min(args.limit ?? 50, MAX_LIST));
    return await ctx.db
      .query("pipelineDeadLetters")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("desc")
      .take(cap);
  },
});

export const listAllDeadLetters = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(DLQ_STATUS),
  },
  handler: async (ctx, args) => {
    const cap = Math.max(1, Math.min(args.limit ?? 50, MAX_LIST));
    if (args.status) {
      return await ctx.db
        .query("pipelineDeadLetters")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .order("desc")
        .take(cap);
    }
    return await ctx.db
      .query("pipelineDeadLetters")
      .withIndex("by_last_seen")
      .order("desc")
      .take(cap);
  },
});

export const acknowledgeDeadLetter = mutation({
  args: {
    id: v.id("pipelineDeadLetters"),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("acknowledgeDeadLetter: row not found");
    await ctx.db.patch(args.id, { status: "acknowledged" });
    return { status: "acknowledged" as const };
  },
});

export const resolveDeadLetter = mutation({
  args: {
    id: v.id("pipelineDeadLetters"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("resolveDeadLetter: row not found");
    await ctx.db.patch(args.id, {
      status: "resolved",
      resolvedAt: Date.now(),
      resolvedNote: args.note,
    });
    return { status: "resolved" as const };
  },
});

/** Aggregate — dashboard rollup. */
export const rollupDeadLetters = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("pipelineDeadLetters")
      .withIndex("by_last_seen")
      .order("desc")
      .take(MAX_LIST);
    const open = rows.filter((r) => r.status === "open").length;
    const acknowledged = rows.filter((r) => r.status === "acknowledged").length;
    const resolved = rows.filter((r) => r.status === "resolved").length;
    const totalOccurrences = rows.reduce((s, r) => s + r.occurrenceCount, 0);
    return {
      total: rows.length,
      open,
      acknowledged,
      resolved,
      totalOccurrences,
    };
  },
});

/* ==========================================================================
 * Scheduled retries
 * ========================================================================== */

export const scheduleRetry = internalMutation({
  args: {
    entitySlug: v.string(),
    blockType: v.string(),
    reason: v.string(),
    errorClass: v.string(),
    attempt: v.number(),
    firstAttemptAtMs: v.number(),
    nextAttemptAtMs: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.nextAttemptAtMs <= Date.now()) {
      // We tolerate this — scanDueRetries will pick it up on the next sweep.
      // But we cap nextAttemptAtMs to at least +60s to avoid tight loops.
      args.nextAttemptAtMs = Date.now() + 60_000;
    }
    const id = await ctx.db.insert("pipelineRetries", {
      entitySlug: args.entitySlug,
      blockType: args.blockType,
      reason: args.reason,
      errorClass: args.errorClass,
      attempt: args.attempt,
      firstAttemptAtMs: args.firstAttemptAtMs,
      nextAttemptAtMs: args.nextAttemptAtMs,
      status: "scheduled",
      createdAt: Date.now(),
    });
    return { id };
  },
});

/** Cron-dispatched: returns rows that are due. Caller runs the structuring
 *  pass for each, then calls completeRetry or reschedule. BOUND at 50 per
 *  sweep so one giant backlog doesn't starve the Convex action budget. */
export const scanDueRetries = query({
  args: {
    nowMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.nowMs ?? Date.now();
    const cap = Math.max(1, Math.min(args.limit ?? 50, MAX_LIST));
    // Filter in JS — indexing by_status_next would need a range query
    // `status="scheduled" AND nextAttemptAtMs <= now` which Convex supports
    // via withIndex + lte. For simplicity + portability we scan the
    // status=scheduled subset; operational load stays bounded by status.
    const scheduled = await ctx.db
      .query("pipelineRetries")
      .withIndex("by_status_next", (q) => q.eq("status", "scheduled"))
      .take(cap * 4); // oversample to allow filter
    return scheduled.filter((r) => r.nextAttemptAtMs <= now).slice(0, cap);
  },
});

export const markRetryInFlight = internalMutation({
  args: { id: v.id("pipelineRetries") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return { status: "not_found" as const };
    if (row.status !== "scheduled") return { status: "skipped" as const };
    await ctx.db.patch(args.id, { status: "in_flight" });
    return { status: "in_flight" as const };
  },
});

export const completeRetry = internalMutation({
  args: {
    id: v.id("pipelineRetries"),
    outcome: v.union(
      v.literal("completed"),
      v.literal("dead_lettered"),
      v.literal("canceled"),
    ),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("completeRetry: row not found");
    await ctx.db.patch(args.id, {
      status: args.outcome,
      completedAt: args.outcome === "completed" ? Date.now() : row.completedAt,
      canceledAt: args.outcome === "canceled" ? Date.now() : row.canceledAt,
    });
    return { status: args.outcome };
  },
});

/** User deleted an entity — cancel all scheduled retries for it. */
export const cancelRetriesForEntity = mutation({
  args: { entitySlug: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("pipelineRetries")
      .withIndex("by_entity", (q) => q.eq("entitySlug", args.entitySlug))
      .take(MAX_LIST);
    let canceled = 0;
    for (const r of rows) {
      if (r.status === "scheduled" || r.status === "in_flight") {
        await ctx.db.patch(r._id, {
          status: "canceled",
          canceledAt: Date.now(),
        });
        canceled += 1;
      }
    }
    return { canceled };
  },
});

export const listRetriesForEntity = query({
  args: {
    entitySlug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cap = Math.max(1, Math.min(args.limit ?? 20, MAX_LIST));
    return await ctx.db
      .query("pipelineRetries")
      .withIndex("by_entity", (q) => q.eq("entitySlug", args.entitySlug))
      .order("desc")
      .take(cap);
  },
});

export const rollupRetries = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("pipelineRetries")
      .withIndex("by_status_next")
      .take(MAX_LIST);
    const scheduled = rows.filter((r) => r.status === "scheduled").length;
    const inFlight = rows.filter((r) => r.status === "in_flight").length;
    const completed = rows.filter((r) => r.status === "completed").length;
    const canceled = rows.filter((r) => r.status === "canceled").length;
    const deadLettered = rows.filter((r) => r.status === "dead_lettered").length;
    return {
      total: rows.length,
      scheduled,
      inFlight,
      completed,
      canceled,
      deadLettered,
    };
  },
});
