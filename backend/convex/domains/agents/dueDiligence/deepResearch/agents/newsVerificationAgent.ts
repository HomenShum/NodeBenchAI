/**
 * News Verification Agent
 *
 * Specialized sub-agent for verifying news events and recent developments.
 * Searches multiple news sources, triangulates information, and verifies claims.
 *
 * @module deepResearch/agents/newsVerificationAgent
 */

import type {
  NewsEvent,
  NewsSource,
  NewsVerificationResult,
  ResearchSource,
  VerifiedClaim,
  SubAgentResult,
} from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// NEWS SOURCE TIERS
// ═══════════════════════════════════════════════════════════════════════════

const TIER1_SOURCES = [
  "reuters.com", "bloomberg.com", "wsj.com", "ft.com",
  "nytimes.com", "washingtonpost.com", "bbc.com", "apnews.com",
];

const TIER2_SOURCES = [
  "techcrunch.com", "theverge.com", "wired.com", "arstechnica.com",
  "cnbc.com", "forbes.com", "businessinsider.com", "venturebeat.com",
  "axios.com", "theregister.com", "cnn.com", "cbc.ca",
];

const OFFICIAL_SOURCES = [
  "sec.gov", ".gov", "ir.", "newsroom.", "press.", "blog.",
];

// ═══════════════════════════════════════════════════════════════════════════
// MAIN AGENT FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

export interface NewsVerificationConfig {
  eventDescription: string;
  entities: string[];
  dateRange?: { start: string; end: string };
  requireOfficialConfirmation: boolean;
  webSearchFn: (query: string) => Promise<SearchResult[]>;
  webFetchFn?: (url: string, prompt: string) => Promise<string>;
  generateTextFn?: (prompt: string) => Promise<string>;
}

interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  publishedAt?: string;
}

/**
 * Execute news verification for a specific event
 */
