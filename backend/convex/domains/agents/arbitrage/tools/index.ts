/**
 * Arbitrage Tools Index
 */

export {
  executeContradictionDetection,
  contradictionDetectionToolDefinition,
  type Contradiction,
  type ContradictionResult,
} from "./contradictionDetection";

export {
  executeSourceQualityRanking,
  sourceQualityRankingToolDefinition,
  type RankedSource,
  type SourceQualityResult,
} from "./sourceQualityRanking";

export {
  executeDeltaDetection,
  deltaDetectionToolDefinition,
  type Delta,
  type DeltaResult,
} from "./deltaDetection";

export {
  executeSourceHealthCheck,
  sourceHealthCheckToolDefinition,
  type SourceHealthStatus,
  type SourceHealthResult,
} from "./sourceHealthCheck";
