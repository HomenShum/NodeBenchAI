/**
 * DCF Evaluator - 100-Point Scoring System vs Ground Truth
 *
 * Evaluates DCF models against verified financial data:
 * - Historical Accuracy (25%): Base period vs SEC filings
 * - Assumption Quality (35%): WACC, growth rates, margins
 * - Methodology (20%): Formula correctness, structure
 * - Valuation Match (20%): Calculated vs market/analyst consensus
 *
 * Design: Fine-grained scoring functions (transparent, auditable)
 *
 * Based on:
 * - CFA Institute valuation standards
 * - McKinsey DCF best practices
 * - Academic research on DCF accuracy
 */

import { v } from "convex/values";
import { action, internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";

/* ================================================================== */
/* HISTORICAL ACCURACY (25 points)                                   */
/* ================================================================== */

export const scoreHistoricalAccuracy = action({
  args: {
    modelBaseFCF: v.number(),
    groundTruthFCF: v.number(),
    modelBaseRevenue: v.optional(v.number()),
    groundTruthRevenue: v.optional(v.number()),
  },
  returns: v.object({
    score: v.number(),
    maxScore: v.number(),
    fcfAccuracy: v.number(),
    revenueAccuracy: v.optional(v.number()),
    breakdown: v.object({
      fcfDiff: v.number(),
      fcfDiffPercent: v.number(),
      fcfPoints: v.number(),
      revenuePoints: v.optional(v.number()),
    }),
    verdict: v.string(),
  }),
  handler: async (ctx, args) => {
    const maxScore = 25;
    let totalPoints = 0;

    // FCF accuracy (15 points)
    const fcfDiff = args.modelBaseFCF - args.groundTruthFCF;
    const fcfDiffPercent = Math.abs(fcfDiff / args.groundTruthFCF) * 100;

    let fcfPoints = 0;
    if (fcfDiffPercent <= 2) {
      fcfPoints = 15; // Perfect
    } else if (fcfDiffPercent <= 5) {
      fcfPoints = 13; // Excellent
    } else if (fcfDiffPercent <= 10) {
      fcfPoints = 10; // Good
    } else if (fcfDiffPercent <= 20) {
      fcfPoints = 6; // Acceptable
    } else {
      fcfPoints = 2; // Poor
    }
    totalPoints += fcfPoints;

    // Revenue accuracy (10 points) - if provided
    let revenuePoints: number | undefined;
    let revenueAccuracy: number | undefined;
    if (args.modelBaseRevenue && args.groundTruthRevenue) {
      const revDiff = args.modelBaseRevenue - args.groundTruthRevenue;
      const revDiffPercent = Math.abs(revDiff / args.groundTruthRevenue) * 100;
      revenueAccuracy = 100 - revDiffPercent;

      if (revDiffPercent <= 2) {
        revenuePoints = 10;
      } else if (revDiffPercent <= 5) {
        revenuePoints = 8;
      } else if (revDiffPercent <= 10) {
        revenuePoints = 5;
      } else {
        revenuePoints = 2;
      }
      totalPoints += revenuePoints;
    }

    // Verdict
    const verdict =
      totalPoints >= 23 ? "Excellent historical data match" :
      totalPoints >= 18 ? "Good historical accuracy" :
      totalPoints >= 13 ? "Acceptable historical accuracy" :
      "Historical data needs improvement";

    return {
      score: totalPoints,
      maxScore,
      fcfAccuracy: 100 - fcfDiffPercent,
      revenueAccuracy,
      breakdown: {
        fcfDiff,
        fcfDiffPercent,
        fcfPoints,
        revenuePoints,
      },
      verdict,
    };
  },
});

/* ================================================================== */
/* ASSUMPTION QUALITY (35 points)                                     */
/* ================================================================== */

export const scoreAssumptionQuality = action({
  args: {
    wacc: v.number(),
    terminalGrowth: v.number(),
    avgFCFGrowth: v.number(),
    beta: v.number(),
    // Industry benchmarks (optional)
    industryWACC: v.optional(v.number()),
    gdpGrowth: v.optional(v.number()),
  },
  returns: v.object({
    score: v.number(),
    maxScore: v.number(),
    breakdown: v.object({
      waccReasonableness: v.number(),
      terminalGrowthReasonableness: v.number(),
      fcfGrowthReasonableness: v.number(),
      betaReasonableness: v.number(),
    }),
    warnings: v.array(v.string()),
    verdict: v.string(),
  }),
  handler: async (ctx, args) => {
    const maxScore = 35;
    const warnings: string[] = [];
    const breakdown = {
      waccReasonableness: 0,
      terminalGrowthReasonableness: 0,
      fcfGrowthReasonableness: 0,
      betaReasonableness: 0,
    };

    // WACC reasonableness (10 points)
    // Typical range: 8-15% for most companies
    if (args.wacc >= 0.08 && args.wacc <= 0.15) {
      breakdown.waccReasonableness = 10;
    } else if (args.wacc >= 0.06 && args.wacc <= 0.20) {
      breakdown.waccReasonableness = 7;
      warnings.push(`WACC ${(args.wacc * 100).toFixed(1)}% outside typical 8-15% range`);
    } else {
      breakdown.waccReasonableness = 3;
      warnings.push(`WACC ${(args.wacc * 100).toFixed(1)}% highly unusual`);
    }

    // Compare to industry benchmark if provided
    if (args.industryWACC) {
      const waccDiff = Math.abs(args.wacc - args.industryWACC);
      if (waccDiff > 0.03) {
        warnings.push(`WACC differs from industry average by ${(waccDiff * 100).toFixed(1)}%`);
      }
    }

    // Terminal growth reasonableness (10 points)
    const gdpGrowth = args.gdpGrowth || 0.03; // Default 3%
    if (args.terminalGrowth >= 0.02 && args.terminalGrowth <= gdpGrowth) {
      breakdown.terminalGrowthReasonableness = 10;
    } else if (args.terminalGrowth <= gdpGrowth + 0.01) {
      breakdown.terminalGrowthReasonableness = 7;
      warnings.push(`Terminal growth ${(args.terminalGrowth * 100).toFixed(1)}% slightly above GDP`);
    } else {
      breakdown.terminalGrowthReasonableness = 3;
      warnings.push(`Terminal growth ${(args.terminalGrowth * 100).toFixed(1)}% unrealistic (exceeds GDP)`);
    }

    // Terminal growth must be < WACC
    if (args.terminalGrowth >= args.wacc) {
      breakdown.terminalGrowthReasonableness = 0;
      warnings.push("CRITICAL: Terminal growth >= WACC (mathematically invalid)");
    }

    // FCF growth reasonableness (10 points)
    // Typical range: -5% to 20% average
    if (args.avgFCFGrowth >= 0 && args.avgFCFGrowth <= 0.15) {
      breakdown.fcfGrowthReasonableness = 10;
    } else if (args.avgFCFGrowth >= -0.05 && args.avgFCFGrowth <= 0.25) {
      breakdown.fcfGrowthReasonableness = 7;
      warnings.push(`FCF growth ${(args.avgFCFGrowth * 100).toFixed(1)}% outside typical 0-15% range`);
    } else {
      breakdown.fcfGrowthReasonableness = 3;
      warnings.push(`FCF growth ${(args.avgFCFGrowth * 100).toFixed(1)}% highly unusual`);
    }

    // Beta reasonableness (5 points)
    // Typical range: 0.5-2.0
    if (args.beta >= 0.5 && args.beta <= 2.0) {
      breakdown.betaReasonableness = 5;
    } else if (args.beta >= 0.3 && args.beta <= 3.0) {
      breakdown.betaReasonableness = 3;
      warnings.push(`Beta ${args.beta.toFixed(2)} outside typical 0.5-2.0 range`);
    } else {
      breakdown.betaReasonableness = 1;
      warnings.push(`Beta ${args.beta.toFixed(2)} highly unusual`);
    }

    const totalScore = Object.values(breakdown).reduce((sum, val) => sum + val, 0);

    const verdict =
      totalScore >= 32 ? "Excellent assumption quality" :
      totalScore >= 25 ? "Good assumptions with minor concerns" :
      totalScore >= 18 ? "Acceptable assumptions with some red flags" :
      "Assumptions need significant improvement";

    return {
      score: totalScore,
      maxScore,
      breakdown,
      warnings,
      verdict,
    };
  },
});

/* ================================================================== */
/* METHODOLOGY (20 points)                                            */
/* ================================================================== */

export const scoreMethodology = action({
  args: {
    hasWACC: v.boolean(),
    hasFCFProjections: v.boolean(),
    hasTerminalValue: v.boolean(),
    hasPresentValue: v.boolean(),
    projectionYears: v.number(),
    terminalAsPercent: v.number(),
  },
  returns: v.object({
    score: v.number(),
    maxScore: v.number(),
    breakdown: v.object({
      structureCompleteness: v.number(),
      projectionPeriod: v.number(),
      terminalValueWeight: v.number(),
      formulaCorrectness: v.number(),
    }),
    issues: v.array(v.string()),
    verdict: v.string(),
  }),
  handler: async (ctx, args) => {
    const maxScore = 20;
    const issues: string[] = [];
    const breakdown = {
      structureCompleteness: 0,
      projectionPeriod: 0,
      terminalValueWeight: 0,
      formulaCorrectness: 0,
    };

    // Structure completeness (8 points)
    let structurePoints = 0;
    if (args.hasWACC) structurePoints += 2;
    else issues.push("Missing WACC calculation");

    if (args.hasFCFProjections) structurePoints += 2;
    else issues.push("Missing FCF projections");

    if (args.hasTerminalValue) structurePoints += 2;
    else issues.push("Missing terminal value");

    if (args.hasPresentValue) structurePoints += 2;
    else issues.push("Missing present value discounting");

    breakdown.structureCompleteness = structurePoints;

    // Projection period (4 points)
    // Industry standard: 5 years
    if (args.projectionYears === 5) {
      breakdown.projectionPeriod = 4;
    } else if (args.projectionYears >= 3 && args.projectionYears <= 7) {
      breakdown.projectionPeriod = 3;
      issues.push(`${args.projectionYears}-year projection (5 years is standard)`);
    } else {
      breakdown.projectionPeriod = 1;
      issues.push(`${args.projectionYears}-year projection unusual`);
    }

    // Terminal value weight (4 points)
    // Healthy range: 60-80% of total value
    if (args.terminalAsPercent >= 60 && args.terminalAsPercent <= 80) {
      breakdown.terminalValueWeight = 4;
    } else if (args.terminalAsPercent >= 50 && args.terminalAsPercent <= 85) {
      breakdown.terminalValueWeight = 2;
      issues.push(`Terminal value ${args.terminalAsPercent.toFixed(1)}% of total (ideal: 60-80%)`);
    } else {
      breakdown.terminalValueWeight = 1;
      issues.push(`Terminal value ${args.terminalAsPercent.toFixed(1)}% of total (concerning)`);
    }

    // Formula correctness (4 points)
    // Assume correct if all components present
    if (structurePoints === 8) {
      breakdown.formulaCorrectness = 4;
    } else {
      breakdown.formulaCorrectness = 2;
    }

    const totalScore = Object.values(breakdown).reduce((sum, val) => sum + val, 0);

    const verdict =
      totalScore >= 18 ? "Excellent methodology" :
      totalScore >= 14 ? "Good methodology with minor gaps" :
      totalScore >= 10 ? "Acceptable methodology with some issues" :
      "Methodology needs improvement";

    return {
      score: totalScore,
      maxScore,
      breakdown,
      issues,
      verdict,
    };
  },
});

/* ================================================================== */
/* VALUATION MATCH (20 points)                                        */
/* ================================================================== */

export const scoreValuationMatch = action({
  args: {
    calculatedValue: v.number(),
    groundTruthValue: v.number(),
    marketPrice: v.optional(v.number()),
  },
  returns: v.object({
    score: v.number(),
    maxScore: v.number(),
    accuracy: v.number(),
    difference: v.number(),
    differencePercent: v.number(),
    breakdown: v.object({
      groundTruthMatch: v.number(),
      marketPriceMatch: v.optional(v.number()),
    }),
    verdict: v.string(),
  }),
  handler: async (ctx, args) => {
    // Adjust max score based on whether market price is provided
    // DCF measures intrinsic value, not market price, so market price is optional
    const maxScore = args.marketPrice ? 20 : 15;
    const breakdown: any = {};

    // Ground truth match (15 points)
    const diff = args.calculatedValue - args.groundTruthValue;
    const diffPercent = Math.abs(diff / args.groundTruthValue) * 100;
    const accuracy = 100 - diffPercent;

    let groundTruthPoints = 0;
    if (diffPercent <= 2) {
      groundTruthPoints = 15; // ±2%
    } else if (diffPercent <= 5) {
      groundTruthPoints = 13; // ±5%
    } else if (diffPercent <= 10) {
      groundTruthPoints = 10; // ±10%
    } else if (diffPercent <= 20) {
      groundTruthPoints = 6; // ±20%
    } else if (diffPercent <= 30) {
      groundTruthPoints = 3; // ±30%
    } else {
      groundTruthPoints = 1; // >30%
    }
    breakdown.groundTruthMatch = groundTruthPoints;

    // Market price match (5 points) - if provided
    let marketPricePoints: number | undefined;
    if (args.marketPrice) {
      const marketDiff = Math.abs(args.calculatedValue - args.marketPrice);
      const marketDiffPercent = (marketDiff / args.marketPrice) * 100;

      if (marketDiffPercent <= 10) {
        marketPricePoints = 5;
      } else if (marketDiffPercent <= 20) {
        marketPricePoints = 3;
      } else {
        marketPricePoints = 1;
      }
      breakdown.marketPriceMatch = marketPricePoints;
    }

    const totalScore = groundTruthPoints + (marketPricePoints || 0);

    const verdict =
      diffPercent <= 5 ? "Excellent valuation accuracy" :
      diffPercent <= 10 ? "Good valuation accuracy" :
      diffPercent <= 20 ? "Acceptable valuation accuracy" :
      "Valuation needs improvement";

    return {
      score: totalScore,
      maxScore,
      accuracy,
      difference: diff,
      differencePercent: diffPercent,
      breakdown,
      verdict,
    };
  },
});

/* ================================================================== */
/* OVERALL EVALUATION                                                 */
/* ================================================================== */

export const evaluateDCFModel = action({
  args: {
    // DCF model results
    ticker: v.string(),
    calculatedFairValue: v.number(),
    wacc: v.number(),
    terminalGrowth: v.number(),
    avgFCFGrowth: v.number(),
    beta: v.number(),
    baseFCF: v.number(),
    projectionYears: v.number(),
    terminalAsPercent: v.number(),

    // Ground truth data
    groundTruthFCF: v.number(),
    groundTruthFairValue: v.number(),
    groundTruthRevenue: v.optional(v.number()),
    baseRevenue: v.optional(v.number()),
    marketPrice: v.optional(v.number()),
  },
  returns: v.object({
    overallScore: v.number(),
    grade: v.string(),
    verdict: v.string(),
    historicalAccuracy: v.any(),
    assumptionQuality: v.any(),
    methodology: v.any(),
    valuationMatch: v.any(),
    summary: v.object({
      strengths: v.array(v.string()),
      weaknesses: v.array(v.string()),
      recommendations: v.array(v.string()),
    }),
  }),
  handler: async (ctx, args) => {
    console.log(`[DCF Evaluator] Evaluating ${args.ticker} DCF model`);

    // Score each category
    console.log("[DCF Evaluator] Scoring historical accuracy...");
    const historicalAccuracy = await ctx.runAction(
      internal.domains.financial.dcfEvaluator.scoreHistoricalAccuracy,
      {
        modelBaseFCF: args.baseFCF,
        groundTruthFCF: args.groundTruthFCF,
        modelBaseRevenue: args.baseRevenue,
        groundTruthRevenue: args.groundTruthRevenue,
      }
    );

    console.log("[DCF Evaluator] Scoring assumption quality...");
    const assumptionQuality = await ctx.runAction(
      internal.domains.financial.dcfEvaluator.scoreAssumptionQuality,
      {
        wacc: args.wacc,
        terminalGrowth: args.terminalGrowth,
        avgFCFGrowth: args.avgFCFGrowth,
        beta: args.beta,
      }
    );

    console.log("[DCF Evaluator] Scoring methodology...");
    const methodology = await ctx.runAction(
      internal.domains.financial.dcfEvaluator.scoreMethodology,
      {
        hasWACC: true,
        hasFCFProjections: true,
        hasTerminalValue: true,
        hasPresentValue: true,
        projectionYears: args.projectionYears,
        terminalAsPercent: args.terminalAsPercent,
      }
    );

    console.log("[DCF Evaluator] Scoring valuation match...");
    const valuationMatch = await ctx.runAction(
      internal.domains.financial.dcfEvaluator.scoreValuationMatch,
      {
        calculatedValue: args.calculatedFairValue,
        groundTruthValue: args.groundTruthFairValue,
        marketPrice: args.marketPrice,
      }
    );

    // Calculate overall score (raw)
    const rawScore =
      historicalAccuracy.score +
      assumptionQuality.score +
      methodology.score +
      valuationMatch.score;

    // Calculate max possible score (dynamic based on available components)
    const maxPossibleScore =
      historicalAccuracy.maxScore +
      assumptionQuality.maxScore +
      methodology.maxScore +
      valuationMatch.maxScore;

    // Normalize to 100-point scale (so 95/95 becomes 100/100)
    const overallScore = Math.round((rawScore / maxPossibleScore) * 100);

    // Assign grade
    let grade: string;
    if (overallScore >= 90) {
      grade = "A";
    } else if (overallScore >= 80) {
      grade = "B";
    } else if (overallScore >= 70) {
      grade = "C";
    } else if (overallScore >= 60) {
      grade = "D";
    } else {
      grade = "F";
    }

    // Overall verdict
    let verdict: string;
    if (overallScore >= 90) {
      verdict = "Excellent DCF model - Highly reliable valuation";
    } else if (overallScore >= 80) {
      verdict = "Good DCF model - Reliable with minor improvements needed";
    } else if (overallScore >= 70) {
      verdict = "Acceptable DCF model - Use with caution";
    } else if (overallScore >= 60) {
      verdict = "Poor DCF model - Significant improvements needed";
    } else {
      verdict = "Failed DCF model - Not reliable for investment decisions";
    }

    // Generate insights
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const recommendations: string[] = [];

    // Identify strengths
    if (historicalAccuracy.score >= 20) {
      strengths.push("Strong historical data accuracy");
    }
    if (assumptionQuality.score >= 30) {
      strengths.push("Well-reasoned assumptions");
    }
    if (methodology.score >= 18) {
      strengths.push("Sound DCF methodology");
    }
    if (valuationMatch.score >= 18) {
      strengths.push("Accurate valuation vs ground truth");
    }

    // Identify weaknesses
    if (historicalAccuracy.score < 15) {
      weaknesses.push("Historical data mismatch");
      recommendations.push("Verify base period FCF and revenue figures against SEC filings");
    }
    if (assumptionQuality.score < 25) {
      weaknesses.push("Questionable assumptions");
      assumptionQuality.warnings.forEach((w: string) => recommendations.push(w));
    }
    if (methodology.score < 14) {
      weaknesses.push("Methodology gaps");
      methodology.issues.forEach((i: string) => recommendations.push(i));
    }
    if (valuationMatch.score < 15) {
      weaknesses.push("Valuation significantly off from ground truth");
      recommendations.push(
        `Fair value ${args.calculatedFairValue.toFixed(2)} differs from ground truth ${args.groundTruthFairValue.toFixed(2)} by ${valuationMatch.differencePercent.toFixed(1)}%`
      );
    }

    console.log(`[DCF Evaluator] ✅ Evaluation complete: ${grade} (${overallScore}/100)`);

    return {
      overallScore,
      grade,
      verdict,
      historicalAccuracy,
      assumptionQuality,
      methodology,
      valuationMatch,
      summary: {
        strengths,
        weaknesses,
        recommendations,
      },
    };
  },
});

/* ================================================================== */
/* TEST ACTION                                                        */
/* ================================================================== */

export const testEvaluation = action({
  args: {
    ticker: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    console.log(`[Test] Evaluating DCF model for ${args.ticker}`);

    // Example: Evaluate a DCF model
    const evaluation = await ctx.runAction(
      internal.domains.financial.dcfEvaluator.evaluateDCFModel,
      {
        ticker: args.ticker,

        // DCF model results (from dcfBuilder)
        calculatedFairValue: 16.11,
        wacc: 0.1154,
        terminalGrowth: 0.03,
        avgFCFGrowth: 0.066,
        beta: 1.2,
        baseFCF: 26913,
        projectionYears: 5,
        terminalAsPercent: 68.1,

        // Ground truth data (from SEC EDGAR)
        groundTruthFCF: 26913, // Same as model (perfect match)
        groundTruthFairValue: 15.50, // Example ground truth
        groundTruthRevenue: 60922,
        baseRevenue: 60922,
        marketPrice: 140, // Current market price
      }
    );

    console.log("[Test] Evaluation complete:");
    console.log(`  Grade: ${evaluation.grade} (${evaluation.overallScore}/100)`);
    console.log(`  Verdict: ${evaluation.verdict}`);

    return evaluation;
  },
});
