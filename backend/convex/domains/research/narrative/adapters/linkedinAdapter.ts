/**
 * LinkedIn Adapter
 *
 * Converts LinkedIn funding posts into NarrativeEvents (milestones).
 * Maps funding amounts to event significance:
 * - >$100M → plot_twist
 * - $50M-$100M → major
 * - $10M-$50M → moderate
 * - <$10M → minor
 *
 * Also extracts temporal facts for valuation/funding tracking.
 *
 * @module domains/narrative/adapters/linkedinAdapter
 */

import type {
  ContentAdapter,
  NarrativeEventInput,
  TemporalBounds,
  EventSignificance,
  LinkedInFundingPost,
} from "./types";
import {
  fundingAmountToSignificance,
  getWeekNumberForDate,
  parseFundingAmount,
  fnv1a32Hex,
  normalizeEntityKey,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// LINKEDIN FUNDING POST ADAPTER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Adapter for converting LinkedIn funding posts to NarrativeEvents.
 */
export const LinkedInFundingAdapter: ContentAdapter<LinkedInFundingPost> = {
  toNarrativeEvents(post: LinkedInFundingPost): NarrativeEventInput[] {
    if (!this.shouldCreateEvent(post)) {
      return [];
    }

    const temporalBounds = this.extractTemporalBounds(post);
    const entityKeys = this.extractEntityKeys(post);
    const significance = this.computeSignificance(post);

    // Build headline and summary
    const headline = buildFundingHeadline(post);
    const summary = buildFundingSummary(post);

    // Generate citation ID from LinkedIn post URL
    const citationIds = [`websrc_${fnv1a32Hex(post.postUrl)}`];

    const event: NarrativeEventInput = {
      headline,
      summary,
      significance,
      occurredAt: temporalBounds.occurredAt,
      weekNumber: getWeekNumberForDate(temporalBounds.occurredAt),
      sourceUrls: [post.postUrl],
      sourceNames: ["LinkedIn"],
      citationIds,
      discoveredByAgent: "LinkedInAdapter",
      agentConfidence: 0.95, // LinkedIn posts are high confidence
      entityKeys,
      topicTags: buildTopicTags(post),
      sourceType: "linkedin_funding",
      sourceId: post._id,
    };

    return [event];
  },

  extractEntityKeys(post: LinkedInFundingPost): string[] {
    const keys: string[] = [];

    // Company entity
    keys.push(normalizeEntityKey(post.companyName, "company"));

    // Sector-based topic
    if (post.sectorCategory) {
      keys.push(`topic:${post.sectorCategory}`);
    }

    // Funding round type as topic
    keys.push(`topic:${normalizeRoundType(post.roundType)}`);

    return [...new Set(keys)];
  },

  computeSignificance(post: LinkedInFundingPost): EventSignificance {
    // Use pre-parsed amount if available
    const amountUsd = post.amountUsd ?? parseFundingAmount(post.amountRaw);
    return fundingAmountToSignificance(amountUsd);
  },

  extractTemporalBounds(post: LinkedInFundingPost): TemporalBounds {
    return {
      occurredAt: post.postedAt,
      validFrom: post.postedAt,
      // Funding facts are generally valid until next round
    };
  },

  shouldCreateEvent(post: LinkedInFundingPost): boolean {
    // Create events for all funding posts with valid amounts
    return post.amountRaw.length > 0 && post.companyName.length > 0;
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// TEMPORAL FACT EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Interface for temporal funding facts.
 */
export interface FundingTemporalFact {
  subject: string; // "company:xAI"
  predicate: string; // "raised_funding" | "valued_at"
  object: string; // "$6B Series E" | "$50B"
  validFrom: number;
  confidence: number;
  sourceEventId?: string;
}

/**
 * Extract temporal facts from a funding post.
 * Returns facts about funding raised and implied valuation.
 */
export function extractFundingFacts(post: LinkedInFundingPost): FundingTemporalFact[] {
  const facts: FundingTemporalFact[] = [];
  const entityKey = normalizeEntityKey(post.companyName, "company");

  // Funding raised fact
  facts.push({
    subject: entityKey,
    predicate: "raised_funding",
    object: `${post.amountRaw} ${post.roundType}`,
    validFrom: post.postedAt,
    confidence: 0.95,
  });

  // If we can estimate valuation from round type and amount, add that
  const estimatedValuation = estimateValuation(post);
  if (estimatedValuation) {
    facts.push({
      subject: entityKey,
      predicate: "valued_at",
      object: estimatedValuation,
      validFrom: post.postedAt,
      confidence: 0.7, // Lower confidence for estimated valuations
    });
  }

  return facts;
}

// ═══════════════════════════════════════════════════════════════════════════
// BATCH PROCESSING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process multiple funding posts into narrative events.
 */
export function processFundingPosts(
  posts: LinkedInFundingPost[],
  options?: { minAmountUsd?: number }
): NarrativeEventInput[] {
  const minAmount = options?.minAmountUsd ?? 0;

  return posts
    .filter((post) => {
      const amount = post.amountUsd ?? parseFundingAmount(post.amountRaw) ?? 0;
      return amount >= minAmount;
    })
    .flatMap((post) => LinkedInFundingAdapter.toNarrativeEvents(post));
}

/**
 * Extract temporal facts from multiple funding posts.
 */
export function extractFundingFactsBatch(posts: LinkedInFundingPost[]): FundingTemporalFact[] {
  return posts.flatMap((post) => extractFundingFacts(post));
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build headline for funding event.
 */
function buildFundingHeadline(post: LinkedInFundingPost): string {
  const action = post.progressionType === "next-round" ? "closes" : "raises";
  return `${post.companyName} ${action} ${post.amountRaw} ${post.roundType}`;
}

/**
 * Build summary for funding event.
 */
function buildFundingSummary(post: LinkedInFundingPost): string {
  const sectorContext = post.sector ? ` The ${post.sector} company` : " The company";
  const progressionContext =
    post.progressionType === "next-round"
      ? "This marks a progression from their previous funding round."
      : "";

  return `${post.companyName} has secured ${post.amountRaw} in ${post.roundType} funding.${sectorContext} continues to attract investor interest.${progressionContext ? " " + progressionContext : ""}`;
}

/**
 * Build topic tags for funding event.
 */
function buildTopicTags(post: LinkedInFundingPost): string[] {
  const tags = ["funding", normalizeRoundType(post.roundType)];

  if (post.sectorCategory) {
    tags.push(post.sectorCategory);
  }

  const amount = post.amountUsd ?? parseFundingAmount(post.amountRaw);
  if (amount && amount >= 100_000_000) {
    tags.push("mega_round");
  } else if (amount && amount >= 50_000_000) {
    tags.push("large_round");
  }

  return tags;
}

/**
 * Normalize round type to consistent format.
 */
function normalizeRoundType(roundType: string): string {
  return roundType
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/**
 * Estimate valuation from funding round (rough heuristic).
 * Based on typical dilution percentages.
 */
function estimateValuation(post: LinkedInFundingPost): string | undefined {
  const amount = post.amountUsd ?? parseFundingAmount(post.amountRaw);
  if (!amount) return undefined;

  // Typical dilution by round (rough estimates)
  const dilutionByRound: Record<string, number> = {
    seed: 0.2, // 20% dilution
    series_a: 0.2,
    series_b: 0.15,
    series_c: 0.12,
    series_d: 0.1,
    series_e: 0.08,
  };

  const normalized = normalizeRoundType(post.roundType);
  const dilution = dilutionByRound[normalized];

  if (!dilution) return undefined;

  const estimatedVal = amount / dilution;

  // Format as readable string
  if (estimatedVal >= 1_000_000_000) {
    return `~$${(estimatedVal / 1_000_000_000).toFixed(1)}B`;
  }
  if (estimatedVal >= 1_000_000) {
    return `~$${(estimatedVal / 1_000_000).toFixed(0)}M`;
  }

  return undefined;
}
