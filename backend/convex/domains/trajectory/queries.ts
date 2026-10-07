import { v } from "convex/values";
import { query } from "../../_generated/server";
import { toTimelineItems } from "./lib";
import { buildTrajectoryProjection, loadPersistedTrajectoryState, normalizeTrajectoryArgs } from "./projection";

const trajectoryArgs = {
  entityKey: v.string(),
  entityType: v.string(),
  windowDays: v.optional(v.number()),
};

export const getTrajectoryEntity = query({
  args: trajectoryArgs,
  handler: async (ctx, args) => {
    const normalized = normalizeTrajectoryArgs(args);
    const persisted = await loadPersistedTrajectoryState(
      ctx,
      normalized.entityKey,
      normalized.entityType,
      normalized.windowDays,
    );
    if (persisted.entity) {
      return {
        entity: persisted.entity,
        summary: persisted.summary,
        compounding: persisted.score,
      };
    }
    const projected = await buildTrajectoryProjection(ctx, normalized);
    return {
      entity: projected.entity,
      summary: projected.summary,
      compounding: {
        rawScore: projected.scoreBreakdown.rawCompounding.score,
        rawLabel: projected.scoreBreakdown.rawCompounding.label,
        rawExplanation: projected.scoreBreakdown.rawCompounding.explanation,
        trustAdjustedScore: projected.scoreBreakdown.trustAdjustedCompounding.score,
        trustAdjustedLabel: projected.scoreBreakdown.trustAdjustedCompounding.label,
        trustAdjustedExplanation: projected.scoreBreakdown.trustAdjustedCompounding.explanation,
        driftScore: projected.scoreBreakdown.drift.score,
        driftLabel: projected.scoreBreakdown.drift.label,
        driftExplanation: projected.scoreBreakdown.drift.explanation,
      },
    };
  },
});

export const getTrajectoryTimeline = query({
  args: trajectoryArgs,
  handler: async (ctx, args) => {
    const normalized = normalizeTrajectoryArgs(args);
    const persisted = await loadPersistedTrajectoryState(
      ctx,
      normalized.entityKey,
      normalized.entityType,
      normalized.windowDays,
    );
    if (persisted.spans.length > 0 || persisted.verdicts.length > 0 || persisted.feedbackEvents.length > 0) {
      return {
        entityKey: normalized.entityKey,
        entityType: normalized.entityType,
        items: toTimelineItems({
          spans: persisted.spans,
          verdicts: persisted.verdicts,
          feedbackEvents: persisted.feedbackEvents,
          interventions: persisted.interventions,
          benchmarkRuns: persisted.benchmarkRuns,
        }),
      };
    }

    const projected = await buildTrajectoryProjection(ctx, normalized);
    return {
      entityKey: normalized.entityKey,
      entityType: normalized.entityType,
      items: [
        ...projected.spans.map((span) => ({
          id: span.spanKey,
          kind: "span" as const,
          title: span.name,
          summary: span.summary,
          status: span.status,
          occurredAt: span.createdAt,
          score: span.score,
          sourceRecordType: span.sourceRecordType,
          sourceRecordId: span.sourceRecordId,
        })),
        ...projected.verdicts.map((verdict) => ({
          id: verdict.verdictKey,
          kind: "verdict" as const,
          title: verdict.verdict,
          summary: verdict.summary,
          status: verdict.verdict,
          occurredAt: verdict.createdAt,
          score: verdict.confidence,
          sourceRecordType: verdict.sourceRecordType,
          sourceRecordId: verdict.sourceRecordId,
        })),
        ...projected.feedbackEvents.map((event) => ({
          id: String(event._id),
          kind: "feedback" as const,
          title: event.title,
          summary: event.summary,
          status: event.status,
          occurredAt: event.observedAt,
          score: event.outcomeScore,
          sourceRecordType: event.sourceRecordType,
          sourceRecordId: event.sourceRecordId,
        })),
        ...projected.interventionEvents.map((event) => ({
          id: String(event._id),
          kind: "intervention" as const,
          title: event.title,
          summary: event.summary,
          status: event.status,
          occurredAt: event.observedWindowEndAt ?? event.expectedWindowEndAt,
          score: event.observedScoreDelta,
          sourceRecordType: event.sourceRecordType,
          sourceRecordId: event.sourceRecordId,
        })),
        ...projected.benchmarkRuns.map((run) => ({
          id: run.benchmarkKey,
          kind: "benchmark" as const,
          title: run.benchmarkLabel,
          summary: run.summary,
          status: run.verdict,
          occurredAt: run.createdAt,
          score: run.overallUplift,
          sourceRecordType: run.sourceRecordType,
          sourceRecordId: run.sourceRecordId,
        })),
      ].sort((a, b) => b.occurredAt - a.occurredAt),
    };
  },
});

export const getTrajectorySummary = query({
  args: trajectoryArgs,
  handler: async (ctx, args) => {
    const normalized = normalizeTrajectoryArgs(args);
    const persisted = await loadPersistedTrajectoryState(
      ctx,
      normalized.entityKey,
      normalized.entityType,
      normalized.windowDays,
    );
    if (persisted.summary) {
      return persisted.summary;
    }
    const projected = await buildTrajectoryProjection(ctx, normalized);
    return {
      entityKey: projected.entity.entityKey,
      entityType: projected.entity.entityType,
      windowDays: projected.summary.window.windowDays,
      summary: projected.summary.summary,
      narrative: projected.summary.narrative,
      nextReviewAt: projected.summary.nextReviewAt,
      spanCount: projected.summary.spanCount,
      evidenceBundleCount: projected.summary.evidenceBundleCount,
      verdictCount: projected.summary.verdictCount,
      feedbackCount: projected.summary.feedbackCount,
      interventionCount: projected.summary.interventionCount,
      benchmarkCount: projected.summary.benchmarkCount,
      trustNodeCount: projected.summary.trustNodeCount,
      trustEdgeCount: projected.summary.trustEdgeCount,
      topInterventions: projected.summary.topInterventions,
      scoreBreakdown: projected.scoreBreakdown,
    };
  },
});

