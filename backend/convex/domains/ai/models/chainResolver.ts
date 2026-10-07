/**
 * Chain Resolver — B-PR3 of the Autonomous Continuation System
 *
 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116)
 *
 * Produces an ordered failover chain of model IDs for the model router
 * (B-PR4) to walk when the primary model hits 429 / 5xx / timeout.
 *
 * Contract
 * --------
 *   resolveChain({
 *     requirement,      // capability floor (vision, tools, reasoning, …)
 *     tierFloor,        // cheapest tier the user is willing to accept
 *     primaryModelId,   // the model we just tried
 *     avoidModelIds,    // other models we already tried and lost
 *     preferIds,        // pin these to the front when they match
 *   }) → {
 *     chain: string[],               // ordered model IDs, primary first
 *     reason?: "no_registry_entry" | "no_matches_for_requirement",
 *     diagnostics: { … }             // human-readable audit info
 *   }
 *
 * Guarantees
 * ----------
 *   1. Every entry in `chain` is a registered model whose capability
 *      flags are a superset of `requirement` AND whose tier is at or
 *      above `tierFloor`. (Tier-floor enforcement — the reason this
 *      PR exists.)
 *   2. `avoidModelIds` entries are stripped.
 *   3. `preferIds` entries that match are moved to the front in the
 *      order supplied.
 *   4. `primaryModelId` is placed first when it passes the above
 *      filters; otherwise it is skipped and the resolver surfaces
 *      the reason in diagnostics so the caller can log it.
 *   5. Cheapest matching tier comes before more expensive tiers.
 *      Inside a tier, higher `throughputRank` wins.
 *   6. HONEST_STATUS: if no models match, `chain` is `[]` and
 *      `reason` is set. Callers must NOT treat an empty chain as a
 *      fake success.
 *
 * Pure function. No Convex, no I/O. Fully unit-testable. Tests land
 * alongside B-PR4 so the end-to-end failover path gets coverage in
 * the same PR that actually wires it in.
 */

import {
  CAPABILITY_REGISTRY,
  type CapabilityRequirement,
  type ModelCapabilities,
  type ModelTier,
  TIER_ORDER,
  findMatchingModels,
  getCapabilities,
  meetsRequirements,
  meetsTierFloor,
} from "./capabilityRegistry";

// ────────────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────────────

export interface ResolveChainArgs {
  /** Capability floor — every chain member must satisfy these flags. */
  requirement: CapabilityRequirement;
  /**
   * Cheapest tier the user is willing to accept. The resolver refuses
   * to drop below this tier even when cheaper models satisfy the
   * capability floor. Defaults to `"free"` (accept anything).
   */
  tierFloor?: ModelTier;
  /**
   * Model we just tried. When it passes the registry + capability +
   * tier-floor filters it is placed first so a transient 429 that
   * clears on retry doesn't force us onto a different model.
   * Set to `null` / undefined on the very first attempt.
   */
  primaryModelId?: string | null;
  /** Models we already exhausted in this request. Stripped from chain. */
  avoidModelIds?: readonly string[];
  /** Pin these to the front (in supplied order) when they match. */
  preferIds?: readonly string[];
  /** Hard cap on chain length. Defaults to 6. */
  maxChainLength?: number;
}

export interface ChainResolution {
  /** Ordered model IDs. First entry is the model to try first. */
  chain: string[];
  /** Explanation when `chain` is empty. */
  reason?: "no_registry_entry" | "no_matches_for_requirement";
  /** Human-readable audit info. Safe to drop in logs / chat messages. */
  diagnostics: {
    /** Tier floor actually enforced after defaults. */
    enforcedTierFloor: ModelTier;
    /** Primary outcome — useful for "why was primary skipped" logs. */
    primaryOutcome:
      | "not_supplied"
      | "kept"
      | "dropped_not_in_registry"
      | "dropped_requirement_mismatch"
      | "dropped_below_tier_floor"
      | "dropped_in_avoid_list";
    /** preferIds that actually made it into the chain. */
    preferredAccepted: string[];
    /** preferIds that were dropped and why. */
    preferredDropped: Array<{
      modelId: string;
      reason:
        | "not_in_registry"
        | "requirement_mismatch"
        | "below_tier_floor"
        | "in_avoid_list";
    }>;
    /** Candidate pool size before truncation by `maxChainLength`. */
    candidatePoolSize: number;
  };
}

// ────────────────────────────────────────────────────────────────────
// INTERNALS
// ────────────────────────────────────────────────────────────────────

/**
 * Compute why a specific model would be rejected, or `null` if it would
 * be accepted. Used to build detailed diagnostics for primary / preferred.
 */
