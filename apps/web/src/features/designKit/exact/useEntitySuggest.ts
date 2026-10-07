/**
 * useEntitySuggest — focused @mention autocomplete for entity slugs.
 *
 * Wraps the existing `useFederatedSearch` hook
 * (src/layouts/chrome/commandPalette/useFederatedSearch.ts) and surfaces
 * only the `nb_entities` collection. Used by `ExactComposer` to power
 * @mention autocomplete in the cockpit chat surface.
 *
 * Pattern: thin adapter over the federated-search action. Inherits the
 * underlying hook's debounce, abort, and stale-request semantics, so this
 * file stays small and the reliability invariants stay in one place.
 *
 * Prior art:
 *   - useFederatedSearch (this repo) — debounced reactive consumer
 *   - GitHub / Notion @mention popups — combobox + slug emit
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   - HONEST_STATUS: surfaces { error } from underlying action — never
 *     silently renders an empty popup on transient failure.
 *   - BOUND: caller clamps `limit` (default 8). Server caps at 25.
 *   - DETERMINISTIC: same prefix + same data → same shape (server-side).
 *
 * Returns:
 *   - hits: EntitySuggestHit[]   — slug-shaped results ready for insertion
 *   - isLoading: boolean         — true while a request is in flight
 *   - error: Error | null        — set when the latest request failed
 *
 * Empty / whitespace prefix short-circuits to { hits: [], isLoading: false }.
 *
 * See: src/features/designKit/exact/ExactComposer.tsx (consumer)
 */

import { useMemo } from "react";
import { useFederatedSearch } from "@/layouts/chrome/commandPalette/useFederatedSearch";
import type { FederatedHandle } from "@/layouts/chrome/commandPalette/types";

export interface EntitySuggestHit {
  /** Stable slug, e.g. "orbital-labs". Used as the @ token in composer text. */
  slug: string;
  /** Display title shown as the primary line in the popup. */
  title: string;
  /** Optional subtitle (entityType or snippet). Empty string when absent. */
  subtitle: string;
}

export interface UseEntitySuggestArgs {
  /** Substring after the trailing `@` in the composer. Empty disables. */
  prefix: string;
  /** Target collection — caller pins to "nb_entities" for entity mentions. */
  collection: "nb_entities";
  /** Max popup rows. Defaults to 8 (BOUND). */
  limit?: number;
}

export interface UseEntitySuggestResult {
  hits: EntitySuggestHit[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Parse an entity URI ("entity://orbital-labs") into a slug. Returns the
 * empty string when the URI shape is unexpected — callers treat empty
 * slugs as not-insertable and skip them.
 */
function slugFromUri(uri: string): string {
  const prefix = "entity://";
  if (!uri.startsWith(prefix)) return "";
  return uri.slice(prefix.length).trim();
}

export function useEntitySuggest({
  prefix,
  collection,
  limit = 8,
}: UseEntitySuggestArgs): UseEntitySuggestResult {
  // Reuse the federated-search hook end-to-end. It already debounces,
  // aborts stale in-flight requests, and surfaces errors honestly.
  const { data, isLoading, error } = useFederatedSearch(prefix);

  const hits = useMemo<EntitySuggestHit[]>(() => {
    if (!data) return [];
    const target = data.collections.find((c) => c.collection === collection);
    if (!target || !target.ok) return [];
    const rows: FederatedHandle[] = target.results ?? [];
    const seen = new Set<string>();
    const shaped: EntitySuggestHit[] = [];
    for (const row of rows) {
      const slug = slugFromUri(row.uri);
      if (!slug) continue;
      if (seen.has(slug)) continue;
      seen.add(slug);
      shaped.push({
        slug,
        title: row.title || slug,
        subtitle: row.source || row.snippet || "",
      });
      if (shaped.length >= limit) break;
    }
    return shaped;
  }, [data, collection, limit]);

  return { hits, isLoading, error };
}

export default useEntitySuggest;
