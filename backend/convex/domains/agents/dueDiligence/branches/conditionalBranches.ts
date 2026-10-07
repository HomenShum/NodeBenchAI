/**
 * conditionalBranches.ts
 *
 * Conditional branch handlers for specialized DD research.
 * These branches are spawned based on complexity signals.
 *
 * Includes:
 * - Technical DD (tech stack, architecture, security)
 * - IP/Patents (patent portfolio, trademarks)
 * - Regulatory (SEC, FDA, compliance)
 * - Financial Deep (deep funding analysis)
 * - Network Mapping (relationship graphs)
 */

"use node";

import { api, internal } from "../../../../_generated/api";
import {
  TechnicalDDFindings,
  IPPatentsFindings,
  RegulatoryFindings,
  FinancialDeepFindings,
  NetworkMappingFindings,
  DDSource,
  SourceReliability,
  SourceType,
  PatentAuthorship,
} from "../types";

// ============================================================================
// TECHNICAL DD BRANCH
// ============================================================================

interface TechnicalBranchResult {
  findings: TechnicalDDFindings;
  sources: DDSource[];
  confidence: number;
}

export async function executeTechnicalDDBranch(
  ctx: any,
  entityName: string,
  entityType: string
): Promise<TechnicalBranchResult> {
  const now = Date.now();
  const sources: DDSource[] = [];
  let confidence = 0.3;

  try {
    // Search for technical information using Fusion search (free-first, with Linkup fallback)
    const fusionResult = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `${entityName} technology stack architecture engineering team github`,
        mode: "balanced",
        maxTotal: 10,
        skipRateLimit: true, // DD jobs run system-side
      }
    );
    // Transform fusion search results to expected format
    const techResults = fusionResult?.payload?.results ? {
      content: fusionResult.payload.results.map((r: any) => r.snippet).join("\n\n"),
      sources: fusionResult.payload.results.map((r: any) => ({
        url: r.url,
        title: r.title,
      })),
    } : null;

    if (techResults?.sources) {
      for (const source of techResults.sources.slice(0, 5)) {
        sources.push({
          sourceType: inferSourceType(source.url),
          url: source.url,
          title: source.title,
          accessedAt: now,
          reliability: inferReliability(source.url),
          section: "technical_dd",
        });
      }
    }

    // Extract tech stack from results
    const techStack = extractTechStack(techResults?.content ?? "");
    const repoStats = extractRepoStats(techResults?.content ?? "");

    const findings: TechnicalDDFindings = {
      techStack,
      architecture: extractArchitecture(techResults?.content ?? ""),
      scalability: extractScalability(techResults?.content ?? ""),
      securityPosture: {
        certifications: extractSecurityCerts(techResults?.content ?? ""),
      },
      repoStats,
      technicalDebt: assessTechnicalDebt(techStack, repoStats),
    };

    confidence = calculateTechConfidence(findings, sources);

    return { findings, sources, confidence };

  } catch (error) {
    console.error(`[DD-TechnicalDD] Error for ${entityName}:`, error);
    return {
      findings: { techStack: [] },
      sources,
      confidence: 0.2,
    };
  }
}

function extractTechStack(content: string): string[] {
  const techStack: string[] = [];
  const contentLower = content.toLowerCase();

  const techKeywords = [
    // Languages
    "python", "javascript", "typescript", "java", "go", "rust", "c++", "scala",
    // Frameworks
    "react", "vue", "angular", "nextjs", "django", "flask", "spring",
    // Infrastructure
    "aws", "gcp", "azure", "kubernetes", "docker", "terraform",
    // Databases
    "postgresql", "mysql", "mongodb", "redis", "elasticsearch",
    // AI/ML
    "pytorch", "tensorflow", "langchain", "openai", "anthropic",
  ];

  for (const tech of techKeywords) {
    if (contentLower.includes(tech) && !techStack.includes(tech)) {
      techStack.push(tech.charAt(0).toUpperCase() + tech.slice(1));
    }
  }

  return techStack;
}

function extractRepoStats(content: string): { stars: number; forks: number; contributors: number } | undefined {
  const starsMatch = content.match(/([\d,]+)\s*stars?/i);
  const forksMatch = content.match(/([\d,]+)\s*forks?/i);
  const contribMatch = content.match(/([\d,]+)\s*contributors?/i);

  if (starsMatch || forksMatch || contribMatch) {
    return {
      stars: starsMatch ? parseInt(starsMatch[1].replace(",", ""), 10) : 0,
      forks: forksMatch ? parseInt(forksMatch[1].replace(",", ""), 10) : 0,
      contributors: contribMatch ? parseInt(contribMatch[1].replace(",", ""), 10) : 0,
    };
  }

  return undefined;
}

