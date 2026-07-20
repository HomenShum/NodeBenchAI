// convex/domains/evaluation/financial/types.ts
// Type definitions for financial model evaluation
//
// Shared types for DCF models, assumptions, and evaluations

import type { Id } from "../../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* DCF ASSUMPTION TYPES                                                */
/* ------------------------------------------------------------------ */

export interface YearValue {
  year: number;
  value: number;
}

export interface GrowthRateAssumption {
  year: number;
  rate: number;
  rationale: string;
  sourceChunkId?: string;
}

export interface RevenueAssumptions {
  baseRevenue: number;
  growthRates: GrowthRateAssumption[];
  terminalGrowthRate: number;
}

export interface OperatingAssumptions {
  grossMargin: YearValue[];
  sgaPercent: YearValue[];
  rdPercent?: YearValue[];
  daPercent: YearValue[];
  capexPercent: YearValue[];
  nwcPercent: YearValue[];
}

export interface WaccAssumptions {
  riskFreeRate: number;
  marketRiskPremium: number;
  beta: number;
  costOfEquity: number;
  costOfDebt: number;
  taxRate: number;
  debtWeight: number;
  equityWeight: number;
  wacc: number;
  sources: string[];
}

export interface TerminalValueAssumptions {
  method: "perpetuity" | "exit_multiple";
  perpetuityGrowth?: number;
  exitMultiple?: number;
  exitMultipleType?: string;
}

/**
 * Capital structure for equity bridge calculation
 *
 * Equity Value = Enterprise Value
 *              - Total Debt
 *              + Cash and Equivalents
 *              - Minority Interest (Non-controlling Interest)
 *              - Preferred Stock
 *              + Investments in Associates/JVs
 *              - Pension & Other Unfunded Liabilities
 *              - Contingent Liabilities (if material)
 *
 * Or simplified: Equity Value = EV - Net Debt - Minority Interest - Preferred + Investments
 * Where: Net Debt = Total Debt - Cash
 */
export interface CapitalStructure {
  // Share information
  currentShares: number;           // Basic shares outstanding
  expectedDilution?: number;       // Annual dilution rate (options, RSUs)
  fullyDilutedShares?: number;     // Treasury stock method diluted shares

  // Debt components
  totalDebt?: number;              // Short-term + Long-term debt
  shortTermDebt?: number;          // Due within 1 year
  longTermDebt?: number;           // Due after 1 year
  capitalLeases?: number;          // Finance lease obligations

  // Cash components
  cash?: number;                   // Cash and cash equivalents
  shortTermInvestments?: number;   // Marketable securities
  restrictedCash?: number;         // Not available for operations

  // Net debt (can be computed or provided)
  netDebt?: number;                // Total Debt - Cash - Short-term Investments

  // Equity bridge adjustments (EV → Equity Value)
  minorityInterest?: number;       // Non-controlling interest (subtract from EV)
  preferredStock?: number;         // Preferred equity (subtract from EV)
  investmentsInAssociates?: number;// Equity method investments (add to EV)
  pensionLiabilities?: number;     // Unfunded pension obligations (subtract)
  contingentLiabilities?: number;  // Material contingencies (subtract)
  otherAdjustments?: number;       // Other EV adjustments

  // Sources for audit trail
  balanceSheetDate?: string;       // As-of date for capital structure
  sources?: string[];              // Data sources for each component
}

export interface DcfAssumptions {
  forecastYears: number;
  baseYear: number;
  revenue: RevenueAssumptions;
  operating: OperatingAssumptions;
  wacc: WaccAssumptions;
  terminal: TerminalValueAssumptions;
  capitalStructure?: CapitalStructure;
}

/* ------------------------------------------------------------------ */
/* DCF OUTPUT TYPES                                                    */
/* ------------------------------------------------------------------ */

export interface YearlyProjection {
  year: number;
  revenue: number;
  grossProfit: number;
  ebit: number;
  nopat: number;
  depreciation: number;
  capex: number;
  nwcChange: number;
  fcf: number;
  discountFactor: number;
  presentValue: number;
}

export interface DcfOutputs {
  enterpriseValue: number;
  equityValue: number;
  impliedSharePrice?: number;
  presentValueFcf: number;
  terminalValue: number;
  terminalValuePercent: number;
}

/**
 * Detailed equity bridge breakdown showing EV → Equity Value transformation
 *
 * This provides full transparency on how we move from Enterprise Value
 * to per-share equity value, which is critical for valuation accuracy.
 */
export interface EquityBridge {
  // Starting point
  enterpriseValue: number;

