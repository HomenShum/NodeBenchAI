// convex/domains/evaluation/financial/dcfComparison.ts
// DCF Model Comparison Engine
//
// Compares AI-generated DCF models against analyst ground truth.
// Produces assumption drift scores, methodology match assessment,
// and overall alignment verdicts.

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import type {
  DcfAssumptions,
  AssumptionDrift,
  AssumptionComparisonResult,
  DcfComparisonResult,
  EvaluationVerdict,
} from "./types";

/* ------------------------------------------------------------------ */
/* DRIFT THRESHOLDS                                                    */
/* ------------------------------------------------------------------ */

const DRIFT_THRESHOLDS = {
  // Revenue growth rate drift (absolute percentage points)
  revenueGrowth: {
    low: 0.02,       // ±2pp
    moderate: 0.05,  // ±5pp
    high: 0.10,      // ±10pp
  },
  // WACC drift (absolute percentage points)
  wacc: {
    low: 0.005,      // ±0.5pp
    moderate: 0.01,  // ±1pp
    high: 0.02,      // ±2pp
  },
  // Terminal growth drift (absolute percentage points)
  terminalGrowth: {
    low: 0.005,      // ±0.5pp
    moderate: 0.01,  // ±1pp
    high: 0.015,     // ±1.5pp
  },
  // Operating margin drift (absolute percentage points)
  margin: {
    low: 0.02,       // ±2pp
    moderate: 0.05,  // ±5pp
    high: 0.10,      // ±10pp
  },
  // EV drift (relative percentage)
  evDrift: {
    low: 0.10,       // ±10%
    moderate: 0.20,  // ±20%
    high: 0.30,      // ±30%
  },
};

/* ------------------------------------------------------------------ */
/* SCORING WEIGHTS                                                     */
/* ------------------------------------------------------------------ */

// Total = 100 points
const SCORING_WEIGHTS = {
  // Assumption Alignment (40 points)
  revenueGrowth: 15,
  waccAccuracy: 12,
  terminalValue: 8,
  operatingAssumptions: 5,

  // Source Quality (30 points) - handled separately
  sourceQuality: 30,

  // Model Accuracy (30 points)
  formulaAccuracy: 12,
  inputConsistency: 8,
  methodologyMatch: 6,
  structureCompliance: 4,
};

/* ------------------------------------------------------------------ */
/* DRIFT CALCULATION                                                   */
/* ------------------------------------------------------------------ */

/**
 * Calculate drift severity for a numeric value
 */
function calculateDriftSeverity(
  actual: number,
  expected: number,
  thresholds: { low: number; moderate: number; high: number }
): { drift: number; severity: "low" | "moderate" | "high" | "critical" } {
  const absoluteDrift = Math.abs(actual - expected);

  let severity: "low" | "moderate" | "high" | "critical";
  if (absoluteDrift <= thresholds.low) {
    severity = "low";
  } else if (absoluteDrift <= thresholds.moderate) {
    severity = "moderate";
  } else if (absoluteDrift <= thresholds.high) {
    severity = "high";
  } else {
    severity = "critical";
  }

  return { drift: absoluteDrift, severity };
}

/**
 * Calculate relative drift as percentage
 */
function calculateRelativeDrift(actual: number, expected: number): number {
  if (expected === 0) return actual === 0 ? 0 : 1;
  return Math.abs((actual - expected) / expected);
}

/* ------------------------------------------------------------------ */
/* ASSUMPTION COMPARISON                                               */
/* ------------------------------------------------------------------ */

/**
 * Compare revenue growth assumptions
 */
