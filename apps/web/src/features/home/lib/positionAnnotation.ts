/**
 * Position Annotation — matches signals to the user's entity graph
 * to produce "You:" annotations under each BLUF item.
 *
 * Pattern: scratchpad-first — derive from stored state, never re-compute
 * on render.  Positions are loaded once via `useHomeBrief()`, then
 * matched here via string similarity.
 *
 * Prior art: Claude Code "scratchpad-first" pattern — derive from
 * stored state, never re-compute on render.
 *
 * See: docs/architecture/HOME_DAILY_BRIEF_LIVE_WIRING.md §3.3
 */

import type {
  UserEntityPosition,
  PositionAnnotation,
} from "./briefTypes";

// ─── Entity Key Extraction ─────────────────────────────────────────────

/**
 * Extracts entity-matchable keys from text.
 * Returns lowercase slugs and multi-word entity names.
 *
 * Strategy:
 *   1. Extract multi-word capitalized sequences (entity name candidates)
 *   2. Strip possessives and common descriptors
 *   3. Return as lowercase keys for matching
 */
export function extractEntityKeys(text: string): string[] {
  if (!text) return [];

  const keys: string[] = [];

  // Extract multi-word capitalized sequences (e.g., "Anthropic", "OpenAI", "Rivian Automotive")
  const multiWord = text.match(/\b[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*\b/g);
  if (multiWord) {
    for (const match of multiWord) {
      // Strip common noise: "The", possessives, generic descriptors
      const cleaned = match
        .replace(/^The\s+/i, "")
        .replace(/'s$/i, "")
        .replace(/\s+(Inc|Corp|Ltd|LLC|Company|Co|Group|Holdings|Technologies|Labs)\.?$/i, "")
        .trim();

      if (cleaned.length >= 2) {
        keys.push(cleaned.toLowerCase());
      }
    }
  }

  return [...new Set(keys)]; // Deduplicate
}

// ─── Position Matching ─────────────────────────────────────────────────

/**
 * Matches a signal to the user's entity graph to produce the "You:" annotation.
 *
 * Match strategy (in priority order):
 *   1. Exact slug match: signal mentions entity slug directly
 *   2. Name containment: signal text contains entity name (case-insensitive)
 *   3. No match: returns null (no annotation rendered)
 *
 * This is intentionally conservative — false positives are worse than
 * false negatives in a trust-critical surface.
 */
export function findUserPosition(
  positions: UserEntityPosition[] | undefined,
  signal: { title: string; summary: string },
): PositionAnnotation | null {
  if (!positions || positions.length === 0) return null;

  // Extract entity keys from signal text
  const entityKeys = extractEntityKeys(`${signal.title} ${signal.summary}`);
  if (entityKeys.length === 0) return null;

  // Find matching user position (first match wins)
  const match = positions.find((p) =>
    entityKeys.some(
      (key) =>
        p.entitySlug === key ||
        p.entityName.toLowerCase().includes(key) ||
        key.includes(p.entityName.toLowerCase()),
    ),
  );

  if (!match) return null;

  return {
    relationship: match.relationship,
    exposure: formatExposure(match),
    context: match.activeContext ?? "",
  };
}

// ─── Formatting Helpers ────────────────────────────────────────────────

/**
 * Formats exposure as human-readable string.
 * "$150K/yr ARR dependency" or "vendor dependency" if no value.
 */
function formatExposure(position: UserEntityPosition): string {
  if (position.annualValue != null && position.annualValue > 0) {
    return `${formatCurrency(position.annualValue)}/yr ${position.exposureType ?? ""}`.trim();
  }
  return position.exposureType ?? position.relationship;
}

/**
 * Formats a number as currency shorthand.
 * 1500000 → "$1.5M"   |   75000 → "$75K"   |   500 → "$500"
 */
function formatCurrency(value: number): string {
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  return `$${value}`;
}
