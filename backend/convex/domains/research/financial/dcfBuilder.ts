/**
 * DCF Builder - Core Valuation Calculation Engine
 *
 * Implements industry-standard DCF calculations:
 * - WACC (Weighted Average Cost of Capital) via CAPM
 * - Free Cash Flow projections (5-year)
 * - Terminal Value (perpetuity growth model)
 * - Present Value discounting
 * - Enterprise → Equity value conversion
 *
 * Design: Fine-grained tools (composable, testable, transparent)
 *
 * Based on best practices from:
 * - Damodaran's corporate finance methodology
 * - McKinsey valuation framework
 * - CFA Institute standards
 */

import { v } from "convex/values";
import { action, internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";

/* ================================================================== */
/* INPUT VALIDATION                                                   */
/* ================================================================== */

function validateWACCInputs(params: {
  riskFreeRate: number;
  beta: number;
  marketRiskPremium: number;
  debtRatio: number;
  taxRate: number;
}) {
  const errors: string[] = [];

  if (params.riskFreeRate < 0 || params.riskFreeRate > 0.20) {
    errors.push(`Risk-free rate ${params.riskFreeRate} invalid (expected 0-20%)`);
  }

  if (params.beta < 0 || params.beta > 3) {
    errors.push(`Beta ${params.beta} unusual (expected 0-3 for most companies)`);
  }

  if (params.marketRiskPremium < 0.04 || params.marketRiskPremium > 0.12) {
    errors.push(`Market risk premium ${params.marketRiskPremium} unusual (expected 4-12%)`);
  }

  if (params.debtRatio < 0 || params.debtRatio > 1) {
    errors.push(`Debt ratio ${params.debtRatio} invalid (expected 0-100%)`);
  }

  if (params.taxRate < 0 || params.taxRate > 0.5) {
    errors.push(`Tax rate ${params.taxRate} invalid (expected 0-50%)`);
  }

  return errors;
}

function validateFCFProjection(params: {
  baseFCF: number;
  growthRates: number[];
}) {
  const errors: string[] = [];

  if (params.baseFCF <= 0) {
    errors.push(`Base FCF ${params.baseFCF} must be positive`);
  }

  if (params.growthRates.length !== 5) {
    errors.push(`Expected 5 growth rates, got ${params.growthRates.length}`);
  }

  params.growthRates.forEach((rate, i) => {
    if (rate < -0.5 || rate > 1.0) {
      errors.push(`Growth rate year ${i + 1}: ${rate} unusual (expected -50% to 100%)`);
    }
  });

  return errors;
}

function validateTerminalValue(params: {
  terminalGrowth: number;
  wacc: number;
}) {
  const errors: string[] = [];

  if (params.terminalGrowth >= params.wacc) {
    errors.push(
      `Terminal growth (${params.terminalGrowth}) must be < WACC (${params.wacc})`
    );
  }

  if (params.terminalGrowth < 0 || params.terminalGrowth > 0.05) {
    errors.push(
      `Terminal growth ${params.terminalGrowth} unusual (expected 0-5%, typically 2-3%)`
    );
  }

  return errors;
}

/* ================================================================== */
/* WACC CALCULATION (CAPM)                                            */
/* ================================================================== */

export const calculateWACC = action({
  args: {
    riskFreeRate: v.number(),
    beta: v.number(),
    marketRiskPremium: v.number(),
    debtRatio: v.number(),
    taxRate: v.number(),
  },
  returns: v.object({
    wacc: v.number(),
    costOfEquity: v.number(),
    costOfDebt: v.number(),
    equityWeight: v.number(),
    debtWeight: v.number(),
    formula: v.string(),
    warnings: v.optional(v.array(v.string())),
  }),
  handler: async (ctx, args) => {
    // Validate inputs
    const errors = validateWACCInputs(args);
    if (errors.length > 0) {
      throw new Error(`Invalid WACC inputs:\n${errors.join('\n')}`);
    }

    // Cost of Equity: Re = Rf + β(Rm - Rf)
    const costOfEquity = args.riskFreeRate + (args.beta * args.marketRiskPremium);

    // Cost of Debt: Rd ≈ Rf + credit spread (simplified: Rf + 2%)
    const costOfDebt = args.riskFreeRate + 0.02;

    // Equity and debt weights
    const equityWeight = 1 - args.debtRatio;
    const debtWeight = args.debtRatio;

    // WACC = (E/V × Re) + (D/V × Rd × (1-T))
    const wacc = (costOfEquity * equityWeight) + (costOfDebt * debtWeight * (1 - args.taxRate));

    // Warnings for unusual values
    const warnings: string[] = [];
    if (wacc < 0.05) {
      warnings.push(`WACC ${(wacc * 100).toFixed(1)}% unusually low`);
    }
    if (wacc > 0.20) {
      warnings.push(`WACC ${(wacc * 100).toFixed(1)}% unusually high`);
    }
    if (args.beta > 2) {
      warnings.push(`Beta ${args.beta.toFixed(2)} indicates high volatility`);
    }

    return {
      wacc,
      costOfEquity,
      costOfDebt,
      equityWeight,
      debtWeight,
      formula: "WACC = (E/V × Re) + (D/V × Rd × (1-T))",
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
});

/* ================================================================== */
/* FREE CASH FLOW PROJECTION                                          */
/* ================================================================== */

export const projectFreeCashFlow = action({
  args: {
    baseFCF: v.number(),
    growthRates: v.array(v.number()),
    marginImprovements: v.optional(v.array(v.number())),
  },
  returns: v.object({
    projections: v.array(v.object({
      year: v.number(),
      fcf: v.number(),
      growthRate: v.number(),
      marginImprovement: v.optional(v.number()),
    })),
    finalFCF: v.number(),
    avgGrowth: v.number(),
    totalFCF: v.number(),
  }),
  handler: async (ctx, args) => {
    // Validate inputs
    const errors = validateFCFProjection(args);
    if (errors.length > 0) {
      throw new Error(`Invalid FCF projection inputs:\n${errors.join('\n')}`);
    }

    const projections: Array<{
      year: number;
      fcf: number;
      growthRate: number;
      marginImprovement?: number;
    }> = [];
    let currentFCF = args.baseFCF;
    let totalFCF = 0;
    const currentYear = new Date().getFullYear();

    for (let i = 0; i < args.growthRates.length; i++) {
      // Apply growth rate
      currentFCF = currentFCF * (1 + args.growthRates[i]);

      // Apply margin improvement if provided
      if (args.marginImprovements && args.marginImprovements[i]) {
        currentFCF *= (1 + args.marginImprovements[i]);
      }

      projections.push({
        year: currentYear + i + 1,
        fcf: currentFCF,
        growthRate: args.growthRates[i],
        marginImprovement: args.marginImprovements?.[i],
      });

      totalFCF += currentFCF;
    }

    // Calculate average growth rate
    const avgGrowth = args.growthRates.reduce((sum, rate) => sum + rate, 0) / args.growthRates.length;

    return {
      projections,
      finalFCF: currentFCF,
      avgGrowth,
      totalFCF,
    };
  },
});

/* ================================================================== */
/* TERMINAL VALUE CALCULATION                                         */
/* ================================================================== */

export const calculateTerminalValue = action({
  args: {
    finalFCF: v.number(),
    terminalGrowth: v.number(),
    wacc: v.number(),
  },
  returns: v.object({
    terminalValue: v.number(),
    perpetuityFCF: v.number(),
    formula: v.string(),
    impliedMultiple: v.number(),
    assumptions: v.object({
      perpetuityGrowth: v.number(),
      impliesForeverGrowth: v.boolean(),
    }),
    warnings: v.optional(v.array(v.string())),
  }),
  handler: async (ctx, args) => {
    // Validate inputs
    const errors = validateTerminalValue(args);
    if (errors.length > 0) {
      throw new Error(`Invalid terminal value inputs:\n${errors.join('\n')}`);
    }

    // Perpetuity formula: TV = FCF₅ × (1+g) / (WACC - g)
    const perpetuityFCF = args.finalFCF * (1 + args.terminalGrowth);
    const terminalValue = perpetuityFCF / (args.wacc - args.terminalGrowth);

    // Implied exit multiple (TV / Final FCF)
    const impliedMultiple = terminalValue / args.finalFCF;

    // Warnings
    const warnings: string[] = [];
    if (impliedMultiple > 20) {
      warnings.push(`Implied multiple ${impliedMultiple.toFixed(1)}x seems high (terminal value may be overstated)`);
    }
    if (impliedMultiple < 5) {
      warnings.push(`Implied multiple ${impliedMultiple.toFixed(1)}x seems low (terminal value may be understated)`);
    }

    return {
      terminalValue,
      perpetuityFCF,
      formula: "TV = FCF₅ × (1+g) / (WACC - g)",
      impliedMultiple,
      assumptions: {
        perpetuityGrowth: args.terminalGrowth,
        impliesForeverGrowth: true,
      },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
});

/* ================================================================== */
/* PRESENT VALUE DISCOUNTING                                          */
/* ================================================================== */

export const discountToPresent = action({
  args: {
    cashFlows: v.array(v.number()),
    terminalValue: v.number(),
    wacc: v.number(),
  },
  returns: v.object({
    enterpriseValue: v.number(),
    pvOfProjections: v.number(),
    pvOfTerminal: v.number(),
    breakdown: v.array(v.object({
      year: v.number(),
      cashFlow: v.number(),
      discountFactor: v.number(),
      presentValue: v.number(),
    })),
    terminalAsPercent: v.number(),
  }),
  handler: async (ctx, args) => {
    let pvOfProjections = 0;
    const breakdown: Array<{
      year: number;
      cashFlow: number;
      discountFactor: number;
      presentValue: number;
    }> = [];

    // Discount each projected cash flow
    for (let i = 0; i < args.cashFlows.length; i++) {
      const year = i + 1;
      const discountFactor = 1 / Math.pow(1 + args.wacc, year);
      const presentValue = args.cashFlows[i] * discountFactor;

      pvOfProjections += presentValue;

      breakdown.push({
        year,
        cashFlow: args.cashFlows[i],
        discountFactor,
        presentValue,
      });
    }

    // Discount terminal value
    const terminalDiscountFactor = 1 / Math.pow(1 + args.wacc, args.cashFlows.length);
    const pvOfTerminal = args.terminalValue * terminalDiscountFactor;

    // Total enterprise value
    const enterpriseValue = pvOfProjections + pvOfTerminal;

    // Terminal value as % of total (sanity check)
    const terminalAsPercent = (pvOfTerminal / enterpriseValue) * 100;

    return {
      enterpriseValue,
      pvOfProjections,
      pvOfTerminal,
      breakdown,
      terminalAsPercent,
    };
  },
});

/* ================================================================== */
/* ENTERPRISE TO EQUITY VALUE CONVERSION                              */
/* ================================================================== */

export const convertToEquityValue = action({
  args: {
    enterpriseValue: v.number(),
    totalDebt: v.number(),
    cash: v.number(),
    minorityInterest: v.optional(v.number()),
    sharesOutstanding: v.number(),
  },
  returns: v.object({
    equityValue: v.number(),
    fairValuePerShare: v.number(),
    netDebt: v.number(),
    breakdown: v.object({
      enterpriseValue: v.number(),
      lessDebt: v.number(),
      plusCash: v.number(),
      lessMinorityInterest: v.number(),
      equityValue: v.number(),
      sharesOutstanding: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    // Net debt = Total debt - Cash
    const netDebt = args.totalDebt - args.cash;

    // Equity value = EV - Net debt - Minority interest
    const minorityInterest = args.minorityInterest || 0;
    const equityValue = args.enterpriseValue - netDebt - minorityInterest;

    // Fair value per share
    const fairValuePerShare = equityValue / args.sharesOutstanding;

    return {
      equityValue,
      fairValuePerShare,
      netDebt,
      breakdown: {
        enterpriseValue: args.enterpriseValue,
        lessDebt: -args.totalDebt,
        plusCash: args.cash,
        lessMinorityInterest: -minorityInterest,
        equityValue,
        sharesOutstanding: args.sharesOutstanding,
      },
    };
  },
});

/* ================================================================== */
/* COMPLETE DCF WORKFLOW (COMPOSITE)                                  */
/* ================================================================== */

export const buildCompleteDCF = action({
  args: {
    ticker: v.string(),
    scenario: v.union(v.literal("base"), v.literal("bull"), v.literal("bear")),

    // Financial inputs (from ground truth or user)
    baseFCF: v.number(),
    sharesOutstanding: v.number(),
    totalDebt: v.number(),
    cash: v.number(),

    // Assumptions (with scenario defaults)
    riskFreeRate: v.optional(v.number()),
    beta: v.optional(v.number()),
    marketRiskPremium: v.optional(v.number()),
    debtRatio: v.optional(v.number()),
    taxRate: v.optional(v.number()),
    fcfGrowthRates: v.optional(v.array(v.number())),
    terminalGrowth: v.optional(v.number()),
  },
  returns: v.object({
    ticker: v.string(),
    scenario: v.string(),
    wacc: v.any(),
    fcfProjections: v.any(),
    terminalValue: v.any(),
    presentValue: v.any(),
    equityValue: v.any(),
    fairValuePerShare: v.number(),
    summary: v.object({
      enterpriseValue: v.number(),
      equityValue: v.number(),
      fairValuePerShare: v.number(),
      impliedUpside: v.optional(v.number()),
    }),
  }),
  handler: async (ctx, args) => {
    console.log(`[DCF Builder] Building ${args.scenario} case DCF for ${args.ticker}`);

    // Apply scenario-based defaults
    const assumptions = applyScenarioDefaults(args.scenario, {
      riskFreeRate: args.riskFreeRate,
      beta: args.beta,
      marketRiskPremium: args.marketRiskPremium,
      debtRatio: args.debtRatio,
      taxRate: args.taxRate,
      fcfGrowthRates: args.fcfGrowthRates,
      terminalGrowth: args.terminalGrowth,
    });

    // Step 1: Calculate WACC
    console.log("[DCF Builder] Step 1/5: Calculating WACC...");
    const wacc = await ctx.runAction(internal.domains.financial.dcfBuilder.calculateWACC, {
      riskFreeRate: assumptions.riskFreeRate,
      beta: assumptions.beta,
      marketRiskPremium: assumptions.marketRiskPremium,
      debtRatio: assumptions.debtRatio,
      taxRate: assumptions.taxRate,
    });
    console.log(`[DCF Builder] WACC: ${(wacc.wacc * 100).toFixed(2)}%`);

    // Step 2: Project FCF
    console.log("[DCF Builder] Step 2/5: Projecting free cash flows...");
    const fcfProjections = await ctx.runAction(
      internal.domains.financial.dcfBuilder.projectFreeCashFlow,
      {
        baseFCF: args.baseFCF,
        growthRates: assumptions.fcfGrowthRates,
      }
    );
    console.log(`[DCF Builder] Final FCF (Year 5): $${fcfProjections.finalFCF.toFixed(0)}M`);

    // Step 3: Calculate terminal value
    console.log("[DCF Builder] Step 3/5: Calculating terminal value...");
    const terminalValue = await ctx.runAction(
      internal.domains.financial.dcfBuilder.calculateTerminalValue,
      {
        finalFCF: fcfProjections.finalFCF,
        terminalGrowth: assumptions.terminalGrowth,
        wacc: wacc.wacc,
      }
    );
    console.log(`[DCF Builder] Terminal Value: $${terminalValue.terminalValue.toFixed(0)}M`);

    // Step 4: Discount to present
    console.log("[DCF Builder] Step 4/5: Discounting to present value...");
    const cashFlows = fcfProjections.projections.map((p: any) => p.fcf);
    const presentValue = await ctx.runAction(
      internal.domains.financial.dcfBuilder.discountToPresent,
      {
        cashFlows,
        terminalValue: terminalValue.terminalValue,
        wacc: wacc.wacc,
      }
    );
    console.log(`[DCF Builder] Enterprise Value: $${presentValue.enterpriseValue.toFixed(0)}M`);

    // Step 5: Convert to equity value
    console.log("[DCF Builder] Step 5/5: Converting to equity value...");
    const equityValue = await ctx.runAction(
      internal.domains.financial.dcfBuilder.convertToEquityValue,
      {
        enterpriseValue: presentValue.enterpriseValue,
        totalDebt: args.totalDebt,
        cash: args.cash,
        sharesOutstanding: args.sharesOutstanding,
      }
    );
    console.log(`[DCF Builder] Fair Value: $${equityValue.fairValuePerShare.toFixed(2)}/share`);

    console.log(`[DCF Builder] ✅ ${args.scenario.toUpperCase()} case DCF complete`);

    return {
      ticker: args.ticker,
      scenario: args.scenario,
      wacc,
      fcfProjections,
      terminalValue,
      presentValue,
      equityValue,
      fairValuePerShare: equityValue.fairValuePerShare,
      summary: {
        enterpriseValue: presentValue.enterpriseValue,
        equityValue: equityValue.equityValue,
        fairValuePerShare: equityValue.fairValuePerShare,
      },
    };
  },
});

/* ================================================================== */
/* SCENARIO DEFAULTS                                                  */
/* ================================================================== */

function applyScenarioDefaults(
  scenario: "base" | "bull" | "bear",
  userInputs: any
): {
  riskFreeRate: number;
  beta: number;
  marketRiskPremium: number;
  debtRatio: number;
  taxRate: number;
  fcfGrowthRates: number[];
  terminalGrowth: number;
} {
  // Base case defaults (conservative)
  const baseDefaults = {
    riskFreeRate: 0.042, // 4.2% (10-year Treasury)
    beta: 1.2,
    marketRiskPremium: 0.075, // 7.5% historical average
    debtRatio: 0.20,
    taxRate: 0.21, // US federal corporate tax
    fcfGrowthRates: [0.10, 0.08, 0.06, 0.05, 0.04], // Declining growth
    terminalGrowth: 0.03, // 3% (GDP growth)
  };

  // Bull case (optimistic)
  const bullDefaults = {
    ...baseDefaults,
    fcfGrowthRates: [0.15, 0.12, 0.10, 0.08, 0.06], // Higher growth
    terminalGrowth: 0.035, // 3.5%
  };

  // Bear case (pessimistic)
  const bearDefaults = {
    ...baseDefaults,
    beta: 1.4, // Higher risk
    fcfGrowthRates: [0.05, 0.04, 0.03, 0.02, 0.02], // Lower growth
    terminalGrowth: 0.025, // 2.5%
  };

  // Select scenario defaults
  let defaults;
  if (scenario === "bull") {
    defaults = bullDefaults;
  } else if (scenario === "bear") {
    defaults = bearDefaults;
  } else {
    defaults = baseDefaults;
  }

  // Override with user inputs
  return {
    riskFreeRate: userInputs.riskFreeRate ?? defaults.riskFreeRate,
    beta: userInputs.beta ?? defaults.beta,
    marketRiskPremium: userInputs.marketRiskPremium ?? defaults.marketRiskPremium,
    debtRatio: userInputs.debtRatio ?? defaults.debtRatio,
    taxRate: userInputs.taxRate ?? defaults.taxRate,
    fcfGrowthRates: userInputs.fcfGrowthRates ?? defaults.fcfGrowthRates,
    terminalGrowth: userInputs.terminalGrowth ?? defaults.terminalGrowth,
  };
}

/* ================================================================== */
/* TEST ACTION                                                        */
/* ================================================================== */

export const testDCFCalculation = action({
  args: {
    ticker: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    console.log(`[Test] Running DCF calculation for ${args.ticker}`);

    // Use example inputs (NVIDIA-like company)
    const result = await ctx.runAction(internal.domains.financial.dcfBuilder.buildCompleteDCF, {
      ticker: args.ticker,
      scenario: "base",

      // Financial inputs (example values)
      baseFCF: 26913, // $26.9B (NVIDIA FY2024 FCF)
      sharesOutstanding: 24500, // 24.5B shares
      totalDebt: 10000, // $10B debt
      cash: 25000, // $25B cash

      // Use default assumptions for base case
    });

    console.log("[Test] DCF calculation complete:");
    console.log(JSON.stringify(result.summary, null, 2));

    return result;
  },
});
