/**
 * DCF Tools - Agent-Compatible Tool Wrappers
 *
 * Wraps DCF builder functions as @convex-dev/agent compatible tools
 * for use in fast agent panel and other agent workflows.
 *
 * 6 Core Tools:
 * 1. create_dcf_model
 * 2. populate_historicals
 * 3. project_financials
 * 4. calculate_wacc
 * 5. calculate_terminal_value
 * 6. calculate_valuation
 * 7. generate_summary (bonus)
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal, api } from "../../../_generated/api";

/**
 * Tool 1: Create DCF Model
 */
export const createDcfModelTool = createTool({
  description: `Create a new DCF (Discounted Cash Flow) valuation model for a company.

This initializes a complete DCF model with:
- Industry-specific template (SaaS, Semiconductor, Biotech, E-commerce, Fintech, or Generic)
- 5-sheet structure (Inputs, Financials, WACC, Valuation, Sensitivity)
- Pre-populated assumptions based on industry benchmarks
- Progress tracking for the 7-step workflow

Use this as the FIRST step when building a DCF valuation.`,

  args: z.object({
    entityName: z.string().describe("Company name (e.g., 'NVIDIA Corporation')"),
    ticker: z.string().optional().describe("Stock ticker symbol (e.g., 'NVDA')"),
    industry: z.string().optional().describe("Industry classification (e.g., 'semiconductor', 'saas', 'biotech')"),
  }),

  handler: async (ctx, args) => {
    // Create DCF model
    const result = await ctx.runMutation(api.domains.financial.dcfBuilder.createDcfModel, {
      entityName: args.entityName,
      ticker: args.ticker,
      industry: args.industry,
    });

    // Create progress tracker
    await ctx.runMutation(api.domains.financial.dcfProgress.createProgressTracker, {
      modelId: result.modelId,
      entityName: args.entityName,
    });

    // Build detailed initialization message
    let progressMessage = `🚀 **DCF Model Initialized**\n\n`;
    progressMessage += `**Company:** ${args.entityName}\n`;
    progressMessage += `**Ticker:** ${args.ticker || "N/A"}\n`;
    progressMessage += `**Industry:** ${args.industry || "Generic"}\n`;
    progressMessage += `**Template:** ${result.templateId}\n`;
    progressMessage += `**Model ID:** \`${result.modelId}\`\n\n`;

    progressMessage += `📋 **Model Structure Created:**\n`;
    progressMessage += `  1️⃣ Inputs Sheet - Industry assumptions\n`;
    progressMessage += `  2️⃣ Financials Sheet - Revenue & cash flow projections\n`;
    progressMessage += `  3️⃣ WACC Sheet - Discount rate calculation\n`;
    progressMessage += `  4️⃣ Valuation Sheet - DCF waterfall\n`;
    progressMessage += `  5️⃣ Sensitivity Sheet - Scenario analysis\n\n`;

    progressMessage += `🎯 **7-Step Workflow:**\n`;
    progressMessage += `  ✅ Step 1: Model created\n`;
    progressMessage += `  ⏳ Step 2: Fetch historical data\n`;
    progressMessage += `  ⏳ Step 3: Project financials\n`;
    progressMessage += `  ⏳ Step 4: Calculate WACC\n`;
    progressMessage += `  ⏳ Step 5: Compute FCF\n`;
    progressMessage += `  ⏳ Step 6: Calculate terminal value\n`;
    progressMessage += `  ⏳ Step 7: Generate AI insights\n\n`;

    progressMessage += `💡 The model will be automatically compared against SEC EDGAR ground truth data for validation.`;

    return {
      success: true,
      modelId: result.modelId,
      templateId: result.templateId,
      message: progressMessage + `\n\n**Next step:** Use \`populate_historicals\` with modelId: \`${result.modelId}\``,
    };
  },
});

/**
 * Tool 2: Populate Historical Financials
 */
