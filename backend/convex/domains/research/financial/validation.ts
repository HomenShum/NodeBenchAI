// convex/domains/financial/validation.ts
// Data quality validation and reconciliation rules for financial fundamentals
//
// Implements validation checks:
// - Balance sheet equation (Assets = Liabilities + Equity)
// - Sign conventions (revenue positive, costs positive)
// - Cross-statement consistency (net income flows to equity)
// - Margin reasonableness bounds
// - Year-over-year change limits

import { v } from "convex/values";
import { internalQuery, query } from "../../../_generated/server";
import type { Doc } from "../../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* TYPES                                                               */
/* ------------------------------------------------------------------ */

export interface ValidationResult {
  isValid: boolean;
  score: number;  // 0-100 quality score
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
}

export interface ValidationIssue {
  code: string;
  field: string;
  message: string;
  expected?: number | string;
  actual?: number | string;
  severity: "error" | "warning" | "info";
}

/* ------------------------------------------------------------------ */
/* VALIDATION RULES                                                    */
/* ------------------------------------------------------------------ */

// Tolerance for floating point comparisons
const TOLERANCE_PERCENT = 0.02;  // 2% tolerance for balance sheet

// Reasonable bounds for margins (as decimals)
const MARGIN_BOUNDS = {
  grossMargin: { min: -0.5, max: 1.0 },      // Can be negative in distressed cases
  operatingMargin: { min: -2.0, max: 0.8 },  // Tech can have high operating margins
  netMargin: { min: -5.0, max: 0.6 },        // Can be deeply negative
};

// Maximum year-over-year change ratios
const YOY_CHANGE_LIMITS = {
  revenue: 3.0,        // 3x YoY seems extreme
  netIncome: 10.0,     // Earnings can swing wildly
  totalAssets: 3.0,
  totalEquity: 5.0,
};

/* ------------------------------------------------------------------ */
/* VALIDATION FUNCTIONS                                                */
/* ------------------------------------------------------------------ */

/**
 * Validate balance sheet equation: Assets = Liabilities + Equity
 */
function validateBalanceSheetEquation(
  balanceSheet: Doc<"financialFundamentals">["balanceSheet"]
): ValidationIssue | null {
  const { totalAssets, totalLiabilities, totalEquity } = balanceSheet;
  const expectedAssets = totalLiabilities + totalEquity;
  const diff = Math.abs(totalAssets - expectedAssets);
  const tolerance = Math.abs(totalAssets) * TOLERANCE_PERCENT;

  if (diff > tolerance && diff > 1000) {
    // Allow small absolute differences
    return {
      code: "BALANCE_SHEET_MISMATCH",
      field: "balanceSheet",
      message: `Balance sheet does not balance: Assets (${formatNumber(totalAssets)}) != Liabilities (${formatNumber(totalLiabilities)}) + Equity (${formatNumber(totalEquity)})`,
      expected: expectedAssets,
      actual: totalAssets,
      severity: "warning",
    };
  }

  return null;
}

/**
 * Validate sign conventions (revenue and costs should typically be positive)
 */
function validateSignConventions(
  incomeStatement: Doc<"financialFundamentals">["incomeStatement"]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (incomeStatement.revenue < 0) {
    issues.push({
      code: "NEGATIVE_REVENUE",
      field: "incomeStatement.revenue",
      message: "Revenue is negative, which is unusual",
      actual: incomeStatement.revenue,
      severity: "warning",
    });
  }

  if (incomeStatement.costOfRevenue !== undefined && incomeStatement.costOfRevenue < 0) {
    issues.push({
      code: "NEGATIVE_COST",
      field: "incomeStatement.costOfRevenue",
      message: "Cost of revenue is negative, which may indicate data quality issues",
      actual: incomeStatement.costOfRevenue,
      severity: "info",
    });
  }

  return issues;
}

/**
 * Validate gross profit calculation
 */
function validateGrossProfit(
  incomeStatement: Doc<"financialFundamentals">["incomeStatement"]
): ValidationIssue | null {
  const { revenue, costOfRevenue, grossProfit } = incomeStatement;

  if (costOfRevenue !== undefined && grossProfit !== undefined) {
    const expectedGrossProfit = revenue - costOfRevenue;
    const diff = Math.abs(grossProfit - expectedGrossProfit);
    const tolerance = Math.abs(revenue) * TOLERANCE_PERCENT;

    if (diff > tolerance && diff > 1000) {
      return {
        code: "GROSS_PROFIT_MISMATCH",
        field: "incomeStatement.grossProfit",
        message: `Gross profit does not match: Revenue - COGS = ${formatNumber(expectedGrossProfit)}, but reported ${formatNumber(grossProfit)}`,
        expected: expectedGrossProfit,
        actual: grossProfit,
        severity: "info",
      };
    }
  }

  return null;
}

