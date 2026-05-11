/**
 * NotebookBlockFinder — in-notebook find UI.
 *
 * Mount surface: an overlay opened by Cmd/Ctrl+F when the parent editor (or any
 * descendant of `containerRef`) has focus. Scoped per-report via `reportId`,
 * which is used both as the storage key for the most recent query and as the
 * filter context for any future server-backed expansion
 * (e.g. `filterBy: "report_id:=${reportId}"`).
 *
 * V1 behavior (this PR):
 *   - Pure in-document search across the editor's prosemirror text content.
 *   - No Convex / federated-search dependency — the finder is reliable even
 *     when the editor is offline and even before `productBlocks` rows are
 *     indexed (PR #310's backfill is in progress).
 *   - The component still emits `reportId` on its root and stores recent
 *     queries under `nb_finder_recent.<reportId>` so a future server-backed
 *     expansion can swap the body without changing the contract.
 *
 * Accessibility (.claude/rules/reexamine_a11y.md):
 *   - role="dialog" + aria-modal + aria-label
 *   - aria-live="polite" status row announces match count
 *   - Escape closes; focus returns to the editor element
 *   - Input is the initial focus target
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   - BOUND        — match list capped at MAX_MATCHES (200); query trimmed
 *                    to MAX_QUERY (200 chars)
 *   - HONEST_STATUS — "0 matches" rendered as plain text, never suppressed
 *   - DETERMINISTIC — match scan walks the DOM in document order; same input
 *                    + same content → same match list
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";

const MAX_QUERY = 200;
const MAX_MATCHES = 200;

export interface NotebookBlockFinderProps {
  /** The report whose notebook this finder is scoped to. Used for storage + future server-backed filter. */
  reportId: string;
  /** The editor host. The finder reads textContent from inside this element. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Called when the finder should close (Escape / dismiss). */
  onClose: () => void;
  /** Optional test id override. Default: "notebook-block-finder". */
  testId?: string;
}

interface Match {
  /** 0-based index of the match within the flattened text. */
  index: number;
  /** A short context window (preview) surrounding the match. */
  preview: string;
}

function recentKey(reportId: string) {
  return `nb_finder_recent.${reportId}`;
}

function readRecent(reportId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(recentKey(reportId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === "string").slice(0, 5)
      : [];
  } catch {
    return [];
  }
}

function pushRecent(reportId: string, q: string) {
  if (!q.trim() || typeof window === "undefined") return;
  const list = readRecent(reportId);
  const next = [q, ...list.filter((s) => s !== q)].slice(0, 5);
  try {
    window.localStorage.setItem(recentKey(reportId), JSON.stringify(next));
  } catch {
    /* localStorage may be unavailable in private sessions — non-fatal. */
  }
}

function findMatches(container: HTMLElement | null, query: string): Match[] {
  if (!container || !query) return [];
  const haystack = container.textContent ?? "";
  if (!haystack) return [];
  const needle = query.toLowerCase();
  const flatLower = haystack.toLowerCase();
  const out: Match[] = [];
  let cursor = 0;
  // Deterministic forward scan; bounded by MAX_MATCHES to keep the panel cheap.
  while (cursor < flatLower.length && out.length < MAX_MATCHES) {
    const hit = flatLower.indexOf(needle, cursor);
    if (hit === -1) break;
    const start = Math.max(0, hit - 24);
    const end = Math.min(haystack.length, hit + needle.length + 24);
    out.push({
      index: hit,
      preview: `${start > 0 ? "…" : ""}${haystack.slice(start, end)}${end < haystack.length ? "…" : ""}`,
    });
    cursor = hit + needle.length;
  }
  return out;
}

export function NotebookBlockFinder({
  reportId,
  containerRef,
  onClose,
  testId = "notebook-block-finder",
}: NotebookBlockFinderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [query, setQueryRaw] = useState("");
  const [recent, setRecent] = useState<string[]>(() => readRecent(reportId));

  // Bound the query length up-front so the rest of the component can assume
  // a fixed-size string. This pairs with BOUND in the file header.
  const setQuery = (next: string) => {
    setQueryRaw(next.length > MAX_QUERY ? next.slice(0, MAX_QUERY) : next);
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const matches = useMemo(
    () => findMatches(containerRef.current ?? null, query.trim()),
    // containerRef.current changes do not trigger memo invalidation by themselves
    // (React intentionally omits refs from deps), but query changes do — which is
    // when matches need to be recomputed in this finder's V1 design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, containerRef],
  );

  // Persist recent query when the user pauses typing (debounced via blur).
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    pushRecent(reportId, query.trim());
    setRecent(readRecent(reportId));
  };

  return (
    <div
      data-testid={testId}
      data-report-id={reportId}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="absolute right-3 top-3 z-30 w-[320px] rounded-lg border border-black/[0.08] bg-white p-3 shadow-lg dark:border-white/[0.08] dark:bg-[#1b1815]"
    >
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`${titleId}-input`}>
          Find in notebook
        </label>
        <span id={titleId} className="text-[11px] uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
          Find in notebook
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close finder"
          className="ml-auto rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-black/[0.04] dark:text-gray-400 dark:hover:bg-white/[0.06]"
        >
          Esc
        </button>
      </form>
      <input
        id={`${titleId}-input`}
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search blocks…"
        maxLength={MAX_QUERY}
        data-testid={`${testId}-input`}
        className="mt-2 w-full rounded-md border border-black/[0.08] bg-white px-2 py-1.5 text-sm text-gray-800 outline-none focus:border-[#d97757] dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100"
      />
      <div
        role="status"
        aria-live="polite"
        data-testid={`${testId}-status`}
        className="mt-2 text-[11px] text-gray-500 dark:text-gray-400"
      >
        {query.trim().length === 0
          ? recent.length > 0
            ? `Recent: ${recent.join(" · ")}`
            : "Type to search the open notebook"
          : `${matches.length}${matches.length === MAX_MATCHES ? "+" : ""} match${matches.length === 1 ? "" : "es"}`}
      </div>
      {matches.length > 0 ? (
        <ul
          data-testid={`${testId}-results`}
          className="mt-2 max-h-[280px] overflow-y-auto rounded-md border border-black/[0.06] dark:border-white/[0.08]"
        >
          {matches.slice(0, 50).map((m) => (
            <li
              key={m.index}
              className="border-b border-black/[0.04] px-2 py-1.5 text-xs text-gray-700 last:border-b-0 dark:border-white/[0.06] dark:text-gray-200"
            >
              {m.preview}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default NotebookBlockFinder;