export async function executeNewsVerification(
  config: NewsVerificationConfig
): Promise<SubAgentResult> {
  const startTime = Date.now();
  console.log(`[NewsAgent] Verifying event: ${config.eventDescription.slice(0, 80)}...`);

  const sources: ResearchSource[] = [];
  const claims: VerifiedClaim[] = [];

  try {
    // 1. Search for event across multiple queries
    const searchResults = await searchNewsMultiQuery(config);
    sources.push(...searchResults.sources);

    // 2. Categorize sources by tier
    const categorizedSources = categorizeSources(searchResults.results);

    // 3. Check for official confirmation
    const officialConfirmation = await checkOfficialConfirmation(config, searchResults.results);
    if (officialConfirmation) {
      sources.push(officialConfirmation.source);
    }

    // 4. Cross-verify across sources
    const verification = verifyAcrossSources(
      config.eventDescription,
      categorizedSources,
      officialConfirmation?.confirmed || false
    );

    // 5. Extract timeline consistency
    const timeline = extractTimeline(searchResults.results);
    verification.timelineConsistent = timeline.isConsistent;

    // 6. Build news event record
    const newsEvent = buildNewsEvent(
      config,
      searchResults.results,
      verification
    );

    // 7. Generate verified claims
    claims.push(...generateNewsVerifiedClaims(newsEvent, verification, sources));

    return {
      taskId: `news-${Date.now()}`,
      type: "news",
      status: "completed",
      findings: {
        event: newsEvent,
        verification,
        timeline,
      },
      sources,
      claims,
      executionTimeMs: Date.now() - startTime,
    };

  } catch (error) {
    console.error(`[NewsAgent] Error verifying event:`, error);

    return {
      taskId: `news-${Date.now()}`,
      type: "news",
      status: "failed",
      findings: null,
      sources,
      claims,
      executionTimeMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-QUERY SEARCH
// ═══════════════════════════════════════════════════════════════════════════

interface MultiQueryResults {
  results: NewsSearchResult[];
  sources: ResearchSource[];
}

interface NewsSearchResult {
  title: string;
  snippet: string;
  url: string;
  publishedAt?: string;
  tier: "tier1" | "tier2" | "tier3" | "official" | "unknown";
}

async function searchNewsMultiQuery(
  config: NewsVerificationConfig
): Promise<MultiQueryResults> {
  const allResults: NewsSearchResult[] = [];
  const sources: ResearchSource[] = [];
  const seenUrls = new Set<string>();

  // Generate multiple search queries for comprehensive coverage
  const queries = generateSearchQueries(config);

  for (const query of queries) {
    try {
      const results = await config.webSearchFn(query);

      for (const result of results) {
        if (seenUrls.has(result.url)) continue;
        seenUrls.add(result.url);

        const tier = classifySourceTier(result.url);
        const newsResult: NewsSearchResult = {
          ...result,
          tier,
        };

        allResults.push(newsResult);

        sources.push({
          id: `src-news-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: "news_article",
          url: result.url,
          title: result.title,
          publishedAt: result.publishedAt,
          accessedAt: Date.now(),
          reliability: tierToReliability(tier),
          snippet: result.snippet,
        });
      }
    } catch (error) {
      console.error(`[NewsAgent] Search failed for query: ${query}`, error);
    }
  }

  return { results: allResults, sources };
}

function generateSearchQueries(config: NewsVerificationConfig): string[] {
  const queries: string[] = [];
  const entities = config.entities.filter(e => e && e.length > 0);

  // Main event query
  queries.push(config.eventDescription);

  // Entity-specific queries
  for (const entity of entities.slice(0, 3)) {
    queries.push(`"${entity}" ${extractKeywords(config.eventDescription)}`);
  }

  // If date range specified, add time-bounded query
  if (config.dateRange) {
    queries.push(`${config.eventDescription} ${config.dateRange.start} ${config.dateRange.end}`);
  }

  // News-specific query
  queries.push(`${config.eventDescription} news announcement`);

  // Official announcement query
  if (config.requireOfficialConfirmation) {
    queries.push(`${entities.join(" ")} official announcement press release`);
  }

  return queries.slice(0, 5); // Max 5 queries
}

function extractKeywords(text: string): string {
  const stopWords = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
    "may", "might", "must", "can", "for", "and", "nor", "but", "or", "yet", "so",
    "in", "on", "at", "to", "of", "by", "with", "from", "about", "into", "through"]);

  return text
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word.toLowerCase()))
    .slice(0, 5)
    .join(" ");
}

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════

function classifySourceTier(url: string): NewsSearchResult["tier"] {
  const urlLower = url.toLowerCase();

  // Check official sources first
  for (const pattern of OFFICIAL_SOURCES) {
    if (urlLower.includes(pattern)) return "official";
  }

  // Check tier 1
  for (const domain of TIER1_SOURCES) {
    if (urlLower.includes(domain)) return "tier1";
  }

  // Check tier 2
  for (const domain of TIER2_SOURCES) {
    if (urlLower.includes(domain)) return "tier2";
  }

  // Check for recognizable news patterns
  if (urlLower.includes("news") || urlLower.includes("article") ||
      urlLower.includes("/post/") || urlLower.includes("/story/")) {
    return "tier3";
  }

  return "unknown";
}

function tierToReliability(tier: NewsSearchResult["tier"]): ResearchSource["reliability"] {
  switch (tier) {
    case "official": return "authoritative";
    case "tier1": return "reliable";
    case "tier2": return "reliable";
    case "tier3": return "secondary";
    default: return "unverified";
  }
}

interface CategorizedSources {
  tier1: NewsSearchResult[];
  tier2: NewsSearchResult[];
  tier3: NewsSearchResult[];
  official: NewsSearchResult[];
  unknown: NewsSearchResult[];
}

function categorizeSources(results: NewsSearchResult[]): CategorizedSources {
  const categorized: CategorizedSources = {
    tier1: [],
    tier2: [],
    tier3: [],
    official: [],
    unknown: [],
  };

  for (const result of results) {
    categorized[result.tier].push(result);
  }

  return categorized;
}

// ═══════════════════════════════════════════════════════════════════════════
// OFFICIAL CONFIRMATION CHECK
// ═══════════════════════════════════════════════════════════════════════════

interface OfficialConfirmation {
  confirmed: boolean;
  source: ResearchSource;
  details?: string;
}

async function checkOfficialConfirmation(
  config: NewsVerificationConfig,
  results: NewsSearchResult[]
): Promise<OfficialConfirmation | null> {
  // Look for official sources in results
  const officialResults = results.filter(r => r.tier === "official");

  if (officialResults.length > 0) {
    const official = officialResults[0];
    return {
      confirmed: true,
      source: {
        id: `src-official-${Date.now()}`,
        type: "press_release",
        url: official.url,
        title: official.title,
        accessedAt: Date.now(),
        reliability: "authoritative",
        snippet: official.snippet,
      },
      details: official.snippet,
    };
  }

  // If web fetch available, try to find official announcement
  if (config.webFetchFn && config.entities.length > 0) {
    for (const entity of config.entities.slice(0, 2)) {
      const possibleUrls = [
        `https://${entity.toLowerCase().replace(/\s+/g, "")}.com/blog`,
        `https://${entity.toLowerCase().replace(/\s+/g, "")}.com/newsroom`,
        `https://newsroom.${entity.toLowerCase().replace(/\s+/g, "")}.com`,
      ];

      // This would require actual fetching - mark as not confirmed if no official found
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CROSS-SOURCE VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

function verifyAcrossSources(
  eventDescription: string,
  sources: CategorizedSources,
  hasOfficialConfirmation: boolean
): NewsVerificationResult {
  const allSources = [
    ...sources.tier1,
    ...sources.tier2,
    ...sources.tier3,
    ...sources.official,
  ];

  // Extract key claims from event description
  const eventKeywords = extractKeywords(eventDescription).toLowerCase().split(" ");

  // Count supporting and contradicting sources
  const supporting: NewsSource[] = [];
  const contradicting: NewsSource[] = [];

  for (const source of allSources) {
    const snippetLower = source.snippet.toLowerCase();
    const titleLower = source.title.toLowerCase();
    const combined = snippetLower + " " + titleLower;

    // Check if source supports the event (contains key terms)
    const matchCount = eventKeywords.filter(k => combined.includes(k)).length;
    const matchRatio = matchCount / eventKeywords.length;

    // Check for contradiction signals
    const hasContradiction = combined.includes("deny") || combined.includes("false") ||
                             combined.includes("incorrect") || combined.includes("rumor") ||
                             combined.includes("not true") || combined.includes("debunk");

    const newsSource: NewsSource = {
      name: extractDomain(source.url),
      url: source.url,
      publishedAt: source.publishedAt || new Date().toISOString(),
      reliability: source.tier as NewsSource["reliability"],
      snippet: source.snippet,
    };

    if (hasContradiction) {
      contradicting.push(newsSource);
    } else if (matchRatio > 0.3) {
      supporting.push(newsSource);
    }
  }

  // Determine consensus
  const totalRelevant = supporting.length + contradicting.length;
  let consensus: NewsVerificationResult["consensus"];

  if (contradicting.length > supporting.length) {
    consensus = "contradicted";
  } else if (totalRelevant === 0) {
    consensus = "none";
  } else if (sources.tier1.length >= 2 || hasOfficialConfirmation) {
    consensus = "strong";
  } else if (sources.tier1.length >= 1 || sources.tier2.length >= 2) {
    consensus = "moderate";
  } else {
    consensus = "weak";
  }

  // Calculate confidence
  let confidence = 0.3; // Base
  if (hasOfficialConfirmation) confidence += 0.4;
  if (sources.tier1.length >= 2) confidence += 0.2;
  else if (sources.tier1.length >= 1) confidence += 0.1;
  if (sources.tier2.length >= 2) confidence += 0.1;
  if (contradicting.length > 0) confidence -= 0.2 * (contradicting.length / totalRelevant);

  confidence = Math.max(0, Math.min(1, confidence));

  // Determine verdict
  let verified = false;
  if (confidence >= 0.7 && consensus !== "contradicted") {
    verified = true;
  }

  return {
    event: eventDescription,
    verified,
    confidence,
    supportingSources: supporting,
    contradictingSources: contradicting,
    timelineConsistent: true, // Will be updated by timeline extraction
    officialConfirmation: hasOfficialConfirmation,
    verdict: generateVerdict(verified, confidence, consensus, hasOfficialConfirmation),
    consensus,
  };
}

function generateVerdict(
  verified: boolean,
  confidence: number,
  consensus: string,
  hasOfficial: boolean
): string {
  if (!verified && consensus === "contradicted") {
    return "CONTRADICTED: Multiple sources contradict this event";
  }

  if (verified && hasOfficial) {
    return "VERIFIED: Officially confirmed with multiple source corroboration";
  }

  if (verified) {
    return `VERIFIED: ${confidence >= 0.8 ? "Strong" : "Moderate"} consensus across reliable sources`;
  }

  if (confidence >= 0.5) {
    return "PARTIALLY VERIFIED: Some evidence supports this, but official confirmation lacking";
  }

  if (consensus === "none") {
    return "UNVERIFIED: Insufficient coverage to verify or refute";
  }

  return "UNVERIFIED: Weak evidence, proceed with caution";
}

// ═══════════════════════════════════════════════════════════════════════════
// TIMELINE EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

interface Timeline {
  events: Array<{ date: string; description: string; source: string }>;
  isConsistent: boolean;
  earliestMention?: string;
  latestMention?: string;
}

function extractTimeline(results: NewsSearchResult[]): Timeline {
  const events: Timeline["events"] = [];

  for (const result of results) {
    // Extract dates from snippets
    const datePatterns = [
      /(\d{4}-\d{2}-\d{2})/g,
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/gi,
      /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/gi,
    ];

    for (const pattern of datePatterns) {
      const matches = result.snippet.matchAll(pattern);
      for (const match of matches) {
        events.push({
          date: match[0],
          description: result.title,
          source: extractDomain(result.url),
        });
      }
    }

    // Use publishedAt if available
    if (result.publishedAt) {
      events.push({
        date: result.publishedAt,
        description: result.title,
        source: extractDomain(result.url),
      });
    }
  }

  // Sort by date
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Check consistency (dates should be within reasonable range)
  let isConsistent = true;
  if (events.length >= 2) {
    const dates = events.map(e => new Date(e.date).getTime()).filter(d => !isNaN(d));
    if (dates.length >= 2) {
      const range = Math.max(...dates) - Math.min(...dates);
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      isConsistent = range < thirtyDaysMs; // Events should be within 30 days of each other
    }
  }

  return {
    events,
    isConsistent,
    earliestMention: events[0]?.date,
    latestMention: events[events.length - 1]?.date,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// NEWS EVENT BUILDER
// ═══════════════════════════════════════════════════════════════════════════

function buildNewsEvent(
  config: NewsVerificationConfig,
  results: NewsSearchResult[],
  verification: NewsVerificationResult
): NewsEvent {
  // Determine event type
  const eventType = inferEventType(config.eventDescription);

  // Get best headline
  const bestHeadline = results
    .filter(r => r.tier === "tier1" || r.tier === "official")
    .map(r => r.title)[0] || results[0]?.title || config.eventDescription;

  // Generate summary from snippets
  const summary = results
    .slice(0, 3)
    .map(r => r.snippet)
    .join(" ")
    .slice(0, 500);

  return {
    id: `event-${Date.now()}`,
    headline: bestHeadline,
    summary,
    date: new Date().toISOString().split("T")[0],
    sources: verification.supportingSources,
    entities: config.entities,
    eventType,
    verificationStatus: verification.verified ? "verified" : "reported",
    confidence: verification.confidence,
  };
}

function inferEventType(description: string): NewsEvent["eventType"] {
  const descLower = description.toLowerCase();

  if (descLower.includes("acqui") || descLower.includes("bought") || descLower.includes("purchase")) {
    return "acquisition";
  }
  if (descLower.includes("funding") || descLower.includes("raised") || descLower.includes("investment")) {
    return "funding";
  }
  if (descLower.includes("launch") || descLower.includes("release") || descLower.includes("announce")) {
    return "launch";
  }
  if (descLower.includes("partner") || descLower.includes("collaboration")) {
    return "partnership";
  }
  if (descLower.includes("ceo") || descLower.includes("hire") || descLower.includes("appoint")) {
    return "executive_change";
  }
  if (descLower.includes("lawsuit") || descLower.includes("legal") || descLower.includes("court")) {
    return "legal";
  }

  return "other";
}

function generateNewsVerifiedClaims(
  event: NewsEvent,
  verification: NewsVerificationResult,
  sources: ResearchSource[]
): VerifiedClaim[] {
  const claims: VerifiedClaim[] = [];

  // Main event claim
  claims.push({
    claim: event.headline,
    verified: verification.verified,
    confidence: verification.confidence,
    sources: sources.filter(s => s.reliability === "authoritative" || s.reliability === "reliable").slice(0, 3),
    verificationMethod: verification.officialConfirmation ? "authoritative" : "triangulated",
    verifiedAt: Date.now(),
  });

  // Entity involvement claims
  for (const entity of event.entities) {
    claims.push({
      claim: `${entity} is involved in: ${event.headline}`,
      verified: verification.verified,
      confidence: verification.confidence * 0.9,
      sources: sources.filter(s => s.snippet?.toLowerCase().includes(entity.toLowerCase())).slice(0, 2),
      verificationMethod: "triangulated",
      verifiedAt: Date.now(),
    });
  }

  return claims;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace("www.", "");
  } catch {
    return "unknown";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTION: VERIFY SPECIFIC EVENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Quick verification of a specific event claim
 */
export async function verifyEvent(
  eventDescription: string,
  entities: string[],
  webSearchFn: (query: string) => Promise<SearchResult[]>
): Promise<{
  verified: boolean;
  confidence: number;
  verdict: string;
  sources: ResearchSource[];
}> {
  const result = await executeNewsVerification({
    eventDescription,
    entities,
    requireOfficialConfirmation: true,
    webSearchFn,
  });

  if (result.status === "failed" || !result.findings) {
    return {
      verified: false,
      confidence: 0,
      verdict: "VERIFICATION FAILED: Unable to search for event",
      sources: [],
    };
  }

  const verification = (result.findings as Record<string, unknown>).verification as NewsVerificationResult;

  return {
    verified: verification.verified,
    confidence: verification.confidence,
    verdict: verification.verdict,
    sources: result.sources,
  };
}
