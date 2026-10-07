/**
 * Forecasting OS — Resolution Check Cron
 *
 * Runs at 7:00 AM UTC daily.
 * Finds active forecasts past their resolution date and logs them
 * for manual review. Does NOT auto-resolve (resolution requires human judgment).
 */

import { internalAction } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";

export const handler = internalAction({
  args: {},
  handler: async (ctx) => {
    const today = new Date().toISOString().split("T")[0];

    const pastDue = await ctx.runQuery(
      internal.domains.forecasting.forecastManager.getForecastsPastResolution,
      { asOfDate: today }
    );

    if (pastDue.length === 0) {
      console.log("[resolutionCheck] No forecasts past resolution date.");
      return { pastDue: 0 };
    }

    // Log each for review (save session note for human attention)
    const summaries = pastDue.map(
      (f) =>
        `- "${f.question}" (due: ${f.resolutionDate}, prob: ${f.probability != null ? (f.probability * 100).toFixed(0) + "%" : "unset"})`
    );

    console.log(
      `[resolutionCheck] ${pastDue.length} forecast(s) past resolution date:\n${summaries.join("\n")}`
    );

    return {
      pastDue: pastDue.length,
      forecasts: pastDue.map((f) => ({
        id: f._id,
        question: f.question,
        resolutionDate: f.resolutionDate,
        probability: f.probability,
      })),
    };
  },
});
