// convex/globalResearch/runs.ts
// Global research run lifecycle management.
// Each run = one attempt to refresh a query's cached results.

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { Doc } from "../_generated/dataModel";
import { hashSync } from "../../shared/artifacts";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type RunStatus = "scheduled" | "running" | "completed" | "failed";

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new research run.
 * Called when acquiring a lock for a fresh query.
 */
export const createRun = internalMutation({
  args: {
    researchRunId: v.string(),
    queryKey: v.string(),
    entityKey: v.optional(v.string()),
    ttlMs: v.number(),
  },
  returns: v.id("globalResearchRuns"),
  handler: async (ctx, { researchRunId, queryKey, entityKey, ttlMs }) => {
    const now = Date.now();

    // Get next version for this queryKey
    const latestRun = await ctx.db
      .query("globalResearchRuns")
      .withIndex("by_queryKey_sortTs", (q) => q.eq("queryKey", queryKey))
      .order("desc")
      .first() as Doc<"globalResearchRuns"> | null;

    const version = (latestRun?.version ?? 0) + 1;

    const id = await ctx.db.insert("globalResearchRuns", {
      researchRunId,
      queryKey,
      entityKey: entityKey ?? "", // Empty string for unscoped
      status: "scheduled",
      version,
      ttlMs,
      expiresAt: now + ttlMs, // Will be updated when started
      sortTs: now,
      scheduledAt: now,
    });

    console.log(
      `[globalResearch/runs] Created run: ${researchRunId}`,
      { queryKey, version }
    );

    return id;
  },
});

/**
 * Mark a run as started.
 */
export const startRun = internalMutation({
  args: {
    researchRunId: v.string(),
  },
  handler: async (ctx, { researchRunId }) => {
    const run = await ctx.db
      .query("globalResearchRuns")
      .withIndex("by_researchRunId", (q) => q.eq("researchRunId", researchRunId))
      .first() as Doc<"globalResearchRuns"> | null;

    if (!run) {
      console.error(`[globalResearch/runs] Run not found: ${researchRunId}`);
      return { success: false, reason: "not_found" };
    }

    const now = Date.now();

    await ctx.db.patch(run._id, {
      status: "running",
      startedAt: now,
      sortTs: now,
      expiresAt: now + run.ttlMs,
    });

    return { success: true };
  },
});

/**
 * Mark a run as completed.
 */
export const completeRun = internalMutation({
  args: {
    researchRunId: v.string(),
    artifactCount: v.optional(v.number()),
  },
  handler: async (ctx, { researchRunId, artifactCount }) => {
    const run = await ctx.db
      .query("globalResearchRuns")
      .withIndex("by_researchRunId", (q) => q.eq("researchRunId", researchRunId))
      .first() as Doc<"globalResearchRuns"> | null;

    if (!run) {
      console.error(`[globalResearch/runs] Run not found: ${researchRunId}`);
      return { success: false, reason: "not_found" };
    }

    const now = Date.now();

    await ctx.db.patch(run._id, {
      status: "completed",
      finishedAt: now,
      artifactCount,
    });

    console.log(
      `[globalResearch/runs] Completed run: ${researchRunId}`,
      { artifactCount, durationMs: now - (run.startedAt ?? run.scheduledAt) }
    );

    return { success: true };
  },
});

/**
 * Mark a run as failed.
 */
