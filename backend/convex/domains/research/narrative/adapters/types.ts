/**
 * Narrative Content Adapter Types
 *
 * Defines interfaces for adapting existing content pipelines
 * (Daily Briefs, LinkedIn Posts, ForYouFeed) into NarrativeEvents.
 *
 * @module domains/narrative/adapters/types
 */

import type { Id } from "../../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// EVENT SIGNIFICANCE LEVELS
// ═══════════════════════════════════════════════════════════════════════════

export type EventSignificance = "minor" | "moderate" | "major" | "plot_twist";

// ═══════════════════════════════════════════════════════════════════════════
// NARRATIVE EVENT INPUT (What adapters produce)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Input for creating a NarrativeEvent.
 * Adapters produce this format for the Publisher agent to persist.
 */
export interface NarrativeEventInput {
  headline: string;
  summary: string;
  significance: EventSignificance;
  occurredAt: number;
  weekNumber: string; // "2026-W04"
  sourceUrls: string[];
  sourceNames: string[];
  citationIds: string[]; // websrc_<hash>
  discoveredByAgent: string;
  agentConfidence: number;

  // For thread linkage
  entityKeys: string[]; // e.g., ["company:xAI", "person:Elon_Musk"]
  topicTags: string[];

  // Optional metadata
  sourceType: "brief_feature" | "linkedin_funding" | "feed_item" | "web_search";
  sourceId?: string; // Original ID from source system
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMPORAL BOUNDS (For facts that change over time)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Temporal bounds for facts.
 * Used to track how facts evolve (e.g., valuation changes).
 */
export interface TemporalBounds {
  occurredAt: number; // When the fact was observed
  validFrom?: number; // When fact became true (if different from occurredAt)
  validTo?: number; // When fact was superseded (null = still current)
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTENT ADAPTER INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generic adapter interface for converting source content to NarrativeEvents.
 *
 * Each adapter implements this interface for a specific source type:
 * - BriefAdapter: Daily Brief features → NarrativeEvents
 * - LinkedInAdapter: Funding posts → NarrativeEvents (milestones)
 * - FeedAdapter: ForYouFeed items → Thread context enrichment
 */
export interface ContentAdapter<TSource> {
  /**
   * Convert source content to narrative event(s).
   * One source item may produce multiple events.
   */
  toNarrativeEvents(source: TSource): NarrativeEventInput[];

  /**
   * Extract entity keys for thread linking.
   * Returns canonicalKeys like ["company:xAI", "person:Sam_Altman"]
   */
  extractEntityKeys(source: TSource): string[];

  /**
   * Determine event significance based on source priority/importance.
   */
  computeSignificance(source: TSource): EventSignificance;

  /**
   * Extract temporal bounds for time-varying facts.
   */
  extractTemporalBounds(source: TSource): TemporalBounds;

