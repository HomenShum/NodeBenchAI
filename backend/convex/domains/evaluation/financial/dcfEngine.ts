// convex/domains/evaluation/financial/dcfEngine.ts
// Deterministic DCF Model Engine
//
// Computes enterprise value and equity value from DCF assumptions.
// All calculations are deterministic and auditable.
//
// Methodology:
// 1. Project free cash flows for forecast period
// 2. Calculate terminal value (perpetuity or exit multiple)
// 3. Discount all cash flows to present value
// 4. Sum PV of FCF + PV of Terminal Value = Enterprise Value
// 5. EV - Net Debt + Cash = Equity Value

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import type {
  DcfAssumptions,
  DcfOutputs,
  DcfDetailedOutputs,
  YearlyProjection,
  SensitivityMatrix,
  DcfProvenance,
  YearValue,
  EquityBridge,
  CapitalStructure,
} from "./types";

/* ------------------------------------------------------------------ */
/* CONSTANTS                                                           */
/* ------------------------------------------------------------------ */

const ENGINE_VERSION = "1.0.0";

/* ------------------------------------------------------------------ */
/* UTILITY FUNCTIONS                                                   */
/* ------------------------------------------------------------------ */

/**
 * Get value for a specific year from array, with linear interpolation
 */
function getYearValue(yearValues: YearValue[], year: number, defaultValue?: number): number {
  // Exact match
  const exact = yearValues.find((yv) => yv.year === year);
  if (exact) return exact.value;

  // If array is empty, return default
  if (yearValues.length === 0) {
    return defaultValue ?? 0;
  }

  // Sort by year
  const sorted = [...yearValues].sort((a, b) => a.year - b.year);

  // If before first year, use first value
  if (year < sorted[0].year) {
    return sorted[0].value;
  }

  // If after last year, use last value
  if (year > sorted[sorted.length - 1].year) {
    return sorted[sorted.length - 1].value;
  }

  // Interpolate between two values
  for (let i = 0; i < sorted.length - 1; i++) {
    if (year >= sorted[i].year && year <= sorted[i + 1].year) {
      const t = (year - sorted[i].year) / (sorted[i + 1].year - sorted[i].year);
      return sorted[i].value + t * (sorted[i + 1].value - sorted[i].value);
    }
  }

  return defaultValue ?? sorted[sorted.length - 1].value;
}

/**
 * Get growth rate for a specific year
 */
function getGrowthRate(assumptions: DcfAssumptions, year: number): number {
  const yearOffset = year - assumptions.baseYear;
  if (yearOffset <= 0) return 0;
  if (yearOffset > assumptions.revenue.growthRates.length) {
    // Use terminal growth rate after forecast period
    return assumptions.revenue.terminalGrowthRate;
  }
  return assumptions.revenue.growthRates[yearOffset - 1]?.rate ?? assumptions.revenue.terminalGrowthRate;
}

/**
 * Compute SHA-256 hash of inputs for reproducibility
 */
async function computeInputHash(assumptions: DcfAssumptions): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(assumptions));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* CORE DCF CALCULATION                                                */
/* ------------------------------------------------------------------ */

/**
 * Calculate yearly projections and cash flows
 */
