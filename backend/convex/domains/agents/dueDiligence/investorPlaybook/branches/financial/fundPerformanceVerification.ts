/**
 * Fund Performance Verification Branch
 *
 * Verifies fund performance metrics (TVPI, DPI, IRR) for LP due diligence.
 * Searches authoritative sources like Cambridge Associates, Preqin, and PitchBook.
 */

import { api } from "../../../../../../_generated/api";
import { DDSource, SourceReliability } from "../../../types";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface FundPerformanceFindings {
  fundName: string;
  gpName?: string;
  vintage?: number;
  fundSize?: number;
  strategy?: string;

  // Performance metrics
  performance: {
    tvpiNet?: number;
    dpiNet?: number;
    irrNet?: number;
    tvpiGross?: number;
    irrGross?: number;
    moic?: number;
    rvpi?: number; // Remaining Value to Paid-In
  };

  // Track record (prior funds)
  trackRecord: FundHistoricalPerformance[];

  // Verification status
  verification: {
    tvpiVerified: boolean;
    dpiVerified: boolean;
    irrVerified: boolean;
    sourceTier: "Tier1" | "Tier2" | "Tier3" | "Unverified";
    verificationDate?: string;
  };

  // Red flags
  redFlags: Array<{
    type: "performance_mismatch" | "data_staleness" | "unrealistic_returns" | "missing_dpi";
    severity: "low" | "medium" | "high" | "critical";
    description: string;
  }>;

  confidenceScore: number;
}

export interface FundHistoricalPerformance {
  fundName: string;
  vintage: number;
  tvpiNet?: number;
  dpiNet?: number;
  irrNet?: number;
  status: "Realized" | "Partially Realized" | "Active";
}

