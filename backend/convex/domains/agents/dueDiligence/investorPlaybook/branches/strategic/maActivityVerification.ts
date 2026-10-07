/**
 * M&A Activity Verification Branch
 *
 * Verifies M&A rumors and deal facts via authoritative sources.
 * Used by CORP_DEV persona for deal due diligence.
 */

import { api } from "../../../../../../_generated/api";
import { DDSource, SourceReliability } from "../../../types";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface MAActivityFindings {
  dealName: string;
  acquirer: string;
  target: string;

  // Deal facts
  deal: {
    dealValue?: string;
    dealType?: "All-cash" | "All-stock" | "Cash and stock" | "Asset purchase" | "Unknown";
    announcementDate?: string;
    expectedCloseDate?: string;
    status: "Rumored" | "Announced" | "Pending" | "Completed" | "Terminated" | "Unknown";
    premium?: number; // Percentage premium to trading price
  };

  // Strategic rationale
  rationale: {
    synergies?: string;
    costSynergies?: string;
    revenueSynergies?: string;
    strategicFit?: string;
    marketPositionImpact?: string;
  };

  // Risks
  risks: {
    regulatoryRisk?: string;
    integrationRisk?: string;
    financingRisk?: string;
    customerRisk?: string;
    competitorResponse?: string;
  };

  // Valuation
  valuation: {
    evRevenue?: number;
    evEbitda?: number;
    comparableDeals: string[];
  };

  // Verification
  verification: {
    dealConfirmed: boolean;
    valueVerified: boolean;
    timelineVerified: boolean;
    sourceQuality: "SEC_Filing" | "Press_Release" | "News" | "Rumor" | "Unverified";
    verificationDate: string;
  };

  // Red flags
  redFlags: Array<{
    type: "valuation_concern" | "regulatory_risk" | "financing_uncertainty" | "timeline_slip" | "deal_termination_risk";
    severity: "low" | "medium" | "high" | "critical";
    description: string;
  }>;

  confidenceScore: number;
}

