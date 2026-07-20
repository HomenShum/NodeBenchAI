// convex/lib/featureFlags.ts
// Feature flags for GAM rollout

/**
 * GAM Feature Flags
 * 
 * Rollout phases:
 * - Phase 0: Shadow mode (logging only)
 * - Phase 1: Query enabled (read-only)
 * - Phase 2: Write enabled (controlled)
 * - Phase 3: Full (memory-first protocol)
 */
export const MEMORY_FLAGS = {
  // ═══════════════════════════════════════════════════════════════════
  // PHASE 0: Shadow Mode
  // ═══════════════════════════════════════════════════════════════════
  /** Log memory operations without executing */
  ENABLE_MEMORY_LOGGING: true,

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 1: Read-Only (ENABLED for testing)
  // ═══════════════════════════════════════════════════════════════════
  /** Allow queryMemory to return results */
  ENABLE_MEMORY_QUERY: true,  // ✓ Enabled
  
  /** Show memory status hints in UI */
  ENABLE_MEMORY_UI_HINTS: true,  // ✓ Enabled

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2: Controlled Writes (ENABLED for testing)
  // ═══════════════════════════════════════════════════════════════════
  /** Allow writing to memory (updateMemoryFromReview, mergeFactsIntoMemory) */
  ENABLE_MEMORY_WRITE: true,  // ✓ Enabled
  
  /** Allow scheduling research jobs */
  ENABLE_RESEARCH_JOBS: true,  // ✓ Enabled

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 3: Full GAM
  // ═══════════════════════════════════════════════════════════════════
  /** Enforce memory-first protocol in agents */
  ENABLE_MEMORY_FIRST_PROTOCOL: false,
  
  /** Allow deep memory features (narratives, heuristics) */
  ENABLE_DEEP_MEMORY: false,

  // ═══════════════════════════════════════════════════════════════════
  // ROLLOUT CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════
  /** Percentage of users with GAM enabled (0-100) */
  MEMORY_ROLLOUT_PERCENT: 0,
  
  /** User IDs always in rollout (for testing) */
  MEMORY_USERS_ALLOWLIST: [] as string[],
};

export type MemoryFlagKey = keyof typeof MEMORY_FLAGS;

// ═══════════════════════════════════════════════════════════════════════════
// FUSION SEARCH FEATURE FLAGS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fusion Search Feature Flags
 *
 * Kill switches and feature gates for the multi-source search fusion system.
 *
 * Environment variable overrides:
 * - ENABLE_FUSION_SEARCH: Master kill switch (default: true)
 * - ENABLE_EMBEDDING_DEDUP: Embedding-based deduplication (default: false)
 * - SEARCH_JUDGE_MODEL: Override judge model for benchmarks
 */
export const FUSION_SEARCH_FLAGS = {
  /**
   * Master kill switch for fusion search.
   * When false, fusionSearch and quickSearch will throw an error.
   * Set via ENABLE_FUSION_SEARCH environment variable.
   */
  ENABLE_FUSION_SEARCH: true,

  /**
   * Enable embedding-based deduplication (expensive, high quality).
   * Set via ENABLE_EMBEDDING_DEDUP environment variable.
   */
  ENABLE_EMBEDDING_DEDUP: false,

  /**
   * Enable LLM reranking for comprehensive mode.
   * Can be disabled to reduce costs during high load.
   */
  ENABLE_LLM_RERANKING: true,

  /**
   * Enable query expansion for financial/research queries.
   * Can be disabled to reduce latency.
   */
  ENABLE_QUERY_EXPANSION: true,

  /**
   * Maximum results to pass to reranker (cost control).
   */
  RERANK_TOP_K: 20,
};

export type FusionSearchFlagKey = keyof typeof FUSION_SEARCH_FLAGS;

// ═══════════════════════════════════════════════════════════════════════════
// UI FEATURE FLAGS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * UI Feature Flags
 *
 * Feature gates for experimental UI components.
 */
export const UI_FLAGS = {
  /**
   * Enable VizArtifact rendering in StickyDashboard.
   * When true, agent-emitted Vega-Lite specs will be rendered via SafeVegaChart.
   * Requires sandbox validation (data.url rejection) to be in place.
   */
  ENABLE_VIZ_ARTIFACT: true,

  /**
   * Enable the control-plane demo affordances on the landing page.
   * This gates hero-level demo assets without hiding the core product framing.
   */
  CONTROL_PLANE_DEMO: true,
};

export type UIFlagKey = keyof typeof UI_FLAGS;

/**
 * Check if a UI feature is enabled.
 *
 * @param flag - Flag key to check
 * @returns Flag value
 */
export function isUIFlagEnabled(flag: UIFlagKey): boolean {
  return UI_FLAGS[flag];
}

export const PRODUCT_RUNTIME_FLAGS = {
  strict_resolution_gate_v1: true,
  claim_ledger_v1: true,
  truth_compiler_v1: true,
  action_compiler_v1: true,
  artifact_save_gate_v1: true,
  model_route_strict_v1: true,
} as const;

export type ProductRuntimeFlagKey = keyof typeof PRODUCT_RUNTIME_FLAGS;

function readBooleanEnv(name: string): boolean | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const value = process.env[name];
  if (value === undefined) return undefined;
  return value === "true" || value === "1";
}