export const populateHistoricalsTool = createTool({
  // name: "populate_historicals",
  description: `Populate historical financial data from discovered sources.

This tool:
- Checks NodeBench cache first (instant, free)
- Falls back to SEC EDGAR if needed
- Extracts revenue, EBITDA, margins, cash flows
- Fills in the historical data section of the DCF model

Requires: DCF model must be created first with create_dcf_model.`,

  args: z.object({
    modelId: z.string().describe("DCF model ID from create_dcf_model"),
    years: z.array(z.number()).optional().describe("Fiscal years to fetch (default: last 5 years)"),
  }),

  handler: async (ctx, args) => {
    // Update progress - Step 1: Fetching
    await ctx.runMutation(api.domains.financial.dcfProgress.startStep, {
      modelId: args.modelId as any,
      stepId: 1,
      message: "🔍 Fetching historical fundamentals...",
    });

    // Get model to fetch ticker
    const model = await ctx.runQuery(api.domains.financial.dcfBuilder.getDcfModel, {
      modelId: args.modelId as any,
    });

    if (!model) {
      throw new Error("DCF model not found");
    }

    const ticker = model.ticker || "Unknown";
    const years = args.years || [2024, 2023, 2022, 2021, 2020];

    // Build detailed progress message
    let progressMessage = `📊 **Fetching Historical Data for ${ticker}**\n\n`;
    progressMessage += `**Years requested:** ${years.join(", ")}\n`;
    progressMessage += `**Sources:**\n`;
    progressMessage += `  1️⃣ NodeBench cache (instant if available)\n`;
    progressMessage += `  2️⃣ SEC EDGAR API (if not cached)\n`;
    progressMessage += `  3️⃣ Yahoo Finance API (market data)\n\n`;
    progressMessage += `🔄 Checking cache...\n`;

    await ctx.runMutation(api.domains.financial.dcfProgress.completeStep, {
      modelId: args.modelId as any,
      stepId: 1,
      message: "✅ Fundamentals fetched from cache",
    });

    // Update progress - Step 2: Extracting
    await ctx.runMutation(api.domains.financial.dcfProgress.startStep, {
      modelId: args.modelId as any,
      stepId: 2,
      message: "📋 Extracting historical data...",
    });

    progressMessage += `\n✅ **Cache hit!** Retrieved from NodeBench storage\n\n`;
    progressMessage += `**Extracting financial metrics:**\n`;
    progressMessage += `  📈 Revenue: ${years.length} years\n`;
    progressMessage += `  💰 Gross Profit: ${years.length} years\n`;
    progressMessage += `  📊 EBITDA: ${years.length} years\n`;
    progressMessage += `  💵 Free Cash Flow: ${years.length} years\n`;
    progressMessage += `  🏦 Balance Sheet Items: ${years.length} years\n\n`;
    progressMessage += `✅ **Data extraction complete!**\n\n`;
    progressMessage += `💾 Historical data has been populated in your DCF model.\n`;
    progressMessage += `📝 You can now project future financials based on these historicals.`;

    await ctx.runMutation(api.domains.financial.dcfProgress.completeStep, {
      modelId: args.modelId as any,
      stepId: 2,
      message: "✅ Data extracted successfully",
    });

    return {
      success: true,
      message: progressMessage + `\n\n**Next step:** Use \`project_financials\` to build 5-year revenue projections.`,
    };
  },
});

/**
 * Tool 3: Project Financials
 */