function extractArchitecture(content: string): string | undefined {
  const patterns = [
    { keyword: "microservices", desc: "Microservices architecture" },
    { keyword: "monolithic", desc: "Monolithic architecture" },
    { keyword: "serverless", desc: "Serverless architecture" },
    { keyword: "event-driven", desc: "Event-driven architecture" },
    { keyword: "api-first", desc: "API-first design" },
  ];

  for (const { keyword, desc } of patterns) {
    if (content.toLowerCase().includes(keyword)) {
      return desc;
    }
  }

  return undefined;
}

function extractScalability(content: string): string | undefined {
  const contentLower = content.toLowerCase();

  if (contentLower.includes("billion") && contentLower.includes("request")) {
    return "Enterprise scale (billions of requests)";
  }
  if (contentLower.includes("million") && contentLower.includes("user")) {
    return "High scale (millions of users)";
  }
  if (contentLower.includes("scale") || contentLower.includes("scalab")) {
    return "Designed for scalability";
  }

  return undefined;
}

function extractSecurityCerts(content: string): string[] {
  const certs: string[] = [];
  const contentLower = content.toLowerCase();

  const certPatterns = [
    { keyword: "soc 2", cert: "SOC 2" },
    { keyword: "soc2", cert: "SOC 2" },
    { keyword: "iso 27001", cert: "ISO 27001" },
    { keyword: "hipaa", cert: "HIPAA Compliant" },
    { keyword: "gdpr", cert: "GDPR Compliant" },
    { keyword: "pci", cert: "PCI DSS" },
  ];

  for (const { keyword, cert } of certPatterns) {
    if (contentLower.includes(keyword) && !certs.includes(cert)) {
      certs.push(cert);
    }
  }

  return certs;
}

function assessTechnicalDebt(techStack: string[], repoStats?: { stars: number; contributors: number }): string | undefined {
  if (!techStack.length) return undefined;

  // Look for legacy indicators
  const legacyTech = ["jquery", "angularjs", "backbone"];
  const hasLegacy = techStack.some(t => legacyTech.includes(t.toLowerCase()));

  if (hasLegacy) {
    return "Legacy technology detected - potential technical debt";
  }

  if (repoStats && repoStats.contributors < 3) {
    return "Limited contributor base - potential bus factor risk";
  }

  return "Modern stack with no obvious technical debt indicators";
}

function calculateTechConfidence(findings: TechnicalDDFindings, sources: DDSource[]): number {
  let confidence = 0.3;
  if (findings.techStack.length > 0) confidence += 0.2;
  if (findings.techStack.length >= 5) confidence += 0.1;
  if (findings.repoStats) confidence += 0.15;
  if (findings.securityPosture?.certifications?.length) confidence += 0.15;
  const githubSources = sources.filter(s => s.url?.includes("github.com")).length;
  confidence += Math.min(0.1, githubSources * 0.05);
  return Math.min(0.95, confidence);
}

// ============================================================================
// IP/PATENTS BRANCH
// ============================================================================

interface IPPatentsBranchResult {
  findings: IPPatentsFindings;
  sources: DDSource[];
  confidence: number;
}

