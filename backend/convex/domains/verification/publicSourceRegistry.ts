/**
 * Public Source Registry
 *
 * Authoritative source definitions for ground truth verification.
 * Maps domains and source types to credibility tiers and verification methods.
 *
 * AUDITABLE SOURCES (Tier 1 - Primary):
 * - SEC EDGAR: Company filings (10-K, 10-Q, 8-K, S-1)
 * - arXiv: Academic preprints
 * - PubMed/PMC: Medical research
 * - USPTO: Patents
 * - Company IR: Official investor relations pages
 * - Government: .gov domains
 *
 * RELIABLE SOURCES (Tier 2 - Secondary):
 * - Major news outlets with editorial standards
 * - Verified company blogs/announcements
 * - Industry publications
 *
 * UNVERIFIED SOURCES (Tier 3):
 * - Social media
 * - Anonymous sources
 * - User-generated content
 *
 * @module domains/verification/publicSourceRegistry
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "../../_generated/server";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type CredibilityTier = "tier1_authoritative" | "tier2_reliable" | "tier3_unverified";

export type SourceCategory =
  | "regulatory_filing"      // SEC, FDA, etc.
  | "academic_research"      // arXiv, PubMed, journals
  | "company_official"       // IR pages, press releases
  | "government"             // .gov sources
  | "news_outlet"            // Major news with editorial
  | "industry_publication"   // Trade press
  | "social_media"           // Twitter, LinkedIn, etc.
  | "user_generated"         // Blogs, forums
  | "unknown";

export interface SourceDefinition {
  domain: string;
  displayName: string;
  tier: CredibilityTier;
  category: SourceCategory;
  verificationMethod: "api" | "scrape" | "manual" | "none";
  apiEndpoint?: string;
  requiresApiKey?: boolean;
  updateFrequency: "realtime" | "daily" | "weekly" | "manual";
  notes?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTHORITATIVE SOURCE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

export const AUTHORITATIVE_SOURCES: Record<string, SourceDefinition> = {
  // Tier 1: Regulatory/Government
  "sec.gov": {
    domain: "sec.gov",
    displayName: "SEC EDGAR",
    tier: "tier1_authoritative",
    category: "regulatory_filing",
    verificationMethod: "api",
    apiEndpoint: "https://data.sec.gov/",
    updateFrequency: "realtime",
    notes: "Official SEC filings. CIK lookup available.",
  },
  "edgar-online.com": {
    domain: "edgar-online.com",
    displayName: "EDGAR Online",
    tier: "tier1_authoritative",
    category: "regulatory_filing",
    verificationMethod: "api",
    updateFrequency: "realtime",
  },
  "fda.gov": {
    domain: "fda.gov",
    displayName: "FDA",
    tier: "tier1_authoritative",
    category: "regulatory_filing",
    verificationMethod: "scrape",
    updateFrequency: "daily",
    notes: "Drug approvals, clinical trial results, recalls.",
  },
  "clinicaltrials.gov": {
    domain: "clinicaltrials.gov",
    displayName: "ClinicalTrials.gov",
    tier: "tier1_authoritative",
    category: "regulatory_filing",
    verificationMethod: "api",
    apiEndpoint: "https://clinicaltrials.gov/api/v2/",
    updateFrequency: "daily",
    notes: "Official clinical trial registry.",
  },
  "uspto.gov": {
    domain: "uspto.gov",
    displayName: "USPTO",
    tier: "tier1_authoritative",
    category: "regulatory_filing",
    verificationMethod: "api",
    updateFrequency: "weekly",
    notes: "Patent filings and grants.",
  },

  // Tier 1: Academic
  "arxiv.org": {
    domain: "arxiv.org",
    displayName: "arXiv",
    tier: "tier1_authoritative",
    category: "academic_research",
    verificationMethod: "api",
    apiEndpoint: "https://export.arxiv.org/api/",
    updateFrequency: "daily",
    notes: "Preprints with DOI. Not peer-reviewed.",
  },
  "pubmed.ncbi.nlm.nih.gov": {
    domain: "pubmed.ncbi.nlm.nih.gov",
    displayName: "PubMed",
    tier: "tier1_authoritative",
    category: "academic_research",
    verificationMethod: "api",
    apiEndpoint: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
    updateFrequency: "daily",
    notes: "Peer-reviewed medical literature.",
  },
  "doi.org": {
    domain: "doi.org",
    displayName: "DOI Resolver",
    tier: "tier1_authoritative",
    category: "academic_research",
    verificationMethod: "api",
    updateFrequency: "realtime",
    notes: "Resolves to authoritative source.",
  },
  "nature.com": {
    domain: "nature.com",
    displayName: "Nature",
    tier: "tier1_authoritative",
    category: "academic_research",
    verificationMethod: "scrape",
    updateFrequency: "daily",
  },
  "science.org": {
    domain: "science.org",
    displayName: "Science",
    tier: "tier1_authoritative",
    category: "academic_research",
    verificationMethod: "scrape",
    updateFrequency: "daily",
  },

  // Tier 2: Major News
  "reuters.com": {
    domain: "reuters.com",
    displayName: "Reuters",
    tier: "tier2_reliable",
    category: "news_outlet",
    verificationMethod: "scrape",
    updateFrequency: "realtime",
    notes: "Wire service with editorial standards.",
  },
  "apnews.com": {
    domain: "apnews.com",
    displayName: "Associated Press",
    tier: "tier2_reliable",
    category: "news_outlet",
    verificationMethod: "scrape",
    updateFrequency: "realtime",
  },
  "bloomberg.com": {
    domain: "bloomberg.com",
    displayName: "Bloomberg",
    tier: "tier2_reliable",
    category: "news_outlet",
    verificationMethod: "scrape",
    updateFrequency: "realtime",
    notes: "Financial news with editorial standards.",
  },
  "wsj.com": {
    domain: "wsj.com",
    displayName: "Wall Street Journal",
    tier: "tier2_reliable",
    category: "news_outlet",
    verificationMethod: "scrape",
    updateFrequency: "realtime",
  },
  "nytimes.com": {
    domain: "nytimes.com",
    displayName: "New York Times",
    tier: "tier2_reliable",
    category: "news_outlet",
    verificationMethod: "scrape",
    updateFrequency: "realtime",
  },
  "ft.com": {
    domain: "ft.com",
    displayName: "Financial Times",
    tier: "tier2_reliable",
    category: "news_outlet",
    verificationMethod: "scrape",
    updateFrequency: "realtime",
  },

  // Tier 2: Industry Publications
  "techcrunch.com": {
    domain: "techcrunch.com",
    displayName: "TechCrunch",
    tier: "tier2_reliable",
    category: "industry_publication",
    verificationMethod: "scrape",
    updateFrequency: "realtime",
    notes: "Tech/startup news. Verify funding claims with SEC.",
  },
  "theinformation.com": {
    domain: "theinformation.com",
    displayName: "The Information",
    tier: "tier2_reliable",
    category: "industry_publication",
    verificationMethod: "scrape",
    updateFrequency: "daily",
  },
  "wired.com": {
    domain: "wired.com",
    displayName: "Wired",
    tier: "tier2_reliable",
    category: "industry_publication",
    verificationMethod: "scrape",
    updateFrequency: "daily",
  },

  // Tier 3: Social Media
  "twitter.com": {
    domain: "twitter.com",
    displayName: "X (Twitter)",
    tier: "tier3_unverified",
    category: "social_media",
    verificationMethod: "none",
    updateFrequency: "realtime",
    notes: "User-generated. Requires corroboration.",
  },
  "x.com": {
    domain: "x.com",
    displayName: "X (Twitter)",
    tier: "tier3_unverified",
    category: "social_media",
    verificationMethod: "none",
    updateFrequency: "realtime",
  },
  "linkedin.com": {
    domain: "linkedin.com",
    displayName: "LinkedIn",
    tier: "tier3_unverified",
    category: "social_media",
    verificationMethod: "none",
    updateFrequency: "realtime",
    notes: "Company pages may be tier2 for hiring/funding announcements.",
  },
  "reddit.com": {
    domain: "reddit.com",
    displayName: "Reddit",
    tier: "tier3_unverified",
    category: "user_generated",
    verificationMethod: "none",
    updateFrequency: "realtime",
  },
  "news.ycombinator.com": {
    domain: "news.ycombinator.com",
    displayName: "Hacker News",
    tier: "tier3_unverified",
    category: "user_generated",
    verificationMethod: "none",
    updateFrequency: "realtime",
    notes: "Sentiment source. Not for fact claims.",
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPANY IR PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Patterns for identifying official company sources
 */
