// convex/domains/eval/evalMutations.ts
// Internal mutations and queries for evaluation storage

import { internalMutation, internalQuery } from "../../../_generated/server";
import { v } from "convex/values";
import { productionTestCases } from "./productionTestCases";

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS: Eval Runs
// ═══════════════════════════════════════════════════════════════════════════

export const createEvalRun = internalMutation({
  args: {
    suiteId: v.string(),
    model: v.string(),
    totalCases: v.number(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const runId = await ctx.db.insert("evalRuns", {
      suiteId: args.suiteId,
      model: args.model,
      status: "running",
      totalCases: args.totalCases,
      passedCases: 0,
      failedCases: 0,
      passRate: 0,
      avgLatencyMs: 0,
      startedAt: now,
      metadata: args.metadata,
    });

    console.log("[createEvalRun] Created run", { runId, suiteId: args.suiteId });
    return runId;
  },
});

export const updateEvalRun = internalMutation({
  args: {
    runId: v.id("evalRuns"),
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    )),
    passedCases: v.optional(v.number()),
    failedCases: v.optional(v.number()),
    passRate: v.optional(v.number()),
    avgLatencyMs: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { runId, ...updates } = args;

    const updateData: any = {};
    if (updates.status) updateData.status = updates.status;
    if (updates.passedCases !== undefined) updateData.passedCases = updates.passedCases;
    if (updates.failedCases !== undefined) updateData.failedCases = updates.failedCases;
    if (updates.passRate !== undefined) updateData.passRate = updates.passRate;
    if (updates.avgLatencyMs !== undefined) updateData.avgLatencyMs = updates.avgLatencyMs;
    if (updates.errorMessage) updateData.errorMessage = updates.errorMessage;

    if (updates.status === "completed" || updates.status === "failed") {
      updateData.completedAt = Date.now();
    }

    await ctx.db.patch(runId, updateData);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS: Eval Results
// ═══════════════════════════════════════════════════════════════════════════

export const storeEvalResult = internalMutation({
  args: {
    runId: v.id("evalRuns"),
    result: v.object({
      testId: v.string(),
      passed: v.boolean(),
      latencyMs: v.number(),
      toolsCalled: v.array(v.string()),
      response: v.string(),
      reasoning: v.string(),
      // Accept both null and undefined for OpenAI structured outputs compatibility
      failureCategory: v.optional(v.union(v.string(), v.null())),
      suggestedFix: v.optional(v.union(v.string(), v.null())),
      artifacts: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    await ctx.db.insert("evalResults", {
      runId: args.runId,
      testId: args.result.testId,
      passed: args.result.passed,
      latencyMs: args.result.latencyMs,
      toolsCalled: args.result.toolsCalled,
      response: args.result.response,
      reasoning: args.result.reasoning,
      // Convert null to undefined for storage
      failureCategory: args.result.failureCategory ?? undefined,
      suggestedFix: args.result.suggestedFix ?? undefined,
      artifacts: args.result.artifacts,
      createdAt: now,
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

export const getEvalRun = internalQuery({
  args: {
    runId: v.id("evalRuns"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.runId);
  },
});

export const getEvalResults = internalQuery({
  args: {
    runId: v.id("evalRuns"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("evalResults")
      .withIndex("by_run", q => q.eq("runId", args.runId))
      .collect();
  },
});

export const getRecentRuns = internalQuery({
  args: {
    limit: v.optional(v.number()),
    suiteId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;

    let query = ctx.db.query("evalRuns").order("desc");

    if (args.suiteId !== undefined) {
      query = ctx.db
        .query("evalRuns")
        .withIndex("by_suite", q => q.eq("suiteId", args.suiteId))
        .order("desc");
    }

    return await query.take(limit);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES: Test Cases (uses productionTestCases.ts)
// ═══════════════════════════════════════════════════════════════════════════

export const getTestCases = internalQuery({
  args: {
    caseIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Get actual test cases from productionTestCases.ts
    const testCaseMap = new Map(productionTestCases.map(tc => [tc.id, tc]));

    return args.caseIds
      .filter((id: any) => testCaseMap.has(id))
      .map((id: any) => {
        const tc = testCaseMap.get(id)!;
        return {
          id: tc.id,
          userQuery: tc.userQuery,
          expectedTool: tc.expectedTool,
          expectedArgs: tc.expectedArgs,
          successCriteria: tc.successCriteria,
          evaluationPrompt: tc.evaluationPrompt,
        };
      });
  },
});
