/**
 * Deal Memo Synthesis Branch
 *
 * Generates standardized deal memos for bankers and VCs.
 * Synthesizes funding information, HQ location, contact details,
 * investment thesis, and verdict into a structured format.
 */

import { api } from "../../../../../../_generated/api";
import { DDSource, SourceReliability } from "../../../types";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface DealMemoFindings {
  // Company basics
  companyName: string;
  description?: string;
  sector?: string;
  stage?: string;

  // Funding information
  funding: {
    latestRound?: string;
    latestAmount?: number;
    latestCurrency?: string;
    latestDate?: string;
    leadInvestor?: string;
    coInvestors?: string[];
    totalRaised?: number;
    valuation?: number;
  };

  // Location
  headquarters: {
    city?: string;
    state?: string;
    country?: string;
    address?: string;
  };

  // Contact information
  contacts: {
    irEmail?: string;
    generalEmail?: string;
    phone?: string;
    linkedIn?: string;
    website?: string;
  };

  // Investment analysis
  thesis: {
    summary?: string;
    whyNow?: string;
    wedge?: string;
    risks?: string[];
  };

  // Verdict
  verdict: "PASS" | "FLAG" | "FAIL" | "NEEDS_MORE_INFO";
  verdictRationale?: string;

  // Quality metrics
  confidenceScore: number;
  dataCompleteness: number;
  lastUpdated?: string;
}

export interface DealMemoResult {
  findings: DealMemoFindings;
  sources: DDSource[];
  formattedMemo: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute deal memo synthesis branch
 */
export async function executeDealMemoSynthesisBranch(
  ctx: any,
  entityName: string,
  entityType: "company" | "fund",
  additionalContext?: {
    claimedFunding?: { stage?: string; amount?: number };
    claimedHQ?: { city?: string; state?: string };
    claimedSector?: string;
  }
): Promise<DealMemoResult> {
  const sources: DDSource[] = [];
  const startTime = Date.now();

  console.log(`[DEAL_MEMO] Starting synthesis for ${entityName}...`);

  // Run searches in parallel
  const [fundingResults, companyResults, contactResults] = await Promise.all([
    searchFundingInfo(ctx, entityName),
    searchCompanyInfo(ctx, entityName),
    searchContactInfo(ctx, entityName),
  ]);

  // Aggregate sources
  sources.push(...fundingResults.sources, ...companyResults.sources, ...contactResults.sources);

  // Synthesize findings
  const findings: DealMemoFindings = {
    companyName: entityName,
    description: companyResults.description,
    sector: additionalContext?.claimedSector || companyResults.sector,
    stage: fundingResults.latestRound || additionalContext?.claimedFunding?.stage,

    funding: {
      latestRound: fundingResults.latestRound,
      latestAmount: fundingResults.latestAmount || additionalContext?.claimedFunding?.amount,
      latestCurrency: fundingResults.currency || "USD",
      latestDate: fundingResults.latestDate,
      leadInvestor: fundingResults.leadInvestor,
      coInvestors: fundingResults.coInvestors,
      totalRaised: fundingResults.totalRaised,
      valuation: fundingResults.valuation,
    },

    headquarters: {
      city: companyResults.city || additionalContext?.claimedHQ?.city,
      state: companyResults.state || additionalContext?.claimedHQ?.state,
      country: companyResults.country || "USA",
    },

    contacts: {
      irEmail: contactResults.irEmail,
      generalEmail: contactResults.generalEmail,
      phone: contactResults.phone,
      linkedIn: contactResults.linkedIn,
      website: contactResults.website,
    },

    thesis: {
      summary: companyResults.description,
      whyNow: generateWhyNow(fundingResults, companyResults),
      wedge: generateWedge(companyResults),
      risks: generateRisks(fundingResults, companyResults, contactResults),
    },

    verdict: determineVerdict(fundingResults, companyResults, contactResults),
    verdictRationale: generateVerdictRationale(fundingResults, companyResults, contactResults),

    confidenceScore: calculateConfidence(fundingResults, companyResults, contactResults),
    dataCompleteness: calculateCompleteness(fundingResults, companyResults, contactResults),
    lastUpdated: new Date().toISOString(),
  };

  // Generate formatted memo
  const formattedMemo = formatDealMemo(findings);

  console.log(`[DEAL_MEMO] Completed in ${Date.now() - startTime}ms, verdict: ${findings.verdict}`);

  return {
    findings,
    sources,
    formattedMemo,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

interface FundingSearchResult {
  latestRound?: string;
  latestAmount?: number;
  currency?: string;
  latestDate?: string;
  leadInvestor?: string;
  coInvestors?: string[];
  totalRaised?: number;
  valuation?: number;
  sources: DDSource[];
}

async function searchFundingInfo(ctx: any, entityName: string): Promise<FundingSearchResult> {
  const sources: DDSource[] = [];

  try {
    const result = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
      query: `${entityName} funding round series investment raised`,
      mode: "balanced",
      maxTotal: 5,
      skipRateLimit: true,
    });

    const searchResults = result?.payload?.results ?? [];

    let latestRound: string | undefined;
    let latestAmount: number | undefined;
    let leadInvestor: string | undefined;
    const coInvestors: string[] = [];

    for (const r of searchResults) {
      const content = (r.snippet || r.content || "").toLowerCase();

      // Extract round type
      if (!latestRound) {
        const roundMatch = content.match(/series\s*([a-e])/i);
        if (roundMatch) {
          latestRound = `Series ${roundMatch[1].toUpperCase()}`;
        } else if (content.includes("seed")) {
          latestRound = "Seed";
        }
      }

      // Extract amount
      if (!latestAmount) {
        const amountMatch = content.match(/\$(\d+(?:\.\d+)?)\s*(?:million|m\b)/i);
        if (amountMatch) {
          latestAmount = parseFloat(amountMatch[1]) * 1_000_000;
        }
        const billionMatch = content.match(/\$(\d+(?:\.\d+)?)\s*(?:billion|b\b)/i);
        if (billionMatch) {
          latestAmount = parseFloat(billionMatch[1]) * 1_000_000_000;
        }
      }

      // Extract investors
      const investorMatch = content.match(/led by\s+([^,\.]+)/i);
      if (investorMatch && !leadInvestor) {
        leadInvestor = investorMatch[1].trim();
      }

      sources.push({
        sourceType: "news_article",
        title: r.title || "Unknown",
        url: r.url || "",
        accessedAt: Date.now(),
        reliability: determineReliability(r.url),
      });
    }

    return {
      latestRound,
      latestAmount,
      leadInvestor,
      coInvestors,
      sources,
    };
  } catch (error) {
    console.error("[DEAL_MEMO] Funding search error:", error);
    return { sources };
  }
}

interface CompanySearchResult {
  description?: string;
  sector?: string;
  city?: string;
  state?: string;
  country?: string;
  employees?: number;
  sources: DDSource[];
}

async function searchCompanyInfo(ctx: any, entityName: string): Promise<CompanySearchResult> {
  const sources: DDSource[] = [];

  try {
    const result = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
      query: `${entityName} company headquarters location sector industry`,
      mode: "balanced",
      maxTotal: 5,
      skipRateLimit: true,
    });

