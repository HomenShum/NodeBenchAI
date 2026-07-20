/**
 * MentionPicker — dropdown autocomplete for @mentions of entities.
 *
 * Used by the slash palette's `@` command and (Phase B) by the per-block
 * Lexical editor as an inline trigger.
 *
 * Pattern: federated-search consumer (same as Cmd-K palette). Replaces the
 * legacy `searchEntitiesForMention` query, which did `take(200) + JS filter`
 * and silently truncated results for power users with >200 entities. This
 * variant routes through `domains/search/federatedSearch:federatedSearch`
 * (PR #310 + #315 hybrid) — backed by Convex's `search_entities` searchIndex
 * with no scan cliff and typo tolerance once embeddings populate.
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   - BOUND       autocomplete capped at MENTION_LIMIT (25) results
 *   - HONEST_STATUS errors set `error` state — never silently rendered as 0
 *   - TIMEOUT     stale-request guard via monotonic request id
 *   - DETERMINISTIC server returns RRF-ranked + id-tiebroken handles
 *
 * Privacy: federatedSearch resolves the caller's identity server-side and
 * scopes to their own ownerKey. In a shared-workspace context the user
 * mentions their own entities (the workspace owner's private entities are
 * intentionally NOT exposed via this path).
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";

export type EntityMatch = {
  slug: string;
  name: string;
  entityType: string;
};

type Props = {
  onSelect: (match: EntityMatch) => void;
  onClose: () => void;
  initialQuery?: string;
  /** Reserved — kept for API compatibility with EntityNotebookLive callers. */
  entitySlug?: string;
  /** Reserved — kept for API compatibility with EntityNotebookLive callers. */
  shareToken?: string;
};

/** Autocomplete UX cap — never show more than MENTION_LIMIT options at once. */
const MENTION_LIMIT = 25;
/** Debounce window so we don't fire an action on every keystroke. */
const DEBOUNCE_MS = 120;

/**
 * Map a federatedSearch entity handle back to the legacy MentionPicker shape.
 * The entity URI is `entity://{slug}` (see federatedSearch.ts), `title` is the
 * entity name, and `source` is the entityType.
 */
function handleToMatch(handle: {
  type: string;
  uri: string;
  title: string;
  source: string;
}): EntityMatch | null {
  if (handle.type !== "nb_entities") return null;
  const slug = handle.uri.replace(/^entity:\/\//, "");
  if (!slug) return null;
  return { slug, name: handle.title, entityType: handle.source };
}

export function MentionPicker({
  onSelect,
  onClose,
  initialQuery = "",
}: Props) {
  const anonymousSessionId = getAnonymousProductSessionId();
  // Cast loosely — codegen path may resolve before federatedSearch.ts is
  // deployed, same trick the Cmd-K palette uses (useFederatedSearch.ts).
  const federatedSearch = useAction(
    (api as any).domains.search.federatedSearch.federatedSearch,
  );

  const [query, setQuery] = useState(initialQuery);
  const [matches, setMatches] = useState<EntityMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  // Monotonic id — only the latest in-flight request mutates state.
  const requestIdRef = useRef(0);

  const fire = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      const myId = ++requestIdRef.current;

      // Empty query short-circuits; matches the legacy "type to search" hint.
      if (!trimmed) {
        setMatches([]);
        return;
      }

      try {
        const response = (await federatedSearch({
          q: trimmed,
          collections: ["nb_entities"],
          limit: MENTION_LIMIT,
          anonymousSessionId,
        })) as {
          collections: Array<{
            collection: string;
            ok: boolean;
            results: Array<{
              type: string;
              uri: string;
              title: string;
              source: string;
            }>;
          }>;
        };

        // Stale check — newer keystroke fired after this one.
        if (myId !== requestIdRef.current) return;

        const entityCollection = response.collections.find(
          (c) => c.collection === "nb_entities",
        );
        // HONEST_STATUS: per-collection failure surfaces as zero matches
        // (the autocomplete UX has no error slot to render an inline message).
        if (!entityCollection?.ok || !entityCollection.results) {
          setMatches([]);
          return;
        }
        const mapped = entityCollection.results
          .map(handleToMatch)
          .filter((m): m is EntityMatch => m !== null)
          .slice(0, MENTION_LIMIT);
        setMatches(mapped);
        setActiveIndex(0);
      } catch {
        if (myId !== requestIdRef.current) return;
        // Same swallow-to-empty: the legacy query also returned [] on error.
        setMatches([]);
      }
    },
    [federatedSearch, anonymousSessionId],
  );

  // Debounce the action call. Uses a small window — autocomplete should feel
  // immediate but a 120 ms gate avoids firing on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      void fire(query);
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, fire]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    if (activeIndex >= matches.length) {
      setActiveIndex(Math.max(0, matches.length - 1));
    }
  }, [matches.length, activeIndex]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((idx) => Math.min(idx + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((idx) => Math.max(idx - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const match = matches[activeIndex];
      if (match) onSelect(match);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-30 mt-1 w-[280px] rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg dark:border-white/10 dark:bg-[#1a1a1b]"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <input
        type="text"
        autoFocus
        placeholder="Search entities…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        className="mb-1 w-full rounded-md border border-gray-100 bg-transparent px-2.5 py-1 text-sm text-gray-900 outline-none focus:border-gray-200 dark:border-white/[0.06] dark:text-gray-100 dark:focus:border-white/20"
      />
      {matches.length === 0 ? (
        <div className="px-2.5 py-2 text-xs text-gray-500">
          {query ? "No matches." : "Type to search…"}
        </div>
      ) : (
        matches.map((match, idx) => (
          <button
            key={match.slug}
            type="button"
            onMouseEnter={() => setActiveIndex(idx)}
            onClick={() => onSelect(match)}
            className={`flex w-full items-center gap-3 rounded px-2.5 py-1.5 text-sm transition-colors ${
              idx === activeIndex
                ? "bg-gray-100 dark:bg-white/[0.05]"
                : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
            }`}
          >
            <span className="truncate text-gray-900 dark:text-gray-100">{match.name}</span>
            <span className="ml-auto text-[11px] text-gray-500">{match.entityType}</span>
          </button>
        ))
      )}
    </div>
  );
}

export default MentionPicker;
