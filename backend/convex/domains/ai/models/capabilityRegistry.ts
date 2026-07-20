/**
 * Model Capability Registry — B-PR2 of the Autonomous Continuation System
 *
 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116)
 *
 * Declarative map from OpenRouter / native model IDs to their capability
 * tags. Consumed by the chain resolver (B-PR3) and the model router's
 * fallback logic (B-PR4) to answer:
 *
 *   "The user asked for vision + reasoning. The cheapest free model in
 *    that tier just returned 429. What is the next cheapest model that
 *    still supports vision AND reasoning AND stays at or above the
 *    tier floor the user pinned?"
 *
 * Scope discipline for this PR:
 *   - Pure data + tiny helper functions. No Convex functions, no I/O.
 *   - Entries mirror the `TIER_MODELS` and `MODEL_PRICING` tables in
 *     `convex/domains/ai/models/modelRouter.ts`. If a model is added to
 *     `modelRouter.ts` it should also be added here. The regression
 *     test (coming in a follow-up) will enforce the bidirectional
 *     coverage.
 *   - We intentionally do NOT re-export pricing from here — pricing
 *     lives in `modelRouter.ts` and is the source of truth.
 *
 * HONEST_STATUS: `getCapabilities(unknownId)` returns `null`, not a
 * fake "supports everything" placeholder. The chain resolver (B-PR3)
 * surfaces unknown models as `unknown_model_in_registry` so a human
 * can audit rather than silently routing them.
 */

// ────────────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────────────

/** Quality / cost tier that the chain resolver uses as a floor. */
export type ModelTier = "free" | "cheap" | "standard" | "premium";

/**
 * Provider identity. `openrouter` goes through our existing OpenRouter
 * gateway and inherits `provider.allow_fallbacks=true` from B-PR1.
 * `native` hits Anthropic/OpenAI/Google directly and does NOT benefit
 * from OpenRouter hosting-provider failover.
 */
export type ModelProvider = "openrouter" | "native";

/**
 * Capability tags a model either supports or does not. Boolean
 * rather than free-form strings so we get compile-time guarantees
 * and cheap set-intersection at lookup time.
 */
export interface ModelCapabilities {
  readonly modelId: string;
  readonly tier: ModelTier;
  readonly provider: ModelProvider;
  /** Native multimodal image/vision input. */
  readonly supportsVision: boolean;
  /** Function / tool calling. */
  readonly supportsTools: boolean;
  /** Chain-of-thought / reasoning mode (e.g. o-series, Claude extended). */
  readonly supportsReasoning: boolean;
  /** ≥ 128k token context window. */
  readonly supportsLongContext: boolean;
  /** Native streaming token deltas. */
  readonly supportsStreaming: boolean;
  /**
   * Relative throughput ranking inside the same tier. Higher is faster.
   * Used as a secondary sort when the chain resolver has multiple equal
   * matches. Range: 0 (slow) → 10 (fast).
   */
  readonly throughputRank: number;
  /**
   * Free-form notes for human auditors. Not used in routing logic.
   * Keep terse — short phrases, no paragraphs.
   */
  readonly notes?: string;
}

/**
 * Requirement set the chain resolver uses as the selection filter.
 * A model matches when its capability flags are a superset of the
 * requested flags (i.e. every `true` in the request is also `true`
 * in the model).
 */
export interface CapabilityRequirement {
  supportsVision?: boolean;
  supportsTools?: boolean;
  supportsReasoning?: boolean;
  supportsLongContext?: boolean;
  supportsStreaming?: boolean;
}

// ────────────────────────────────────────────────────────────────────
// REGISTRY
// ────────────────────────────────────────────────────────────────────

/**
 * Single source of truth for model capabilities.
 *
 * Entry shape intentionally verbose so a newcomer can scan this file
 * once and understand every model the system will route to. Tests
 * should assert that every id in `TIER_MODELS` has a registry entry.
 */
