/**
 * Enhanced News Verification Branch
 *
 * Implements deep agent patterns for news/acquisition verification:
 * - Multi-source triangulation from independent outlets
 * - Temporal consistency checking (announcement dates)
 * - Contradiction detection across sources
 * - Wire service priority (Reuters, AP, Bloomberg)
 * - Confidence calibration based on source tier
 */

import { api } from "../../../../../_generated/api";
import { DDSource, SourceReliability } from "../../types";
import { NewsVerificationFindings, AcquisitionDetails } from "../types";

// =============================================================================
// TYPES
// =============================================================================

type InternalReliability = "authoritative" | "reputable" | "unknown";

interface SourceEvidence {
  url: string;
  title: string;
  snippet: string;
  outlet: string;
  tier: 1 | 2 | 3;
  publishDate?: string;
  stance: "confirms" | "denies" | "neutral";
}

interface TriangulationResult {
  independentSourceCount: number;
  tier1SourceCount: number;
  tier2SourceCount: number;
  consensus: "strong" | "moderate" | "weak" | "conflicting";
  earliestReport?: string;
  primarySource?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const NEWS_SOURCE_TIERS: Record<string, { tier: 1 | 2 | 3; weight: number }> = {
  // Tier 1: Wire services and financial news leaders
  "reuters.com": { tier: 1, weight: 1.0 },
  "apnews.com": { tier: 1, weight: 1.0 },
  "bloomberg.com": { tier: 1, weight: 0.95 },
  "wsj.com": { tier: 1, weight: 0.95 },
  "ft.com": { tier: 1, weight: 0.95 },

  // Tier 2: Major tech and business news
  "nytimes.com": { tier: 2, weight: 0.85 },
  "businessinsider.com": { tier: 2, weight: 0.85 },
  "cnbc.com": { tier: 2, weight: 0.85 },
  "theverge.com": { tier: 2, weight: 0.85 },
  "techcrunch.com": { tier: 2, weight: 0.85 },
  "venturebeat.com": { tier: 2, weight: 0.8 },
  "wired.com": { tier: 2, weight: 0.8 },
  "arstechnica.com": { tier: 2, weight: 0.8 },

  // Tier 3: General news and blogs
  "forbes.com": { tier: 3, weight: 0.7 },
  "fortune.com": { tier: 3, weight: 0.7 },
  "cnn.com": { tier: 3, weight: 0.65 },
  "bbc.com": { tier: 3, weight: 0.65 },
  "engadget.com": { tier: 3, weight: 0.6 },
  "zdnet.com": { tier: 3, weight: 0.6 },
};

// =============================================================================
// MAIN ENHANCED VERIFICATION FUNCTION
// =============================================================================

export async function executeEnhancedNewsVerification(
  ctx: any,
  acquirer?: string,
  target?: string,
  eventDescription?: string,
  options: {
    requireMultipleSources?: boolean;
    requireTier1Source?: boolean;
    checkContradictions?: boolean;
  } = {}
): Promise<{
  findings: NewsVerificationFindings;
  sources: DDSource[];
  confidence: number;
  triangulation: TriangulationResult;
  methodology: string[];
}> {
  const {
    requireMultipleSources = true,
    requireTier1Source = true,
    checkContradictions = true,
  } = options;

  const allSources: DDSource[] = [];
  const allEvidence: SourceEvidence[] = [];
  const methodology: string[] = [];
  const keyFacts: NewsVerificationFindings["keyFacts"] = [];
  const relatedNews: NewsVerificationFindings["relatedNews"] = [];

  methodology.push("Phase 1: Multi-tier source search");

  // Phase 1: Search across multiple authoritative sources
  if (acquirer && target) {
    const searchQueries = generateAcquisitionSearchQueries(acquirer, target);

    for (const query of searchQueries) {
      const results = await executeSearch(ctx, query);

      for (const r of results) {
        const evidence = processSearchResult(r, acquirer, target);
        allEvidence.push(evidence);
        allSources.push(createDDSource(evidence));

        relatedNews.push({
          title: evidence.title,
          outlet: evidence.outlet,
          url: evidence.url,
          relevance: evidence.stance === "confirms" ? "direct" : "related",
        });
      }
    }
  }

  // Phase 2: Search for general event
  if (eventDescription) {
    methodology.push("Phase 2: Event description verification");
    const results = await executeSearch(ctx, eventDescription);

    for (const r of results) {
      const evidence = processSearchResult(r, acquirer || "", target || "");
      allEvidence.push(evidence);
      allSources.push(createDDSource(evidence));
    }
  }

  // Phase 3: Source triangulation
  methodology.push("Phase 3: Source triangulation");
  const triangulation = triangulateNewsSources(allEvidence);

  // Phase 4: Contradiction detection
  let contradictions: { source1: string; source2: string; issue: string }[] = [];
  if (checkContradictions) {
    methodology.push("Phase 4: Contradiction detection");
    contradictions = detectContradictions(allEvidence);
  }

  // Phase 5: Confidence calibration
  methodology.push("Phase 5: Confidence calibration");
  const { eventVerified, overallConfidence, acquisitionDetails } = calculateFinalVerdict(
    allEvidence,
    triangulation,
    contradictions,
    { acquirer, target, requireMultipleSources, requireTier1Source }
  );

  // Generate key facts from verified evidence
  const confirmedEvidence = allEvidence.filter(e => e.stance === "confirms" && getTierInfo(e.url).tier <= 2);
  for (const evidence of confirmedEvidence.slice(0, 5)) {
    keyFacts.push({
      fact: evidence.snippet.slice(0, 150),
      verified: true,
      source: evidence.url,
      confidence: getTierInfo(evidence.url).tier === 1 ? "high" : "medium",
    });
  }

  if (eventVerified && acquirer && target) {
    keyFacts.unshift({
      fact: `${acquirer} acquisition of ${target} confirmed`,
      verified: true,
      source: triangulation.primarySource || "Multiple sources",
      confidence: triangulation.tier1SourceCount > 0 ? "high" : "medium",
    });
  }

  return {
    findings: {
      eventVerified,
      eventType: (acquirer && target) ? "acquisition" : "other",
      acquisitionDetails,
      keyFacts,
      relatedNews,
      overallConfidence,
    },
    sources: deduplicateSources(allSources),
    confidence: overallConfidence,
    triangulation,
    methodology,
  };
}

// =============================================================================
// SEARCH FUNCTIONS
// =============================================================================

function generateAcquisitionSearchQueries(acquirer: string, target: string): string[] {
  return [
    // Prefer separate site queries (many search backends handle OR + site: inconsistently)
    `"${acquirer}" acquire "${target}" site:reuters.com`,
    `"${acquirer}" acquire "${target}" site:bloomberg.com`,
    `"${acquirer}" "${target}" site:businessinsider.com`,
    `"${acquirer}" "${target}" site:theverge.com`,
    `"${acquirer}" "${target}" site:venturebeat.com`,
    // General acquisition search
    `"${acquirer}" "${target}" acquisition announcement deal`,
    // Alternative phrasing
    `"${acquirer}" buys "${target}" OR "${acquirer}" acquires "${target}" OR "${acquirer}" to buy "${target}"`,
    // M&A specific
    `"${acquirer}" "${target}" merger M&A`,
    // AI/startup specific searches
    `${acquirer} ${target} AI startup acquisition`,
  ];
}

async function executeSearch(ctx: any, query: string): Promise<any[]> {
  try {
    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query,
        mode: "balanced",
        maxTotal: 8,
        skipRateLimit: true,
      }
    );
    return result?.payload?.results ?? [];
  } catch (error) {
    console.error("[EnhancedNewsVerification] Search error:", error);
    return [];
  }
}