export interface MAActivityResult {
  findings: MAActivityFindings;
  sources: DDSource[];
  report: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute M&A activity verification branch
 */
export async function executeMAActivityVerificationBranch(
  ctx: any,
  acquirer: string,
  target: string,
  claimedDeal?: {
    dealValue?: string;
    dealType?: string;
    announcementDate?: string;
    synergies?: string;
  }
): Promise<MAActivityResult> {
  const sources: DDSource[] = [];
  const startTime = Date.now();
  const dealName = `${acquirer}-${target} Acquisition`;

  console.log(`[M&A] Starting verification for ${dealName}...`);

  // Run parallel searches
  const [dealResults, rationaleResults, riskResults, valuationResults] = await Promise.all([
    searchDealFacts(ctx, acquirer, target),
    searchStrategicRationale(ctx, acquirer, target),
    searchRegulatoryRisks(ctx, acquirer, target),
    searchValuationComps(ctx, acquirer, target),
  ]);

  // Aggregate sources
  sources.push(
    ...dealResults.sources,
    ...rationaleResults.sources,
    ...riskResults.sources,
    ...valuationResults.sources
  );

  // Verify claimed data
  const verification = verifyDealData(claimedDeal, dealResults);

  // Identify red flags
  const redFlags = identifyRedFlags(dealResults, riskResults, valuationResults);

  // Calculate confidence
  const confidenceScore = calculateConfidence(dealResults, verification);

  const findings: MAActivityFindings = {
    dealName,
    acquirer,
    target,

    deal: {
      dealValue: dealResults.dealValue || claimedDeal?.dealValue,
      dealType: normalizeDealType(dealResults.dealType || claimedDeal?.dealType),
      announcementDate: dealResults.announcementDate || claimedDeal?.announcementDate,
      expectedCloseDate: dealResults.expectedCloseDate,
      status: dealResults.status || "Unknown",
      premium: dealResults.premium,
    },

    rationale: {
      synergies: rationaleResults.synergies || claimedDeal?.synergies,
      costSynergies: rationaleResults.costSynergies,
      revenueSynergies: rationaleResults.revenueSynergies,
      strategicFit: rationaleResults.strategicFit,
      marketPositionImpact: rationaleResults.marketPositionImpact,
    },

    risks: {
      regulatoryRisk: riskResults.regulatoryRisk,
      integrationRisk: riskResults.integrationRisk,
      financingRisk: riskResults.financingRisk,
      customerRisk: riskResults.customerRisk,
      competitorResponse: riskResults.competitorResponse,
    },

    valuation: {
      evRevenue: valuationResults.evRevenue,
      evEbitda: valuationResults.evEbitda,
      comparableDeals: valuationResults.comparableDeals,
    },

    verification,
    redFlags,
    confidenceScore,
  };

  // Generate report
  const report = formatMAReport(findings, claimedDeal);

  console.log(`[M&A] Completed in ${Date.now() - startTime}ms, confidence: ${(confidenceScore * 100).toFixed(0)}%`);

  return {
    findings,
    sources,
    report,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

interface DealSearchResult {
  dealValue?: string;
  dealType?: string;
  announcementDate?: string;
  expectedCloseDate?: string;
  status?: MAActivityFindings["deal"]["status"];
  premium?: number;
  sources: DDSource[];
}

async function searchDealFacts(ctx: any, acquirer: string, target: string): Promise<DealSearchResult> {
  const sources: DDSource[] = [];

  try {
    const result = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
      query: `${acquirer} ${target} acquisition deal value announcement SEC filing`,
      mode: "balanced",
      maxTotal: 10,
      skipRateLimit: true,
    });

    const searchResults = result?.payload?.results ?? [];

    let dealValue: string | undefined;
    let dealType: string | undefined;
    let announcementDate: string | undefined;
    let expectedCloseDate: string | undefined;
    let status: MAActivityFindings["deal"]["status"] | undefined;
    let premium: number | undefined;

    for (const r of searchResults) {
      const content = (r.snippet || r.content || "").toLowerCase();
      const url = r.url || "";

      // Extract deal value
      if (!dealValue) {
        const billionMatch = content.match(/\$(\d+(?:\.\d+)?)\s*(?:billion|bn|b)\b/i);
        if (billionMatch) {
          dealValue = `$${billionMatch[1]}B`;
        }
        const millionMatch = content.match(/\$(\d+(?:\.\d+)?)\s*(?:million|mn|m)\b/i);
        if (millionMatch && !dealValue) {
          dealValue = `$${millionMatch[1]}M`;
        }
      }

      // Extract deal type
      if (!dealType) {
        if (content.includes("all-cash") || content.includes("all cash")) {
          dealType = "All-cash";
        } else if (content.includes("all-stock") || content.includes("all stock")) {
          dealType = "All-stock";
        } else if (content.includes("cash and stock")) {
          dealType = "Cash and stock";
        } else if (content.includes("asset purchase") || content.includes("asset deal")) {
          dealType = "Asset purchase";
        }
      }

      // Extract status
      if (!status) {
        if (content.includes("completed") || content.includes("closed")) {
          status = "Completed";
        } else if (content.includes("announced") || content.includes("agreement")) {
          status = "Announced";
        } else if (content.includes("pending") || content.includes("regulatory review")) {
          status = "Pending";
        } else if (content.includes("terminated") || content.includes("called off")) {
          status = "Terminated";
        } else if (content.includes("rumor") || content.includes("reportedly") || content.includes("in talks")) {
          status = "Rumored";
        }
      }

      // Extract premium
      if (!premium) {
        const premiumMatch = content.match(/(\d+(?:\.\d+)?)\s*%?\s*premium/i);
        if (premiumMatch) {
          premium = parseFloat(premiumMatch[1]);
        }
      }

      // Extract dates
      if (!announcementDate) {
        const dateMatch = content.match(/announced?\s+(?:on\s+)?(\w+\s+\d+,?\s*\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4})/i);
        if (dateMatch) {
          announcementDate = dateMatch[1];
        }
      }

      if (!expectedCloseDate) {
        const closeMatch = content.match(/(?:close|closing|expected\s+to\s+close)\s+(?:in\s+)?(?:by\s+)?(Q[1-4]\s*\d{4}|\w+\s*\d{4})/i);
        if (closeMatch) {
          expectedCloseDate = closeMatch[1];
        }
      }

      sources.push({
        sourceType: url.includes("sec.gov") ? "regulatory_filing" : "news_article",
        title: r.title || "Unknown",
        url,
        accessedAt: Date.now(),
        reliability: determineReliability(url),
      });
    }

    return {
      dealValue,
      dealType,
      announcementDate,
      expectedCloseDate,
      status,
      premium,
      sources,
    };
  } catch (error) {
    console.error("[M&A] Deal facts search error:", error);
    return { sources };
  }
}

