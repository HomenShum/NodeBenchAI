import { v } from "convex/values";
import { mutation } from "../../_generated/server";
import { buildTrajectoryProjection, normalizeTrajectoryArgs } from "./projection";

const DELETE_BATCH_SIZE = 200; // BOUND: prevent OOM / mutation timeout on large entities

async function deleteByEntity(ctx: any, tableName: string, entityType: string, entityKey: string, indexName: string) {
  // Paginated delete: process in batches to stay within Convex mutation limits
  let deleted = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await ctx.db
      .query(tableName)
      .withIndex(indexName, (q: any) => q.eq("entityType", entityType).eq("entityKey", entityKey))
      .take(DELETE_BATCH_SIZE);
    if (batch.length === 0) break;
    await Promise.all(batch.map((row: any) => ctx.db.delete(row._id)));
    deleted += batch.length;
    if (batch.length < DELETE_BATCH_SIZE) break; // last page
  }
  return deleted;
}

export const recordFeedbackEvent = mutation({
  args: {
    entityKey: v.string(),
    entityType: v.string(),
    eventType: v.string(),
    status: v.string(),
    title: v.string(),
    summary: v.string(),
    observationWindowStartAt: v.number(),
    observationWindowEndAt: v.number(),
    observedAt: v.number(),
    outcomeScore: v.optional(v.number()),
    scoreDelta: v.optional(v.number()),
    sourceRecordType: v.optional(v.string()),
    sourceRecordId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const normalized = normalizeTrajectoryArgs(args);
    const now = Date.now();
    // Destructure to exclude raw entityKey/entityType, then apply normalized values
    const { entityKey: _ek, entityType: _et, ...rest } = args;
    return ctx.db.insert("trajectoryFeedbackEvents", {
      ...rest,
      entityKey: normalized.entityKey,
      entityType: normalized.entityType,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const recordInterventionEvent = mutation({
  args: {
    entityKey: v.string(),
    entityType: v.string(),
    title: v.string(),
    status: v.string(),
    actor: v.string(),
    summary: v.string(),
    rationale: v.string(),
    linkedSpanKeys: v.optional(v.array(v.string())),
    expectedWindowStartAt: v.number(),
    expectedWindowEndAt: v.number(),
    observedWindowStartAt: v.optional(v.number()),
    observedWindowEndAt: v.optional(v.number()),
    expectedScoreDelta: v.optional(v.number()),
    observedScoreDelta: v.optional(v.number()),
    sourceRecordType: v.optional(v.string()),
    sourceRecordId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const normalized = normalizeTrajectoryArgs(args);
    const now = Date.now();
    const { entityKey: _ek, entityType: _et, ...rest } = args;
    return ctx.db.insert("trajectoryInterventionEvents", {
      ...rest,
      entityKey: normalized.entityKey,
      entityType: normalized.entityType,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const recordTrustNode = mutation({
  args: {
    entityKey: v.string(),
    entityType: v.string(),
    nodeKey: v.string(),
    nodeType: v.union(
      v.literal("person"),
      v.literal("institution"),
      v.literal("channel"),
      v.literal("platform"),
    ),
    label: v.string(),
    influenceScore: v.number(),
    notes: v.optional(v.string()),
    sourceRecordType: v.optional(v.string()),
    sourceRecordId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const normalized = normalizeTrajectoryArgs(args);
    const now = Date.now();
    const existing = await ctx.db
      .query("trajectoryTrustNodes")
      .withIndex("by_node_key", (q: any) => q.eq("nodeKey", args.nodeKey))
      .unique();
    const { entityKey: _ek, entityType: _et, ...rest } = args;
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...rest,
        entityKey: normalized.entityKey,
        entityType: normalized.entityType,
        updatedAt: now,
      });
      return existing._id;
    }
    return ctx.db.insert("trajectoryTrustNodes", {
      ...rest,
      entityKey: normalized.entityKey,
      entityType: normalized.entityType,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const annotateTrustEdge = mutation({
  args: {
    entityKey: v.string(),
    entityType: v.string(),
    nodeKey: v.string(),
    edgeType: v.string(),
    summary: v.string(),
    leverageScore: v.number(),
    confidence: v.optional(v.number()),
    sourceRecordType: v.optional(v.string()),
    sourceRecordId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const normalized = normalizeTrajectoryArgs(args);
    const now = Date.now();
    const { entityKey: _ek, entityType: _et, ...rest } = args;
    return ctx.db.insert("trajectoryTrustEdges", {
      ...rest,
      entityKey: normalized.entityKey,
      entityType: normalized.entityType,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const rebuildTrajectoryEntity = mutation({
  args: {
    entityKey: v.string(),
    entityType: v.string(),
    windowDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const normalized = normalizeTrajectoryArgs(args);
    const projection = await buildTrajectoryProjection(ctx, normalized);
    const now = Date.now();

    const existingEntity = await ctx.db
      .query("trajectoryEntities")
      .withIndex("by_entity", (q: any) => q.eq("entityType", normalized.entityType).eq("entityKey", normalized.entityKey))
      .unique();

    await Promise.all([
      deleteByEntity(ctx, "trajectorySpans", normalized.entityType, normalized.entityKey, "by_entity_created"),
      deleteByEntity(ctx, "trajectoryEvidenceBundles", normalized.entityType, normalized.entityKey, "by_entity_created"),
      deleteByEntity(ctx, "trajectoryJudgeVerdicts", normalized.entityType, normalized.entityKey, "by_entity_created"),
      deleteByEntity(ctx, "trajectoryBenchmarkRuns", normalized.entityType, normalized.entityKey, "by_entity_created"),
    ]);

    const summaryDoc = await ctx.db
      .query("trajectorySummaries")
      .withIndex("by_entity_window", (q: any) => q.eq("entityType", normalized.entityType).eq("entityKey", normalized.entityKey).eq("windowDays", projection.summary.window.windowDays))
      .unique();
    const scoreDoc = await ctx.db
      .query("trajectoryCompoundingScores")
      .withIndex("by_entity_window", (q: any) => q.eq("entityType", normalized.entityType).eq("entityKey", normalized.entityKey).eq("windowDays", projection.summary.window.windowDays))
      .unique();

    await Promise.all(
      projection.spans.map((span) =>
        ctx.db.insert("trajectorySpans", {
          entityKey: normalized.entityKey,
          entityType: normalized.entityType,
          ...span,
        }),
      ),
    );
    await Promise.all(
      projection.evidenceBundles.map((bundle) =>
        ctx.db.insert("trajectoryEvidenceBundles", {
          entityKey: normalized.entityKey,
          entityType: normalized.entityType,
          ...bundle,
        }),
      ),
    );
    await Promise.all(
      projection.verdicts.map((verdict) =>
        ctx.db.insert("trajectoryJudgeVerdicts", {
          entityKey: normalized.entityKey,
          entityType: normalized.entityType,
          ...verdict,
        }),
      ),
    );
    await Promise.all(
      projection.benchmarkRuns.map((run) =>
        ctx.db.insert("trajectoryBenchmarkRuns", {
          entityKey: normalized.entityKey,
          entityType: normalized.entityType,
          ...run,
        }),
      ),
    );

    const summaryPayload = {
      entityKey: normalized.entityKey,
      entityType: normalized.entityType,
      windowDays: projection.summary.window.windowDays,
      summary: projection.summary.summary,
      narrative: projection.summary.narrative,
      nextReviewAt: projection.summary.nextReviewAt,
      spanCount: projection.summary.spanCount,
      evidenceBundleCount: projection.summary.evidenceBundleCount,
      verdictCount: projection.summary.verdictCount,
      feedbackCount: projection.summary.feedbackCount,
      interventionCount: projection.summary.interventionCount,
      benchmarkCount: projection.summary.benchmarkCount,
      trustNodeCount: projection.summary.trustNodeCount,
      trustEdgeCount: projection.summary.trustEdgeCount,
      topInterventions: projection.summary.topInterventions,
      scoreBreakdown: projection.scoreBreakdown,
      createdAt: summaryDoc?._creationTime ?? now,
      updatedAt: now,
    };
    const scorePayload = {
      entityKey: normalized.entityKey,
      entityType: normalized.entityType,
      windowDays: projection.summary.window.windowDays,
      rawScore: projection.scoreBreakdown.rawCompounding.score,
      rawLabel: projection.scoreBreakdown.rawCompounding.label,
      rawExplanation: projection.scoreBreakdown.rawCompounding.explanation,
      trustAdjustedScore: projection.scoreBreakdown.trustAdjustedCompounding.score,
      trustAdjustedLabel: projection.scoreBreakdown.trustAdjustedCompounding.label,
      trustAdjustedExplanation: projection.scoreBreakdown.trustAdjustedCompounding.explanation,
      driftScore: projection.scoreBreakdown.drift.score,
      driftLabel: projection.scoreBreakdown.drift.label,
      driftExplanation: projection.scoreBreakdown.drift.explanation,
      createdAt: scoreDoc?._creationTime ?? now,
      updatedAt: now,
    };

    const summaryId = summaryDoc
      ? (await ctx.db.patch(summaryDoc._id, summaryPayload), summaryDoc._id)
      : await ctx.db.insert("trajectorySummaries", summaryPayload);
    const scoreId = scoreDoc
      ? (await ctx.db.patch(scoreDoc._id, scorePayload), scoreDoc._id)
      : await ctx.db.insert("trajectoryCompoundingScores", scorePayload);

    if (existingEntity) {
      await ctx.db.patch(existingEntity._id, {
        label: projection.entity.label,
        description: projection.entity.description,
        activePopulation: projection.entity.activePopulation,
        sourceBacklinks: projection.entity.sourceBacklinks,
        latestSummaryId: summaryId,
        latestCompoundingScoreId: scoreId,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("trajectoryEntities", {
        entityKey: normalized.entityKey,
        entityType: normalized.entityType,
        label: projection.entity.label,
        description: projection.entity.description,
        activePopulation: projection.entity.activePopulation,
        sourceBacklinks: projection.entity.sourceBacklinks,
        latestSummaryId: summaryId,
        latestCompoundingScoreId: scoreId,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      entityKey: normalized.entityKey,
      entityType: normalized.entityType,
      summaryId,
      scoreId,
    };
  },
});

export const computeTrajectorySummary = mutation({
  args: {
    entityKey: v.string(),
    entityType: v.string(),
    windowDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => rebuildTrajectoryEntity.handler(ctx, args as any),
});

export const computeCompoundingForEntity = mutation({
  args: {
    entityKey: v.string(),
    entityType: v.string(),
    windowDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => rebuildTrajectoryEntity.handler(ctx, args as any),
});

export const syncSourceRecordToTrajectory = mutation({
  args: {
    sourceRecordType: v.string(),
    sourceRecordId: v.string(),
    entityKey: v.string(),
    entityType: v.string(),
    windowDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => rebuildTrajectoryEntity.handler(ctx, args as any),
});

/**
 * recordAgentResponseSpan — Lightweight capture of an individual agent response
 * for adaptive quality tracking. Each call creates a trajectorySpan + optional
 * trajectoryJudgeVerdict so the compounding engine can re-judge over time.
 *
 * Called from the agent chat pipeline after every substantive response.
 * Does NOT trigger a full trajectory rebuild — that happens on schedule.
 */
export const recordAgentResponseSpan = mutation({
  args: {
    entityKey: v.string(),
    entityType: v.string(),
    spanKey: v.string(),
    name: v.string(),
    summary: v.string(),
    status: v.string(),
    spanType: v.optional(v.string()),
    traceKey: v.optional(v.string()),
    sessionKey: v.optional(v.string()),
    score: v.optional(v.number()),
    evidenceCompletenessScore: v.optional(v.number()),
    sourceRefs: v.optional(v.array(v.object({
      label: v.string(),
      href: v.optional(v.string()),
      note: v.optional(v.string()),
      kind: v.optional(v.string()),
    }))),
    sourceRecordType: v.string(),
    sourceRecordId: v.string(),
    // Optional inline verdict — if provided, also creates a judge verdict
    verdict: v.optional(v.object({
      verdict: v.string(),
      summary: v.string(),
      confidence: v.optional(v.number()),
      criteriaPassed: v.optional(v.number()),
      criteriaTotal: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    const normalized = normalizeTrajectoryArgs(args);
    const now = Date.now();
    const { entityKey: _ek, entityType: _et, verdict, ...spanRest } = args;

    // BOUND: limit sourceRefs to 20 per span
    const boundedSourceRefs = (spanRest.sourceRefs ?? []).slice(0, 20);

    const spanId = await ctx.db.insert("trajectorySpans", {
      ...spanRest,
      sourceRefs: boundedSourceRefs,
      spanType: spanRest.spanType ?? "agent_response",
      entityKey: normalized.entityKey,
      entityType: normalized.entityType,
      createdAt: now,
      updatedAt: now,
    });

    let verdictId = undefined;
    if (verdict) {
      verdictId = await ctx.db.insert("trajectoryJudgeVerdicts", {
        entityKey: normalized.entityKey,
        entityType: normalized.entityType,
        verdictKey: `${args.spanKey}:verdict`,
        verdict: verdict.verdict,
        summary: verdict.summary,
        confidence: verdict.confidence,
        criteriaPassed: verdict.criteriaPassed,
        criteriaTotal: verdict.criteriaTotal,
        sourceRecordType: args.sourceRecordType,
        sourceRecordId: args.sourceRecordId,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { spanId, verdictId };
  },
});

export const backfillRecentTrajectoryWindow = mutation({
  args: {
    windowDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const product = await rebuildTrajectoryEntity.handler(ctx, {
      entityKey: "product:nodebench-ai",
      entityType: "product",
      windowDays: args.windowDays,
    } as any);
    return {
      rebuilt: [product],
    };
  },
});
