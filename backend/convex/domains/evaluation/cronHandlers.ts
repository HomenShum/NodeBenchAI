/**
 * cronHandlers.ts — Scheduled benchmark & model evaluation handlers
 *
 * Provides cron-schedulable wrappers (args: {}) for:
 * 1. Tool health benchmark suite (daily)
 * 2. DD calibration benchmark (weekly)
 * 3. Leaderboard snapshot refresh (daily, after model eval)
 *
 * Pattern: follows forecasting/narrative cronHandler convention.
 */

import { internalAction, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// DAILY: Tool Health Benchmark Suite
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Orchestrate a full tool_health benchmark run.
 * Creates a run, executes the tool health task, and completes.
 * Cron-safe: args: {}
 */
export const tickToolHealthBenchmark = internalAction({
  args: {},
  returns: undefined,
  handler: async (ctx) => {
    const suite = "tool_health";
    const triggeredBy = "cron:daily";

    try {
      // 1. Start a new benchmark run
      const { runId } = await ctx.runMutation(
        internal.domains.evaluation.benchmarkHarness.startBenchmarkRun,
        { suite, triggeredBy }
      );

      // 2. Execute tool health check
      try {
        await ctx.runAction(
          internal.domains.evaluation.benchmarkHarness.executeToolHealthTask,
          {
            runId,
            taskId: "cron_tool_health",
            suite,
            inputPayload: {},
            expectations: { successRequired: true },
          }
        );
      } catch (taskErr) {
        console.error(`[CronBenchmark] Tool health task failed:`, taskErr);
      }

      // 3. Complete the run
      const results = await ctx.runQuery(
        internal.domains.evaluation.benchmarkHarness.getBenchmarkRunResults,
        { runId }
      );

      const status = results?.run?.failedTasks === 0 ? "completed" : "failed";
      await ctx.runMutation(
        internal.domains.evaluation.benchmarkHarness.completeBenchmarkRun,
        { runId, status }
      );

      console.log(
        `[CronBenchmark] Tool health run ${runId}: ${status}` +
        ` (${results?.run?.passedTasks ?? 0}/${results?.run?.totalTasks ?? 0} passed)`
      );
    } catch (err) {
      console.error(`[CronBenchmark] tickToolHealthBenchmark failed:`, err);
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// DAILY: Leaderboard Snapshot Refresh
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Snapshot the current model leaderboard into workbenchRuns for trending.
 * Reads latest eval results from livePerformanceEval and free model rankings,
 * then upserts a summary snapshot.
 * Cron-safe: args: {}
 */
export const refreshLeaderboardSnapshot = internalMutation({
  args: {},
  returns: undefined,
  handler: async (ctx) => {
    try {
      // Get all active free models with their scores
      const models = await ctx.db
        .query("freeModels")
        .withIndex("by_active_rank", (q) => q.eq("isActive", true))
        .collect();

      if (models.length === 0) {
        console.log("[CronBenchmark] No active free models for leaderboard snapshot");
        return;
      }

      // Snapshot each model's current ranking into a workbench run record
      for (const model of models) {
        const compositeScore = model.performanceScore ?? 0;
        const grade = compositeScore >= 90
          ? "A"
          : compositeScore >= 80
            ? "B"
            : compositeScore >= 70
              ? "C"
              : compositeScore >= 60
                ? "D"
                : "F";

        await ctx.db.insert("workbenchRuns", {
          scenarioId: "leaderboard_snapshot",
          model: model.openRouterId,
          provider: "openrouter",
          appSubstrate: "free-model-eval",
          status: "completed",
          compositeScore,
          grade,
          startedAt: Date.now(),
          completedAt: Date.now(),
        });
      }

      console.log(
        `[CronBenchmark] Leaderboard snapshot: ${models.length} models recorded`
      );
    } catch (err) {
      console.error(`[CronBenchmark] refreshLeaderboardSnapshot failed:`, err);
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// WEEKLY: DD Calibration Benchmark
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run the full DD calibration check and record results.
 * Wraps runBenchmark:runCalibrationCheck (which is a public action)
 * into an internalAction for cron scheduling.
 * Cron-safe: args: {}
 */
export const tickCalibrationBenchmark = internalAction({
  args: {},
  returns: undefined,
  handler: async (ctx) => {
    try {
      const result = await ctx.runAction(
        internal.domains.evaluation.runBenchmark.runCalibrationCheckInternal,
        {}
      );

      console.log(
        `[CronBenchmark] DD calibration: ${result.benchmarkPassed ? "PASSED" : "FAILED"}` +
        ` (${(result.passRate * 100).toFixed(0)}% pass rate)`
      );

      if (result.driftWarnings.length > 0) {
        console.warn(
          `[CronBenchmark] Drift warnings: ${result.driftWarnings.join("; ")}`
        );
      }
    } catch (err) {
      console.error(`[CronBenchmark] tickCalibrationBenchmark failed:`, err);
    }
  },
});
