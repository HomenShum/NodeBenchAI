/**
 * dcfModel.ts — DCF + Reverse DCF valuation for Pipeline v2.
 *
 * Standard DCF: project FCF → discount to present → intrinsic value
 * Reverse DCF: given market valuation → solve for implied growth rate
 *
 * Designed for the banker and investor lenses. Uses real metrics
 * extracted by Gemini from Linkup search results.
 *
 * References:
 * - Wall Street Prep DCF: https://www.wallstreetprep.com/knowledge/dcf-model-training-6-steps-building-dcf-model-excel/
 * - Reverse DCF: https://www.wallstreetprep.com/knowledge/reverse-dcf-model/
 * - Startup DCF: https://www.phoenixstrategy.group/blog/dcf-for-startups-vs-mature-companies
 */

// ─── Types ───────────────────────────────────────────────────────

export interface DCFInput {
  /** Current annual revenue (or ARR) in USD */
  revenue: number;
  /** Revenue growth rate assumption (0.0-1.0, e.g., 0.40 = 40%) */
  growthRate: number;
  /** FCF margin assumption (0.0-1.0, e.g., 0.15 = 15%) */
  fcfMargin: number;
  /** Discount rate / WACC (0.0-1.0, e.g., 0.12 = 12%) */
  discountRate: number;
  /** Terminal growth rate (0.0-0.05, e.g., 0.03 = 3%) */
  terminalGrowthRate: number;
  /** Projection years (typically 5-10) */
  projectionYears: number;
}

export interface DCFResult {
  /** Intrinsic enterprise value */
  enterpriseValue: number;
  /** Per-year projected FCF */
  projectedFCF: number[];
  /** Per-year discounted FCF */
  discountedFCF: number[];
  /** Terminal value (undiscounted) */
  terminalValue: number;
  /** Discounted terminal value */
  discountedTerminalValue: number;
  /** Sum of discounted FCFs */
  pvOfFCFs: number;
  /** Formatted summary */
  summary: string;
}

export interface ReverseDCFInput {
  /** Current market valuation / enterprise value */
  marketValue: number;
  /** Current annual revenue */
  revenue: number;
  /** FCF margin assumption */
  fcfMargin: number;
  /** Discount rate / WACC */
  discountRate: number;
  /** Terminal growth rate */
  terminalGrowthRate: number;
  /** Projection years */
  projectionYears: number;
}

export interface ReverseDCFResult {
  /** Implied annual growth rate that justifies the market value */
  impliedGrowthRate: number;
  /** Whether the implied growth seems reasonable */
  assessment: "undervalued" | "fairly_valued" | "overvalued" | "aggressive";
  /** Human-readable explanation */
  explanation: string;
  /** The DCF result at the implied growth rate */
  dcfAtImpliedRate: DCFResult;
}

// ─── Standard DCF ────────────────────────────────────────────────

export function runDCF(input: DCFInput): DCFResult {
  const { revenue, growthRate, fcfMargin, discountRate, terminalGrowthRate, projectionYears } = input;

  const projectedFCF: number[] = [];
  const discountedFCF: number[] = [];
  let currentRevenue = revenue;

  for (let year = 1; year <= projectionYears; year++) {
    currentRevenue *= (1 + growthRate);
    const fcf = currentRevenue * fcfMargin;
    const discountFactor = Math.pow(1 + discountRate, year);
    projectedFCF.push(Math.round(fcf));
    discountedFCF.push(Math.round(fcf / discountFactor));
  }

  // Terminal value (Gordon Growth Model)
  const terminalFCF = projectedFCF[projectedFCF.length - 1] * (1 + terminalGrowthRate);
  const terminalValue = terminalFCF / (discountRate - terminalGrowthRate);
  const discountedTerminalValue = terminalValue / Math.pow(1 + discountRate, projectionYears);

  const pvOfFCFs = discountedFCF.reduce((a, b) => a + b, 0);
  const enterpriseValue = pvOfFCFs + discountedTerminalValue;

  const evInB = (enterpriseValue / 1e9).toFixed(1);
  const revInB = (revenue / 1e9).toFixed(1);

  return {
    enterpriseValue: Math.round(enterpriseValue),
    projectedFCF,
    discountedFCF,
    terminalValue: Math.round(terminalValue),
    discountedTerminalValue: Math.round(discountedTerminalValue),
    pvOfFCFs: Math.round(pvOfFCFs),
    summary: `DCF valuation: $${evInB}B (${projectionYears}yr, ${(growthRate * 100).toFixed(0)}% growth, ${(fcfMargin * 100).toFixed(0)}% FCF margin, ${(discountRate * 100).toFixed(0)}% WACC on $${revInB}B revenue)`,
  };
}

