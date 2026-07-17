/**
 * CommandPalette — global Cmd-K spotlight backed by Convex federated search.
 *
 * Pattern: federated search palette (Linear / Raycast / Cursor shape) that
 * consumes the `domains/search/federatedSearch:federatedSearch` action
 * (PR #310). Empty query falls back to the static nav-commands group so
 * the palette stays useful for navigation alone.
 *
 * Result groups (collections):
 *   nb_entities, nb_reports, nb_notebook_blocks, nb_claims, nb_sources,
 *   nb_captures, nb_threads, plus a synthetic "Commands" group for nav.
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   - BOUND        max 5 results per group, 35 total in palette
 *   - HONEST_STATUS each per-collection failure shows "Search failed for {name}"
 *                  inline; never silently hidden
 *   - TIMEOUT      client-side 3.5 s abort (server budget 3 s + 0.5 s buffer)
 *   - DETERMINISTIC same query + same data → same render order (server-side)
 *
 * Accessibility (.claude/rules/reexamine_a11y.md + reexamine_keyboard.md):
 *   - role="dialog" aria-modal aria-label
 *   - role="listbox" with role="option" + aria-selected on each result
 *   - aria-live="polite" announces N results across M collections
 *   - Radix Dialog owns the modal focus trap; Escape closes; focus returns to trigger element
 *   - cmdk owns option traversal; Cmd+1..7 jumps groups
 *   - Enter opens; Cmd+Enter "ask about this" pre-fills the chat composer
 *
 * Design reduction (.claude/rules/reexamine_design_reduction.md):
 *   - Plain-language group labels: "Reports", "Entities", "Threads"
 *   - Result count is shown only when >0 (drives scroll vs refine decision)
 *   - No icons-only labels — every result has a text label
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogTitle } from "@/components/ai-ui/dialog";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ai-ui/command";
import { useFederatedSearch } from "../../../layouts/chrome/commandPalette/useFederatedSearch";
import {
  addRecentCmdkSearch,
  getRecentCmdkSearches,
  type CmdkRecentSearch,
} from "../../../layouts/chrome/commandPalette/recentSearches";
import {
  resolveResultAction,
  isExternalPath,
} from "../../../layouts/chrome/commandPalette/resolveResultAction";
import {
  COLLECTION_DISPLAY_ORDER,
  COLLECTION_LABELS,
  MAX_RESULTS_PER_GROUP,
  MAX_RESULTS_TOTAL,
  type CollectionResult,
  type FederatedCollection,
  type FederatedHandle,
  type FederatedSearchResponse,
} from "../../../layouts/chrome/commandPalette/types";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  run: () => void;
  keywords?: string;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Optional extra commands injected by the surface that opened it. */
  extra?: PaletteCommand[];
}

/**
 * A flattened, navigable item — either a federated result or a static command.
 * Selection arithmetic only walks this list (skipping group headers).
 */
type FlatItem =
  | {
      kind: "result";
      handle: FederatedHandle;
      collection: FederatedCollection;
      flatIndex: number;
    }
  | {
      kind: "command";
      command: PaletteCommand;
      flatIndex: number;
    }
  | {
      kind: "recent";
      query: string;
      flatIndex: number;
    };

