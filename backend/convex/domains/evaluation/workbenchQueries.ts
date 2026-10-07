/**
 * workbenchQueries.ts — Convex queries for NodeBench Workbench (NBW) UI
 *
 * These power the /benchmarks view: leaderboard, scenario stats, recent runs.
 *
 * NOTE for Codex: When Phase 2 execution engine lands, add:
 *   - workbenchApps table query (frozen repo catalog)
 *   - triggerWorkbenchRun action (kick off model vs scenario)
 *   - real-time run status subscription via useQuery polling
 */

import { query } from "../../_generated/server";
import { v } from "convex/values";

// ─── Leaderboard ────────────────────────────────────────────────────────────

/**
 * Returns best composite score per model across all completed runs.
 * Used by ModelLeaderboard component for the score bar strip.
 */
export const getWorkbenchLeaderboard = query({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db
      .query("workbenchRuns")
      .withIndex("by_started")
      .order("desc")
      .filter((q) => q.eq(q.field("status"), "completed"))
      .collect();

    // Group by model:
    // - bestScore/grade: highest composite score across completed runs
    // - lastRunAt/lastScenarioId: most recent completed run (not necessarily best)
    const byModel = new Map<string, {
      model: string;
      provider: string;
      bestScore: number;
      bestGrade: string;
      lastScenarioId: string;
      lastRunAt: number;
      runCount: number;
    }>();

    for (const run of runs) {
      const score = run.compositeScore ?? 0;
      const existing = byModel.get(run.model);
      const ts = run.completedAt ?? run.startedAt;

      if (!existing) {
        byModel.set(run.model, {
          model: run.model,
          provider: run.provider,
          bestScore: score,
          bestGrade: run.grade ?? scoreToGrade(score),
          lastScenarioId: run.scenarioId,
          lastRunAt: ts,
          runCount: 1,
        });
        continue;
      }

      existing.runCount += 1;

      if (ts > existing.lastRunAt) {
        existing.lastRunAt = ts;
        existing.lastScenarioId = run.scenarioId;
      }

      if (score > existing.bestScore) {
        existing.bestScore = score;
        existing.bestGrade = run.grade ?? scoreToGrade(score);
      }
    }

    return Array.from(byModel.values()).sort((a, b) => {
      if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
      return b.lastRunAt - a.lastRunAt;
    });
  },
});

// ─── Scenario Stats ──────────────────────────────────────────────────────────

/**
 * Returns per-scenario run counts, average scores, and last run timestamp.
 * Used by ScenarioCatalog to show "3 runs" badges and status dots.
 */
export const getScenarioStats = query({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db
      .query("workbenchRuns")
      .withIndex("by_started")
      .order("desc")
      .filter((q) => q.eq(q.field("status"), "completed"))
      .collect();

    const stats = new Map<string, {
      scenarioId: string;
      runCount: number;
      avgScore: number;
      lastRunAt: number;
      lastStatus: "passed" | "failed";
    }>();

    for (const run of runs) {
      const score = run.compositeScore ?? 0;
      const existing = stats.get(run.scenarioId);
      if (!existing) {
        stats.set(run.scenarioId, {
          scenarioId: run.scenarioId,
          runCount: 1,
          avgScore: score,
          lastRunAt: run.completedAt ?? run.startedAt,
          lastStatus: score >= 60 ? "passed" : "failed",
        });
      } else {
        existing.runCount += 1;
        existing.avgScore = (existing.avgScore * (existing.runCount - 1) + score) / existing.runCount;
        const ts = run.completedAt ?? run.startedAt;
        if (ts > existing.lastRunAt) {
          existing.lastRunAt = ts;
          existing.lastStatus = score >= 60 ? "passed" : "failed";
        }
      }
    }

    return Object.fromEntries(stats);
  },
});

// ─── Recent Runs ─────────────────────────────────────────────────────────────

/**
 * Returns recent workbench runs, newest first.
 * Used by WorkbenchRunsTable.
 *
 * NOTE for Codex: add pagination cursor once we have >50 runs.
 */
export const listWorkbenchRuns = query({
  args: {
    limit: v.optional(v.number()),
    scenarioFilter: v.optional(v.string()),
    modelFilter: v.optional(v.string()),
  },
  handler: async (ctx, { limit = 25, scenarioFilter, modelFilter }) => {
    let q = ctx.db
      .query("workbenchRuns")
      .withIndex("by_started")
      .order("desc");

    if (scenarioFilter) {
      q = q.filter((qq) => qq.eq(qq.field("scenarioId"), scenarioFilter));
    }
    if (modelFilter) {
      q = q.filter((qq) => qq.eq(qq.field("model"), modelFilter));
    }

    return q.take(limit);
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreToGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}
