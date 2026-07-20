/**
 * LinkedIn Public Action Triggers
 *
 * Non-node runtime wrapper that exposes public actions
 * to trigger the LinkedIn posting workflows.
 */

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * PUBLIC action to run the startup funding brief from CLI
 * Usage: npx convex run workflows/linkedinTrigger:runStartupFundingBrief '{}'
 *
 * EXPANDED OPTIONS:
 * - sectorCategories: Filter by sector ["healthcare", "fintech", "ai_ml", "enterprise", "consumer", "deeptech", "climate"]
 * - roundTypes: Filter by round ["pre-seed", "seed", "series-a", "series-b", "series-c", "series-d-plus", "growth", "debt"]
 * - skipDeduplication: Bypass dedup check (default: false)
 * - deduplicationDays: Lookback window for dedup (default: 21)
 */
export const runStartupFundingBrief = action({
  args: {
    dryRun: v.optional(v.boolean()),
    hoursBack: v.optional(v.number()),
    maxProfiles: v.optional(v.number()),
    enableEnrichment: v.optional(v.boolean()),
    // NEW: Sector filtering
    sectorCategories: v.optional(v.array(v.string())),
    // NEW: Round type filtering
    roundTypes: v.optional(v.array(v.string())),
    // NEW: Deduplication control
    skipDeduplication: v.optional(v.boolean()),
    deduplicationDays: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    postUrl: v.optional(v.string()),
    postUrls: v.optional(v.array(v.string())),
    postCount: v.optional(v.number()),
    postedCount: v.optional(v.number()),
    message: v.optional(v.string()),
    profileCount: v.optional(v.number()),
    content: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
    posted: v.optional(v.boolean()),
    profiles: v.optional(v.array(v.any())),
    errors: v.optional(v.array(v.string())),
    reason: v.optional(v.string()),
    // Deduplication info
    skippedDuplicates: v.optional(v.array(v.string())),
    progressions: v.optional(v.array(v.object({
      company: v.string(),
      previousUrl: v.string(),
      previousRound: v.string(),
    }))),
    // Fast verification summary
    verificationSummary: v.optional(v.object({
      total: v.number(),
      verified: v.number(),
      partial: v.number(),
      unverified: v.number(),
      noVerification: v.number(),
    })),
  }),
  handler: async (ctx, args) => {
    return await ctx.runAction(internal.workflows.dailyLinkedInPost.postStartupFundingBrief, {
      dryRun: args.dryRun ?? false,
      hoursBack: args.hoursBack ?? 720, // 30 days
      maxProfiles: args.maxProfiles ?? 10,
      enableEnrichment: args.enableEnrichment ?? true,
      sectorCategories: args.sectorCategories,
      roundTypes: args.roundTypes,
      skipDeduplication: args.skipDeduplication ?? false,
      deduplicationDays: args.deduplicationDays ?? 21,
    });
  },
});

/**
 * Post a custom technical report to LinkedIn
 * Usage: npx convex run workflows/linkedinTrigger:postTechnicalReport '{"content":"Your report content here"}'
 */
export const postTechnicalReport = action({
  args: {
    content: v.string(),
    dryRun: v.optional(v.boolean()),
    target: v.optional(v.union(v.literal("personal"), v.literal("organization"))),
  },
  returns: v.object({
    success: v.boolean(),
    postUrl: v.optional(v.string()),
    postUrn: v.optional(v.string()),
    error: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
    content: v.optional(v.string()),
    target: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    if (args.dryRun) {
      console.log(`[postTechnicalReport] DRY RUN:\n${args.content}`);
      return {
        success: true,
        dryRun: true,
        content: args.content,
      };
    }

    return await ctx.runAction(internal.domains.social.linkedinPosting.createTargetedTextPost, {
      text: args.content,
      target: args.target ?? "organization",
    });
  },
});

/**
 * Run the multi-persona digest brief
 */
export const runMultiPersonaDigest = action({
  args: {
    dryRun: v.optional(v.boolean()),
    personas: v.optional(v.array(v.string())),
  },
  returns: v.object({
    success: v.boolean(),
    postUrl: v.optional(v.string()),
    message: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    return await ctx.runAction(internal.workflows.dailyLinkedInPost.postMultiPersonaDigest, {
      dryRun: args.dryRun ?? false,
      personas: args.personas ?? ["JPM_STARTUP_BANKER", "CTO_TECH_LEAD"],
    });
  },
});

/**
 * Generate and post weekly source summary
 * Usage: npx convex run workflows/linkedinTrigger:postWeeklySourceSummary '{}'
 *
 * Shows all media sources monitored, companies covered, and funding tracked
 * Demonstrates transparency and breadth of data aggregation
 */
export const postWeeklySourceSummary = action({
  args: {
    dryRun: v.optional(v.boolean()),
    daysBack: v.optional(v.number()), // Default 7
    target: v.optional(v.union(v.literal("personal"), v.literal("organization"))),
  },
  returns: v.object({
    success: v.boolean(),
    postUrl: v.optional(v.string()),
    postUrn: v.optional(v.string()),
    content: v.optional(v.string()),
    error: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
    target: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Generate the summary content
    const result = await ctx.runAction(internal.workflows.weeklySourceSummary.formatWeeklySourcePost, {
      daysBack: args.daysBack ?? 7,
    });

    if (!result.success) {
      return {
        success: false,
        error: "Failed to generate weekly summary",
      };
    }

    if (args.dryRun) {
      console.log(`[postWeeklySourceSummary] DRY RUN:\n${result.content}`);
      return {
        success: true,
        dryRun: true,
        content: result.content,
      };
    }

    // Post to LinkedIn
    return await ctx.runAction(internal.domains.social.linkedinPosting.createTargetedTextPost, {
      text: result.content,
      target: args.target ?? "organization",
    });
  },
});

/**
 * Generate and post ENHANCED weekly intelligence report
 * Usage: npx convex run workflows/linkedinTrigger:postEnhancedWeeklySummary '{}'
 *
 * Includes ALL available metrics:
 * - Source publishers (not just domains)
 * - Sector distribution with funding totals
 * - Geographic breakdown
 * - Top investors by deal count
 * - Verification status
 * - Valuation metrics
 * - Average deal size by stage
 * - Data quality scores
 */
export const postEnhancedWeeklySummary = action({
  args: {
    dryRun: v.optional(v.boolean()),
    daysBack: v.optional(v.number()), // Default 7
    target: v.optional(v.union(v.literal("personal"), v.literal("organization"))),
  },
  returns: v.object({
    success: v.boolean(),
    postUrl: v.optional(v.string()),
    postUrn: v.optional(v.string()),
    content: v.optional(v.string()),
    error: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
    target: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Generate the enhanced summary content
    const result = await ctx.runAction(internal.workflows.enhancedWeeklySummary.formatEnhancedWeeklyPost, {
      daysBack: args.daysBack ?? 7,
    });

    if (!result.success) {
      return {
        success: false,
        error: "Failed to generate enhanced weekly summary",
      };
    }

    if (args.dryRun) {
      console.log(`[postEnhancedWeeklySummary] DRY RUN:\n${result.content}`);
      return {
        success: true,
        dryRun: true,
        content: result.content,
      };
    }

    // Post to LinkedIn
    return await ctx.runAction(internal.domains.social.linkedinPosting.createTargetedTextPost, {
      text: result.content,
      target: args.target ?? "organization",
    });
  },
});
