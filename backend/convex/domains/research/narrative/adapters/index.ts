/**
 * Narrative Content Adapters - Barrel Export
 *
 * Adapters convert existing content pipelines into the narrative system:
 * - Brief Adapter: Daily Brief features/signals → NarrativeEvents
 * - LinkedIn Adapter: Funding posts → NarrativeEvents (milestones)
 * - Feed Adapter: ForYouFeed items → Thread context enrichment
 *
 * @module domains/narrative/adapters
 */

// ═══════════════════════════════════════════════════════════════════════════
// TYPE EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export type {
  // Core types
  ContentAdapter,
  NarrativeEventInput,
  TemporalBounds,
  EventSignificance,

  // Source types
  BriefFeature,
  BriefSignal,
  LinkedInFundingPost,
  FeedRankedCandidate,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export {
  // Significance mapping
  briefPriorityToSignificance,
  fundingAmountToSignificance,
  phoenixScoreToSignificance,

  // Week number utilities
  getCurrentWeekNumber,
  getWeekNumberForDate,

  // ID generation
  fnv1a32Hex,
  generateEventId,
  generateTemporalFactId,

  // Entity normalization
  normalizeEntityKey,

  // Parsing
  parseFundingAmount,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTER EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

// Brief Adapter
export {
  BriefFeatureAdapter,
  BriefSignalAdapter,
  processBriefFeatures,
  processBriefSignals,
} from "./briefAdapter";

// LinkedIn Adapter
export {
  LinkedInFundingAdapter,
  extractFundingFacts,
  processFundingPosts,
  extractFundingFactsBatch,
  type FundingTemporalFact,
} from "./linkedinAdapter";

// Feed Adapter
export {
  FeedCandidateAdapter,
  extractThreadContext,
  processFeedCandidates,
  processFeedForContext,
  type ThreadContextEnrichment,
  type SentimentSignal,
} from "./feedAdapter";

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED ADAPTER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

import { processBriefFeatures, processBriefSignals } from "./briefAdapter";
import { processFundingPosts } from "./linkedinAdapter";
import { processFeedCandidates, processFeedForContext } from "./feedAdapter";
import type {
  BriefFeature,
  BriefSignal,
  LinkedInFundingPost,
  FeedRankedCandidate,
  NarrativeEventInput,
} from "./types";
import type { ThreadContextEnrichment } from "./feedAdapter";
import { getCurrentWeekNumber } from "./types";

/**
 * Options for unified adapter processing.
 */
export interface AdapterProcessingOptions {
  /** Minimum priority for brief features (default: 5) */
  briefMinPriority?: number;
  /** Minimum amount for funding posts in USD (default: 0) */
  fundingMinAmountUsd?: number;
  /** Minimum phoenix score for feed items (default: 60) */
  feedMinPhoenixScore?: number;
}

/**
 * Input for unified adapter processing.
 */
export interface AdapterInput {
  briefFeatures?: BriefFeature[];
  briefSignals?: { signals: BriefSignal[]; briefDate: string; briefTimestamp: number };
  fundingPosts?: LinkedInFundingPost[];
  feedCandidates?: FeedRankedCandidate[];
}

/**
 * Result from unified adapter processing.
 */
export interface AdapterResult {
  events: NarrativeEventInput[];
  contextEnrichments: ThreadContextEnrichment[];
  stats: {
    briefEventsCreated: number;
    fundingEventsCreated: number;
    feedEventsCreated: number;
    contextEnrichmentsCreated: number;
  };
}

/**
 * Process all content sources through adapters in a unified way.
 *
 * @param input - Content from various sources
 * @param options - Processing options
 * @returns Events and context enrichments
 */
export function processAllContent(
  input: AdapterInput,
  options: AdapterProcessingOptions = {}
): AdapterResult {
  const events: NarrativeEventInput[] = [];
  const contextEnrichments: ThreadContextEnrichment[] = [];
  const stats = {
    briefEventsCreated: 0,
    fundingEventsCreated: 0,
    feedEventsCreated: 0,
    contextEnrichmentsCreated: 0,
  };

  // Process brief features
  if (input.briefFeatures?.length) {
    const briefEvents = processBriefFeatures(input.briefFeatures, {
      minPriority: options.briefMinPriority,
    });
    events.push(...briefEvents);
    stats.briefEventsCreated = briefEvents.length;
  }

  // Process brief signals
  if (input.briefSignals) {
    const signalEvents = processBriefSignals(
      input.briefSignals.signals,
      input.briefSignals.briefDate,
      input.briefSignals.briefTimestamp
    );
    events.push(...signalEvents);
    stats.briefEventsCreated += signalEvents.length;
  }

  // Process funding posts
  if (input.fundingPosts?.length) {
    const fundingEvents = processFundingPosts(input.fundingPosts, {
      minAmountUsd: options.fundingMinAmountUsd,
    });
    events.push(...fundingEvents);
    stats.fundingEventsCreated = fundingEvents.length;
  }

  // Process feed candidates
  if (input.feedCandidates?.length) {
    // Create events for high-scoring items
    const feedEvents = processFeedCandidates(input.feedCandidates, {
      minPhoenixScore: options.feedMinPhoenixScore,
    });
    events.push(...feedEvents);
    stats.feedEventsCreated = feedEvents.length;

    // Create context enrichments for all items
    const enrichments = processFeedForContext(input.feedCandidates, getCurrentWeekNumber());
    contextEnrichments.push(...enrichments);
    stats.contextEnrichmentsCreated = enrichments.length;
  }

  return { events, contextEnrichments, stats };
}