interface RationaleSearchResult {
  synergies?: string;
  costSynergies?: string;
  revenueSynergies?: string;
  strategicFit?: string;
  marketPositionImpact?: string;
  sources: DDSource[];
}

async function searchStrategicRationale(ctx: any, acquirer: string, target: string): Promise<RationaleSearchResult> {
  const sources: DDSource[] = [];

  try {
    const result = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
      query: `${acquirer} ${target} acquisition synergies strategic rationale cost savings`,
      mode: "balanced",
      maxTotal: 6,
      skipRateLimit: true,
    });

    const searchResults = result?.payload?.results ?? [];

    let synergies: string | undefined;
    let costSynergies: string | undefined;
    let revenueSynergies: string | undefined;
    let strategicFit: string | undefined;
    let marketPositionImpact: string | undefined;

    for (const r of searchResults) {
      const content = (r.snippet || r.content || "").toLowerCase();
      const url = r.url || "";

      // Extract synergies
      if (!synergies) {
        const synergyMatch = content.match(/(\$\d+(?:\.\d+)?[mb](?:illion)?)\s*(?:in\s+)?(?:annual\s+)?synergies/i);
        if (synergyMatch) {
          synergies = `${synergyMatch[1]} annual synergies`;
        }
      }

      // Extract cost synergies
      if (!costSynergies && content.includes("cost")) {
        const costMatch = content.match(/cost\s+(?:synergies|savings)[^.]*?(\$\d+(?:\.\d+)?[mb])/i);
        if (costMatch) {
          costSynergies = costMatch[1];
        } else if (content.includes("manufacturing") || content.includes("consolidation")) {
          costSynergies = "Manufacturing consolidation expected";
        }
      }

      // Extract market position impact
      if (!marketPositionImpact) {
        if (content.includes("market leader") || content.includes("#1") || content.includes("number one")) {
          marketPositionImpact = "Combined entity expected to be market leader";
        } else if (content.includes("market share")) {
          const shareMatch = content.match(/(\d+)\s*%?\s*market\s*share/i);
          if (shareMatch) {
            marketPositionImpact = `Combined market share: ${shareMatch[1]}%`;
          }
        }
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
      synergies,
      costSynergies,
      revenueSynergies,
      strategicFit,
      marketPositionImpact,
      sources,
    };
  } catch (error) {
    console.error("[M&A] Rationale search error:", error);
    return { sources };
  }
}

interface RiskSearchResult {
  regulatoryRisk?: string;
  integrationRisk?: string;
  financingRisk?: string;
  customerRisk?: string;
  competitorResponse?: string;
  sources: DDSource[];
}

