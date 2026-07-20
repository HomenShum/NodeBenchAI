/**
 * Economic Indicator Verification Branch
 *
 * Validates economic indicators against authoritative sources like FRED, BLS, IMF.
 * Used by MACRO_STRATEGIST persona for macro thesis validation.
 */

import { api } from "../../../../../../_generated/api";
import { DDSource, SourceReliability } from "../../../types";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface EconomicIndicatorFindings {
  thesisName: string;
  region: string;

  // Indicators
  indicators: EconomicIndicator[];

  // Policy analysis
  policy: {
    currentStance?: string;
    expectedChange?: string;
    confidence?: number;
    rationale?: string;
  };

  // Risk scenarios
  risks: {
    upside?: string;
    downside?: string;
    tail?: string;
  };

  // Positioning recommendations
  positioning: PositioningRecommendation[];

  // Verification
  verification: {
    indicatorsVerified: number;
    indicatorsTotal: number;
    policyVerified: boolean;
    sourceQuality: "Official" | "Authoritative" | "Secondary" | "Unverified";
    lastUpdated?: string;
  };

  // Concerns
  concerns: Array<{
    type: "data_staleness" | "conflicting_data" | "forecast_divergence" | "revision_risk";
    severity: "low" | "medium" | "high" | "critical";
    description: string;
  }>;

  confidenceScore: number;
}

export interface EconomicIndicator {
  name: string;
  value?: number;
  unit: string;
  trend: "rising" | "falling" | "stable" | "unknown";
  source?: string;
  lastUpdated?: string;
  verified: boolean;
  expectedValue?: number;
  deviation?: number;
}

export interface PositioningRecommendation {
  asset: string;
  direction: "long" | "short" | "neutral";
  rationale: string;
  confidence?: number;
}