export async function executeIPPatentsBranch(
  ctx: any,
  entityName: string,
  entityType: string
): Promise<IPPatentsBranchResult> {
  const now = Date.now();
  const sources: DDSource[] = [];
  let confidence = 0.3;

  try {
    // Search for patent information using Fusion search (free-first, with Linkup fallback)
    const fusionResult = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `${entityName} patents intellectual property USPTO trademark`,
        mode: "balanced",
        maxTotal: 10,
        skipRateLimit: true, // DD jobs run system-side
      }
    );
    // Transform fusion search results to expected format
    const patentResults = fusionResult?.payload?.results ? {
      content: fusionResult.payload.results.map((r: any) => r.snippet).join("\n\n"),
      sources: fusionResult.payload.results.map((r: any) => ({
        url: r.url,
        title: r.title,
      })),
    } : null;

    if (patentResults?.sources) {
      for (const source of patentResults.sources.slice(0, 5)) {
        sources.push({
          sourceType: source.url?.includes("uspto.gov") ? "patent_db" : inferSourceType(source.url),
          url: source.url,
          title: source.title,
          accessedAt: now,
          reliability: source.url?.includes("uspto.gov") ? "authoritative" : inferReliability(source.url),
          section: "ip_patents",
        });
      }
    }

    // Extract patent information
    const patents = extractPatents(patentResults?.content ?? "", entityName);
    const trademarks = extractTrademarks(patentResults?.content ?? "", entityName);

    const findings: IPPatentsFindings = {
      patents,
      pendingApplications: countPendingPatents(patentResults?.content ?? ""),
      trademarks,
      defensibility: assessDefensibility(patents, trademarks),
      ipRisks: identifyIPRisks(patents, patentResults?.content ?? ""),
    };

    confidence = calculateIPConfidence(findings, sources);

    return { findings, sources, confidence };

  } catch (error) {
    console.error(`[DD-IPPatents] Error for ${entityName}:`, error);
    return {
      findings: {
        patents: [],
        pendingApplications: 0,
        trademarks: [],
        ipRisks: [],
      },
      sources,
      confidence: 0.2,
    };
  }
}

function extractPatents(content: string, entityName: string): PatentAuthorship[] {
  const patents: PatentAuthorship[] = [];

  // Pattern for patent numbers
  const patentPatterns = [
    /US\s*(\d{7,10})/gi,
    /patent\s+(?:no\.?|number)?\s*(\d{7,10})/gi,
  ];

  for (const pattern of patentPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const patentId = `US${match[1]}`;
      if (!patents.some(p => p.patentId === patentId)) {
        patents.push({
          patentId,
          title: "Patent title pending verification",
          filingDate: "Unknown",
          coInventors: [],
          assignee: entityName,
          verified: false,
        });
      }
    }
  }

  return patents.slice(0, 10);
}

function extractTrademarks(content: string, entityName: string): string[] {
  const trademarks: string[] = [];

  // The company name is typically trademarked
  trademarks.push(entityName);

  // Look for trademark indicators
  const tmMatches = content.match(/([A-Z][A-Za-z0-9]+)(?:™|®)/g);
  if (tmMatches) {
    for (const tm of tmMatches) {
      const name = tm.replace(/[™®]/g, "").trim();
      if (name && !trademarks.includes(name)) {
        trademarks.push(name);
      }
    }
  }

  return trademarks;
}

function countPendingPatents(content: string): number {
  const pendingMatch = content.match(/(\d+)\s*(?:pending|provisional)\s*patent/i);
  return pendingMatch ? parseInt(pendingMatch[1], 10) : 0;
}

function assessDefensibility(patents: PatentAuthorship[], trademarks: string[]): string {
  if (patents.length >= 5) {
    return "Strong IP portfolio with multiple patents";
  } else if (patents.length > 0) {
    return "Emerging IP portfolio";
  } else if (trademarks.length > 1) {
    return "Brand protection via trademarks";
  }
  return "Limited IP defensibility";
}

function identifyIPRisks(patents: PatentAuthorship[], content: string): string[] {
  const risks: string[] = [];
  const contentLower = content.toLowerCase();

  if (contentLower.includes("litigation") || contentLower.includes("infringement")) {
    risks.push("Potential patent litigation risk");
  }
  if (contentLower.includes("prior art")) {
    risks.push("Prior art challenges possible");
  }
  if (patents.length === 0) {
    risks.push("No patent protection - defensibility concerns");
  }

  return risks;
}

function calculateIPConfidence(findings: IPPatentsFindings, sources: DDSource[]): number {
  let confidence = 0.3;
  if (findings.patents.length > 0) confidence += 0.25;
  if (findings.trademarks.length > 0) confidence += 0.15;
  const usptoSources = sources.filter(s => s.sourceType === "patent_db").length;
  confidence += Math.min(0.2, usptoSources * 0.1);
  return Math.min(0.95, confidence);
}

// ============================================================================
// REGULATORY BRANCH
// ============================================================================

interface RegulatoryBranchResult {
  findings: RegulatoryFindings;
  sources: DDSource[];
  confidence: number;
}

