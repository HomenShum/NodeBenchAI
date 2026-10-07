/**
 * Model Resolver Exports
 *
 * Central hub for all LLM model resolution in NodeBench.
 * Import from here, not from modelResolver.ts directly.
 *
 * SINGLE SOURCE OF TRUTH:
 * - shared/llm/approvedModels.ts defines the 7 approved models
 * - This module handles resolution and SDK integration
 */

export {
  // Types
  type Provider,
  type ApprovedModel,
  type ModelSpec,
  type ModelCapabilities,
  type ModelResolutionEvent,

  // Constants
  APPROVED_MODELS,
  MODEL_SPECS,
  LEGACY_ALIASES,
  DEFAULT_MODEL,
  FALLBACK_MODEL,
  MODEL_PRIORITY_ORDER,
  NODEBENCH_ADVISOR_MODEL,
  NODEBENCH_EXECUTOR_MODELS,
  NODEBENCH_BACKGROUND_MODELS,

  // Core resolver functions
  getLanguageModel,
  getLanguageModelOrThrow,
  getLanguageModelSafe,
  resolveModelAlias,
  getModelSpec,
  getProviderForModel,

  // Capability checking
  modelSupportsCapability,
  validateModelCapabilities,
  getModelsWithCapabilities,

  // Normalization
  normalizeModelInput,
  normalizeNodeBenchRuntimeModel,
  isApprovedModel,

  // Free model helpers
  isFreeModel,
  getFreeModels,
} from "./modelResolver";

// Healthcheck exports
export {
  PROVIDER_ENV_VARS,
  type ProviderHealthStatus,
  type HealthcheckResult,
  isProviderConfigured,
  getProviderHealth,
  runHealthcheck,
  getAvailableModels,
  isModelAvailable,
  logHealthcheck,
} from "./healthcheck";

// Migration exports
export {
  type MigrationResult,
} from "./migration";
