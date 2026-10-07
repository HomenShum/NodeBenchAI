/**
 * Seed Data for Financial Evaluation System
 *
 * Initializes:
 * - Source quality rules
 * - Default configurations
 */

import { internalMutation } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { v } from "convex/values";

/**
 * Initialize all seed data for financial evaluation system
 */
export const initializeFinancialEvaluation = internalMutation({
  args: {},
  returns: v.object({
    sourceQualityRulesCreated: v.number(),
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Seed source quality rules
    const sourceQualityResult = await ctx.runMutation(
      internal.domains.evaluation.financial.sourceQuality.seedSourceQualityRules,
      {}
    );

    return {
      sourceQualityRulesCreated: sourceQualityResult.rulesCreated,
      success: true,
    };
  },
});