export const COMPANY_IR_PATTERNS = [
  /investor[s]?\.[\w-]+\.(com|io|co)/i,           // investors.company.com
  /ir\.[\w-]+\.(com|io|co)/i,                     // ir.company.com
  /[\w-]+\.(com|io|co)\/investor[s]?/i,           // company.com/investors
  /[\w-]+\.(com|io|co)\/ir\//i,                   // company.com/ir/
  /[\w-]+\.(com|io|co)\/press/i,                  // company.com/press
  /[\w-]+\.(com|io|co)\/newsroom/i,               // company.com/newsroom
  /[\w-]+\.(com|io|co)\/blog/i,                   // company.com/blog (lower tier)
];

// ═══════════════════════════════════════════════════════════════════════════
// LOOKUPS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get source definition for a URL
 */
export function getSourceDefinition(url: string): SourceDefinition | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");

    // Direct domain match
    if (AUTHORITATIVE_SOURCES[host]) {
      return AUTHORITATIVE_SOURCES[host];
    }

    // Check parent domains (e.g., subdomain.sec.gov → sec.gov)
    const parts = host.split(".");
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(i).join(".");
      if (AUTHORITATIVE_SOURCES[parent]) {
        return AUTHORITATIVE_SOURCES[parent];
      }
    }

    // Check company IR patterns
    for (const pattern of COMPANY_IR_PATTERNS) {
      if (pattern.test(url)) {
        return {
          domain: host,
          displayName: `${host} (Company Official)`,
          tier: "tier2_reliable",
          category: "company_official",
          verificationMethod: "scrape",
          updateFrequency: "manual",
        };
      }
    }

    // Government domains
    if (host.endsWith(".gov") || host.endsWith(".gov.uk") || host.endsWith(".europa.eu")) {
      return {
        domain: host,
        displayName: `${host} (Government)`,
        tier: "tier1_authoritative",
        category: "government",
        verificationMethod: "scrape",
        updateFrequency: "daily",
      };
    }

    // Unknown source
    return {
      domain: host,
      displayName: host,
      tier: "tier3_unverified",
      category: "unknown",
      verificationMethod: "none",
      updateFrequency: "manual",
    };
  } catch {
    return null;
  }
}