    const searchResults = result?.payload?.results ?? [];

    let description: string | undefined;
    let sector: string | undefined;
    let city: string | undefined;
    let state: string | undefined;

    for (const r of searchResults) {
      const content = r.snippet || r.content || "";

      if (!description && content.length > 50) {
        description = content.slice(0, 200);
      }

      // Extract location
      const locationMatch = content.match(/(?:based in|headquartered in|located in)\s+([^,\.]+)/i);
      if (locationMatch && !city) {
        const location = locationMatch[1].trim();
        // Parse city, state
        const parts = location.split(",").map((p: string) => p.trim());
        if (parts.length >= 1) city = parts[0];
        if (parts.length >= 2) state = parts[1];
      }

      // Extract sector
      const sectorMatch = content.match(/(?:in the|focuses on|specializes in)\s+([^,\.]+)/i);
      if (sectorMatch && !sector) {
        sector = sectorMatch[1].trim();
      }

      sources.push({
        sourceType: "news_article",
        title: r.title || "Unknown",
        url: r.url || "",
        accessedAt: Date.now(),
        reliability: determineReliability(r.url),
      });
    }

    return {
      description,
      sector,
      city,
      state,
      sources,
    };
  } catch (error) {
    console.error("[DEAL_MEMO] Company search error:", error);
    return { sources };
  }
}

interface ContactSearchResult {
  irEmail?: string;
  generalEmail?: string;
  phone?: string;
  linkedIn?: string;
  website?: string;
  sources: DDSource[];
}