function flatItemValue(item: FlatItem): string {
  if (item.kind === "command") return `command:${item.command.id}`;
  if (item.kind === "recent") return `recent:${item.query}`;
  return `result:${item.collection}:${item.handle.uri}:${item.flatIndex}`;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export function CommandPalette({ open, onClose, extra = [] }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [recents, setRecents] = useState<CmdkRecentSearch[]>([]);

  const { data, isLoading, error } = useFederatedSearch(query);

  /* -------- static nav commands (preserved as fallback) -------- */
  const navCommands: PaletteCommand[] = useMemo(
    () => [
      {
        id: "go-home",
        label: "Go to Home",
        shortcut: "G H",
        run: () => navigate("/redesign"),
        keywords: "dashboard pulse",
      },
      {
        id: "go-reports",
        label: "Go to Reports",
        shortcut: "G R",
        run: () => navigate("/redesign/reports"),
        keywords: "library memory",
      },
      {
        id: "go-chat",
        label: "Go to Chat",
        shortcut: "G C",
        run: () => navigate("/redesign/chat"),
        keywords: "ask question",
      },
      {
        id: "go-inbox",
        label: "Go to Inbox",
        shortcut: "G I",
        run: () => navigate("/redesign/inbox"),
        keywords: "review queue",
      },
      {
        id: "go-me",
        label: "Go to Me",
        shortcut: "G M",
        run: () => navigate("/redesign/me"),
        keywords: "profile preferences",
      },
      {
        id: "go-workspace",
        label: "Open Workspace",
        run: () => navigate("/redesign/workspace"),
        keywords: "graph map sources",
      },
      {
        id: "act-shortcuts",
        label: "Show all keyboard shortcuts",
        shortcut: "?",
        run: () => {
          window.dispatchEvent(new CustomEvent("rd:shortcuts:open"));
        },
        keywords: "help kbd",
      },
      {
        id: "act-toggle-theme",
        label: "Toggle dark / light mode",
        run: () => {
          document.documentElement.classList.toggle("dark");
        },
        keywords: "theme appearance",
      },
    ],
    [navigate],
  );

  const allNavCommands = useMemo(() => [...navCommands, ...extra], [navCommands, extra]);

  /* -------- filtered nav commands (substring match when query non-empty) -------- */
  const filteredCommands = useMemo<PaletteCommand[]>(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return allNavCommands;
    return allNavCommands.filter((c) => {
      const hay = `${c.label} ${c.hint ?? ""} ${c.keywords ?? ""}`.toLowerCase();
      return hay.includes(trimmed);
    });
  }, [allNavCommands, query]);

  /* -------- federated result groups (capped) -------- */
  const collectionResults: CollectionResult[] = useMemo(() => {
    if (!data) {
      return COLLECTION_DISPLAY_ORDER.map((c) => ({
        collection: c,
        ok: true,
        results: [],
        count: 0,
      }));
    }
    const byName: Map<FederatedCollection, CollectionResult> = new Map();
    for (const r of data.collections) byName.set(r.collection, r);
    return COLLECTION_DISPLAY_ORDER.map(
      (c): CollectionResult =>
        byName.get(c) ?? { collection: c, ok: true, results: [], count: 0 },
    );
  }, [data]);

  /* -------- flat list of selectable items, in render order -------- */
  const { flatItems, totalRendered } = useMemo(() => {
    const items: FlatItem[] = [];
    let total = 0;

    if (query.trim()) {
      // Search mode — federated results first, then commands as fallback group.
      for (const result of collectionResults) {
        const visible = result.results.slice(0, MAX_RESULTS_PER_GROUP);
        for (const handle of visible) {
          if (total >= MAX_RESULTS_TOTAL) break;
          items.push({
            kind: "result",
            handle,
            collection: result.collection,
            flatIndex: items.length,
          });
          total += 1;
        }
        if (total >= MAX_RESULTS_TOTAL) break;
      }
      for (const command of filteredCommands) {
        items.push({ kind: "command", command, flatIndex: items.length });
      }
    } else {
      // Empty mode — recents + commands.
      for (const r of recents) {
        items.push({ kind: "recent", query: r.query, flatIndex: items.length });
      }
      for (const command of filteredCommands) {
        items.push({ kind: "command", command, flatIndex: items.length });
      }
    }

    return { flatItems: items, totalRendered: total };
  }, [query, collectionResults, filteredCommands, recents]);

  /* -------- selection arithmetic -------- */
  useEffect(() => {
    setActive(0);
  }, [query]);

  // Clamp selection if items shrink.
  useEffect(() => {
    if (active >= flatItems.length) {
      setActive(Math.max(0, flatItems.length - 1));
    }
  }, [active, flatItems.length]);

  /* -------- on-open: focus input, capture trigger element, load recents -------- */
  useEffect(() => {
    if (!open) return;
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    setQuery("");
    setRecents(getRecentCmdkSearches());
    const handle = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(handle);
  }, [open]);

  /* -------- on-close: return focus to trigger -------- */
  const handleClose = useCallback(() => {
    onClose();
    window.setTimeout(() => {
      if (triggerRef.current && document.contains(triggerRef.current)) {
        triggerRef.current.focus();
      }
    }, 0);
  }, [onClose]);

  /* -------- execute item — primary or secondary action -------- */
  const executeItem = useCallback(
    (item: FlatItem, mode: "primary" | "secondary") => {
      if (item.kind === "command") {
        if (query.trim()) addRecentCmdkSearch(query);
        item.command.run();
        handleClose();
        return;
      }
      if (item.kind === "recent") {
        // Re-fire that query — populate input, do NOT close.
        setQuery(item.query);
        return;
      }
      // result
      const { primaryPath, secondaryPath } = resolveResultAction(item.handle);
      const target = mode === "secondary" ? secondaryPath : primaryPath;
      if (query.trim()) addRecentCmdkSearch(query);
      if (isExternalPath(target)) {
        window.open(target, "_blank", "noopener,noreferrer");
      } else {
        navigate(target);
      }
      handleClose();
    },
    [navigate, handleClose, query],
  );

  /* -------- jump to group via Cmd+1..7 -------- */
  const jumpToGroup = useCallback(
    (groupNumber: number) => {
      // groupNumber is 1-indexed against COLLECTION_DISPLAY_ORDER.
      if (groupNumber < 1 || groupNumber > COLLECTION_DISPLAY_ORDER.length) return;
      const targetCollection = COLLECTION_DISPLAY_ORDER[groupNumber - 1];
      const idx = flatItems.findIndex(
        (it) => it.kind === "result" && it.collection === targetCollection,
      );
      if (idx >= 0) setActive(idx);
    },
    [flatItems],
  );

  /* -------- keyboard handler -------- */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape — close.
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
        return;
      }
      // Cmd/Ctrl + 1..7 — jump to group.
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        jumpToGroup(Number(e.key));
        return;
      }
      // Arrow navigation is delegated to cmdk.
      if (e.key === "Enter") {
        e.preventDefault();
        const item = flatItems[active];
        if (item) executeItem(item, e.metaKey || e.ctrlKey ? "secondary" : "primary");
        return;
      }
      if (e.key === "?" && !isInTextInput(e.target)) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("rd:shortcuts:open"));
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, flatItems, active, executeItem, jumpToGroup, handleClose]);

  /* -------- scroll active row into view -------- */
  useEffect(() => {
    if (!listRef.current || !open) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-flat-index="${active}"]`);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [active, open]);

  if (!open) return null;

  /* -------- group + render -------- */
  const liveRegionMessage = buildLiveRegion({
    query,
    isLoading,
    error,
    data,
    totalRendered,
  });

  // Group results for the visible list.
  const visibleByCollection: Map<FederatedCollection, FlatItem[]> = new Map();
  const commandsBucket: FlatItem[] = [];
  const recentsBucket: FlatItem[] = [];
  for (const it of flatItems) {
    if (it.kind === "result") {
      const arr = visibleByCollection.get(it.collection) ?? [];
      arr.push(it);
      visibleByCollection.set(it.collection, arr);
    } else if (it.kind === "command") {
      commandsBucket.push(it);
    } else {
      recentsBucket.push(it);
    }
  }

  const showSearchMode = query.trim().length > 0;
  const totalResults = flatItems.filter((i) => i.kind === "result").length;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) handleClose(); }}>
      <DialogContent
        className="w-auto max-w-none border-0 bg-transparent p-0 shadow-none"
        overlayClassName="rd-cmdk__backdrop"
        showCloseButton={false}
        aria-label="Command palette"
        aria-modal="true"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="rd-cmdk">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command
          shouldFilter={false}
          label="Search anything"
          value={flatItems[active] ? flatItemValue(flatItems[active]) : undefined}
          onValueChange={(value) => {
            const next = flatItems.findIndex((item) => flatItemValue(item) === value);
            if (next >= 0) setActive(next);
          }}
          className="rounded-none bg-transparent text-inherit"
        >
        <div className="rd-cmdk__head">
          <SearchIcon />
          <CommandInput
            ref={inputRef}
            data-cmdk-input
            value={query}
            onValueChange={setQuery}
            placeholder="Search anything..."
            aria-label="Search anything"
            className="h-auto border-0 p-0"
            wrapperClassName="contents [&>svg]:hidden"
            spellCheck={false}
          />
          <span className="rd-cmdk__esc" aria-label="Close">Esc</span>
        </div>

        {/* Status bar — total + scope + degraded warning */}
        {(data || isLoading || error) && (
          <div
            className="rd-cmdk__status"
            data-tone={data?.partial || data?.timedOut || error ? "warn" : undefined}
            data-cmdk-status
          >
            <span>
              {isLoading
                ? "Searching..."
                : error
                  ? "Search request failed - showing the last good result."
                  : data
                    ? `${data.total} ${data.total === 1 ? "result" : "results"} across ${data.collections.length} collections`
                    : ""}
            </span>
            {data ? (
              <span>
                {data.identityScope === "anonymous" ? "anonymous" : "your account"}
                {data.partial ? " · partial" : ""}
                {data.timedOut ? " · timed out" : ""}
              </span>
            ) : null}
          </div>
        )}

        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {liveRegionMessage}
        </span>

        <CommandList
          ref={listRef}
          id="rd-cmdk-listbox"
          className="rd-cmdk__list"
          accessibleLabel="Search results"
        >
          {/* Loading skeleton (only when no prior data is visible) */}
          {isLoading && !data ? <SkeletonGroups /> : null}

          {/* Empty mode — show recents (if any), then commands */}
          {!showSearchMode && recentsBucket.length > 0 ? (
            <CommandGroup
              className="rd-cmdk__group"
              data-cmdk-group="recents"
              heading="Recent searches"
            >
              {recentsBucket.map((it) => {
                if (it.kind !== "recent") return null;
                const isActive = it.flatIndex === active;
                return (
                  <CommandItem
                    key={`recent-${it.query}`}
                    value={flatItemValue(it)}
                    id={`rd-cmdk-row-${it.flatIndex}`}
                    data-flat-index={it.flatIndex}
                    data-cmdk-result
                    data-cmdk-active={isActive || undefined}
                    data-active={isActive || undefined}
                    className="rd-cmdk__row"
                    onMouseEnter={() => setActive(it.flatIndex)}
                    onClick={() => executeItem(it, "primary")}
                  >
                    <span className="rd-cmdk__row-label">{it.query}</span>
                    <span className="rd-cmdk__row-hint">Re-run search</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}

          {/* Search mode — federated result groups */}
          {showSearchMode
            ? COLLECTION_DISPLAY_ORDER.map((collection) => {
                const result = collectionResults.find((r) => r.collection === collection);
                if (!result) return null;
                const items = visibleByCollection.get(collection) ?? [];
                // Render group ONLY when it has results OR an error to surface.
                if (items.length === 0 && result.ok) return null;
                return (
                  <CommandGroup
                    key={collection}
                    className="rd-cmdk__group"
                    data-cmdk-group={collection}
                  >
                    <div className="rd-cmdk__group-label">
                      {COLLECTION_LABELS[collection]}
                      {result.count > 0 ? <span> · {result.count}</span> : null}
                    </div>
                    {!result.ok ? (
                      <div className="rd-cmdk__group-error" role="status">
                        Search failed for {COLLECTION_LABELS[collection].toLowerCase()}
                        {result.error ? ` - ${result.error}` : ""}
                      </div>
                    ) : null}
                    {items.map((it) => {
                      if (it.kind !== "result") return null;
                      const isActive = it.flatIndex === active;
                      return (
                        <CommandItem
                          key={`${collection}-${it.handle.uri}-${it.flatIndex}`}
                          value={flatItemValue(it)}
                          id={`rd-cmdk-row-${it.flatIndex}`}
                          data-flat-index={it.flatIndex}
                          data-cmdk-result
                          data-cmdk-active={isActive || undefined}
                          data-active={isActive || undefined}
                          className="rd-cmdk__row"
                          onMouseEnter={() => setActive(it.flatIndex)}
                          onClick={(e) =>
                            executeItem(it, e.metaKey || e.ctrlKey ? "secondary" : "primary")
                          }
                        >
                          <span className="rd-cmdk__row-label">
                            {it.handle.title || COLLECTION_LABELS[collection]}
                            {it.handle.source ? (
                              <span className="rd-cmdk__row-source">
                                {it.handle.source}
                              </span>
                            ) : null}
                          </span>
                          {it.handle.snippet ? (
                            <span className="rd-cmdk__row-snippet">{it.handle.snippet}</span>
                          ) : null}
                        </CommandItem>
                      );
                    })}
                    {result.count > items.length ? (
                      <div className="rd-cmdk__row-more">
                        + {result.count - items.length} more in {COLLECTION_LABELS[collection].toLowerCase()}
                      </div>
                    ) : null}
                  </CommandGroup>
                );
              })
            : null}

          {/* Always render Commands group (acts as nav fallback) */}
          {commandsBucket.length > 0 ? (
            <CommandGroup className="rd-cmdk__group" data-cmdk-group="commands">
              <div className="rd-cmdk__group-label">Commands</div>
              {commandsBucket.map((it) => {
                if (it.kind !== "command") return null;
                const isActive = it.flatIndex === active;
                return (
                  <CommandItem
                    key={it.command.id}
                    value={flatItemValue(it)}
                    keywords={[it.command.label, it.command.hint ?? "", it.command.keywords ?? ""]}
                    id={`rd-cmdk-row-${it.flatIndex}`}
                    data-flat-index={it.flatIndex}
                    data-cmdk-result
                    data-cmdk-active={isActive || undefined}
                    data-active={isActive || undefined}
                    className="rd-cmdk__row"
                    onMouseEnter={() => setActive(it.flatIndex)}
                    onClick={() => executeItem(it, "primary")}
                  >
                    <span className="rd-cmdk__row-label">{it.command.label}</span>
                    {it.command.hint ? (
                      <span className="rd-cmdk__row-hint">{it.command.hint}</span>
                    ) : null}
                    {it.command.shortcut ? (
                      <span className="rd-cmdk__row-kbd">
                        {it.command.shortcut.split(" ").map((k, i) => (
                          <kbd key={i}>{k}</kbd>
                        ))}
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}

          {/* Empty + no recents */}
          {!showSearchMode && recentsBucket.length === 0 && commandsBucket.length === 0 ? (
            <div className="rd-cmdk__empty">
              Try searching for an entity, report, or thread.
            </div>
          ) : null}

          {/* Search mode + truly zero results */}
          {showSearchMode &&
          !isLoading &&
          totalResults === 0 &&
          commandsBucket.length === 0 ? (
            <div className="rd-cmdk__empty">
              0 results for "{query}"
            </div>
          ) : null}
        </CommandList>
        </Command>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

function SkeletonGroups() {
  return (
    <div data-cmdk-skeleton>
      {[0, 1, 2].map((g) => (
        <div className="rd-cmdk__group" key={g} aria-hidden="true">
          <div className="rd-cmdk__group-label">Loading...</div>
          <div className="rd-cmdk__skeleton">
            <div className="rd-cmdk__skeleton-line" style={{ width: "70%" }} />
            <div className="rd-cmdk__skeleton-line" style={{ width: "55%" }} />
            <div className="rd-cmdk__skeleton-line" style={{ width: "40%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function isInTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function buildLiveRegion(args: {
  query: string;
  isLoading: boolean;
  error: Error | null;
  data: FederatedSearchResponse | null;
  totalRendered: number;
}): string {
  const { query, isLoading, error, data, totalRendered } = args;
  if (!query.trim()) return "Empty query. Showing recent searches and commands.";
  if (isLoading) return `Searching for ${query}.`;
  if (error) return `Search failed: ${error.message}.`;
  if (!data) return "";
  const failed = data.collections.filter((c) => !c.ok).length;
  const parts = [
    `${data.total} ${data.total === 1 ? "result" : "results"} across ${data.collections.length} collections.`,
  ];
  if (failed > 0) parts.push(`${failed} collection${failed > 1 ? "s" : ""} failed.`);
  if (totalRendered < data.total) {
    parts.push(`${totalRendered} shown.`);
  }
  return parts.join(" ");
}

/* -------------------------------------------------------------------------- */
/* Hook: wires Cmd+K / Ctrl+K to open the palette.                             */
/* -------------------------------------------------------------------------- */

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}
