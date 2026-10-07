/**
 * Barrel export for convex/lib utilities
 *
 * This file re-exports type definitions and pure utility functions only.
 * Convex functions (mutations, actions, queries) must be imported directly
 * from their source files.
 */

// NOTE: Agent optimization utilities contain Convex functions and cannot be re-exported
// Import directly from:
// - "./parallelDelegation" (types only - delegateInParallel is a utility)
// - "./agentCache"
// - "./streamingDelegation"
// - "./predictivePrefetch"

// Artifact type utilities (types only)
export * from "./artifactModels";
export * from "./artifactValidators";
// NOTE: artifactQueries, artifactPersistence, withArtifactPersistence contain Convex functions

// Memory utilities (pure functions only)
export * from "./memoryLimits";
export * from "./memoryQuality";

// Document utilities (types and pure functions)
export * from "./dossierHelpers";
// NOTE: dossierGenerator, actionItemsGenerator may contain Convex functions

// Conversion utilities (pure functions)
export * from "./markdown";
export * from "./markdownToTipTap";

// Other utilities (pure functions only)
export * from "./crypto";
export * from "./entityResolution";
export * from "./factValidation";
export * from "./featureFlags";
// NOTE: mcpTransport contains Convex actions

