/**
 * Forecasting OS — Weekly Calibration Cron
 *
 * Runs Sunday 6:00 AM UTC.
 * Computes calibration log for each user with resolved forecasts.
 * Stores a snapshot in forecastCalibrationLog table.
 */

import { internalAction } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";

export const handler = internalAction({
  args: {},
  handler: async (ctx) => {
    // For now, compute for all users with resolutions
    // In production, iterate over distinct userIds from forecastResolutions
    // For MVP, use a known service user or scan unique users

    // Get all resolutions to find distinct users
    // Note: in production this should be a dedicated query
    const allResolutions = await ctx.runQuery(
      internal.domains.forecasting.forecastManager.getUserResolutions,
      { userId: "default" } // MVP: single-user
    );

    if (allResolutions.length === 0) {
      console.log("[weeklyCalibration] No resolutions to calibrate.");
      return { status: "no_data" };
    }

    try {
      const result = await ctx.runAction(
        internal.domains.forecasting.actions.computeCalibration
          .computeCalibrationAction,
        { userId: "default" }
      );
      console.log(
        `[weeklyCalibration] Computed calibration: Brier=${result.overallBrier}, Resolved=${result.resolvedCount}`
      );
      return result;
    } catch (err) {
      console.error("[weeklyCalibration] Failed:", err);
      return { status: "error", error: String(err) };
    }
  },
});