export function compareRevenueGrowth(
  ai: DcfAssumptions,
  groundTruth: DcfAssumptions
): AssumptionComparisonResult[] {
  const results: AssumptionComparisonResult[] = [];

  // Compare base revenue
  const baseDrift = calculateRelativeDrift(ai.revenue.baseRevenue, groundTruth.revenue.baseRevenue);
  results.push({
    fieldPath: "revenue.baseRevenue",
    aiValue: ai.revenue.baseRevenue,
    groundTruthValue: groundTruth.revenue.baseRevenue,
    match: baseDrift < 0.05,
    drift: {
      fieldPath: "revenue.baseRevenue",
      aiValue: ai.revenue.baseRevenue,
      groundTruthValue: groundTruth.revenue.baseRevenue,
      percentDrift: baseDrift,
      severity: baseDrift < 0.05 ? "low" : baseDrift < 0.10 ? "moderate" : "high",
      explanation: `Base revenue differs by ${(baseDrift * 100).toFixed(1)}%`,
    },
  });

  // Compare growth rates by year
  const minYears = Math.min(ai.revenue.growthRates.length, groundTruth.revenue.growthRates.length);
  for (let i = 0; i < minYears; i++) {
    const aiRate = ai.revenue.growthRates[i].rate;
    const gtRate = groundTruth.revenue.growthRates[i].rate;
    const { drift, severity } = calculateDriftSeverity(aiRate, gtRate, DRIFT_THRESHOLDS.revenueGrowth);

    results.push({
      fieldPath: `revenue.growthRates[${i}].rate`,
      aiValue: aiRate,
      groundTruthValue: gtRate,
      match: severity === "low",
      drift: {
        fieldPath: `revenue.growthRates[${i}].rate`,
        aiValue: aiRate,
        groundTruthValue: gtRate,
        percentDrift: drift,
        severity,
        explanation: `Year ${i + 1} growth rate: AI ${(aiRate * 100).toFixed(1)}% vs GT ${(gtRate * 100).toFixed(1)}% (${severity} drift)`,
      },
    });
  }

  // Compare terminal growth rate
  const { drift: tgDrift, severity: tgSeverity } = calculateDriftSeverity(
    ai.revenue.terminalGrowthRate,
    groundTruth.revenue.terminalGrowthRate,
    DRIFT_THRESHOLDS.terminalGrowth
  );

  results.push({
    fieldPath: "revenue.terminalGrowthRate",
    aiValue: ai.revenue.terminalGrowthRate,
    groundTruthValue: groundTruth.revenue.terminalGrowthRate,
    match: tgSeverity === "low",
    drift: {
      fieldPath: "revenue.terminalGrowthRate",
      aiValue: ai.revenue.terminalGrowthRate,
      groundTruthValue: groundTruth.revenue.terminalGrowthRate,
      percentDrift: tgDrift,
      severity: tgSeverity,
      explanation: `Terminal growth: AI ${(ai.revenue.terminalGrowthRate * 100).toFixed(1)}% vs GT ${(groundTruth.revenue.terminalGrowthRate * 100).toFixed(1)}%`,
    },
  });

  return results;
}

/**
 * Compare WACC assumptions
 */
export function compareWacc(
  ai: DcfAssumptions,
  groundTruth: DcfAssumptions
): AssumptionComparisonResult[] {
  const results: AssumptionComparisonResult[] = [];

  const waccFields: Array<{ field: keyof typeof ai.wacc; name: string }> = [
    { field: "riskFreeRate", name: "Risk-free rate" },
    { field: "marketRiskPremium", name: "Market risk premium" },
    { field: "beta", name: "Beta" },
    { field: "costOfEquity", name: "Cost of equity" },
    { field: "costOfDebt", name: "Cost of debt" },
    { field: "taxRate", name: "Tax rate" },
    { field: "wacc", name: "WACC" },
  ];

  for (const { field, name } of waccFields) {
    if (field === "sources") continue;

    const aiValue = ai.wacc[field] as number;
    const gtValue = groundTruth.wacc[field] as number;
    const { drift, severity } = calculateDriftSeverity(aiValue, gtValue, DRIFT_THRESHOLDS.wacc);

    results.push({
      fieldPath: `wacc.${field}`,
      aiValue,
      groundTruthValue: gtValue,
      match: severity === "low",
      drift: {
        fieldPath: `wacc.${field}`,
        aiValue,
        groundTruthValue: gtValue,
        percentDrift: drift,
        severity,
        explanation: `${name}: AI ${(aiValue * 100).toFixed(2)}% vs GT ${(gtValue * 100).toFixed(2)}%`,
      },
    });
  }

  return results;
}