export function calculateYearlyProjections(assumptions: DcfAssumptions): YearlyProjection[] {
  const projections: YearlyProjection[] = [];
  let currentRevenue = assumptions.revenue.baseRevenue;

  for (let i = 1; i <= assumptions.forecastYears; i++) {
    const year = assumptions.baseYear + i;

    // Revenue projection
    const growthRate = getGrowthRate(assumptions, year);
    currentRevenue = currentRevenue * (1 + growthRate);

    // Operating assumptions for this year
    const grossMargin = getYearValue(assumptions.operating.grossMargin, year, 0.5);
    const sgaPercent = getYearValue(assumptions.operating.sgaPercent, year, 0.2);
    const rdPercent = assumptions.operating.rdPercent
      ? getYearValue(assumptions.operating.rdPercent, year, 0)
      : 0;
    const daPercent = getYearValue(assumptions.operating.daPercent, year, 0.05);
    const capexPercent = getYearValue(assumptions.operating.capexPercent, year, 0.05);
    const nwcPercent = getYearValue(assumptions.operating.nwcPercent, year, 0.1);

    // Income statement calculations
    const grossProfit = currentRevenue * grossMargin;
    const sga = currentRevenue * sgaPercent;
    const rd = currentRevenue * rdPercent;
    const depreciation = currentRevenue * daPercent;
    const ebit = grossProfit - sga - rd - depreciation;

    // After-tax operating income (NOPAT)
    const nopat = ebit * (1 - assumptions.wacc.taxRate);

    // Cash flow calculations
    const capex = currentRevenue * capexPercent;

    // NWC change (first year uses full NWC, subsequent years use change)
    let nwcChange: number;
    if (i === 1) {
      // First year: assume NWC builds from 0 to target
      nwcChange = currentRevenue * nwcPercent;
    } else {
      // Subsequent years: change in NWC
      const prevRevenue = projections[i - 2].revenue;
      const prevNwc = prevRevenue * getYearValue(assumptions.operating.nwcPercent, year - 1, nwcPercent);
      const currentNwc = currentRevenue * nwcPercent;
      nwcChange = currentNwc - prevNwc;
    }

    // Free Cash Flow = NOPAT + D&A - CapEx - Change in NWC
    const fcf = nopat + depreciation - capex - nwcChange;

    // Discount factor
    const discountFactor = Math.pow(1 + assumptions.wacc.wacc, i);
    const presentValue = fcf / discountFactor;

    projections.push({
      year,
      revenue: currentRevenue,
      grossProfit,
      ebit,
      nopat,
      depreciation,
      capex,
      nwcChange,
      fcf,
      discountFactor,
      presentValue,
    });
  }

  return projections;
}

/**
 * Calculate terminal value using specified method
 */
export function calculateTerminalValue(
  assumptions: DcfAssumptions,
  terminalFcf: number
): { undiscounted: number; discounted: number } {
  let undiscountedTerminalValue: number;

  if (assumptions.terminal.method === "perpetuity") {
    // Gordon Growth Model: TV = FCF * (1 + g) / (WACC - g)
    const terminalGrowth = assumptions.terminal.perpetuityGrowth ?? assumptions.revenue.terminalGrowthRate;
    undiscountedTerminalValue = (terminalFcf * (1 + terminalGrowth)) / (assumptions.wacc.wacc - terminalGrowth);
  } else {
    // Exit Multiple Method: TV = EBITDA * Multiple
    // For now, approximate EBITDA as FCF + CapEx + NWC change (simplified)
    const exitMultiple = assumptions.terminal.exitMultiple ?? 10;
    undiscountedTerminalValue = terminalFcf * exitMultiple;
  }

  // Discount terminal value to present
  const discountFactor = Math.pow(1 + assumptions.wacc.wacc, assumptions.forecastYears);
  const discountedTerminalValue = undiscountedTerminalValue / discountFactor;

  return {
    undiscounted: undiscountedTerminalValue,
    discounted: discountedTerminalValue,
  };
}

/* ------------------------------------------------------------------ */
/* EQUITY BRIDGE CALCULATION                                           */
/* ------------------------------------------------------------------ */

/**
 * Calculate detailed equity bridge from Enterprise Value to Equity Value
 *
 * Formula: Equity Value = EV - Net Debt - Minority Interest - Preferred + Investments - Pension - Other
 *
 * This provides full transparency on all adjustments made to move from
 * Enterprise Value (value of operating business) to common equity value.
 */
