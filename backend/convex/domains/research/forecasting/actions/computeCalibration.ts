/**
 * Forecasting OS — Compute Calibration Action
 *
 * Aggregates all resolved forecasts for a user, computes calibration bins
 * and Brier scores, and stores a calibration log snapshot.
 */

import { internalAction } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { v } from "convex/values";
import {
  calibrationBins,
  averageBrier,
  averageLogScore,
} from "../scoringEngine";

export const computeCalibrationAction = internalAction({
  args: {
    userId: v.string(),
    windowStart: v.optional(v.string()), // ISO date
    windowEnd: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = new Date();
    const windowEnd = args.windowEnd ?? now.toISOString().split("T")[0];
    const windowStart =
      args.windowStart ??
      new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

    // Get all resolutions for this user
    const resolutions = await ctx.runQuery(
      internal.domains.forecasting.forecastManager.getUserResolutions,
      {
        userId: args.userId,
        startDate: new Date(windowStart).getTime(),
        endDate: new Date(windowEnd).getTime(),
      }
    );

    // Filter to binary, non-ambiguous resolutions with scores
    const scoreable = resolutions.filter(
      (r) => r.brierScore != null && r.outcome !== "ambiguous"
    );

    if (scoreable.length === 0) {
      return {
        status: "no_data",
        message: "No scoreable resolutions found in the time window",
      };
    }

    // Build probability-outcome pairs for calibration
    // We need to get the forecast probability at resolution time
    // For now, use the Brier score to back-compute: brier = (p - o)^2
    // This gives us |p - o| = sqrt(brier), but we need direction.
    // Better approach: query the forecast directly.
    const forecastPairs: Array<{
      probability: number;
      outcome: "yes" | "no";
    }> = [];

    for (const r of scoreable) {
      // Back-compute probability from Brier score and outcome
      const o = r.outcome === "yes" ? 1 : 0;
      // brier = (p - o)^2, so p = o ± sqrt(brier)
      // If outcome=yes (o=1): p = 1 - sqrt(brier) (probability was below 1)
      // If outcome=no (o=0): p = sqrt(brier) (probability was above 0)
      const sqrtBrier = Math.sqrt(r.brierScore ?? 0);
      const probability = o === 1 ? 1 - sqrtBrier : sqrtBrier;

      forecastPairs.push({
        probability: Math.max(0, Math.min(1, probability)),
        outcome: r.outcome as "yes" | "no",
      });
    }

    // Compute calibration bins
    const bins = calibrationBins(forecastPairs);
    const overallBrier = averageBrier(forecastPairs);
    const meanLog = averageLogScore(forecastPairs);

    // Store calibration log
    await ctx.runMutation(
      internal.domains.forecasting.forecastManager.storeCalibrationLog,
      {
        userId: args.userId,
        windowStart,
        windowEnd,
        bins,
        overallBrier,
        meanLogScore: meanLog,
        forecastCount: resolutions.length,
        resolvedCount: scoreable.length,
      }
    );

    return {
      status: "computed",
      windowStart,
      windowEnd,
      overallBrier,
      meanLogScore: meanLog,
      forecastCount: resolutions.length,
      resolvedCount: scoreable.length,
      bins,
    };
  },
});
