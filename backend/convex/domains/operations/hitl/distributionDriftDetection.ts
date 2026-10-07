// convex/domains/hitl/distributionDriftDetection.ts
// Distribution Drift Detection & Gates
//
// Implements:
// - Snapshot-based distribution tracking (stratum, topic, domain)
// - Drift scoring (baseline comparison)
// - Revalidation gates when distribution shifts
//
// Addresses defensibility gap: "If distribution shifts (topic/domain/source mix),
// require revalidation before promotion"
//
// ============================================================================

import { v } from "convex/values";
import { internalAction, mutation, query } from "../../../_generated/server";
import type { Id } from "../../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* SNAPSHOT CREATION                                                   */
/* ------------------------------------------------------------------ */

/**
 * Create distribution snapshot for a dataset version
 */
export const createDistributionSnapshot = internalAction({
  args: {
    datasetVersion: v.string(),
    baselineSnapshotId: v.optional(v.string()),
    driftThreshold: v.optional(v.number()),
  },
  returns: v.object({
    snapshotId: v.id("distributionDriftSnapshots"),
    driftScore: v.number(),
    significantDrift: v.boolean(),
    requiresRevalidation: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const driftThreshold = args.driftThreshold ?? 15; // 15% change = significant

    // Get all labeling tasks for this dataset version
    const tasks = await ctx.runQuery(async (ctx) => {
      return await ctx.db
        .query("labelingTasks")
        .filter((q) => q.eq(q.field("status"), "completed"))
        .collect();
    });

    // Compute stratum distribution
    const stratumDistribution: Record<string, number> = {};
    const domainDistribution: Record<string, number> = {};

    for (const task of tasks) {
      stratumDistribution[task.stratum] = (stratumDistribution[task.stratum] ?? 0) + 1;

      // Extract domain if available
      if (task.contextData && task.contextData.domain) {
        const domain = task.contextData.domain;
        domainDistribution[domain] = (domainDistribution[domain] ?? 0) + 1;
      }
    }

    // Convert to percentages
    const totalTasks = tasks.length;
    const stratumPercents: Record<string, number> = {};
    for (const stratum in stratumDistribution) {
      stratumPercents[stratum] = (stratumDistribution[stratum] / totalTasks) * 100;
    }

    let driftScore = 0;
    let driftDetails: Array<{
      dimension: string;
      category: string;
      baselinePercent: number;
      currentPercent: number;
      delta: number;
    }> = [];

    // Compare to baseline if provided
    if (args.baselineSnapshotId) {
      const baseline = await ctx.runQuery(async (ctx) => {
        return await ctx.db
          .query("distributionDriftSnapshots")
          .filter((q) => q.eq(q.field("snapshotId"), args.baselineSnapshotId!))
          .first();
      });

      if (baseline) {
        // Compute drift for each stratum
        const allStrata = new Set([
          ...Object.keys(stratumPercents),
          ...Object.keys(baseline.stratumDistribution),
        ]);

        let totalDelta = 0;
        for (const stratum of allStrata) {
          const currentPercent = stratumPercents[stratum] ?? 0;
          const baselinePercent = baseline.stratumDistribution[stratum] ?? 0;
          const delta = Math.abs(currentPercent - baselinePercent);

          totalDelta += delta;

          if (delta > 0) {
            driftDetails.push({
              dimension: "stratum",
              category: stratum,
              baselinePercent,
              currentPercent,
              delta,
            });
          }
        }

        driftScore = totalDelta / 2; // Divide by 2 because deltas are counted twice
      }
    }

    const significantDrift = driftScore >= driftThreshold;
    const requiresRevalidation = significantDrift;

    // Create snapshot
    const snapshotId = await ctx.runMutation(async (ctx) => {
      return await ctx.db.insert("distributionDriftSnapshots", {
        snapshotId: `drift_${args.datasetVersion}_${Date.now()}`,
        datasetVersion: args.datasetVersion,
        snapshotDate: Date.now(),
        stratumDistribution: stratumPercents,
        domainDistribution,
        baselineSnapshotId: args.baselineSnapshotId,
        driftScore,
        significantDrift,
        driftDetails,
        requiresRevalidation,
        createdAt: Date.now(),
      });
    });

    return {
      snapshotId,
      driftScore,
      significantDrift,
      requiresRevalidation,
    };
  },
});

/* ------------------------------------------------------------------ */
/* DRIFT MONITORING                                                    */
/* ------------------------------------------------------------------ */

/**
 * Get recent distribution snapshots
 */
export const getRecentSnapshots = query({
  args: {
    datasetVersion: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    let query = ctx.db.query("distributionDriftSnapshots");

    if (args.datasetVersion) {
      query = query.withIndex("by_dataset", (q) => q.eq("datasetVersion", args.datasetVersion));
    } else {
      query = query.withIndex("by_drift");
    }

    return await query.order("desc").take(args.limit ?? 50);
  },
});

/**
 * Get snapshots with significant drift
 */
export const getSignificantDriftSnapshots = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    return await ctx.db
      .query("distributionDriftSnapshots")
      .withIndex("by_drift", (q) => q.eq("significantDrift", true))
      .order("desc")
      .collect();
  },
});

/**
 * Compare two snapshots
 */