export const CAPABILITY_REGISTRY: Readonly<Record<string, ModelCapabilities>> =
  Object.freeze({
    // ── Free tier ──────────────────────────────────────────────────
    "qwen3-coder-free": {
      modelId: "qwen3-coder-free",
      tier: "free",
      provider: "openrouter",
      supportsVision: false,
      supportsTools: true,
      supportsReasoning: true,
      supportsLongContext: true,
      supportsStreaming: true,
      throughputRank: 6,
      notes: "Coding-biased free model; strong tool use",
    },
    "step-3.5-flash-free": {
      modelId: "step-3.5-flash-free",
      tier: "free",
      provider: "openrouter",
      supportsVision: false,
      supportsTools: true,
      supportsReasoning: false,
      supportsLongContext: false,
      supportsStreaming: true,
      throughputRank: 8,
      notes: "Fast generalist free model",
    },
    "openai-gpt-oss-120b-free": {
      modelId: "openai-gpt-oss-120b-free",
      tier: "free",
      provider: "openrouter",
      supportsVision: false,
      supportsTools: true,
      supportsReasoning: true,
      supportsLongContext: true,
      supportsStreaming: true,
      throughputRank: 5,
      notes: "Large open-weight free model",
    },
    "arcee-trinity-large-free": {
      modelId: "arcee-trinity-large-free",
      tier: "free",
      provider: "openrouter",
      supportsVision: false,
      supportsTools: false,
      supportsReasoning: false,
      supportsLongContext: false,
      supportsStreaming: true,
      throughputRank: 5,
      notes: "General chat free model; limited tool support",
    },
    "nemotron-3-nano-30b-free": {
      modelId: "nemotron-3-nano-30b-free",
      tier: "free",
      provider: "openrouter",
      supportsVision: false,
      supportsTools: true,
      supportsReasoning: false,
      supportsLongContext: false,
      supportsStreaming: true,
      throughputRank: 8,
      notes: "Small fast free model",
    },
    "llama-3.3-70b-free": {
      modelId: "llama-3.3-70b-free",
      tier: "free",
      provider: "openrouter",
      supportsVision: false,
      supportsTools: true,
      supportsReasoning: false,
      supportsLongContext: true,
      supportsStreaming: true,
      throughputRank: 6,
      notes: "128k context free model",
    },

    // ── Cheap tier ─────────────────────────────────────────────────
    "glm-4.7-flash": {
      modelId: "glm-4.7-flash",
      tier: "cheap",
      provider: "openrouter",
      supportsVision: true,
      supportsTools: true,
      supportsReasoning: false,
      supportsLongContext: true,
      supportsStreaming: true,
      throughputRank: 9,
      notes: "Cheapest vision-capable tier; $0.07/M",
    },
    "gemini-3-flash-preview": {
      modelId: "gemini-3-flash-preview",
      tier: "cheap",
      provider: "native",
      supportsVision: true,
      supportsTools: true,
      supportsReasoning: false,
      supportsLongContext: true,
      supportsStreaming: true,
      throughputRank: 9,
    },
    "claude-haiku-4.5": {
      modelId: "claude-haiku-4.5",
      tier: "cheap",
      provider: "native",
      supportsVision: true,
      supportsTools: true,
      supportsReasoning: false,
      supportsLongContext: true,
      supportsStreaming: true,
      throughputRank: 8,
    },
    "gpt-5.4-nano": {
      modelId: "gpt-5.4-nano",
      tier: "cheap",
      provider: "native",
      supportsVision: true,
      supportsTools: true,
      supportsReasoning: false,
      supportsLongContext: true,
      supportsStreaming: true,
      throughputRank: 9,
    },

    // ── Standard tier ──────────────────────────────────────────────
    "kimi-k2.6": {
      modelId: "kimi-k2.6",
      tier: "standard",
      provider: "openrouter",
      supportsVision: false,
      supportsTools: true,
      supportsReasoning: true,
      supportsLongContext: true,
      supportsStreaming: true,
      throughputRank: 6,
      notes: "Long-context reasoning model",
    },
    "gpt-5.4-mini": {
      modelId: "gpt-5.4-mini",
      tier: "standard",
      provider: "native",
      supportsVision: true,
      supportsTools: true,
      supportsReasoning: true,
      supportsLongContext: true,
      supportsStreaming: true,
      throughputRank: 7,
    },

    // ── Premium tier ───────────────────────────────────────────────
    "claude-sonnet-4.6": {
      modelId: "claude-sonnet-4.6",
      tier: "premium",
      provider: "native",
      supportsVision: true,
      supportsTools: true,
      supportsReasoning: true,
      supportsLongContext: true,
      supportsStreaming: true,
      throughputRank: 6,
    },
    "claude-opus-4.7": {
      modelId: "claude-opus-4.7",
      tier: "premium",
      provider: "native",
      supportsVision: true,
      supportsTools: true,
      supportsReasoning: true,
      supportsLongContext: true,
      supportsStreaming: true,
      throughputRank: 4,
      notes: "Deepest reasoning; slower",
    },
    "gpt-5.4": {
      modelId: "gpt-5.4",
      tier: "premium",
      provider: "native",
      supportsVision: true,
      supportsTools: true,
      supportsReasoning: true,
      supportsLongContext: true,
      supportsStreaming: true,
      throughputRank: 6,
    },
    "gemini-3.1-pro-preview": {
      modelId: "gemini-3.1-pro-preview",
      tier: "premium",
      provider: "native",
      supportsVision: true,
      supportsTools: true,
      supportsReasoning: true,
      supportsLongContext: true,
      supportsStreaming: true,
      throughputRank: 5,
    },
    "gemini-2.5-pro": {
      modelId: "gemini-2.5-pro",
      tier: "premium",
      provider: "native",
      supportsVision: true,
      supportsTools: true,
      supportsReasoning: true,
      supportsLongContext: true,
      supportsStreaming: true,
      throughputRank: 5,
    },
  } satisfies Record<string, ModelCapabilities>);

