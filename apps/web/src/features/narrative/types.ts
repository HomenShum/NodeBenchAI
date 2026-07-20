/**
 * Narrative Feature Types
 *
 * Shared types for the narrative visualization components.
 *
 * @module features/narrative/types
 */

import type { Id } from "../../../convex/_generated/dataModel";

/**
 * Thread phase for narrative arc progression
 */
export type ThreadPhase =
  | "emerging"
  | "escalating"
  | "climax"
  | "resolution"
  | "dormant";

/**
 * Event significance levels
 */
export type EventSignificance = "minor" | "moderate" | "major" | "plot_twist";

/**
 * Sentiment levels for weekly tracking
 */
export type SentimentLevel =
  | "very_negative"
  | "negative"
  | "neutral"
  | "positive"
  | "very_positive";

/**
 * Thread quality flags (GAM pattern)
 */
export interface ThreadQuality {
  hasMultipleSources: boolean;
  hasRecentActivity: boolean;
  hasVerifiedClaims: boolean;
  hasCounterNarrative: boolean;
}

/**
 * Narrative thread for display
 */
export interface NarrativeThread {
  _id: Id<"narrativeThreads">;
  threadId: string;
  name: string;
  slug: string;
  entityKeys: string[];
  topicTags: string[];
  thesis: string;
  counterThesis?: string;
  currentPhase: ThreadPhase;
  firstEventAt: number;
  latestEventAt: number;
  eventCount: number;
  plotTwistCount: number;
  quality: ThreadQuality;
  isPublic: boolean;
}

/**
 * Narrative event for display
 */
/**
 * Speculative risk level for a claim (Phase 7)
 */
export type SpeculativeRisk = "grounded" | "mixed" | "speculative";

/**
 * Entailment verdict for a claim (Phase 7)
 */
export type EntailmentVerdict = "entailed" | "neutral" | "contradicted";

/**
 * Claim kind classification
 */
export type ClaimKind = "verifiable" | "interpretation" | "prediction";

/**
 * Individual claim within a claimSet (Phase 7)
 */
export interface ClaimSetItem {
  claim: string;
  confidence: number;
  evidenceArtifactIds: string[];
  kind?: ClaimKind;
  uncertainty?: number;
  speculativeRisk?: SpeculativeRisk;
  entailmentVerdict?: EntailmentVerdict;
  hypothesisId?: string;
}

export interface NarrativeEvent {
  _id: Id<"narrativeEvents">;
  eventId: string;
  threadId: Id<"narrativeThreads">;
  headline: string;
  summary: string;
  significance: EventSignificance;
  occurredAt: number;
  discoveredAt: number;
  weekNumber: string;
  sourceUrls: string[];
  sourceNames: string[];
  citationIds: string[];
  isVerified: boolean;
  hasContradictions: boolean;
  // Phase 7: Claim-level evidence grading
  claimSet?: ClaimSetItem[];
}

/**
 * Week column for timeline display
 */
export interface WeekColumn {
  weekNumber: string;
  label: string;
  startDate: Date;
  endDate: Date;
  isCurrent: boolean;
}

/**
 * Sentiment data point for a thread/week
 */
export interface SentimentDataPoint {
  weekNumber: string;
  sentiment: SentimentLevel;
  score: number;
  delta: number;
}

/**
 * Props for NarrativeRoadmap component
 */
export interface NarrativeRoadmapProps {
  /** User ID for filtering threads */
  userId?: string;
  /** Entity keys to filter by */
  entityKeys?: string[];
  /** Number of weeks to display */
  weekCount?: number;
  /** Callback when thread is clicked */
  onThreadClick?: (thread: NarrativeThread) => void;
  /** Callback when event is clicked */
  onEventClick?: (event: NarrativeEvent) => void;
  /** Additional CSS class */
  className?: string;
}

/**
 * Phase colors for UI
 */
export const PHASE_COLORS: Record<ThreadPhase, { bg: string; text: string; border: string }> = {
  emerging: {
    bg: "bg-sky-50",
    text: "text-sky-700",
    border: "border-sky-200",
  },
  escalating: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
  },
  climax: {
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
  },
  resolution: {
    bg: "bg-indigo-50",
    text: "text-content-secondary",
    border: "border-indigo-200",
  },
  dormant: {
    bg: "bg-surface-secondary",
    text: "text-content-secondary",
    border: "border-edge",
  },
};

/**
 * Significance colors for events
 */
export const SIGNIFICANCE_COLORS: Record<EventSignificance, { bg: string; ring: string }> = {
  minor: {
    bg: "bg-gray-300",
    ring: "ring-gray-200",
  },
  moderate: {
    bg: "bg-blue-400",
    ring: "ring-blue-200",
  },
  major: {
    bg: "bg-purple-500",
    ring: "ring-purple-200",
  },
  plot_twist: {
    bg: "bg-red-500",
    ring: "ring-red-300",
  },
};

/**
 * Sentiment colors for visualization
 */
export const SENTIMENT_COLORS: Record<SentimentLevel, string> = {
  very_negative: "bg-red-500",
  negative: "bg-orange-400",
  neutral: "bg-gray-300",
  positive: "bg-indigo-400",
  very_positive: "bg-indigo-600",
};