function classifyModel(
  modelId: string,
  requirement: CapabilityRequirement,
  tierFloor: ModelTier,
  avoidSet: Set<string>,
):
  | null
  | "not_in_registry"
  | "requirement_mismatch"
  | "below_tier_floor"
  | "in_avoid_list" {
  if (avoidSet.has(modelId)) return "in_avoid_list";
  const caps = getCapabilities(modelId);
  if (!caps) return "not_in_registry";
  if (!meetsRequirements(caps, requirement)) return "requirement_mismatch";
  if (!meetsTierFloor(caps.tier, tierFloor)) return "below_tier_floor";
  return null;
}

/** Map the classifier output to the `primaryOutcome` enum shape. */
function primaryOutcomeFromReason(
  reason: ReturnType<typeof classifyModel>,
): ChainResolution["diagnostics"]["primaryOutcome"] {
  if (reason === null) return "kept";
  if (reason === "not_in_registry") return "dropped_not_in_registry";
  if (reason === "requirement_mismatch") return "dropped_requirement_mismatch";
  if (reason === "below_tier_floor") return "dropped_below_tier_floor";
  return "dropped_in_avoid_list";
}

// ────────────────────────────────────────────────────────────────────
// PUBLIC
// ────────────────────────────────────────────────────────────────────

/**
 * Resolve the ordered failover chain for a given requirement.
 * See module doc for contract + guarantees.
 */
export function resolveChain(args: ResolveChainArgs): ChainResolution {
  const enforcedTierFloor: ModelTier = args.tierFloor ?? "free";
  const avoidSet = new Set(args.avoidModelIds ?? []);
  const maxChainLength = Math.max(1, args.maxChainLength ?? 6);

  // ── Primary classification (audit-only; filtering happens in the main pass) ──
  let primaryOutcome: ChainResolution["diagnostics"]["primaryOutcome"] =
    "not_supplied";
  if (args.primaryModelId) {
    primaryOutcome = primaryOutcomeFromReason(
      classifyModel(
        args.primaryModelId,
        args.requirement,
        enforcedTierFloor,
        avoidSet,
      ),
    );
  }

  // ── Classify every `preferIds` entry so the diagnostics surface why ──
  const preferredAccepted: string[] = [];
  const preferredDropped: ChainResolution["diagnostics"]["preferredDropped"] = [];
  const preferredAcceptedCaps: ModelCapabilities[] = [];
  for (const pid of args.preferIds ?? []) {
    const reason = classifyModel(
      pid,
      args.requirement,
      enforcedTierFloor,
      avoidSet,
    );
    if (reason === null) {
      preferredAccepted.push(pid);
      const caps = getCapabilities(pid);
      if (caps) preferredAcceptedCaps.push(caps);
    } else {
      preferredDropped.push({ modelId: pid, reason });
    }
  }

  // ── Build the full candidate pool from the registry ──
  const pool = findMatchingModels(args.requirement, enforcedTierFloor).filter(
    (caps) => !avoidSet.has(caps.modelId),
  );

  if (pool.length === 0) {
    // HONEST_STATUS: surface the empty result rather than synthesize a guess.
    const reason: ChainResolution["reason"] =
      Object.keys(CAPABILITY_REGISTRY).length === 0
        ? "no_registry_entry"
        : "no_matches_for_requirement";
    return {
      chain: [],
      reason,
      diagnostics: {
        enforcedTierFloor,
        primaryOutcome,
        preferredAccepted,
        preferredDropped,
        candidatePoolSize: 0,
      },
    };
  }

  // ── Assemble the ordered chain ──
  // Start with `primaryModelId` if it survived classification, then the
  // preferred list (order-preserving), then the capability-pool order
  // produced by findMatchingModels(). De-dup as we go so the same model
  // never appears twice.
  const seen = new Set<string>();
  const chain: string[] = [];

  const pushIfNew = (id: string) => {
    if (seen.has(id)) return;
    if (chain.length >= maxChainLength) return;
    seen.add(id);
    chain.push(id);
  };

  if (
    args.primaryModelId &&
    primaryOutcome === "kept"
  ) {
    pushIfNew(args.primaryModelId);
  }

  for (const pid of preferredAccepted) {
    pushIfNew(pid);
  }

  for (const caps of pool) {
    pushIfNew(caps.modelId);
  }

  return {
    chain,
    diagnostics: {
      enforcedTierFloor,
      primaryOutcome,
      preferredAccepted,
      preferredDropped,
      candidatePoolSize: pool.length,
    },
  };
}

/**
 * Convenience — walk the chain one step past a failed attempt. Returns
 * the next model to try and the remaining chain. Returns `null` when
 * the chain is exhausted. Use this inside the router's catch block
 * (B-PR4).
 */
export function advanceChain(
  chain: readonly string[],
  failedModelId: string,
): { nextModelId: string; remaining: string[] } | null {
  const idx = chain.indexOf(failedModelId);
  const tail = idx === -1 ? chain.slice() : chain.slice(idx + 1);
  const [next, ...rest] = tail;
  if (!next) return null;
  return { nextModelId: next, remaining: rest };
}

/** Re-export for convenience of B-PR4 callers. */
export { TIER_ORDER };
export type { CapabilityRequirement, ModelCapabilities, ModelTier };