/**
 * Get credibility tier for a URL
 */
export function getCredibilityTier(url: string): CredibilityTier {
  const def = getSourceDefinition(url);
  return def?.tier ?? "tier3_unverified";
}

/**
 * Check if a source is authoritative enough for fact claims
 */
export function isAuthoritativeForFactClaims(url: string): boolean {
  const tier = getCredibilityTier(url);
  return tier === "tier1_authoritative" || tier === "tier2_reliable";
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVEX QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get source credibility info for a URL
 */
export const getSourceCredibility = internalQuery({
  args: {
    url: v.string(),
  },
  handler: async (_ctx, args) => {
    const def = getSourceDefinition(args.url);
    if (!def) {
      return {
        isValid: false,
        tier: "tier3_unverified" as CredibilityTier,
        category: "unknown" as SourceCategory,
        canSupportFactClaims: false,
      };
    }

    return {
      isValid: true,
      domain: def.domain,
      displayName: def.displayName,
      tier: def.tier,
      category: def.category,
      verificationMethod: def.verificationMethod,
      apiEndpoint: def.apiEndpoint,
      canSupportFactClaims: def.tier !== "tier3_unverified",
      notes: def.notes,
    };
  },
});

/**
 * Batch get credibility for multiple URLs
 */
export const batchGetSourceCredibility = internalQuery({
  args: {
    urls: v.array(v.string()),
  },
  handler: async (_ctx, args) => {
    return args.urls.map((url) => {
      const def = getSourceDefinition(url);
      return {
        url,
        tier: def?.tier ?? "tier3_unverified",
        category: def?.category ?? "unknown",
        canSupportFactClaims: def ? def.tier !== "tier3_unverified" : false,
      };
    });
  },
});

/**
 * Check if claim has sufficient authoritative backing
 */
export const checkClaimSources = internalQuery({
  args: {
    claimText: v.string(),
    sourceUrls: v.array(v.string()),
    requireTier1: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    const requireTier1 = args.requireTier1 ?? false;

    const sources = args.sourceUrls.map((url) => {
      const def = getSourceDefinition(url);
      return {
        url,
        tier: def?.tier ?? "tier3_unverified",
        category: def?.category ?? "unknown",
      };
    });

    const tier1Count = sources.filter((s) => s.tier === "tier1_authoritative").length;
    const tier2Count = sources.filter((s) => s.tier === "tier2_reliable").length;
    const tier3Count = sources.filter((s) => s.tier === "tier3_unverified").length;

    const hasTier1 = tier1Count > 0;
    const hasTier2OrBetter = tier1Count > 0 || tier2Count > 0;
    const allUnverified = tier1Count === 0 && tier2Count === 0;

    let verdict: "verified" | "corroborated" | "unverified" | "insufficient";
    if (requireTier1) {
      verdict = hasTier1 ? "verified" : "insufficient";
    } else if (hasTier1) {
      verdict = "verified";
    } else if (hasTier2OrBetter) {
      verdict = "corroborated";
    } else if (tier3Count > 0) {
      verdict = "unverified";
    } else {
      verdict = "insufficient";
    }

    return {
      verdict,
      tier1Count,
      tier2Count,
      tier3Count,
      sources,
      recommendation:
        verdict === "insufficient"
          ? "Add authoritative source (SEC, arXiv, official company announcement)"
          : verdict === "unverified"
            ? "Corroborate with tier1/tier2 source before publishing as fact"
            : undefined,
    };
  },
});