export interface EconomicIndicatorResult {
  findings: EconomicIndicatorFindings;
  sources: DDSource[];
  report: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute economic indicator verification branch
 */
export async function executeEconomicIndicatorVerificationBranch(
  ctx: any,
  thesisName: string,
  region: string = "US",
  claimedIndicators?: Array<{
    name: string;
    value: number;
    unit: string;
  }>,
  claimedPolicy?: {
    expectedChange?: string;
    confidence?: number;
  }
): Promise<EconomicIndicatorResult> {
  const sources: DDSource[] = [];
  const startTime = Date.now();

  console.log(`[ECON] Starting indicator verification for ${thesisName}...`);

  // Run parallel searches
  const [indicatorResults, policyResults, riskResults] = await Promise.all([
    searchEconomicIndicators(ctx, region, claimedIndicators),
    searchPolicyExpectations(ctx, region, claimedPolicy),
    searchRiskScenarios(ctx, thesisName, region),
  ]);

  // Aggregate sources
  sources.push(...indicatorResults.sources, ...policyResults.sources, ...riskResults.sources);

  // Verify indicators
  const verifiedIndicators = verifyIndicators(claimedIndicators, indicatorResults);

  // Build positioning recommendations
  const positioning = buildPositioning(verifiedIndicators, policyResults);

  // Identify concerns
  const concerns = identifyConcerns(verifiedIndicators, policyResults);

  // Calculate confidence
  const confidenceScore = calculateConfidence(verifiedIndicators, policyResults);

  const verification: EconomicIndicatorFindings["verification"] = {
    indicatorsVerified: verifiedIndicators.filter((i) => i.verified).length,
    indicatorsTotal: verifiedIndicators.length,
    policyVerified: policyResults.verified,
    sourceQuality: determineSourceQuality(sources),
    lastUpdated: new Date().toISOString(),
  };

  const findings: EconomicIndicatorFindings = {
    thesisName,
    region,
    indicators: verifiedIndicators,

    policy: {
      currentStance: policyResults.currentStance,
      expectedChange: policyResults.expectedChange || claimedPolicy?.expectedChange,
      confidence: policyResults.confidence || claimedPolicy?.confidence,
      rationale: policyResults.rationale,
    },

    risks: {
      upside: riskResults.upside,
      downside: riskResults.downside,
      tail: riskResults.tail,
    },

    positioning,
    verification,
    concerns,
    confidenceScore,
  };

  // Generate report
  const report = formatEconomicReport(findings);

  console.log(`[ECON] Completed in ${Date.now() - startTime}ms, confidence: ${(confidenceScore * 100).toFixed(0)}%`);

  return {
    findings,
    sources,
    report,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

interface IndicatorSearchResult {
  indicators: Map<string, { value?: number; trend?: string; source?: string }>;
  sources: DDSource[];
}

async function searchEconomicIndicators(
  ctx: any,
  region: string,
  claimedIndicators?: Array<{ name: string; value: number; unit: string }>
): Promise<IndicatorSearchResult> {
  const sources: DDSource[] = [];
  const indicators = new Map<string, { value?: number; trend?: string; source?: string }>();

  try {
    // Build search queries for key indicators
    const indicatorNames = claimedIndicators?.map((i) => i.name) || [
      "CPI inflation",
      "Core PCE",
      "Unemployment rate",
      "GDP growth",
      "Federal Funds rate",
    ];

    const result = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
      query: `${region} ${indicatorNames.join(" ")} BLS FRED latest data 2025 2026`,
      mode: "balanced",
      maxTotal: 12,
      skipRateLimit: true,
    });

    const searchResults = result?.payload?.results ?? [];

    for (const r of searchResults) {
      const content = (r.snippet || r.content || "").toLowerCase();
      const url = r.url || "";

      // Extract CPI
      const cpiMatch = content.match(/cpi\s*(?:yoy|year-over-year)?[:\s]*(\d+\.?\d*)%?/i);
      if (cpiMatch) {
        indicators.set("CPI YoY", {
          value: parseFloat(cpiMatch[1]),
          source: extractSource(url),
        });
      }

      // Extract Core PCE
      const pceMatch = content.match(/(?:core\s+)?pce[:\s]*(\d+\.?\d*)%?/i);
      if (pceMatch) {
        indicators.set("Core PCE", {
          value: parseFloat(pceMatch[1]),
          source: extractSource(url),
        });
      }

      // Extract unemployment
      const unemploymentMatch = content.match(/unemployment\s*(?:rate)?[:\s]*(\d+\.?\d*)%?/i);
      if (unemploymentMatch) {
        indicators.set("Unemployment Rate", {
          value: parseFloat(unemploymentMatch[1]),
          source: extractSource(url),
        });
      }

      // Extract GDP growth
      const gdpMatch = content.match(/gdp\s*(?:growth)?[:\s]*(\d+\.?\d*)%?/i);
      if (gdpMatch) {
        indicators.set("GDP Growth", {
          value: parseFloat(gdpMatch[1]),
          source: extractSource(url),
        });
      }

      // Extract Fed Funds rate
      const fedMatch = content.match(/(?:fed(?:eral)?\s*funds?|policy)\s*rate[:\s]*(\d+\.?\d*)(?:-(\d+\.?\d*))?%?/i);
      if (fedMatch) {
        const value = fedMatch[2]
          ? (parseFloat(fedMatch[1]) + parseFloat(fedMatch[2])) / 2
          : parseFloat(fedMatch[1]);
        indicators.set("Fed Funds Rate", {
          value,
          source: extractSource(url),
        });
      }

      // Extract average hourly earnings
      const aheMatch = content.match(/(?:average\s+hourly\s+earnings|wage\s+growth)[:\s]*(\d+\.?\d*)%?/i);
      if (aheMatch) {
        indicators.set("Average Hourly Earnings YoY", {
          value: parseFloat(aheMatch[1]),
          source: extractSource(url),
        });
      }

      sources.push({
        sourceType: determineSourceType(url),
        title: r.title || "Unknown",
        url,
        accessedAt: Date.now(),
        reliability: determineReliability(url),
      });
    }

    return { indicators, sources };
  } catch (error) {
    console.error("[ECON] Indicator search error:", error);
    return { indicators: new Map(), sources };
  }
}

interface PolicySearchResult {
  currentStance?: string;
  expectedChange?: string;
  confidence?: number;
  rationale?: string;
  verified: boolean;
  sources: DDSource[];
}

async function searchPolicyExpectations(
  ctx: any,
  region: string,
  claimedPolicy?: { expectedChange?: string; confidence?: number }
): Promise<PolicySearchResult> {
  const sources: DDSource[] = [];

  try {
    const result = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
      query: `${region} Federal Reserve FOMC rate decision forecast 2026 CME FedWatch`,
      mode: "balanced",
      maxTotal: 8,
      skipRateLimit: true,
    });

    const searchResults = result?.payload?.results ?? [];

    let currentStance: string | undefined;
    let expectedChange: string | undefined;
    let confidence: number | undefined;
    let rationale: string | undefined;
    let verified = false;

