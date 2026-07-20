/**
 * Sensitivity Analysis
 *
 * Generates WACC × Terminal Growth sensitivity matrices
 * and scenario analysis (bull/base/bear)
 */

import { action } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { v } from "convex/values";

/**
 * Generate WACC × Terminal Growth sensitivity matrix
 */
export const generateSensitivityMatrix = action({
  args: {
    baseFCF: v.number(),
    fcfGrowthRates: v.array(v.number()),
    sharesOutstanding: v.number(),
    netDebt: v.number(),

    // Sensitivity ranges
    waccRange: v.optional(v.array(v.number())),
    terminalGrowthRange: v.optional(v.array(v.number())),
  },
  returns: v.object({
    waccRange: v.array(v.number()),
    terminalGrowthRange: v.array(v.number()),
    matrix: v.array(v.array(v.number())), // Fair value per share matrix
    baseCase: v.object({
      wacc: v.number(),
      terminalGrowth: v.number(),
      fairValue: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    // Default ranges if not provided
    const waccRange = args.waccRange || [0.08, 0.09, 0.10, 0.11, 0.12];
    const terminalGrowthRange = args.terminalGrowthRange || [0.02, 0.025, 0.03, 0.035, 0.04];

    console.log("[Sensitivity] Generating matrix...");
    console.log(`WACC range: ${waccRange.map(w => (w*100).toFixed(1) + '%').join(', ')}`);
    console.log(`Terminal growth range: ${terminalGrowthRange.map(g => (g*100).toFixed(1) + '%').join(', ')}`);

    const matrix: number[][] = [];

    // Calculate fair value for each combination
    for (const wacc of waccRange) {
      const row: number[] = [];

      for (const terminalGrowth of terminalGrowthRange) {
        try {
          // Project FCF
          let currentFCF = args.baseFCF;
          const cashFlows: number[] = [];

          for (const growthRate of args.fcfGrowthRates) {
            currentFCF = currentFCF * (1 + growthRate);
            cashFlows.push(currentFCF);
          }

          // Terminal value
          const finalFCF = cashFlows[cashFlows.length - 1];
          const terminalValue = (finalFCF * (1 + terminalGrowth)) / (wacc - terminalGrowth);

          // Discount to present
          let pvProjections = 0;
          for (let i = 0; i < cashFlows.length; i++) {
            const pv = cashFlows[i] / Math.pow(1 + wacc, i + 1);
            pvProjections += pv;
          }

          const pvTerminal = terminalValue / Math.pow(1 + wacc, cashFlows.length);
          const enterpriseValue = pvProjections + pvTerminal;

          // Convert to equity value
          const equityValue = enterpriseValue - args.netDebt;
          const fairValuePerShare = equityValue / args.sharesOutstanding;

          row.push(fairValuePerShare);
        } catch (error) {
          // If calculation fails (e.g., terminalGrowth >= wacc), use 0
          row.push(0);
        }
      }

      matrix.push(row);
    }

    // Identify base case (middle of ranges)
    const baseCaseWaccIdx = Math.floor(waccRange.length / 2);
    const baseCaseTerminalIdx = Math.floor(terminalGrowthRange.length / 2);

    console.log("[Sensitivity] Matrix generated");
    console.log(`Base case: WACC=${(waccRange[baseCaseWaccIdx]*100).toFixed(1)}%, Terminal=${(terminalGrowthRange[baseCaseTerminalIdx]*100).toFixed(1)}%`);

    return {
      waccRange,
      terminalGrowthRange,
      matrix,
      baseCase: {
        wacc: waccRange[baseCaseWaccIdx],
        terminalGrowth: terminalGrowthRange[baseCaseTerminalIdx],
        fairValue: matrix[baseCaseWaccIdx][baseCaseTerminalIdx],
      },
    };
  },
});

/**
 * Generate scenario analysis (bull/base/bear)
 */
export const generateScenarioAnalysis = action({
  args: {
    ticker: v.string(),
    baseFCF: v.number(),
    sharesOutstanding: v.number(),
    netDebt: v.number(),
    riskFreeRate: v.number(),
    beta: v.number(),
    marketRiskPremium: v.number(),
  },
  returns: v.object({
    bull: v.object({
      fairValue: v.number(),
      wacc: v.number(),
      terminalGrowth: v.number(),
      fcfGrowth: v.array(v.number()),
    }),
    base: v.object({
      fairValue: v.number(),
      wacc: v.number(),
      terminalGrowth: v.number(),
      fcfGrowth: v.array(v.number()),
    }),
    bear: v.object({
      fairValue: v.number(),
      wacc: v.number(),
      terminalGrowth: v.number(),
      fcfGrowth: v.array(v.number()),
    }),
    impliedUpside: v.object({
      bull: v.number(),
      bear: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    console.log("[Scenario Analysis] Running bull/base/bear scenarios...");

    const scenarios = {
      bull: {
        fcfGrowth: [0.15, 0.12, 0.10, 0.08, 0.06],
        terminalGrowth: 0.035,
      },
      base: {
        fcfGrowth: [0.10, 0.08, 0.06, 0.05, 0.04],
        terminalGrowth: 0.03,
      },
      bear: {
        fcfGrowth: [0.05, 0.04, 0.03, 0.02, 0.02],
        terminalGrowth: 0.02,
      },
    };

    const results: any = {};

    for (const [scenarioName, assumptions] of Object.entries(scenarios)) {
      const dcfResult = await ctx.runAction(
        internal.domains.financial.dcfBuilder.buildCompleteDCF,
        {
          ticker: args.ticker,
          scenario: scenarioName as "bull" | "base" | "bear",
          baseFCF: args.baseFCF,
          sharesOutstanding: args.sharesOutstanding,
          totalDebt: args.netDebt > 0 ? args.netDebt : 0,
          cash: args.netDebt < 0 ? Math.abs(args.netDebt) : 0,
          riskFreeRate: args.riskFreeRate,
          beta: args.beta,
          marketRiskPremium: args.marketRiskPremium,
          fcfGrowthRates: assumptions.fcfGrowth,
          terminalGrowth: assumptions.terminalGrowth,
        }
      );

      results[scenarioName] = {
        fairValue: dcfResult.fairValuePerShare,
        wacc: dcfResult.wacc.wacc,
        terminalGrowth: assumptions.terminalGrowth,
        fcfGrowth: assumptions.fcfGrowth,
      };
    }

    // Calculate implied upside/downside
    const impliedUpside = {
      bull: ((results.bull.fairValue - results.base.fairValue) / results.base.fairValue) * 100,
      bear: ((results.bear.fairValue - results.base.fairValue) / results.base.fairValue) * 100,
    };

    console.log("[Scenario Analysis] Complete");
    console.log(`Bull: $${results.bull.fairValue.toFixed(2)} (+${impliedUpside.bull.toFixed(1)}%)`);
    console.log(`Base: $${results.base.fairValue.toFixed(2)}`);
    console.log(`Bear: $${results.bear.fairValue.toFixed(2)} (${impliedUpside.bear.toFixed(1)}%)`);

    return {
      bull: results.bull,
      base: results.base,
      bear: results.bear,
      impliedUpside,
    };
  },
});

/**
 * Format sensitivity matrix as markdown table
 */
export function formatSensitivityTable(
  waccRange: number[],
  terminalGrowthRange: number[],
  matrix: number[][],
  baseCaseWacc: number,
  baseCaseTerminal: number
): string {
  let table = "\n### WACC × Terminal Growth Sensitivity\n\n";

  // Header row
  table += "|  WACC  |";
  for (const tg of terminalGrowthRange) {
    table += ` ${(tg * 100).toFixed(1)}% |`;
  }
  table += "\n";

  // Separator
  table += "|--------|";
  for (let i = 0; i < terminalGrowthRange.length; i++) {
    table += "--------|";
  }
  table += "\n";

  // Data rows
  for (let i = 0; i < waccRange.length; i++) {
    const wacc = waccRange[i];
    table += `| **${(wacc * 100).toFixed(1)}%** |`;

    for (let j = 0; j < terminalGrowthRange.length; j++) {
      const value = matrix[i][j];
      const isBaseCase = wacc === baseCaseWacc && terminalGrowthRange[j] === baseCaseTerminal;

      if (value === 0) {
        table += " N/A |";
      } else {
        const formatted = `$${value.toFixed(2)}`;
        table += isBaseCase ? ` **${formatted}** |` : ` ${formatted} |`;
      }
    }

    table += "\n";
  }

  return table;
}

/**
 * Test sensitivity analysis
 */
export const testSensitivityAnalysis = action({
  args: {
    ticker: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ticker = args.ticker || "NVDA";

    console.log(`\n[Test] Running sensitivity analysis for ${ticker}...`);

    // Example inputs
    const inputs = {
      baseFCF: 26913,
      fcfGrowthRates: [0.10, 0.08, 0.06, 0.05, 0.04],
      sharesOutstanding: 24500,
      netDebt: -23800, // Net cash position
    };

    const sensitivity = await ctx.runAction(
      internal.domains.financial.sensitivityAnalysis.generateSensitivityMatrix,
      inputs
    );

    console.log("\n✅ Sensitivity Matrix Generated");
    console.log(formatSensitivityTable(
      sensitivity.waccRange,
      sensitivity.terminalGrowthRange,
      sensitivity.matrix,
      sensitivity.baseCase.wacc,
      sensitivity.baseCase.terminalGrowth
    ));

    console.log(`\nBase Case Fair Value: $${sensitivity.baseCase.fairValue.toFixed(2)}`);

    return sensitivity;
  },
});
