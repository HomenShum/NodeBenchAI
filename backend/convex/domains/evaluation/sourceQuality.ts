// convex/domains/evaluation/sourceQuality.ts
// Source Quality Scoring System
//
// Machine-checkable rules for classifying and scoring data sources.
// Implements 5-tier classification with URL patterns, freshness checks, and metadata validation.
//
// ============================================================================
// SOURCE QUALITY TIERING
// ============================================================================
//
// Tier 1: AUTHORITATIVE - Primary regulatory/official sources
//   - SEC filings (EDGAR), USPTO patents, government registries
//   - Score: 95-100
//
// Tier 2: RELIABLE - High-quality corporate/institutional sources
//   - Earnings calls, investor relations, official press releases
//   - Score: 80-94
//
// Tier 3: SECONDARY - Professional/industry sources
//   - Sell-side research, industry reports, professional databases
//   - Score: 60-79
//
// Tier 4: NEWS - News and press coverage
//   - Major news outlets, press releases, trade publications
//   - Score: 40-59
//
// Tier 5: UNVERIFIED - Unverified or low-reliability sources
//   - Social media, forums, AI inference, unknown domains
//   - Score: 0-39
//
// ============================================================================
// CALIBRATION DESIGN
// ============================================================================
//
// To enable threshold tuning:
// - Every scoring decision is logged with inputs/outputs
// - Human reviewers can label scores as "appropriate" or "over/under"
// - Labels feed calibration analysis for threshold adjustment
//
// ============================================================================

