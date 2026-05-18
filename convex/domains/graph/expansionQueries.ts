/**
 * Expansion run status queries — real-time subscription support for the UI.
 *
 * The mention chip subscribes to these queries to show real-time expansion
 * progress (queued → searching → extracting → persisting → completed).
 *
 * Invariants:
 *   BOUND_READ — max 20 runs per query
 *   HONEST_STATUS — exposes actual run status, never fabricated
 *
 * See: docs/architecture/EXPANDABLE_GRAPH_NOTEBOOK.md §6.1
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";

/** BOUND_READ: max expansion runs returned per query */
const MAX_RUNS_PER_QUERY = 20;

// ── Get latest expansion run for an entity ───────────────────────────

export const getLatestRun = query({
  args: {
    targetEntityId: v.id("entityProfiles"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("expansionRuns")
      .withIndex("by_entity", (q) =>
        q.eq("targetEntityId", args.targetEntityId),
      )
      .order("desc")
      .first();
  },
});

// ── Get expansion run by runId ───────────────────────────────────────

export const getRunByRunId = query({
  args: {
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("expansionRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();
  },
});

// ── Get all expansion runs for a user ────────────────────────────────

export const getRunsByUser = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? MAX_RUNS_PER_QUERY, MAX_RUNS_PER_QUERY);

    return await ctx.db
      .query("expansionRuns")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit);
  },
});

// ── Get active (in-progress) expansion runs ──────────────────────────

export const getActiveRuns = query({
  args: {},
  handler: async (ctx) => {
    const statuses = ["queued", "searching", "extracting", "persisting"] as const;
    const results = await Promise.all(
      statuses.map((status) =>
        ctx.db
          .query("expansionRuns")
          .withIndex("by_status", (q) => q.eq("status", status))
          .take(5),
      ),
    );
    const active = results.flat();

    // BOUND_READ
    return active.slice(0, MAX_RUNS_PER_QUERY);
  },
});

// ── Get expansion history for an entity (all completed runs) ─────────

export const getEntityExpansionHistory = query({
  args: {
    targetEntityId: v.id("entityProfiles"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 10, MAX_RUNS_PER_QUERY);

    const runs = await ctx.db
      .query("expansionRuns")
      .withIndex("by_entity", (q) =>
        q.eq("targetEntityId", args.targetEntityId),
      )
      .order("desc")
      .take(limit);

    return runs.map((r) => ({
      runId: r.runId,
      status: r.status,
      claimsCreated: r.claimsCreated,
      edgesCreated: r.edgesCreated,
      sourcesFound: r.sourcesFound,
      searchQueries: r.searchQueries,
      wallClockMs: r.wallClockMs,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      errorMessage: r.errorMessage,
    }));
  },
});

// ── Check if an entity is currently being expanded ───────────────────

export const isExpanding = query({
  args: {
    targetEntityId: v.id("entityProfiles"),
  },
  handler: async (ctx, args) => {
    const latestRun = await ctx.db
      .query("expansionRuns")
      .withIndex("by_entity", (q) =>
        q.eq("targetEntityId", args.targetEntityId),
      )
      .order("desc")
      .first();

    if (!latestRun) return { expanding: false, status: null };

    const isActive = ["queued", "searching", "extracting", "persisting"].includes(
      latestRun.status,
    );

    return {
      expanding: isActive,
      status: latestRun.status,
      runId: latestRun.runId,
      progress: isActive
        ? {
            searchQueries: latestRun.searchQueries,
            maxSearchQueries: latestRun.maxSearchQueries,
          }
        : undefined,
    };
  },
});
