/**
 * Home daily brief library — barrel export.
 *
 * Phase 1 data layer:
 *   - briefTypes: canonical type definitions
 *   - evidenceScoring: deterministic confidence derivation
 *   - positionAnnotation: entity key matching for "You:" annotations
 */

export {
  deriveConfidence,
  countPassingChecks,
  computeEvidenceChecklist,
  significanceRank,
  CONFIDENCE_COLORS,
} from "./evidenceScoring";

export {
  extractEntityKeys,
  findUserPosition,
} from "./positionAnnotation";

export type {
  // Core types
  AgentDigestOutput,
  HomeBriefData,
  BlufItem,

  // Evidence
  EvidenceChecklist,
  ConfidenceLevel,

  // Signals
  BriefSignal,
  SignalSource,
  SignalReflection,

  // Actions
  BriefAction,
  ActionPersona,
  ActionPriority,
  ActionStatus,

  // Entities
  EntitySpotlight,
  MetricDelta,
  UserEntityPosition,
  PositionAnnotation,

  // Reports
  MiniReportCard,
  ReportStatus,

  // Competing explanations
  CompetingExplanation,
  EvidenceLevel,

  // Other
  NarrativeFraming,
  FactCheckFinding,
  FactCheckStatus,
  CatalystEvent,
} from "./briefTypes";
