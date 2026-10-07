import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import {
  decideHyperLoopPromotion,
  type HyperLoopMetrics,
  type HyperLoopGate,
} from "./policy";
import { hyperloopGateSchema, hyperloopMetricSchema } from "./schema";

const targetKindArg = v.union(
  v.literal("packet_template"),
  v.literal("workflow_template"),
  v.literal("routing_policy"),
  v.literal("export_adapter"),
  v.literal("readiness_rubric"),
  v.literal("watchlist_threshold"),
);

const statusArg = v.union(
  v.literal("draft"),
  v.literal("evaluating"),
  v.literal("archived"),
  v.literal("candidate"),
  v.literal("promoted"),
  v.literal("rejected"),
  v.literal("rolled_back"),
);

function compactIds(ids: string[] | undefined): string[] {
  return Array.from(new Set((ids ?? []).map((id) => id.trim()).filter(Boolean)));
}

export const archiveVariant = mutation({
  args: {
    workspaceId: v.string(),
    companyId: v.optional(v.string()),
    targetKind: targetKindArg,
    targetId: v.string(),
    summary: v.string(),
    diffSummary: v.optional(v.string()),
    parentVariantIds: v.optional(v.array(v.string())),
    createdFromEpisodeIds: v.optional(v.array(v.string())),
    createdFromPacketIds: v.optional(v.array(v.string())),
    sourceRefs: v.optional(v.array(v.string())),
    metrics: v.optional(hyperloopMetricSchema),
    status: v.optional(v.union(v.literal("draft"), v.literal("archived"), v.literal("candidate"))),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const variantId = await ctx.db.insert("hyperloopVariants", {
      workspaceId: args.workspaceId,
      companyId: args.companyId,
      targetKind: args.targetKind,
      targetId: args.targetId,
      status: args.status ?? "archived",
      summary: args.summary,
      diffSummary: args.diffSummary,
      parentVariantIds: compactIds(args.parentVariantIds),
      createdFromEpisodeIds: compactIds(args.createdFromEpisodeIds),
      createdFromPacketIds: compactIds(args.createdFromPacketIds),
      sourceRefs: compactIds(args.sourceRefs),
      evaluationRunIds: [],
      metrics: args.metrics,
      createdAt: now,
      updatedAt: now,
    });

    return ctx.db.get(variantId);
  },
});

export const recordEvaluationRun = mutation({
  args: {
    variantId: v.id("hyperloopVariants"),
    baselineVariantId: v.optional(v.id("hyperloopVariants")),
    workspaceId: v.string(),
    targetKind: targetKindArg,
    targetId: v.string(),
    episodeIds: v.optional(v.array(v.string())),
    packetIds: v.optional(v.array(v.string())),
    workflowTemplateId: v.optional(v.string()),
    metrics: hyperloopMetricSchema,
    gates: v.array(hyperloopGateSchema),
    llmExplanation: v.optional(v.string()),
    artifactIds: v.optional(v.array(v.string())),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const decision = decideHyperLoopPromotion({
      metrics: args.metrics as HyperLoopMetrics,
      gates: args.gates as HyperLoopGate[],
    });

    const runId = await ctx.db.insert("hyperloopEvaluationRuns", {
      variantId: args.variantId,
      baselineVariantId: args.baselineVariantId,
      workspaceId: args.workspaceId,
      targetKind: args.targetKind,
      targetId: args.targetId,
      episodeIds: compactIds(args.episodeIds),
      packetIds: compactIds(args.packetIds),
      workflowTemplateId: args.workflowTemplateId,
      metrics: args.metrics,
      gates: args.gates,
      score: decision.score,
      improvementDelta: decision.improvementDelta,
      failedGateReasons: decision.failedGateReasons,
      policyAction: decision.action,
      llmExplanation: args.llmExplanation,
      artifactIds: compactIds(args.artifactIds),
      startedAt: args.startedAt ?? now,
      completedAt: args.completedAt ?? now,
      createdAt: now,
    });

    const variant = await ctx.db.get(args.variantId);
    if (variant) {
      const nextStatus = decision.action === "candidate" ? "candidate" : "archived";
      await ctx.db.patch(variant._id, {
        evaluationRunIds: [...(variant.evaluationRunIds ?? []), runId],
        metrics: args.metrics,
        status: variant.status === "promoted" ? variant.status : nextStatus,
        updatedAt: now,
      });
    }

    return {
      evaluationRun: await ctx.db.get(runId),
      decision,
    };
  },
});