import { v } from "convex/values";
import { internalMutation, mutation, query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* TYPES                                                               */
/* ------------------------------------------------------------------ */

/**
 * Source quality tier
 */
export type SourceTier =
  | "tier1_authoritative"
  | "tier2_reliable"
  | "tier3_secondary"
  | "tier4_news"
  | "tier5_unverified";

/**
 * Source classification result
 */
export interface SourceClassification {
  /** Assigned tier */
  tier: SourceTier;

  /** Numeric score (0-100) */
  score: number;

  /** Which rules matched */
  matchedRules: string[];

  /** Confidence in classification (0-1) */
  confidence: number;

  /** Components of the score */
  scoreBreakdown: {
    domainScore: number;       // Based on URL/domain matching
    freshnessScore: number;    // Based on age of source
    metadataScore: number;     // Based on required metadata presence
    citationScore: number;     // Based on citation completeness
  };

  /** Classification timestamp */
  classifiedAt: number;
}

/**
 * Source quality rule definition
 */
export interface SourceQualityRule {
  /** Unique rule identifier */
  ruleId: string;

  /** Human-readable name */
  name: string;

  /** Target tier this rule assigns */
  tier: SourceTier;

  /** URL patterns (regex) that match this rule */
  urlPatterns: string[];

  /** Exact domain matches (no regex needed) */
  domains: string[];

  /** Required metadata fields */
  requiredMetadata?: string[];

  /** Maximum age in days for full score */
  maxAgeDays?: number;

  /** Base score for matches */
  baseScore: number;

  /** Score adjustment per day past maxAgeDays */
  ageDecayPerDay?: number;

  /** Whether this rule is active */
  isActive: boolean;

  /** Priority for rule ordering (higher = checked first) */
  priority: number;
}

/**
 * Freshness assessment
 */
export interface FreshnessAssessment {
  /** Source date (ISO string) */
  sourceDate: string;

  /** Age in days */
  ageDays: number;

  /** Freshness score (0-100) */
  score: number;

  /** Freshness category */
  category: "fresh" | "recent" | "stale" | "outdated";

  /** Explanation */
  explanation: string;
}

/* ------------------------------------------------------------------ */
/* TIER CONFIGURATION                                                  */
/* ------------------------------------------------------------------ */

/**
 * Tier score ranges
 */
export const TIER_SCORE_RANGES: Record<SourceTier, { min: number; max: number }> = {
  tier1_authoritative: { min: 95, max: 100 },
  tier2_reliable: { min: 80, max: 94 },
  tier3_secondary: { min: 60, max: 79 },
  tier4_news: { min: 40, max: 59 },
  tier5_unverified: { min: 0, max: 39 },
};

/**
 * Tier descriptions for documentation
 */
export const TIER_DESCRIPTIONS: Record<SourceTier, string> = {
  tier1_authoritative: "Primary regulatory/official sources (SEC, USPTO, government)",
  tier2_reliable: "High-quality corporate/institutional sources (earnings calls, IR)",
  tier3_secondary: "Professional/industry sources (research, industry reports)",
  tier4_news: "News and press coverage (news outlets, trade publications)",
  tier5_unverified: "Unverified or low-reliability sources (social media, unknown)",
};

/* ------------------------------------------------------------------ */
/* DEFAULT RULES                                                       */
/* ------------------------------------------------------------------ */

/**
 * Default source quality rules
 * These define the machine-checkable classification logic
 */
export const DEFAULT_SOURCE_RULES: SourceQualityRule[] = [
  // ===== TIER 1: AUTHORITATIVE =====
  {
    ruleId: "sec-edgar",
    name: "SEC EDGAR Filings",
    tier: "tier1_authoritative",
    urlPatterns: [
      "^https?://www\\.sec\\.gov/",
      "^https?://sec\\.gov/",
      "^https?://data\\.sec\\.gov/",
      "^https?://efts\\.sec\\.gov/",
    ],
    domains: ["sec.gov", "www.sec.gov", "data.sec.gov", "efts.sec.gov"],
    requiredMetadata: ["accessionNumber"],
    maxAgeDays: 365,
    baseScore: 100,
    ageDecayPerDay: 0.01,
    isActive: true,
    priority: 100,
  },
  {
    ruleId: "uspto",
    name: "USPTO Patent Database",
    tier: "tier1_authoritative",
    urlPatterns: [
      "^https?://(?:www\\.)?uspto\\.gov/",
      "^https?://patft\\.uspto\\.gov/",
    ],
    domains: ["uspto.gov", "www.uspto.gov", "patft.uspto.gov"],
    maxAgeDays: 730,
    baseScore: 98,
    ageDecayPerDay: 0.005,
    isActive: true,
    priority: 99,
  },
  {
    ruleId: "federal-reserve",
    name: "Federal Reserve",
    tier: "tier1_authoritative",
    urlPatterns: [
      "^https?://(?:www\\.)?federalreserve\\.gov/",
    ],
    domains: ["federalreserve.gov", "www.federalreserve.gov"],
    baseScore: 98,
    maxAgeDays: 365,
    isActive: true,
    priority: 98,
  },
  {
    ruleId: "treasury-gov",
    name: "US Treasury",
    tier: "tier1_authoritative",
    urlPatterns: [
      "^https?://(?:www\\.)?treasury\\.gov/",
      "^https?://home\\.treasury\\.gov/",
    ],
    domains: ["treasury.gov", "www.treasury.gov", "home.treasury.gov"],
    baseScore: 98,
    maxAgeDays: 365,
    isActive: true,
    priority: 97,
  },

  // ===== TIER 2: RELIABLE =====
  {
    ruleId: "company-ir",
    name: "Company Investor Relations",
    tier: "tier2_reliable",
    urlPatterns: [
      "/investor[s]?[-_]?relations?/",
      "/ir\\.",
      "\\.investorroom\\.com/",
      "\\.q4web\\.com/",
    ],
    domains: [],
    maxAgeDays: 180,
    baseScore: 90,
    ageDecayPerDay: 0.05,
    isActive: true,
    priority: 80,
  },
  {
    ruleId: "earnings-transcripts",
    name: "Earnings Call Transcripts",
    tier: "tier2_reliable",
    urlPatterns: [
      "^https?://(?:www\\.)?seekingalpha\\.com/.*transcript",
      "^https?://(?:www\\.)?fool\\.com/earnings/call-transcripts/",
    ],
    domains: [],
    requiredMetadata: ["callDate", "ticker"],
    maxAgeDays: 90,
    baseScore: 85,
    ageDecayPerDay: 0.1,
    isActive: true,
    priority: 79,
  },
  {
    ruleId: "bloomberg-terminal",
    name: "Bloomberg Terminal Data",
    tier: "tier2_reliable",
    urlPatterns: [
      "^https?://(?:www\\.)?bloomberg\\.com/",
    ],
    domains: ["bloomberg.com", "www.bloomberg.com"],
    maxAgeDays: 30,
    baseScore: 88,
    ageDecayPerDay: 0.2,
    isActive: true,
    priority: 78,
  },
  {
    ruleId: "reuters",
    name: "Reuters",
    tier: "tier2_reliable",
    urlPatterns: [
      "^https?://(?:www\\.)?reuters\\.com/",
    ],
    domains: ["reuters.com", "www.reuters.com"],
    maxAgeDays: 30,
    baseScore: 85,
    ageDecayPerDay: 0.3,
    isActive: true,
    priority: 77,
  },

  // ===== TIER 3: SECONDARY =====
  {
    ruleId: "research-reports",
    name: "Research Reports",
    tier: "tier3_secondary",
    urlPatterns: [
      "^https?://(?:www\\.)?morningstar\\.com/",
      "^https?://(?:www\\.)?spglobal\\.com/",
      "^https?://(?:www\\.)?moodys\\.com/",
      "^https?://(?:www\\.)?fitchratings\\.com/",
    ],
    domains: ["morningstar.com", "spglobal.com", "moodys.com", "fitchratings.com"],
    maxAgeDays: 90,
    baseScore: 75,
    ageDecayPerDay: 0.15,
    isActive: true,
    priority: 60,
  },
  {
    ruleId: "industry-databases",
    name: "Industry Databases",
    tier: "tier3_secondary",
    urlPatterns: [
      "^https?://(?:www\\.)?pitchbook\\.com/",
      "^https?://(?:www\\.)?crunchbase\\.com/",
      "^https?://(?:www\\.)?cbinsights\\.com/",
    ],
    domains: ["pitchbook.com", "crunchbase.com", "cbinsights.com"],
    maxAgeDays: 60,
    baseScore: 70,
    ageDecayPerDay: 0.2,
    isActive: true,
    priority: 59,
  },
  {
    ruleId: "financial-news-premium",
    name: "Premium Financial News",
    tier: "tier3_secondary",
    urlPatterns: [
      "^https?://(?:www\\.)?wsj\\.com/",
      "^https?://(?:www\\.)?ft\\.com/",
      "^https?://(?:www\\.)?economist\\.com/",
    ],
    domains: ["wsj.com", "ft.com", "economist.com"],
    maxAgeDays: 30,
    baseScore: 72,
    ageDecayPerDay: 0.3,
    isActive: true,
    priority: 58,
  },

  // ===== TIER 4: NEWS =====
  {
    ruleId: "major-news",
    name: "Major News Outlets",
    tier: "tier4_news",
    urlPatterns: [
      "^https?://(?:www\\.)?nytimes\\.com/",
      "^https?://(?:www\\.)?washingtonpost\\.com/",
      "^https?://(?:www\\.)?cnbc\\.com/",
      "^https?://(?:www\\.)?cnn\\.com/",
      "^https?://(?:www\\.)?bbc\\.com/",
    ],
    domains: ["nytimes.com", "washingtonpost.com", "cnbc.com", "cnn.com", "bbc.com"],
    maxAgeDays: 14,
    baseScore: 55,
    ageDecayPerDay: 0.5,
    isActive: true,
    priority: 40,
  },
  {
    ruleId: "tech-news",
    name: "Tech News",
    tier: "tier4_news",
    urlPatterns: [
      "^https?://(?:www\\.)?techcrunch\\.com/",
      "^https?://(?:www\\.)?theverge\\.com/",
      "^https?://(?:www\\.)?wired\\.com/",
      "^https?://(?:www\\.)?arstechnica\\.com/",
    ],
    domains: ["techcrunch.com", "theverge.com", "wired.com", "arstechnica.com"],
    maxAgeDays: 14,
    baseScore: 50,
    ageDecayPerDay: 0.5,
    isActive: true,
    priority: 39,
  },
  {
    ruleId: "press-releases",
    name: "Press Release Wires",
    tier: "tier4_news",
    urlPatterns: [
      "^https?://(?:www\\.)?prnewswire\\.com/",
      "^https?://(?:www\\.)?businesswire\\.com/",
      "^https?://(?:www\\.)?globenewswire\\.com/",
    ],
    domains: ["prnewswire.com", "businesswire.com", "globenewswire.com"],
    maxAgeDays: 30,
    baseScore: 48,
    ageDecayPerDay: 0.3,
    isActive: true,
    priority: 38,
  },

  // ===== TIER 5: UNVERIFIED =====
  {
    ruleId: "social-media",
    name: "Social Media",
    tier: "tier5_unverified",
    urlPatterns: [
      "^https?://(?:www\\.)?twitter\\.com/",
      "^https?://(?:www\\.)?x\\.com/",
      "^https?://(?:www\\.)?linkedin\\.com/",
      "^https?://(?:www\\.)?facebook\\.com/",
      "^https?://(?:www\\.)?reddit\\.com/",
    ],
    domains: ["twitter.com", "x.com", "linkedin.com", "facebook.com", "reddit.com"],
    baseScore: 25,
    maxAgeDays: 7,
    ageDecayPerDay: 2,
    isActive: true,
    priority: 20,
  },
  {
    ruleId: "wikipedia",
    name: "Wikipedia",
    tier: "tier5_unverified",
    urlPatterns: [
      "^https?://(?:.*\\.)?wikipedia\\.org/",
    ],
    domains: ["wikipedia.org"],
    baseScore: 30,
    isActive: true,
    priority: 19,
  },
  {
    ruleId: "forums",
    name: "Forums and Discussion",
    tier: "tier5_unverified",
    urlPatterns: [
      "^https?://(?:www\\.)?quora\\.com/",
      "^https?://(?:news\\.)?ycombinator\\.com/",
    ],
    domains: ["quora.com", "ycombinator.com"],
    baseScore: 20,
    isActive: true,
    priority: 18,
  },
];

/* ------------------------------------------------------------------ */
/* CLASSIFICATION LOGIC                                                */
/* ------------------------------------------------------------------ */

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    // Try to extract domain without URL parsing
    const match = url.match(/^https?:\/\/(?:www\.)?([^\/]+)/);
    return match ? match[1] : "";
  }
}

