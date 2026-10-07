/**
 * companyProfile.ts
 *
 * Core branch handler for company profile research.
 * Extracts basic company information, products, milestones, and social presence.
 */

"use node";

import { api, internal } from "../../../../_generated/api";
import {
  CompanyProfileFindings,
  DDSource,
  SourceReliability,
  SourceType,
} from "../types";

// ============================================================================
// Types
// ============================================================================

interface BranchResult {
  findings: CompanyProfileFindings;
  sources: DDSource[];
  confidence: number;
}

// ============================================================================
// Main Execution
// ============================================================================

/**
 * Execute company profile branch
 */
export async function executeCompanyProfileBranch(
  ctx: any,
  entityName: string,
  entityType: string
): Promise<BranchResult> {
  const now = Date.now();
  const sources: DDSource[] = [];
  let confidence = 0.3; // Base confidence

  try {
    // 1. Try to get existing entity context
    const entityContext = await tryGetEntityContext(ctx, entityName);

    if (entityContext) {
      sources.push({
        sourceType: "llm_inference",
        title: "Cached Entity Context",
        accessedAt: now,
        reliability: "secondary",
        section: "company_overview",
      });
      confidence += 0.2;
    }

    // 2. Search for company information via Linkup
    const linkupResults = await searchCompanyInfo(ctx, entityName);

    if (linkupResults?.sources?.length > 0) {
      for (const source of linkupResults.sources.slice(0, 5)) {
        sources.push({
          sourceType: inferSourceType(source.url),
          url: source.url,
          title: source.title,
          accessedAt: now,
          reliability: inferReliability(source.url),
          section: "company_overview",
        });
      }
      confidence += 0.2;
    }

    // 3. Build findings from all sources
    const findings = buildFindings(entityContext, linkupResults, entityName);

    // 4. Calculate final confidence based on data quality
    confidence = calculateConfidence(findings, sources);

    return { findings, sources, confidence };

  } catch (error) {
    console.error(`[DD-CompanyProfile] Error for ${entityName}:`, error);

    // Return minimal findings with low confidence
    return {
      findings: {
        description: `${entityName} - research pending`,
        sectors: [],
        keyProducts: [],
        recentMilestones: [],
      },
      sources,
      confidence: 0.2,
    };
  }
}

// ============================================================================
// Data Fetching
// ============================================================================

async function tryGetEntityContext(ctx: any, entityName: string): Promise<any> {
  try {
    // Try to find existing entity context
    const result = await ctx.runQuery(
      api.domains.knowledge.entityContexts.getByName,
      { entityName }
    );
    return result;
  } catch {
    return null;
  }
}

async function searchCompanyInfo(ctx: any, entityName: string): Promise<any> {
  try {
    // Use Fusion search to get company information (free-first, with Linkup fallback)
    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `${entityName} company overview headquarters founded products`,
        mode: "balanced",
        maxTotal: 10,
        skipRateLimit: true, // DD jobs run system-side
      }
    );
    // Transform fusion search results to expected format
    if (result?.payload?.results) {
      return {
        content: result.payload.results.map((r: any) => r.snippet).join("\n\n"),
        sources: result.payload.results.map((r: any) => ({
          url: r.url,
          title: r.title,
        })),
      };
    }
    return null;
  } catch (e) {
    console.error("[DD-CompanyProfile] Search failed:", e);
    return null;
  }
}

// ============================================================================
// Findings Builder
// ============================================================================

function buildFindings(
  entityContext: any,
  linkupResults: any,
  entityName: string
): CompanyProfileFindings {
  const findings: CompanyProfileFindings = {
    description: "",
    sectors: [],
    keyProducts: [],
    recentMilestones: [],
  };

  // Extract from entity context if available
  if (entityContext) {
    findings.description = entityContext.summary ?? "";
    findings.hqLocation = entityContext.crmFields?.hqLocation;
    findings.foundedYear = entityContext.crmFields?.foundedYear;
    findings.employeeCount = entityContext.crmFields?.employeeCount;
    findings.website = entityContext.crmFields?.website;

    // Extract sectors from summary
    if (entityContext.summary) {
      findings.sectors = extractSectors(entityContext.summary);
    }

    // Extract products from product pipeline
    if (entityContext.productPipeline?.leadPrograms) {
      findings.keyProducts = entityContext.productPipeline.leadPrograms.map(
        (p: any) => p.program || p.name
      ).filter(Boolean);
    }

    // Extract milestones from recent news
    if (entityContext.recentNewsItems) {
      findings.recentMilestones = entityContext.recentNewsItems
        .slice(0, 5)
        .map((n: any) => n.title)
        .filter(Boolean);
    }

    // Extract business model
    if (entityContext.crmFields?.businessModel) {
      findings.businessModel = entityContext.crmFields.businessModel;
    }

    // Extract stage
    if (entityContext.funding?.stage) {
      findings.stage = entityContext.funding.stage;
    }
  }

  // Enrich from Linkup results if available
  if (linkupResults?.content) {
    // If description is still empty, use Linkup content
    if (!findings.description) {
      findings.description = extractDescription(linkupResults.content, entityName);
    }

    // Extract additional sectors
    const newSectors = extractSectors(linkupResults.content);
    findings.sectors = [...new Set([...findings.sectors, ...newSectors])];

    // Extract social presence from URLs
    if (linkupResults.sources) {
      findings.socialPresence = extractSocialPresence(linkupResults.sources);
    }
  }

  // Set default description if still empty
  if (!findings.description) {
    findings.description = `${entityName} is a company currently under research.`;
  }

  return findings;
}