// ─── Reverse DCF ─────────────────────────────────────────────────

export function runReverseDCF(input: ReverseDCFInput): ReverseDCFResult {
  const { marketValue, revenue, fcfMargin, discountRate, terminalGrowthRate, projectionYears } = input;

  // Binary search for the growth rate that produces the market value
  let lo = -0.20; // -20% (declining)
  let hi = 2.00;  // 200% (hypergrowth)
  let impliedGrowthRate = 0;
  let bestDCF: DCFResult | null = null;

  for (let iter = 0; iter < 50; iter++) {
    const mid = (lo + hi) / 2;
    const dcf = runDCF({
      revenue,
      growthRate: mid,
      fcfMargin,
      discountRate,
      terminalGrowthRate,
      projectionYears,
    });

    bestDCF = dcf;
    impliedGrowthRate = mid;

    if (Math.abs(dcf.enterpriseValue - marketValue) < marketValue * 0.01) {
      break; // Within 1% — close enough
    }

    if (dcf.enterpriseValue < marketValue) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // Assess the implied growth rate
  const pct = impliedGrowthRate * 100;
  let assessment: ReverseDCFResult["assessment"];
  let explanation: string;

  if (pct < 10) {
    assessment = "undervalued";
    explanation = `Market implies only ${pct.toFixed(0)}% annual growth — below typical inflation-adjusted expectations. The company may be undervalued if it can grow faster.`;
  } else if (pct < 30) {
    assessment = "fairly_valued";
    explanation = `Market implies ${pct.toFixed(0)}% annual growth — reasonable for a growth-stage company. Valuation appears fair if growth materializes.`;
  } else if (pct < 60) {
    assessment = "overvalued";
    explanation = `Market implies ${pct.toFixed(0)}% annual growth — aggressive but achievable for high-growth tech. Significant execution risk baked in.`;
  } else {
    assessment = "aggressive";
    explanation = `Market implies ${pct.toFixed(0)}% annual growth — extremely aggressive. Requires exceptional execution and market expansion to justify.`;
  }

  return {
    impliedGrowthRate: Math.round(impliedGrowthRate * 1000) / 1000,
    assessment,
    explanation,
    dcfAtImpliedRate: bestDCF!,
  };
}

// ─── Extract metrics from search result for DCF ──────────────────

/**
 * Fetch revenue from SEC EDGAR as fallback when Linkup/Gemini don't provide it.
 * Only works for US public companies. Free, no API key.
 */
export async function enrichDCFWithEdgar(
  entityName: string,
  dcfInputs: { canRunDCF: boolean; dcfInput?: DCFInput; reverseDCFInput?: ReverseDCFInput; reason?: string },
): Promise<typeof dcfInputs> {
  // Only try EDGAR if we couldn't extract revenue from search results
  if (dcfInputs.canRunDCF) return dcfInputs;

  try {
    const { fetchEdgarFinancials } = await import("./secEdgar.js");
    const edgar = await fetchEdgarFinancials(entityName);
    if (!edgar?.revenue) return dcfInputs;

    return {
      canRunDCF: true,
      dcfInput: {
        revenue: edgar.revenue,
        growthRate: 0.25,
        fcfMargin: 0.12,
        discountRate: 0.10,
        terminalGrowthRate: 0.03,
        projectionYears: 5,
      },
      // No reverse DCF without market cap from EDGAR (would need a separate source)
    };
  } catch {
    return dcfInputs;
  }
}

export function extractDCFInputs(result: {
  entityName: string;
  answer: string;
  keyMetrics: Array<{ label: string; value: string }>;
  signals: any[];
}): { canRunDCF: boolean; dcfInput?: DCFInput; reverseDCFInput?: ReverseDCFInput; reason?: string } {
  // Try to extract revenue and valuation from key metrics first (most reliable),
  // then fall back to text extraction from answer + signals
  const text = [
    result.answer,
    ...result.keyMetrics.map(m => `${m.label}: ${m.value}`),
    ...result.signals.map((s: any) => s.name ?? ""),
  ].join(" ");

  // Direct metric extraction: check keyMetrics for labeled values
  let revenue: number | null = null;
  let valuation: number | null = null;

  for (const m of result.keyMetrics) {
    const label = m.label.toLowerCase();
    const val = parseDollarValue(m.value);
    if (val && !revenue && (label.includes("revenue") || label.includes("arr") || label === "mrr")) {
      revenue = label === "mrr" ? val * 12 : val;
    }
    if (val && !valuation && (label.includes("valuation") || label.includes("market cap"))) {
      valuation = val;
    }
  }

  // Text extraction fallback
  if (!revenue) {
    revenue = extractDollarAmount(text, [
      "revenue", "arr", "annual revenue", "annualized revenue",
      "revenue of", "arr of", "revenue run rate", "annual run rate",
      "revenue reaching", "revenue surpass", "revenue hit",
      "generating", "earned", "brought in",
    ]);
  }
  if (!valuation) {
    valuation = extractDollarAmount(text, [
      "valuation", "valued at", "market cap", "worth",
      "valuation of", "valued", "market capitalization",
      "valuation reaching", "valuation hit", "valued around",
    ]);
  }

  if (!revenue) {
    return { canRunDCF: false, reason: "No revenue data found in search results" };
  }

  // Default assumptions for tech/AI companies
  const dcfInput: DCFInput = {
    revenue,
    growthRate: 0.30,      // 30% default for growth tech
    fcfMargin: 0.15,       // 15% FCF margin
    discountRate: 0.12,    // 12% WACC
    terminalGrowthRate: 0.03, // 3% terminal
    projectionYears: 5,
  };

  const result_obj: { canRunDCF: boolean; dcfInput: DCFInput; reverseDCFInput?: ReverseDCFInput } = {
    canRunDCF: true,
    dcfInput,
  };

  if (valuation) {
    result_obj.reverseDCFInput = {
      marketValue: valuation,
      revenue,
      fcfMargin: 0.15,
      discountRate: 0.12,
      terminalGrowthRate: 0.03,
      projectionYears: 5,
    };
  }

  return result_obj;
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Parse a dollar string like "$2B", "$500M", "$2.5 billion" into a number */
function parseDollarValue(value: string): number | null {
  const match = value.match(/\$?([\d,.]+)\s*(billion|B|million|M|trillion|T)?/i);
  if (!match) return null;
  const num = parseFloat(match[1].replace(/,/g, ""));
  if (isNaN(num)) return null;
  const unit = (match[2] ?? "").toLowerCase();
  if (unit === "trillion" || unit === "t") return num * 1e12;
  if (unit === "billion" || unit === "b") return num * 1e9;
  if (unit === "million" || unit === "m") return num * 1e6;
  if (num > 1e6) return num; // Already in raw dollars
  return null;
}

function extractDollarAmount(text: string, keywords: string[]): number | null {
  for (const kw of keywords) {
    // Match keyword near dollar amount. Reverse patterns ($ before keyword) are
    // more reliable because "$2B in annual revenue" keeps the amount closest to
    // its semantic owner. Forward patterns risk crossing into adjacent clauses.
    const patterns = [
      // Reverse: $X ... keyword (most reliable — "$2B in annual revenue")
      new RegExp(`\\$([\\d,.]+)\\s*(billion|B)[^.]{0,15}${kw}`, "i"),
      new RegExp(`\\$([\\d,.]+)\\s*(million|M)[^.]{0,15}${kw}`, "i"),
      // Forward: keyword ... $X (tight — "valued at $30B", max 10 chars gap)
      new RegExp(`${kw}[^.$,]{0,10}\\$([\\d,.]+)\\s*(billion|B)`, "i"),
      new RegExp(`${kw}[^.$,]{0,10}\\$([\\d,.]+)\\s*(million|M)`, "i"),
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const num = parseFloat(match[1].replace(/,/g, ""));
        const unit = match[2].toLowerCase();
        if (unit === "billion" || unit === "b") return num * 1e9;
        if (unit === "million" || unit === "m") return num * 1e6;
      }
    }
  }
  return null;
}
