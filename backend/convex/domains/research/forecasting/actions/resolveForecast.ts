/**
 * Forecasting OS — Resolve Forecast Action
 *
 * Resolves a forecast with an outcome, auto-computes Brier and log scores,
 * and updates the forecast status to "resolved".
 */

import { internalAction } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { v } from "convex/values";
import { outcomeValidator } from "../validators";

export const resolveForecastAction = internalAction({
  args: {
    forecastId: v.id("forecasts"),
    outcome: outcomeValidator,
    numericOutcome: v.optional(v.number()),
    categoricalOutcome: v.optional(v.string()),
    resolutionNotes: v.string(),
    resolutionSourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const resolutionId = await ctx.runMutation(
      internal.domains.forecasting.forecastManager.resolveForecast,
      {
        forecastId: args.forecastId,
        outcome: args.outcome,
        numericOutcome: args.numericOutcome,
        categoricalOutcome: args.categoricalOutcome,
        resolutionNotes: args.resolutionNotes,
        resolutionSourceUrl: args.resolutionSourceUrl,
      }
    );

    return {
      resolutionId,
      forecastId: args.forecastId,
      outcome: args.outcome,
      status: "resolved",
    };
  },
});
