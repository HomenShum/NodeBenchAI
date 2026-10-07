/**
 * HITL Corrections System
 *
 * Captures and learns from human-in-the-loop corrections
 * to improve model quality over time
 */

import { action, internalMutation, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { v } from "convex/values";

/**
 * Record a correction event
 */
export const recordCorrection = action({
  args: {
    dcfModelId: v.string(),
    entityKey: v.string(),
    fieldPath: v.string(),
    aiValue: v.any(),
    correctedValue: v.any(),
    correctionType: v.union(
      v.literal("value_override"),
      v.literal("formula_fix"),
      v.literal("source_replacement"),
      v.literal("assumption_reject")
    ),
    reason: v.string(),
    correctedBy: v.id("users"),
    impactOnEv: v.optional(v.number()),
  },
  returns: v.object({
    correctionId: v.string(),
    severityLevel: v.string(),
    shouldUpdateGroundTruth: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const correctionId = `corr-${args.entityKey}-${Date.now()}`;

    // Calculate severity based on EV impact
    const impactPct = Math.abs(args.impactOnEv || 0);
    const severityLevel = impactPct < 5 ? "minor" :
                         impactPct < 15 ? "moderate" :
                         "significant";

    // Determine if should update ground truth
    const shouldUpdateGroundTruth = severityLevel === "significant" &&
                                   args.correctionType !== "assumption_reject";

    await ctx.runMutation(internal.domains.financial.corrections.insertCorrection, {
      correctionId,
      dcfModelId: args.dcfModelId,
      entityKey: args.entityKey,
      fieldPath: args.fieldPath,
      aiValue: args.aiValue,
      correctedValue: args.correctedValue,
      correctionType: args.correctionType,
      reason: args.reason,
      correctedBy: args.correctedBy,
      impactOnEv: args.impactOnEv,
      severityLevel,
      shouldUpdateGroundTruth,
    });

    console.log(`[Corrections] Recorded ${severityLevel} correction for ${args.entityKey}.${args.fieldPath}`);

    // Check for patterns
    await ctx.runAction(internal.domains.financial.corrections.detectPatterns, {
      fieldPath: args.fieldPath,
      entityKey: args.entityKey,
    });

    return {
      correctionId,
      severityLevel,
      shouldUpdateGroundTruth,
    };
  },
});

/**
 * Insert correction mutation
 */
export const insertCorrection = internalMutation({
  args: {
    correctionId: v.string(),
    dcfModelId: v.string(),
    entityKey: v.string(),
    fieldPath: v.string(),
    aiValue: v.any(),
    correctedValue: v.any(),
    correctionType: v.string(),
    reason: v.string(),
    correctedBy: v.id("users"),
    impactOnEv: v.optional(v.number()),
    severityLevel: v.string(),
    shouldUpdateGroundTruth: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("modelCorrectionEvents", {
      correctionId: args.correctionId,
      dcfModelId: args.dcfModelId,
      entityKey: args.entityKey,
      fieldPath: args.fieldPath,
      aiValue: args.aiValue,
      correctedValue: args.correctedValue,
      correctionType: args.correctionType as any,
      reason: args.reason,
      correctedBy: args.correctedBy,
      impactOnEv: args.impactOnEv,
      severityLevel: args.severityLevel as any,
      shouldUpdateGroundTruth: args.shouldUpdateGroundTruth,
      learningCategory: categorizeCorrection(args.fieldPath),
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Categorize correction for learning
 */
function categorizeCorrection(fieldPath: string): string {
  if (fieldPath.includes("wacc")) return "discount_rate";
  if (fieldPath.includes("terminalGrowth")) return "terminal_assumptions";
  if (fieldPath.includes("fcfGrowth")) return "growth_assumptions";
  if (fieldPath.includes("beta")) return "risk_parameters";
  if (fieldPath.includes("source")) return "data_sources";
  return "other";
}

/**
 * Detect correction patterns
 */
export const detectPatterns = action({
  args: {
    fieldPath: v.string(),
    entityKey: v.string(),
  },
  handler: async (ctx, args) => {
    // Get recent corrections for this field
    const recentCorrections = await ctx.runQuery(
      internal.domains.financial.corrections.getRecentCorrections,
      {
        fieldPath: args.fieldPath,
        limit: 10,
      }
    );

    if (recentCorrections.length >= 3) {
      console.log(`[Corrections] Pattern detected: ${args.fieldPath} corrected ${recentCorrections.length} times`);

      // Analyze pattern
      const avgImpact = recentCorrections.reduce((sum, c) => sum + (c.impactOnEv || 0), 0) / recentCorrections.length;
      const commonReasons = findCommonReasons(recentCorrections);

      console.log(`Average EV impact: ${avgImpact.toFixed(1)}%`);
      console.log(`Common reasons: ${commonReasons.join(", ")}`);

      // TODO: Generate prompt improvement suggestion
      const suggestion = `Users frequently correct ${args.fieldPath}. Common reasons: ${commonReasons.join(", ")}. Consider updating default assumptions or validation rules.`;

      console.log(`💡 Suggestion: ${suggestion}`);

      return {
        patternDetected: true,
        fieldPath: args.fieldPath,
        correctionCount: recentCorrections.length,
        avgImpact,
        suggestion,
      };
    }

    return {
      patternDetected: false,
      correctionCount: recentCorrections.length,
    };
  },
});

/**
 * Get recent corrections
 */
export const getRecentCorrections = internalQuery({
  args: {
    fieldPath: v.optional(v.string()),
    entityKey: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db.query("modelCorrectionEvents");

    if (args.fieldPath) {
      query = query.withIndex("by_field_path", (q) =>
        q.eq("fieldPath", args.fieldPath)
      );
    } else if (args.entityKey) {
      query = query.withIndex("by_entity", (q) =>
        q.eq("entityKey", args.entityKey)
      );
    }

    const results = await query
      .order("desc")
      .take(args.limit || 10);

    return results;
  },
});

/**
 * Find common reasons in corrections
 */
function findCommonReasons(corrections: any[]): string[] {
  const reasonCounts: Record<string, number> = {};

  corrections.forEach((c) => {
    const reason = c.reason || "Unknown";
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  });

  // Sort by frequency
  const sorted = Object.entries(reasonCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([reason]) => reason);

  return sorted;
}

/**
 * Get correction statistics
 */
export const getCorrectionStats = action({
  args: {
    entityKey: v.optional(v.string()),
    days: v.optional(v.number()),
  },
  returns: v.object({
    totalCorrections: v.number(),
    bySeverity: v.any(),
    byCategory: v.any(),
    topCorrectedFields: v.array(v.any()),
  }),
  handler: async (ctx, args) => {
    const cutoffTime = args.days ?
      Date.now() - (args.days * 24 * 60 * 60 * 1000) :
      0;

    const corrections = await ctx.runQuery(
      internal.domains.financial.corrections.getRecentCorrections,
      {
        entityKey: args.entityKey,
        limit: 1000,
      }
    );

    const recent = corrections.filter((c) => c.createdAt >= cutoffTime);

    // Group by severity
    const bySeverity = {
      minor: recent.filter((c) => c.severityLevel === "minor").length,
      moderate: recent.filter((c) => c.severityLevel === "moderate").length,
      significant: recent.filter((c) => c.severityLevel === "significant").length,
    };

    // Group by category
    const byCategory: Record<string, number> = {};
    recent.forEach((c) => {
      const cat = c.learningCategory || "other";
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });

    // Top corrected fields
    const fieldCounts: Record<string, number> = {};
    recent.forEach((c) => {
      fieldCounts[c.fieldPath] = (fieldCounts[c.fieldPath] || 0) + 1;
    });

    const topCorrectedFields = Object.entries(fieldCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([field, count]) => ({ field, count }));

    return {
      totalCorrections: recent.length,
      bySeverity,
      byCategory,
      topCorrectedFields,
    };
  },
});