  // Debt adjustments
  totalDebt: number;               // (subtract)
  cash: number;                    // (add)
  shortTermInvestments: number;    // (add)
  netDebt: number;                 // = totalDebt - cash - shortTermInvestments

  // Non-equity claim adjustments
  minorityInterest: number;        // Non-controlling interest (subtract)
  preferredStock: number;          // Preferred equity (subtract)

  // Asset adjustments
  investmentsInAssociates: number; // Equity method investments (add)

  // Other adjustments
  pensionLiabilities: number;      // Unfunded pension (subtract)
  contingentLiabilities: number;   // Material contingencies (subtract)
  otherAdjustments: number;        // Catch-all for unusual items

  // Result
  equityValue: number;             // EV - netDebt - minority - preferred + investments - pension - contingent - other

  // Per-share calculation
  basicShares: number;
  dilutedShares: number;
  impliedPriceBasic: number;       // equityValue / basicShares
  impliedPriceDiluted: number;     // equityValue / dilutedShares

  // Audit trail
  bridgeComplete: boolean;         // All components accounted for
  missingComponents: string[];     // Components assumed to be zero
  dataAsOfDate?: string;           // Date of capital structure data
}

export interface DcfDetailedOutputs extends DcfOutputs {
  yearlyProjections: YearlyProjection[];
  terminalFcf: number;
  undiscountedTerminalValue: number;
  discountedTerminalValue: number;

  // Equity bridge (EV → per-share value)
  equityBridge?: EquityBridge;
}

export interface SensitivityMatrix {
  waccRange: number[];
  terminalGrowthRange: number[];
  matrix: number[][];  // EV at each [wacc][growth] combo
}

/* ------------------------------------------------------------------ */
/* EVALUATION TYPES                                                    */
/* ------------------------------------------------------------------ */

export interface AssumptionDrift {
  fieldPath: string;
  aiValue: number | string;
  groundTruthValue: number | string;
  percentDrift?: number;  // For numeric values
  severity: "low" | "moderate" | "high" | "critical";
  explanation: string;
}

export interface SourceQualityAssessment {
  tier: "tier1_authoritative" | "tier2_reliable" | "tier3_secondary" | "tier4_news" | "tier5_unverified";
  sourceUrl?: string;
  domain?: string;
  freshnessDays?: number;
  score: number;
  notes: string;
}

export interface EvaluationVerdict {
  verdict: "ALIGNED" | "MINOR_DRIFT" | "SIGNIFICANT_DRIFT" | "METHODOLOGY_MISMATCH";
  overallScore: number;
  assumptionDriftScore: number;
  sourceQualityScore: number;
  modelAlignmentScore: number;
  explanation: string;
}

/* ------------------------------------------------------------------ */
/* COMPARISON RESULT TYPES                                             */
/* ------------------------------------------------------------------ */

export interface AssumptionComparisonResult {
  fieldPath: string;
  aiValue: any;
  groundTruthValue: any;
  match: boolean;
  drift?: AssumptionDrift;
}

export interface DcfComparisonResult {
  entityKey: string;
  aiModelVersion: number;
  groundTruthVersion?: number;

  // Assumption comparisons
  revenueGrowthComparison: AssumptionComparisonResult[];
  waccComparison: AssumptionComparisonResult[];
  terminalValueComparison: AssumptionComparisonResult[];
  operatingAssumptionComparison: AssumptionComparisonResult[];

  // Output comparisons
  evDrift: number;  // Percentage difference in EV
  evDriftAbsolute: number;  // Absolute difference
  impliedPriceDrift?: number;

  // Scores
  assumptionDriftScore: number;
  methodologyMatchScore: number;
  overallAlignmentScore: number;

  // Verdict
  verdict: EvaluationVerdict;
}

/* ------------------------------------------------------------------ */
/* PROVENANCE TYPES                                                    */
/* ------------------------------------------------------------------ */

export interface DcfProvenance {
  modelId: string;
  entityKey: string;
  version: number;
  computedAt: number;

  // Input provenance
  fundamentalsUsed: Array<{
    fundamentalsId: Id<"financialFundamentals">;
    fiscalYear: number;
    fiscalQuarter?: number;
    filingDate: string;
  }>;

  // Assumption sources
  assumptionSources: Array<{
    fieldPath: string;
    sourceType: "sec_filing" | "earnings_call" | "analyst_estimate" | "manual_input" | "ai_inference";
    sourceArtifactId?: Id<"sourceArtifacts">;
    confidence: number;
  }>;

  // Computation metadata
  computationHash: string;  // Hash of inputs for reproducibility
  engineVersion: string;    // DCF engine version
}