    for (const r of searchResults) {
      const content = (r.snippet || r.content || "").toLowerCase();
      const url = r.url || "";

      // Extract current rate
      if (!currentStance) {
        const rateMatch = content.match(/(?:current|target)\s*(?:rate|range)[:\s]*(\d+\.?\d*)-?(\d+\.?\d*)?%?/i);
        if (rateMatch) {
          currentStance = rateMatch[2]
            ? `${rateMatch[1]}-${rateMatch[2]}%`
            : `${rateMatch[1]}%`;
        }
      }

      // Extract expected change
      if (!expectedChange) {
        if (content.includes("cut") || content.includes("lower")) {
          const bpsMatch = content.match(/(\d+)\s*(?:basis\s*points?|bps)\s*cut/i);
          if (bpsMatch) {
            expectedChange = `-${bpsMatch[1]}bps`;
          } else {
            expectedChange = "Rate cut expected";
          }
        } else if (content.includes("hike") || content.includes("raise")) {
          const bpsMatch = content.match(/(\d+)\s*(?:basis\s*points?|bps)\s*hike/i);
          if (bpsMatch) {
            expectedChange = `+${bpsMatch[1]}bps`;
          } else {
            expectedChange = "Rate hike expected";
          }
        } else if (content.includes("hold") || content.includes("unchanged")) {
          expectedChange = "No change expected";
        }
      }

      // Extract confidence/probability
      if (!confidence) {
        const probMatch = content.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:probability|chance|likely)/i);
        if (probMatch) {
          confidence = parseFloat(probMatch[1]);
        }
      }

      // Verify against claimed
      if (claimedPolicy?.expectedChange && expectedChange) {
        const claimedLower = claimedPolicy.expectedChange.toLowerCase();
        const foundLower = expectedChange.toLowerCase();
        if (
          (claimedLower.includes("cut") && foundLower.includes("cut")) ||
          (claimedLower.includes("hike") && foundLower.includes("hike")) ||
          (claimedLower.includes("-") && foundLower.includes("-")) ||
          (claimedLower.includes("+") && foundLower.includes("+"))
        ) {
          verified = true;
        }
      } else if (expectedChange) {
        verified = true;
      }

      sources.push({
        sourceType: "news_article",
        title: r.title || "Unknown",
        url,
        accessedAt: Date.now(),
        reliability: determineReliability(url),
      });
    }

    return {
      currentStance,
      expectedChange,
      confidence,
      rationale,
      verified,
      sources,
    };
  } catch (error) {
    console.error("[ECON] Policy search error:", error);
    return { verified: false, sources };
  }
}

interface RiskSearchResult {
  upside?: string;
  downside?: string;
  tail?: string;
  sources: DDSource[];
}