/**
 * Compare terminal value methodology
 */
export function compareTerminalValue(
  ai: DcfAssumptions,
  groundTruth: DcfAssumptions
): AssumptionComparisonResult[] {
  const results: AssumptionComparisonResult[] = [];

  // Compare method
  results.push({
    fieldPath: "terminal.method",
    aiValue: ai.terminal.method,
    groundTruthValue: groundTruth.terminal.method,
    match: ai.terminal.method === groundTruth.terminal.method,
    drift: ai.terminal.method !== groundTruth.terminal.method ? {
      fieldPath: "terminal.method",
      aiValue: ai.terminal.method,
      groundTruthValue: groundTruth.terminal.method,
      severity: "high",
      explanation: `Different TV methods: AI uses ${ai.terminal.method}, GT uses ${groundTruth.terminal.method}`,
    } : undefined,
  });

  // Compare perpetuity growth if applicable
  if (ai.terminal.perpetuityGrowth !== undefined && groundTruth.terminal.perpetuityGrowth !== undefined) {
    const { drift, severity } = calculateDriftSeverity(
      ai.terminal.perpetuityGrowth,
      groundTruth.terminal.perpetuityGrowth,
      DRIFT_THRESHOLDS.terminalGrowth
    );

    results.push({
      fieldPath: "terminal.perpetuityGrowth",
      aiValue: ai.terminal.perpetuityGrowth,
      groundTruthValue: groundTruth.terminal.perpetuityGrowth,
      match: severity === "low",
      drift: {
        fieldPath: "terminal.perpetuityGrowth",
        aiValue: ai.terminal.perpetuityGrowth,
        groundTruthValue: groundTruth.terminal.perpetuityGrowth,
        percentDrift: drift,
        severity,
        explanation: `Perpetuity growth differs by ${(drift * 100).toFixed(2)}pp`,
      },
    });
  }

  return results;
}

/**
 * Compare operating assumptions (margins, capex, etc.)
 */
export function compareOperatingAssumptions(
  ai: DcfAssumptions,
  groundTruth: DcfAssumptions
): AssumptionComparisonResult[] {
  const results: AssumptionComparisonResult[] = [];

  // Helper to compare year-value arrays
  const compareYearValues = (
    aiValues: Array<{ year: number; value: number }>,
    gtValues: Array<{ year: number; value: number }>,
    fieldName: string
  ) => {
    // Compare averages
    const aiAvg = aiValues.reduce((sum, v) => sum + v.value, 0) / aiValues.length;
    const gtAvg = gtValues.reduce((sum, v) => sum + v.value, 0) / gtValues.length;
    const { drift, severity } = calculateDriftSeverity(aiAvg, gtAvg, DRIFT_THRESHOLDS.margin);

    results.push({
      fieldPath: `operating.${fieldName}`,
      aiValue: aiAvg,
      groundTruthValue: gtAvg,
      match: severity === "low" || severity === "moderate",
      drift: {
        fieldPath: `operating.${fieldName}`,
        aiValue: aiAvg,
        groundTruthValue: gtAvg,
        percentDrift: drift,
        severity,
        explanation: `Average ${fieldName}: AI ${(aiAvg * 100).toFixed(1)}% vs GT ${(gtAvg * 100).toFixed(1)}%`,
      },
    });
  };

  compareYearValues(ai.operating.grossMargin, groundTruth.operating.grossMargin, "grossMargin");
  compareYearValues(ai.operating.sgaPercent, groundTruth.operating.sgaPercent, "sgaPercent");
  compareYearValues(ai.operating.daPercent, groundTruth.operating.daPercent, "daPercent");
  compareYearValues(ai.operating.capexPercent, groundTruth.operating.capexPercent, "capexPercent");
  compareYearValues(ai.operating.nwcPercent, groundTruth.operating.nwcPercent, "nwcPercent");

  if (ai.operating.rdPercent && groundTruth.operating.rdPercent) {
    compareYearValues(ai.operating.rdPercent, groundTruth.operating.rdPercent, "rdPercent");
  }

  return results;
}

