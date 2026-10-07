/**
 * Forecasting OS — Daily Forecast Refresh Cron
 *
 * Runs at 5:00 AM UTC (before 6:15 AM LinkedIn digest).
 * Sweeps active forecasts that need refresh, calls refreshForecast for each.
 *
 * Refresh eligibility:
 * - "daily" frequency: always eligible
 * - "weekly" frequency: eligible if >7 days since last refresh
 * - "on_trigger": skipped (manual only)
 */

import { internalAction } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export const handler = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Get all active forecasts
    const forecasts = await ctx.runQuery(
      internal.domains.forecasting.forecastManager.getActiveForecastsForRefresh,
      { limit: 50 }
    );

    let refreshed = 0;
    let skipped = 0;

    for (const forecast of forecasts) {
      // Check refresh eligibility based on frequency
      const lastRefresh = forecast.lastRefreshedAt ?? 0;
      const timeSinceRefresh = now - lastRefresh;

      let shouldRefresh = false;
      if (forecast.refreshFrequency === "daily") {
        shouldRefresh = timeSinceRefresh > DAY_MS * 0.8; // 80% of a day (allow jitter)
      } else if (forecast.refreshFrequency === "weekly") {
        shouldRefresh = timeSinceRefresh > WEEK_MS * 0.8;
      }
      // "on_trigger" is never auto-refreshed

      if (!shouldRefresh) {
        skipped++;
        continue;
      }

      try {
        await ctx.runAction(
          internal.domains.forecasting.actions.refreshForecast
            .refreshForecastAction,
          { forecastId: forecast._id }
        );
        refreshed++;
      } catch (err) {
        console.error(
          `[dailyForecastRefresh] Failed to refresh ${forecast._id}:`,
          err
        );
      }
    }

    console.log(
      `[dailyForecastRefresh] Done. Refreshed: ${refreshed}, Skipped: ${skipped}, Total: ${forecasts.length}`
    );

    return { refreshed, skipped, total: forecasts.length };
  },
});