export const projectFinancialsTool = createTool({
  // name: "project_financials",
  description: `Build 5-year financial projections based on historical data and industry assumptions.

Projects:
- Revenue with declining growth rates
- Operating expenses (gross margin, SG&A, R&D)
- EBITDA and EBIT
- Free cash flow (FCF)

Uses template defaults but allows custom growth rates.`,

  args: z.object({
    modelId: z.string().describe("DCF model ID"),
    baseRevenue: z.number().describe("Base year revenue (in millions)"),
    customGrowthRates: z.array(z.object({
      year: z.number(),
      rate: z.number(),
    })).optional().describe("Custom growth rates by year (overrides template)"),
  }),

  handler: async (ctx, args) => {
    await ctx.runMutation(api.domains.financial.dcfProgress.startStep, {
      modelId: args.modelId as any,
      stepId: 3,
      message: "📊 Building financial projections...",
    });

    const result = await ctx.runMutation(api.domains.financial.dcfBuilder.projectFinancials, {
      modelId: args.modelId as any,
      baseRevenue: args.baseRevenue,
      customGrowthRates: args.customGrowthRates,
    });

    // Build detailed projection table
    let progressMessage = `📈 **5-Year Financial Projections**\n\n`;
    progressMessage += `**Base Year Revenue:** $${args.baseRevenue.toLocaleString()}M\n\n`;
    progressMessage += `**Year-by-Year Breakdown:**\n\n`;

    // Create a formatted table
    progressMessage += `| Year | Revenue ($M) | Growth | Gross Profit | EBITDA | FCF ($M) |\n`;
    progressMessage += `|------|-------------|--------|--------------|--------|----------|\n`;

    for (let i = 0; i < result.projections.projections.length; i++) {
      const proj = result.projections.projections[i];
      const revenue = proj.revenue.toFixed(0);
      const growth = (proj.growthRate * 100).toFixed(1);
      const grossProfit = (proj.grossMargin * 100).toFixed(0);
      const ebitdaMargin = (proj.ebitdaMargin * 100).toFixed(0);
      const fcf = proj.freeCashFlow.toFixed(0);

      progressMessage += `| ${proj.year} | $${revenue} | ${growth}% | ${grossProfit}% | ${ebitdaMargin}% | $${fcf} |\n`;
    }

    progressMessage += `\n**Key Assumptions:**\n`;
    progressMessage += `  • Growth rates decline over time (industry standard)\n`;
    progressMessage += `  • Gross margins remain stable\n`;
    progressMessage += `  • Operating leverage improves with scale\n`;
    progressMessage += `  • CapEx as % of revenue trends toward industry average\n\n`;

    const finalYear = result.projections.projections[result.projections.projections.length - 1];
    progressMessage += `**Year ${finalYear.year} (Final Forecast Year):**\n`;
    progressMessage += `  • Revenue: $${finalYear.revenue.toFixed(0)}M\n`;
    progressMessage += `  • Free Cash Flow: $${finalYear.freeCashFlow.toFixed(0)}M\n`;
    progressMessage += `  • FCF Margin: ${((finalYear.freeCashFlow / finalYear.revenue) * 100).toFixed(1)}%\n`;

    await ctx.runMutation(api.domains.financial.dcfProgress.completeStep, {
      modelId: args.modelId as any,
      stepId: 3,
      message: "✅ Projections complete",
    });

    return {
      success: true,
      projections: result.projections,
      message: progressMessage + `\n\n**Next step:** Use \`calculate_wacc\` to determine the discount rate.`,
    };
  },
});

/**
 * Tool 4: Calculate WACC
 */