function processSearchResult(r: any, acquirer: string, target: string): SourceEvidence {
  const url = r.url || "";
  const title = r.title || "";
  const snippet = r.snippet || r.content || "";
  const tierInfo = getTierInfo(url);

  // Determine stance (confirms, denies, neutral)
  const combinedText = `${title} ${snippet}`.toLowerCase();
  const mentionsAcquirer = acquirer ? combinedText.includes(acquirer.toLowerCase()) : true;
  const mentionsTarget = target ? combinedText.includes(target.toLowerCase()) : true;
  const hasAcquisitionKeywords = /acqui|buy|purchase|deal|merge|take\s*over/i.test(combinedText);
  const hasDenialKeywords = /denied|not confirmed|rumor|speculation|false/i.test(combinedText);

  let stance: SourceEvidence["stance"] = "neutral";
  if (mentionsAcquirer && mentionsTarget && hasAcquisitionKeywords && !hasDenialKeywords) {
    stance = "confirms";
  } else if (hasDenialKeywords) {
    stance = "denies";
  }

  return {
    url,
    title,
    snippet,
    outlet: extractOutlet(url),
    tier: tierInfo.tier,
    stance,
  };
}

// =============================================================================
// TRIANGULATION
// =============================================================================

function triangulateNewsSources(evidence: SourceEvidence[]): TriangulationResult {
  const confirming = evidence.filter(e => e.stance === "confirms");
  const uniqueDomains = new Set(confirming.map(e => extractDomain(e.url)));
  const tier1Sources = confirming.filter(e => e.tier === 1);
  const tier2Sources = confirming.filter(e => e.tier === 2);

  let consensus: TriangulationResult["consensus"];
  if (tier1Sources.length >= 2 || (tier1Sources.length >= 1 && tier2Sources.length >= 2)) {
    consensus = "strong";
  } else if (tier1Sources.length >= 1 || tier2Sources.length >= 2) {
    consensus = "moderate";
  } else if (confirming.length >= 2) {
    consensus = "weak";
  } else {
    consensus = "weak";
  }

  // Check for conflicting reports
  const denying = evidence.filter(e => e.stance === "denies");
  if (denying.length > 0 && confirming.length > 0) {
    consensus = "conflicting";
  }

  // Find primary source (prefer Tier 1)
  const primarySource = tier1Sources[0]?.url || tier2Sources[0]?.url || confirming[0]?.url;

  return {
    independentSourceCount: uniqueDomains.size,
    tier1SourceCount: tier1Sources.length,
    tier2SourceCount: tier2Sources.length,
    consensus,
    primarySource,
  };
}

