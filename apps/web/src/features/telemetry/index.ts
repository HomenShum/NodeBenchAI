/**
 * telemetry feature — Agent trajectory visualization, context inspection, eval scorecard,
 * judge heatmap, cost waterfall, failure clusters, and live data hooks.
 *
 * Phase 1-6 implementation: kill demo data, dual-surface trace, self-improving flywheel visuals.
 */

export { TrajectoryPanel } from "./TrajectoryPanel";
export type { TrajectoryPanelProps } from "./TrajectoryPanel";
export { createDemoContextBundle, ContextInspector } from "./ContextInspector";
export type { ContextInspectorProps } from "./ContextInspector";
export { createDemoEvalData, EvalScorecard } from "./EvalScorecard";
export type { EvalScorecardProps } from "./EvalScorecard";
export { ToolCoverageProof } from "./ToolCoverageProof";
export type { ToolCoverageProofProps } from "./ToolCoverageProof";
export { ContextualGraph } from "./ContextualGraph";
export type { ContextualGraphProps } from "./ContextualGraph";

// Phase 1-2: Live data hooks (replace demo factories)
export {
  useLiveEvalScorecard,
  useLiveTraceAggregates,
  useLiveContextBundle,
  traceToTrajectory,
} from "./useLiveTelemetry";
export type {
  LiveEvalState,
  LiveTraceState,
  LiveContextState,
  ToolAggregate,
  ActionEntry,
  ErrorEntry,
} from "./useLiveTelemetry";

// Phase 1: Live data banner (visual proof)
export { LiveDataBanner } from "./LiveDataBanner";
export type { LiveDataBannerProps } from "./LiveDataBanner";

// Phase 3-6: Flywheel visuals
export { JudgeHeatmap, createDemoJudgeHeatmapData } from "./JudgeHeatmap";
export type { JudgeHeatmapData, JudgeHeatmapProps, JudgeCell } from "./JudgeHeatmap";
export { CostWaterfall } from "./CostWaterfall";
export type { CostWaterfallProps } from "./CostWaterfall";
export { FailureClusters, createDemoFailureClusters } from "./FailureClusters";
export type { FailureClustersProps, FailureCluster } from "./FailureClusters";

export type {
  TrajectoryData,
  TrajectoryStep,
  TrajectoryStepStatus,
  ContextBundle,
  PinnedContextView,
  InjectedContextView,
  ArchivalPointerView,
  EvalRunResult,
  EvalScenarioResult,
  EvalScorecardData,
} from "./types";
