/**
 * sourceCitations.ts
 *
 * Source Citation Management with Mandatory Dates
 *
 * All evidence must include:
 * - Access date (when we accessed the source)
 * - Publication date (when available)
 * - Archive URL (for persistence)
 *
 * This ensures:
 * 1. Legal defensibility (per SEC Rule 17a-4, FINRA Rule 4511)
 * 2. Reproducibility (can re-verify claims later)
 * 3. Staleness detection (know when information expires)
 *
 * Reference: SEC Rule 17a-4 (record retention requirements)
 * Source: https://www.sec.gov/rules/final/34-38245.txt (accessed 2025-01)
 */

import { SourceCitation } from "./claimLifecycle";

// ============================================================================
// CITATION TYPES
// ============================================================================

/**
 * Extended source citation with full provenance
 */
export interface FullSourceCitation extends SourceCitation {
  // Mandatory dates
  accessedAt: number;      // Required: when we accessed this

  // Optional dates
  publishedAt?: number;    // When the source was published
  lastModifiedAt?: number; // Last modification time (for dynamic pages)
  expiresAt?: number;      // When this citation becomes stale

  // Archive/persistence
  archivedUrl?: string;    // Wayback Machine or archive.org URL
  archivedAt?: number;     // When we archived it
  screenshotUrl?: string;  // Screenshot of the page at access time

  // Provenance chain
  foundVia?: string;       // How we found this (e.g., "Google search", "SEC EDGAR API")
  searchQuery?: string;    // Original search query if applicable

  // Extraction details
  extractedFields: string[]; // What data we extracted (e.g., ["company_name", "revenue"])
  extractionMethod: "regex" | "llm" | "api" | "manual" | "structured_data";

  // Quality indicators
  pageLoadTimeMs?: number;
  httpStatus?: number;
  contentHash?: string;    // Hash of content at access time (for change detection)
}

/**
 * Citation format options
 */
export type CitationFormat =
  | "apa"           // APA 7th edition
  | "mla"           // MLA 9th edition
  | "chicago"       // Chicago Manual of Style
  | "legal"         // Legal citation (Bluebook)
  | "internal";     // Internal reference format

/**
 * Citation validation result
 */
export interface CitationValidation {
  isValid: boolean;
  hasAccessDate: boolean;
  hasPublicationDate: boolean;
  hasArchive: boolean;
  warnings: string[];
  errors: string[];
}

// ============================================================================
// CITATION FACTORY
// ============================================================================

/**
 * Create a properly dated source citation
 */
export function createDatedCitation(
  url: string,
  sourceType: SourceCitation["sourceType"],
  options: {
    title?: string;
    publishedAt?: number | string | Date;
    reliability?: SourceCitation["reliability"];
    extractedSnippet?: string;
    foundVia?: string;
    searchQuery?: string;
    extractedFields?: string[];
    extractionMethod?: FullSourceCitation["extractionMethod"];
  } = {}
): FullSourceCitation {
  const now = Date.now();

  // Parse publication date if provided
  let publishedAtMs: number | undefined;
  if (options.publishedAt) {
    if (typeof options.publishedAt === "number") {
      publishedAtMs = options.publishedAt;
    } else if (options.publishedAt instanceof Date) {
      publishedAtMs = options.publishedAt.getTime();
    } else {
      const parsed = Date.parse(options.publishedAt);
      publishedAtMs = isNaN(parsed) ? undefined : parsed;
    }
  }

  // Calculate expiration (sources expire after 90 days by default)
  const expiresAt = now + 90 * 24 * 60 * 60 * 1000;

  return {
    sourceId: `src_${now}_${Math.random().toString(36).slice(2, 8)}`,
    sourceType,
    url,
    title: options.title,
    accessedAt: now,
    publishedAt: publishedAtMs,
    expiresAt,
    reliability: options.reliability ?? determineReliability(sourceType, url),
    extractedSnippet: options.extractedSnippet,
    foundVia: options.foundVia,
    searchQuery: options.searchQuery,
    extractedFields: options.extractedFields ?? [],
    extractionMethod: options.extractionMethod ?? "regex",
  };
}

/**
 * Create citation from search result
 */
export function citationFromSearchResult(
  result: {
    url?: string;
    title?: string;
    snippet?: string;
    date?: string;
  },
  searchQuery: string
): FullSourceCitation | null {
  if (!result.url) return null;

  const sourceType = inferSourceType(result.url);

  return createDatedCitation(result.url, sourceType, {
    title: result.title,
    publishedAt: result.date,
    extractedSnippet: result.snippet,
    foundVia: "web_search",
    searchQuery,
    extractionMethod: "regex",
  });
}

/**
 * Create citation from API response
 */