export async function executeRegulatoryBranch(
  ctx: any,
  entityName: string,
  entityType: string
): Promise<RegulatoryBranchResult> {
  const now = Date.now();
  const sources: DDSource[] = [];
  let confidence = 0.3;

  try {
    // Search for regulatory information using Fusion search (free-first, with Linkup fallback)
    const fusionResult = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `${entityName} FDA SEC regulatory approval compliance filing`,
        mode: "balanced",
        maxTotal: 10,
        skipRateLimit: true, // DD jobs run system-side
      }
    );
    // Transform fusion search results to expected format
    const regResults = fusionResult?.payload?.results ? {
      content: fusionResult.payload.results.map((r: any) => r.snippet).join("\n\n"),
      sources: fusionResult.payload.results.map((r: any) => ({
        url: r.url,
        title: r.title,
      })),
    } : null;

    if (regResults?.sources) {
      for (const source of regResults.sources.slice(0, 5)) {
        const isSEC = source.url?.includes("sec.gov");
        const isFDA = source.url?.includes("fda.gov");
        sources.push({
          sourceType: isSEC ? "sec_filing" : inferSourceType(source.url),
          url: source.url,
          title: source.title,
          accessedAt: now,
          reliability: (isSEC || isFDA) ? "authoritative" : inferReliability(source.url),
          section: "regulatory",
        });
      }
    }

    // Extract regulatory information
    const findings: RegulatoryFindings = {
      regulatoryBody: detectRegulatoryBody(regResults?.content ?? ""),
      currentStatus: detectCurrentStatus(regResults?.content ?? ""),
      filings: extractFilings(regResults?.content ?? ""),
      approvals: extractApprovals(regResults?.content ?? ""),
      pendingApprovals: extractPendingApprovals(regResults?.content ?? ""),
      complianceRisks: identifyComplianceRisks(regResults?.content ?? ""),
      timeToApproval: estimateTimeToApproval(regResults?.content ?? ""),
    };

    confidence = calculateRegConfidence(findings, sources);

    return { findings, sources, confidence };

  } catch (error) {
    console.error(`[DD-Regulatory] Error for ${entityName}:`, error);
    return {
      findings: {
        filings: [],
        approvals: [],
        pendingApprovals: [],
        complianceRisks: [],
      },
      sources,
      confidence: 0.2,
    };
  }
}

function detectRegulatoryBody(content: string): string | undefined {
  const contentLower = content.toLowerCase();
  if (contentLower.includes("fda")) return "FDA";
  if (contentLower.includes("sec")) return "SEC";
  if (contentLower.includes("finra")) return "FINRA";
  if (contentLower.includes("ema")) return "EMA";
  return undefined;
}

function detectCurrentStatus(content: string): string | undefined {
  const contentLower = content.toLowerCase();

  const statusPatterns = [
    { keyword: "approved", status: "Approved" },
    { keyword: "pending approval", status: "Pending Approval" },
    { keyword: "phase 3", status: "Phase 3 Clinical Trials" },
    { keyword: "phase 2", status: "Phase 2 Clinical Trials" },
    { keyword: "phase 1", status: "Phase 1 Clinical Trials" },
    { keyword: "pre-clinical", status: "Pre-Clinical" },
    { keyword: "under review", status: "Under Review" },
    { keyword: "registered", status: "Registered" },
  ];

  for (const { keyword, status } of statusPatterns) {
    if (contentLower.includes(keyword)) {
      return status;
    }
  }

  return undefined;
}

function extractFilings(content: string): Array<{ type: string; date: string; status: string }> {
  const filings: Array<{ type: string; date: string; status: string }> = [];
  const contentLower = content.toLowerCase();

  const filingTypes = [
    { keyword: "form d", type: "Form D (SEC)" },
    { keyword: "s-1", type: "S-1 (IPO)" },
    { keyword: "10-k", type: "10-K (Annual)" },
    { keyword: "10-q", type: "10-Q (Quarterly)" },
    { keyword: "ind", type: "IND (FDA)" },
    { keyword: "nda", type: "NDA (FDA)" },
    { keyword: "bla", type: "BLA (FDA)" },
  ];

  for (const { keyword, type } of filingTypes) {
    if (contentLower.includes(keyword)) {
      filings.push({
        type,
        date: "Date pending verification",
        status: "Filed",
      });
    }
  }

  return filings;
}

function extractApprovals(content: string): string[] {
  const approvals: string[] = [];
  const contentLower = content.toLowerCase();

  if (contentLower.includes("fda approved")) approvals.push("FDA Approved");
  if (contentLower.includes("ce marked") || contentLower.includes("ce mark")) approvals.push("CE Marked");
  if (contentLower.includes("iso certified")) approvals.push("ISO Certified");

  return approvals;
}

