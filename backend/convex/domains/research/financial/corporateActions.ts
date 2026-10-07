// convex/domains/financial/corporateActions.ts
// Corporate Actions Handler for Per-Share Normalization
//
// Handles stock splits, dividends, repurchases, and dilution adjustments
// to ensure comparable per-share metrics across time periods.
//
// ============================================================================
// CORPORATE ACTIONS OVERVIEW
// ============================================================================
//
// Types of corporate actions that affect per-share metrics:
//
// 1. STOCK SPLITS (forward/reverse)
//    - Forward split (e.g., 10:1): More shares, lower price per share
//    - Reverse split (e.g., 1:10): Fewer shares, higher price per share
//    - Affects: EPS, shares outstanding, share price (historical needs adjustment)
//
// 2. STOCK DIVIDENDS
//    - Similar effect to stock split
//    - Increases shares outstanding proportionally
//
// 3. SHARE REPURCHASES (Buybacks)
//    - Decreases shares outstanding
//    - Increases EPS (same earnings, fewer shares)
//    - Must track treasury stock vs. retired shares
//
// 4. EQUITY DILUTION
//    - Stock options exercise
//    - RSU vesting
//    - Convertible securities conversion
//    - Employee stock purchase plans (ESPP)
//    - Secondary offerings
//
// 5. SPIN-OFFS / CARVE-OUTS
//    - Requires restatement of historical financials
//    - Pro-forma adjustments for comparability
//
// ============================================================================

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../../_generated/server";
import type { Id } from "../../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* TYPES                                                               */
/* ------------------------------------------------------------------ */

export interface StockSplit {
  type: "split";
  effectiveDate: string;        // ISO date
  ratio: number;                // e.g., 10 for 10:1 split, 0.1 for 1:10 reverse
  announcementDate?: string;
  notes?: string;
}

export interface StockDividend {
  type: "stock_dividend";
  effectiveDate: string;
  ratio: number;                // e.g., 0.05 for 5% stock dividend
  exDate?: string;
  recordDate?: string;
}

export interface ShareRepurchase {
  type: "repurchase";
  announcementDate?: string;
  programSize?: number;         // Dollar amount authorized
  sharesRepurchased: number;
  averagePrice?: number;
  startDate: string;
  endDate?: string;
  retired: boolean;             // True if shares retired, false if held as treasury
}

export interface DilutionEvent {
  type: "dilution";
  effectiveDate: string;
  source: "options" | "rsu" | "convertible" | "espp" | "secondary_offering" | "other";
  sharesIssued: number;
  strikePrice?: number;         // For options
  notes?: string;
}

export interface SpinOff {
  type: "spinoff";
  effectiveDate: string;
  spinoffEntityName: string;
  spinoffTicker?: string;
  ratio: number;                // Shares of spinoff per share of parent
  parentAdjustmentFactor: number; // Factor to adjust parent historical prices
}

export type CorporateAction =
  | StockSplit
  | StockDividend
  | ShareRepurchase
  | DilutionEvent
  | SpinOff;

export interface CorporateActionHistory {
  ticker: string;
  actions: CorporateAction[];
  lastUpdated: string;
}

export interface ShareAdjustmentFactor {
  asOfDate: string;
  cumulativeFactor: number;     // Multiply historical shares by this to get current equivalent
  actions: string[];            // Description of actions included
}

/* ------------------------------------------------------------------ */
/* SHARE ADJUSTMENT CALCULATIONS                                       */
/* ------------------------------------------------------------------ */

/**
 * Calculate cumulative split adjustment factor from a date to present
 *
 * Example: If there was a 4:1 split on 2020-01-01 and a 10:1 split on 2022-01-01,
 * a share count from 2019 needs to be multiplied by 40 to get today's equivalent.
 */