export const getInterventionAttribution = query({
  args: trajectoryArgs,
  handler: async (ctx, args) => {
    const normalized = normalizeTrajectoryArgs(args);
    const projected = await buildTrajectoryProjection(ctx, normalized);
    return projected.interventionEvents
      .map((event) => ({
        _id: String(event._id),
        title: event.title,
        status: event.status,
        actor: event.actor,
        summary: event.summary,
        rationale: event.rationale,
        expectedWindowEndAt: event.expectedWindowEndAt,
        observedWindowEndAt: event.observedWindowEndAt,
        expectedScoreDelta: event.expectedScoreDelta,
        observedScoreDelta: event.observedScoreDelta,
      }))
      .sort((a, b) => (b.observedScoreDelta ?? b.expectedScoreDelta ?? 0) - (a.observedScoreDelta ?? a.expectedScoreDelta ?? 0));
  },
});

export const getCompoundingScore = query({
  args: trajectoryArgs,
  handler: async (ctx, args) => {
    const normalized = normalizeTrajectoryArgs(args);
    const persisted = await loadPersistedTrajectoryState(
      ctx,
      normalized.entityKey,
      normalized.entityType,
      normalized.windowDays,
    );
    if (persisted.score) return persisted.score;

    const projected = await buildTrajectoryProjection(ctx, normalized);
    return {
      entityKey: normalized.entityKey,
      entityType: normalized.entityType,
      windowDays: normalized.windowDays,
      rawScore: projected.scoreBreakdown.rawCompounding.score,
      rawLabel: projected.scoreBreakdown.rawCompounding.label,
      rawExplanation: projected.scoreBreakdown.rawCompounding.explanation,
      trustAdjustedScore: projected.scoreBreakdown.trustAdjustedCompounding.score,
      trustAdjustedLabel: projected.scoreBreakdown.trustAdjustedCompounding.label,
      trustAdjustedExplanation: projected.scoreBreakdown.trustAdjustedCompounding.explanation,
      driftScore: projected.scoreBreakdown.drift.score,
      driftLabel: projected.scoreBreakdown.drift.label,
      driftExplanation: projected.scoreBreakdown.drift.explanation,
    };
  },
});

export const getBenchmarkTrajectory = query({
  args: trajectoryArgs,
  handler: async (ctx, args) => {
    const normalized = normalizeTrajectoryArgs(args);
    const persisted = await loadPersistedTrajectoryState(
      ctx,
      normalized.entityKey,
      normalized.entityType,
      normalized.windowDays,
    );
    if (persisted.benchmarkRuns.length > 0) {
      return persisted.benchmarkRuns;
    }
    const projected = await buildTrajectoryProjection(ctx, normalized);
    return projected.benchmarkRuns;
  },
});

export const listTrajectoryEntities = query({
  args: {
    entityType: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 12, 30));
    if (args.entityType) {
      const entityType = normalizeTrajectoryArgs({
        entityKey: "placeholder",
        entityType: args.entityType,
      }).entityType;
      const entities = await ctx.db
        .query("trajectoryEntities")
        .withIndex("by_type_updated", (q: any) => q.eq("entityType", entityType))
        .order("desc")
        .take(limit);
      if (entities.length > 0) return entities;
    }

    const productProjection = await buildTrajectoryProjection(ctx, {
      entityKey: "product:nodebench-ai",
      entityType: "product",
      windowDays: 90,
    });

    return [
      {
        entityKey: productProjection.entity.entityKey,
        entityType: productProjection.entity.entityType,
        label: productProjection.entity.label,
        description: productProjection.summary.summary,
      },
    ];
  },
});

export const getTrajectoryDashboardSnapshot = query({
  args: {
    windowDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const normalized = normalizeTrajectoryArgs({
      entityKey: "product:nodebench-ai",
      entityType: "product",
      windowDays: args.windowDays ?? 90,
    });
    const product = await buildTrajectoryProjection(ctx, normalized);
    // Extract unique workflow names from span metadata (NOT trace IDs).
    // Spans carry a workflowName field from the trace they belong to.
    const workflowNames = Array.from(
      new Set(
        product.spans
          .map((span: any) => span.workflowName ?? span.category)
          .filter((value: unknown): value is string => typeof value === "string" && value.length > 0),
      ),
    ).slice(0, 4);

    const workflows = await Promise.all(
      workflowNames.map((workflowName) =>
        buildTrajectoryProjection(ctx, {
          entityKey: workflowName,
          entityType: "workflow",
          windowDays: normalized.windowDays,
        }),
      ),
    );

    return {
      product: {
        entity: product.entity,
        summary: product.summary,
        scoreBreakdown: product.scoreBreakdown,
      },
      workflows: workflows.map((workflow) => ({
        entity: workflow.entity,
        summary: workflow.summary,
        scoreBreakdown: workflow.scoreBreakdown,
      })),
    };
  },
});