/**
 * Check if URL matches any pattern in a rule
 */
function matchesUrlPatterns(url: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern, "i");
      if (regex.test(url)) {
        return true;
      }
    } catch {
      // Invalid regex, skip
    }
  }
  return false;
}

/**
 * Check if domain matches any in a rule
 */
function matchesDomains(url: string, domains: string[]): boolean {
  const urlDomain = extractDomain(url);
  return domains.some((d) => urlDomain === d || urlDomain.endsWith("." + d));
}

/**
 * Calculate freshness score
 */
export function calculateFreshness(
  sourceDate: string | Date,
  maxAgeDays = 30,
  decayPerDay = 0.5
): FreshnessAssessment {
  const now = new Date();
  const date = typeof sourceDate === "string" ? new Date(sourceDate) : sourceDate;
  const ageDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  let score: number;
  let category: FreshnessAssessment["category"];
  let explanation: string;

  if (ageDays <= maxAgeDays) {
    score = 100;
    category = "fresh";
    explanation = `Source is within freshness window (${ageDays} days old, max ${maxAgeDays})`;
  } else {
    const daysOver = ageDays - maxAgeDays;
    const decay = daysOver * decayPerDay;
    score = Math.max(0, 100 - decay);

    if (score >= 70) {
      category = "recent";
      explanation = `Source is slightly stale (${ageDays} days old, -${decay.toFixed(1)} points)`;
    } else if (score >= 40) {
      category = "stale";
      explanation = `Source is stale (${ageDays} days old, -${decay.toFixed(1)} points)`;
    } else {
      category = "outdated";
      explanation = `Source is outdated (${ageDays} days old, significantly past freshness window)`;
    }
  }

  return {
    sourceDate: date.toISOString(),
    ageDays,
    score,
    category,
    explanation,
  };
}