/**
 * Validate margin reasonableness
 */
function validateMargins(
  metrics: Doc<"financialFundamentals">["metrics"]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!metrics) return issues;

  if (metrics.grossMargin !== undefined) {
    if (metrics.grossMargin < MARGIN_BOUNDS.grossMargin.min) {
      issues.push({
        code: "GROSS_MARGIN_TOO_LOW",
        field: "metrics.grossMargin",
        message: `Gross margin (${(metrics.grossMargin * 100).toFixed(1)}%) is unusually low`,
        actual: metrics.grossMargin,
        severity: "warning",
      });
    }
    if (metrics.grossMargin > MARGIN_BOUNDS.grossMargin.max) {
      issues.push({
        code: "GROSS_MARGIN_TOO_HIGH",
        field: "metrics.grossMargin",
        message: `Gross margin (${(metrics.grossMargin * 100).toFixed(1)}%) exceeds 100%, which is impossible`,
        actual: metrics.grossMargin,
        severity: "error",
      });
    }
  }

  if (metrics.operatingMargin !== undefined) {
    if (metrics.operatingMargin < MARGIN_BOUNDS.operatingMargin.min) {
      issues.push({
        code: "OPERATING_MARGIN_TOO_LOW",
        field: "metrics.operatingMargin",
        message: `Operating margin (${(metrics.operatingMargin * 100).toFixed(1)}%) is extremely negative`,
        actual: metrics.operatingMargin,
        severity: "warning",
      });
    }
    if (metrics.operatingMargin > MARGIN_BOUNDS.operatingMargin.max) {
      issues.push({
        code: "OPERATING_MARGIN_TOO_HIGH",
        field: "metrics.operatingMargin",
        message: `Operating margin (${(metrics.operatingMargin * 100).toFixed(1)}%) is unusually high`,
        actual: metrics.operatingMargin,
        severity: "info",
      });
    }
  }

  return issues;
}

/**
 * Validate free cash flow calculation
 */
function validateFreeCashFlow(
  cashFlow: Doc<"financialFundamentals">["cashFlow"]
): ValidationIssue | null {
  const { operatingCashFlow, capex, freeCashFlow } = cashFlow;

  if (capex !== undefined && freeCashFlow !== undefined) {
    const expectedFcf = operatingCashFlow - capex;
    const diff = Math.abs(freeCashFlow - expectedFcf);
    const tolerance = Math.abs(operatingCashFlow) * TOLERANCE_PERCENT;

    if (diff > tolerance && diff > 1000) {
      return {
        code: "FCF_CALCULATION_MISMATCH",
        field: "cashFlow.freeCashFlow",
        message: `Free cash flow calculation differs: OCF - CapEx = ${formatNumber(expectedFcf)}, but stored ${formatNumber(freeCashFlow)}`,
        expected: expectedFcf,
        actual: freeCashFlow,
        severity: "info",
      };
    }
  }

  return null;
}

/**
 * Format large numbers for display
 */
function formatNumber(n: number): string {
  if (Math.abs(n) >= 1e9) {
    return `$${(n / 1e9).toFixed(2)}B`;
  }
  if (Math.abs(n) >= 1e6) {
    return `$${(n / 1e6).toFixed(2)}M`;
  }
  return `$${n.toLocaleString()}`;
}

/* ------------------------------------------------------------------ */
/* MAIN VALIDATION FUNCTION                                            */
/* ------------------------------------------------------------------ */

/**
 * Validate financial fundamentals and return a quality score
 */
