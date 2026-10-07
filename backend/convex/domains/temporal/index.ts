/**
 * Temporal Domain — Barrel Exports
 *
 * The temporal substrate: time-aware database layer that tracks
 * momentum, regimes, causality, zero-draft artifacts, and proof packs.
 */

// Schema (table definitions)
export {
  timeSeriesObservations,
  timeSeriesSignals,
  causalChains,
  zeroDraftArtifacts,
  proofPacks,
  specDocs,
} from "./schema";

// Re-export types
export type {
  IngestionBatch,
  SignalDetectionResult,
} from "./ingestion";

// Re-export statistical functions for use by other domains
export { forecastExponentialSmoothing } from "./ingestion";