/* ------------------------------------------------------------------ */
/* SCORING                                                             */
/* ------------------------------------------------------------------ */

/**
 * Calculate assumption drift score (0-40)
 */
export function calculateAssumptionDriftScore(
  revenueComparison: AssumptionComparisonResult[],
  waccComparison: AssumptionComparisonResult[],
  terminalComparison: AssumptionComparisonResult[],
  operatingComparison: AssumptionComparisonResult[]
): number {
  let score = 0;

  // Revenue growth (15 points)
  const revenueMatches = revenueComparison.filter((r) => r.match).length;
  const revenueTotal = revenueComparison.length;
  score += (revenueMatches / revenueTotal) * SCORING_WEIGHTS.revenueGrowth;

  // WACC accuracy (12 points)
  const waccMatches = waccComparison.filter((r) => r.match).length;
  const waccTotal = waccComparison.length;
  score += (waccMatches / waccTotal) * SCORING_WEIGHTS.waccAccuracy;

  // Terminal value (8 points)
  const tvMatches = terminalComparison.filter((r) => r.match).length;
  const tvTotal = terminalComparison.length;
  score += (tvMatches / tvTotal) * SCORING_WEIGHTS.terminalValue;

  // Operating assumptions (5 points)
  const opMatches = operatingComparison.filter((r) => r.match).length;
  const opTotal = operatingComparison.length;
  score += (opMatches / opTotal) * SCORING_WEIGHTS.operatingAssumptions;

  return Math.round(score * 10) / 10;
}

/**
 * Calculate methodology match score (0-30)
 */
export function calculateMethodologyScore(
  ai: DcfAssumptions,
  groundTruth: DcfAssumptions,
  evDrift: number
): number {
  let score = 0;

  // Formula accuracy (12 points) - based on EV drift
  if (evDrift < 0.10) {
    score += SCORING_WEIGHTS.formulaAccuracy;
  } else if (evDrift < 0.20) {
    score += SCORING_WEIGHTS.formulaAccuracy * 0.7;
  } else if (evDrift < 0.30) {
    score += SCORING_WEIGHTS.formulaAccuracy * 0.4;
  }

  // Input consistency (8 points)
  // Check that all required inputs are present
  const requiredInputs = ["forecastYears", "baseYear", "revenue", "operating", "wacc", "terminal"];
  const hasAllInputs = requiredInputs.every((input) => (ai as any)[input] !== undefined);
  if (hasAllInputs) score += SCORING_WEIGHTS.inputConsistency;

  // Methodology match (6 points)
  if (ai.terminal.method === groundTruth.terminal.method) {
    score += SCORING_WEIGHTS.methodologyMatch;
  }

  // Structure compliance (4 points)
  if (ai.forecastYears === groundTruth.forecastYears) {
    score += SCORING_WEIGHTS.structureCompliance;
  }

  return Math.round(score * 10) / 10;
}

/**
 * Determine overall verdict
 */