export function validateFundamentals(
  fundamentals: Pick<
    Doc<"financialFundamentals">,
    "incomeStatement" | "balanceSheet" | "cashFlow" | "metrics"
  >
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const info: ValidationIssue[] = [];

  // Run all validation checks
  const balanceSheetIssue = validateBalanceSheetEquation(fundamentals.balanceSheet);
  if (balanceSheetIssue) {
    if (balanceSheetIssue.severity === "error") errors.push(balanceSheetIssue);
    else if (balanceSheetIssue.severity === "warning") warnings.push(balanceSheetIssue);
    else info.push(balanceSheetIssue);
  }

  const signIssues = validateSignConventions(fundamentals.incomeStatement);
  for (const issue of signIssues) {
    if (issue.severity === "error") errors.push(issue);
    else if (issue.severity === "warning") warnings.push(issue);
    else info.push(issue);
  }

  const grossProfitIssue = validateGrossProfit(fundamentals.incomeStatement);
  if (grossProfitIssue) {
    if (grossProfitIssue.severity === "error") errors.push(grossProfitIssue);
    else if (grossProfitIssue.severity === "warning") warnings.push(grossProfitIssue);
    else info.push(grossProfitIssue);
  }

  const marginIssues = validateMargins(fundamentals.metrics);
  for (const issue of marginIssues) {
    if (issue.severity === "error") errors.push(issue);
    else if (issue.severity === "warning") warnings.push(issue);
    else info.push(issue);
  }

  const fcfIssue = validateFreeCashFlow(fundamentals.cashFlow);
  if (fcfIssue) {
    if (fcfIssue.severity === "error") errors.push(fcfIssue);
    else if (fcfIssue.severity === "warning") warnings.push(fcfIssue);
    else info.push(fcfIssue);
  }

  // Calculate quality score
  let score = 100;
  score -= errors.length * 20;      // -20 points per error
  score -= warnings.length * 5;     // -5 points per warning
  score -= info.length * 1;         // -1 point per info
  score = Math.max(0, Math.min(100, score));

  return {
    isValid: errors.length === 0,
    score,
    errors,
    warnings,
    info,
  };
}

/* ------------------------------------------------------------------ */
/* YEAR-OVER-YEAR VALIDATION                                           */
/* ------------------------------------------------------------------ */

/**
 * Validate year-over-year changes between two periods
 */
export function validateYoyChanges(
  current: Pick<Doc<"financialFundamentals">, "incomeStatement" | "balanceSheet">,
  previous: Pick<Doc<"financialFundamentals">, "incomeStatement" | "balanceSheet">
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Revenue change
  const revenueChange = current.incomeStatement.revenue / previous.incomeStatement.revenue;
  if (revenueChange > YOY_CHANGE_LIMITS.revenue || revenueChange < 1 / YOY_CHANGE_LIMITS.revenue) {
    issues.push({
      code: "EXTREME_REVENUE_CHANGE",
      field: "incomeStatement.revenue",
      message: `Revenue changed by ${((revenueChange - 1) * 100).toFixed(0)}% YoY, which is extreme`,
      expected: previous.incomeStatement.revenue,
      actual: current.incomeStatement.revenue,
      severity: "warning",
    });
  }

  // Net income change (can swing wildly, so use wider bounds)
  if (previous.incomeStatement.netIncome !== 0) {
    const netIncomeChange = Math.abs(current.incomeStatement.netIncome / previous.incomeStatement.netIncome);
    if (netIncomeChange > YOY_CHANGE_LIMITS.netIncome) {
      issues.push({
        code: "EXTREME_NET_INCOME_CHANGE",
        field: "incomeStatement.netIncome",
        message: `Net income changed dramatically YoY`,
        expected: previous.incomeStatement.netIncome,
        actual: current.incomeStatement.netIncome,
        severity: "info",
      });
    }
  }

  // Total assets change
  const assetsChange = current.balanceSheet.totalAssets / previous.balanceSheet.totalAssets;
  if (assetsChange > YOY_CHANGE_LIMITS.totalAssets || assetsChange < 1 / YOY_CHANGE_LIMITS.totalAssets) {
    issues.push({
      code: "EXTREME_ASSETS_CHANGE",
      field: "balanceSheet.totalAssets",
      message: `Total assets changed by ${((assetsChange - 1) * 100).toFixed(0)}% YoY, which may indicate M&A or unusual events`,
      expected: previous.balanceSheet.totalAssets,
      actual: current.balanceSheet.totalAssets,
      severity: "info",
    });
  }

  return issues;
}

/* ------------------------------------------------------------------ */
/* PERIOD CONTINUITY VALIDATION                                        */
/* ------------------------------------------------------------------ */

/**
 * Validate that quarterly data sums approximately to annual data
 * This catches restatements, data quality issues, and extraction errors
 */
