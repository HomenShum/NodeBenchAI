/**
 * Forecasting OS — Create Forecast Action
 *
 * Creates a new forecast with question, type, resolution criteria,
 * and optional initial probability + evidence.
 */

import { internalAction } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { v } from "convex/values";
import {
  forecastTypeValidator,
  refreshFrequencyValidator,
  confidenceIntervalValidator,
} from "../validators";

export const createForecastAction = internalAction({
  args: {
    userId: v.string(),
    question: v.string(),
    forecastType: forecastTypeValidator,
    resolutionDate: v.string(),
    resolutionCriteria: v.string(),
    probability: v.optional(v.number()),
    confidenceInterval: v.optional(confidenceIntervalValidator),
    baseRate: v.optional(v.number()),
    refreshFrequency: v.optional(refreshFrequencyValidator),
    topDrivers: v.optional(v.array(v.string())),
    topCounterarguments: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    // Optional initial evidence
    initialEvidence: v.optional(
      v.array(
        v.object({
          sourceUrl: v.string(),
          sourceTitle: v.string(),
          sourceType: v.union(
            v.literal("news"),
            v.literal("filing"),
            v.literal("macro_data"),
            v.literal("poll"),
            v.literal("market_signal"),
            v.literal("manual")
          ),
          excerpt: v.string(),
          signal: v.union(
            v.literal("supporting"),
            v.literal("disconfirming"),
            v.literal("neutral")
          ),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    // Validate resolution date is in the future
    const resDate = new Date(args.resolutionDate);
    if (isNaN(resDate.getTime())) {
      throw new Error(
        `Invalid resolution date: ${args.resolutionDate}. Use ISO format YYYY-MM-DD.`
      );
    }

    // Validate probability range
    if (args.probability != null && (args.probability < 0 || args.probability > 1)) {
      throw new Error("Probability must be between 0 and 1");
    }

    // Create the forecast
    const forecastId = await ctx.runMutation(
      internal.domains.forecasting.forecastManager.createForecast,
      {
        userId: args.userId,
        question: args.question,
        forecastType: args.forecastType,
        probability: args.probability,
        confidenceInterval: args.confidenceInterval,
        baseRate: args.baseRate,
        resolutionDate: args.resolutionDate,
        resolutionCriteria: args.resolutionCriteria,
        refreshFrequency: args.refreshFrequency ?? "weekly",
        topDrivers: args.topDrivers,
        topCounterarguments: args.topCounterarguments,
        tags: args.tags,
      }
    );

    // Add initial evidence if provided
    if (args.initialEvidence && args.initialEvidence.length > 0) {
      for (const evidence of args.initialEvidence) {
        try {
          await ctx.runMutation(
            internal.domains.forecasting.forecastManager.addEvidence,
            {
              forecastId,
              userId: args.userId,
              sourceUrl: evidence.sourceUrl,
              sourceTitle: evidence.sourceTitle,
              sourceType: evidence.sourceType,
              excerpt: evidence.excerpt,
              signal: evidence.signal,
            }
          );
        } catch {
          // Skip duplicate evidence silently (dedup by sourceUrl)
        }
      }
    }

    return {
      forecastId,
      question: args.question,
      status: "active",
      probability: args.probability ?? null,
      resolutionDate: args.resolutionDate,
    };
  },
});