async function searchContactInfo(ctx: any, entityName: string): Promise<ContactSearchResult> {
  const sources: DDSource[] = [];

  try {
    const result = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
      query: `${entityName} contact email investor relations phone linkedin`,
      mode: "balanced",
      maxTotal: 5,
      skipRateLimit: true,
    });

    const searchResults = result?.payload?.results ?? [];

    let irEmail: string | undefined;
    let website: string | undefined;
    let linkedIn: string | undefined;

    for (const r of searchResults) {
      const content = r.snippet || r.content || "";
      const url = r.url || "";

      // Extract emails
      const emailMatch = content.match(/[\w.-]+@[\w.-]+\.\w+/);
      if (emailMatch && !irEmail) {
        irEmail = emailMatch[0];
      }

      // Check for LinkedIn
      if (url.includes("linkedin.com") && !linkedIn) {
        linkedIn = url;
      }

      // Extract website
      if (!website && !url.includes("linkedin.com") && !url.includes("crunchbase.com")) {
        const domainMatch = url.match(/https?:\/\/(?:www\.)?([^\/]+)/);
        if (domainMatch && domainMatch[1].includes(entityName.toLowerCase().replace(/\s+/g, ""))) {
          website = url;
        }
      }

      sources.push({
        sourceType: "social_media",
        title: r.title || "Unknown",
        url,
        accessedAt: Date.now(),
        reliability: determineReliability(url),
      });
    }

    return {
      irEmail,
      linkedIn,
      website,
      sources,
    };
  } catch (error) {
    console.error("[DEAL_MEMO] Contact search error:", error);
    return { sources };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function determineReliability(url: string): SourceReliability {
  const authoritativeDomains = ["sec.gov", "crunchbase.com", "pitchbook.com", "bloomberg.com"];
  const reliableDomains = ["techcrunch.com", "reuters.com", "wsj.com", "forbes.com"];

  for (const domain of authoritativeDomains) {
    if (url.includes(domain)) return "authoritative";
  }
  for (const domain of reliableDomains) {
    if (url.includes(domain)) return "reliable";
  }
  return "secondary";
}

/**
 * Generate "Why Now" thesis component based on funding momentum and market signals
 */
function generateWhyNow(funding: FundingSearchResult, company: CompanySearchResult): string | undefined {
  const factors: string[] = [];

  // Recent funding signals momentum
  if (funding.latestRound) {
    const roundLetter = funding.latestRound.replace("Series ", "");
    if (["C", "D", "E"].includes(roundLetter)) {
      factors.push("Late-stage momentum with institutional backing");
    } else if (["A", "B"].includes(roundLetter)) {
      factors.push("Early growth stage with validated product-market fit");
    } else if (funding.latestRound === "Seed") {
      factors.push("Early traction with seed funding secured");
    }
  }

  // Valuation growth signals
  if (funding.latestAmount) {
    if (funding.latestAmount > 100_000_000) {
      factors.push("Significant capital raised indicates strong investor conviction");
    } else if (funding.latestAmount > 20_000_000) {
      factors.push("Growth-stage capital secured for scaling");
    }
  }

  // Lead investor quality
  if (funding.leadInvestor) {
    factors.push(`Backed by ${funding.leadInvestor}`);
  }

  // Sector timing
  if (company.sector) {
    const hotSectors = ["ai", "artificial intelligence", "machine learning", "climate", "fintech"];
    const sectorLower = company.sector.toLowerCase();
    for (const hot of hotSectors) {
      if (sectorLower.includes(hot)) {
        factors.push(`Operating in high-growth ${company.sector} sector`);
        break;
      }
    }
  }

  return factors.length > 0 ? factors.join(". ") + "." : undefined;
}

/**
 * Generate market wedge hypothesis based on company positioning
 */
function generateWedge(company: CompanySearchResult): string | undefined {
  if (!company.description && !company.sector) {
    return undefined;
  }

  const parts: string[] = [];

  if (company.sector) {
    parts.push(`Focused on ${company.sector} market`);
  }

  if (company.description) {
    // Extract key value proposition from description
    const description = company.description.toLowerCase();
    if (description.includes("platform")) {
      parts.push("Platform business model with network effects potential");
    } else if (description.includes("saas") || description.includes("software")) {
      parts.push("SaaS model with recurring revenue potential");
    } else if (description.includes("api") || description.includes("developer")) {
      parts.push("Developer-focused with bottom-up adoption strategy");
    }
  }

  return parts.length > 0 ? parts.join(". ") + "." : undefined;
}

/**
 * Generate risk factors based on data completeness and red flags
 */
function generateRisks(
  funding: FundingSearchResult,
  company: CompanySearchResult,
  contact: ContactSearchResult
): string[] {
  const risks: string[] = [];

  // Data completeness risks
  if (!funding.latestRound && !funding.latestAmount) {
    risks.push("Limited funding history visibility - verify via SEC EDGAR");
  }

  if (!company.description && !company.sector) {
    risks.push("Insufficient company information for proper due diligence");
  }

  if (!contact.irEmail && !contact.linkedIn && !contact.website) {
    risks.push("No verified contact channels - relationship building may be challenging");
  }

  // Valuation risks
  if (funding.valuation && funding.latestAmount) {
    const impliedMultiple = funding.valuation / funding.latestAmount;
    if (impliedMultiple > 50) {
      risks.push("High valuation multiple may indicate stretched pricing");
    }
  }

  // Stage-specific risks
  if (funding.latestRound === "Seed") {
    risks.push("Early stage - higher execution risk, limited financial history");
  }

  return risks;
}

function determineVerdict(
  funding: FundingSearchResult,
  company: CompanySearchResult,
  contact: ContactSearchResult
): "PASS" | "FLAG" | "FAIL" | "NEEDS_MORE_INFO" {
  const hasBasicInfo = company.description || company.sector;
  const hasFunding = funding.latestRound || funding.latestAmount;
  const hasContact = contact.irEmail || contact.linkedIn || contact.website;

  if (!hasBasicInfo && !hasFunding && !hasContact) {
    return "NEEDS_MORE_INFO";
  }

  if (hasFunding && hasBasicInfo && hasContact) {
    return "PASS";
  }

  if (hasFunding || hasBasicInfo) {
    return "FLAG";
  }

  return "NEEDS_MORE_INFO";
}

function generateVerdictRationale(
  funding: FundingSearchResult,
  company: CompanySearchResult,
  contact: ContactSearchResult
): string {
  const parts: string[] = [];

  if (funding.latestRound) {
    parts.push(`${funding.latestRound} funding identified`);
  }
  if (funding.latestAmount) {
    parts.push(`$${(funding.latestAmount / 1_000_000).toFixed(0)}M raised`);
  }
  if (company.sector) {
    parts.push(`Sector: ${company.sector}`);
  }
  if (contact.irEmail || contact.linkedIn) {
    parts.push("Contact info available");
  }

  return parts.length > 0 ? parts.join("; ") : "Insufficient data for analysis";
}

function calculateConfidence(
  funding: FundingSearchResult,
  company: CompanySearchResult,
  contact: ContactSearchResult
): number {
  let score = 0;
  let maxScore = 0;

  // Funding (40%)
  maxScore += 40;
  if (funding.latestRound) score += 15;
  if (funding.latestAmount) score += 15;
  if (funding.leadInvestor) score += 10;

  // Company (35%)
  maxScore += 35;
  if (company.description) score += 15;
  if (company.sector) score += 10;
  if (company.city) score += 10;

  // Contact (25%)
  maxScore += 25;
  if (contact.irEmail) score += 10;
  if (contact.linkedIn) score += 8;
  if (contact.website) score += 7;

  return maxScore > 0 ? score / maxScore : 0;
}

function calculateCompleteness(
  funding: FundingSearchResult,
  company: CompanySearchResult,
  contact: ContactSearchResult
): number {
  const fields = [
    funding.latestRound,
    funding.latestAmount,
    funding.leadInvestor,
    company.description,
    company.sector,
    company.city,
    contact.irEmail,
    contact.linkedIn,
    contact.website,
  ];

  const filled = fields.filter(Boolean).length;
  return filled / fields.length;
}

function formatDealMemo(findings: DealMemoFindings): string {
  const lines: string[] = [];

  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(`DEAL MEMO: ${findings.companyName}`);
  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(``);

  lines.push(`VERDICT: ${findings.verdict}`);
  if (findings.verdictRationale) {
    lines.push(`Rationale: ${findings.verdictRationale}`);
  }
  lines.push(``);

  lines.push(`COMPANY OVERVIEW`);
  lines.push(`  Sector: ${findings.sector || "Unknown"}`);
  lines.push(`  Stage: ${findings.stage || "Unknown"}`);
  if (findings.description) {
    lines.push(`  Description: ${findings.description}`);
  }
  lines.push(``);

  lines.push(`FUNDING`);
  if (findings.funding.latestRound) {
    lines.push(`  Latest Round: ${findings.funding.latestRound}`);
  }
  if (findings.funding.latestAmount) {
    lines.push(`  Amount: $${(findings.funding.latestAmount / 1_000_000).toFixed(1)}M`);
  }
  if (findings.funding.leadInvestor) {
    lines.push(`  Lead: ${findings.funding.leadInvestor}`);
  }
  lines.push(``);

  lines.push(`HEADQUARTERS`);
  const hq = [findings.headquarters.city, findings.headquarters.state, findings.headquarters.country]
    .filter(Boolean)
    .join(", ");
  lines.push(`  Location: ${hq || "Unknown"}`);
  lines.push(``);

  lines.push(`CONTACTS`);
  if (findings.contacts.irEmail) lines.push(`  IR Email: ${findings.contacts.irEmail}`);
  if (findings.contacts.linkedIn) lines.push(`  LinkedIn: ${findings.contacts.linkedIn}`);
  if (findings.contacts.website) lines.push(`  Website: ${findings.contacts.website}`);
  lines.push(``);

  lines.push(`CONFIDENCE: ${(findings.confidenceScore * 100).toFixed(0)}%`);
  lines.push(`DATA COMPLETENESS: ${(findings.dataCompleteness * 100).toFixed(0)}%`);
  lines.push(`═══════════════════════════════════════════════════════════════`);

  return lines.join("\n");
}
