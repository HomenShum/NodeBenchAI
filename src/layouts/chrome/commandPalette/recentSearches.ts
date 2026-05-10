/**
 * Cmd-K recent searches — localStorage CRUD with TTL + dedupe.
 *
 * Storage key: `nb_cmdk_recent_v1` (versioned for safe schema bumps).
 * Cap: 10 entries. TTL: 30 days.
 *
 * Pattern: write-through cache. Every successful federated search query is
 * pushed to the top; older instances of the same query are removed (so the
 * list stays useful, not redundant).
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   - BOUND: max 10 entries, never grows unbounded
 *   - DETERMINISTIC: same query string always collides (case-sensitive intentional —
 *     queries like "AAPL" vs "aapl" are user signal)
 *
 * NOT shared across devices — pure client-side. Out of scope for v1.
 */

const RECENT_KEY = "nb_cmdk_recent_v1";
const MAX_RECENT = 10;
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface CmdkRecentSearch {
  query: string;
  timestamp: number;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

export function getRecentCmdkSearches(): CmdkRecentSearch[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    const fresh = parsed
      .filter(
        (entry): entry is CmdkRecentSearch =>
          !!entry &&
          typeof entry.query === "string" &&
          entry.query.trim().length > 0 &&
          typeof entry.timestamp === "number" &&
          now - entry.timestamp < TTL_MS,
      )
      .slice(0, MAX_RECENT);
    return fresh;
  } catch {
    return [];
  }
}

export function addRecentCmdkSearch(query: string): void {
  if (!canUseStorage()) return;
  const trimmed = query.trim();
  if (!trimmed) return;
  try {
    const existing = getRecentCmdkSearches().filter(
      (entry) => entry.query !== trimmed,
    );
    const next: CmdkRecentSearch[] = [
      { query: trimmed, timestamp: Date.now() },
      ...existing,
    ].slice(0, MAX_RECENT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage may be full or disabled (private mode). Fail silent — recent
    // searches are a convenience, not a correctness invariant.
  }
}

export function clearRecentCmdkSearches(): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(RECENT_KEY);
  } catch {
    // Ignore.
  }
}
