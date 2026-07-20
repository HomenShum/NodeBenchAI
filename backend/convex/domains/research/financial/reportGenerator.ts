/**
 * Report Generator
 *
 * Generates comprehensive DCF evaluation reports in multiple formats:
 * - Markdown (with tables, charts, methodology)
 * - JSON (machine-readable)
 * - Executive summary
 */

import { action } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { v } from "convex/values";
import { formatSensitivityTable } from "./sensitivityAnalysis";

/**
 * Generate comprehensive markdown report
 */
export const generateMarkdownReport = action({
  args: {
    state: v.any(), // DCFSessionState
    sensitivity: v.optional(v.any()),
    scenarios: v.optional(v.any()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { state, sensitivity, scenarios } = args;
    const calc = state.calculations;
    const eval_ = state.evaluation;

    let report = "";

    // ========================================
    // TITLE & METADATA
    // ========================================
    report += `# DCF Valuation Report: ${state.ticker}\n\n`;
    report += `**Generated:** ${new Date(state.updatedAt).toISOString()}\n`;
    report += `**Scenario:** ${state.scenario.toUpperCase()}\n`;
    report += `**Evaluation Grade:** ${eval_?.grade || 'N/A'} (${eval_?.overallScore || 0}/100)\n\n`;
    report += `---\n\n`;

    // ========================================
    // EXECUTIVE SUMMARY
    // ========================================
    report += `## Executive Summary\n\n`;

    const fairValue = calc?.fairValuePerShare || 0;
    const currentPrice = state.marketData?.currentPrice || 0;
    const upside = currentPrice > 0 ? ((fairValue - currentPrice) / currentPrice) * 100 : 0;
    const recommendation = upside > 20 ? "STRONG BUY" :
                          upside > 10 ? "BUY" :
                          upside > -10 ? "HOLD" :
                          upside > -20 ? "SELL" : "STRONG SELL";

    report += `**Fair Value:** $${fairValue.toFixed(2)} per share\n`;
    report += `**Current Price:** $${currentPrice.toFixed(2)} per share\n`;
    report += `**Implied ${upside >= 0 ? 'Upside' : 'Downside'}:** ${Math.abs(upside).toFixed(1)}%\n`;
    report += `**Recommendation:** ${recommendation}\n`;
    report += `**Confidence:** ${eval_?.grade || 'N/A'}\n\n`;

    if (eval_) {
      report += `### Key Takeaways\n\n`;

      if (eval_.assumptionQuality?.verdict) {
        report += `- ${eval_.assumptionQuality.verdict}\n`;
      }
      if (eval_.methodology?.verdict) {
        report += `- ${eval_.methodology.verdict}\n`;
      }
      if (eval_.valuationMatch?.verdict) {
        report += `- ${eval_.valuationMatch.verdict}\n`;
      }
    }

    report += `\n---\n\n`;

    // ========================================
    // METHODOLOGY
    // ========================================
    report += `## Methodology\n\n`;
    report += `This valuation uses a Discounted Cash Flow (DCF) model based on:\n\n`;
    report += `1. **Free Cash Flow Projections**: 5-year forward-looking estimates\n`;
    report += `2. **Terminal Value**: Perpetuity growth model\n`;
    report += `3. **Discount Rate**: Weighted Average Cost of Capital (WACC)\n`;
    report += `4. **Equity Value**: Enterprise Value less net debt\n\n`;

    report += `### Key Assumptions\n\n`;
    report += `| Parameter | Value | Source |\n`;
    report += `|-----------|-------|--------|\n`;
    report += `| WACC | ${((calc?.wacc || 0) * 100).toFixed(2)}% | CAPM calculation |\n`;
    report += `| Terminal Growth | ${((state.userAssumptions?.terminalGrowth || 0.03) * 100).toFixed(1)}% | Long-term GDP forecast |\n`;
    report += `| Risk-Free Rate | ${((state.marketData?.riskFreeRate || 0.042) * 100).toFixed(2)}% | 10-year Treasury |\n`;
    report += `| Beta | ${(state.marketData?.beta || 1.0).toFixed(2)} | 5-year historical |\n`;
    report += `| Market Risk Premium | ${((state.marketData?.marketRiskPremium || 0.075) * 100).toFixed(1)}% | Historical average |\n\n`;

    report += `### Data Sources\n\n`;
    report += `- Financial Data: ${state.financialData?.source || 'N/A'}\n`;
    report += `- Market Data: Alpha Vantage\n`;
    report += `- Ground Truth: ${state.groundTruth?.source || 'N/A'}\n\n`;

    report += `---\n\n`;

    // ========================================
    // FINANCIAL ANALYSIS
    // ========================================
    report += `## Financial Analysis\n\n`;

    if (state.financialData) {
      report += `### Historical Performance (FY${state.financialData.fiscalYear || 'N/A'})\n\n`;
      report += `| Metric | Value |\n`;
      report += `|--------|-------|\n`;
      report += `| Revenue | $${((state.financialData.revenue || 0) / 1000).toFixed(1)}B |\n`;
      report += `| Net Income | $${((state.financialData.netIncome || 0) / 1000).toFixed(1)}B |\n`;
      report += `| Free Cash Flow | $${((state.financialData.freeCashFlow || 0) / 1000).toFixed(1)}B |\n`;
      report += `| Gross Margin | ${((state.financialData.grossMargin || 0) * 100).toFixed(1)}% |\n`;
      report += `| Operating Margin | ${((state.financialData.operatingMargin || 0) * 100).toFixed(1)}% |\n\n`;
    }

    if (calc?.fcfProjections) {
      report += `### Projected Free Cash Flow\n\n`;
      report += `| Year | FCF (millions) | YoY Growth |\n`;
      report += `|------|----------------|------------|\n`;

      calc.fcfProjections.forEach((proj: any) => {
        report += `| ${proj.year} | $${proj.fcf.toFixed(0)}M | ${(proj.growthRate * 100).toFixed(1)}% |\n`;
      });

      report += `\n`;

      const avgGrowth = calc.fcfProjections.reduce((sum: number, p: any) => sum + p.growthRate, 0) / calc.fcfProjections.length;
      report += `📈 **Average Growth:** ${(avgGrowth * 100).toFixed(1)}% per year\n\n`;
    }

    report += `**Terminal Value:** $${((calc?.terminalValue || 0) / 1000).toFixed(1)}B\n`;
    report += `**Terminal as % of EV:** ${(calc?.terminalAsPercent || 0).toFixed(1)}%\n\n`;

    report += `---\n\n`;

    // ========================================
    // VALUATION SUMMARY
    // ========================================
    report += `## Valuation Summary\n\n`;
    report += `| Component | Value |\n`;
    report += `|-----------|-------|\n`;
    report += `| PV of Projected FCF (5y) | $${((calc?.enterpriseValue || 0) * (1 - (calc?.terminalAsPercent || 0) / 100) / 1000).toFixed(1)}B |\n`;
    report += `| PV of Terminal Value | $${((calc?.enterpriseValue || 0) * (calc?.terminalAsPercent || 0) / 100 / 1000).toFixed(1)}B |\n`;
    report += `| **Enterprise Value** | **$${((calc?.enterpriseValue || 0) / 1000).toFixed(1)}B** |\n`;
    report += `| Less: Net Debt | $${0}B |\n`;
    report += `| **Equity Value** | **$${((calc?.equityValue || 0) / 1000).toFixed(1)}B** |\n`;
    report += `| Shares Outstanding | ${0}M |\n`;
    report += `| **Fair Value Per Share** | **$${(calc?.fairValuePerShare || 0).toFixed(2)}** |\n\n`;

    report += `---\n\n`;

    // ========================================
    // EVALUATION
    // ========================================
    if (eval_) {
      report += `## Evaluation vs Ground Truth\n\n`;
      report += `**Overall Score:** ${eval_.overallScore}/100 (Grade ${eval_.grade})\n`;
      report += `**Verdict:** ${eval_.verdict}\n\n`;

      report += `### Scoring Breakdown\n\n`;
      report += `| Category | Score | Max | Percentage |\n`;
      report += `|----------|-------|-----|------------|\n`;
      report += `| Historical Accuracy | ${eval_.historicalAccuracy?.score || 0} | ${eval_.historicalAccuracy?.maxScore || 25} | ${(((eval_.historicalAccuracy?.score || 0) / (eval_.historicalAccuracy?.maxScore || 25)) * 100).toFixed(0)}% |\n`;
      report += `| Assumption Quality | ${eval_.assumptionQuality?.score || 0} | ${eval_.assumptionQuality?.maxScore || 35} | ${(((eval_.assumptionQuality?.score || 0) / (eval_.assumptionQuality?.maxScore || 35)) * 100).toFixed(0)}% |\n`;
      report += `| Methodology | ${eval_.methodology?.score || 0} | ${eval_.methodology?.maxScore || 20} | ${(((eval_.methodology?.score || 0) / (eval_.methodology?.maxScore || 20)) * 100).toFixed(0)}% |\n`;
      report += `| Valuation Match | ${eval_.valuationMatch?.score || 0} | ${eval_.valuationMatch?.maxScore || 20} | ${(((eval_.valuationMatch?.score || 0) / (eval_.valuationMatch?.maxScore || 20)) * 100).toFixed(0)}% |\n\n`;

      if (eval_.assumptionQuality?.warnings?.length > 0) {
        report += `### Warnings\n\n`;
        eval_.assumptionQuality.warnings.forEach((warning: string) => {
          report += `- ⚠️ ${warning}\n`;
        });
        report += `\n`;
      }
    }

    report += `---\n\n`;

    // ========================================
    // SENSITIVITY ANALYSIS
    // ========================================
    if (sensitivity) {
      report += `## Sensitivity Analysis\n\n`;
      report += formatSensitivityTable(
        sensitivity.waccRange,
        sensitivity.terminalGrowthRange,
        sensitivity.matrix,
        sensitivity.baseCase.wacc,
        sensitivity.baseCase.terminalGrowth
      );
      report += `\n`;
    }

    // ========================================
    // SCENARIO ANALYSIS
    // ========================================
    if (scenarios) {
      report += `### Scenario Analysis\n\n`;
      report += `| Scenario | Fair Value | WACC | Terminal Growth | Implied Return |\n`;
      report += `|----------|------------|------|-----------------|----------------|\n`;
      report += `| **Bull Case** | $${scenarios.bull.fairValue.toFixed(2)} | ${(scenarios.bull.wacc * 100).toFixed(2)}% | ${(scenarios.bull.terminalGrowth * 100).toFixed(1)}% | +${scenarios.impliedUpside.bull.toFixed(1)}% |\n`;
      report += `| **Base Case** | $${scenarios.base.fairValue.toFixed(2)} | ${(scenarios.base.wacc * 100).toFixed(2)}% | ${(scenarios.base.terminalGrowth * 100).toFixed(1)}% | Benchmark |\n`;
      report += `| **Bear Case** | $${scenarios.bear.fairValue.toFixed(2)} | ${(scenarios.bear.wacc * 100).toFixed(2)}% | ${(scenarios.bear.terminalGrowth * 100).toFixed(1)}% | ${scenarios.impliedUpside.bear.toFixed(1)}% |\n\n`;
    }

    report += `---\n\n`;

    // ========================================
    // ERRORS & WARNINGS
    // ========================================
    if (state.errors && state.errors.length > 0) {
      report += `## Errors & Recoveries\n\n`;
      state.errors.forEach((error: any) => {
        report += `- **${error.step}**: ${error.error}\n`;
        if (error.recoveredVia) {
          report += `  - ✅ Recovered via: ${error.recoveredVia}\n`;
        }
      });
      report += `\n---\n\n`;
    }

    // ========================================
    // FOOTER
    // ========================================
    report += `## Appendix\n\n`;
    report += `### Model Assumptions\n\n`;
    report += `**FCF Growth Rates (5-year):**\n`;
    if (state.userAssumptions?.revenueGrowth) {
      state.userAssumptions.revenueGrowth.forEach((rate: number, i: number) => {
        report += `- Year ${i + 1}: ${(rate * 100).toFixed(1)}%\n`;
      });
    }
    report += `\n`;

    report += `**Terminal Growth:** ${((state.userAssumptions?.terminalGrowth || 0.03) * 100).toFixed(1)}%\n\n`;

    report += `---\n\n`;
    report += `*This report was generated by NodeBench DCF Evaluation Agent using data from SEC EDGAR, Alpha Vantage, and internal databases.*\n`;
    report += `*For questions or corrections, please review the evaluation details above.*\n`;

    return report;
  },
});

/**
 * Generate JSON export
 */
export const generateJSONReport = action({
  args: {
    state: v.any(),
    sensitivity: v.optional(v.any()),
    scenarios: v.optional(v.any()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return {
      metadata: {
        ticker: args.state.ticker,
        generatedAt: new Date(args.state.updatedAt).toISOString(),
        scenario: args.state.scenario,
        evaluationGrade: args.state.evaluation?.grade,
        evaluationScore: args.state.evaluation?.overallScore,
      },
      valuation: {
        fairValuePerShare: args.state.calculations?.fairValuePerShare,
        enterpriseValue: args.state.calculations?.enterpriseValue,
        equityValue: args.state.calculations?.equityValue,
        wacc: args.state.calculations?.wacc,
        terminalValue: args.state.calculations?.terminalValue,
        terminalAsPercent: args.state.calculations?.terminalAsPercent,
      },
      assumptions: args.state.userAssumptions,
      financialData: args.state.financialData,
      marketData: args.state.marketData,
      evaluation: args.state.evaluation,
      sensitivity: args.sensitivity,
      scenarios: args.scenarios,
      errors: args.state.errors,
    };
  },
});

/**
 * Test report generator
 */
export const testReportGenerator = action({
  args: {
    state: v.any(),
  },
  handler: async (ctx, args) => {
    console.log("\n[Test] Generating comprehensive report...");

    const markdown = await ctx.runAction(
      internal.domains.financial.reportGenerator.generateMarkdownReport,
      { state: args.state }
    );

    console.log("\n✅ MARKDOWN REPORT GENERATED\n");
    console.log(markdown);

    return { markdown };
  },
});