export function calculateEquityBridge(
  enterpriseValue: number,
  capitalStructure?: CapitalStructure
): EquityBridge {
  const missingComponents: string[] = [];

  // Extract capital structure components with defaults
  const totalDebt = capitalStructure?.totalDebt ??
    ((capitalStructure?.shortTermDebt ?? 0) + (capitalStructure?.longTermDebt ?? 0) + (capitalStructure?.capitalLeases ?? 0));

  const cash = capitalStructure?.cash ?? 0;
  const shortTermInvestments = capitalStructure?.shortTermInvestments ?? 0;

  // Calculate net debt (can be provided or computed)
  const netDebt = capitalStructure?.netDebt ??
    (totalDebt - cash - shortTermInvestments);

  // Equity bridge adjustments
  const minorityInterest = capitalStructure?.minorityInterest ?? 0;
  const preferredStock = capitalStructure?.preferredStock ?? 0;
  const investmentsInAssociates = capitalStructure?.investmentsInAssociates ?? 0;
  const pensionLiabilities = capitalStructure?.pensionLiabilities ?? 0;
  const contingentLiabilities = capitalStructure?.contingentLiabilities ?? 0;
  const otherAdjustments = capitalStructure?.otherAdjustments ?? 0;

  // Track missing components for audit trail
  if (!capitalStructure?.totalDebt && !capitalStructure?.shortTermDebt && !capitalStructure?.longTermDebt) {
    missingComponents.push("totalDebt");
  }
  if (!capitalStructure?.cash) missingComponents.push("cash");
  if (!capitalStructure?.minorityInterest) missingComponents.push("minorityInterest");
  if (!capitalStructure?.preferredStock) missingComponents.push("preferredStock");
  if (!capitalStructure?.investmentsInAssociates) missingComponents.push("investmentsInAssociates");
  if (!capitalStructure?.pensionLiabilities) missingComponents.push("pensionLiabilities");

  // Calculate Equity Value
  // EV - Net Debt - Minority Interest - Preferred Stock + Investments - Pension - Contingent - Other
  const equityValue = enterpriseValue
    - netDebt
    - minorityInterest
    - preferredStock
    + investmentsInAssociates
    - pensionLiabilities
    - contingentLiabilities
    - otherAdjustments;

  // Share calculations
  const basicShares = capitalStructure?.currentShares ?? 0;
  const dilutedShares = capitalStructure?.fullyDilutedShares ?? basicShares;

  // Per-share prices
  const impliedPriceBasic = basicShares > 0 ? equityValue / basicShares : 0;
  const impliedPriceDiluted = dilutedShares > 0 ? equityValue / dilutedShares : 0;

  // Bridge completeness check (at minimum need debt, cash, and shares)
  const bridgeComplete = !missingComponents.includes("totalDebt") &&
    !missingComponents.includes("cash") &&
    basicShares > 0;

  return {
    enterpriseValue,
    totalDebt,
    cash,
    shortTermInvestments,
    netDebt,
    minorityInterest,
    preferredStock,
    investmentsInAssociates,
    pensionLiabilities,
    contingentLiabilities,
    otherAdjustments,
    equityValue,
    basicShares,
    dilutedShares,
    impliedPriceBasic,
    impliedPriceDiluted,
    bridgeComplete,
    missingComponents,
    dataAsOfDate: capitalStructure?.balanceSheetDate,
  };
}

/**
 * Main DCF calculation function - deterministic
 *
 * Now includes full equity bridge calculation for EV → Equity Value transformation.
 */
export function calculateDcf(assumptions: DcfAssumptions): DcfDetailedOutputs {
  // Calculate yearly projections
  const projections = calculateYearlyProjections(assumptions);

  // Sum PV of forecast period FCF
  const presentValueFcf = projections.reduce((sum, p) => sum + p.presentValue, 0);

  // Get terminal FCF (last year's FCF)
  const terminalFcf = projections[projections.length - 1].fcf;

  // Calculate terminal value
  const terminalValue = calculateTerminalValue(assumptions, terminalFcf);

  // Enterprise Value = PV of FCF + PV of Terminal Value
  const enterpriseValue = presentValueFcf + terminalValue.discounted;

  // Terminal value as % of EV
  const terminalValuePercent = terminalValue.discounted / enterpriseValue;

  // Calculate full equity bridge
  const equityBridge = calculateEquityBridge(enterpriseValue, assumptions.capitalStructure);

  // Use equity bridge results for primary outputs
  const equityValue = equityBridge.equityValue;

  // Implied share price (from equity bridge, or legacy calculation if no capital structure)
  let impliedSharePrice: number | undefined;
  if (equityBridge.basicShares > 0) {
    // Use diluted shares for implied price if available, accounting for future dilution
    const dilution = assumptions.capitalStructure?.expectedDilution ?? 0;
    const futureShares = (equityBridge.dilutedShares || equityBridge.basicShares) *
      Math.pow(1 + dilution, assumptions.forecastYears);
    impliedSharePrice = equityValue / futureShares;
  }

  return {
    enterpriseValue,
    equityValue,
    impliedSharePrice,
    presentValueFcf,
    terminalValue: terminalValue.discounted,
    terminalValuePercent,
    yearlyProjections: projections,
    terminalFcf,
    undiscountedTerminalValue: terminalValue.undiscounted,
    discountedTerminalValue: terminalValue.discounted,
    equityBridge,
  };
}

/* ------------------------------------------------------------------ */
/* SENSITIVITY ANALYSIS                                                */
/* ------------------------------------------------------------------ */

/**
 * Generate sensitivity matrix for WACC and terminal growth
 */