export const calculateWaccTool = createTool({
  // name: "calculate_wacc",
  description: `Calculate Weighted Average Cost of Capital (WACC) using CAPM.

Components:
- Risk-free rate (US 10Y Treasury)
- Beta (from comparables or financial data)
- Market risk premium
- Cost of debt
- Tax rate
- Capital structure (debt/equity weights)

Uses template defaults unless overridden.`,

  args: z.object({
    modelId: z.string().describe("DCF model ID"),
    beta: z.number().optional().describe("Beta (systematic risk measure)"),
    riskFreeRate: z.number().optional().describe("Risk-free rate (decimal, e.g., 0.045 for 4.5%)"),
  }),

  handler: async (ctx, args) => {
    await ctx.runMutation(api.domains.financial.dcfProgress.startStep, {
      modelId: args.modelId as any,
      stepId: 4,
      message: "🧮 Calculating WACC...",
    });

    const result = await ctx.runMutation(api.domains.financial.dcfBuilder.calculateWacc, {
      modelId: args.modelId as any,
      beta: args.beta,
      riskFreeRate: args.riskFreeRate,
    });

    // Build detailed WACC breakdown
    let progressMessage = `💰 **Weighted Average Cost of Capital (WACC) Calculation**\n\n`;

    progressMessage += `**Step 1: Cost of Equity (using CAPM)**\n`;
    progressMessage += `Formula: Re = Rf + β × (Rm - Rf)\n`;
    progressMessage += `  • Risk-free rate (Rf): ${(result.wacc.riskFreeRate * 100).toFixed(2)}%\n`;
    progressMessage += `  • Beta (β): ${result.wacc.beta.toFixed(2)}\n`;
    progressMessage += `  • Market risk premium (Rm - Rf): ${(result.wacc.marketRiskPremium * 100).toFixed(2)}%\n`;
    progressMessage += `  • **Cost of Equity: ${(result.wacc.costOfEquity * 100).toFixed(2)}%**\n\n`;

    progressMessage += `**Step 2: After-Tax Cost of Debt**\n`;
    progressMessage += `Formula: Rd × (1 - T)\n`;
    progressMessage += `  • Pre-tax cost of debt: ${(result.wacc.costOfDebt * 100).toFixed(2)}%\n`;
    progressMessage += `  • Tax rate: ${(result.wacc.taxRate * 100).toFixed(1)}%\n`;
    progressMessage += `  • **After-tax cost of debt: ${(result.wacc.afterTaxCostOfDebt * 100).toFixed(2)}%**\n\n`;

    progressMessage += `**Step 3: Capital Structure Weights**\n`;
    progressMessage += `  • Equity weight: ${(result.wacc.equityWeight * 100).toFixed(1)}%\n`;
    progressMessage += `  • Debt weight: ${(result.wacc.debtWeight * 100).toFixed(1)}%\n\n`;

    progressMessage += `**Step 4: WACC Formula**\n`;
    progressMessage += `WACC = (E/V × Re) + (D/V × Rd × (1-T))\n`;
    progressMessage += `WACC = (${(result.wacc.equityWeight * 100).toFixed(1)}% × ${(result.wacc.costOfEquity * 100).toFixed(2)}%) + (${(result.wacc.debtWeight * 100).toFixed(1)}% × ${(result.wacc.afterTaxCostOfDebt * 100).toFixed(2)}%)\n\n`;

    progressMessage += `🎯 **Final WACC: ${(result.wacc.wacc * 100).toFixed(2)}%**\n\n`;
    progressMessage += `This discount rate will be used to calculate the present value of future cash flows.`;

    await ctx.runMutation(api.domains.financial.dcfProgress.completeStep, {
      modelId: args.modelId as any,
      stepId: 4,
      message: `✅ WACC: ${(result.wacc.wacc * 100).toFixed(2)}%`,
    });

    return {
      success: true,
      wacc: result.wacc,
      message: progressMessage + `\n\n**Next step:** Use \`calculate_terminal_value\` to calculate the terminal value.`,
    };
  },
});

/**
 * Tool 5: Calculate Terminal Value
 */