export function calculateSplitAdjustmentFactor(
  actions: CorporateAction[],
  fromDate: string,
  toDate: string = new Date().toISOString().split("T")[0]
): ShareAdjustmentFactor {
  let cumulativeFactor = 1;
  const includedActions: string[] = [];

  // Filter and sort splits/dividends between dates
  const relevantActions = actions
    .filter((a): a is StockSplit | StockDividend =>
      (a.type === "split" || a.type === "stock_dividend") &&
      a.effectiveDate > fromDate &&
      a.effectiveDate <= toDate
    )
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));

  for (const action of relevantActions) {
    if (action.type === "split") {
      cumulativeFactor *= action.ratio;
      includedActions.push(`${action.effectiveDate}: ${action.ratio}:1 split`);
    } else if (action.type === "stock_dividend") {
      cumulativeFactor *= (1 + action.ratio);
      includedActions.push(`${action.effectiveDate}: ${(action.ratio * 100).toFixed(1)}% stock dividend`);
    }
  }

  return {
    asOfDate: toDate,
    cumulativeFactor,
    actions: includedActions,
  };
}

/**
 * Adjust historical share count to current basis
 */
export function adjustSharesForSplits(
  historicalShares: number,
  fromDate: string,
  actions: CorporateAction[]
): number {
  const factor = calculateSplitAdjustmentFactor(actions, fromDate);
  return historicalShares * factor.cumulativeFactor;
}

/**
 * Adjust historical EPS to current basis (inverse of share adjustment)
 */
export function adjustEpsForSplits(
  historicalEps: number,
  fromDate: string,
  actions: CorporateAction[]
): number {
  const factor = calculateSplitAdjustmentFactor(actions, fromDate);
  return historicalEps / factor.cumulativeFactor;
}

/**
 * Adjust historical price to current basis
 */
export function adjustPriceForSplits(
  historicalPrice: number,
  fromDate: string,
  actions: CorporateAction[]
): number {
  const factor = calculateSplitAdjustmentFactor(actions, fromDate);
  // Also account for spinoffs
  const spinoffs = actions.filter(
    (a): a is SpinOff => a.type === "spinoff" &&
    a.effectiveDate > fromDate
  );
  let spinoffAdjustment = 1;
  for (const spinoff of spinoffs) {
    spinoffAdjustment *= spinoff.parentAdjustmentFactor;
  }
  return (historicalPrice / factor.cumulativeFactor) * spinoffAdjustment;
}

/* ------------------------------------------------------------------ */
/* DILUTION CALCULATIONS                                               */
/* ------------------------------------------------------------------ */

/**
 * Treasury Stock Method for calculating diluted shares
 *
 * Used for in-the-money options and warrants:
 * Diluted Shares = Basic + (ITM Options) - (Options * Strike / Current Price)
 */
export function treasuryStockMethod(
  basicShares: number,
  optionsOutstanding: number,
  weightedAverageStrike: number,
  currentPrice: number
): number {
  if (currentPrice <= weightedAverageStrike) {
    // Options are out-of-the-money, no dilution
    return basicShares;
  }

  // Proceeds from hypothetical exercise
  const proceeds = optionsOutstanding * weightedAverageStrike;

  // Shares that could be repurchased with proceeds
  const sharesRepurchased = proceeds / currentPrice;

  // Net dilution
  const netNewShares = optionsOutstanding - sharesRepurchased;

  return basicShares + netNewShares;
}

/**
 * Calculate fully diluted shares from all sources
 */
export interface DilutionSources {
  basicShares: number;
  stockOptions?: {
    outstanding: number;
    weightedAverageStrike: number;
  };
  rsus?: {
    unvested: number;
  };
  convertibleDebt?: {
    faceValue: number;
    conversionPrice: number;
  };
  warrants?: {
    outstanding: number;
    exercisePrice: number;
  };
}

