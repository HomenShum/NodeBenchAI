/**
 * Adaptive Learning — Learn from tool executions and generate guidance.
 * Uses mcpToolLearning and mcpGuidanceExamples tables.
 */

import { query, internalMutation, internalQuery } from "../../../_generated/server";
import { v } from "convex/values";

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record a learning from a tool execution.
 */
export const recordToolLearning = internalMutation({
  args: {
    toolId: v.id("mcpTools"),
    serverId: v.id("mcpServers"),
    naturalLanguageQuery: v.string(),
    convertedParameters: v.any(),
    executionSuccess: v.boolean(),
    executionResult: v.optional(v.any()),
    errorMessage: v.optional(v.string()),
    learningType: v.union(
      v.literal("auto_discovery"),
      v.literal("user_interaction"),
      v.literal("manual_training")
    ),
    qualityScore: v.optional(v.number()),
    timingMs: v.optional(v.number()),
  },
  returns: v.id("mcpToolLearning"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("mcpToolLearning", {
      toolId: args.toolId,
      serverId: args.serverId,
      naturalLanguageQuery: args.naturalLanguageQuery,
      convertedParameters: args.convertedParameters,
      executionSuccess: args.executionSuccess,
      executionResult: args.executionResult,
      errorMessage: args.errorMessage,
      learningType: args.learningType,
      qualityScore: args.qualityScore,
      timingMs: args.timingMs,
    });
  },
});

/**
 * Update quality score for a learning entry (feedback loop).
 */
export const updateLearningQuality = internalMutation({
  args: {
    learningId: v.id("mcpToolLearning"),
    qualityScore: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { learningId, qualityScore }) => {
    await ctx.db.patch(learningId, { qualityScore });
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get top learning examples for a tool (by quality score).
 */
export const getTopExamplesForTool = internalQuery({
  args: {
    toolId: v.id("mcpTools"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("mcpToolLearning"),
      naturalLanguageQuery: v.string(),
      convertedParameters: v.any(),
      executionSuccess: v.boolean(),
      qualityScore: v.union(v.number(), v.null()),
      learningType: v.string(),
    })
  ),
  handler: async (ctx, { toolId, limit }) => {
    const maxResults = limit ?? 10;
    const learnings = await ctx.db
      .query("mcpToolLearning")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .order("desc")
      .take(maxResults * 3); // Over-fetch to filter

    // Sort by quality score descending, filter successes
    const sorted = learnings
      .filter((l) => l.executionSuccess)
      .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))
      .slice(0, maxResults);

    return sorted.map((l) => ({
      _id: l._id,
      naturalLanguageQuery: l.naturalLanguageQuery,
      convertedParameters: l.convertedParameters,
      executionSuccess: l.executionSuccess,
      qualityScore: l.qualityScore ?? null,
      learningType: l.learningType,
    }));
  },
});

/**
 * Get learning stats across all tools.
 */
export const getLearningStats = query({
  args: {},
  returns: v.object({
    totalLearnings: v.number(),
    successRate: v.number(),
    avgQualityScore: v.number(),
    byType: v.array(
      v.object({
        type: v.string(),
        count: v.number(),
      })
    ),
  }),
  handler: async (ctx) => {
    const allLearnings = await ctx.db
      .query("mcpToolLearning")
      .order("desc")
      .take(1000);

    const total = allLearnings.length;
    const successes = allLearnings.filter((l) => l.executionSuccess).length;
    const scores = allLearnings
      .filter((l) => l.qualityScore !== undefined && l.qualityScore !== null)
      .map((l) => l.qualityScore!);
    const avgScore =
      scores.length > 0
        ? Math.round(
            (scores.reduce((s, v) => s + v, 0) / scores.length) * 100
          ) / 100
        : 0;

    // Group by type
    const typeCounts: Record<string, number> = {};
    for (const l of allLearnings) {
      typeCounts[l.learningType] = (typeCounts[l.learningType] ?? 0) + 1;
    }

    return {
      totalLearnings: total,
      successRate: total > 0 ? Math.round((successes / total) * 100) / 100 : 0,
      avgQualityScore: avgScore,
      byType: Object.entries(typeCounts).map(([type, count]) => ({
        type,
        count,
      })),
    };
  },
});

/**
 * Get failure patterns for a tool (to avoid repeating mistakes).
 */
export const getFailurePatterns = internalQuery({
  args: {
    toolId: v.id("mcpTools"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      naturalLanguageQuery: v.string(),
      errorMessage: v.union(v.string(), v.null()),
      convertedParameters: v.any(),
    })
  ),
  handler: async (ctx, { toolId, limit }) => {
    const maxResults = limit ?? 10;
    const failures = await ctx.db
      .query("mcpToolLearning")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .order("desc")
      .take(maxResults * 3);

    return failures
      .filter((l) => !l.executionSuccess)
      .slice(0, maxResults)
      .map((l) => ({
        naturalLanguageQuery: l.naturalLanguageQuery,
        errorMessage: l.errorMessage ?? null,
        convertedParameters: l.convertedParameters,
      }));
  },
});