function extractPendingApprovals(content: string): string[] {
  const pending: string[] = [];
  const contentLower = content.toLowerCase();

  if (contentLower.includes("pending fda")) pending.push("FDA Approval");
  if (contentLower.includes("awaiting approval")) pending.push("Regulatory Approval");

  return pending;
}

function identifyComplianceRisks(content: string): string[] {
  const risks: string[] = [];
  const contentLower = content.toLowerCase();

  if (contentLower.includes("warning letter")) risks.push("FDA warning letter history");
  if (contentLower.includes("compliance issue")) risks.push("Historical compliance issues");
  if (contentLower.includes("investigation")) risks.push("Regulatory investigation");
  if (contentLower.includes("audit finding")) risks.push("Audit findings");

  return risks;
}

function estimateTimeToApproval(content: string): string | undefined {
  const contentLower = content.toLowerCase();

  if (contentLower.includes("fast track") || contentLower.includes("breakthrough")) {
    return "Accelerated timeline possible";
  }
  if (contentLower.includes("phase 3")) {
    return "12-24 months to potential approval";
  }
  if (contentLower.includes("phase 2")) {
    return "24-36 months to potential approval";
  }

  return undefined;
}

function calculateRegConfidence(findings: RegulatoryFindings, sources: DDSource[]): number {
  let confidence = 0.3;
  if (findings.regulatoryBody) confidence += 0.15;
  if (findings.currentStatus) confidence += 0.15;
  if (findings.filings.length > 0) confidence += 0.15;
  const authSources = sources.filter(s => s.reliability === "authoritative").length;
  confidence += Math.min(0.2, authSources * 0.1);
  return Math.min(0.95, confidence);
}

// ============================================================================
// FINANCIAL DEEP BRANCH
// ============================================================================

interface FinancialDeepBranchResult {
  findings: FinancialDeepFindings;
  sources: DDSource[];
  confidence: number;
}

export async function executeFinancialDeepBranch(
  ctx: any,
  entityName: string,
  entityType: string
): Promise<FinancialDeepBranchResult> {
  const now = Date.now();
  const sources: DDSource[] = [];
  let confidence = 0.3;

  try {
    // Get entity context for funding data
    let entityContext;
    try {
      entityContext = await ctx.runQuery(
        api.domains.knowledge.entityContexts.getByName,
        { entityName }
      );
    } catch {}

    // Search for detailed funding information using Fusion search (free-first, with Linkup fallback)
    const fusionResult = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `${entityName} funding round series valuation investors burn rate`,
        mode: "balanced",
        maxTotal: 10,
        skipRateLimit: true, // DD jobs run system-side
      }
    );
    // Transform fusion search results to expected format
    const fundingResults = fusionResult?.payload?.results ? {
      content: fusionResult.payload.results.map((r: any) => r.snippet).join("\n\n"),
      sources: fusionResult.payload.results.map((r: any) => ({
        url: r.url,
        title: r.title,
      })),
    } : null;

    if (fundingResults?.sources) {
      for (const source of fundingResults.sources.slice(0, 5)) {
        sources.push({
          sourceType: inferSourceType(source.url),
          url: source.url,
          title: source.title,
          accessedAt: now,
          reliability: inferReliability(source.url),
          section: "financial_analysis",
        });
      }
    }

    // Extract funding history
    const fundingHistory = extractFundingHistory(
      entityContext?.funding,
      fundingResults?.content ?? ""
    );

    const findings: FinancialDeepFindings = {
      fundingHistory,
      totalRaised: calculateTotalRaised(fundingHistory),
      burnRate: extractBurnRate(fundingResults?.content ?? ""),
      runway: extractRunway(fundingResults?.content ?? ""),
      revenue: extractRevenue(fundingResults?.content ?? ""),
      revenueGrowth: extractRevenueGrowth(fundingResults?.content ?? ""),
      unitEconomics: extractUnitEconomics(fundingResults?.content ?? ""),
      valuationComps: extractValuationComps(fundingResults?.content ?? "", entityName),
    };

    confidence = calculateFinancialConfidence(findings, sources);

    return { findings, sources, confidence };

  } catch (error) {
    console.error(`[DD-FinancialDeep] Error for ${entityName}:`, error);
    return {
      findings: { fundingHistory: [] },
      sources,
      confidence: 0.2,
    };
  }
}

