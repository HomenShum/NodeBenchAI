/**
 * Narrative Feature - Main Export
 *
 * Deep Research Agentic Narrative Engine (DRANE) frontend components.
 *
 * @module features/narrative
 */

// Components
export {
  NarrativeRoadmap,
  ThreadLane,
  EventMarker,
  SentimentBar,
  CorrelationLine,
  CorrelationLegend,
  CorrelationTooltip,
} from "./components/NarrativeRoadmap";
export { NarrativeCard } from "./components/NarrativeCard";
export { HypothesisScorecard } from "./components/HypothesisScorecard";
export { SignalMetricsDashboard } from "./components/SignalMetricsDashboard";

// NarrativeFeed - Social Substrate UI
export {
  NarrativeFeed,
  PostCard,
  ReplyThread,
  EvidenceDrawer,
  type PostData,
  type ReplyData,
  type EvidenceArtifact,
} from "./components/NarrativeFeed";

// Hooks
export {
  useNarrativeThreads,
  useNarrativeThread,
  useNarrativeEvents,
  useTimelineEvents,
  generateWeekColumns,
  useCorrelations,
  useTemporalFacts,
  useHypotheses,
  useHypothesis,
  useHypothesisScorecard,
  useSignalMetrics,
  useSignalMetricsByDomain,
  useThreadSignalSummary,
} from "./hooks";

// Types
export type {
  NarrativeThread,
  NarrativeEvent,
  NarrativeRoadmapProps,
  WeekColumn,
  ThreadPhase,
  EventSignificance,
  SentimentLevel,
  SentimentDataPoint,
  ThreadQuality,
  ClaimSetItem,
  ClaimKind,
  SpeculativeRisk,
  EntailmentVerdict,
} from "./types";

export {
  PHASE_COLORS,
  SIGNIFICANCE_COLORS,
  SENTIMENT_COLORS,
} from "./types";