/**
 * Classify a source URL against rules
 */
export function classifySource(
  url: string,
  rules: SourceQualityRule[],
  metadata?: {
    sourceDate?: string;
    hasAccessionNumber?: boolean;
    hasTicker?: boolean;
    hasCallDate?: boolean;
    citationComplete?: boolean;
  }
): SourceClassification {
  // Sort rules by priority (descending)
  const sortedRules = [...rules]
    .filter((r) => r.isActive)
    .sort((a, b) => b.priority - a.priority);

  const matchedRules: string[] = [];
  let matchedRule: SourceQualityRule | null = null;

  // Find first matching rule
  for (const rule of sortedRules) {
    const matchesPattern = matchesUrlPatterns(url, rule.urlPatterns);
    const matchesDomain = matchesDomains(url, rule.domains);

    if (matchesPattern || matchesDomain) {
      matchedRules.push(rule.ruleId);
      if (!matchedRule) {
        matchedRule = rule;
      }
    }
  }

  // Default to tier5 if no match
  if (!matchedRule) {
    return {
      tier: "tier5_unverified",
      score: 20,
      matchedRules: [],
      confidence: 0.5,
      scoreBreakdown: {
        domainScore: 20,
        freshnessScore: 50,
        metadataScore: 0,
        citationScore: 0,
      },
      classifiedAt: Date.now(),
    };
  }

  // Calculate component scores
  let domainScore = matchedRule.baseScore;

  // Freshness adjustment
  let freshnessScore = 100;
  if (metadata?.sourceDate && matchedRule.maxAgeDays) {
    const freshness = calculateFreshness(
      metadata.sourceDate,
      matchedRule.maxAgeDays,
      matchedRule.ageDecayPerDay ?? 0.5
    );
    freshnessScore = freshness.score;
  }

  // Metadata score
  let metadataScore = 100;
  if (matchedRule.requiredMetadata && matchedRule.requiredMetadata.length > 0) {
    let metadataPresent = 0;
    for (const field of matchedRule.requiredMetadata) {
      if (field === "accessionNumber" && metadata?.hasAccessionNumber) metadataPresent++;
      if (field === "ticker" && metadata?.hasTicker) metadataPresent++;
      if (field === "callDate" && metadata?.hasCallDate) metadataPresent++;
    }
    metadataScore = (metadataPresent / matchedRule.requiredMetadata.length) * 100;
  }

  // Citation score
  const citationScore = metadata?.citationComplete ? 100 : 50;

  // Weighted final score
  // Domain: 40%, Freshness: 30%, Metadata: 20%, Citation: 10%
  const finalScore = Math.round(
    domainScore * 0.4 +
    freshnessScore * 0.3 +
    metadataScore * 0.2 +
    citationScore * 0.1
  );

  // Clamp to tier range
  const tierRange = TIER_SCORE_RANGES[matchedRule.tier];
  const clampedScore = Math.max(tierRange.min, Math.min(tierRange.max, finalScore));

  // Confidence based on match quality
  const confidence = matchedRules.length > 0
    ? Math.min(1, 0.7 + (matchedRules.length * 0.1))
    : 0.5;

  return {
    tier: matchedRule.tier,
    score: clampedScore,
    matchedRules,
    confidence,
    scoreBreakdown: {
      domainScore,
      freshnessScore,
      metadataScore,
      citationScore,
    },
    classifiedAt: Date.now(),
  };
}