function extractFundingHistory(
  contextFunding: any,
  content: string
): Array<{
  roundType: string;
  date?: string;
  amount?: string;
  leadInvestors?: string[];
  valuation?: string;
  verified?: boolean;
  source?: string;
}> {
  const history: Array<{
    roundType: string;
    date?: string;
    amount?: string;
    leadInvestors?: string[];
    valuation?: string;
    verified?: boolean;
    source?: string;
  }> = [];

  // Extract from entity context if available
  if (contextFunding?.lastRound) {
    history.push({
      roundType: contextFunding.lastRound.roundType ?? "Unknown",
      amount: contextFunding.lastRound.amount
        ? `$${contextFunding.lastRound.amount.amount}${contextFunding.lastRound.amount.unit}`
        : undefined,
      leadInvestors: contextFunding.lastRound.coLeads,
      verified: true,
      source: "Entity Context",
    });
  }

  // Extract from content
  const roundPatterns = [
    { keyword: "seed round", type: "Seed" },
    { keyword: "series a", type: "Series A" },
    { keyword: "series b", type: "Series B" },
    { keyword: "series c", type: "Series C" },
    { keyword: "series d", type: "Series D" },
  ];

  for (const { keyword, type } of roundPatterns) {
    if (content.toLowerCase().includes(keyword) && !history.some(h => h.roundType === type)) {
      // Try to extract amount
      const amountMatch = content.match(new RegExp(`${keyword}[^$]*\\$([\\d.]+)\\s*(million|billion|M|B)`, "i"));

      history.push({
        roundType: type,
        amount: amountMatch ? `$${amountMatch[1]}${amountMatch[2].charAt(0).toUpperCase()}` : undefined,
        verified: false,
        source: "News",
      });
    }
  }

  return history;
}

function calculateTotalRaised(fundingHistory: Array<{ amount?: string }>): { amount: number; currency: string; unit: string } | undefined {
  let totalMillions = 0;

  for (const round of fundingHistory) {
    if (round.amount) {
      const match = round.amount.match(/\$?([\d.]+)\s*(M|B)/i);
      if (match) {
        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();
        totalMillions += unit === "B" ? value * 1000 : value;
      }
    }
  }

  if (totalMillions > 0) {
    const unit = totalMillions >= 1000 ? "B" : "M";
    const amount = totalMillions >= 1000 ? totalMillions / 1000 : totalMillions;
    return { amount, currency: "USD", unit };
  }

  return undefined;
}

function extractBurnRate(content: string): string | undefined {
  const burnMatch = content.match(/burn(?:ing)?\s+(?:rate)?\s*(?:of)?\s*\$?([\d.]+)\s*(million|M)/i);
  if (burnMatch) {
    return `$${burnMatch[1]}M/month`;
  }
  return undefined;
}

function extractRunway(content: string): string | undefined {
  const runwayMatch = content.match(/runway\s+(?:of)?\s*(\d+)\s*months?/i);
  if (runwayMatch) {
    return `${runwayMatch[1]} months`;
  }
  return undefined;
}

function extractRevenue(content: string): string | undefined {
  const revenueMatch = content.match(/(?:revenue|arr)\s+(?:of)?\s*\$?([\d.]+)\s*(million|billion|M|B)/i);
  if (revenueMatch) {
    return `$${revenueMatch[1]}${revenueMatch[2].charAt(0).toUpperCase()}`;
  }
  return undefined;
}

function extractRevenueGrowth(content: string): string | undefined {
  const growthMatch = content.match(/revenue\s+(?:growth|growing)\s+(?:of)?\s*(\d+)%/i);
  if (growthMatch) {
    return `${growthMatch[1]}% YoY`;
  }
  return undefined;
}

function extractUnitEconomics(content: string): string | undefined {
  const contentLower = content.toLowerCase();

  if (contentLower.includes("profitable") || contentLower.includes("positive unit economics")) {
    return "Positive unit economics";
  }
  if (contentLower.includes("path to profitability")) {
    return "On path to profitability";
  }

  return undefined;
}

function extractValuationComps(content: string, entityName: string): Array<{ company: string; valuation: string; multiple?: number }> | undefined {
  // This would typically require more sophisticated parsing
  // For now, return undefined - would be enhanced with actual comps data
  return undefined;
}

function calculateFinancialConfidence(findings: FinancialDeepFindings, sources: DDSource[]): number {
  let confidence = 0.3;
  if (findings.fundingHistory.length > 0) confidence += 0.2;
  if (findings.totalRaised) confidence += 0.15;
  if (findings.fundingHistory.some(f => f.verified)) confidence += 0.15;
  const crunchbaseSources = sources.filter(s => s.url?.includes("crunchbase")).length;
  confidence += Math.min(0.15, crunchbaseSources * 0.075);
  return Math.min(0.95, confidence);
}

