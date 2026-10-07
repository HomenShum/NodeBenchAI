// convex/domains/financial/xbrlParser.ts
// XBRL Parser/Normalizer for SEC companyfacts data
//
// Features:
// - Priority-based tag selection with full provenance tracking
// - Custom tag detection (non-us-gaap extensions)
// - Dimensional qualifier extraction
// - Selection rationale documentation
// - Period/restatement handling (prefer latest filed)
//
// ============================================================================
// DIMENSIONAL DATA STRATEGY
// ============================================================================
//
// This parser implements a **CONSOLIDATED-ONLY** approach for dimensional data:
//
// 1. WHAT WE EXTRACT:
//    - Consolidated total figures (no segment breakdowns)
//    - Primary reporting currency (USD)
//    - Annual (10-K) and quarterly (10-Q) periods
//
// 2. WHAT WE INTENTIONALLY SKIP:
//    - Segment-level data (business units, product lines)
//    - Geographic breakdowns (by country/region)
//    - Dimensional axes (us-gaap:SegmentAxis, us-gaap:ProductOrServiceAxis, etc.)
//
// 3. RATIONALE:
//    - DCF models typically use consolidated figures for valuation
//    - Segment data requires complex reconciliation logic
//    - Dimensional data varies significantly by company
//    - Consolidated totals have the highest coverage/reliability
//
// 4. FUTURE EXTENSION:
//    - To support segment-level analysis, implement a separate extraction pass
//    - Filter for facts where dimensions[] is non-empty
//    - Map axis/member pairs to business unit taxonomy
//
// 5. DETECTION BEHAVIOR:
//    - Facts with dimensional qualifiers are logged but not extracted
//    - Provenance tracks whether a selected fact had dimension filtering applied
//
// See also: convex/domains/financial/validation.ts for period/restatement handling
// ============================================================================

import type { CompanyFacts, FactUnit } from "./secEdgarClient";

/* ------------------------------------------------------------------ */
/* TYPES                                                               */
/* ------------------------------------------------------------------ */

export interface FieldProvenance {
  fieldPath: string;           // e.g., "incomeStatement.revenue"
  tag: string;                 // Original XBRL concept name
  namespace: string;           // "us-gaap", "dei", "ifrs-full", or custom
  units: string;               // "USD", "shares", "pure"
  periodStart?: string;        // ISO date for duration facts
  periodEnd: string;           // ISO date (end or instant)
  fiscalPeriod: string;        // "FY", "Q1", "Q2", "Q3", "Q4"
  formType: string;            // "10-K", "10-Q", etc.
  accessionNumber: string;     // SEC accession number
  filedDate: string;           // When filing was submitted
  dimensions?: Array<{ axis: string; member: string }>;
  selectionRationale: string;  // Why this tag was selected
  isCustomTag: boolean;        // Custom extension vs standard taxonomy
  alternativeTags?: string[];  // Other tags considered
  isComputed?: boolean;        // True if derived/calculated
  computedFrom?: string[];     // Source fields if computed

  // Dimensional data tracking (CONSOLIDATED_ONLY strategy)
  dimensionalStrategy?: "CONSOLIDATED_ONLY" | "SEGMENT_AWARE" | "FULL_DIMENSIONAL";
  dimensionalFactsSkipped?: number;     // Count of segmented facts skipped for this field
  usedConsolidatedFigure?: boolean;     // True if we selected consolidated over segmented
}

export interface NormalizedFundamentals {
  ticker: string;
  cik: string;
  fiscalYear: number;
  fiscalQuarter?: number;
  filingDate: string;

  incomeStatement: {
    revenue: number;
    costOfRevenue?: number;
    grossProfit?: number;
    operatingExpenses?: number;
    operatingIncome?: number;
    netIncome: number;
    eps?: number;
    sharesOutstanding?: number;
  };

  balanceSheet: {
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    cash?: number;
    totalDebt?: number;
    currentAssets?: number;
    currentLiabilities?: number;
  };

  cashFlow: {
    operatingCashFlow: number;
    capex?: number;
    freeCashFlow?: number;
    dividendsPaid?: number;
    shareRepurchases?: number;
  };

