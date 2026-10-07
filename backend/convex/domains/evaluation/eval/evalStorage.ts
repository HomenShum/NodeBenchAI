// convex/domains/eval/evalStorage.ts
// V8 runtime mutations and queries for eval storage
// These run in V8 (not Node.js) so they can access the database

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../../_generated/server";

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

export const createEvalRun = internalMutation({
  args: {
    suiteId: v.string(),
    model: v.string(),
    totalCases: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("evalRuns", {
      suiteId: args.suiteId,
      model: args.model,
      status: "running",
      totalCases: args.totalCases,
      passedCases: 0,
      failedCases: 0,
      passRate: 0,
      avgLatencyMs: 0,
      startedAt: now,
    });
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
    const updateData: Record<string, any> = {};
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
      createdAt: Date.now(),
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL QUERIES
// ═══════════════════════════════════════════════════════════════════════════

export const getEvalRun = internalQuery({
  args: { runId: v.id("evalRuns") },
  handler: async (ctx, args) => ctx.db.get(args.runId),
});

export const getEvalResults = internalQuery({
  args: { runId: v.id("evalRuns") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("evalResults")
      .withIndex("by_run", q => q.eq("runId", args.runId))
      .collect();
  },
});

