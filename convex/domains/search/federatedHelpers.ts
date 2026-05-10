/**
 * Federated search helpers — string composition + bounded snippet building.
 *
 * Pattern: denormalized searchableText field per row, populated at write time.
 * Search index lives on this field so we can query name + summary + aliases as
 * a single index without per-field weighting (keeps Convex schema simple).
 *
 * Prior art:
 *   - Convex `searchIndex` API (2025) — single searchField + filterFields
 *   - PR #306 Typesense scoping (Apr 2026) — denormalized projection pattern
 *
 * See: docs/architecture/CONVEX_FEDERATED_SEARCH.md (this PR)
 */

/**
 * Maximum bytes we ever stuff into searchableText to keep the index small.
 * Convex search index is documented to handle up to ~64KB per searchField,
 * but most useful match signal is in the first 2KB.
 */
export const MAX_SEARCHABLE_TEXT_BYTES = 2048;

/**
 * Per-result snippet cap (BOUND_READ rule). Truncated with ellipsis.
 */
export const MAX_SNIPPET_CHARS = 200;

/**
 * Per-collection limit cap (BOUND rule). Hard ceiling; callers may pass
 * smaller, larger requests are clamped silently.
 */
export const MAX_LIMIT_PER_COLLECTION = 25;

/**
 * Total result budget across all collections (BOUND rule).
 */
export const MAX_TOTAL_RESULTS = 50;

/**
 * Total wall-clock budget for the federated fan-out (TIMEOUT rule).
 * Partial > delayed.
 */
export const FEDERATED_TIMEOUT_MS = 3000;

/**
 * Compose a single searchable string from N source strings. Trims, dedupes
 * empty, joins with " | " separator, caps at MAX_SEARCHABLE_TEXT_BYTES.
 */
export function composeSearchableText(
  parts: ReadonlyArray<string | null | undefined>,
): string {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const part of parts) {
    if (typeof part !== "string") continue;
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const lowered = trimmed.toLowerCase();
    if (seen.has(lowered)) continue;
    seen.add(lowered);
    cleaned.push(trimmed);
  }
  const joined = cleaned.join(" | ");
  if (joined.length <= MAX_SEARCHABLE_TEXT_BYTES) return joined;
  return joined.slice(0, MAX_SEARCHABLE_TEXT_BYTES);
}

/**
 * Bound a snippet (BOUND_READ rule). Replaces newlines with spaces and
 * truncates at MAX_SNIPPET_CHARS with an ellipsis if longer.
 */
export function boundSnippet(text: string | null | undefined): string {
  if (typeof text !== "string") return "";
  const single = text.replace(/\s+/g, " ").trim();
  if (single.length <= MAX_SNIPPET_CHARS) return single;
  return `${single.slice(0, MAX_SNIPPET_CHARS - 1)}…`;
}

/**
 * Clamp a limit value into [1, MAX_LIMIT_PER_COLLECTION].
 */
export function clampLimit(limit: number | undefined, fallback = 8): number {
  const n = typeof limit === "number" && Number.isFinite(limit) ? limit : fallback;
  return Math.max(1, Math.min(MAX_LIMIT_PER_COLLECTION, Math.floor(n)));
}

/**
 * Reciprocal Rank Fusion (RRF). Combines two ranked id lists into a single
 * scored result. Higher score = better. Same args + same data => same order
 * (DETERMINISTIC rule).
 *
 * `k=60` is the classic RRF constant; smaller k privileges top results more.
 */
export function rrfMerge<T extends { id: string }>(
  keyword: ReadonlyArray<T>,
  vector: ReadonlyArray<T>,
  k = 60,
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();
  keyword.forEach((row, i) => {
    scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (k + i + 1));
  });
  vector.forEach((row, i) => {
    scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (k + i + 1));
  });
  // Sort by score desc, then id asc for deterministic tiebreak.
  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/**
 * Rough word overlap between query and candidate. Used as a fallback ranking
 * signal when no search index is available (e.g., un-backfilled rows). Pure
 * function, deterministic.
 */
export function lexicalScore(query: string, text: string): number {
  if (!query || !text) return 0;
  const qTokens = new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((tok) => tok.length >= 2),
  );
  if (qTokens.size === 0) return 0;
  const tTokens = new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((tok) => tok.length >= 2),
  );
  let hit = 0;
  for (const tok of qTokens) {
    if (tTokens.has(tok)) hit += 1;
  }
  return hit / qTokens.size;
}