export const failRun = internalMutation({
  args: {
    researchRunId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, { researchRunId, error }) => {
    const run = await ctx.db
      .query("globalResearchRuns")
      .withIndex("by_researchRunId", (q) => q.eq("researchRunId", researchRunId))
      .first() as Doc<"globalResearchRuns"> | null;

    if (!run) {
      console.error(`[globalResearch/runs] Run not found: ${researchRunId}`);
      return { success: false, reason: "not_found" };
    }

    await ctx.db.patch(run._id, {
      status: "failed",
      finishedAt: Date.now(),
      error,
    });

    console.error(
      `[globalResearch/runs] Failed run: ${researchRunId}`,
      { error }
    );

    return { success: true };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get a run by its ID.
 */
export const getByRunId = internalQuery({
  args: {
    researchRunId: v.string(),
  },
  handler: async (ctx, { researchRunId }) => {
    return ctx.db
      .query("globalResearchRuns")
      .withIndex("by_researchRunId", (q) => q.eq("researchRunId", researchRunId))
      .first();
  },
});

/**
 * Get the latest run for a query (any status).
 */
export const getLatestByQuery = internalQuery({
  args: {
    queryKey: v.string(),
  },
  handler: async (ctx, { queryKey }) => {
    return ctx.db
      .query("globalResearchRuns")
      .withIndex("by_queryKey_sortTs", (q) => q.eq("queryKey", queryKey))
      .order("desc")
      .first();
  },
});

/**
 * Get the latest completed run for a query.
 */
export const getLatestCompletedByQuery = internalQuery({
  args: {
    queryKey: v.string(),
  },
  handler: async (ctx, { queryKey }) => {
    return ctx.db
      .query("globalResearchRuns")
      .withIndex("by_queryKey_status_sortTs", (q) =>
        q.eq("queryKey", queryKey).eq("status", "completed")
      )
      .order("desc")
      .first();
  },
});

/**
 * Check if a query has a valid (non-expired) cached run.
 */
export const checkCacheStatus = internalQuery({
  args: {
    queryKey: v.string(),
  },
  returns: v.union(
    v.object({
      hasCache: v.literal(true),
      researchRunId: v.string(),
      version: v.number(),
      expiresAt: v.number(),
      isExpired: v.boolean(),
      artifactCount: v.optional(v.number()),
    }),
    v.object({
      hasCache: v.literal(false),
    })
  ),
  handler: async (ctx, { queryKey }) => {
    const latestCompleted = await ctx.db
      .query("globalResearchRuns")
      .withIndex("by_queryKey_status_sortTs", (q) =>
        q.eq("queryKey", queryKey).eq("status", "completed")
      )
      .order("desc")
      .first() as Doc<"globalResearchRuns"> | null;

    if (!latestCompleted) {
      return { hasCache: false as const };
    }

    const now = Date.now();
    const isExpired = now >= latestCompleted.expiresAt;

    return {
      hasCache: true as const,
      researchRunId: latestCompleted.researchRunId,
      version: latestCompleted.version,
      expiresAt: latestCompleted.expiresAt,
      isExpired,
      artifactCount: latestCompleted.artifactCount,
    };
  },
});

/**
 * Get run history for a query.
 */
export const getRunHistory = internalQuery({
  args: {
    queryKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { queryKey, limit = 10 }) => {
    return ctx.db
      .query("globalResearchRuns")
      .withIndex("by_queryKey_sortTs", (q) => q.eq("queryKey", queryKey))
      .order("desc")
      .take(limit);
  },
});

/**
 * Get runs for an entity.
 * WARNING: Only use when entityKey !== "".
 */
export const getRunsByEntity = internalQuery({
  args: {
    entityKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { entityKey, limit = 50 }) => {
    if (!entityKey) {
      console.warn("[globalResearch/runs] getRunsByEntity called with empty entityKey");
      return [];
    }

    return ctx.db
      .query("globalResearchRuns")
      .withIndex("by_entityKey_sortTs", (q) => q.eq("entityKey", entityKey))
      .order("desc")
      .take(limit);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// EVENT LOGGING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate an event key for idempotency.
 * Key = hash(researchRunId + kind + artifactKey + seq)
 */
function generateEventKey(
  researchRunId: string,
  kind: string,
  artifactKey: string | undefined,
  seq: number
): string {
  const input = `${researchRunId}|${kind}|${artifactKey ?? ""}|${seq}`;
  return hashSync(input);
}

/**
 * Append an event to a research run.
 * Only the run owner should call this (prevents race conditions).
 */
export const appendEvent = internalMutation({
  args: {
    researchRunId: v.string(),
    kind: v.union(
      v.literal("artifact_added"),
      v.literal("artifact_updated"),
      v.literal("artifact_removed"),
      v.literal("fact_extracted"),
      v.literal("run_started"),
      v.literal("run_completed"),
      v.literal("run_failed")
    ),
    payload: v.any(),
    artifactKey: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ success: v.literal(true), eventId: v.id("globalResearchEvents") }),
    v.object({ success: v.literal(false), reason: v.string() })
  ),
  handler: async (ctx, { researchRunId, kind, payload, artifactKey }) => {
    // Get next seq for this run
    const lastEvent = await ctx.db
      .query("globalResearchEvents")
      .withIndex("by_runId_seq", (q) => q.eq("researchRunId", researchRunId))
      .order("desc")
      .first() as Doc<"globalResearchEvents"> | null;

    const seq = (lastEvent?.seq ?? 0) + 1;
    const eventKey = generateEventKey(researchRunId, kind, artifactKey, seq);
    const now = Date.now();

    const id = await ctx.db.insert("globalResearchEvents", {
      researchRunId,
      eventKey,
      seq,
      kind,
      payload,
      createdAt: now,
    });

    return { success: true as const, eventId: id };
  },
});

/**
 * Get events for a research run.
 */
export const getEventsByRun = internalQuery({
  args: {
    researchRunId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { researchRunId, limit = 100 }) => {
    return ctx.db
      .query("globalResearchEvents")
      .withIndex("by_runId_seq", (q) => q.eq("researchRunId", researchRunId))
      .order("asc")
      .take(limit);
  },
});

/**
 * Get events since a specific sequence number.
 * Useful for delta computation.
 */
export const getEventsSinceSeq = internalQuery({
  args: {
    researchRunId: v.string(),
    sinceSeq: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { researchRunId, sinceSeq, limit = 100 }) => {
    const events = await ctx.db
      .query("globalResearchEvents")
      .withIndex("by_runId_seq", (q) => q.eq("researchRunId", researchRunId))
      .order("asc")
      .take(1000) as Doc<"globalResearchEvents">[];

    // Filter in memory (Convex doesn't support gt on compound index second field)
    return events.filter((e: Doc<"globalResearchEvents">) => e.seq > sinceSeq).slice(0, limit);
  },
});