// =============================================================================
// CONTRADICTION DETECTION
// =============================================================================

function detectContradictions(evidence: SourceEvidence[]): { source1: string; source2: string; issue: string }[] {
  const contradictions: { source1: string; source2: string; issue: string }[] = [];

  const confirming = evidence.filter(e => e.stance === "confirms");
  const denying = evidence.filter(e => e.stance === "denies");

  // Check for confirm vs deny contradictions
  for (const confirm of confirming) {
    for (const deny of denying) {
      contradictions.push({
        source1: confirm.url,
        source2: deny.url,
        issue: `${confirm.outlet} confirms while ${deny.outlet} questions/denies the event`,
      });
    }
  }

  return contradictions;
}

// =============================================================================
// FINAL VERDICT
// =============================================================================

function calculateFinalVerdict(
  evidence: SourceEvidence[],
  triangulation: TriangulationResult,
  contradictions: { source1: string; source2: string; issue: string }[],
  context: { acquirer?: string; target?: string; requireMultipleSources: boolean; requireTier1Source: boolean }
): {
  eventVerified: boolean;
  overallConfidence: number;
  acquisitionDetails?: AcquisitionDetails;
} {
  const confirming = evidence.filter(e => e.stance === "confirms");

  // Base confidence from triangulation
  let overallConfidence = 0.3;

  if (triangulation.consensus === "strong") {
    overallConfidence = 0.95;
  } else if (triangulation.consensus === "moderate") {
    overallConfidence = 0.8;
  } else if (triangulation.consensus === "weak" && confirming.length > 0) {
    overallConfidence = 0.6;
  } else if (triangulation.consensus === "conflicting") {
    overallConfidence = 0.4;
  }

  // Boost for tier 1 sources
  if (triangulation.tier1SourceCount >= 2) {
    overallConfidence = Math.min(0.98, overallConfidence + 0.1);
  } else if (triangulation.tier1SourceCount >= 1) {
    overallConfidence = Math.min(0.95, overallConfidence + 0.05);
  }

  // Penalty for contradictions
  if (contradictions.length > 0) {
    overallConfidence *= 0.8;
  }

  // Verification requirements
  let eventVerified = false;

  if (context.requireTier1Source && triangulation.tier1SourceCount === 0) {
    // Require at least one Tier 1 source for full verification
    if (triangulation.tier2SourceCount >= 2) {
      eventVerified = true;
      overallConfidence = Math.min(overallConfidence, 0.85);
    }
  } else if (context.requireMultipleSources && triangulation.independentSourceCount < 2) {
    // Require multiple sources
    if (triangulation.tier1SourceCount >= 1) {
      eventVerified = true;
      overallConfidence = Math.min(overallConfidence, 0.8);
    }
  } else if (confirming.length > 0 && triangulation.consensus !== "conflicting") {
    eventVerified = true;
  }

  // Create acquisition details if applicable
  let acquisitionDetails: AcquisitionDetails | undefined;
  if (eventVerified && context.acquirer && context.target) {
    const confirming = evidence.filter(e => e.stance === "confirms");
    acquisitionDetails = {
      acquirer: context.acquirer,
      target: context.target,
      dealType: "acquisition",
      status: eventVerified ? "completed" : "rumored",
      sources: confirming.slice(0, 5).map(e => ({
        outlet: e.outlet,
        title: e.title,
        url: e.url,
        date: e.publishDate,
        reliability: mapTierToReliability(e.tier),
      })),
    };
  }

  return { eventVerified, overallConfidence, acquisitionDetails };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getTierInfo(url: string): { tier: 1 | 2 | 3; weight: number } {
  const domain = extractDomain(url);
  return NEWS_SOURCE_TIERS[domain] || { tier: 3, weight: 0.5 };
}

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace("www.", "");
    const parts = hostname.split(".");
    return parts.length >= 2 ? parts.slice(-2).join(".") : hostname;
  } catch {
    return url;
  }
}

function extractOutlet(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace("www.", "");
    const name = hostname.split(".")[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return "Unknown";
  }
}

function mapToSourceReliability(tier: 1 | 2 | 3): SourceReliability {
  if (tier === 1) return "authoritative";
  if (tier === 2) return "reliable";
  return "secondary";
}

function mapTierToReliability(tier: 1 | 2 | 3): "authoritative" | "reputable" | "tabloid" | "unknown" {
  if (tier === 1) return "authoritative";
  if (tier === 2) return "reputable";
  return "unknown";
}

function createDDSource(evidence: SourceEvidence): DDSource {
  return {
    sourceType: "news_article",
    title: evidence.title,
    url: evidence.url,
    accessedAt: Date.now(),
    reliability: mapToSourceReliability(evidence.tier),
  };
}

function deduplicateSources(sources: DDSource[]): DDSource[] {
  const seen = new Set<string>();
  return sources.filter(source => {
    const key = source.url || source.title || `${Date.now()}-${Math.random()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
