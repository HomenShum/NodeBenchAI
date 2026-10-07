import { v } from "convex/values";
import { Doc } from "../../_generated/dataModel";
import { internalMutation } from "../../_generated/server";

/**
 * Store calculated metrics in dailyBriefSnapshots table.
 *
 * This lives outside of Node.js runtime modules so it can be a mutation.
 */
export const storeDashboardMetrics = internalMutation({
  args: {
    dashboardMetrics: v.any(),
    sourceSummary: v.any(),
    processingTimeMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dateString = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const generatedAt = Date.now();

    // Check if we already have a snapshot for today
    const existing = (await ctx.db
      .query("dailyBriefSnapshots")
      .withIndex("by_date_string", (q) => q.eq("dateString", dateString))
      .first()) as Doc<"dailyBriefSnapshots"> | null;

    const version = existing ? existing.version + 1 : 1;

    // Insert new snapshot
    const snapshotId = await ctx.db.insert("dailyBriefSnapshots", {
      dateString,
      generatedAt,
      dashboardMetrics: args.dashboardMetrics,
      sourceSummary: args.sourceSummary,
      version,
      processingTimeMs: args.processingTimeMs,
    });

    console.log(
      `[dashboardMutations] Stored snapshot for ${dateString} (version ${version})`,
    );

    return { snapshotId, dateString, version };
  },
});

export const patchDashboardEntityGraph = internalMutation({
  args: {
    snapshotId: v.id("dailyBriefSnapshots"),
    entityGraph: v.any(),
  },
  handler: async (ctx, args) => {
    const snapshot = (await ctx.db.get(args.snapshotId)) as Doc<"dailyBriefSnapshots"> | null;
    if (!snapshot) throw new Error("Snapshot not found");

    const currentMetrics =
      snapshot.dashboardMetrics && typeof snapshot.dashboardMetrics === "object"
        ? snapshot.dashboardMetrics
        : {};

    await ctx.db.patch(snapshot._id, {
      dashboardMetrics: {
        ...currentMetrics,
        entityGraph: args.entityGraph,
      },
    });

    return { ok: true };
  },
});