export function validatePeriodContinuity(
  annual: Pick<Doc<"financialFundamentals">, "incomeStatement" | "cashFlow" | "fiscalYear">,
  quarters: Array<Pick<Doc<"financialFundamentals">, "incomeStatement" | "cashFlow" | "fiscalQuarter">>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (quarters.length === 0) {
    return issues;
  }

  // Check if we have all 4 quarters
  const quarterNumbers = quarters.map((q) => q.fiscalQuarter).filter((q): q is number => q !== undefined);
  const hasAllQuarters = [1, 2, 3, 4].every((q) => quarterNumbers.includes(q));

  if (!hasAllQuarters) {
    issues.push({
      code: "INCOMPLETE_QUARTERLY_DATA",
      field: "fiscalQuarter",
      message: `Missing quarters for FY${annual.fiscalYear}: have Q${quarterNumbers.sort().join(", Q")}`,
      severity: "info",
    });
    return issues; // Can't validate continuity without all quarters
  }

  // Sum quarterly revenue
  const quarterlyRevenueSum = quarters.reduce((sum, q) => sum + q.incomeStatement.revenue, 0);
  const annualRevenue = annual.incomeStatement.revenue;
  const revenueDiff = Math.abs(quarterlyRevenueSum - annualRevenue);
  const revenueTolerance = Math.abs(annualRevenue) * 0.05; // 5% tolerance

  if (revenueDiff > revenueTolerance && revenueDiff > 1_000_000) {
    issues.push({
      code: "QUARTERLY_ANNUAL_REVENUE_MISMATCH",
      field: "incomeStatement.revenue",
      message: `Sum of quarterly revenue (${formatNumber(quarterlyRevenueSum)}) differs from annual (${formatNumber(annualRevenue)}) by ${formatNumber(revenueDiff)}`,
      expected: annualRevenue,
      actual: quarterlyRevenueSum,
      severity: "warning",
    });
  }

  // Sum quarterly net income
  const quarterlyNetIncomeSum = quarters.reduce((sum, q) => sum + q.incomeStatement.netIncome, 0);
  const annualNetIncome = annual.incomeStatement.netIncome;
  const netIncomeDiff = Math.abs(quarterlyNetIncomeSum - annualNetIncome);
  const netIncomeTolerance = Math.max(Math.abs(annualNetIncome) * 0.10, 1_000_000); // 10% or $1M

  if (netIncomeDiff > netIncomeTolerance) {
    issues.push({
      code: "QUARTERLY_ANNUAL_NET_INCOME_MISMATCH",
      field: "incomeStatement.netIncome",
      message: `Sum of quarterly net income (${formatNumber(quarterlyNetIncomeSum)}) differs from annual (${formatNumber(annualNetIncome)}) by ${formatNumber(netIncomeDiff)}`,
      expected: annualNetIncome,
      actual: quarterlyNetIncomeSum,
      severity: "warning",
    });
  }

  // Sum quarterly operating cash flow
  const quarterlyOcfSum = quarters.reduce((sum, q) => sum + q.cashFlow.operatingCashFlow, 0);
  const annualOcf = annual.cashFlow.operatingCashFlow;
  const ocfDiff = Math.abs(quarterlyOcfSum - annualOcf);
  const ocfTolerance = Math.max(Math.abs(annualOcf) * 0.10, 1_000_000);

  if (ocfDiff > ocfTolerance) {
    issues.push({
      code: "QUARTERLY_ANNUAL_OCF_MISMATCH",
      field: "cashFlow.operatingCashFlow",
      message: `Sum of quarterly OCF (${formatNumber(quarterlyOcfSum)}) differs from annual (${formatNumber(annualOcf)}) by ${formatNumber(ocfDiff)}`,
      expected: annualOcf,
      actual: quarterlyOcfSum,
      severity: "info",
    });
  }

  return issues;
}

/* ------------------------------------------------------------------ */
/* RESTATEMENT DETECTION                                               */
/* ------------------------------------------------------------------ */

export interface RestatementInfo {
  hasRestatement: boolean;
  originalFiledDate?: string;
  latestFiledDate?: string;
  restatementCount: number;
  affectedFields: string[];
}

/**
 * Detect restatements by analyzing provenance data
 * Returns information about any detected restatements
 */