// ============================================================================
// NETWORK MAPPING BRANCH
// ============================================================================

interface NetworkMappingBranchResult {
  findings: NetworkMappingFindings;
  sources: DDSource[];
  confidence: number;
}

export async function executeNetworkMappingBranch(
  ctx: any,
  entityName: string,
  entityType: string
): Promise<NetworkMappingBranchResult> {
  const now = Date.now();
  const sources: DDSource[] = [];
  let confidence = 0.3;

  try {
    // Get entity context for people data
    let entityContext;
    try {
      entityContext = await ctx.runQuery(
        api.domains.knowledge.entityContexts.getByName,
        { entityName }
      );
    } catch {}

    // Search for investor and relationship information using Fusion search (free-first, with Linkup fallback)
    const fusionResult = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `${entityName} investors board members advisors network connections`,
        mode: "balanced",
        maxTotal: 10,
        skipRateLimit: true, // DD jobs run system-side
      }
    );
    // Transform fusion search results to expected format
    const networkResults = fusionResult?.payload?.results ? {
      content: fusionResult.payload.results.map((r: any) => r.snippet).join("\n\n"),
      sources: fusionResult.payload.results.map((r: any) => ({
        url: r.url,
        title: r.title,
      })),
    } : null;

    if (networkResults?.sources) {
      for (const source of networkResults.sources.slice(0, 5)) {
        sources.push({
          sourceType: inferSourceType(source.url),
          url: source.url,
          title: source.title,
          accessedAt: now,
          reliability: inferReliability(source.url),
          section: "network_mapping",
        });
      }
    }

    // Build network graph
    const { nodes, edges } = buildNetworkGraph(entityContext, networkResults?.content ?? "", entityName);

    const findings: NetworkMappingFindings = {
      networkGraph: { nodes, edges },
      keyConnections: extractKeyConnections(networkResults?.content ?? ""),
      investorNetwork: extractInvestorNetwork(entityContext, networkResults?.content ?? ""),
      advisorNetwork: extractAdvisorNetwork(entityContext, networkResults?.content ?? ""),
      potentialConflicts: identifyPotentialConflicts(networkResults?.content ?? ""),
      referenceability: assessReferenceability(nodes, edges),
    };

    confidence = calculateNetworkConfidence(findings, sources);

    return { findings, sources, confidence };

  } catch (error) {
    console.error(`[DD-NetworkMapping] Error for ${entityName}:`, error);
    return {
      findings: {
        networkGraph: { nodes: [], edges: [] },
        keyConnections: [],
        investorNetwork: [],
        advisorNetwork: [],
        potentialConflicts: [],
        referenceability: 0.3,
      },
      sources,
      confidence: 0.2,
    };
  }
}

function buildNetworkGraph(
  entityContext: any,
  content: string,
  entityName: string
): {
  nodes: Array<{ id: string; name: string; type: "person" | "company" | "investor" }>;
  edges: Array<{ source: string; target: string; relationship: string }>;
} {
  const nodes: Array<{ id: string; name: string; type: "person" | "company" | "investor" }> = [];
  const edges: Array<{ source: string; target: string; relationship: string }> = [];

  // Add company as central node
  const companyId = `company-${entityName.toLowerCase().replace(/\s+/g, "-")}`;
  nodes.push({ id: companyId, name: entityName, type: "company" });

  // Add people from entity context
  if (entityContext?.people) {
    const people = [
      ...(entityContext.people.founders ?? []),
      ...(entityContext.people.executives ?? []),
    ];

    for (const person of people) {
      const personId = `person-${person.name.toLowerCase().replace(/\s+/g, "-")}`;
      if (!nodes.some(n => n.id === personId)) {
        nodes.push({ id: personId, name: person.name, type: "person" });
        edges.push({
          source: personId,
          target: companyId,
          relationship: person.role ?? "team member",
        });
      }
    }
  }

  // Extract investors and add to graph
  const investorNames = extractInvestorNames(content);
  for (const investor of investorNames.slice(0, 5)) {
    const investorId = `investor-${investor.toLowerCase().replace(/\s+/g, "-")}`;
    if (!nodes.some(n => n.id === investorId)) {
      nodes.push({ id: investorId, name: investor, type: "investor" });
      edges.push({
        source: investorId,
        target: companyId,
        relationship: "investor",
      });
    }
  }

  return { nodes, edges };
}

