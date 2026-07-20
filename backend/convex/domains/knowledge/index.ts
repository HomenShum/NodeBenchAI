/**
 * Knowledge Domain Index
 *
 * Re-exports all public APIs from the knowledge domain.
 * This includes entity contexts, knowledge graphs, and the new Knowledge Product Layer.
 */

// ============================================================================
// Knowledge Product Layer (Phase 1)
// ============================================================================

// Source Registry - Authoritative source curation
export {
  // Mutations
  registerSource,
  bulkRegisterSources,
  togglePinned,
  deactivateSource,
  // Internal mutations
  updateSourceFreshness,
  // Queries
  getSource,
  getRegistryForDomain,
  getPinnedSources,
  getAllActiveSources,
  getSourcesByCategory,
  checkSourceFreshness,
  // Internal queries
  getSourcesDueForRefresh,
  getRegistryStats,
  // Types
  type SourceCategory,
  type ReliabilityTier,
  type RefreshCadence,
  type UsageConstraint,
  type SourceRegistryEntry,
  // Helper functions
  generateRegistryId,
  // Seed data
  INITIAL_SOURCES,
} from "./sourceRegistry";

// Source Diffs - Change detection and tracking
export {
  // Snapshot mutations
  createSnapshot,
  // Internal queries
  getLatestSnapshot,
  // Queries
  getSnapshotsInRange,
  getRecentDiffs,
  getAllRecentDiffs,
  getDiffsBySeverity,
  getDiffsByChangeType,
  getDiffStats,
  getRefreshSummary,
  // Diff mutations
  compareSnapshots,
  recordDiff,
  // Actions
  fetchAndSnapshotSource,
  classifyChangeWithLLM,
  processSourceRefresh,
  refreshSourcesNow,
  // Types
  type ChangeType,
  type Severity,
  type DiffHunk,
  type SourceDiff,
  // Helper functions
  generateContentHash,
  detectContentChange,
  extractSections,
} from "./sourceDiffs";