  /**
   * Check if this source should produce a narrative event.
   * Returns false for low-priority or irrelevant content.
   */
  shouldCreateEvent(source: TSource): boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Daily Brief Feature (from dailyBriefMemories.features[])
 */
export interface BriefFeature {
  id: string;
  type: string; // "repo_analysis", "paper_summary", "funding", "product", etc.
  name: string;
  status: "pending" | "failing" | "passing";
  priority?: number; // 1-10 scale
  testCriteria: string;
  sourceRefs?: {
    urls?: string[];
    feedItemIds?: string[];
  };
  notes?: string;
  updatedAt: number;
}

/**
 * Brief Signal (from DailyBriefPayload.actII.signals[])
 */
export interface BriefSignal {
  id: string;
  headline: string;
  synthesis: string;
  classification: string;
  urgency: string;
  evidence: Array<{
    title: string;
    url: string;
    snippet?: string;
    credibility?: string;
    publishedAt?: string;
  }>;
}

/**
 * LinkedIn Funding Post (from linkedinFundingPosts table)
 */
export interface LinkedInFundingPost {
  _id: Id<"linkedinFundingPosts">;
  companyName: string;
  companyNameNormalized: string;
  roundType: string; // "Series A", "Seed", etc.
  amountRaw: string; // "$15M", "$100M", etc.
  amountUsd?: number;
  sector?: string;
  sectorCategory?: string;
  postUrl: string;
  postedAt: number;
  progressionType?: "new" | "update" | "next-round";
  fundingEventId?: Id<"fundingEvents">;
}

/**
 * ForYouFeed Ranked Candidate
 */
export interface FeedRankedCandidate {
  itemId: string;
  itemType: "document" | "agent" | "repository" | "update" | "feed_item";
  source: "in_network" | "out_of_network" | "trending";
  title: string;
  snippet: string;
  metadata: Record<string, unknown>;
  timestamp: number;
  dateString?: string;
  phoenixScore: number; // 0-100
  relevanceReason: string;
  engagementPrediction?: {
    view: number;
    click: number;
    save: number;
    share: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SIGNIFICANCE MAPPING RULES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Brief Feature → Event Significance mapping
 *
 * Priority 8-10: major
 * Priority 5-7: moderate
 * Priority 1-4: minor
 */
export function briefPriorityToSignificance(priority: number | undefined): EventSignificance {
  if (!priority) return "minor";
  if (priority >= 8) return "major";
  if (priority >= 5) return "moderate";
  return "minor";
}

/**
 * Funding Amount → Event Significance mapping
 *
 * >$100M: plot_twist (major milestone)
 * $50M-$100M: major
 * $10M-$50M: moderate
 * <$10M: minor
 */
export function fundingAmountToSignificance(amountUsd: number | undefined): EventSignificance {
  if (!amountUsd) return "moderate"; // Unknown amount defaults to moderate
  if (amountUsd >= 100_000_000) return "plot_twist";
  if (amountUsd >= 50_000_000) return "major";
  if (amountUsd >= 10_000_000) return "moderate";
  return "minor";
}

/**
 * Phoenix Score → Event Significance mapping
 *
 * Score > 80: moderate (high relevance, enriches context)
 * Score > 60: minor
 * Score <= 60: skip (use shouldCreateEvent to filter)
 */
export function phoenixScoreToSignificance(score: number): EventSignificance {
  if (score > 80) return "moderate";
  return "minor";
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get current ISO week number.
 * Format: "2026-W04"
 */
export function getCurrentWeekNumber(): string {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000);
  const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${weekNumber.toString().padStart(2, "0")}`;
}

/**
 * Get week number for a specific timestamp.
 */
export function getWeekNumberForDate(timestamp: number): string {
  const date = new Date(timestamp);
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - startOfYear.getTime()) / 86400000);
  const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);
  return `${date.getFullYear()}-W${weekNumber.toString().padStart(2, "0")}`;
}

/**
 * Parse funding amount string to USD number.
 * Examples: "$15M" → 15000000, "$1.5B" → 1500000000
 */
export function parseFundingAmount(amountRaw: string): number | undefined {
  const match = amountRaw.match(/\$?([\d.]+)\s*(M|B|K)?/i);
  if (!match) return undefined;

  const value = parseFloat(match[1]);
  const multiplier = match[2]?.toUpperCase();

  if (multiplier === "B") return value * 1_000_000_000;
  if (multiplier === "M") return value * 1_000_000;
  if (multiplier === "K") return value * 1_000;
  return value;
}

/**
 * Generate stable hash for entity key normalization.
 * Uses FNV-1a 32-bit hash.
 */
export function fnv1a32Hex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Generate stable event ID.
 */
export function generateEventId(headline: string, occurredAt: number): string {
  return `ne_${fnv1a32Hex(`${headline}:${occurredAt}`)}`;
}

/**
 * Generate stable temporal fact ID.
 */
export function generateTemporalFactId(subject: string, predicate: string, object: string): string {
  return `tf_${fnv1a32Hex(`${subject}:${predicate}:${object}`)}`;
}

/**
 * Normalize entity name to canonical key format.
 * Examples:
 *   "OpenAI" → "company:OpenAI"
 *   "Sam Altman" → "person:Sam_Altman"
 */
export function normalizeEntityKey(name: string, type: "company" | "person" | "topic"): string {
  const normalized = name
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  return `${type}:${normalized}`;
}