export function determineVerdict(
  assumptionDriftScore: number,
  methodologyScore: number,
  evDrift: number
): EvaluationVerdict {
  // Assumption alignment threshold: need at least 60% of 40 points = 24
  // Methodology threshold: need at least 60% of 30 points = 18

  const assumptionPercent = assumptionDriftScore / 40;
  const methodologyPercent = methodologyScore / 30;
  const overallScore = assumptionDriftScore + methodologyScore; // Out of 70 (excluding source quality)

  let verdict: "ALIGNED" | "MINOR_DRIFT" | "SIGNIFICANT_DRIFT" | "METHODOLOGY_MISMATCH";
  let explanation: string;

  if (methodologyPercent < 0.5) {
    verdict = "METHODOLOGY_MISMATCH";
    explanation = "The DCF methodology differs significantly from the ground truth approach.";
  } else if (evDrift > DRIFT_THRESHOLDS.evDrift.high) {
    verdict = "SIGNIFICANT_DRIFT";
    explanation = `Enterprise value differs by ${(evDrift * 100).toFixed(1)}% from ground truth.`;
  } else if (assumptionPercent < 0.6 || evDrift > DRIFT_THRESHOLDS.evDrift.moderate) {
    verdict = "MINOR_DRIFT";
    explanation = "Some assumptions deviate from ground truth but methodology is sound.";
  } else {
    verdict = "ALIGNED";
    explanation = "Model closely aligns with analyst ground truth.";
  }

  return {
    verdict,
    overallScore: Math.round(overallScore * 10) / 10,
    assumptionDriftScore,
    sourceQualityScore: 0, // Calculated separately
    modelAlignmentScore: methodologyScore,
    explanation,
  };
}

/* ------------------------------------------------------------------ */
/* MAIN COMPARISON FUNCTION                                            */
/* ------------------------------------------------------------------ */

/**
 * Compare AI model against ground truth
 */
export function compareDcfModels(
  aiAssumptions: DcfAssumptions,
  groundTruthAssumptions: DcfAssumptions,
  aiEv: number,
  groundTruthEv: number,
  entityKey: string,
  aiVersion: number,
  gtVersion?: number
): DcfComparisonResult {
  // Run all comparisons
  const revenueGrowthComparison = compareRevenueGrowth(aiAssumptions, groundTruthAssumptions);
  const waccComparison = compareWacc(aiAssumptions, groundTruthAssumptions);
  const terminalValueComparison = compareTerminalValue(aiAssumptions, groundTruthAssumptions);
  const operatingAssumptionComparison = compareOperatingAssumptions(aiAssumptions, groundTruthAssumptions);

  // Calculate EV drift
  const evDrift = calculateRelativeDrift(aiEv, groundTruthEv);
  const evDriftAbsolute = Math.abs(aiEv - groundTruthEv);

  // Calculate scores
  const assumptionDriftScore = calculateAssumptionDriftScore(
    revenueGrowthComparison,
    waccComparison,
    terminalValueComparison,
    operatingAssumptionComparison
  );

  const methodologyMatchScore = calculateMethodologyScore(
    aiAssumptions,
    groundTruthAssumptions,
    evDrift
  );

  // Determine verdict
  const verdict = determineVerdict(assumptionDriftScore, methodologyMatchScore, evDrift);

  return {
    entityKey,
    aiModelVersion: aiVersion,
    groundTruthVersion: gtVersion,
    revenueGrowthComparison,
    waccComparison,
    terminalValueComparison,
    operatingAssumptionComparison,
    evDrift,
    evDriftAbsolute,
    assumptionDriftScore,
    methodologyMatchScore,
    overallAlignmentScore: assumptionDriftScore + methodologyMatchScore,
    verdict,
  };
}

/* ------------------------------------------------------------------ */
/* CONVEX FUNCTIONS                                                    */
/* ------------------------------------------------------------------ */

/**
 * Run DCF comparison and store evaluation results
 */
