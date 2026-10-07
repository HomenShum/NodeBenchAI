/**
 * Feed Adapter
 *
 * Converts ForYouFeed ranked candidates into thread context enrichment.
 * Feed items primarily enrich existing threads rather than creating new events.
 *
 * High phoenixScore items (>80) may create moderate significance events.
 * All items contribute to sentiment tracking and context.
 *
 * @module domains/narrative/adapters/feedAdapter
 */

import type {
  ContentAdapter,
  NarrativeEventInput,
  TemporalBounds,
  EventSignificance,
  FeedRankedCandidate,
} from "./types";
import {
  phoenixScoreToSignificance,
  getWeekNumberForDate,
  fnv1a32Hex,
  normalizeEntityKey,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// FEED RANKED CANDIDATE ADAPTER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Adapter for converting ForYouFeed ranked candidates to NarrativeEvents.
 */
export const FeedCandidateAdapter: ContentAdapter<FeedRankedCandidate> = {
  toNarrativeEvents(candidate: FeedRankedCandidate): NarrativeEventInput[] {
    if (!this.shouldCreateEvent(candidate)) {
      return [];
    }

    const temporalBounds = this.extractTemporalBounds(candidate);
    const entityKeys = this.extractEntityKeys(candidate);
    const significance = this.computeSignificance(candidate);

    // Extract source URL from metadata if available
    const sourceUrl = extractSourceUrl(candidate);
    const sourceUrls = sourceUrl ? [sourceUrl] : [];
    const sourceNames = sourceUrl ? [extractDomain(sourceUrl)] : [];
    const citationIds = sourceUrls.map((url) => `websrc_${fnv1a32Hex(url)}`);

    const event: NarrativeEventInput = {
      headline: candidate.title,
      summary: candidate.snippet || candidate.relevanceReason,
      significance,
      occurredAt: temporalBounds.occurredAt,
      weekNumber: getWeekNumberForDate(temporalBounds.occurredAt),
      sourceUrls,
      sourceNames,
      citationIds,
      discoveredByAgent: "FeedAdapter",
      agentConfidence: normalizePhoenixScore(candidate.phoenixScore),
      entityKeys,
      topicTags: extractTopicTags(candidate),
      sourceType: "feed_item",
      sourceId: candidate.itemId,
    };

    return [event];
  },

  extractEntityKeys(candidate: FeedRankedCandidate): string[] {
    const keys: string[] = [];
    const text = `${candidate.title} ${candidate.snippet || ""}`;

    // Extract company mentions
    const companyPatterns =
      /\b(OpenAI|Google|Microsoft|Apple|Meta|Amazon|Anthropic|xAI|Tesla|Nvidia|DeepSeek|Mistral|Cursor|GitHub|AWS|Azure)\b/gi;
    const companyMatches = text.match(companyPatterns);
    if (companyMatches) {
      for (const match of companyMatches) {
        keys.push(normalizeEntityKey(match, "company"));
      }
    }

    // Extract from metadata if present
    if (candidate.metadata?.entityRefs) {
      const refs = candidate.metadata.entityRefs as string[];
      keys.push(...refs);
    }

    // Add item type as topic
    keys.push(`topic:${candidate.itemType}`);

    // Add source category
    keys.push(`topic:${candidate.source.replace("_", "-")}`);

    return [...new Set(keys)];
  },

  computeSignificance(candidate: FeedRankedCandidate): EventSignificance {
    return phoenixScoreToSignificance(candidate.phoenixScore);
  },

  extractTemporalBounds(candidate: FeedRankedCandidate): TemporalBounds {
    return {
      occurredAt: candidate.timestamp,
      validFrom: candidate.timestamp,
    };
  },

  shouldCreateEvent(candidate: FeedRankedCandidate): boolean {
    // Only create events for high-scoring candidates (>60)
    // Lower-scoring items contribute to sentiment/context but not as events
    return candidate.phoenixScore > 60;
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// THREAD CONTEXT ENRICHMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Thread context data extracted from feed items.
 * Used to enrich existing threads without creating new events.
 */
export interface ThreadContextEnrichment {
  entityKey: string;
  weekNumber: string;
  mentionCount: number;
  sourceUrls: string[];
  sentimentSignals: SentimentSignal[];
  topTopics: string[];
  aggregateScore: number; // Average phoenix score
}

/**
 * Individual sentiment signal from a feed item.
 */
export interface SentimentSignal {
  title: string;
  snippet: string;
  sentiment: "positive" | "negative" | "neutral";
  confidence: number;
  sourceUrl?: string;
  timestamp: number;
}

/**
 * Extract thread context enrichment from feed candidates.
 * Groups by entity and aggregates sentiment/topics.
 */
export function extractThreadContext(
  candidates: FeedRankedCandidate[],
  weekNumber: string
): ThreadContextEnrichment[] {
  // Group by entity
  const entityGroups = new Map<string, FeedRankedCandidate[]>();

  for (const candidate of candidates) {
    const entityKeys = FeedCandidateAdapter.extractEntityKeys(candidate);
    for (const key of entityKeys) {
      if (!entityGroups.has(key)) {
        entityGroups.set(key, []);
      }
      entityGroups.get(key)!.push(candidate);
    }
  }

  // Build enrichment for each entity
  const enrichments: ThreadContextEnrichment[] = [];

  for (const [entityKey, items] of entityGroups) {
    const sourceUrls = items
      .map((c) => extractSourceUrl(c))
      .filter((url): url is string => url !== undefined);

    const sentimentSignals = items.map((c) => ({
      title: c.title,
      snippet: c.snippet || "",
      sentiment: inferSentiment(c),
      confidence: normalizePhoenixScore(c.phoenixScore),
      sourceUrl: extractSourceUrl(c),
      timestamp: c.timestamp,
    }));

    const topTopics = extractTopTopics(items);
    const aggregateScore = items.reduce((sum, c) => sum + c.phoenixScore, 0) / items.length;

    enrichments.push({
      entityKey,
      weekNumber,
      mentionCount: items.length,
      sourceUrls,
      sentimentSignals,
      topTopics,
      aggregateScore,
    });
  }

  return enrichments;
}

// ═══════════════════════════════════════════════════════════════════════════
// BATCH PROCESSING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process feed candidates into narrative events.
 * Only high-scoring candidates become events.
 */
export function processFeedCandidates(
  candidates: FeedRankedCandidate[],
  options?: { minPhoenixScore?: number }
): NarrativeEventInput[] {
  const minScore = options?.minPhoenixScore ?? 60;

  return candidates
    .filter((c) => c.phoenixScore >= minScore)
    .flatMap((c) => FeedCandidateAdapter.toNarrativeEvents(c));
}

/**
 * Process feed candidates for thread context enrichment.
 */
export function processFeedForContext(
  candidates: FeedRankedCandidate[],
  weekNumber: string
): ThreadContextEnrichment[] {
  return extractThreadContext(candidates, weekNumber);
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract source URL from candidate metadata.
 */
function extractSourceUrl(candidate: FeedRankedCandidate): string | undefined {
  // Check common metadata fields for URLs
  const metadata = candidate.metadata || {};
  return (
    (metadata.url as string) ||
    (metadata.sourceUrl as string) ||
    (metadata.link as string) ||
    undefined
  );
}

/**
 * Extract domain from URL.
 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

/**
 * Normalize phoenix score to 0-1 confidence.
 */
function normalizePhoenixScore(score: number): number {
  return Math.min(1, Math.max(0, score / 100));
}

/**
 * Extract topic tags from candidate.
 */
function extractTopicTags(candidate: FeedRankedCandidate): string[] {
  const tags: string[] = [candidate.itemType, candidate.source.replace("_", "-")];

  // Extract from metadata
  const metadata = candidate.metadata || {};
  if (metadata.category) {
    tags.push(metadata.category as string);
  }
  if (metadata.tags && Array.isArray(metadata.tags)) {
    tags.push(...(metadata.tags as string[]));
  }

  return [...new Set(tags.map((t) => t.toLowerCase()))];
}

/**
 * Extract top topics from a group of candidates.
 */
function extractTopTopics(candidates: FeedRankedCandidate[]): string[] {
  const topicCounts = new Map<string, number>();

  for (const candidate of candidates) {
    const tags = extractTopicTags(candidate);
    for (const tag of tags) {
      topicCounts.set(tag, (topicCounts.get(tag) || 0) + 1);
    }
  }

  return Array.from(topicCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic]) => topic);
}

/**
 * Infer sentiment from candidate content (simple heuristic).
 */
function inferSentiment(candidate: FeedRankedCandidate): "positive" | "negative" | "neutral" {
  const text = `${candidate.title} ${candidate.snippet || ""}`.toLowerCase();

  // Simple keyword-based sentiment (could be enhanced with LLM)
  const positivePatterns =
    /breakthrough|launch|success|growth|funding|partnership|milestone|innovation/;
  const negativePatterns =
    /failure|lawsuit|decline|layoff|controversy|breach|delay|crisis/;

  if (positivePatterns.test(text)) return "positive";
  if (negativePatterns.test(text)) return "negative";
  return "neutral";
}