export function calculateSensitivityMatrix(
  baseAssumptions: DcfAssumptions,
  waccRange: number[],
  terminalGrowthRange: number[]
): SensitivityMatrix {
  const matrix: number[][] = [];

  for (const wacc of waccRange) {
    const row: number[] = [];
    for (const tg of terminalGrowthRange) {
      // Create modified assumptions
      const modifiedAssumptions: DcfAssumptions = {
        ...baseAssumptions,
        wacc: {
          ...baseAssumptions.wacc,
          wacc,
        },
        terminal: {
          ...baseAssumptions.terminal,
          perpetuityGrowth: tg,
        },
        revenue: {
          ...baseAssumptions.revenue,
          terminalGrowthRate: tg,
        },
      };

      // Calculate EV
      const result = calculateDcf(modifiedAssumptions);
      row.push(result.enterpriseValue);
    }
    matrix.push(row);
  }

  return {
    waccRange,
    terminalGrowthRange,
    matrix,
  };
}

/**
 * Generate default sensitivity ranges around base case
 */
export function generateDefaultSensitivityRanges(
  baseWacc: number,
  baseTerminalGrowth: number
): { waccRange: number[]; terminalGrowthRange: number[] } {
  // Generate 5 points around base case (±2%)
  const waccRange = [
    baseWacc - 0.02,
    baseWacc - 0.01,
    baseWacc,
    baseWacc + 0.01,
    baseWacc + 0.02,
  ];

  const terminalGrowthRange = [
    baseTerminalGrowth - 0.01,
    baseTerminalGrowth - 0.005,
    baseTerminalGrowth,
    baseTerminalGrowth + 0.005,
    baseTerminalGrowth + 0.01,
  ];

  return { waccRange, terminalGrowthRange };
}

/* ------------------------------------------------------------------ */
/* SENSITIVITY MATRIX VALIDATION                                       */
/* ------------------------------------------------------------------ */

export interface SensitivityValidationResult {
  isValid: boolean;
  waccMonotonicity: boolean;  // Higher WACC → Lower EV
  growthMonotonicity: boolean; // Higher growth → Higher EV
  violations: string[];
}

/**
 * Validate sensitivity matrix for monotonicity (sanity check)
 * - Higher WACC should result in lower enterprise value
 * - Higher terminal growth should result in higher enterprise value
 */
export function validateSensitivityMatrix(sensitivity: SensitivityMatrix): SensitivityValidationResult {
  const violations: string[] = [];
  let waccMonotonicity = true;
  let growthMonotonicity = true;

  const { waccRange, terminalGrowthRange, matrix } = sensitivity;

  // Check WACC monotonicity (across rows for same growth rate)
  // Higher WACC (lower row index means lower WACC) should mean lower EV
  for (let col = 0; col < terminalGrowthRange.length; col++) {
    for (let row = 0; row < waccRange.length - 1; row++) {
      const currentEv = matrix[row][col];
      const nextEv = matrix[row + 1][col];  // Higher WACC

      if (nextEv >= currentEv) {
        waccMonotonicity = false;
        violations.push(
          `WACC monotonicity violation at growth=${(terminalGrowthRange[col] * 100).toFixed(2)}%: ` +
          `EV at WACC=${(waccRange[row] * 100).toFixed(2)}% (${formatCurrency(currentEv)}) ≤ ` +
          `EV at WACC=${(waccRange[row + 1] * 100).toFixed(2)}% (${formatCurrency(nextEv)})`
        );
      }
    }
  }

  // Check terminal growth monotonicity (across columns for same WACC)
  // Higher growth (higher col index) should mean higher EV
  for (let row = 0; row < waccRange.length; row++) {
    for (let col = 0; col < terminalGrowthRange.length - 1; col++) {
      const currentEv = matrix[row][col];
      const nextEv = matrix[row][col + 1];  // Higher growth

      if (nextEv <= currentEv) {
        growthMonotonicity = false;
        violations.push(
          `Growth monotonicity violation at WACC=${(waccRange[row] * 100).toFixed(2)}%: ` +
          `EV at g=${(terminalGrowthRange[col] * 100).toFixed(2)}% (${formatCurrency(currentEv)}) ≥ ` +
          `EV at g=${(terminalGrowthRange[col + 1] * 100).toFixed(2)}% (${formatCurrency(nextEv)})`
        );
      }
    }
  }

  // Check for invalid values (negative, NaN, Infinity)
  for (let row = 0; row < matrix.length; row++) {
    for (let col = 0; col < matrix[row].length; col++) {
      const ev = matrix[row][col];
      if (isNaN(ev) || !isFinite(ev)) {
        violations.push(
          `Invalid EV value at WACC=${(waccRange[row] * 100).toFixed(2)}%, ` +
          `g=${(terminalGrowthRange[col] * 100).toFixed(2)}%: ${ev}`
        );
      }
      // Check for WACC < terminal growth (perpetuity formula breaks)
      if (waccRange[row] <= terminalGrowthRange[col]) {
        violations.push(
          `WACC (${(waccRange[row] * 100).toFixed(2)}%) ≤ terminal growth ` +
          `(${(terminalGrowthRange[col] * 100).toFixed(2)}%): perpetuity formula invalid`
        );
      }
    }
  }

  return {
    isValid: waccMonotonicity && growthMonotonicity && violations.length === 0,
    waccMonotonicity,
    growthMonotonicity,
    violations,
  };
}