export const runDcfComparison = internalAction({
  args: {
    aiModelId: v.id("dcfModels"),
    groundTruthVersionId: v.optional(v.id("groundTruthVersions")),
    groundTruthAssumptions: v.optional(v.any()),  // Alternative: provide assumptions directly
    groundTruthEv: v.optional(v.number()),
  },
  returns: v.object({
    ok: v.boolean(),
    evaluationId: v.optional(v.string()),
    comparison: v.optional(v.any()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      // Get AI model
      const aiModel = await ctx.runQuery(
        internal.domains.evaluation.financial.dcfEngine.getDcfModel,
        { modelId: args.aiModelId }
      );

      if (!aiModel) {
        return { ok: false, error: "AI model not found" };
      }

      // Get ground truth
      let gtAssumptions: DcfAssumptions;
      let gtEv: number;
      let gtVersion: number | undefined;

      if (args.groundTruthAssumptions && args.groundTruthEv !== undefined) {
        gtAssumptions = args.groundTruthAssumptions as DcfAssumptions;
        gtEv = args.groundTruthEv;
      } else if (args.groundTruthVersionId) {
        // TODO: Load from ground truth version
        return { ok: false, error: "Ground truth version loading not yet implemented" };
      } else {
        return { ok: false, error: "Either groundTruthAssumptions or groundTruthVersionId required" };
      }

      // Run comparison
      const comparison = compareDcfModels(
        aiModel.assumptions,
        gtAssumptions,
        aiModel.outputs.enterpriseValue,
        gtEv,
        aiModel.entityKey,
        aiModel.version,
        gtVersion
      );

      // Generate evaluation ID
      const evaluationId = `eval_${aiModel.entityKey}_${Date.now()}`;

      // Store evaluation result
      await ctx.runMutation(
        internal.domains.evaluation.financial.dcfComparison.createEvaluation,
        {
          evaluationId,
          entityKey: aiModel.entityKey,
          evaluationType: "dcf",
          aiModelId: args.aiModelId,
          groundTruthVersionId: args.groundTruthVersionId,
          assumptionDriftScore: comparison.assumptionDriftScore,
          sourceQualityScore: 0, // TODO: Calculate separately
          modelAlignmentScore: comparison.methodologyMatchScore,
          overallScore: comparison.overallAlignmentScore,
          verdict: comparison.verdict.verdict,
          comparison,
        }
      );

      return {
        ok: true,
        evaluationId,
        comparison,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

/**
 * Create evaluation record
 */
export const createEvaluation = internalMutation({
  args: {
    evaluationId: v.string(),
    entityKey: v.string(),
    evaluationType: v.union(v.literal("dcf"), v.literal("comparables"), v.literal("lbo")),
    aiModelId: v.id("dcfModels"),
    groundTruthVersionId: v.optional(v.id("groundTruthVersions")),
    assumptionDriftScore: v.number(),
    sourceQualityScore: v.number(),
    modelAlignmentScore: v.number(),
    overallScore: v.number(),
    verdict: v.union(
      v.literal("ALIGNED"),
      v.literal("MINOR_DRIFT"),
      v.literal("SIGNIFICANT_DRIFT"),
      v.literal("METHODOLOGY_MISMATCH")
    ),
    comparison: v.any(),
  },
  returns: v.id("financialModelEvaluations"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("financialModelEvaluations", {
      evaluationId: args.evaluationId,
      entityKey: args.entityKey,
      evaluationType: args.evaluationType,
      aiModelId: args.aiModelId,
      groundTruthVersionId: args.groundTruthVersionId,
      assumptionDriftScore: args.assumptionDriftScore,
      sourceQualityScore: args.sourceQualityScore,
      modelAlignmentScore: args.modelAlignmentScore,
      overallScore: args.overallScore,
      verdict: args.verdict,
      detailedComparison: args.comparison,
      createdAt: Date.now(),
    });
  },
});

/**
 * Get evaluation by ID
 */
export const getEvaluation = internalQuery({
  args: {
    evaluationId: v.string(),
  },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("financialModelEvaluations")
      .filter((q) => q.eq(q.field("evaluationId"), args.evaluationId))
      .first();
  },
});