/**
 * Aggregate quality scores from multiple sources
 */
export function aggregateSourceQuality(
  classifications: SourceClassification[]
): {
  overallScore: number;
  tierDistribution: Record<SourceTier, number>;
  primarySourceRatio: number;
  averageConfidence: number;
  concerns: string[];
} {
  if (classifications.length === 0) {
    return {
      overallScore: 0,
      tierDistribution: {
        tier1_authoritative: 0,
        tier2_reliable: 0,
        tier3_secondary: 0,
        tier4_news: 0,
        tier5_unverified: 0,
      },
      primarySourceRatio: 0,
      averageConfidence: 0,
      concerns: ["No sources to evaluate"],
    };
  }

  // Calculate tier distribution
  const tierDistribution: Record<SourceTier, number> = {
    tier1_authoritative: 0,
    tier2_reliable: 0,
    tier3_secondary: 0,
    tier4_news: 0,
    tier5_unverified: 0,
  };

  for (const c of classifications) {
    tierDistribution[c.tier]++;
  }

  // Primary source ratio (Tier 1 + 2)
  const primaryCount = tierDistribution.tier1_authoritative + tierDistribution.tier2_reliable;
  const primarySourceRatio = primaryCount / classifications.length;

  // Weighted average score (primary sources weighted more)
  const totalWeight = classifications.reduce((sum, c) => {
    const tierWeight = c.tier === "tier1_authoritative" ? 3 :
      c.tier === "tier2_reliable" ? 2 :
      c.tier === "tier3_secondary" ? 1.5 : 1;
    return sum + tierWeight;
  }, 0);

  const weightedScoreSum = classifications.reduce((sum, c) => {
    const tierWeight = c.tier === "tier1_authoritative" ? 3 :
      c.tier === "tier2_reliable" ? 2 :
      c.tier === "tier3_secondary" ? 1.5 : 1;
    return sum + (c.score * tierWeight);
  }, 0);

  const overallScore = Math.round(weightedScoreSum / totalWeight);

  // Average confidence
  const averageConfidence = classifications.reduce((sum, c) => sum + c.confidence, 0) / classifications.length;

  // Identify concerns
  const concerns: string[] = [];

  if (primarySourceRatio < 0.3) {
    concerns.push("Low ratio of authoritative/reliable sources (<30%)");
  }

  if (tierDistribution.tier5_unverified > classifications.length * 0.3) {
    concerns.push("High proportion of unverified sources (>30%)");
  }

  if (averageConfidence < 0.6) {
    concerns.push("Low average confidence in source classifications");
  }

  const lowFreshness = classifications.filter((c) => c.scoreBreakdown.freshnessScore < 50);
  if (lowFreshness.length > classifications.length * 0.5) {
    concerns.push("Majority of sources have low freshness scores");
  }

  return {
    overallScore,
    tierDistribution,
    primarySourceRatio,
    averageConfidence,
    concerns,
  };
}