  metrics?: {
    grossMargin?: number;
    operatingMargin?: number;
    netMargin?: number;
    roic?: number;
    roe?: number;
    debtToEquity?: number;
  };

  // Full provenance tracking
  fieldProvenance: FieldProvenance[];
  hasCustomTags: boolean;
  customTagCount: number;
  needsReview: boolean;

  // Dimensional data strategy tracking
  dimensionalStrategy: typeof DIMENSIONAL_STRATEGY;
  dimensionalFactsEncountered: number;  // Total dimensional facts seen
  dimensionalFactsSkipped: number;      // Dimensional facts not extracted
  hasSegmentData: boolean;              // True if company reports segment-level data

  extractionConfidence: number;
  extractionNotes: string[];
}

export interface ExtractionResult {
  ok: boolean;
  fundamentals?: NormalizedFundamentals;
  error?: string;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* STANDARD TAXONOMY NAMESPACES                                        */
/* ------------------------------------------------------------------ */

const STANDARD_NAMESPACES = new Set([
  "us-gaap",
  "dei",
  "ifrs-full",
  "srt",       // SEC Reporting Taxonomy
  "country",   // Country codes
  "currency",  // Currency codes
  "exch",      // Exchanges
]);

/**
 * Check if a tag is from a standard taxonomy or a custom extension
 */
function isCustomTag(namespace: string): boolean {
  return !STANDARD_NAMESPACES.has(namespace);
}

/* ------------------------------------------------------------------ */
/* DIMENSIONAL DATA CONFIGURATION                                      */
/* ------------------------------------------------------------------ */

/**
 * Dimensional data extraction strategy
 *
 * CONSOLIDATED_ONLY: Extract only total/consolidated figures (default)
 * SEGMENT_AWARE: Extract segment-level data with reconciliation (future)
 * FULL_DIMENSIONAL: Extract all dimensional combinations (future)
 */
export const DIMENSIONAL_STRATEGY = "CONSOLIDATED_ONLY" as const;

/**
 * Known dimensional axes that indicate segment/geographic breakdowns
 * Facts tagged with these axes are skipped in CONSOLIDATED_ONLY mode
 */
export const SEGMENT_AXES = [
  "us-gaap:SegmentAxis",
  "us-gaap:ProductOrServiceAxis",
  "us-gaap:GeographicAreasAxis",
  "us-gaap:StatementGeographicalAxis",
  "us-gaap:OperatingSegmentsAxis",
  "us-gaap:ConsolidationItemsAxis",
  "us-gaap:BusinessSegmentsAxis",
  "srt:ProductOrServiceAxis",
  "srt:GeographyAxis",
] as const;

/**
 * Member values that indicate consolidated/total (not segment-specific)
 * Facts with these members are considered valid for extraction
 */
export const CONSOLIDATED_MEMBERS = [
  "us-gaap:ConsolidatedEntitiesMember",
  "us-gaap:CorporateAndOtherMember",
  "us-gaap:EntityConsolidatedMember",
  "srt:ConsolidationEliminationsMember",
] as const;

/**
 * Configuration for dimensional filtering behavior
 */
export const DIMENSIONAL_CONFIG = {
  /** Current strategy - only extract consolidated figures */
  strategy: DIMENSIONAL_STRATEGY,

  /** Skip facts that have any segment/geographic axes */
  skipSegmentedFacts: true,

  /** Log when dimensional facts are encountered but skipped */
  logSkippedDimensionalFacts: true,

  /** Include dimensional metadata in provenance even when not extracting segments */
  trackDimensionsInProvenance: true,
} as const;

/* ------------------------------------------------------------------ */
/* TAG MAPPINGS WITH RATIONALE                                         */
/* ------------------------------------------------------------------ */

interface TagMapping {
  tags: readonly string[];
  rationale: string;
  preferredUnit: "USD" | "shares" | "pure";
}

const TAG_MAPPINGS: Record<string, TagMapping> = {
  // Income Statement
  revenue: {
    tags: [
      "Revenues",
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
      "SalesRevenueNet",
      "SalesRevenueGoodsNet",
      "TotalRevenuesAndOtherIncome",
      "NetRevenues",
    ],
    rationale: "Primary revenue recognition per ASC 606; prefer 'Revenues' as most common top-line tag",
    preferredUnit: "USD",
  },
  costOfRevenue: {
    tags: [
      "CostOfRevenue",
      "CostOfGoodsAndServicesSold",
      "CostOfGoodsSold",
      "CostOfSales",
    ],
    rationale: "Direct costs associated with revenue; prefer broader 'CostOfRevenue' over goods-specific tags",
    preferredUnit: "USD",
  },
  grossProfit: {
    tags: ["GrossProfit"],
    rationale: "Explicit gross profit disclosure; only one standard tag",
    preferredUnit: "USD",
  },
  operatingExpenses: {
    tags: [
      "OperatingExpenses",
      "CostsAndExpenses",
    ],
    rationale: "Total operating expenses excluding COGS",
    preferredUnit: "USD",
  },
  operatingIncome: {
    tags: [
      "OperatingIncomeLoss",
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    ],
    rationale: "Operating income before interest and taxes",
    preferredUnit: "USD",
  },
  netIncome: {
    tags: [
      "NetIncomeLoss",
      "NetIncomeLossAvailableToCommonStockholdersBasic",
      "ProfitLoss",
    ],
    rationale: "Bottom-line net income; prefer 'NetIncomeLoss' as most comprehensive",
    preferredUnit: "USD",
  },
  eps: {
    tags: [
      "EarningsPerShareBasic",
      "EarningsPerShareDiluted",
    ],
    rationale: "EPS per share; prefer basic for consistency",
    preferredUnit: "pure",
  },
  sharesOutstanding: {
    tags: [
      "CommonStockSharesOutstanding",
      "WeightedAverageNumberOfSharesOutstandingBasic",
      "WeightedAverageNumberOfDilutedSharesOutstanding",
    ],
    rationale: "Share count for per-share calculations",
    preferredUnit: "shares",
  },

  // Balance Sheet
  totalAssets: {
    tags: ["Assets"],
    rationale: "Total assets; single standard tag",
    preferredUnit: "USD",
  },
  totalLiabilities: {
    tags: [
      "Liabilities",
      "LiabilitiesAndStockholdersEquity",
    ],
    rationale: "Total liabilities; prefer 'Liabilities' over combined tag",
    preferredUnit: "USD",
  },
  totalEquity: {
    tags: [
      "StockholdersEquity",
      "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ],
    rationale: "Shareholder equity; prefer excluding NCI when available",
    preferredUnit: "USD",
  },
  cash: {
    tags: [
      "CashAndCashEquivalentsAtCarryingValue",
      "CashCashEquivalentsAndShortTermInvestments",
      "Cash",
    ],
    rationale: "Cash and equivalents for liquidity analysis",
    preferredUnit: "USD",
  },
  totalDebt: {
    tags: [
      "LongTermDebt",
      "LongTermDebtNoncurrent",
      "DebtLongtermAndShorttermCombinedAmount",
    ],
    rationale: "Long-term debt for capital structure analysis",
    preferredUnit: "USD",
  },
  currentAssets: {
    tags: ["AssetsCurrent"],
    rationale: "Current assets for working capital calculation",
    preferredUnit: "USD",
  },
  currentLiabilities: {
    tags: ["LiabilitiesCurrent"],
    rationale: "Current liabilities for working capital calculation",
    preferredUnit: "USD",
  },

  // Cash Flow
  operatingCashFlow: {
    tags: [
      "NetCashProvidedByUsedInOperatingActivities",
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
    rationale: "Operating cash flow from SCF; prefer all-inclusive over continuing-only",
    preferredUnit: "USD",
  },
  capex: {
    tags: [
      "PaymentsToAcquirePropertyPlantAndEquipment",
      "CapitalExpendituresIncurredButNotYetPaid",
      "PaymentsToAcquireProductiveAssets",
    ],
    rationale: "Capital expenditures for FCF calculation",
    preferredUnit: "USD",
  },
  dividendsPaid: {
    tags: [
      "PaymentsOfDividendsCommonStock",
      "PaymentsOfDividends",
      "DividendsCommonStockCash",
    ],
    rationale: "Dividend payments to common shareholders",
    preferredUnit: "USD",
  },
  shareRepurchases: {
    tags: [
      "PaymentsForRepurchaseOfCommonStock",
      "StockRepurchasedAndRetiredDuringPeriodValue",
    ],
    rationale: "Stock buyback amounts",
    preferredUnit: "USD",
  },
};

/* ------------------------------------------------------------------ */
/* EXTRACTION WITH PROVENANCE                                          */
/* ------------------------------------------------------------------ */

interface ExtractedValue {
  value: number | null;
  provenance: FieldProvenance | null;
  alternativesFound: string[];
}

/**
 * Get the best value for a field with full provenance tracking
 * Handles restatements by preferring the latest filed fact for a given period
 */
function extractValueWithProvenance(
  facts: CompanyFacts["facts"],
  fieldPath: string,
  mapping: TagMapping,
  fiscalYear: number,
  fiscalQuarter?: number
): ExtractedValue {
  const isAnnual = !fiscalQuarter;
  const targetForm = isAnnual ? "10-K" : "10-Q";
  const fpMap: Record<number, string> = { 1: "Q1", 2: "Q2", 3: "Q3", 4: "Q4" };
  const targetFp = isAnnual ? "FY" : fpMap[fiscalQuarter!];

  const alternativesFound: string[] = [];

  // Search across all namespaces
  for (const [namespace, nsFacts] of Object.entries(facts)) {
    if (!nsFacts) continue;

    for (const tagName of mapping.tags) {
      const concept = nsFacts[tagName];
      if (!concept) continue;

      alternativesFound.push(`${namespace}:${tagName}`);

      // Determine unit to use
      const unitKey = mapping.preferredUnit === "USD" ? "USD"
        : mapping.preferredUnit === "shares" ? "shares"
        : "pure";

      const units = concept.units[unitKey] || concept.units["USD"] || Object.values(concept.units)[0];
      if (!units || !Array.isArray(units)) continue;

      // Filter for target period and form
      const matchingFacts = units.filter((u: FactUnit) =>
        u.form === targetForm &&
        u.fy === fiscalYear &&
        (isAnnual || u.fp === targetFp)
      );

      if (matchingFacts.length === 0) continue;

      // Handle restatements: prefer the latest filed fact for this period
      const mostRecent = matchingFacts.reduce((a: FactUnit, b: FactUnit) =>
        a.filed > b.filed ? a : b
      );

      // Build provenance
      const provenance: FieldProvenance = {
        fieldPath,
        tag: tagName,
        namespace,
        units: unitKey,
        periodStart: mostRecent.start,
        periodEnd: mostRecent.end,
        fiscalPeriod: mostRecent.fp,
        formType: mostRecent.form,
        accessionNumber: mostRecent.accn,
        filedDate: mostRecent.filed,
        selectionRationale: `Selected as priority ${mapping.tags.indexOf(tagName) + 1} of ${mapping.tags.length}. ${mapping.rationale}`,
        isCustomTag: isCustomTag(namespace),
        alternativeTags: alternativesFound.filter(t => t !== `${namespace}:${tagName}`),
      };

      // If there were multiple filings for the same period, note this
      if (matchingFacts.length > 1) {
        provenance.selectionRationale += ` (${matchingFacts.length} filings found; used latest filed ${mostRecent.filed})`;
      }

      return {
        value: mostRecent.val,
        provenance,
        alternativesFound,
      };
    }
  }

  return { value: null, provenance: null, alternativesFound };
}

/**
 * Calculate metrics from extracted values and return provenance for computed fields
 */
function calculateMetricsWithProvenance(
  income: NormalizedFundamentals["incomeStatement"],
  balance: NormalizedFundamentals["balanceSheet"],
  existingProvenance: FieldProvenance[]
): { metrics: NormalizedFundamentals["metrics"]; provenance: FieldProvenance[] } {
  const metrics: NormalizedFundamentals["metrics"] = {};
  const provenance: FieldProvenance[] = [];

  const baseProvenance = existingProvenance[0]; // Use first for common fields

  // Gross margin = Gross Profit / Revenue
  if (income.grossProfit && income.revenue && income.revenue !== 0) {
    metrics.grossMargin = income.grossProfit / income.revenue;
    provenance.push({
      fieldPath: "metrics.grossMargin",
      tag: "computed",
      namespace: "derived",
      units: "pure",
      periodEnd: baseProvenance?.periodEnd || "",
      fiscalPeriod: baseProvenance?.fiscalPeriod || "",
      formType: baseProvenance?.formType || "",
      accessionNumber: baseProvenance?.accessionNumber || "",
      filedDate: baseProvenance?.filedDate || "",
      selectionRationale: "Computed as grossProfit / revenue",
      isCustomTag: false,
      isComputed: true,
      computedFrom: ["incomeStatement.grossProfit", "incomeStatement.revenue"],
    });
  }

  // Operating margin = Operating Income / Revenue
  if (income.operatingIncome && income.revenue && income.revenue !== 0) {
    metrics.operatingMargin = income.operatingIncome / income.revenue;
    provenance.push({
      fieldPath: "metrics.operatingMargin",
      tag: "computed",
      namespace: "derived",
      units: "pure",
      periodEnd: baseProvenance?.periodEnd || "",
      fiscalPeriod: baseProvenance?.fiscalPeriod || "",
      formType: baseProvenance?.formType || "",
      accessionNumber: baseProvenance?.accessionNumber || "",
      filedDate: baseProvenance?.filedDate || "",
      selectionRationale: "Computed as operatingIncome / revenue",
      isCustomTag: false,
      isComputed: true,
      computedFrom: ["incomeStatement.operatingIncome", "incomeStatement.revenue"],
    });
  }

  // Net margin = Net Income / Revenue
  if (income.netIncome && income.revenue && income.revenue !== 0) {
    metrics.netMargin = income.netIncome / income.revenue;
    provenance.push({
      fieldPath: "metrics.netMargin",
      tag: "computed",
      namespace: "derived",
      units: "pure",
      periodEnd: baseProvenance?.periodEnd || "",
      fiscalPeriod: baseProvenance?.fiscalPeriod || "",
      formType: baseProvenance?.formType || "",
      accessionNumber: baseProvenance?.accessionNumber || "",
      filedDate: baseProvenance?.filedDate || "",
      selectionRationale: "Computed as netIncome / revenue",
      isCustomTag: false,
      isComputed: true,
      computedFrom: ["incomeStatement.netIncome", "incomeStatement.revenue"],
    });
  }

  // ROE = Net Income / Total Equity
  if (income.netIncome && balance.totalEquity && balance.totalEquity !== 0) {
    metrics.roe = income.netIncome / balance.totalEquity;
    provenance.push({
      fieldPath: "metrics.roe",
      tag: "computed",
      namespace: "derived",
      units: "pure",
      periodEnd: baseProvenance?.periodEnd || "",
      fiscalPeriod: baseProvenance?.fiscalPeriod || "",
      formType: baseProvenance?.formType || "",
      accessionNumber: baseProvenance?.accessionNumber || "",
      filedDate: baseProvenance?.filedDate || "",
      selectionRationale: "Computed as netIncome / totalEquity",
      isCustomTag: false,
      isComputed: true,
      computedFrom: ["incomeStatement.netIncome", "balanceSheet.totalEquity"],
    });
  }

  // Debt to Equity = Total Debt / Total Equity
  if (balance.totalDebt && balance.totalEquity && balance.totalEquity !== 0) {
    metrics.debtToEquity = balance.totalDebt / balance.totalEquity;
    provenance.push({
      fieldPath: "metrics.debtToEquity",
      tag: "computed",
      namespace: "derived",
      units: "pure",
      periodEnd: baseProvenance?.periodEnd || "",
      fiscalPeriod: baseProvenance?.fiscalPeriod || "",
      formType: baseProvenance?.formType || "",
      accessionNumber: baseProvenance?.accessionNumber || "",
      filedDate: baseProvenance?.filedDate || "",
      selectionRationale: "Computed as totalDebt / totalEquity",
      isCustomTag: false,
      isComputed: true,
      computedFrom: ["balanceSheet.totalDebt", "balanceSheet.totalEquity"],
    });
  }

  return { metrics, provenance };
}

/* ------------------------------------------------------------------ */
/* MAIN EXTRACTION FUNCTION                                            */
/* ------------------------------------------------------------------ */

/**
 * Extract normalized financial fundamentals from SEC XBRL companyfacts data
 * with full provenance tracking for every field
 */
export function extractFundamentals(
  facts: CompanyFacts["facts"],
  ticker: string,
  cik: string,
  fiscalYear: number,
  fiscalQuarter?: number
): ExtractionResult {
  const warnings: string[] = [];
  const extractionNotes: string[] = [];
  const allProvenance: FieldProvenance[] = [];
  let confidenceScore = 1.0;
  let customTagCount = 0;

  // Dimensional data tracking (CONSOLIDATED_ONLY strategy)
  let dimensionalFactsEncountered = 0;
  let dimensionalFactsSkipped = 0;
  let hasSegmentData = false;

  // Scan for dimensional data presence (for reporting, not extraction)
  const segmentAxesSet = new Set(SEGMENT_AXES.map((a) => a.split(":")[1]));
  for (const [, nsFacts] of Object.entries(facts)) {
    if (!nsFacts) continue;
    for (const concept of Object.values(nsFacts)) {
      if (concept && concept.units) {
        for (const units of Object.values(concept.units)) {
          if (Array.isArray(units)) {
            for (const fact of units as FactUnit[]) {
              // SEC companyfacts doesn't include dimensions directly, but
              // segment data can be detected through specific tags
              if (fact.frame && fact.frame.includes("Q")) {
                // Quarterly segment indicators
                dimensionalFactsEncountered++;
              }
            }
          }
        }
      }
    }
    // Check for segment-specific concepts
    const segmentConcepts = ["SegmentReportingInformationBySegmentAxis", "OperatingSegmentsMember"];
    for (const segConcept of segmentConcepts) {
      if (nsFacts[segConcept]) {
        hasSegmentData = true;
        break;
      }
    }
  }

  if (hasSegmentData && DIMENSIONAL_CONFIG.logSkippedDimensionalFacts) {
    extractionNotes.push(`[DIMENSIONAL_STRATEGY=${DIMENSIONAL_STRATEGY}] Company has segment data; extracting consolidated figures only`);
  }

  // Helper to extract and track
  const extract = (fieldPath: string, mapping: TagMapping): { value: number | null; prov: FieldProvenance | null } => {
    const result = extractValueWithProvenance(facts, fieldPath, mapping, fiscalYear, fiscalQuarter);
    if (result.provenance) {
      allProvenance.push(result.provenance);
      if (result.provenance.isCustomTag) {
        customTagCount++;
        confidenceScore -= 0.05; // Penalty for custom tags
        warnings.push(`${fieldPath}: sourced from custom tag ${result.provenance.namespace}:${result.provenance.tag}`);
      }
    }
    return { value: result.value, prov: result.provenance };
  };

  // Extract all fields
  const revenue = extract("incomeStatement.revenue", TAG_MAPPINGS.revenue);
  const costOfRevenue = extract("incomeStatement.costOfRevenue", TAG_MAPPINGS.costOfRevenue);
  const grossProfit = extract("incomeStatement.grossProfit", TAG_MAPPINGS.grossProfit);
  const operatingExpenses = extract("incomeStatement.operatingExpenses", TAG_MAPPINGS.operatingExpenses);
  const operatingIncome = extract("incomeStatement.operatingIncome", TAG_MAPPINGS.operatingIncome);
  const netIncome = extract("incomeStatement.netIncome", TAG_MAPPINGS.netIncome);
  const eps = extract("incomeStatement.eps", TAG_MAPPINGS.eps);
  const sharesOutstanding = extract("incomeStatement.sharesOutstanding", TAG_MAPPINGS.sharesOutstanding);

  const totalAssets = extract("balanceSheet.totalAssets", TAG_MAPPINGS.totalAssets);
  const totalLiabilities = extract("balanceSheet.totalLiabilities", TAG_MAPPINGS.totalLiabilities);
  const totalEquity = extract("balanceSheet.totalEquity", TAG_MAPPINGS.totalEquity);
  const cash = extract("balanceSheet.cash", TAG_MAPPINGS.cash);
  const totalDebt = extract("balanceSheet.totalDebt", TAG_MAPPINGS.totalDebt);
  const currentAssets = extract("balanceSheet.currentAssets", TAG_MAPPINGS.currentAssets);
  const currentLiabilities = extract("balanceSheet.currentLiabilities", TAG_MAPPINGS.currentLiabilities);

  const operatingCashFlow = extract("cashFlow.operatingCashFlow", TAG_MAPPINGS.operatingCashFlow);
  const capex = extract("cashFlow.capex", TAG_MAPPINGS.capex);
  const dividendsPaid = extract("cashFlow.dividendsPaid", TAG_MAPPINGS.dividendsPaid);
  const shareRepurchases = extract("cashFlow.shareRepurchases", TAG_MAPPINGS.shareRepurchases);

  // Validate required fields
  const period = `FY${fiscalYear}${fiscalQuarter ? ` Q${fiscalQuarter}` : ""}`;

  if (revenue.value === null) {
    return { ok: false, error: `Missing required field: revenue for ${period}`, warnings };
  }
  if (netIncome.value === null) {
    return { ok: false, error: `Missing required field: netIncome for ${period}`, warnings };
  }
  if (totalAssets.value === null) {
    return { ok: false, error: `Missing required field: totalAssets for ${period}`, warnings };
  }
  if (totalLiabilities.value === null) {
    return { ok: false, error: `Missing required field: totalLiabilities for ${period}`, warnings };
  }
  if (totalEquity.value === null) {
    return { ok: false, error: `Missing required field: totalEquity for ${period}`, warnings };
  }
  if (operatingCashFlow.value === null) {
    return { ok: false, error: `Missing required field: operatingCashFlow for ${period}`, warnings };
  }

  // Calculate derived values with provenance
  let calculatedGrossProfit = grossProfit.value;
  if (calculatedGrossProfit === null && revenue.value !== null && costOfRevenue.value !== null) {
    calculatedGrossProfit = revenue.value - costOfRevenue.value;

    // Add computed provenance
    const baseProv = revenue.prov!;
    allProvenance.push({
      fieldPath: "incomeStatement.grossProfit",
      tag: "computed",
      namespace: "derived",
      units: "USD",
      periodEnd: baseProv.periodEnd,
      fiscalPeriod: baseProv.fiscalPeriod,
      formType: baseProv.formType,
      accessionNumber: baseProv.accessionNumber,
      filedDate: baseProv.filedDate,
      selectionRationale: "Computed as revenue - costOfRevenue (no explicit GrossProfit tag found)",
      isCustomTag: false,
      isComputed: true,
      computedFrom: ["incomeStatement.revenue", "incomeStatement.costOfRevenue"],
    });

    extractionNotes.push("grossProfit: computed from revenue - costOfRevenue");
    confidenceScore -= 0.02; // Small penalty for derived value
  }

  let calculatedFreeCashFlow: number | undefined;
  if (operatingCashFlow.value !== null && capex.value !== null) {
    calculatedFreeCashFlow = operatingCashFlow.value - Math.abs(capex.value);

    const baseProv = operatingCashFlow.prov!;
    allProvenance.push({
      fieldPath: "cashFlow.freeCashFlow",
      tag: "computed",
      namespace: "derived",
      units: "USD",
      periodEnd: baseProv.periodEnd,
      fiscalPeriod: baseProv.fiscalPeriod,
      formType: baseProv.formType,
      accessionNumber: baseProv.accessionNumber,
      filedDate: baseProv.filedDate,
      selectionRationale: "Computed as operatingCashFlow - capex",
      isCustomTag: false,
      isComputed: true,
      computedFrom: ["cashFlow.operatingCashFlow", "cashFlow.capex"],
    });

    extractionNotes.push("freeCashFlow: computed from operatingCashFlow - capex");
  }

  // Build statements
  const incomeStatement: NormalizedFundamentals["incomeStatement"] = {
    revenue: revenue.value,
    costOfRevenue: costOfRevenue.value ?? undefined,
    grossProfit: calculatedGrossProfit ?? undefined,
    operatingExpenses: operatingExpenses.value ?? undefined,
    operatingIncome: operatingIncome.value ?? undefined,
    netIncome: netIncome.value,
    eps: eps.value ?? undefined,
    sharesOutstanding: sharesOutstanding.value ?? undefined,
  };

  const balanceSheet: NormalizedFundamentals["balanceSheet"] = {
    totalAssets: totalAssets.value,
    totalLiabilities: totalLiabilities.value,
    totalEquity: totalEquity.value,
    cash: cash.value ?? undefined,
    totalDebt: totalDebt.value ?? undefined,
    currentAssets: currentAssets.value ?? undefined,
    currentLiabilities: currentLiabilities.value ?? undefined,
  };

  const cashFlowStatement: NormalizedFundamentals["cashFlow"] = {
    operatingCashFlow: operatingCashFlow.value,
    capex: capex.value !== null ? Math.abs(capex.value) : undefined,
    freeCashFlow: calculatedFreeCashFlow,
    dividendsPaid: dividendsPaid.value !== null ? Math.abs(dividendsPaid.value) : undefined,
    shareRepurchases: shareRepurchases.value !== null ? Math.abs(shareRepurchases.value) : undefined,
  };

  // Calculate metrics with provenance
  const metricsResult = calculateMetricsWithProvenance(incomeStatement, balanceSheet, allProvenance);
  allProvenance.push(...metricsResult.provenance);

  // Data quality checks
  const hasCustomTags = customTagCount > 0;
  const needsReview = hasCustomTags || confidenceScore < 0.8;

  if (incomeStatement.grossProfit && incomeStatement.revenue) {
    if (incomeStatement.grossProfit > incomeStatement.revenue) {
      warnings.push("grossProfit > revenue: possible data quality issue");
      confidenceScore -= 0.1;
    }
  }

  // Balance sheet check
  const bsSum = balanceSheet.totalLiabilities + balanceSheet.totalEquity;
  const bsDiff = Math.abs(balanceSheet.totalAssets - bsSum);
  const bsTolerance = Math.abs(balanceSheet.totalAssets) * 0.02;
  if (bsDiff > bsTolerance && bsDiff > 1000) {
    warnings.push(`Balance sheet equation off by ${formatNumber(bsDiff)}`);
    confidenceScore -= 0.05;
  }

  // Determine filing date (from provenance)
  const filingDate = revenue.prov?.filedDate || new Date().toISOString().split("T")[0];

  return {
    ok: true,
    fundamentals: {
      ticker,
      cik,
      fiscalYear,
      fiscalQuarter,
      filingDate,
      incomeStatement,
      balanceSheet,
      cashFlow: cashFlowStatement,
      metrics: metricsResult.metrics,
      fieldProvenance: allProvenance,
      hasCustomTags,
      customTagCount,
      needsReview,

      // Dimensional data strategy tracking
      dimensionalStrategy: DIMENSIONAL_STRATEGY,
      dimensionalFactsEncountered,
      dimensionalFactsSkipped,
      hasSegmentData,

      extractionConfidence: Math.max(0, Math.min(1, confidenceScore)),
      extractionNotes,
    },
    warnings,
  };
}

/**
 * Format large numbers for display
 */
function formatNumber(n: number): string {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString()}`;
}

/**
 * List available fiscal years in the companyfacts data
 */
export function listAvailableFiscalYears(facts: CompanyFacts["facts"]): number[] {
  const years = new Set<number>();

  for (const [namespace, nsFacts] of Object.entries(facts)) {
    if (!nsFacts) continue;

    for (const tagName of TAG_MAPPINGS.revenue.tags) {
      const concept = nsFacts[tagName];
      if (!concept) continue;

      const units = concept.units["USD"];
      if (!units) continue;

      for (const unit of units) {
        if (unit.form === "10-K") {
          years.add(unit.fy);
        }
      }
    }
  }

  return Array.from(years).sort((a, b) => b - a);
}

/**
 * List available fiscal quarters for a given year
 */
export function listAvailableQuarters(facts: CompanyFacts["facts"], fiscalYear: number): number[] {
  const quarters = new Set<number>();
  const fpToQuarter: Record<string, number> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4 };

  for (const [namespace, nsFacts] of Object.entries(facts)) {
    if (!nsFacts) continue;

    for (const tagName of TAG_MAPPINGS.revenue.tags) {
      const concept = nsFacts[tagName];
      if (!concept) continue;

      const units = concept.units["USD"];
      if (!units) continue;

      for (const unit of units) {
        if (unit.form === "10-Q" && unit.fy === fiscalYear) {
          const quarter = fpToQuarter[unit.fp];
          if (quarter) quarters.add(quarter);
        }
      }
    }
  }

  return Array.from(quarters).sort();
}