/**
 * Format currency for display
 */
function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toLocaleString()}`;
}

/* ------------------------------------------------------------------ */
/* WACC CALCULATION                                                    */
/* ------------------------------------------------------------------ */

/**
 * Calculate WACC from components
 */
export function calculateWacc(
  costOfEquity: number,
  costOfDebt: number,
  taxRate: number,
  debtWeight: number,
  equityWeight: number
): number {
  // WACC = (E/V * Re) + (D/V * Rd * (1 - T))
  const afterTaxCostOfDebt = costOfDebt * (1 - taxRate);
  return (equityWeight * costOfEquity) + (debtWeight * afterTaxCostOfDebt);
}

/**
 * Calculate Cost of Equity using CAPM
 */
export function calculateCostOfEquity(
  riskFreeRate: number,
  marketRiskPremium: number,
  beta: number
): number {
  // Re = Rf + β * (Rm - Rf)
  return riskFreeRate + (beta * marketRiskPremium);
}

/* ------------------------------------------------------------------ */
/* CONVEX FUNCTIONS                                                    */
/* ------------------------------------------------------------------ */

/**
 * Run DCF calculation and store results
 */
export const runDcfCalculation = internalAction({
  args: {
    entityKey: v.string(),
    assumptions: v.any(),  // DcfAssumptions
    origin: v.union(v.literal("ai_generated"), v.literal("analyst"), v.literal("hybrid")),
    authorId: v.optional(v.id("users")),
    runId: v.optional(v.id("agentRuns")),
    citationArtifactIds: v.optional(v.array(v.id("sourceArtifacts"))),
  },
  returns: v.object({
    ok: v.boolean(),
    modelId: v.optional(v.string()),
    dcfModelDbId: v.optional(v.id("dcfModels")),
    outputs: v.optional(v.any()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      const assumptions = args.assumptions as DcfAssumptions;

      // Validate assumptions
      if (!assumptions.forecastYears || assumptions.forecastYears < 1) {
        return { ok: false, error: "Invalid forecast years" };
      }
      if (!assumptions.revenue?.baseRevenue || assumptions.revenue.baseRevenue <= 0) {
        return { ok: false, error: "Invalid base revenue" };
      }
      if (!assumptions.wacc?.wacc || assumptions.wacc.wacc <= 0) {
        return { ok: false, error: "Invalid WACC" };
      }

      // Calculate DCF
      const outputs = calculateDcf(assumptions);

      // Calculate sensitivity matrix
      const { waccRange, terminalGrowthRange } = generateDefaultSensitivityRanges(
        assumptions.wacc.wacc,
        assumptions.terminal.perpetuityGrowth ?? assumptions.revenue.terminalGrowthRate
      );
      const sensitivity = calculateSensitivityMatrix(assumptions, waccRange, terminalGrowthRange);

      // Generate model ID
      const inputHash = await computeInputHash(assumptions);
      const modelId = `dcf_${args.entityKey}_${Date.now()}_${inputHash}`;

      // Store inputs as artifact
      const inputsArtifact = await ctx.runMutation(
        internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact,
        {
          sourceType: "api_response",
          sourceUrl: `dcf://models/${modelId}/inputs`,
          rawContent: JSON.stringify(assumptions),
          extractedData: {
            type: "dcf_inputs",
            entityKey: args.entityKey,
            modelId,
            baseYear: assumptions.baseYear,
            forecastYears: assumptions.forecastYears,
          },
        }
      );

      // Store outputs as artifact
      const outputsArtifact = await ctx.runMutation(
        internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact,
        {
          sourceType: "api_response",
          sourceUrl: `dcf://models/${modelId}/outputs`,
          rawContent: JSON.stringify(outputs),
          extractedData: {
            type: "dcf_outputs",
            entityKey: args.entityKey,
            modelId,
            enterpriseValue: outputs.enterpriseValue,
            equityValue: outputs.equityValue,
          },
        }
      );

      // Get next version number
      const existingModels = await ctx.runQuery(
        internal.domains.evaluation.financial.dcfEngine.getModelsByEntity,
        { entityKey: args.entityKey }
      );
      const version = existingModels.length + 1;

      // Store DCF model
      const dcfModelDbId = await ctx.runMutation(
        internal.domains.evaluation.financial.dcfEngine.createDcfModel,
        {
          modelId,
          entityKey: args.entityKey,
          version,
          origin: args.origin,
          authorId: args.authorId,
          runId: args.runId,
          inputsArtifactId: inputsArtifact.id,
          assumptions,
          outputsArtifactId: outputsArtifact.id,
          outputs: {
            enterpriseValue: outputs.enterpriseValue,
            equityValue: outputs.equityValue,
            impliedSharePrice: outputs.impliedSharePrice,
            presentValueFcf: outputs.presentValueFcf,
            terminalValue: outputs.terminalValue,
            terminalValuePercent: outputs.terminalValuePercent,
          },
          sensitivity,
          citationArtifactIds: args.citationArtifactIds ?? [],
        }
      );

      return {
        ok: true,
        modelId,
        dcfModelDbId,
        outputs: {
          enterpriseValue: outputs.enterpriseValue,
          equityValue: outputs.equityValue,
          impliedSharePrice: outputs.impliedSharePrice,
          presentValueFcf: outputs.presentValueFcf,
          terminalValue: outputs.terminalValue,
          terminalValuePercent: outputs.terminalValuePercent,
        },
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
 * Create DCF model record
 */
export const createDcfModel = internalMutation({
  args: {
    modelId: v.string(),
    entityKey: v.string(),
    version: v.number(),
    origin: v.union(v.literal("ai_generated"), v.literal("analyst"), v.literal("hybrid")),
    authorId: v.optional(v.id("users")),
    runId: v.optional(v.id("agentRuns")),
    inputsArtifactId: v.id("sourceArtifacts"),
    assumptions: v.any(),
    outputsArtifactId: v.id("sourceArtifacts"),
    outputs: v.object({
      enterpriseValue: v.number(),
      equityValue: v.number(),
      impliedSharePrice: v.optional(v.number()),
      presentValueFcf: v.number(),
      terminalValue: v.number(),
      terminalValuePercent: v.number(),
    }),
    sensitivity: v.optional(v.object({
      waccRange: v.array(v.number()),
      terminalGrowthRange: v.array(v.number()),
      matrix: v.array(v.array(v.number())),
    })),
    citationArtifactIds: v.array(v.id("sourceArtifacts")),
  },
  returns: v.id("dcfModels"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("dcfModels", {
      modelId: args.modelId,
      entityKey: args.entityKey,
      version: args.version,
      origin: args.origin,
      authorId: args.authorId,
      runId: args.runId,
      inputsArtifactId: args.inputsArtifactId,
      assumptions: args.assumptions,
      outputsArtifactId: args.outputsArtifactId,
      outputs: args.outputs,
      sensitivity: args.sensitivity,
      citationArtifactIds: args.citationArtifactIds,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Get all DCF models for an entity
 */
export const getModelsByEntity = internalQuery({
  args: {
    entityKey: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("dcfModels"),
      modelId: v.string(),
      version: v.number(),
      origin: v.string(),
      enterpriseValue: v.number(),
      equityValue: v.number(),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const models = await ctx.db
      .query("dcfModels")
      .withIndex("by_entity_version", (q) => q.eq("entityKey", args.entityKey))
      .collect();

    return models.map((m) => ({
      _id: m._id,
      modelId: m.modelId,
      version: m.version,
      origin: m.origin,
      enterpriseValue: m.outputs.enterpriseValue,
      equityValue: m.outputs.equityValue,
      createdAt: m.createdAt,
    }));
  },
});

/**
 * Get DCF model by ID
 */
export const getDcfModel = internalQuery({
  args: {
    modelId: v.id("dcfModels"),
  },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.modelId);
  },
});

/**
 * Get latest DCF model for an entity
 */
export const getLatestModel = internalQuery({
  args: {
    entityKey: v.string(),
  },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const models = await ctx.db
      .query("dcfModels")
      .withIndex("by_entity_version", (q) => q.eq("entityKey", args.entityKey))
      .order("desc")
      .first();

    return models;
  },
});