async function searchRegulatoryRisks(ctx: any, acquirer: string, target: string): Promise<RiskSearchResult> {
  const sources: DDSource[] = [];

  try {
    const result = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
      query: `${acquirer} ${target} acquisition FTC DOJ antitrust regulatory approval risk`,
      mode: "balanced",
      maxTotal: 6,
      skipRateLimit: true,
    });

    const searchResults = result?.payload?.results ?? [];

    let regulatoryRisk: string | undefined;
    let integrationRisk: string | undefined;
    let financingRisk: string | undefined;
    let customerRisk: string | undefined;

    for (const r of searchResults) {
      const content = (r.snippet || r.content || "").toLowerCase();
      const url = r.url || "";

      // Extract regulatory risk
      if (!regulatoryRisk) {
        if (content.includes("ftc") || content.includes("federal trade commission")) {
          regulatoryRisk = "FTC review expected";
        }
        if (content.includes("doj") || content.includes("justice department")) {
          regulatoryRisk = regulatoryRisk ? regulatoryRisk + "; DOJ review" : "DOJ review expected";
        }
        if (content.includes("antitrust") || content.includes("competition")) {
          regulatoryRisk = regulatoryRisk || "Antitrust scrutiny expected";
        }
        if (content.includes("hhi") || content.includes("concentration")) {
          regulatoryRisk = regulatoryRisk ? regulatoryRisk + "; HHI concerns" : "Market concentration concerns";
        }
      }

      // Extract integration risk
      if (!integrationRisk) {
        if (content.includes("integration") && (content.includes("challenge") || content.includes("risk"))) {
          integrationRisk = "Integration challenges identified";
        }
        if (content.includes("culture") || content.includes("cultural")) {
          integrationRisk = integrationRisk ? integrationRisk + "; Cultural differences" : "Cultural integration risk";
        }
      }

      // Extract financing risk
      if (!financingRisk) {
        if (content.includes("bridge loan") || content.includes("bridge financing")) {
          financingRisk = "Bridge financing in place, permanent financing TBD";
        }
        if (content.includes("leverage") || content.includes("debt")) {
          financingRisk = financingRisk || "Leverage increase expected";
        }
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
      regulatoryRisk,
      integrationRisk,
      financingRisk,
      customerRisk,
      sources,
    };
  } catch (error) {
    console.error("[M&A] Risk search error:", error);
    return { sources };
  }
}

interface ValuationSearchResult {
  evRevenue?: number;
  evEbitda?: number;
  comparableDeals: string[];
  sources: DDSource[];
}