export const decidePromotion = mutation({
  args: {
    variantId: v.id("hyperloopVariants"),
    decision: v.union(v.literal("promote"), v.literal("reject"), v.literal("rollback")),
    reviewerId: v.string(),
    rationale: v.string(),
    requiredFollowup: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const variant = await ctx.db.get(args.variantId);
    if (!variant) {
      throw new Error(`HyperLoop variant not found: ${args.variantId}`);
    }

    const latestRunId = variant.evaluationRunIds.at(-1);
    const latestRun = latestRunId ? await ctx.db.get(latestRunId) : null;
    if (!latestRun && args.decision === "promote") {
      throw new Error("Promotion requires at least one evaluation run.");
    }

    const policy = decideHyperLoopPromotion({
      metrics: (latestRun?.metrics ?? variant.metrics ?? {
        qualityScore: 0,
        evidenceCoverage: 0,
      }) as HyperLoopMetrics,
      gates: (latestRun?.gates ?? []) as HyperLoopGate[],
      reviewerId: args.reviewerId,
      requestedAction: args.decision,
    });

    if (args.decision === "promote" && policy.action !== "promote") {
      throw new Error(`Promotion blocked by HyperLoop policy: ${policy.explanation}`);
    }

    const promotionId = await ctx.db.insert("hyperloopPromotions", {
      variantId: args.variantId,
      workspaceId: variant.workspaceId,
      decision: args.decision,
      reviewerId: args.reviewerId,
      rationale: args.rationale,
      policyAction: policy.action,
      score: policy.score,
      improvementDelta: policy.improvementDelta,
      failedGateReasons: policy.failedGateReasons,
      requiredFollowup: compactIds(args.requiredFollowup),
      decidedAt: now,
    });

    const nextStatus =
      args.decision === "promote"
        ? "promoted"
        : args.decision === "rollback"
          ? "rolled_back"
          : "rejected";

    await ctx.db.patch(variant._id, {
      status: nextStatus,
      promotedAt: args.decision === "promote" ? now : variant.promotedAt,
      promotedBy: args.decision === "promote" ? args.reviewerId : variant.promotedBy,
      updatedAt: now,
    });

    return {
      promotion: await ctx.db.get(promotionId),
      decision: policy,
    };
  },
});

export const listVariants = query({
  args: {
    workspaceId: v.string(),
    status: v.optional(statusArg),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const take = Math.min(args.limit ?? 25, 100);
    const rows = args.status
      ? await ctx.db
          .query("hyperloopVariants")
          .withIndex("by_workspace_status", (q) =>
            q.eq("workspaceId", args.workspaceId).eq("status", args.status!),
          )
          .order("desc")
          .take(take)
      : await ctx.db
          .query("hyperloopVariants")
          .filter((q) => q.eq(q.field("workspaceId"), args.workspaceId))
          .order("desc")
          .take(take);
    return rows;
  },
});

export const listEvaluationRuns = query({
  args: {
    workspaceId: v.string(),
    variantId: v.optional(v.id("hyperloopVariants")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const take = Math.min(args.limit ?? 25, 100);
    if (args.variantId) {
      return ctx.db
        .query("hyperloopEvaluationRuns")
        .withIndex("by_variant", (q) => q.eq("variantId", args.variantId!))
        .order("desc")
        .take(take);
    }

    return ctx.db
      .query("hyperloopEvaluationRuns")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(take);
  },
});
