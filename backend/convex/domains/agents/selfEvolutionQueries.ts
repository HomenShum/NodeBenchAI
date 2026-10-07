/**
 * Self-Evolution Queries & Mutations
 *
 * Separated from selfEvolution.ts because Convex requires that
 * "use node" files only export actions.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../_generated/server";

// ============================================================================
// Constants
// ============================================================================

/** BOUND: Max traces and eval runs to process per cycle */
const MAX_TRACES = 500;
const MAX_EVAL_RUNS = 100;

// ============================================================================
// Step 3: Persist Evolution
// ============================================================================

/**
 * Persists proposed changes to the rubricEvolutions table.
 * Tracks version history with before/after state and confidence.
 */
export const applyRubricEvolution = internalMutation({
  args: {
    proposal: v.any(),
    analysis: v.any(),
    cycleId: v.string(),
  },
  returns: v.id("rubricEvolutions"),
  handler: async (ctx, args) => {
    const proposal = args.proposal as {
      changes: Array<{
        type: string;
        gateName: string;
        reasoning: string;
        confidence: number;
        before: string | null;
        after: string | null;
      }>;
      overallReasoning: string;
      expectedImpact: string;
    };
    const analysis = args.analysis as {
      totalDecisions: number;
      postRate: number;
      falsePositiveRate: number;
      rubricHealth: { dataWindowDays: number; gateCount: number };
    };

    const id = await ctx.db.insert("rubricEvolutions", {
      cycleId: args.cycleId,
      version: Date.now(),
      changes: proposal.changes.map((c) => ({
        type: c.type,
        gateName: c.gateName,
        reasoning: c.reasoning,
        confidence: c.confidence,
        before: c.before ?? "",
        after: c.after ?? "",
      })),
      overallReasoning: proposal.overallReasoning,
      expectedImpact: proposal.expectedImpact,
      analysisSnapshot: {
        totalDecisions: analysis.totalDecisions,
        postRate: analysis.postRate,
        falsePositiveRate: analysis.falsePositiveRate,
        dataWindowDays: analysis.rubricHealth.dataWindowDays,
        gateCount: analysis.rubricHealth.gateCount,
      },
      appliedAt: Date.now(),
      status: proposal.changes.length > 0 ? "applied" : "skipped",
    });

    return id;
  },
});

// ============================================================================
// Step 4: Audit Trail Query
// ============================================================================

/**
 * Returns the evolution audit trail, most recent first.
 */
export const getEvolutionHistory = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const evolutions = await ctx.db
      .query("rubricEvolutions")
      .order("desc")
      .take(limit);
    return evolutions;
  },
});

// ============================================================================
// Internal Helper Queries
// ============================================================================

/** @internal Fetch recent agentTaskTraces after cutoff. */
export const queryRecentTraces = internalQuery({
  args: { cutoff: v.number() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentTaskTraces")
      .filter((q) => q.gte(q.field("startedAt"), args.cutoff))
      .order("desc")
      .take(MAX_TRACES);
  },
});

/** @internal Fetch recent evalRuns after cutoff. */
export const queryRecentEvalRuns = internalQuery({
  args: { cutoff: v.number() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("evalRuns")
      .filter((q) => q.gte(q.field("startedAt"), args.cutoff))
      .order("desc")
      .take(MAX_EVAL_RUNS);
  },
});
