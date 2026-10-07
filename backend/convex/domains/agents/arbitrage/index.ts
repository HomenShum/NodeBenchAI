/**
 * Arbitrage Agent Module
 * 
 * Receipts-first research with contradiction detection,
 * source quality ranking, delta tracking, and health checks.
 */

// Agent actions
export {
  research,
  analyzeContradictions,
  rankSources,
  detectDeltas,
  checkHealth,
} from "./agent";

// Configuration
export {
  ARBITRAGE_AGENT_CONFIG,
  SOURCE_TYPES,
  SOURCE_QUALITY_SCORES,
  QUALITY_TIERS,
  CONTRADICTION_SEVERITY,
  DELTA_TYPES,
  getArbitrageSystemPrompt,
  type SourceType,
  type ContradictionInput,
  type SourceQualityInput,
  type DeltaDetectionInput,
  type SourceHealthInput,
} from "./config";

// Tools
export {
  executeContradictionDetection,
  executeSourceQualityRanking,
  executeDeltaDetection,
  executeSourceHealthCheck,
  contradictionDetectionToolDefinition,
  sourceQualityRankingToolDefinition,
  deltaDetectionToolDefinition,
  sourceHealthCheckToolDefinition,
  type Contradiction,
  type ContradictionResult,
  type RankedSource,
  type SourceQualityResult,
  type Delta,
  type DeltaResult,
  type SourceHealthStatus,
  type SourceHealthResult,
} from "./tools";