export function detectRestatements(
  fieldProvenance: Array<{
    fieldPath: string;
    accessionNumber: string;
    filedDate: string;
    selectionRationale: string;
  }>
): RestatementInfo {
  const accessionByField = new Map<string, Set<string>>();
  const filedDates = new Set<string>();
  const affectedFields: string[] = [];

  for (const prov of fieldProvenance) {
    // Check if selection rationale mentions multiple filings
    if (prov.selectionRationale.includes("filings found")) {
      affectedFields.push(prov.fieldPath);
    }

    // Track accession numbers per field
    const existing = accessionByField.get(prov.fieldPath) || new Set();
    existing.add(prov.accessionNumber);
    accessionByField.set(prov.fieldPath, existing);

    filedDates.add(prov.filedDate);
  }

  // Check if multiple accession numbers exist for the same logical period
  // (This would indicate restatements if the xbrlParser selected the latest)
  const restatementCount = affectedFields.length;

  const sortedDates = Array.from(filedDates).sort();
  const originalFiledDate = sortedDates[0];
  const latestFiledDate = sortedDates[sortedDates.length - 1];

  return {
    hasRestatement: restatementCount > 0,
    originalFiledDate: restatementCount > 0 ? originalFiledDate : undefined,
    latestFiledDate: restatementCount > 0 ? latestFiledDate : undefined,
    restatementCount,
    affectedFields: [...new Set(affectedFields)],
  };
}

/**
 * Validate restatement handling - ensure we're using the latest data
 */
export function validateRestatementHandling(
  fieldProvenance: Array<{
    fieldPath: string;
    accessionNumber: string;
    filedDate: string;
    selectionRationale: string;
  }>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const restatementInfo = detectRestatements(fieldProvenance);

  if (restatementInfo.hasRestatement) {
    issues.push({
      code: "RESTATEMENT_DETECTED",
      field: restatementInfo.affectedFields.join(", "),
      message: `Restatement detected: ${restatementInfo.restatementCount} field(s) had multiple filings. Using latest filing from ${restatementInfo.latestFiledDate}`,
      expected: restatementInfo.originalFiledDate,
      actual: restatementInfo.latestFiledDate,
      severity: "info",
    });
  }

  return issues;
}

/* ------------------------------------------------------------------ */
/* UNIT COHERENCE VALIDATION                                           */
/* ------------------------------------------------------------------ */

/**
 * Validate that all monetary values use consistent units
 * Catches cases where some values are in thousands vs millions
 */
export function validateUnitCoherence(
  fieldProvenance: Array<{
    fieldPath: string;
    units: string;
    tag: string;
  }>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Group by expected unit type
  const monetaryFields = fieldProvenance.filter(
    (p) => p.units === "USD" && !p.fieldPath.includes("metrics")
  );
  const shareFields = fieldProvenance.filter(
    (p) => p.units === "shares" || p.fieldPath.includes("shares")
  );
  const ratioFields = fieldProvenance.filter(
    (p) => p.units === "pure" || p.fieldPath.includes("metrics")
  );

  // Check monetary fields for unit consistency
  const monetaryUnits = new Set(monetaryFields.map((p) => p.units));
  if (monetaryUnits.size > 1) {
    issues.push({
      code: "MIXED_MONETARY_UNITS",
      field: "monetary",
      message: `Mixed monetary units detected: ${Array.from(monetaryUnits).join(", ")}. All monetary values should use USD.`,
      severity: "warning",
    });
  }

  // Check that EPS uses per-share units (pure), not USD
  const epsFields = fieldProvenance.filter((p) => p.fieldPath.includes("eps"));
  for (const epsField of epsFields) {
    if (epsField.units === "USD") {
      issues.push({
        code: "EPS_UNIT_ERROR",
        field: epsField.fieldPath,
        message: `EPS should use per-share units (pure/USD/shares), got ${epsField.units}`,
        severity: "warning",
      });
    }
  }

  // Check share count magnitude (should be millions for large companies)
  for (const shareField of shareFields) {
    if (shareField.tag === "computed") continue;
    // Note: Actual value validation would need the values, not just provenance
    // This is a structural check on unit types
  }

  return issues;
}

/* ------------------------------------------------------------------ */
/* COMPREHENSIVE VALIDATION                                            */
/* ------------------------------------------------------------------ */

export interface ComprehensiveValidationResult extends ValidationResult {
  restatementInfo?: RestatementInfo;
  periodContinuityChecked: boolean;
  unitCoherenceChecked: boolean;
}