async function searchValuationComps(ctx: any, acquirer: string, target: string): Promise<ValuationSearchResult> {
  const sources: DDSource[] = [];
  const comparableDeals: string[] = [];

  try {
    const result = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
      query: `${acquirer} ${target} acquisition valuation EV/Revenue EV/EBITDA multiple comparable deals`,
      mode: "balanced",
      maxTotal: 5,
      skipRateLimit: true,
    });

    const searchResults = result?.payload?.results ?? [];

    let evRevenue: number | undefined;
    let evEbitda: number | undefined;

    for (const r of searchResults) {
      const content = (r.snippet || r.content || "").toLowerCase();
      const url = r.url || "";

      // Extract EV/Revenue
      if (!evRevenue) {
        const evRevMatch = content.match(/(\d+(?:\.\d+)?)\s*x?\s*(?:ev\/)?(?:sales|revenue)/i);
        if (evRevMatch) {
          evRevenue = parseFloat(evRevMatch[1]);
        }
      }

      // Extract EV/EBITDA
      if (!evEbitda) {
        const evEbitdaMatch = content.match(/(\d+(?:\.\d+)?)\s*x?\s*(?:ev\/)?ebitda/i);
        if (evEbitdaMatch) {
          evEbitda = parseFloat(evEbitdaMatch[1]);
        }
      }

      // Extract comparable deals
      const compMatch = content.match(/(?:comparable|similar|previous)\s+(?:deal|acquisition|transaction)[^.]*?(\$\d+(?:\.\d+)?[mb])/i);
      if (compMatch) {
        comparableDeals.push(compMatch[0]);
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
      evRevenue,
      evEbitda,
      comparableDeals: comparableDeals.slice(0, 3),
      sources,
    };
  } catch (error) {
    console.error("[M&A] Valuation search error:", error);
    return { comparableDeals: [], sources };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function verifyDealData(
  claimed: { dealValue?: string; dealType?: string; announcementDate?: string; synergies?: string } | undefined,
  found: DealSearchResult
): MAActivityFindings["verification"] {
  const verification: MAActivityFindings["verification"] = {
    dealConfirmed: false,
    valueVerified: false,
    timelineVerified: false,
    sourceQuality: "Unverified",
    verificationDate: new Date().toISOString(),
  };

  // Determine source quality
  const hasSecFiling = found.sources.some((s) => s.url?.includes("sec.gov"));
  const hasPressRelease = found.sources.some((s) =>
    s.title?.toLowerCase().includes("press release") ||
    s.url?.includes("prnewswire") ||
    s.url?.includes("businesswire")
  );
  const hasNews = found.sources.some((s) =>
    s.url?.includes("reuters") ||
    s.url?.includes("bloomberg") ||
    s.url?.includes("wsj")
  );

  if (hasSecFiling) {
    verification.sourceQuality = "SEC_Filing";
  } else if (hasPressRelease) {
    verification.sourceQuality = "Press_Release";
  } else if (hasNews) {
    verification.sourceQuality = "News";
  } else if (found.status === "Rumored") {
    verification.sourceQuality = "Rumor";
  }

  // Deal is confirmed if we have status and value
  verification.dealConfirmed = !!(found.status && found.status !== "Unknown" && found.dealValue);

  // Verify deal value
  if (claimed?.dealValue && found.dealValue) {
    verification.valueVerified = normalizeValue(claimed.dealValue) === normalizeValue(found.dealValue);
  } else if (found.dealValue) {
    verification.valueVerified = true;
  }

  // Verify timeline
  verification.timelineVerified = !!(found.announcementDate || found.expectedCloseDate);

  return verification;
}

function identifyRedFlags(
  deal: DealSearchResult,
  risks: RiskSearchResult,
  valuation: ValuationSearchResult
): MAActivityFindings["redFlags"] {
  const redFlags: MAActivityFindings["redFlags"] = [];

  // Check deal status
  if (deal.status === "Terminated") {
    redFlags.push({
      type: "deal_termination_risk",
      severity: "critical",
      description: "Deal has been TERMINATED",
    });
  }

  // Check regulatory risk
  if (risks.regulatoryRisk && risks.regulatoryRisk.toLowerCase().includes("ftc")) {
    redFlags.push({
      type: "regulatory_risk",
      severity: "high",
      description: `Regulatory scrutiny: ${risks.regulatoryRisk}`,
    });
  }

  // Check financing risk
  if (risks.financingRisk && risks.financingRisk.includes("bridge")) {
    redFlags.push({
      type: "financing_uncertainty",
      severity: "medium",
      description: "Bridge financing in place - permanent financing pending",
    });
  }

  // Check valuation
  if (valuation.evEbitda && valuation.evEbitda > 15) {
    redFlags.push({
      type: "valuation_concern",
      severity: "medium",
      description: `High EV/EBITDA multiple of ${valuation.evEbitda}x`,
    });
  }

  if (deal.premium && deal.premium > 50) {
    redFlags.push({
      type: "valuation_concern",
      severity: "medium",
      description: `High acquisition premium of ${deal.premium}%`,
    });
  }

  return redFlags;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function normalizeDealType(type?: string): MAActivityFindings["deal"]["dealType"] {
  if (!type) return "Unknown";

  const lower = type.toLowerCase();
  if (lower.includes("all-cash") || lower.includes("all cash")) return "All-cash";
  if (lower.includes("all-stock") || lower.includes("all stock")) return "All-stock";
  if (lower.includes("cash and stock")) return "Cash and stock";
  if (lower.includes("asset")) return "Asset purchase";
  return "Unknown";
}

function normalizeValue(value: string): string {
  // Normalize to comparable format
  return value.replace(/\s+/g, "").toLowerCase();
}

function determineReliability(url: string): SourceReliability {
  if (url.includes("sec.gov")) return "authoritative";
  if (url.includes("reuters.com") || url.includes("bloomberg.com")) return "reliable";
  if (url.includes("wsj.com") || url.includes("ft.com")) return "reliable";
  if (url.includes("prnewswire.com") || url.includes("businesswire.com")) return "reliable";
  return "secondary";
}

function calculateConfidence(
  deal: DealSearchResult,
  verification: MAActivityFindings["verification"]
): number {
  let score = 0;

  // Source quality (40%)
  if (verification.sourceQuality === "SEC_Filing") score += 40;
  else if (verification.sourceQuality === "Press_Release") score += 30;
  else if (verification.sourceQuality === "News") score += 20;
  else if (verification.sourceQuality === "Rumor") score += 5;

  // Deal confirmation (30%)
  if (verification.dealConfirmed) score += 30;

  // Data completeness (30%)
  if (deal.dealValue) score += 10;
  if (deal.status) score += 10;
  if (deal.announcementDate || deal.expectedCloseDate) score += 10;

  return score / 100;
}

function formatMAReport(
  findings: MAActivityFindings,
  claimed?: { dealValue?: string; dealType?: string; synergies?: string }
): string {
  const lines: string[] = [];

  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(`M&A ACTIVITY VERIFICATION: ${findings.dealName}`);
  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(``);

  lines.push(`Acquirer: ${findings.acquirer}`);
  lines.push(`Target: ${findings.target}`);
  lines.push(`Source Quality: ${findings.verification.sourceQuality}`);
  lines.push(``);

  lines.push(`DEAL FACTS`);
  lines.push(`  Value: ${findings.deal.dealValue || "Not Disclosed"} ${findings.verification.valueVerified ? "(VERIFIED)" : ""}`);
  lines.push(`  Type: ${findings.deal.dealType}`);
  lines.push(`  Status: ${findings.deal.status} ${findings.verification.dealConfirmed ? "(CONFIRMED)" : ""}`);
  if (findings.deal.announcementDate) {
    lines.push(`  Announced: ${findings.deal.announcementDate}`);
  }
  if (findings.deal.expectedCloseDate) {
    lines.push(`  Expected Close: ${findings.deal.expectedCloseDate}`);
  }
  if (findings.deal.premium) {
    lines.push(`  Premium: ${findings.deal.premium}%`);
  }
  lines.push(``);

  lines.push(`STRATEGIC RATIONALE`);
  if (findings.rationale.synergies) {
    lines.push(`  Synergies: ${findings.rationale.synergies}`);
  }
  if (findings.rationale.costSynergies) {
    lines.push(`  Cost Synergies: ${findings.rationale.costSynergies}`);
  }
  if (findings.rationale.marketPositionImpact) {
    lines.push(`  Market Impact: ${findings.rationale.marketPositionImpact}`);
  }
  lines.push(``);

  lines.push(`RISKS`);
  if (findings.risks.regulatoryRisk) {
    lines.push(`  Regulatory: ${findings.risks.regulatoryRisk}`);
  }
  if (findings.risks.integrationRisk) {
    lines.push(`  Integration: ${findings.risks.integrationRisk}`);
  }
  if (findings.risks.financingRisk) {
    lines.push(`  Financing: ${findings.risks.financingRisk}`);
  }
  lines.push(``);

  lines.push(`VALUATION`);
  if (findings.valuation.evRevenue) {
    lines.push(`  EV/Revenue: ${findings.valuation.evRevenue}x`);
  }
  if (findings.valuation.evEbitda) {
    lines.push(`  EV/EBITDA: ${findings.valuation.evEbitda}x`);
  }
  if (findings.valuation.comparableDeals.length > 0) {
    lines.push(`  Comparable Deals:`);
    for (const deal of findings.valuation.comparableDeals) {
      lines.push(`    - ${deal}`);
    }
  }
  lines.push(``);

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
