/**
 * Evaluation Run Tracking - Mutations and Queries
 *
 * Separate file for non-action functions (mutations, queries)
 * that cannot use "use node".
 */

import { query, internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { Doc } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION RUN TRACKING MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new evaluation run record
 */
export const createEvalRun = internalMutation({
  args: {
    sessionId: v.string(),
    userId: v.optional(v.id("users")),
    queryIds: v.array(v.string()),
    mode: v.union(v.literal("anonymous"), v.literal("authenticated")),
  },
  handler: async (ctx, args) => {
    const runId = await ctx.db.insert("evaluationRuns", {
      sessionId: args.sessionId,
      userId: args.userId,
      queryIds: args.queryIds,
      mode: args.mode,
      status: "running",
      completedQueries: 0,
      passedQueries: 0,
      failedQueries: 0,
      results: [],
      startedAt: Date.now(),
    });
    return runId;
  },
});

/**
 * Update evaluation run with a completed query result
 */
export const updateEvalRun = internalMutation({
  args: {
    runId: v.id("evaluationRuns"),
    result: v.object({
      queryId: v.string(),
      query: v.string(),
      persona: v.string(),
      expectedOutcome: v.string(),
      actualOutcome: v.string(),
      passed: v.boolean(),
      containsRequired: v.boolean(),
      noForbidden: v.boolean(),
      failureReasons: v.array(v.string()),
      responseLength: v.number(),
      responseSnippet: v.optional(v.string()),
      executedAt: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId) as Doc<"evaluationRuns"> | null;
    if (!run) return;

    const results = [...(run.results || []), args.result];
    const completedQueries = results.length;
    const passedQueries = results.filter((r: { passed: boolean }) => r.passed).length;
    const failedQueries = completedQueries - passedQueries;

    await ctx.db.patch(args.runId, {
      results,
      completedQueries,
      passedQueries,
      failedQueries,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Complete an evaluation run
 */
export const completeEvalRun = internalMutation({
  args: {
    runId: v.id("evaluationRuns"),
    summary: v.object({
      total: v.number(),
      passed: v.number(),
      failed: v.number(),
      passRate: v.number(),
      isPassing: v.boolean(),
      threshold: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: "completed",
      summary: args.summary,
      completedAt: Date.now(),
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION RUN QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get evaluation run status and results
 */
export const getEvalRunStatus = query({
  args: {
    runId: v.id("evaluationRuns"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId) as Doc<"evaluationRuns"> | null;
    if (!run) return null;

    return {
      status: run.status,
      completedQueries: run.completedQueries,
      totalQueries: run.queryIds?.length ?? 0,
      passedQueries: run.passedQueries,
      failedQueries: run.failedQueries,
      passRate: run.completedQueries > 0 ? run.passedQueries / run.completedQueries : 0,
      results: run.results,
      summary: run.summary,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    };
  },
});

/**
 * Get recent evaluation runs
 */
export const getRecentEvalRuns = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const runs = await ctx.db
      .query("evaluationRuns")
      .order("desc")
      .take(limit) as Doc<"evaluationRuns">[];

    return runs.map((run: Doc<"evaluationRuns">) => ({
      _id: run._id,
      status: run.status,
      mode: run.mode,
      totalQueries: run.queryIds?.length ?? 0,
      passedQueries: run.passedQueries,
      failedQueries: run.failedQueries,
      passRate: run.completedQueries > 0 ? run.passedQueries / run.completedQueries : 0,
      isPassing: run.summary?.isPassing ?? false,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    }));
  },
});