export function isProductRuntimeFlagEnabled(
  flag: ProductRuntimeFlagKey,
): boolean {
  const envName = `NODEBENCH_${flag.toUpperCase()}`;
  const override = readBooleanEnv(envName);
  if (typeof override === "boolean") return override;
  return PRODUCT_RUNTIME_FLAGS[flag];
}

/**
 * Check if fusion search is enabled.
 * Reads from environment variable ENABLE_FUSION_SEARCH if available.
 *
 * @returns true if fusion search is enabled
 */
export function isFusionSearchEnabled(): boolean {
  // Check environment variable override (server-side only)
  if (typeof process !== "undefined" && process.env?.ENABLE_FUSION_SEARCH !== undefined) {
    return process.env.ENABLE_FUSION_SEARCH !== "false" && process.env.ENABLE_FUSION_SEARCH !== "0";
  }
  return FUSION_SEARCH_FLAGS.ENABLE_FUSION_SEARCH;
}

/**
 * Check if embedding deduplication is enabled.
 * Reads from environment variable ENABLE_EMBEDDING_DEDUP if available.
 *
 * @returns true if embedding dedup is enabled
 */
export function isEmbeddingDedupEnabled(): boolean {
  if (typeof process !== "undefined" && process.env?.ENABLE_EMBEDDING_DEDUP !== undefined) {
    return process.env.ENABLE_EMBEDDING_DEDUP === "true" || process.env.ENABLE_EMBEDDING_DEDUP === "1";
  }
  return FUSION_SEARCH_FLAGS.ENABLE_EMBEDDING_DEDUP;
}

/**
 * Get a fusion search flag value.
 *
 * @param flag - Flag key to check
 * @returns Flag value
 */
export function getFusionSearchFlag<K extends FusionSearchFlagKey>(
  flag: K
): typeof FUSION_SEARCH_FLAGS[K] {
  return FUSION_SEARCH_FLAGS[flag];
}

/**
 * Simple hash function for consistent user bucketing.
 */
function simpleHash(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 100;
}

/**
 * Check if a memory feature is enabled for a user.
 * 
 * @param userId - User ID to check
 * @param flag - Feature flag to check
 * @returns true if the feature is enabled for this user
 */
export function isMemoryEnabled(
  userId: string | null | undefined,
  flag: MemoryFlagKey
): boolean {
  // No user = no features
  if (!userId) return false;
  
  // Allowlist always gets features
  if (MEMORY_FLAGS.MEMORY_USERS_ALLOWLIST.includes(userId)) {
    return MEMORY_FLAGS[flag] as boolean;
  }
  
  // Check rollout percentage
  const userBucket = simpleHash(userId);
  const inRollout = userBucket < MEMORY_FLAGS.MEMORY_ROLLOUT_PERCENT;
  
  if (!inRollout) return false;
  
  // User is in rollout, check specific flag
  return MEMORY_FLAGS[flag] as boolean;
}

/**
 * Check multiple flags at once.
 */
export function areMemoryFlagsEnabled(
  userId: string | null | undefined,
  flags: MemoryFlagKey[]
): boolean {
  return flags.every(flag => isMemoryEnabled(userId, flag));
}

/**
 * Get current rollout status for debugging.
 */
export function getMemoryRolloutStatus(userId: string | null | undefined): {
  userId: string | null;
  inAllowlist: boolean;
  userBucket: number;
  inRolloutPercent: boolean;
  flagStatus: Record<string, boolean>;
} {
  const userBucket = userId ? simpleHash(userId) : -1;
  const inAllowlist = userId ? MEMORY_FLAGS.MEMORY_USERS_ALLOWLIST.includes(userId) : false;
  const inRolloutPercent = userBucket >= 0 && userBucket < MEMORY_FLAGS.MEMORY_ROLLOUT_PERCENT;
  
  const flagStatus: Record<string, boolean> = {};
  for (const key of Object.keys(MEMORY_FLAGS)) {
    if (key !== "MEMORY_ROLLOUT_PERCENT" && key !== "MEMORY_USERS_ALLOWLIST") {
      flagStatus[key] = isMemoryEnabled(userId, key as MemoryFlagKey);
    }
  }
  
  return {
    userId: userId ?? null,
    inAllowlist,
    userBucket,
    inRolloutPercent,
    flagStatus,
  };
}

/**
 * Enable all flags for testing.
 * WARNING: Only use in tests!
 */
export function enableAllFlagsForTesting(): void {
  MEMORY_FLAGS.ENABLE_MEMORY_LOGGING = true;
  MEMORY_FLAGS.ENABLE_MEMORY_QUERY = true;
  MEMORY_FLAGS.ENABLE_MEMORY_UI_HINTS = true;
  MEMORY_FLAGS.ENABLE_MEMORY_WRITE = true;
  MEMORY_FLAGS.ENABLE_RESEARCH_JOBS = true;
  MEMORY_FLAGS.ENABLE_MEMORY_FIRST_PROTOCOL = true;
  MEMORY_FLAGS.ENABLE_DEEP_MEMORY = true;
  MEMORY_FLAGS.MEMORY_ROLLOUT_PERCENT = 100;
}