export function calculateFullyDilutedShares(
  sources: DilutionSources,
  currentPrice: number
): {
  fullyDiluted: number;
  dilutionPercent: number;
  breakdown: Record<string, number>;
} {
  let fullyDiluted = sources.basicShares;
  const breakdown: Record<string, number> = {
    basic: sources.basicShares,
  };

  // Stock options (treasury stock method)
  if (sources.stockOptions && sources.stockOptions.outstanding > 0) {
    const optionDilution = treasuryStockMethod(
      0, // We're calculating incremental dilution
      sources.stockOptions.outstanding,
      sources.stockOptions.weightedAverageStrike,
      currentPrice
    );
    breakdown.stockOptions = optionDilution;
    fullyDiluted += optionDilution;
  }

  // RSUs (assume all vest)
  if (sources.rsus && sources.rsus.unvested > 0) {
    breakdown.rsus = sources.rsus.unvested;
    fullyDiluted += sources.rsus.unvested;
  }

  // Convertible debt (if-converted method)
  if (sources.convertibleDebt && currentPrice > sources.convertibleDebt.conversionPrice) {
    const convertibleShares = sources.convertibleDebt.faceValue / sources.convertibleDebt.conversionPrice;
    breakdown.convertibleDebt = convertibleShares;
    fullyDiluted += convertibleShares;
  }

  // Warrants (treasury stock method)
  if (sources.warrants && sources.warrants.outstanding > 0) {
    const warrantDilution = treasuryStockMethod(
      0,
      sources.warrants.outstanding,
      sources.warrants.exercisePrice,
      currentPrice
    );
    breakdown.warrants = warrantDilution;
    fullyDiluted += warrantDilution;
  }

  const dilutionPercent = (fullyDiluted - sources.basicShares) / sources.basicShares;

  return {
    fullyDiluted,
    dilutionPercent,
    breakdown,
  };
}

/* ------------------------------------------------------------------ */
/* SHARE COUNT RECONCILIATION                                          */
/* ------------------------------------------------------------------ */

/**
 * Reconcile share counts across periods
 *
 * Starting shares + issuances - repurchases + options exercised = Ending shares
 */
export interface ShareReconciliation {
  startingShares: number;
  periodStartDate: string;
  periodEndDate: string;

  // Increases
  optionsExercised: number;
  rsusVested: number;
  secondaryOfferings: number;
  otherIssuances: number;

  // Decreases
  sharesRepurchased: number;
  sharesRetired: number;

  // Result
  endingShares: number;
  reconciled: boolean;
  discrepancy: number;
}

export function reconcileShareCount(
  startingShares: number,
  endingSharesReported: number,
  events: {
    optionsExercised?: number;
    rsusVested?: number;
    secondaryOfferings?: number;
    otherIssuances?: number;
    sharesRepurchased?: number;
    sharesRetired?: number;
  }
): ShareReconciliation {
  const optionsExercised = events.optionsExercised ?? 0;
  const rsusVested = events.rsusVested ?? 0;
  const secondaryOfferings = events.secondaryOfferings ?? 0;
  const otherIssuances = events.otherIssuances ?? 0;
  const sharesRepurchased = events.sharesRepurchased ?? 0;
  const sharesRetired = events.sharesRetired ?? 0;

  const calculatedEnding = startingShares
    + optionsExercised
    + rsusVested
    + secondaryOfferings
    + otherIssuances
    - sharesRepurchased
    - sharesRetired;

  const discrepancy = endingSharesReported - calculatedEnding;
  // Allow 0.1% tolerance for rounding
  const reconciled = Math.abs(discrepancy) / endingSharesReported < 0.001;

  return {
    startingShares,
    periodStartDate: "",
    periodEndDate: "",
    optionsExercised,
    rsusVested,
    secondaryOfferings,
    otherIssuances,
    sharesRepurchased,
    sharesRetired,
    endingShares: calculatedEnding,
    reconciled,
    discrepancy,
  };
}

/* ------------------------------------------------------------------ */
/* PER-SHARE METRIC NORMALIZATION                                      */
/* ------------------------------------------------------------------ */

/**
 * Normalize per-share metrics to current share basis
 */
export interface PerShareMetrics {
  eps: number;
  epsGrowth?: number;
  bookValuePerShare?: number;
  dividendPerShare?: number;
  freeCashFlowPerShare?: number;
}