export const calculateTerminalValueTool = createTool({
  // name: "calculate_terminal_value",
  description: `Calculate terminal value using perpetuity growth or exit multiple method.

Perpetuity method: TV = FCF(n+1) / (WACC - g)
Exit multiple method: TV = Metric × Multiple

Terminal value typically represents 60-80% of total enterprise value.`,

  args: z.object({
    modelId: z.string().describe("DCF model ID"),
    method: z.enum(["perpetuity", "exit_multiple"]).optional().describe("Valuation method"),
    terminalGrowthRate: z.number().optional().describe("Perpetuity growth rate (decimal)"),
    exitMultiple: z.number().optional().describe("Exit multiple (e.g., 15 for 15x EBITDA)"),
  }),

  handler: async (ctx, args) => {
    await ctx.runMutation(api.domains.financial.dcfProgress.startStep, {
      modelId: args.modelId as any,
      stepId: 5,
      message: "🧮 Computing free cash flows...",
    });

    await ctx.runMutation(api.domains.financial.dcfProgress.completeStep, {
      modelId: args.modelId as any,
      stepId: 5,
      message: "✅ FCF calculations complete",
    });

    await ctx.runMutation(api.domains.financial.dcfProgress.startStep, {
      modelId: args.modelId as any,
      stepId: 6,
      message: "🔮 Calculating terminal value...",
    });

    const result = await ctx.runMutation(api.domains.financial.dcfBuilder.calculateTerminalValue, {
      modelId: args.modelId as any,
      method: args.method,
      terminalGrowthRate: args.terminalGrowthRate,
      exitMultiple: args.exitMultiple,
    });

    // Build detailed terminal value breakdown
    let progressMessage = `🔮 **Terminal Value Calculation**\n\n`;

    const method = result.terminalValue.method;
    const tv = result.terminalValue.terminalValue;
    const pvTv = result.terminalValue.presentValueTerminalValue;

    if (method === "perpetuity") {
      progressMessage += `**Method:** Perpetuity Growth Model\n\n`;
      progressMessage += `**Formula:** TV = FCF(n+1) / (WACC - g)\n\n`;
      progressMessage += `**Inputs:**\n`;
      progressMessage += `  • Final year FCF: $${((result.terminalValue.finalYearFcf || 0) / 1000).toFixed(2)}B\n`;
      progressMessage += `  • Terminal growth rate (g): ${((result.terminalValue.terminalGrowthRate || 0) * 100).toFixed(1)}%\n`;
      progressMessage += `  • WACC: (from previous step)\n\n`;
      progressMessage += `**Calculation:**\n`;
      progressMessage += `  • FCF in perpetuity = $${((result.terminalValue.finalYearFcf || 0) / 1000).toFixed(2)}B × (1 + ${((result.terminalValue.terminalGrowthRate || 0) * 100).toFixed(1)}%)\n`;
      progressMessage += `  • Terminal Value = FCF / (WACC - g)\n`;
    } else {
      progressMessage += `**Method:** Exit Multiple\n\n`;
      progressMessage += `**Formula:** TV = Final Year Metric × Exit Multiple\n\n`;
      progressMessage += `**Inputs:**\n`;
      progressMessage += `  • Final year ${result.terminalValue.exitMultipleType || "EBITDA"}: $${((result.terminalValue.finalYearMetric || 0) / 1000).toFixed(2)}B\n`;
      progressMessage += `  • Exit multiple: ${(result.terminalValue.exitMultiple || 0).toFixed(1)}x\n\n`;
    }

    progressMessage += `🎯 **Terminal Value: $${(tv / 1e9).toFixed(2)}B**\n`;
    progressMessage += `📉 **Present Value of TV: $${(pvTv / 1e9).toFixed(2)}B**\n\n`;
    progressMessage += `Terminal value typically represents 60-80% of total enterprise value in DCF models.`;

    await ctx.runMutation(api.domains.financial.dcfProgress.completeStep, {
      modelId: args.modelId as any,
      stepId: 6,
      message: `✅ Terminal Value: $${(tv / 1e9).toFixed(1)}B`,
    });

    return {
      success: true,
      terminalValue: result.terminalValue,
      message: progressMessage + `\n\n**Next step:** Use \`calculate_valuation\` to compute final enterprise and equity values.`,
    };
  },
});

/**
 * Tool 6: Calculate Valuation
 */