/* ------------------------------------------------------------------ */
/* CONVEX QUERIES & MUTATIONS                                          */
/* ------------------------------------------------------------------ */

/**
 * Classify a source and log for calibration
 */
export const classifyAndLogSource = mutation({
  args: {
    url: v.string(),
    sourceDate: v.optional(v.string()),
    metadata: v.optional(v.object({
      hasAccessionNumber: v.optional(v.boolean()),
      hasTicker: v.optional(v.boolean()),
      hasCallDate: v.optional(v.boolean()),
      citationComplete: v.optional(v.boolean()),
    })),
    // Context for audit trail
    entityKey: v.optional(v.string()),
    evaluationId: v.optional(v.string()),
  },
  returns: v.object({
    classification: v.object({
      tier: v.string(),
      score: v.number(),
      matchedRules: v.array(v.string()),
      confidence: v.number(),
    }),
    logId: v.id("sourceQualityLog"),
  }),
  handler: async (ctx, args) => {
    // Classify the source
    const classification = classifySource(
      args.url,
      DEFAULT_SOURCE_RULES,
      {
        sourceDate: args.sourceDate,
        hasAccessionNumber: args.metadata?.hasAccessionNumber,
        hasTicker: args.metadata?.hasTicker,
        hasCallDate: args.metadata?.hasCallDate,
        citationComplete: args.metadata?.citationComplete,
      }
    );

    // Log for calibration/audit
    const logId = await ctx.db.insert("sourceQualityLog", {
      url: args.url,
      domain: extractDomain(args.url),
      sourceDate: args.sourceDate,
      metadata: args.metadata,
      tier: classification.tier,
      score: classification.score,
      matchedRules: classification.matchedRules,
      confidence: classification.confidence,
      scoreBreakdown: classification.scoreBreakdown,
      entityKey: args.entityKey,
      evaluationId: args.evaluationId,
      // Calibration fields (to be filled by reviewers)
      humanLabel: undefined,
      labeledBy: undefined,
      labeledAt: undefined,
      classifiedAt: classification.classifiedAt,
    });

    return {
      classification: {
        tier: classification.tier,
        score: classification.score,
        matchedRules: classification.matchedRules,
        confidence: classification.confidence,
      },
      logId,
    };
  },
});

