/**
 * Consistency Index Queries & Mutations
 *
 * Separated from consistencyIndex.ts because Convex requires that
 * "use node" files only export actions.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "../../_generated/server";

// ============================================================================
// Constants — BOUND limits
// ============================================================================

/** BOUND: Max active (unresolved) alerts returned in a single query */
const MAX_ACTIVE_ALERTS = 50;
/** BOUND: Max recent decisions scanned when checking for conflicts */
const MAX_RECENT_DECISIONS = 20;

// ============================================================================
// Internal Helper Queries
// ============================================================================

/** @internal Fetch a mission by ID */
export const getMission = internalQuery({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.missionId);
  },
});

/** @internal Fetch recent decision memory entries by fingerprint within time window */
export const getRecentDecisionsByFingerprint = internalQuery({
  args: {
    fingerprint: v.string(),
    windowStart: v.number(),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("decisionMemory")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", args.fingerprint))
      .order("desc")
      .take(MAX_RECENT_DECISIONS);

    // Filter to time window in application code (index doesn't support gte on second field in Convex)
    return results.filter((r) => r.createdAt >= args.windowStart);
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Log a consistency alert into the consistencyAlerts table.
 *
 * Called by recordConsistencyEntry when a conflict is detected.
 */
export const logConsistencyAlert = internalMutation({
  args: {
    scenarioFingerprint: v.string(),
    agentA: v.string(),
    agentB: v.string(),
    verdictA: v.string(),
    verdictB: v.string(),
    confidenceA: v.number(),
    confidenceB: v.number(),
    missionIdA: v.optional(v.id("missions")),
    missionIdB: v.optional(v.id("missions")),
    conflictType: v.union(
      v.literal("verdict_mismatch"),
      v.literal("confidence_divergence"),
      v.literal("recommendation_conflict"),
    ),
    severity: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("consistencyAlerts", {
      scenarioFingerprint: args.scenarioFingerprint,
      agentA: args.agentA,
      agentB: args.agentB,
      verdictA: args.verdictA,
      verdictB: args.verdictB,
      confidenceA: args.confidenceA,
      confidenceB: args.confidenceB,
      missionIdA: args.missionIdA,
      missionIdB: args.missionIdB,
      conflictType: args.conflictType,
      severity: args.severity,
      createdAt: Date.now(),
    });
  },
});

/**
 * Resolve a consistency conflict (human or automated resolution).
 */
export const resolveConflict = mutation({
  args: {
    alertId: v.id("consistencyAlerts"),
    resolvedBy: v.string(),
    resolution: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.alertId, {
      resolvedAt: Date.now(),
      resolvedBy: args.resolvedBy,
      resolution: args.resolution,
    });
  },
});

// ============================================================================
// Public Queries
// ============================================================================

/**
 * Get all unresolved consistency alerts, most recent first.
 *
 * BOUND: Returns at most MAX_ACTIVE_ALERTS entries.
 */
export const getActiveConflicts = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cap = Math.min(args.limit ?? MAX_ACTIVE_ALERTS, MAX_ACTIVE_ALERTS);
    const results = await ctx.db
      .query("consistencyAlerts")
      .withIndex("by_unresolved", (q) => q.eq("resolvedAt", undefined))
      .order("desc")
      .take(cap);
    return results;
  },
});

/**
 * Get consistency alerts for a specific scenario fingerprint.
 *
 * BOUND: Returns at most 20 entries.
 */
export const getConflictsByFingerprint = query({
  args: {
    scenarioFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("consistencyAlerts")
      .withIndex("by_fingerprint", (q) =>
        q.eq("scenarioFingerprint", args.scenarioFingerprint),
      )
      .order("desc")
      .take(20);
    return results;
  },
});

/**
 * Get aggregate conflict statistics for the dashboard.
 *
 * BOUND: Scans at most MAX_ACTIVE_ALERTS unresolved entries.
 */
export const getConflictStats = query({
  args: {},
  handler: async (ctx) => {
    const unresolved = await ctx.db
      .query("consistencyAlerts")
      .withIndex("by_unresolved", (q) => q.eq("resolvedAt", undefined))
      .order("desc")
      .take(MAX_ACTIVE_ALERTS);

    let highSeverity = 0;
    let mediumSeverity = 0;
    let lowSeverity = 0;

    for (const alert of unresolved) {
      switch (alert.severity) {
        case "high":
          highSeverity++;
          break;
        case "medium":
          mediumSeverity++;
          break;
        case "low":
          lowSeverity++;
          break;
      }
    }

    return {
      totalUnresolved: unresolved.length,
      highSeverity,
      mediumSeverity,
      lowSeverity,
    };
  },
});
