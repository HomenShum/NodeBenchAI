/**
 * Human-In-The-Loop Correction Capture
 *
 * Captures analyst corrections to AI-generated DCF models for continuous learning:
 * - Records field-level corrections with reasoning
 * - Tracks impact on enterprise value
 * - Categorizes correction patterns for model improvement
 * - Flags high-impact corrections for ground truth updates
 *
 * Workflow:
 * 1. Analyst reviews AI-generated DCF model
 * 2. Identifies incorrect assumptions/values
 * 3. Submits correction with justification
 * 4. System calculates impact on valuation
 * 5. Correction logged for learning
 */

import { internalQuery, internalMutation, mutation, query, action } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { v } from "convex/values";

/**
 * Submit a correction to a DCF model
 */
export const submitCorrection = mutation({
  args: {
    evaluationId: v.id("financialModelEvaluations"),
    dcfModelId: v.id("dcfModels"),
    entityKey: v.string(),
    fieldPath: v.string(), // e.g., "assumptions.revenue.growthRates[0].rate"
    aiValue: v.any(),
    correctedValue: v.any(),
    correctionType: v.union(
      v.literal("value_override"),
      v.literal("formula_fix"),
      v.literal("source_replacement"),
      v.literal("assumption_reject")
    ),
    reason: v.string(),
    betterSourceArtifactId: v.optional(v.id("sourceArtifacts")),
    correctedBy: v.id("users"),
  },
  returns: v.object({
    correctionId: v.string(),
    impactCalculated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Generate unique correction ID
    const correctionId = `correction-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Insert correction event (impact will be calculated async)
    const eventId = await ctx.db.insert("modelCorrectionEvents", {
      correctionId,
      evaluationId: args.evaluationId,
      dcfModelId: args.dcfModelId,
      entityKey: args.entityKey,
      fieldPath: args.fieldPath,
      aiValue: args.aiValue,
      correctedValue: args.correctedValue,
      correctionType: args.correctionType,
      reason: args.reason,
      betterSourceArtifactId: args.betterSourceArtifactId,
      impactOnEv: undefined, // Will be calculated
      severityLevel: "minor", // Will be updated after impact calculation
      shouldUpdateGroundTruth: false, // Will be determined after impact
      learningCategory: undefined,
      correctedBy: args.correctedBy,
      reviewedBy: undefined,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Trigger impact calculation async
    await ctx.scheduler.runAfter(0, internal.domains.evaluation.financial.corrections.calculateCorrectionImpact, {
      correctionId,
    });

    return {
      correctionId,
      impactCalculated: false,
    };
  },
});

/**
 * Calculate impact of correction on enterprise value
 */
export const calculateCorrectionImpact = internalMutation({
  args: {
    correctionId: v.string(),
  },
  returns: v.object({ impactPercent: v.number(), severityLevel: v.string() }),
  handler: async (ctx, args) => {
    // Get correction event
    const correction = await ctx.db
      .query("modelCorrectionEvents")
      .filter(q => q.eq(q.field("correctionId"), args.correctionId))
      .first();

    if (!correction) {
      throw new Error(`Correction ${args.correctionId} not found`);
    }

    // Get original DCF model
    const model = await ctx.db.get(correction.dcfModelId);
    if (!model) {
      throw new Error(`DCF model ${correction.dcfModelId} not found`);
    }

    const originalEV = model.outputs.enterpriseValue;

    // Create a copy of assumptions with correction applied
    const correctedAssumptions = JSON.parse(JSON.stringify(model.assumptions));
    applyCorrection(correctedAssumptions, correction.fieldPath, correction.correctedValue);

    // Recalculate EV with corrected value (simplified calculation)
    // In production, this would call the full DCF engine
    const correctedEV = estimateEVWithCorrection(
      originalEV,
      correction.fieldPath,
      correction.aiValue,
      correction.correctedValue
    );

    // Calculate impact
    const impactPercent = ((correctedEV - originalEV) / originalEV) * 100;
    const impactAbs = Math.abs(impactPercent);

    // Determine severity
    let severityLevel: "minor" | "moderate" | "significant";
    if (impactAbs < 5) {
      severityLevel = "minor";
    } else if (impactAbs < 15) {
      severityLevel = "moderate";
    } else {
      severityLevel = "significant";
    }

    // Determine if should update ground truth
    const shouldUpdateGroundTruth = severityLevel === "significant" || correction.correctionType === "source_replacement";

    // Categorize learning pattern
    const learningCategory = categorizeLearning(correction.fieldPath, correction.correctionType);

    // Update correction event
    await ctx.db.patch(correction._id, {
      impactOnEv: impactPercent,
      severityLevel,
      shouldUpdateGroundTruth,
      learningCategory,
      updatedAt: Date.now(),
    });

    return {
      impactPercent,
      severityLevel,
    };
  },
});

/**
 * Get corrections for an evaluation
 */
export const getCorrectionsByEvaluation = query({
  args: {
    evaluationId: v.id("financialModelEvaluations"),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const corrections = await ctx.db
      .query("modelCorrectionEvents")
      .withIndex("by_evaluation", q => q.eq("evaluationId", args.evaluationId))
      .collect();

    return corrections;
  },
});

/**
 * Get corrections by entity
 */
export const getCorrectionsByEntity = query({
  args: {
    entityKey: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("modelCorrectionEvents")
      .withIndex("by_entity", q => q.eq("entityKey", args.entityKey))
      .order("desc");

    if (args.limit) {
      query = query.take(args.limit) as any;
    }

    return await query.collect();
  },
});

/**
 * Get corrections flagged for ground truth update
 */
export const getCorrectionsFlaggedForGroundTruth = query({
  args: {
    status: v.optional(v.string()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("modelCorrectionEvents")
      .withIndex("by_status", q => q.eq("shouldUpdateGroundTruth", true));

    if (args.status) {
      query = query.filter(q => q.eq(q.field("status"), args.status));
    }

    return await query.collect();
  },
});

/**
 * Get correction patterns by field path
 */
export const getCorrectionPatterns = query({
  args: {
    fieldPath: v.optional(v.string()),
    correctionType: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    let query = ctx.db.query("modelCorrectionEvents");

    if (args.fieldPath) {
      query = query.withIndex("by_field_path", q => q.eq("fieldPath", args.fieldPath));
      if (args.correctionType) {
        query = query.filter(q => q.eq(q.field("correctionType"), args.correctionType));
      }
    }

    query = query.order("desc");

    if (args.limit) {
      query = query.take(args.limit) as any;
    }

    return await query.collect();
  },
});

/**
 * Approve correction
 */
export const approveCorrection = mutation({
  args: {
    correctionId: v.string(),
    reviewerId: v.id("users"),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const correction = await ctx.db
      .query("modelCorrectionEvents")
      .filter(q => q.eq(q.field("correctionId"), args.correctionId))
      .first();

    if (!correction) {
      throw new Error(`Correction ${args.correctionId} not found`);
    }

    await ctx.db.patch(correction._id, {
      status: "accepted",
      reviewedBy: args.reviewerId,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Reject correction
 */
export const rejectCorrection = mutation({
  args: {
    correctionId: v.string(),
    reviewerId: v.id("users"),
    reason: v.optional(v.string()),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const correction = await ctx.db
      .query("modelCorrectionEvents")
      .filter(q => q.eq(q.field("correctionId"), args.correctionId))
      .first();

    if (!correction) {
      throw new Error(`Correction ${args.correctionId} not found`);
    }

    await ctx.db.patch(correction._id, {
      status: "rejected",
      reviewedBy: args.reviewerId,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Get correction summary for entity
 */
export const getCorrectionSummary = query({
  args: {
    entityKey: v.string(),
  },
  returns: v.object({
    totalCorrections: v.number(),
    bySeverity: v.any(),
    byType: v.any(),
    byStatus: v.any(),
    flaggedForGroundTruth: v.number(),
    averageImpact: v.number(),
  }),
  handler: async (ctx, args) => {
    const corrections = await ctx.db
      .query("modelCorrectionEvents")
      .withIndex("by_entity", q => q.eq("entityKey", args.entityKey))
      .collect();

    const bySeverity: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let flaggedCount = 0;
    let totalImpact = 0;
    let impactCount = 0;

    for (const correction of corrections) {
      bySeverity[correction.severityLevel] = (bySeverity[correction.severityLevel] || 0) + 1;
      byType[correction.correctionType] = (byType[correction.correctionType] || 0) + 1;
      byStatus[correction.status] = (byStatus[correction.status] || 0) + 1;

      if (correction.shouldUpdateGroundTruth) {
        flaggedCount++;
      }

      if (correction.impactOnEv !== undefined) {
        totalImpact += Math.abs(correction.impactOnEv);
        impactCount++;
      }
    }

    return {
      totalCorrections: corrections.length,
      bySeverity,
      byType,
      byStatus,
      flaggedForGroundTruth: flaggedCount,
      averageImpact: impactCount > 0 ? totalImpact / impactCount : 0,
    };
  },
});

/**
 * Helper: Apply correction to nested object
 */
function applyCorrection(obj: any, path: string, value: any): void {
  const parts = path.split(".");
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);

    if (arrayMatch) {
      const arrayName = arrayMatch[1];
      const index = parseInt(arrayMatch[2]);
      current = current[arrayName][index];
    } else {
      current = current[part];
    }
  }

  const lastPart = parts[parts.length - 1];
  const arrayMatch = lastPart.match(/^(.+)\[(\d+)\]$/);

  if (arrayMatch) {
    const arrayName = arrayMatch[1];
    const index = parseInt(arrayMatch[2]);
    current[arrayName][index] = value;
  } else {
    current[lastPart] = value;
  }
}

/**
 * Helper: Estimate EV impact (simplified heuristic)
 */
function estimateEVWithCorrection(
  originalEV: number,
  fieldPath: string,
  originalValue: any,
  correctedValue: any
): number {
  // Simplified impact estimation based on field type
  // In production, would re-run full DCF calculation

  if (fieldPath.includes("growthRates")) {
    // Growth rate change - assume 1% growth = ~5% EV change
    const rateDiff = (correctedValue - originalValue) * 100; // Convert to percentage points
    return originalEV * (1 + rateDiff * 0.05);
  }

  if (fieldPath.includes("wacc")) {
    // WACC change - assume 1% WACC = ~10% EV change (inverse)
    const waccDiff = (correctedValue - originalValue) * 100;
    return originalEV * (1 - waccDiff * 0.10);
  }

  if (fieldPath.includes("terminalGrowth")) {
    // Terminal growth - assume 1% = ~8% EV change
    const terminalDiff = (correctedValue - originalValue) * 100;
    return originalEV * (1 + terminalDiff * 0.08);
  }

  // Default: assume 5% impact
  return originalEV * 1.05;
}

/**
 * Helper: Categorize learning pattern
 */
function categorizeLearning(fieldPath: string, correctionType: string): string {
  if (fieldPath.includes("revenue")) {
    return "revenue_forecasting";
  }
  if (fieldPath.includes("wacc") || fieldPath.includes("beta")) {
    return "cost_of_capital";
  }
  if (fieldPath.includes("terminal")) {
    return "terminal_value";
  }
  if (fieldPath.includes("margin")) {
    return "profitability";
  }
  if (correctionType === "source_replacement") {
    return "source_selection";
  }
  return "other";
}
