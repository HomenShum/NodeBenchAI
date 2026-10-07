import { v } from "convex/values";
import { mutation } from "../../_generated/server";
import { buildSuccessLoopsDashboardSnapshot } from "./projection";

const loopTypeValidator = v.union(
  v.literal("problem_selection"),
  v.literal("activation"),
  v.literal("retained_value"),
  v.literal("outcome_attribution"),
  v.literal("distribution_proof"),
  v.literal("revenue_expansion"),
  v.literal("market_sensing"),
  v.literal("organization_learning"),
);

async function upsertRegistryRow(ctx: any, row: {
  loopId: string;
  loopType: string;
  entityType: string;
  entityKey: string;
  goal: string;
  owner: string;
  reviewCadence: string;
  leadingMetrics: any[];
  laggingMetrics: any[];
  interventionTypes: string[];
  currentState: string;
  status: string;
  score: number;
  nextReviewAt: number;
  lastReviewAt?: number;
  notes?: string;
}) {
  const now = Date.now();
  const existing = await ctx.db
    .query("successLoopRegistry")
    .withIndex("by_entity_loop", (q: any) =>
      q.eq("entityType", row.entityType).eq("entityKey", row.entityKey).eq("loopType", row.loopType),
    )
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      ...row,
      updatedAt: now,
    });
    return existing._id;
  }

  return ctx.db.insert("successLoopRegistry", {
    ...row,
    createdAt: now,
    updatedAt: now,
  });
}