export function citationFromAPIResponse(
  apiName: string,
  endpoint: string,
  responseData: any,
  extractedFields: string[]
): FullSourceCitation {
  // Determine source type from API name
  const sourceTypeMap: Record<string, SourceCitation["sourceType"]> = {
    "sec_edgar": "sec_filing",
    "linkedin": "linkedin",
    "crunchbase": "api_response",
    "opencorporates": "registry",
    "courtlistener": "court_record",
  };

  const sourceType = sourceTypeMap[apiName] ?? "api_response";

  return createDatedCitation(endpoint, sourceType, {
    title: `${apiName} API Response`,
    reliability: "authoritative",
    extractedFields,
    extractionMethod: "api",
    foundVia: `${apiName}_api`,
  });
}

// ============================================================================
// CITATION FORMATTING
// ============================================================================

/**
 * Format citation for display or export
 */
export function formatCitation(
  citation: FullSourceCitation,
  format: CitationFormat = "internal"
): string {
  const accessDate = formatDate(citation.accessedAt);
  const pubDate = citation.publishedAt ? formatDate(citation.publishedAt) : null;

  switch (format) {
    case "apa":
      return formatAPA(citation, accessDate, pubDate);
    case "mla":
      return formatMLA(citation, accessDate, pubDate);
    case "chicago":
      return formatChicago(citation, accessDate, pubDate);
    case "legal":
      return formatLegal(citation, accessDate, pubDate);
    case "internal":
    default:
      return formatInternal(citation, accessDate, pubDate);
  }
}

function formatAPA(
  citation: FullSourceCitation,
  accessDate: string,
  pubDate: string | null
): string {
  const title = citation.title || "Untitled";
  const date = pubDate || "n.d.";
  return `${title}. (${date}). Retrieved ${accessDate}, from ${citation.url}`;
}

function formatMLA(
  citation: FullSourceCitation,
  accessDate: string,
  pubDate: string | null
): string {
  const title = citation.title || "Untitled";
  const date = pubDate || "";
  return `"${title}." ${date ? date + ". " : ""}Web. ${accessDate}. <${citation.url}>`;
}

function formatChicago(
  citation: FullSourceCitation,
  accessDate: string,
  pubDate: string | null
): string {
  const title = citation.title || "Untitled";
  return `"${title}," ${pubDate ? `${pubDate}, ` : ""}${citation.url} (accessed ${accessDate})`;
}

function formatLegal(
  citation: FullSourceCitation,
  accessDate: string,
  pubDate: string | null
): string {
  const title = citation.title || "[Document]";
  return `${title}, available at ${citation.url} (last visited ${accessDate})`;
}

function formatInternal(
  citation: FullSourceCitation,
  accessDate: string,
  pubDate: string | null
): string {
  let formatted = citation.title ? `"${citation.title}" ` : "";
  formatted += `[${citation.sourceType}] `;
  formatted += citation.url;
  if (pubDate) {
    formatted += ` (published ${pubDate})`;
  }
  formatted += ` [accessed ${accessDate}]`;
  if (citation.reliability) {
    formatted += ` [${citation.reliability}]`;
  }
  return formatted;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString().split("T")[0];
}

// ============================================================================
// CITATION VALIDATION
// ============================================================================

/**
 * Validate a citation has required fields
 */
export function validateCitation(citation: SourceCitation): CitationValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required: access date
  const hasAccessDate = citation.accessedAt !== undefined && citation.accessedAt > 0;
  if (!hasAccessDate) {
    errors.push("Missing access date (required for legal defensibility)");
  }

  // Recommended: publication date
  const hasPublicationDate = citation.publishedAt !== undefined && citation.publishedAt > 0;
  if (!hasPublicationDate) {
    warnings.push("Missing publication date (recommended for verification)");
  }

  // Recommended: archive URL
  const hasArchive = citation.archivedUrl !== undefined && citation.archivedUrl.length > 0;
  if (!hasArchive) {
    warnings.push("No archive URL (consider archiving for persistence)");
  }

  // Check for expired citation
  if ("expiresAt" in citation) {
    const fullCitation = citation as FullSourceCitation;
    if (fullCitation.expiresAt && Date.now() > fullCitation.expiresAt) {
      warnings.push("Citation has expired - consider refreshing");
    }
  }

  // Check URL validity
  try {
    new URL(citation.url);
  } catch {
    errors.push("Invalid URL format");
  }

  return {
    isValid: errors.length === 0,
    hasAccessDate,
    hasPublicationDate,
    hasArchive,
    warnings,
    errors,
  };
}

/**
 * Validate all citations in a list
 */
export function validateCitations(
  citations: SourceCitation[]
): {
  valid: number;
  invalid: number;
  warnings: number;
  results: Array<{ citation: SourceCitation; validation: CitationValidation }>;
} {
  const results = citations.map(citation => ({
    citation,
    validation: validateCitation(citation),
  }));

  return {
    valid: results.filter(r => r.validation.isValid).length,
    invalid: results.filter(r => !r.validation.isValid).length,
    warnings: results.filter(r => r.validation.warnings.length > 0).length,
    results,
  };
}

// ============================================================================
// ARCHIVE UTILITIES
// ============================================================================