export function normalizePerShareMetrics(
  historicalMetrics: PerShareMetrics,
  fromDate: string,
  actions: CorporateAction[]
): PerShareMetrics {
  const factor = calculateSplitAdjustmentFactor(actions, fromDate);

  return {
    eps: historicalMetrics.eps / factor.cumulativeFactor,
    epsGrowth: historicalMetrics.epsGrowth, // Growth rate doesn't change
    bookValuePerShare: historicalMetrics.bookValuePerShare
      ? historicalMetrics.bookValuePerShare / factor.cumulativeFactor
      : undefined,
    dividendPerShare: historicalMetrics.dividendPerShare
      ? historicalMetrics.dividendPerShare / factor.cumulativeFactor
      : undefined,
    freeCashFlowPerShare: historicalMetrics.freeCashFlowPerShare
      ? historicalMetrics.freeCashFlowPerShare / factor.cumulativeFactor
      : undefined,
  };
}

/**
 * Build normalized time series of per-share metrics
 */
export function buildNormalizedTimeSeries(
  rawTimeSeries: Array<{
    date: string;
    fiscalYear: number;
    eps: number;
    shares: number;
  }>,
  actions: CorporateAction[]
): Array<{
  date: string;
  fiscalYear: number;
  rawEps: number;
  normalizedEps: number;
  rawShares: number;
  normalizedShares: number;
  adjustmentFactor: number;
}> {
  return rawTimeSeries.map((item) => {
    const factor = calculateSplitAdjustmentFactor(actions, item.date);
    return {
      date: item.date,
      fiscalYear: item.fiscalYear,
      rawEps: item.eps,
      normalizedEps: item.eps / factor.cumulativeFactor,
      rawShares: item.shares,
      normalizedShares: item.shares * factor.cumulativeFactor,
      adjustmentFactor: factor.cumulativeFactor,
    };
  });
}

/* ------------------------------------------------------------------ */
/* ANNUAL DILUTION RATE ESTIMATION                                     */
/* ------------------------------------------------------------------ */

/**
 * Estimate annual dilution rate from historical data
 *
 * Used for projecting future share counts in DCF models.
 */
export function estimateAnnualDilutionRate(
  historicalShareCounts: Array<{
    fiscalYear: number;
    sharesOutstanding: number;
  }>,
  actions: CorporateAction[]
): {
  averageAnnualDilution: number;
  trend: "increasing" | "decreasing" | "stable";
  dataPoints: number;
} {
  if (historicalShareCounts.length < 2) {
    return {
      averageAnnualDilution: 0.02, // Default 2% assumption
      trend: "stable",
      dataPoints: historicalShareCounts.length,
    };
  }

  // Normalize all share counts to current basis
  const normalized = historicalShareCounts.map((item) => {
    const dateStr = `${item.fiscalYear}-12-31`;
    const factor = calculateSplitAdjustmentFactor(actions, dateStr);
    return {
      fiscalYear: item.fiscalYear,
      normalizedShares: item.sharesOutstanding * factor.cumulativeFactor,
    };
  }).sort((a, b) => a.fiscalYear - b.fiscalYear);

  // Calculate year-over-year dilution rates
  const dilutionRates: number[] = [];
  for (let i = 1; i < normalized.length; i++) {
    const rate = (normalized[i].normalizedShares - normalized[i - 1].normalizedShares) /
      normalized[i - 1].normalizedShares;
    dilutionRates.push(rate);
  }

  // Average dilution rate
  const averageAnnualDilution = dilutionRates.reduce((a, b) => a + b, 0) / dilutionRates.length;

  // Determine trend
  let trend: "increasing" | "decreasing" | "stable" = "stable";
  if (dilutionRates.length >= 3) {
    const recentRates = dilutionRates.slice(-3);
    const earlyRates = dilutionRates.slice(0, 3);
    const recentAvg = recentRates.reduce((a, b) => a + b, 0) / recentRates.length;
    const earlyAvg = earlyRates.reduce((a, b) => a + b, 0) / earlyRates.length;

    if (recentAvg > earlyAvg * 1.2) trend = "increasing";
    else if (recentAvg < earlyAvg * 0.8) trend = "decreasing";
  }

  return {
    averageAnnualDilution,
    trend,
    dataPoints: historicalShareCounts.length,
  };
}

