/**
 * Anthropic prompt-caching helpers for the reasoning adapter.
 *
 * Wraps system prompts and tool catalogs in `cache_control: { type: "ephemeral" }`
 * markers when they cross Anthropic's 1024-token cache floor, and produces
 * stable hit/miss stats for the operator dashboard.
 *
 * Pattern: prompt caching (5-minute ephemeral)
 * Prior art:
 *   - Anthropic prompt caching guide (2025)
 *     https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 *   - convex/domains/agents/mcp_tools/models/promptCaching.ts (existing
 *     general-purpose helpers; this file is the adapter-side wiring)
 *
 * See: .claude/rules/agentic_reliability.md (HONEST_SCORES + DETERMINISTIC)
 *
 * Why a new file: the existing `promptCaching.ts` defines opaque shapes but
 * no production call site uses them. The reasoning adapter has two distinct
 * call shapes (single-turn `execute()` and multi-iteration `runWithTools()`).
 * A focused helper avoids forcing that shared module to know about Anthropic
 * SDK types directly, which would couple it to `@anthropic-ai/sdk`.
 */

import type Anthropic from "@anthropic-ai/sdk";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Anthropic cache breakpoint floor (per docs as of 2025-2026).
 * Below this size the API silently ignores the cache_control marker.
 */
export const ANTHROPIC_CACHE_MIN_TOKENS = 1024;

/**
 * Conservative chars-per-token used for the threshold check.  Real BPE is
 * ~3.5–4.5 chars/tok for English; we use 4.0 so we don't flip the marker on
 * borderline prompts that won't actually clear the floor server-side.
 */
const CHARS_PER_TOKEN_ESTIMATE = 4.0;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-call cache statistics — surfaced on `AdapterResult.tokenUsage`.
 *
 * HONEST_SCORES: every field is the literal value reported by Anthropic's
 * API (or 0 when the field is absent).  No fabricated floors.
 */
export interface AnthropicCacheStats {
  /** Whether cache_control markers were attached at request time. */
  cacheControlAttached: boolean;
  /** Tokens written to cache on this request (1.25× normal price). */
  cacheCreationInputTokens: number;
  /** Tokens served from cache on this request (0.10× normal price). */
  cacheReadInputTokens: number;
  /** Total input tokens for the request, per Anthropic. */
  inputTokens: number;
  /** cache_read / input — clamped to [0, 1].  0 when input is 0. */
  cacheHitRate: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers — DETERMINISTIC: same input → same output, no I/O.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conservative token estimate.  Used only to gate whether we attach a
 * cache_control marker; never reported back to the caller as a measurement.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

/**
 * Build a cache-aware Anthropic `system` parameter.
 *
 * - When `systemPrompt` is undefined or below the cache floor, returns the
 *   original string (or undefined) so behavior is byte-identical to the
 *   uncached path.
 * - When the prompt clears the floor, returns the structured-blocks form
 *   with one `cache_control: ephemeral` marker on the (single) system block.
 *
 * The `attached` flag is what the adapter records into telemetry, so we never
 * lie about whether a marker was sent.
 */
export function buildCachedSystem(
  systemPrompt: string | undefined,
): { system: string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> | undefined; attached: boolean } {
  if (!systemPrompt) return { system: undefined, attached: false };
  const tokens = estimateTokens(systemPrompt);
  if (tokens < ANTHROPIC_CACHE_MIN_TOKENS) {
    // Below the floor — cache_control would be silently dropped by the API.
    // Return the plain string so we don't waste request bytes on a no-op.
    return { system: systemPrompt, attached: false };
  }
  return {
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    attached: true,
  };
}

/**
 * Build a cache-aware Anthropic `tools` array.
 *
 * - When `tools` is empty or the serialized catalog is below the cache floor,
 *   returns the input array as-is.
 * - When the catalog clears the floor, attaches `cache_control: ephemeral`
 *   to the LAST tool only.  Anthropic caches the prefix up to and including
 *   any block carrying a marker; tagging the last tool means the entire
 *   catalog is cached.  Tagging earlier tools would cache only a partial
 *   prefix and lose the savings.
 *
 * The input array is not mutated.
 */
export function buildCachedTools<T extends { name: string; description?: string; input_schema: unknown }>(
  tools: T[] | undefined,
): { tools: (T & { cache_control?: { type: "ephemeral" } })[] | undefined; attached: boolean } {
  if (!tools || tools.length === 0) return { tools, attached: false };

  // Estimate over the serialized catalog — schemas dominate the byte count.
  const serialized = JSON.stringify(tools);
  const tokens = estimateTokens(serialized);
  if (tokens < ANTHROPIC_CACHE_MIN_TOKENS) {
    return { tools, attached: false };
  }

  const out = tools.slice() as (T & { cache_control?: { type: "ephemeral" } })[];
  const last = out.length - 1;
  out[last] = { ...out[last], cache_control: { type: "ephemeral" } };
  return { tools: out, attached: true };
}

/**
 * Extract cache stats from an Anthropic message response.
 *
 * Reads the optional `cache_creation_input_tokens` and
 * `cache_read_input_tokens` fields the SDK now exposes on `usage`.  When the
 * caller never attached a marker, `cacheControlAttached` is false and the
 * other fields will be 0 — useful for distinguishing "we didn't try" from
 * "we tried but missed".
 */
export function extractCacheStats(
  usage: Anthropic.Usage | undefined,
  cacheControlAttached: boolean,
): AnthropicCacheStats {
  const inputTokens = usage?.input_tokens ?? 0;
  // SDK types the optional fields as `number | null`; coerce defensively.
  const cacheCreationInputTokens =
    typeof usage?.cache_creation_input_tokens === "number"
      ? usage.cache_creation_input_tokens
      : 0;
  const cacheReadInputTokens =
    typeof usage?.cache_read_input_tokens === "number"
      ? usage.cache_read_input_tokens
      : 0;
  const totalInputAccountedFor =
    inputTokens + cacheCreationInputTokens + cacheReadInputTokens;
  const cacheHitRate =
    totalInputAccountedFor > 0
      ? Math.min(1, Math.max(0, cacheReadInputTokens / totalInputAccountedFor))
      : 0;
  return {
    cacheControlAttached,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    inputTokens,
    cacheHitRate,
  };
}
