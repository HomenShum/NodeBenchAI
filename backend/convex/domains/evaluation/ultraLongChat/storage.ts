/**
 * Ultra-Long Chat Eval Storage (V8 runtime mutations + queries)
 *
 * Persists per-run, per-turn, and per-scenario aggregates so the suite
 * is replayable, drillable, and comparable across commits.
 *
 * Separate from the Node-runtime batch runner so actions can call these
 * via `ctx.runMutation(internal.<path>.<name>, args)`.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../../_generated/server";
import type { Id } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// SUITE-LEVEL (wraps the existing evalRuns row)
// ═══════════════════════════════════════════════════════════════════════════

export const createSuiteRun = internalMutation({
  args: {
    suiteId: v.string(),
    model: v.string(),
    totalCases: v.number(),
    datasetDigest: v.string(),
  },
  returns: v.id("evalRuns"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("evalRuns", {
      suiteId: args.suiteId,
      model: args.model,
      status: "running",
      totalCases: args.totalCases,
      passedCases: 0,
      failedCases: 0,
      passRate: 0,
      avgLatencyMs: 0,
      startedAt: Date.now(),
      metadata: { datasetDigest: args.datasetDigest, kind: "ultraLongChat" },
    });
  },
});

export const finalizeSuiteRun = internalMutation({
  args: {
    runId: v.id("evalRuns"),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
    ),
    passedCases: v.number(),
    failedCases: v.number(),
    passRate: v.number(),
    avgLatencyMs: v.number(),
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: args.status,
      passedCases: args.passedCases,
      failedCases: args.failedCases,
      passRate: args.passRate,
      avgLatencyMs: args.avgLatencyMs,
      completedAt: Date.now(),
      ...(args.errorMessage ? { errorMessage: args.errorMessage } : {}),
    });
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PER-SCENARIO RUN (one per sample of one scenario)
// ═══════════════════════════════════════════════════════════════════════════

export const createScenarioRun = internalMutation({
  args: {
    suiteRunId: v.id("evalRuns"),
    scenarioId: v.string(),
    scenarioVersion: v.number(),
    sampleIndex: v.number(),
    model: v.string(),
    threadId: v.string(),
    totalTurns: v.number(),
  },
  returns: v.id("ultraLongChatEvalRuns"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("ultraLongChatEvalRuns", {
      suiteRunId: args.suiteRunId,
      scenarioId: args.scenarioId,
      scenarioVersion: args.scenarioVersion,
      sampleIndex: args.sampleIndex,
      model: args.model,
      threadId: args.threadId,
      status: "running",
      totalTurns: args.totalTurns,
      turnsCompleted: 0,
      turnsJudgedPassing: 0,
      passRate: 0,
      totalLatencyMs: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      startedAt: Date.now(),
    });
  },
});

export const finalizeScenarioRun = internalMutation({
  args: {
    runId: v.id("ultraLongChatEvalRuns"),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
    ),
    turnsCompleted: v.number(),
    turnsJudgedPassing: v.number(),
    passRate: v.number(),
    totalLatencyMs: v.number(),
    totalTokens: v.number(),
    totalCostUsd: v.number(),
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: args.status,
      turnsCompleted: args.turnsCompleted,
      turnsJudgedPassing: args.turnsJudgedPassing,
      passRate: args.passRate,
      totalLatencyMs: args.totalLatencyMs,
      totalTokens: args.totalTokens,
      totalCostUsd: args.totalCostUsd,
      completedAt: Date.now(),
      ...(args.errorMessage ? { errorMessage: args.errorMessage } : {}),
    });
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PER-TURN RECORD
// ═══════════════════════════════════════════════════════════════════════════

export const storeTurnResult = internalMutation({
  args: {
    runId: v.id("ultraLongChatEvalRuns"),
    turnNumber: v.number(),
    userMessage: v.string(),
    assistantResponse: v.string(),
    toolsCalled: v.array(v.string()),
    latencyMs: v.number(),
    tokensIn: v.number(),
    tokensOut: v.number(),
    criteria: v.object({
      rememberedPriorContext: v.boolean(),
      didNotReFetchStaleData: v.boolean(),
      prioritiesSurfacedWhenAsked: v.boolean(),
      noHallucinatedClaims: v.boolean(),
      appropriateAngleActivation: v.boolean(),
      stayedOnTopic: v.boolean(),
    }),
    criteriaReasons: v.any(),
    passed: v.boolean(),
    judgeModel: v.string(),
    judgeLatencyMs: v.number(),
  },
  returns: v.id("ultraLongChatEvalTurns"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("ultraLongChatEvalTurns", {
      runId: args.runId,
      turnNumber: args.turnNumber,
      userMessage: args.userMessage,
      assistantResponse: args.assistantResponse.slice(0, 8000),
      toolsCalled: args.toolsCalled,
      latencyMs: args.latencyMs,
      tokensIn: args.tokensIn,
      tokensOut: args.tokensOut,
      criteria: args.criteria,
      criteriaReasons: args.criteriaReasons,
      passed: args.passed,
      judgeModel: args.judgeModel,
      judgeLatencyMs: args.judgeLatencyMs,
      createdAt: Date.now(),
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// AGGREGATE (N-run stats per scenario)
// ═══════════════════════════════════════════════════════════════════════════

export const storeAggregate = internalMutation({
  args: {
    suiteRunId: v.id("evalRuns"),
    scenarioId: v.string(),
    scenarioVersion: v.number(),
    model: v.string(),
    sampleCount: v.number(),
    criterionStats: v.array(v.object({
      criterion: v.string(),
      meanPassRate: v.number(),
      stdev: v.number(),
      ci95Low: v.number(),
      ci95High: v.number(),
    })),
    overallMeanPassRate: v.number(),
    overallCi95Low: v.number(),
    overallCi95High: v.number(),
    avgLatencyMsPerTurn: v.number(),
    avgCostUsdPerRun: v.number(),
  },
  returns: v.id("ultraLongChatEvalAggregates"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("ultraLongChatEvalAggregates", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES (for regression gate + dashboards)
// ═══════════════════════════════════════════════════════════════════════════

export const getScenarioRunsForSuite = internalQuery({
  args: { suiteRunId: v.id("evalRuns") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ultraLongChatEvalRuns")
      .withIndex("by_suite", (q) => q.eq("suiteRunId", args.suiteRunId))
      .collect();
  },
});

export const getTurnsForScenarioRun = internalQuery({
  args: { runId: v.id("ultraLongChatEvalRuns") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ultraLongChatEvalTurns")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});

export const getLatestAggregatesForScenario = internalQuery({
  args: { scenarioId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 5;
    return await ctx.db
      .query("ultraLongChatEvalAggregates")
      .withIndex("by_scenario_createdAt", (q) => q.eq("scenarioId", args.scenarioId))
      .order("desc")
      .take(limit);
  },
});

export const getSuiteRunWithDetails = internalQuery({
  args: { suiteRunId: v.id("evalRuns") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const suite = await ctx.db.get(args.suiteRunId);
    if (!suite) return null;
    const scenarioRuns = await ctx.db
      .query("ultraLongChatEvalRuns")
      .withIndex("by_suite", (q) => q.eq("suiteRunId", args.suiteRunId))
      .collect();
    const aggregates = await ctx.db
      .query("ultraLongChatEvalAggregates")
      .withIndex("by_suite", (q) => q.eq("suiteRunId", args.suiteRunId))
      .collect();
    return { suite, scenarioRuns, aggregates };
  },
});