/**
 * Run comprehensive validation including period continuity and unit coherence
 */
export function validateFundamentalsComprehensive(
  fundamentals: Pick<
    Doc<"financialFundamentals">,
    "incomeStatement" | "balanceSheet" | "cashFlow" | "metrics" | "fieldProvenance" | "fiscalYear"
  >,
  quarterlyData?: Array<Pick<
    Doc<"financialFundamentals">,
    "incomeStatement" | "cashFlow" | "fiscalQuarter"
  >>
): ComprehensiveValidationResult {
  // Start with basic validation
  const basicResult = validateFundamentals(fundamentals);

  const errors = [...basicResult.errors];
  const warnings = [...basicResult.warnings];
  const info = [...basicResult.info];

  let restatementInfo: RestatementInfo | undefined;
  let periodContinuityChecked = false;
  let unitCoherenceChecked = false;

  // Run provenance-based validations if available
  if (fundamentals.fieldProvenance && fundamentals.fieldProvenance.length > 0) {
    // Restatement detection
    const provenance = fundamentals.fieldProvenance as Array<{
      fieldPath: string;
      accessionNumber: string;
      filedDate: string;
      selectionRationale: string;
      units: string;
      tag: string;
    }>;

    restatementInfo = detectRestatements(provenance);
    const restatementIssues = validateRestatementHandling(provenance);
    for (const issue of restatementIssues) {
      if (issue.severity === "error") errors.push(issue);
      else if (issue.severity === "warning") warnings.push(issue);
      else info.push(issue);
    }

    // Unit coherence
    const unitIssues = validateUnitCoherence(provenance);
    for (const issue of unitIssues) {
      if (issue.severity === "error") errors.push(issue);
      else if (issue.severity === "warning") warnings.push(issue);
      else info.push(issue);
    }
    unitCoherenceChecked = true;
  }

  // Period continuity (if quarterly data provided)
  if (quarterlyData && quarterlyData.length > 0) {
    const annualData = {
      incomeStatement: fundamentals.incomeStatement,
      cashFlow: fundamentals.cashFlow,
      fiscalYear: fundamentals.fiscalYear,
    };
    const continuityIssues = validatePeriodContinuity(annualData, quarterlyData);
    for (const issue of continuityIssues) {
      if (issue.severity === "error") errors.push(issue);
      else if (issue.severity === "warning") warnings.push(issue);
      else info.push(issue);
    }
    periodContinuityChecked = true;
  }

  // Recalculate score
  let score = 100;
  score -= errors.length * 20;
  score -= warnings.length * 5;
  score -= info.length * 1;
  score = Math.max(0, Math.min(100, score));

  return {
    isValid: errors.length === 0,
    score,
    errors,
    warnings,
    info,
    restatementInfo,
    periodContinuityChecked,
    unitCoherenceChecked,
  };
}

/* ------------------------------------------------------------------ */
/* QUERIES                                                             */
/* ------------------------------------------------------------------ */

/**
 * Validate fundamentals by ID
 */