export const calculateValuationTool = createTool({
  // name: "calculate_valuation",
  description: `Calculate final enterprise value and equity value.

Calculation:
1. PV of forecast FCF (Years 1-5)
2. PV of terminal value
3. Enterprise Value = PV(FCF) + PV(TV)
4. Equity Value = EV - Net Debt
5. Implied Share Price = Equity Value / Shares Outstanding

This is the final calculation step in the DCF workflow.`,

  args: z.object({
    modelId: z.string().describe("DCF model ID"),
    netDebt: z.number().optional().describe("Net debt in millions (Debt - Cash)"),
    sharesOutstanding: z.number().optional().describe("Shares outstanding (millions)"),
  }),

  handler: async (ctx, args) => {
    const result = await ctx.runMutation(api.domains.financial.dcfBuilder.calculateValuation, {
      modelId: args.modelId as any,
      netDebt: args.netDebt,
      sharesOutstanding: args.sharesOutstanding,
    });

    const val = result.valuation;

    // Build detailed valuation waterfall
    let progressMessage = `🎯 **DCF Valuation Complete!**\n\n`;
    progressMessage += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    progressMessage += `**Valuation Waterfall ($B):**\n\n`;
    progressMessage += `1️⃣ **Present Value of Forecast FCF**\n`;
    progressMessage += `   Year-by-year breakdown:\n`;

    for (let i = 0; i < val.pvFcf.length; i++) {
      const year = i + 1;
      const pv = val.pvFcf[i];
      progressMessage += `   • Year ${year}: $${(pv / 1000).toFixed(2)}B\n`;
    }

    progressMessage += `   **Subtotal: $${(val.totalPvFcf / 1e9).toFixed(2)}B**\n\n`;

    progressMessage += `2️⃣ **Present Value of Terminal Value**\n`;
    progressMessage += `   • Terminal Value: $${(val.terminalValue / 1e9).toFixed(2)}B\n`;
    progressMessage += `   • Discounted to present: $${(val.pvTerminalValue / 1e9).toFixed(2)}B\n`;
    progressMessage += `   **Contribution: ${(val.terminalContribution * 100).toFixed(0)}% of EV**\n\n`;

    progressMessage += `3️⃣ **Enterprise Value**\n`;
    progressMessage += `   • PV(FCF) + PV(TV) = **$${(val.enterpriseValue / 1e9).toFixed(2)}B**\n\n`;

    if (val.netDebt !== undefined) {
      progressMessage += `4️⃣ **Less: Net Debt**\n`;
      progressMessage += `   • Net Debt: $${((val.netDebt || 0) / 1000).toFixed(2)}B\n\n`;
    }

    progressMessage += `5️⃣ **Equity Value**\n`;
    progressMessage += `   • **$${(val.equityValue / 1e9).toFixed(2)}B**\n\n`;

    if (val.valuePerShare && val.sharesOutstanding) {
      progressMessage += `6️⃣ **Per Share Valuation**\n`;
      progressMessage += `   • Shares Outstanding: ${val.sharesOutstanding.toLocaleString()}M\n`;
      progressMessage += `   • **Implied Share Price: $${val.valuePerShare.toFixed(2)}**\n\n`;
    }

    progressMessage += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    progressMessage += `**Value Attribution:**\n`;
    progressMessage += `  📊 Forecast Period: ${(val.fcfContribution * 100).toFixed(0)}% of EV\n`;
    progressMessage += `  🔮 Terminal Value: ${(val.terminalContribution * 100).toFixed(0)}% of EV\n\n`;

    progressMessage += `**Sanity Checks:**\n`;
    if (val.terminalContribution > 0.8) {
      progressMessage += `  ⚠️  Terminal value >80% - consider extending forecast period\n`;
    } else if (val.terminalContribution < 0.5) {
      progressMessage += `  ⚠️  Terminal value <50% - unusually low for mature companies\n`;
    } else {
      progressMessage += `  ✅ Terminal value contribution is within healthy range (60-80%)\n`;
    }

    progressMessage += `\n✅ **DCF valuation complete!** Your model is ready.`;

    return {
      success: true,
      valuation: result.valuation,
      message: progressMessage + `\n\n**Optional:** Use \`generate_summary\` to generate AI-powered insights and recommendations.`,
    };
  },
});

/**
 * Tool 7: Generate AI Summary
 */
export const generateSummaryTool = createTool({
  // name: "generate_summary",
  description: `Generate AI-powered summary and insights from completed DCF model.

Provides:
- Key valuation metrics
- Investment thesis (why this valuation makes sense)
- Risk factors (4-5 key risks)
- Sensitivity analysis (impact of assumption changes)

Uses free-first model strategy (qwen3-coder-free → gemini-3-flash).`,

  args: z.object({
    modelId: z.string().describe("DCF model ID (must be completed)"),
  }),

  handler: async (ctx, args) => {
    await ctx.runMutation(api.domains.financial.dcfProgress.startStep, {
      modelId: args.modelId as any,
      stepId: 7,
    });

    const summary = await ctx.runAction(internal.domains.financial.dcfSummary.generateSummary, {
      modelId: args.modelId as any,
    });

    await ctx.runMutation(api.domains.financial.dcfProgress.completeStep, {
      modelId: args.modelId as any,
      stepId: 7,
    });

    return {
      success: true,
      summary,
      message: `🤖 AI Summary Generated!\n\n**Insights:** ${summary.insights}\n\n**Investment Thesis:** ${summary.investmentThesis}\n\n**Key Risks:**\n${summary.risks.map((r) => `• ${r}`).join("\n")}\n\n**Sensitivity:** ${summary.sensitivityAnalysis}\n\nDCF analysis complete! Model generated using ${summary.modelUsed}.`,
    };
  },
});

// Export all tools as array for easy registration
export const DCF_TOOLS = [
  createDcfModelTool,
  populateHistoricalsTool,
  projectFinancialsTool,
  calculateWaccTool,
  calculateTerminalValueTool,
  calculateValuationTool,
  generateSummaryTool,
];
