// convex/globalResearch/index.ts
// Global Research Ledger module exports.
// Re-exports all public functions for cleaner imports.

// ═══════════════════════════════════════════════════════════════════════════
// MODULE OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════
//
// The Global Research Ledger provides:
// 1. URL-deduplicated artifact storage (globalArtifacts)
// 2. Query fingerprinting for cache lookup (globalQueries)
// 3. Append-only mention tracking with compaction (globalArtifactMentions -> globalMentionAgg)
// 4. Single-flight locks to prevent duplicate queries (globalQueryLocks)
// 5. Research run lifecycle and event logging (globalResearchRuns, globalResearchEvents)
//
// Key patterns:
// - entityKey: "" for unscoped queries (never query by_entityKey with empty string)
// - Nonce-owned locks for safe acquire/release
// - Incremental compaction via state singletons
// - Run-owner-only event writes for idempotency
//
// ═══════════════════════════════════════════════════════════════════════════

// Artifacts
export {
  upsertGlobal as upsertGlobalArtifact,
  getByKey as getGlobalArtifactByKey,
  getByCanonicalUrl as getGlobalArtifactByUrl,
  getByKeys as getGlobalArtifactsByKeys,
  getByDomain as getGlobalArtifactsByDomain,
  getRecent as getRecentGlobalArtifacts,
  generateArtifactKey,
  generateContentHash,
  NUM_SHARDS,
} from "./artifacts";

// Queries
export {
  upsertQuery,
  getByKey as getQueryByKey,
  getByEntity as getQueriesByEntity,
  checkQueryExists,
  generateQueryKey,
  normalizeQuery,
  getTTLForQuery,
  FINGERPRINT_VERSION,
  TOOL_VERSIONS,
  DEFAULT_TTLS,
} from "./queries";

// Mentions
export {
  recordMention,
  recordMentionsBatch,
  getMentionsByQuery,
  getMentionsByArtifact,
  getMentionsByEntity,
  getAggByQuery,
  getAggByEntity,
  getTopByDay,
  MENTION_RETENTION_DAYS,
  getDayBucket,
  generateAggKey,
} from "./mentions";

// Locks
export {
  acquireOrWait,
  releaseLock,
  getLockStatus,
  forceReleaseStale,
} from "./locks";

// Runs & Events
export {
  createRun,
  startRun,
  completeRun,
  failRun,
  getByRunId as getRunById,
  getLatestByQuery as getLatestRunByQuery,
  getLatestCompletedByQuery,
  checkCacheStatus,
  getRunHistory,
  getRunsByEntity,
  appendEvent,
  getEventsByRun,
  getEventsSinceSeq,
} from "./runs";

// Compaction
export {
  compactMentions,
  purgeMentions,
  dedupeArtifacts,
  cleanupStaleLocks,
  purgeOldEvents,
} from "./compaction";
