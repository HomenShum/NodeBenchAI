/**
 * Evaluation Operations — Layer H eval and evolution engine
 *
 * Provides CRUD + analytics on top of evaluation schema tables:
 * - inferenceCalls: per-call telemetry
 * - baselineComparisons: A/B tracking
 * - routingRecommendations: model routing feedback
 * - canaryRuns: weekly/daily canary tracking
 *
 * v2 plan sections: 18, 19, 20.6
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";

// ---------------------------------------------------------------------------
// Inference Call Tracking
// ---------------------------------------------------------------------------

export const recordInferenceCall = mutation({
  args: {
    callKey: v.string(),
    runStepId: v.optional(v.string()),
    missionId: v.optional(v.string()),
    taskId: v.optional(v.string()),
    provider: v.string(),
    model: v.string(),
    taskType: v.optional(v.string()),
    stakesLevel: v.optional(v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
    )),
    inputTokens: v.number(),
    outputTokens: v.number(),
    latencyMs: v.number(),
    costUsd: v.number(),
    status: v.union(
      v.literal("success"),
      v.literal("error"),
      v.literal("timeout"),
      v.literal("rate_limited"),
    ),
    errorMessage: v.optional(v.string()),
    toolsUsed: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    // Dedup by callKey
    const existing = await ctx.db
      .query("inferenceCalls")
      .withIndex("by_call_key", (q) => q.eq("callKey", args.callKey))
      .first();
    if (existing) return existing._id;

    return ctx.db.insert("inferenceCalls", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const getInferenceCallsByModel = query({
  args: {
    model: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { model, limit }) => {
    return ctx.db
      .query("inferenceCalls")
      .withIndex("by_model_created", (q) => q.eq("model", model))
      .order("desc")
      .take(limit ?? 50);
  },
});

export const getInferenceCallsByMission = query({
  args: {
    missionId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { missionId, limit }) => {
    return ctx.db
      .query("inferenceCalls")
      .withIndex("by_mission_created", (q) => q.eq("missionId", missionId))
      .order("desc")
      .take(limit ?? 100);
  },
});

export const getModelCostSummary = query({
  args: {
    model: v.string(),
    sinceDaysAgo: v.optional(v.number()),
  },
  handler: async (ctx, { model, sinceDaysAgo }) => {
    const since = Date.now() - (sinceDaysAgo ?? 7) * 86400000;
    const calls = await ctx.db
      .query("inferenceCalls")
      .withIndex("by_model_created", (q) => q.eq("model", model))
      .order("desc")
      .take(1000);

    const filtered = calls.filter((c) => c.createdAt >= since);

    const totalCost = filtered.reduce((sum, c) => sum + c.costUsd, 0);
    const totalTokens = filtered.reduce((sum, c) => sum + c.inputTokens + c.outputTokens, 0);
    const avgLatency = filtered.length > 0
      ? filtered.reduce((sum, c) => sum + c.latencyMs, 0) / filtered.length
      : 0;
    const errorRate = filtered.length > 0
      ? filtered.filter((c) => c.status !== "success").length / filtered.length
      : 0;

    return {
      model,
      periodDays: sinceDaysAgo ?? 7,
      callCount: filtered.length,
      totalCostUsd: Math.round(totalCost * 10000) / 10000,
      totalTokens,
      avgLatencyMs: Math.round(avgLatency),
      errorRate: Math.round(errorRate * 1000) / 1000,
      byStatus: {
        success: filtered.filter((c) => c.status === "success").length,
        error: filtered.filter((c) => c.status === "error").length,
        timeout: filtered.filter((c) => c.status === "timeout").length,
        rate_limited: filtered.filter((c) => c.status === "rate_limited").length,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Baseline Comparisons
// ---------------------------------------------------------------------------

export const recordBaselineComparison = mutation({
  args: {
    comparisonKey: v.string(),
    benchmarkFamily: v.union(
      v.literal("investigation"),
      v.literal("company_direction"),
      v.literal("repo_shift"),
      v.literal("document_enrichment"),
      v.literal("app_building"),
      v.literal("operational"),
      v.literal("canary"),
      v.literal("custom"),
    ),
    baselineLabel: v.string(),
    enhancedLabel: v.string(),
    baselineMetrics: v.object({
      factualAccuracy: v.optional(v.number()),
      relationshipAccuracy: v.optional(v.number()),
      causalChainQuality: v.optional(v.number()),
      evidenceCoverage: v.optional(v.number()),
      receiptCompleteness: v.optional(v.number()),
      humanEditDistance: v.optional(v.number()),
      latencyMs: v.optional(v.number()),
      costUsd: v.optional(v.number()),
      falseConfidenceRate: v.optional(v.number()),
    }),
    enhancedMetrics: v.object({
      factualAccuracy: v.optional(v.number()),
      relationshipAccuracy: v.optional(v.number()),
      causalChainQuality: v.optional(v.number()),
      evidenceCoverage: v.optional(v.number()),
      receiptCompleteness: v.optional(v.number()),
      humanEditDistance: v.optional(v.number()),
      latencyMs: v.optional(v.number()),
      costUsd: v.optional(v.number()),
      falseConfidenceRate: v.optional(v.number()),
    }),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Dedup by comparisonKey
    const existing = await ctx.db
      .query("baselineComparisons")
      .withIndex("by_comparison_key", (q) => q.eq("comparisonKey", args.comparisonKey))
      .first();
    if (existing) return existing._id;

    // Compute relative uplift
    const relativeUplift: Record<string, number | undefined> = {};
    const metricKeys = [
      "factualAccuracy", "relationshipAccuracy", "causalChainQuality",
      "evidenceCoverage", "receiptCompleteness", "humanEditDistance",
      "latencyMs", "costUsd", "falseConfidenceRate",
    ] as const;

    const regressions: string[] = [];
    let totalUplift = 0;
    let upliftCount = 0;

    for (const key of metricKeys) {
      const base = args.baselineMetrics[key];
      const enhanced = args.enhancedMetrics[key];
      if (base !== undefined && enhanced !== undefined && base !== 0) {
        // For latency, cost, humanEditDistance, falseConfidence — lower is better
        const lowerIsBetter = ["latencyMs", "costUsd", "humanEditDistance", "falseConfidenceRate"].includes(key);
        const delta = lowerIsBetter
          ? (base - enhanced) / base
          : (enhanced - base) / base;
        relativeUplift[key] = Math.round(delta * 1000) / 1000;

        if (delta < -0.02) regressions.push(key); // >2% regression
        totalUplift += delta;
        upliftCount++;
      }
    }

    const overallUplift = upliftCount > 0 ? Math.round((totalUplift / upliftCount) * 1000) / 1000 : 0;

    const verdict = regressions.length > 0 && overallUplift > 0.02
      ? "mixed" as const
      : regressions.length > 0
        ? "regressed" as const
        : overallUplift > 0.02
          ? "improved" as const
          : "neutral" as const;

    const now = Date.now();
    return ctx.db.insert("baselineComparisons", {
      ...args,
      relativeUplift: relativeUplift as any,
      overallUplift,
      regressions,
      verdict,
      ranAt: now,
      createdAt: now,
    });
  },
});

export const getBaselineComparisons = query({
  args: {
    benchmarkFamily: v.optional(v.union(
      v.literal("investigation"),
      v.literal("company_direction"),
      v.literal("repo_shift"),
      v.literal("document_enrichment"),
      v.literal("app_building"),
      v.literal("operational"),
      v.literal("canary"),
      v.literal("custom"),
    )),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { benchmarkFamily, limit }) => {
    if (benchmarkFamily) {
      return ctx.db
        .query("baselineComparisons")
        .withIndex("by_family_created", (q) => q.eq("benchmarkFamily", benchmarkFamily))
        .order("desc")
        .take(limit ?? 20);
    }
    return ctx.db
      .query("baselineComparisons")
      .order("desc")
      .take(limit ?? 20);
  },
});

export const getComparisonTrend = query({
  args: {
    benchmarkFamily: v.union(
      v.literal("investigation"),
      v.literal("company_direction"),
      v.literal("repo_shift"),
      v.literal("document_enrichment"),
      v.literal("app_building"),
      v.literal("operational"),
      v.literal("canary"),
      v.literal("custom"),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { benchmarkFamily, limit }) => {
    const comparisons = await ctx.db
      .query("baselineComparisons")
      .withIndex("by_family_created", (q) => q.eq("benchmarkFamily", benchmarkFamily))
      .order("desc")
      .take(limit ?? 50);

    return comparisons.map((c) => ({
      comparisonKey: c.comparisonKey,
      overallUplift: c.overallUplift,
      verdict: c.verdict,
      regressionCount: c.regressions.length,
      ranAt: c.ranAt,
    }));
  },
});

// ---------------------------------------------------------------------------
// Routing Recommendations
// ---------------------------------------------------------------------------

export const createRoutingRecommendation = mutation({
  args: {
    recommendationKey: v.string(),
    taskType: v.string(),
    currentModel: v.string(),
    recommendedModel: v.string(),
    reason: v.string(),
    evidenceComparisonId: v.optional(v.id("baselineComparisons")),
    expectedUplift: v.optional(v.number()),
    expectedCostDelta: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Dedup
    const existing = await ctx.db
      .query("routingRecommendations")
      .withIndex("by_recommendation_key", (q) => q.eq("recommendationKey", args.recommendationKey))
      .first();
    if (existing) return existing._id;

    return ctx.db.insert("routingRecommendations", {
      ...args,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const resolveRoutingRecommendation = mutation({
  args: {
    recommendationId: v.id("routingRecommendations"),
    status: v.union(v.literal("accepted"), v.literal("rejected"), v.literal("expired")),
  },
  handler: async (ctx, { recommendationId, status }) => {
    const patch: Record<string, unknown> = { status };
    if (status === "accepted") patch.acceptedAt = Date.now();
    await ctx.db.patch(recommendationId, patch);
  },
});

export const getPendingRecommendations = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("routingRecommendations")
      .withIndex("by_status_created", (q) => q.eq("status", "pending"))
      .order("desc")
      .take(50);
  },
});

export const getRecommendationsByTaskType = query({
  args: { taskType: v.string() },
  handler: async (ctx, { taskType }) => {
    return ctx.db
      .query("routingRecommendations")
      .withIndex("by_task_type", (q) => q.eq("taskType", taskType))
      .order("desc")
      .take(20);
  },
});

// ---------------------------------------------------------------------------
// Canary Runs
// ---------------------------------------------------------------------------

export const recordCanaryRun = mutation({
  args: {
    runKey: v.string(),
    commitHash: v.optional(v.string()),
    fixtureCount: v.number(),
    throughputScore: v.number(),
    qualityScore: v.number(),
    throughputMetrics: v.any(),
    qualityMetrics: v.any(),
    regressions: v.array(v.string()),
    wallClockMs: v.number(),
    costUsd: v.number(),
  },
  handler: async (ctx, args) => {
    // Dedup
    const existing = await ctx.db
      .query("canaryRuns")
      .withIndex("by_run_key", (q) => q.eq("runKey", args.runKey))
      .first();
    if (existing) return existing._id;

    // Get previous run for delta
    const previous = await ctx.db
      .query("canaryRuns")
      .withIndex("by_created", (q) => q)
      .order("desc")
      .first();

    const combinedScore = args.throughputScore * 0.6 + args.qualityScore * 0.4;
    const previousScore = previous
      ? previous.throughputScore * 0.6 + previous.qualityScore * 0.4
      : undefined;
    const delta = previousScore !== undefined ? combinedScore - previousScore : undefined;

    const verdict = args.regressions.length > 0
      ? "regression" as const
      : delta !== undefined && delta > 0.02
        ? "improvement" as const
        : "pass" as const;

    return ctx.db.insert("canaryRuns", {
      ...args,
      verdict,
      previousRunKey: previous?.runKey,
      deltaFromPrevious: delta,
      createdAt: Date.now(),
    });
  },
});

export const getRecentCanaryRuns = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return ctx.db
      .query("canaryRuns")
      .withIndex("by_created", (q) => q)
      .order("desc")
      .take(limit ?? 20);
  },
});

export const getCanaryTrend = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const runs = await ctx.db
      .query("canaryRuns")
      .withIndex("by_created", (q) => q)
      .order("desc")
      .take(limit ?? 50);

    return runs.map((r) => ({
      runKey: r.runKey,
      throughputScore: r.throughputScore,
      qualityScore: r.qualityScore,
      combined: r.throughputScore * 0.6 + r.qualityScore * 0.4,
      verdict: r.verdict,
      regressionCount: r.regressions.length,
      deltaFromPrevious: r.deltaFromPrevious,
      wallClockMs: r.wallClockMs,
      costUsd: r.costUsd,
      createdAt: r.createdAt,
    }));
  },
});

export const getCanaryRegressions = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("canaryRuns")
      .withIndex("by_verdict_created", (q) => q.eq("verdict", "regression"))
      .order("desc")
      .take(20);
  },
});

// ---------------------------------------------------------------------------
// Cross-cutting: Evolution Dashboard
// ---------------------------------------------------------------------------

export const getEvolutionDashboard = query({
  args: {},
  handler: async (ctx) => {
    const recentCanary = await ctx.db
      .query("canaryRuns")
      .withIndex("by_created", (q) => q)
      .order("desc")
      .take(5);

    const pendingRecs = await ctx.db
      .query("routingRecommendations")
      .withIndex("by_status_created", (q) => q.eq("status", "pending"))
      .take(10);

    const recentComparisons = await ctx.db
      .query("baselineComparisons")
      .order("desc")
      .take(5);

    const errorCalls = await ctx.db
      .query("inferenceCalls")
      .withIndex("by_status_created", (q) => q.eq("status", "error"))
      .order("desc")
      .take(10);

    return {
      canary: {
        latest: recentCanary[0] ?? null,
        trend: recentCanary.map((r) => ({
          runKey: r.runKey,
          combined: r.throughputScore * 0.6 + r.qualityScore * 0.4,
          verdict: r.verdict,
          createdAt: r.createdAt,
        })),
      },
      routing: {
        pendingCount: pendingRecs.length,
        pending: pendingRecs,
      },
      comparisons: {
        recent: recentComparisons.map((c) => ({
          comparisonKey: c.comparisonKey,
          family: c.benchmarkFamily,
          verdict: c.verdict,
          uplift: c.overallUplift,
          ranAt: c.ranAt,
        })),
      },
      errors: {
        recentCount: errorCalls.length,
        recent: errorCalls.slice(0, 5).map((c) => ({
          callKey: c.callKey,
          model: c.model,
          errorMessage: c.errorMessage,
          createdAt: c.createdAt,
        })),
      },
    };
  },
});