// ────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────

/** Ordered list of tiers from cheapest to most expensive. */
export const TIER_ORDER: readonly ModelTier[] = Object.freeze([
  "free",
  "cheap",
  "standard",
  "premium",
]);

/**
 * Look up the capability record for a model.
 * Returns `null` (HONEST_STATUS) when the model is not in the registry
 * so callers can surface `unknown_model_in_registry` instead of silently
 * routing. Do NOT add a fallback "allow everything" entry.
 */
export function getCapabilities(
  modelId: string,
): ModelCapabilities | null {
  return CAPABILITY_REGISTRY[modelId] ?? null;
}

/**
 * True when the capability record satisfies every requirement that is
 * set to `true` in `req`. Requirements set to `false` or `undefined`
 * impose no constraint (so requesting nothing matches every model).
 */
export function meetsRequirements(
  caps: ModelCapabilities,
  req: CapabilityRequirement,
): boolean {
  if (req.supportsVision && !caps.supportsVision) return false;
  if (req.supportsTools && !caps.supportsTools) return false;
  if (req.supportsReasoning && !caps.supportsReasoning) return false;
  if (req.supportsLongContext && !caps.supportsLongContext) return false;
  if (req.supportsStreaming && !caps.supportsStreaming) return false;
  return true;
}

/**
 * True when `candidate` is at or above `floor` in the tier ladder.
 * `free < cheap < standard < premium`.
 */
export function meetsTierFloor(
  candidate: ModelTier,
  floor: ModelTier,
): boolean {
  return TIER_ORDER.indexOf(candidate) >= TIER_ORDER.indexOf(floor);
}

/**
 * Return every model that meets `req` AND is at or above `tierFloor`.
 * Results sorted by (tier ascending, throughputRank descending) so the
 * chain resolver (B-PR3) can walk the list in preferred order.
 */
export function findMatchingModels(
  req: CapabilityRequirement,
  tierFloor: ModelTier = "free",
): ModelCapabilities[] {
  const out: ModelCapabilities[] = [];
  for (const caps of Object.values(CAPABILITY_REGISTRY)) {
    if (!meetsTierFloor(caps.tier, tierFloor)) continue;
    if (!meetsRequirements(caps, req)) continue;
    out.push(caps);
  }
  out.sort((a, b) => {
    const tierDelta =
      TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier);
    if (tierDelta !== 0) return tierDelta;
    return b.throughputRank - a.throughputRank;
  });
  return out;
}

/** Total number of registered models. Used by health / smoke tests. */
export function getRegistrySize(): number {
  return Object.keys(CAPABILITY_REGISTRY).length;
}