export const compareSnapshots = query({
  args: {
    snapshot1Id: v.id("distributionDriftSnapshots"),
    snapshot2Id: v.id("distributionDriftSnapshots"),
  },
  returns: v.object({
    snapshot1Date: v.number(),
    snapshot2Date: v.number(),
    driftScore: v.number(),
    changes: v.array(v.object({
      dimension: v.string(),
      category: v.string(),
      snapshot1Percent: v.number(),
      snapshot2Percent: v.number(),
      delta: v.number(),
    })),
  }),
  handler: async (ctx, args) => {
    const snapshot1 = await ctx.db.get(args.snapshot1Id);
    const snapshot2 = await ctx.db.get(args.snapshot2Id);

    if (!snapshot1 || !snapshot2) {
      throw new Error("Snapshot not found");
    }

    // Compare stratum distributions
    const allStrata = new Set([
      ...Object.keys(snapshot1.stratumDistribution),
      ...Object.keys(snapshot2.stratumDistribution),
    ]);

    const changes: Array<{
      dimension: string;
      category: string;
      snapshot1Percent: number;
      snapshot2Percent: number;
      delta: number;
    }> = [];

    let totalDelta = 0;

    for (const stratum of allStrata) {
      const percent1 = snapshot1.stratumDistribution[stratum] ?? 0;
      const percent2 = snapshot2.stratumDistribution[stratum] ?? 0;
      const delta = Math.abs(percent2 - percent1);

      totalDelta += delta;

      if (delta > 0) {
        changes.push({
          dimension: "stratum",
          category: stratum,
          snapshot1Percent: percent1,
          snapshot2Percent: percent2,
          delta,
        });
      }
    }

    // Sort by delta descending
    changes.sort((a, b) => b.delta - a.delta);

    return {
      snapshot1Date: snapshot1.snapshotDate,
      snapshot2Date: snapshot2.snapshotDate,
      driftScore: totalDelta / 2,
      changes,
    };
  },
});

/* ------------------------------------------------------------------ */
/* GATE ENFORCEMENT                                                    */
/* ------------------------------------------------------------------ */

/**
 * Check if dataset promotion is blocked by drift
 */
export const checkDriftGate = query({
  args: {
    datasetVersion: v.string(),
  },
  returns: v.object({
    passed: v.boolean(),
    reason: v.optional(v.string()),
    requiresRevalidation: v.boolean(),
    latestSnapshot: v.optional(v.any()),
  }),
  handler: async (ctx, args) => {
    // Get latest snapshot for this dataset version
    const snapshots = await ctx.db
      .query("distributionDriftSnapshots")
      .withIndex("by_dataset", (q) => q.eq("datasetVersion", args.datasetVersion))
      .order("desc")
      .take(1);

    if (snapshots.length === 0) {
      return {
        passed: false,
        reason: "No distribution snapshot exists",
        requiresRevalidation: true,
      };
    }

    const latestSnapshot = snapshots[0];

    if (latestSnapshot.requiresRevalidation) {
      return {
        passed: false,
        reason: `Significant drift detected (${latestSnapshot.driftScore.toFixed(1)}%), requires revalidation`,
        requiresRevalidation: true,
        latestSnapshot,
      };
    }

    return {
      passed: true,
      requiresRevalidation: false,
      latestSnapshot,
    };
  },
});

/**
 * Acknowledge drift and clear revalidation requirement
 */
export const acknowledgeDriftRevalidation = mutation({
  args: {
    snapshotId: v.id("distributionDriftSnapshots"),
    acknowledgedBy: v.string(),
    revalidationCompletedAt: v.number(),
    revalidationNotes: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // In production: would verify revalidation actually occurred
    await ctx.db.patch(args.snapshotId, {
      requiresRevalidation: false,
      revalidationAcknowledgedBy: args.acknowledgedBy,
      revalidationCompletedAt: args.revalidationCompletedAt,
      revalidationNotes: args.revalidationNotes,
    });

    return null;
  },
});

/* ------------------------------------------------------------------ */
/* TRENDING & ANALYSIS                                                 */
/* ------------------------------------------------------------------ */

/**
 * Get drift trend over time
 */
export const getDriftTrend = query({
  args: {
    datasetVersion: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({
    snapshotDate: v.number(),
    driftScore: v.number(),
    significantDrift: v.boolean(),
    topChanges: v.array(v.object({
      category: v.string(),
      delta: v.number(),
    })),
  })),
  handler: async (ctx, args) => {
    const snapshots = await ctx.db
      .query("distributionDriftSnapshots")
      .withIndex("by_dataset", (q) => q.eq("datasetVersion", args.datasetVersion))
      .order("desc")
      .take(args.limit ?? 30);

    return snapshots.map((snapshot) => {
      const topChanges = (snapshot.driftDetails ?? [])
        .sort((a: any, b: any) => b.delta - a.delta)
        .slice(0, 5)
        .map((d: any) => ({
          category: d.category,
          delta: d.delta,
        }));

      return {
        snapshotDate: snapshot.snapshotDate,
        driftScore: snapshot.driftScore ?? 0,
        significantDrift: snapshot.significantDrift ?? false,
        topChanges,
      };
    });
  },
});

/* ------------------------------------------------------------------ */
/* EXPORTS                                                             */
/* ------------------------------------------------------------------ */

// All functions exported inline