/**
 * Label a source quality classification (for calibration)
 */
export const labelSourceQuality = mutation({
  args: {
    logId: v.id("sourceQualityLog"),
    label: v.union(
      v.literal("appropriate"),
      v.literal("over_scored"),
      v.literal("under_scored"),
      v.literal("wrong_tier")
    ),
    suggestedTier: v.optional(v.string()),
    suggestedScore: v.optional(v.number()),
    notes: v.optional(v.string()),
    labeledBy: v.string(),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.logId, {
      humanLabel: args.label,
      suggestedTier: args.suggestedTier,
      suggestedScore: args.suggestedScore,
      labelNotes: args.notes,
      labeledBy: args.labeledBy,
      labeledAt: Date.now(),
    });

    return { ok: true };
  },
});

/**
 * Get calibration metrics for source quality
 */
export const getCalibrationMetrics = query({
  args: {
    sinceDays: v.optional(v.number()),
  },
  returns: v.object({
    totalClassifications: v.number(),
    labeledCount: v.number(),
    labelDistribution: v.any(),
    tierAccuracy: v.any(),
    averageScoreDrift: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const sinceDays = args.sinceDays ?? 30;
    const since = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

    const logs = await ctx.db
      .query("sourceQualityLog")
      .withIndex("by_classified_at", (q) => q.gte("classifiedAt", since))
      .collect();

    const totalClassifications = logs.length;
    const labeled = logs.filter((l) => l.humanLabel);
    const labeledCount = labeled.length;

    // Label distribution
    const labelDistribution: Record<string, number> = {
      appropriate: 0,
      over_scored: 0,
      under_scored: 0,
      wrong_tier: 0,
    };

    for (const l of labeled) {
      if (l.humanLabel) {
        labelDistribution[l.humanLabel] = (labelDistribution[l.humanLabel] ?? 0) + 1;
      }
    }

    // Tier accuracy (where suggested tier differs from assigned)
    const tierAccuracy: Record<string, { correct: number; total: number }> = {};
    for (const l of labeled) {
      const tier = l.tier;
      if (!tierAccuracy[tier]) {
        tierAccuracy[tier] = { correct: 0, total: 0 };
      }
      tierAccuracy[tier].total++;
      if (l.humanLabel === "appropriate" || !l.suggestedTier) {
        tierAccuracy[tier].correct++;
      }
    }

    // Average score drift for labeled items with suggested scores
    const scoreDrifts = labeled
      .filter((l) => l.suggestedScore !== undefined)
      .map((l) => (l.suggestedScore as number) - l.score);

    const averageScoreDrift = scoreDrifts.length > 0
      ? scoreDrifts.reduce((a, b) => a + b, 0) / scoreDrifts.length
      : undefined;

    return {
      totalClassifications,
      labeledCount,
      labelDistribution,
      tierAccuracy,
      averageScoreDrift,
    };
  },
});

/**
 * Get source quality rules (for UI/debugging)
 */
export const getSourceQualityRules = query({
  args: {},
  returns: v.array(v.object({
    ruleId: v.string(),
    name: v.string(),
    tier: v.string(),
    domains: v.array(v.string()),
    baseScore: v.number(),
    priority: v.number(),
    isActive: v.boolean(),
  })),
  handler: async () => {
    return DEFAULT_SOURCE_RULES.map((r) => ({
      ruleId: r.ruleId,
      name: r.name,
      tier: r.tier,
      domains: r.domains,
      baseScore: r.baseScore,
      priority: r.priority,
      isActive: r.isActive,
    }));
  },
});