/**
 * Generate Wayback Machine save URL
 */
export function getWaybackSaveUrl(url: string): string {
  return `https://web.archive.org/save/${url}`;
}

/**
 * Generate Wayback Machine lookup URL
 */
export function getWaybackLookupUrl(url: string, timestamp?: number): string {
  const ts = timestamp ? new Date(timestamp).toISOString().replace(/[-:T]/g, "").slice(0, 14) : "*";
  return `https://web.archive.org/web/${ts}/${url}`;
}

/**
 * Check if URL is already archived
 */
export function isArchivedUrl(url: string): boolean {
  return url.includes("web.archive.org") || url.includes("archive.is") || url.includes("archive.ph");
}

// ============================================================================
// SOURCE TYPE INFERENCE
// ============================================================================

/**
 * Infer source type from URL
 */
export function inferSourceType(url: string): SourceCitation["sourceType"] {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes("sec.gov")) return "sec_filing";
  if (lowerUrl.includes("linkedin.com")) return "linkedin";
  if (lowerUrl.includes("courtlistener.com") || lowerUrl.includes("pacer.gov")) return "court_record";
  if (lowerUrl.includes("news") || lowerUrl.includes("techcrunch") || lowerUrl.includes("reuters")) return "news_article";
  if (lowerUrl.includes("sos.") || lowerUrl.includes("corporations.")) return "registry";
  if (lowerUrl.includes("prnewswire") || lowerUrl.includes("businesswire")) return "press_release";

  return "other";
}

/**
 * Determine reliability based on source type and URL
 */
export function determineReliability(
  sourceType: SourceCitation["sourceType"],
  url: string
): SourceCitation["reliability"] {
  // Authoritative sources
  if (sourceType === "sec_filing") return "authoritative";
  if (sourceType === "court_record") return "authoritative";
  if (sourceType === "registry") return "authoritative";

  // Reliable sources
  if (sourceType === "linkedin") return "reliable";
  if (sourceType === "news_article") return "reliable";

  // Secondary sources
  if (sourceType === "press_release") return "secondary";
  if (sourceType === "company_website") return "secondary";

  // Check for known reliable domains
  const reliableDomains = [
    "reuters.com", "bloomberg.com", "wsj.com", "nytimes.com",
    "techcrunch.com", "theinformation.com", "fortune.com"
  ];

  const lowerUrl = url.toLowerCase();
  for (const domain of reliableDomains) {
    if (lowerUrl.includes(domain)) return "reliable";
  }

  return "unverified";
}

// ============================================================================
// CITATION AGGREGATION
// ============================================================================

/**
 * Aggregate multiple citations for the same claim
 */
export function aggregateCitations(
  citations: FullSourceCitation[]
): {
  primaryCitation: FullSourceCitation;
  supportingCitations: FullSourceCitation[];
  reliabilityScore: number;
  coverageScore: number;
} {
  if (citations.length === 0) {
    throw new Error("No citations to aggregate");
  }

  // Sort by reliability and recency
  const sorted = [...citations].sort((a, b) => {
    const reliabilityOrder = {
      authoritative: 4,
      reliable: 3,
      secondary: 2,
      unverified: 1,
    };

    const reliabilityDiff =
      (reliabilityOrder[b.reliability ?? "unverified"] ?? 0) -
      (reliabilityOrder[a.reliability ?? "unverified"] ?? 0);

    if (reliabilityDiff !== 0) return reliabilityDiff;

    // More recent is better
    return b.accessedAt - a.accessedAt;
  });

  const primaryCitation = sorted[0];
  const supportingCitations = sorted.slice(1);

  // Calculate reliability score (0-100)
  const reliabilityScores = {
    authoritative: 100,
    reliable: 75,
    secondary: 50,
    unverified: 25,
  };

  const reliabilityScore = citations.reduce((sum, c) =>
    sum + (reliabilityScores[c.reliability ?? "unverified"] ?? 0), 0
  ) / citations.length;

  // Coverage score: more diverse sources = better
  const uniqueTypes = new Set(citations.map(c => c.sourceType)).size;
  const coverageScore = Math.min(100, (uniqueTypes / 5) * 100);

  return {
    primaryCitation,
    supportingCitations,
    reliabilityScore,
    coverageScore,
  };
}

/**
 * Generate citation summary for a claim
 */
export function generateCitationSummary(citations: FullSourceCitation[]): string {
  if (citations.length === 0) {
    return "No sources cited";
  }

  const { primaryCitation, supportingCitations, reliabilityScore } = aggregateCitations(citations);

  const primary = formatCitation(primaryCitation, "internal");
  const supportCount = supportingCitations.length;

  let summary = `Primary: ${primary}`;

  if (supportCount > 0) {
    summary += ` (+${supportCount} supporting source${supportCount > 1 ? "s" : ""})`;
  }

  summary += ` [Reliability: ${reliabilityScore.toFixed(0)}%]`;

  return summary;
}