export const upsertSuccessLoop = mutation({
  args: {
    loopId: v.string(),
    loopType: loopTypeValidator,
    entityType: v.string(),
    entityKey: v.string(),
    goal: v.string(),
    owner: v.string(),
    reviewCadence: v.string(),
    leadingMetrics: v.array(v.any()),
    laggingMetrics: v.array(v.any()),
    interventionTypes: v.array(v.string()),
    currentState: v.string(),
    status: v.union(
      v.literal("strengthening"),
      v.literal("mixed"),
      v.literal("weakening"),
      v.literal("missing"),
    ),
    score: v.number(),
    lastReviewAt: v.optional(v.number()),
    nextReviewAt: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => upsertRegistryRow(ctx, args),
});

export const recordSuccessLoopEvent = mutation({
  args: {
    loopId: v.string(),
    loopType: loopTypeValidator,
    entityType: v.string(),
    entityKey: v.string(),
    eventKind: v.union(
      v.literal("observation"),
      v.literal("intervention"),
      v.literal("frozen_decision"),
      v.literal("outcome"),
      v.literal("comparison_verdict"),
    ),
    eventType: v.string(),
    title: v.string(),
    summary: v.string(),
    confidence: v.optional(v.number()),
    metricKey: v.optional(v.string()),
    metricValue: v.optional(v.number()),
    sourceRefs: v.optional(v.array(v.any())),
    metadata: v.optional(v.any()),
    observedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return ctx.db.insert("successLoopEvents", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const recordSuccessLoopExperiment = mutation({
  args: {
    experimentKey: v.string(),
    loopId: v.string(),
    loopType: loopTypeValidator,
    entityType: v.string(),
    entityKey: v.string(),
    title: v.string(),
    hypothesis: v.string(),
    owner: v.string(),
    status: v.union(
      v.literal("planned"),
      v.literal("running"),
      v.literal("validated"),
      v.literal("rejected"),
      v.literal("watch"),
    ),
    expectedEffect: v.string(),
    observationWindowDays: v.number(),
    expectedMetricKeys: v.array(v.string()),
    observedMetricKeys: v.optional(v.array(v.string())),
    baselineSummary: v.optional(v.string()),
    outcomeSummary: v.optional(v.string()),
    observedDelta: v.optional(v.number()),
    sourceRefs: v.optional(v.array(v.any())),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("successLoopExperiments")
      .withIndex("by_entity_created", (q: any) =>
        q.eq("entityType", args.entityType).eq("entityKey", args.entityKey),
      )
      .filter((q: any) => q.eq(q.field("experimentKey"), args.experimentKey))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: now,
      });
      return existing._id;
    }

    return ctx.db.insert("successLoopExperiments", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const createFrozenDecision = mutation({
  args: {
    decisionKey: v.string(),
    loopId: v.optional(v.string()),
    loopType: v.optional(loopTypeValidator),
    entityType: v.string(),
    entityKey: v.string(),
    decisionType: v.union(
      v.literal("strategy"),
      v.literal("launch"),
      v.literal("pricing"),
      v.literal("gtm"),
      v.literal("product"),
      v.literal("workflow"),
    ),
    title: v.string(),
    hypothesis: v.string(),
    recommendation: v.string(),
    expectedOutcomeSummary: v.optional(v.string()),
    observationWindowDays: v.optional(v.number()),
    owner: v.string(),
    confidence: v.number(),
    limitations: v.array(v.string()),
    alternatives: v.optional(v.array(v.string())),
    sourceRefs: v.optional(v.array(v.any())),
    status: v.union(v.literal("frozen"), v.literal("linked"), v.literal("superseded")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("frozenDecisions")
      .withIndex("by_decision_key", (q: any) => q.eq("decisionKey", args.decisionKey))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: now,
      });
      return existing._id;
    }

    return ctx.db.insert("frozenDecisions", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const linkDecisionOutcome = mutation({
  args: {
    decisionKey: v.string(),
    loopId: v.optional(v.string()),
    loopType: v.optional(loopTypeValidator),
    entityType: v.string(),
    entityKey: v.string(),
    outcomeType: v.string(),
    title: v.string(),
    actualOutcome: v.string(),
    comparisonVerdict: v.union(
      v.literal("validated"),
      v.literal("partially_validated"),
      v.literal("invalidated"),
      v.literal("inconclusive"),
    ),
    confidence: v.optional(v.number()),
    outcomeMetrics: v.optional(v.array(v.any())),
    sourceRefs: v.optional(v.array(v.any())),
    observedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return ctx.db.insert("successOutcomeLinks", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const syncSourceRecordToTrajectory = mutation({
  args: {},
  handler: async (ctx) => {
    const snapshot = await buildSuccessLoopsDashboardSnapshot(ctx, null);
    const ids = await Promise.all(
      snapshot.loops.map((loop) =>
        upsertRegistryRow(ctx, {
          loopId: loop.loopId,
          loopType: loop.loopType,
          entityType: snapshot.entityType ?? "product",
          entityKey: snapshot.entityKey ?? "product:nodebench-ai",
          goal: loop.goal,
          owner: loop.owner,
          reviewCadence: loop.reviewCadence,
          leadingMetrics: loop.leadingMetrics,
          laggingMetrics: loop.laggingMetrics,
          interventionTypes: loop.interventionTypes,
          currentState: loop.currentState,
          status: loop.status,
          score: loop.score,
          lastReviewAt: loop.lastReviewAt,
          nextReviewAt: loop.nextReviewAt,
        }),
      ),
    );
    return { synced: ids.length, generatedAt: snapshot.generatedAt };
  },
});

export const rebuildTrajectoryEntity = mutation({
  args: {},
  handler: async (ctx) => {
    const snapshot = await buildSuccessLoopsDashboardSnapshot(ctx, null);
    const deleted = await Promise.all(
      snapshot.loops.map(async (loop) => {
        const existing = await ctx.db
          .query("successLoopRegistry")
          .withIndex("by_entity_loop", (q: any) =>
            q.eq("entityType", snapshot.entityType ?? "product")
              .eq("entityKey", snapshot.entityKey ?? "product:nodebench-ai")
              .eq("loopType", loop.loopType),
          )
          .collect();
        await Promise.all(existing.map((row: any) => ctx.db.delete(row._id)));
        return existing.length;
      }),
    );

    const synced = await Promise.all(
      snapshot.loops.map((loop) =>
        upsertRegistryRow(ctx, {
          loopId: loop.loopId,
          loopType: loop.loopType,
          entityType: snapshot.entityType ?? "product",
          entityKey: snapshot.entityKey ?? "product:nodebench-ai",
          goal: loop.goal,
          owner: loop.owner,
          reviewCadence: loop.reviewCadence,
          leadingMetrics: loop.leadingMetrics,
          laggingMetrics: loop.laggingMetrics,
          interventionTypes: loop.interventionTypes,
          currentState: loop.currentState,
          status: loop.status,
          score: loop.score,
          lastReviewAt: loop.lastReviewAt,
          nextReviewAt: loop.nextReviewAt,
        }),
      ),
    );

    return {
      deleted: deleted.reduce((sum, count) => sum + count, 0),
      rebuilt: synced.length,
      generatedAt: snapshot.generatedAt,
    };
  },
});

export const computeTrajectorySummary = mutation({
  args: {},
  handler: async (ctx) => {
    const snapshot = await buildSuccessLoopsDashboardSnapshot(ctx, null);
    return snapshot.summary;
  },
});

export const computeCompoundingForEntity = mutation({
  args: {},
  handler: async (ctx) => {
    const snapshot = await buildSuccessLoopsDashboardSnapshot(ctx, null);
    const retainedValue = snapshot.loops.find((loop) => loop.loopType === "retained_value");
    const revenueExpansion = snapshot.loops.find((loop) => loop.loopType === "revenue_expansion");
    const distributionProof = snapshot.loops.find((loop) => loop.loopType === "distribution_proof");

    return {
      trustAdjustedCompounding:
        ((retainedValue?.score ?? 0) * 0.4) +
        ((revenueExpansion?.score ?? 0) * 0.35) +
        ((distributionProof?.score ?? 0) * 0.25),
      weakestLoop: snapshot.summary.weakestLoop,
      strongestLoop: snapshot.summary.strongestLoop,
      generatedAt: snapshot.generatedAt,
    };
  },
});