// ============================================================================
// Extraction Helpers
// ============================================================================

function extractSectors(text: string): string[] {
  const sectors: string[] = [];
  const textLower = text.toLowerCase();

  const sectorKeywords: Record<string, string[]> = {
    "Biotech": ["biotech", "biotechnology", "pharmaceutical", "pharma", "drug development"],
    "AI/ML": ["artificial intelligence", "machine learning", "ai", "deep learning", "neural network"],
    "Fintech": ["fintech", "financial technology", "payments", "banking software"],
    "HealthTech": ["healthtech", "health tech", "digital health", "healthcare technology"],
    "Cybersecurity": ["cybersecurity", "security", "infosec", "cyber security"],
    "SaaS": ["saas", "software as a service", "cloud software"],
    "DevTools": ["developer tools", "devtools", "development platform"],
    "Enterprise": ["enterprise software", "b2b", "enterprise saas"],
    "Consumer": ["consumer", "b2c", "consumer app"],
    "Hardware": ["hardware", "semiconductor", "chip", "device"],
    "Crypto": ["crypto", "blockchain", "web3", "cryptocurrency"],
    "CleanTech": ["cleantech", "clean technology", "renewable", "sustainability"],
    "EdTech": ["edtech", "education technology", "e-learning"],
    "PropTech": ["proptech", "real estate tech", "property technology"],
  };

  for (const [sector, keywords] of Object.entries(sectorKeywords)) {
    if (keywords.some(kw => textLower.includes(kw))) {
      sectors.push(sector);
    }
  }

  return sectors;
}

function extractDescription(content: string, entityName: string): string {
  // Try to find the first sentence that mentions the company name
  const sentences = content.split(/[.!?]+/).map(s => s.trim());

  for (const sentence of sentences) {
    if (sentence.toLowerCase().includes(entityName.toLowerCase()) && sentence.length > 20) {
      return sentence + ".";
    }
  }

  // Fall back to first 200 chars
  return content.slice(0, 200).trim() + "...";
}

function extractSocialPresence(sources: Array<{ url: string; title?: string }>): {
  twitter?: string;
  linkedin?: string;
  github?: string;
} {
  const presence: { twitter?: string; linkedin?: string; github?: string } = {};

  for (const source of sources) {
    const url = source.url?.toLowerCase() ?? "";
    if (url.includes("twitter.com") || url.includes("x.com")) {
      presence.twitter = source.url;
    } else if (url.includes("linkedin.com")) {
      presence.linkedin = source.url;
    } else if (url.includes("github.com")) {
      presence.github = source.url;
    }
  }

  return presence;
}

// ============================================================================
// Source Inference
// ============================================================================

function inferSourceType(url?: string): SourceType {
  if (!url) return "llm_inference";

  const urlLower = url.toLowerCase();

  if (urlLower.includes("sec.gov")) return "sec_filing";
  if (urlLower.includes("linkedin.com")) return "linkedin";
  if (urlLower.includes("crunchbase.com")) return "crunchbase";
  if (urlLower.includes("pitchbook.com")) return "pitchbook";
  if (urlLower.includes("patents.google.com") || urlLower.includes("uspto.gov")) return "patent_db";

  // Check for company websites (usually .com, .io, etc. without news indicators)
  if (!urlLower.includes("news") &&
      !urlLower.includes("article") &&
      !urlLower.includes("blog") &&
      (urlLower.endsWith(".com") || urlLower.endsWith(".io") || urlLower.endsWith(".co"))) {
    return "company_website";
  }

  return "news_article";
}

function inferReliability(url?: string): SourceReliability {
  if (!url) return "inferred";

  const urlLower = url.toLowerCase();

  // Authoritative sources
  if (urlLower.includes("sec.gov") ||
      urlLower.includes("uspto.gov") ||
      urlLower.includes("fda.gov")) {
    return "authoritative";
  }

  // Reliable sources
  if (urlLower.includes("linkedin.com") ||
      urlLower.includes("crunchbase.com") ||
      urlLower.includes("pitchbook.com") ||
      urlLower.includes("bloomberg.com") ||
      urlLower.includes("reuters.com") ||
      urlLower.includes("wsj.com") ||
      urlLower.includes("techcrunch.com")) {
    return "reliable";
  }

  return "secondary";
}

// ============================================================================
// Confidence Calculation
// ============================================================================

function calculateConfidence(
  findings: CompanyProfileFindings,
  sources: DDSource[]
): number {
  let confidence = 0.3; // Base

  // Description quality
  if (findings.description && findings.description.length > 100) {
    confidence += 0.15;
  }

  // Location data
  if (findings.hqLocation) confidence += 0.1;

  // Founded year
  if (findings.foundedYear) confidence += 0.1;

  // Sectors identified
  if (findings.sectors.length > 0) confidence += 0.1;

  // Products identified
  if (findings.keyProducts.length > 0) confidence += 0.1;

  // Source quality bonus
  const authoritativeSources = sources.filter(s => s.reliability === "authoritative").length;
  const reliableSources = sources.filter(s => s.reliability === "reliable").length;

  confidence += Math.min(0.15, authoritativeSources * 0.05);
  confidence += Math.min(0.1, reliableSources * 0.02);

  return Math.min(0.95, confidence);
}