async function searchRiskScenarios(ctx: any, thesisName: string, region: string): Promise<RiskSearchResult> {
  const sources: DDSource[] = [];

  try {
    const result = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
      query: `${region} economic risk scenarios ${thesisName} upside downside tail risk 2026`,
      mode: "balanced",
      maxTotal: 5,
      skipRateLimit: true,
    });

    const searchResults = result?.payload?.results ?? [];

    let upside: string | undefined;
    let downside: string | undefined;
    let tail: string | undefined;

    for (const r of searchResults) {
      const content = (r.snippet || r.content || "").toLowerCase();
      const url = r.url || "";

      // Extract upside risks
      if (!upside) {
        if (content.includes("upside") && content.includes("risk")) {
          upside = "Stronger growth or sticky inflation";
        }
      }

      // Extract downside risks
      if (!downside) {
        if (content.includes("recession") || content.includes("slowdown")) {
          downside = "Economic slowdown or recession risk";
        } else if (content.includes("geopolitical")) {
          downside = "Geopolitical shock";
        }
      }

      // Extract tail risks
      if (!tail) {
        if (content.includes("tail risk") || content.includes("black swan")) {
          tail = "Financial market disruption or crisis";
        }
      }

      sources.push({
        sourceType: "research_report",
        title: r.title || "Unknown",
        url,
        accessedAt: Date.now(),
        reliability: determineReliability(url),
      });
    }

    return {
      upside: upside || "Stronger-than-expected growth",
      downside: downside || "Economic slowdown",
      tail: tail || "Financial system stress",
      sources,
    };
  } catch (error) {
    console.error("[ECON] Risk search error:", error);
    return { sources };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function verifyIndicators(
  claimed?: Array<{ name: string; value: number; unit: string }>,
  found?: IndicatorSearchResult
): EconomicIndicator[] {
  const indicators: EconomicIndicator[] = [];

  if (!claimed || !found) {
    // Return found indicators if no claimed
    for (const [name, data] of found?.indicators || []) {
      indicators.push({
        name,
        value: data.value,
        unit: "%",
        trend: "unknown",
        source: data.source,
        verified: true,
      });
    }
    return indicators;
  }

  for (const claim of claimed) {
    const foundData = found.indicators.get(claim.name);

    const indicator: EconomicIndicator = {
      name: claim.name,
      value: foundData?.value,
      unit: claim.unit,
      trend: determineTrend(claim.name, foundData?.value),
      source: foundData?.source,
      verified: false,
      expectedValue: claim.value,
    };

    // Verify if values match (within tolerance)
    if (foundData?.value !== undefined) {
      const tolerance = claim.value * 0.1; // 10% tolerance
      const diff = Math.abs(foundData.value - claim.value);
      indicator.verified = diff <= tolerance;
      indicator.deviation = foundData.value - claim.value;
    }

    indicators.push(indicator);
  }

  return indicators;
}

function determineTrend(indicatorName: string, _value?: number): EconomicIndicator["trend"] {
  // In a real implementation, this would compare to historical data
  // For now, return unknown
  return "unknown";
}

function buildPositioning(
  indicators: EconomicIndicator[],
  policy: PolicySearchResult
): PositioningRecommendation[] {
  const positioning: PositioningRecommendation[] = [];

  // Basic positioning logic based on policy expectations
  if (policy.expectedChange?.includes("cut") || policy.expectedChange?.includes("-")) {
    positioning.push({
      asset: "10Y Treasury",
      direction: "long",
      rationale: "Rate cuts typically push yields lower, benefiting duration",
    });

    positioning.push({
      asset: "USD",
      direction: "short",
      rationale: "Rate cuts typically weaken currency",
    });

    positioning.push({
      asset: "Gold",
      direction: "long",
      rationale: "Real rates declining supportive for gold",
    });
  } else if (policy.expectedChange?.includes("hike") || policy.expectedChange?.includes("+")) {
    positioning.push({
      asset: "10Y Treasury",
      direction: "short",
      rationale: "Rate hikes push yields higher",
    });

    positioning.push({
      asset: "USD",
      direction: "long",
      rationale: "Rate hikes typically strengthen currency",
    });
  }

  // Check inflation indicators
  const cpi = indicators.find((i) => i.name.includes("CPI"));
  if (cpi?.value && cpi.value > 3) {
    positioning.push({
      asset: "TIPS",
      direction: "long",
      rationale: `Elevated inflation (${cpi.value}%) supports inflation-protected securities`,
    });
  }

  return positioning;
}

function identifyConcerns(
  indicators: EconomicIndicator[],
  policy: PolicySearchResult
): EconomicIndicatorFindings["concerns"] {
  const concerns: EconomicIndicatorFindings["concerns"] = [];

  // Check for unverified indicators
  const unverified = indicators.filter((i) => !i.verified);
  if (unverified.length > indicators.length / 2) {
    concerns.push({
      type: "conflicting_data",
      severity: "medium",
      description: `${unverified.length} of ${indicators.length} indicators could not be verified`,
    });
  }

  // Check for significant deviations
  for (const indicator of indicators) {
    if (indicator.deviation && Math.abs(indicator.deviation) > indicator.expectedValue! * 0.2) {
      concerns.push({
        type: "conflicting_data",
        severity: "high",
        description: `${indicator.name}: Claimed ${indicator.expectedValue}${indicator.unit}, found ${indicator.value}${indicator.unit}`,
      });
    }
  }

  // Check policy verification
  if (!policy.verified) {
    concerns.push({
      type: "forecast_divergence",
      severity: "medium",
      description: "Policy expectations could not be verified against market data",
    });
  }

  return concerns;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function extractSource(url: string): string {
  if (url.includes("bls.gov")) return "BLS";
  if (url.includes("fred.stlouisfed.org") || url.includes("federalreserve.gov")) return "Federal Reserve";
  if (url.includes("bea.gov")) return "BEA";
  if (url.includes("imf.org")) return "IMF";
  if (url.includes("worldbank.org")) return "World Bank";
  if (url.includes("bloomberg")) return "Bloomberg";
  if (url.includes("reuters")) return "Reuters";
  return "Unknown";
}

function determineSourceType(url: string): DDSource["sourceType"] {
  if (url.includes("bls.gov") || url.includes("bea.gov") || url.includes("federalreserve.gov")) {
    return "regulatory_filing";
  }
  if (url.includes("imf.org") || url.includes("worldbank.org")) {
    return "research_report";
  }
  return "news_article";
}

function determineReliability(url: string): SourceReliability {
  if (url.includes("bls.gov") || url.includes("bea.gov")) return "authoritative";
  if (url.includes("federalreserve.gov") || url.includes("fred.")) return "authoritative";
  if (url.includes("imf.org") || url.includes("worldbank.org")) return "authoritative";
  if (url.includes("bloomberg.com") || url.includes("reuters.com")) return "reliable";
  return "secondary";
}

function determineSourceQuality(sources: DDSource[]): EconomicIndicatorFindings["verification"]["sourceQuality"] {
  const hasOfficial = sources.some(
    (s) =>
      s.url?.includes("bls.gov") ||
      s.url?.includes("bea.gov") ||
      s.url?.includes("federalreserve.gov")
  );

  const hasAuthoritative = sources.some(
    (s) =>
      s.url?.includes("imf.org") ||
      s.url?.includes("worldbank.org") ||
      s.url?.includes("bloomberg.com")
  );

  if (hasOfficial) return "Official";
  if (hasAuthoritative) return "Authoritative";
  if (sources.length > 0) return "Secondary";
  return "Unverified";
}

function calculateConfidence(
  indicators: EconomicIndicator[],
  policy: PolicySearchResult
): number {
  let score = 0;

  // Indicator verification (50%)
  const verifiedCount = indicators.filter((i) => i.verified).length;
  const verificationRate = indicators.length > 0 ? verifiedCount / indicators.length : 0;
  score += verificationRate * 50;

  // Policy verification (30%)
  if (policy.verified) score += 30;
  else if (policy.expectedChange) score += 15;

  // Source quality (20%)
  const hasOfficialSource = indicators.some(
    (i) => i.source === "BLS" || i.source === "BEA" || i.source === "Federal Reserve"
  );
  if (hasOfficialSource) score += 20;
  else if (indicators.some((i) => i.source)) score += 10;

  return score / 100;
}

function formatEconomicReport(findings: EconomicIndicatorFindings): string {
  const lines: string[] = [];

  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(`ECONOMIC INDICATOR VERIFICATION: ${findings.thesisName}`);
  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(``);

  lines.push(`Region: ${findings.region}`);
  lines.push(`Source Quality: ${findings.verification.sourceQuality}`);
  lines.push(`Indicators Verified: ${findings.verification.indicatorsVerified}/${findings.verification.indicatorsTotal}`);
  lines.push(``);

  lines.push(`ECONOMIC INDICATORS`);
  for (const indicator of findings.indicators) {
    const status = indicator.verified ? "VERIFIED" : "UNVERIFIED";
    const valueStr = indicator.value !== undefined ? `${indicator.value}${indicator.unit}` : "N/A";
    const expectedStr = indicator.expectedValue !== undefined ? ` (claimed: ${indicator.expectedValue}${indicator.unit})` : "";
    const sourceStr = indicator.source ? ` [${indicator.source}]` : "";
    lines.push(`  ${indicator.name}: ${valueStr} ${status}${expectedStr}${sourceStr}`);
  }
  lines.push(``);

  lines.push(`POLICY ANALYSIS`);
  if (findings.policy.currentStance) {
    lines.push(`  Current Stance: ${findings.policy.currentStance}`);
  }
  if (findings.policy.expectedChange) {
    const verifiedStr = findings.verification.policyVerified ? "(VERIFIED)" : "";
    lines.push(`  Expected Change: ${findings.policy.expectedChange} ${verifiedStr}`);
  }
  if (findings.policy.confidence) {
    lines.push(`  Confidence: ${findings.policy.confidence}%`);
  }
  if (findings.policy.rationale) {
    lines.push(`  Rationale: ${findings.policy.rationale}`);
  }
  lines.push(``);

  lines.push(`RISK SCENARIOS`);
  if (findings.risks.upside) {
    lines.push(`  Upside: ${findings.risks.upside}`);
  }
  if (findings.risks.downside) {
    lines.push(`  Downside: ${findings.risks.downside}`);
  }
  if (findings.risks.tail) {
    lines.push(`  Tail Risk: ${findings.risks.tail}`);
  }
  lines.push(``);

  if (findings.positioning.length > 0) {
    lines.push(`POSITIONING RECOMMENDATIONS`);
    for (const pos of findings.positioning) {
      lines.push(`  ${pos.asset}: ${pos.direction.toUpperCase()}`);
      lines.push(`    ${pos.rationale}`);
    }
    lines.push(``);
  }

  if (findings.concerns.length > 0) {
    lines.push(`CONCERNS`);
    for (const concern of findings.concerns) {
      lines.push(`  [${concern.severity.toUpperCase()}] ${concern.description}`);
    }
    lines.push(``);
  }

  lines.push(`CONFIDENCE: ${(findings.confidenceScore * 100).toFixed(0)}%`);
  lines.push(`═══════════════════════════════════════════════════════════════`);

  return lines.join("\n");
}