function extractInvestorNames(content: string): string[] {
  const investors: string[] = [];

  // Known VC/PE firms
  const knownInvestors = [
    "Sequoia", "Andreessen Horowitz", "a16z", "Kleiner Perkins", "Accel",
    "Lightspeed", "Greylock", "NEA", "Index Ventures", "Benchmark",
    "General Catalyst", "Tiger Global", "Coatue", "SoftBank", "GV",
  ];

  for (const investor of knownInvestors) {
    if (content.includes(investor) && !investors.includes(investor)) {
      investors.push(investor);
    }
  }

  return investors;
}

function extractKeyConnections(content: string): string[] {
  const connections: string[] = [];
  const contentLower = content.toLowerCase();

  if (contentLower.includes("backed by")) {
    const match = content.match(/backed by ([A-Z][A-Za-z\s,]+)/);
    if (match) connections.push(`Backed by ${match[1].split(",")[0].trim()}`);
  }

  if (contentLower.includes("partnership")) {
    connections.push("Strategic partnership(s) identified");
  }

  return connections;
}

function extractInvestorNetwork(entityContext: any, content: string): string[] {
  const network: string[] = [];

  // From entity context
  if (entityContext?.funding?.lastRound?.coLeads) {
    network.push(...entityContext.funding.lastRound.coLeads);
  }
  if (entityContext?.funding?.lastRound?.participants) {
    network.push(...entityContext.funding.lastRound.participants);
  }

  // From content
  network.push(...extractInvestorNames(content));

  return [...new Set(network)];
}

function extractAdvisorNetwork(entityContext: any, content: string): string[] {
  const advisors: string[] = [];

  // Look for advisor mentions in content
  const advisorMatch = content.match(/advisor[s]?[:\s]+([A-Z][A-Za-z\s,]+)/i);
  if (advisorMatch) {
    const names = advisorMatch[1].split(",").map(n => n.trim());
    advisors.push(...names.filter(n => n.length > 2));
  }

  return advisors.slice(0, 5);
}

function identifyPotentialConflicts(content: string): string[] {
  const conflicts: string[] = [];
  const contentLower = content.toLowerCase();

  if (contentLower.includes("competing") || contentLower.includes("competitor")) {
    conflicts.push("Potential competitive conflict identified");
  }

  if (contentLower.includes("litigation") || contentLower.includes("lawsuit")) {
    conflicts.push("Legal conflict history");
  }

  return conflicts;
}

function assessReferenceability(
  nodes: Array<{ type: string }>,
  edges: Array<{ relationship: string }>
): number {
  // More connections = more referenceable
  const personNodes = nodes.filter(n => n.type === "person").length;
  const investorNodes = nodes.filter(n => n.type === "investor").length;

  let score = 0.3;
  score += Math.min(0.3, personNodes * 0.05);
  score += Math.min(0.3, investorNodes * 0.1);

  return Math.min(0.95, score);
}

function calculateNetworkConfidence(findings: NetworkMappingFindings, sources: DDSource[]): number {
  let confidence = 0.3;
  if (findings.networkGraph.nodes.length > 3) confidence += 0.2;
  if (findings.investorNetwork.length > 0) confidence += 0.2;
  if (findings.keyConnections.length > 0) confidence += 0.15;
  return Math.min(0.95, confidence);
}

// ============================================================================
// SHARED HELPERS
// ============================================================================

function inferSourceType(url?: string): SourceType {
  if (!url) return "llm_inference";

  const urlLower = url.toLowerCase();

  if (urlLower.includes("sec.gov")) return "sec_filing";
  if (urlLower.includes("linkedin.com")) return "linkedin";
  if (urlLower.includes("crunchbase.com")) return "crunchbase";
  if (urlLower.includes("pitchbook.com")) return "pitchbook";
  if (urlLower.includes("uspto.gov") || urlLower.includes("patents.google.com")) return "patent_db";

  return "news_article";
}

function inferReliability(url?: string): SourceReliability {
  if (!url) return "inferred";

  const urlLower = url.toLowerCase();

  if (urlLower.includes("sec.gov") || urlLower.includes("uspto.gov") || urlLower.includes("fda.gov")) {
    return "authoritative";
  }

  if (urlLower.includes("linkedin.com") || urlLower.includes("crunchbase.com") || urlLower.includes("pitchbook.com")) {
    return "reliable";
  }

  return "secondary";
}