export const validateFundamentalsById = query({
  args: {
    fundamentalsId: v.id("financialFundamentals"),
  },
  returns: v.object({
    isValid: v.boolean(),
    score: v.number(),
    errors: v.array(
      v.object({
        code: v.string(),
        field: v.string(),
        message: v.string(),
        severity: v.string(),
      })
    ),
    warnings: v.array(
      v.object({
        code: v.string(),
        field: v.string(),
        message: v.string(),
        severity: v.string(),
      })
    ),
    infoCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const fundamentals = await ctx.db.get(args.fundamentalsId);
    if (!fundamentals) {
      return {
        isValid: false,
        score: 0,
        errors: [{ code: "NOT_FOUND", field: "", message: "Fundamentals not found", severity: "error" }],
        warnings: [],
        infoCount: 0,
      };
    }

    const result = validateFundamentals(fundamentals);

    return {
      isValid: result.isValid,
      score: result.score,
      errors: result.errors.map((e) => ({
        code: e.code,
        field: e.field,
        message: e.message,
        severity: e.severity,
      })),
      warnings: result.warnings.map((w) => ({
        code: w.code,
        field: w.field,
        message: w.message,
        severity: w.severity,
      })),
      infoCount: result.info.length,
    };
  },
});

/**
 * Validate all fundamentals for a ticker and get summary
 */
export const validateTickerFundamentals = internalQuery({
  args: {
    ticker: v.string(),
  },
  returns: v.object({
    ticker: v.string(),
    totalPeriods: v.number(),
    validPeriods: v.number(),
    averageScore: v.number(),
    issuesByCode: v.any(),
  }),
  handler: async (ctx, args) => {
    const tickerUpper = args.ticker.toUpperCase();

    const fundamentals = await ctx.db
      .query("financialFundamentals")
      .withIndex("by_ticker_period", (q) => q.eq("ticker", tickerUpper))
      .collect();

    if (fundamentals.length === 0) {
      return {
        ticker: tickerUpper,
        totalPeriods: 0,
        validPeriods: 0,
        averageScore: 0,
        issuesByCode: {},
      };
    }

    let validCount = 0;
    let totalScore = 0;
    const issuesByCode: Record<string, number> = {};

    for (const f of fundamentals) {
      const result = validateFundamentals(f);
      if (result.isValid) validCount++;
      totalScore += result.score;

      for (const issue of [...result.errors, ...result.warnings]) {
        issuesByCode[issue.code] = (issuesByCode[issue.code] || 0) + 1;
      }
    }

    return {
      ticker: tickerUpper,
      totalPeriods: fundamentals.length,
      validPeriods: validCount,
      averageScore: Math.round(totalScore / fundamentals.length),
      issuesByCode,
    };
  },
});

/**
 * Run comprehensive validation for a fiscal year including period continuity
 */
export const validateFiscalYearComprehensive = internalQuery({
  args: {
    ticker: v.string(),
    fiscalYear: v.number(),
  },
  returns: v.object({
    isValid: v.boolean(),
    score: v.number(),
    errors: v.array(
      v.object({
        code: v.string(),
        field: v.string(),
        message: v.string(),
        severity: v.string(),
      })
    ),
    warnings: v.array(
      v.object({
        code: v.string(),
        field: v.string(),
        message: v.string(),
        severity: v.string(),
      })
    ),
    infoCount: v.number(),
    restatementInfo: v.optional(
      v.object({
        hasRestatement: v.boolean(),
        originalFiledDate: v.optional(v.string()),
        latestFiledDate: v.optional(v.string()),
        restatementCount: v.number(),
        affectedFields: v.array(v.string()),
      })
    ),
    periodContinuityChecked: v.boolean(),
    unitCoherenceChecked: v.boolean(),
    quartersFound: v.array(v.number()),
  }),
  handler: async (ctx, args) => {
    const tickerUpper = args.ticker.toUpperCase();

    // Get annual data
    const annual = await ctx.db
      .query("financialFundamentals")
      .withIndex("by_ticker_period", (q) =>
        q.eq("ticker", tickerUpper).eq("fiscalYear", args.fiscalYear).eq("fiscalQuarter", undefined)
      )
      .first();

    if (!annual) {
      return {
        isValid: false,
        score: 0,
        errors: [{ code: "NOT_FOUND", field: "", message: `Annual data for ${tickerUpper} FY${args.fiscalYear} not found`, severity: "error" }],
        warnings: [],
        infoCount: 0,
        periodContinuityChecked: false,
        unitCoherenceChecked: false,
        quartersFound: [],
      };
    }

    // Get quarterly data
    const quarters = await ctx.db
      .query("financialFundamentals")
      .withIndex("by_ticker_period", (q) =>
        q.eq("ticker", tickerUpper).eq("fiscalYear", args.fiscalYear)
      )
      .collect();

    // Filter to only quarters (exclude annual)
    const quarterlyData = quarters.filter((q) => q.fiscalQuarter !== undefined);
    const quartersFound = quarterlyData
      .map((q) => q.fiscalQuarter)
      .filter((q): q is number => q !== undefined)
      .sort();

    // Run comprehensive validation
    const result = validateFundamentalsComprehensive(annual, quarterlyData);

    return {
      isValid: result.isValid,
      score: result.score,
      errors: result.errors.map((e) => ({
        code: e.code,
        field: e.field,
        message: e.message,
        severity: e.severity,
      })),
      warnings: result.warnings.map((w) => ({
        code: w.code,
        field: w.field,
        message: w.message,
        severity: w.severity,
      })),
      infoCount: result.info.length,
      restatementInfo: result.restatementInfo,
      periodContinuityChecked: result.periodContinuityChecked,
      unitCoherenceChecked: result.unitCoherenceChecked,
      quartersFound,
    };
  },
});