export interface FundPerformanceResult {
  findings: FundPerformanceFindings;
  sources: DDSource[];
  report: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute fund performance verification branch
 */
export async function executeFundPerformanceVerificationBranch(
  ctx: any,
  fundName: string,
  gpName?: string,
  claimedPerformance?: {
    tvpi?: number;
    dpi?: number;
    irr?: number;
    vintage?: number;
  }
): Promise<FundPerformanceResult> {
  const sources: DDSource[] = [];
  const startTime = Date.now();

  console.log(`[FUND_PERF] Starting verification for ${fundName}...`);

  // Search for performance data in parallel
  const [performanceResults, trackRecordResults] = await Promise.all([
    searchPerformanceData(ctx, fundName, gpName),
    searchTrackRecord(ctx, gpName || fundName),
  ]);

  // Aggregate sources
  sources.push(...performanceResults.sources, ...trackRecordResults.sources);

  // Verify claimed performance against found data
  const verification = verifyPerformance(claimedPerformance, performanceResults);

  // Identify red flags
  const redFlags = identifyRedFlags(claimedPerformance, performanceResults, trackRecordResults);

  // Calculate confidence
  const confidenceScore = calculateConfidence(performanceResults, trackRecordResults, verification);

  const findings: FundPerformanceFindings = {
    fundName,
    gpName: gpName || performanceResults.gpName,
    vintage: claimedPerformance?.vintage || performanceResults.vintage,
    fundSize: performanceResults.fundSize,
    strategy: performanceResults.strategy,

    performance: {
      tvpiNet: performanceResults.tvpi,
      dpiNet: performanceResults.dpi,
      irrNet: performanceResults.irr,
    },

    trackRecord: trackRecordResults.funds,

    verification,
    redFlags,
    confidenceScore,
  };

  // Generate report
  const report = formatPerformanceReport(findings, claimedPerformance);

  console.log(`[FUND_PERF] Completed in ${Date.now() - startTime}ms, confidence: ${(confidenceScore * 100).toFixed(0)}%`);

  return {
    findings,
    sources,
    report,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

interface PerformanceSearchResult {
  tvpi?: number;
  dpi?: number;
  irr?: number;
  gpName?: string;
  vintage?: number;
  fundSize?: number;
  strategy?: string;
  sourceTier: "Tier1" | "Tier2" | "Tier3" | "Unverified";
  sources: DDSource[];
}

async function searchPerformanceData(
  ctx: any,
  fundName: string,
  gpName?: string
): Promise<PerformanceSearchResult> {
  const sources: DDSource[] = [];

  try {
    // Search authoritative sources
    const searchQuery = `${fundName} ${gpName || ""} TVPI DPI IRR performance returns`;

    const result = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
      query: searchQuery,
      mode: "balanced",
      maxTotal: 8,
      skipRateLimit: true,
    });

    const searchResults = result?.payload?.results ?? [];

    let tvpi: number | undefined;
    let dpi: number | undefined;
    let irr: number | undefined;
    let fundSize: number | undefined;
    let sourceTier: "Tier1" | "Tier2" | "Tier3" | "Unverified" = "Unverified";

    for (const r of searchResults) {
      const content = (r.snippet || r.content || "").toLowerCase();
      const url = r.url || "";

      // Determine source tier
      const currentTier = getSourceTier(url);
      if (tierRank(currentTier) < tierRank(sourceTier)) {
        sourceTier = currentTier;
      }

      // Extract TVPI
      if (!tvpi) {
        const tvpiMatch = content.match(/tvpi[:\s]*(\d+\.?\d*)x?/i);
        if (tvpiMatch) {
          tvpi = parseFloat(tvpiMatch[1]);
        }
      }

      // Extract DPI
      if (!dpi) {
        const dpiMatch = content.match(/dpi[:\s]*(\d+\.?\d*)x?/i);
        if (dpiMatch) {
          dpi = parseFloat(dpiMatch[1]);
        }
      }

      // Extract IRR
      if (!irr) {
        const irrMatch = content.match(/(?:net\s*)?irr[:\s]*(\d+\.?\d*)\s*%?/i);
        if (irrMatch) {
          irr = parseFloat(irrMatch[1]);
        }
      }

      // Extract fund size
      if (!fundSize) {
        const sizeMatch = content.match(/\$(\d+(?:\.\d+)?)\s*(?:billion|bn|b)/i);
        if (sizeMatch) {
          fundSize = parseFloat(sizeMatch[1]) * 1_000_000_000;
        }
        const millionMatch = content.match(/\$(\d+(?:\.\d+)?)\s*(?:million|mn|m)/i);
        if (millionMatch && !fundSize) {
          fundSize = parseFloat(millionMatch[1]) * 1_000_000;
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
      tvpi,
      dpi,
      irr,
      fundSize,
      sourceTier,
      sources,
    };
  } catch (error) {
    console.error("[FUND_PERF] Performance search error:", error);
    return { sourceTier: "Unverified", sources };
  }
}

interface TrackRecordSearchResult {
  funds: FundHistoricalPerformance[];
  sources: DDSource[];
}

async function searchTrackRecord(ctx: any, gpName: string): Promise<TrackRecordSearchResult> {
  const sources: DDSource[] = [];
  const funds: FundHistoricalPerformance[] = [];

  try {
    const result = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
      query: `${gpName} fund I II III IV track record performance vintage`,
      mode: "balanced",
      maxTotal: 5,
      skipRateLimit: true,
    });

    const searchResults = result?.payload?.results ?? [];

    for (const r of searchResults) {
      const content = (r.snippet || r.content || "").toLowerCase();
      const url = r.url || "";

      // Try to extract fund information
      const fundMatches = content.matchAll(/fund\s*(i{1,4}|iv|v|[1-5])\b[^.]*?(\d+\.?\d*)x?[^.]*?tvpi/gi);

      for (const match of fundMatches) {
        const fundNumeral = match[1].toUpperCase();
        const tvpi = parseFloat(match[2]);

        // Convert numeral to number for vintage estimation
        const fundNumber = romanToNumber(fundNumeral);
        const estimatedVintage = 2024 - (5 - fundNumber) * 3; // Rough estimate

        funds.push({
          fundName: `${gpName} Fund ${fundNumeral}`,
          vintage: estimatedVintage,
          tvpiNet: tvpi,
          status: fundNumber <= 2 ? "Realized" : "Partially Realized",
        });
      }

      sources.push({
        sourceType: "research_report",
        title: r.title || "Unknown",
        url,
        accessedAt: Date.now(),
        reliability: determineReliability(url),
      });
    }

    return { funds, sources };
  } catch (error) {
    console.error("[FUND_PERF] Track record search error:", error);
    return { funds: [], sources };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function verifyPerformance(
  claimed: { tvpi?: number; dpi?: number; irr?: number } | undefined,
  found: PerformanceSearchResult
): FundPerformanceFindings["verification"] {
  const verification: FundPerformanceFindings["verification"] = {
    tvpiVerified: false,
    dpiVerified: false,
    irrVerified: false,
    sourceTier: found.sourceTier,
    verificationDate: new Date().toISOString(),
  };

  if (!claimed) {
    return verification;
  }

  // Verify TVPI (within 10% tolerance)
  if (claimed.tvpi && found.tvpi) {
    const ratio = found.tvpi / claimed.tvpi;
    verification.tvpiVerified = ratio >= 0.9 && ratio <= 1.1;
  }

  // Verify DPI
  if (claimed.dpi && found.dpi) {
    const ratio = found.dpi / claimed.dpi;
    verification.dpiVerified = ratio >= 0.9 && ratio <= 1.1;
  }

  // Verify IRR (within 15% tolerance for IRR)
  if (claimed.irr && found.irr) {
    const diff = Math.abs(found.irr - claimed.irr);
    verification.irrVerified = diff <= claimed.irr * 0.15;
  }

  return verification;
}

function identifyRedFlags(
  claimed: { tvpi?: number; dpi?: number; irr?: number } | undefined,
  found: PerformanceSearchResult,
  trackRecord: TrackRecordSearchResult
): FundPerformanceFindings["redFlags"] {
  const redFlags: FundPerformanceFindings["redFlags"] = [];

  // Check for unrealistic returns
  if (found.tvpi && found.tvpi > 5) {
    redFlags.push({
      type: "unrealistic_returns",
      severity: "medium",
      description: `TVPI of ${found.tvpi}x is unusually high - verify source`,
    });
  }

  if (found.irr && found.irr > 50) {
    redFlags.push({
      type: "unrealistic_returns",
      severity: "medium",
      description: `IRR of ${found.irr}% is unusually high - verify source`,
    });
  }

  // Check for performance mismatch
  if (claimed?.tvpi && found.tvpi) {
    const diff = Math.abs(found.tvpi - claimed.tvpi) / claimed.tvpi;
    if (diff > 0.2) {
      redFlags.push({
        type: "performance_mismatch",
        severity: "high",
        description: `Claimed TVPI (${claimed.tvpi}x) differs significantly from found (${found.tvpi}x)`,
      });
    }
  }

  // Check for missing DPI
  if (found.tvpi && found.tvpi > 1.5 && !found.dpi) {
    redFlags.push({
      type: "missing_dpi",
      severity: "low",
      description: "High TVPI but no DPI data found - check for paper gains vs. realizations",
    });
  }

  // Check for declining track record
  if (trackRecord.funds.length >= 2) {
    const sorted = [...trackRecord.funds].sort((a, b) => (a.vintage || 0) - (b.vintage || 0));
    const recent = sorted[sorted.length - 1];
    const older = sorted[sorted.length - 2];

    if (recent.tvpiNet && older.tvpiNet && recent.tvpiNet < older.tvpiNet * 0.7) {
      redFlags.push({
        type: "performance_mismatch",
        severity: "medium",
        description: "Recent fund performance significantly below historical track record",
      });
    }
  }

  return redFlags;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function getSourceTier(url: string): "Tier1" | "Tier2" | "Tier3" | "Unverified" {
  const tier1 = ["cambridgeassociates.com", "preqin.com", "pitchbook.com", "burgiss.com"];
  const tier2 = ["institutionalinvestor.com", "privateequityinternational.com", "bloomberg.com"];
  const tier3 = ["crunchbase.com", "linkedin.com", "reuters.com"];

  for (const domain of tier1) {
    if (url.includes(domain)) return "Tier1";
  }
  for (const domain of tier2) {
    if (url.includes(domain)) return "Tier2";
  }
  for (const domain of tier3) {
    if (url.includes(domain)) return "Tier3";
  }
  return "Unverified";
}

function tierRank(tier: "Tier1" | "Tier2" | "Tier3" | "Unverified"): number {
  const ranks = { Tier1: 1, Tier2: 2, Tier3: 3, Unverified: 4 };
  return ranks[tier];
}

function romanToNumber(roman: string): number {
  const values: Record<string, number> = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
  };
  return values[roman.toUpperCase()] || 1;
}

function determineReliability(url: string): SourceReliability {
  const tier = getSourceTier(url);
  if (tier === "Tier1") return "authoritative";
  if (tier === "Tier2") return "reliable";
  return "secondary";
}

function calculateConfidence(
  performance: PerformanceSearchResult,
  trackRecord: TrackRecordSearchResult,
  verification: FundPerformanceFindings["verification"]
): number {
  let score = 0;

  // Source tier (40%)
  if (verification.sourceTier === "Tier1") score += 40;
  else if (verification.sourceTier === "Tier2") score += 30;
  else if (verification.sourceTier === "Tier3") score += 15;

  // Data availability (30%)
  if (performance.tvpi) score += 10;
  if (performance.dpi) score += 10;
  if (performance.irr) score += 10;

  // Track record (20%)
  if (trackRecord.funds.length >= 2) score += 20;
  else if (trackRecord.funds.length === 1) score += 10;

  // Verification (10%)
  if (verification.tvpiVerified) score += 4;
  if (verification.dpiVerified) score += 3;
  if (verification.irrVerified) score += 3;

  return score / 100;
}

function formatPerformanceReport(
  findings: FundPerformanceFindings,
  claimed?: { tvpi?: number; dpi?: number; irr?: number }
): string {
  const lines: string[] = [];

  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(`FUND PERFORMANCE VERIFICATION: ${findings.fundName}`);
  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(``);

  lines.push(`GP: ${findings.gpName || "Unknown"}`);
  lines.push(`Vintage: ${findings.vintage || "Unknown"}`);
  lines.push(`Strategy: ${findings.strategy || "Unknown"}`);
  lines.push(`Source Tier: ${findings.verification.sourceTier}`);
  lines.push(``);

  lines.push(`PERFORMANCE METRICS`);
  if (findings.performance.tvpiNet) {
    const status = findings.verification.tvpiVerified ? "VERIFIED" : "UNVERIFIED";
    const claimedStr = claimed?.tvpi ? ` (claimed: ${claimed.tvpi}x)` : "";
    lines.push(`  TVPI: ${findings.performance.tvpiNet}x ${status}${claimedStr}`);
  }
  if (findings.performance.dpiNet) {
    const status = findings.verification.dpiVerified ? "VERIFIED" : "UNVERIFIED";
    const claimedStr = claimed?.dpi ? ` (claimed: ${claimed.dpi}x)` : "";
    lines.push(`  DPI: ${findings.performance.dpiNet}x ${status}${claimedStr}`);
  }
  if (findings.performance.irrNet) {
    const status = findings.verification.irrVerified ? "VERIFIED" : "UNVERIFIED";
    const claimedStr = claimed?.irr ? ` (claimed: ${claimed.irr}%)` : "";
    lines.push(`  IRR: ${findings.performance.irrNet}% ${status}${claimedStr}`);
  }
  lines.push(``);

  if (findings.trackRecord.length > 0) {
    lines.push(`TRACK RECORD`);
    for (const fund of findings.trackRecord) {
      lines.push(`  ${fund.fundName} (${fund.vintage}): TVPI ${fund.tvpiNet || "N/A"}x - ${fund.status}`);
    }
    lines.push(``);
  }

  if (findings.redFlags.length > 0) {
    lines.push(`RED FLAGS`);
    for (const flag of findings.redFlags) {
      lines.push(`  [${flag.severity.toUpperCase()}] ${flag.description}`);
    }
    lines.push(``);
  }

  lines.push(`CONFIDENCE: ${(findings.confidenceScore * 100).toFixed(0)}%`);
  lines.push(`═══════════════════════════════════════════════════════════════`);

  return lines.join("\n");
}
