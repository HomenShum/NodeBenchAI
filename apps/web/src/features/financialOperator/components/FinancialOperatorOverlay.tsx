/**
 * FinancialOperatorOverlay — global, surface-agnostic drawer that mounts
 * the typed-card timeline next to whatever chat surface the user is on.
 *
 * Why a global overlay vs editing FastAgentPanel directly:
 *   - FastAgentPanel.tsx is 3700+ lines; surgical message-bubble edits
 *     have a high blast radius
 *   - URL-param driven state means any surface that wants to "host" a
 *     financial run just needs to set `?finRun=<runId>` in the URL
 *   - Closing/expanding is local to the overlay; chat scroll, agent
 *     panel state, etc are untouched
 *
 * Lifecycle:
 *   1. User triggers a financial run anywhere (chip, button, MCP tool)
 *   2. URL is updated to include `?finRun=<runId>`
 *   3. This overlay listens, mounts the timeline as a right-side drawer
 *   4. User can close (clears the param) or keep it docked while chatting
 *
 * The fixture demo view (/finance-demo) and this overlay use the SAME
 * `FinancialOperatorTimeline` component — single source of truth.
 */

import { useState, useEffect, useCallback } from "react";
import { ChevronRight, X, Maximize2, Minimize2 } from "lucide-react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { FinancialOperatorTimeline } from "./FinancialOperatorTimeline";
import { ModelCapabilityBadge } from "./ModelCapabilityBadge";

const OVERLAY_MODEL = "claude-opus-4-7";

const URL_PARAM = "finRun";
const STORAGE_KEY = "nb-fin-run-collapsed";

function readRunIdFromUrl(): Id<"financialOperatorRuns"> | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const v = params.get(URL_PARAM);
  return v && v.length > 0 ? (v as Id<"financialOperatorRuns">) : null;
}

function clearRunFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete(URL_PARAM);
  window.history.replaceState({}, "", url.toString());
  // Notify listeners (popstate doesn't fire on replaceState).
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function FinancialOperatorOverlay() {
  const [runId, setRunId] = useState<Id<"financialOperatorRuns"> | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<boolean>(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Sync runId + workspace mode with URL (initial mount + popstate).
  // When workspace mode is active, WorkspaceModePane handles the timeline
  // — the side-drawer overlay should defer to it to avoid double-render.
  useEffect(() => {
    const sync = () => {
      setRunId(readRunIdFromUrl());
      if (typeof window !== "undefined") {
        setWorkspaceMode(
          new URLSearchParams(window.location.search).get("ws") === "1",
        );
      }
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  // Persist collapse state
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, [collapsed]);

  const handleClose = useCallback(() => {
    clearRunFromUrl();
    setRunId(null);
  }, []);

  // Defer to WorkspaceModePane when workspace mode is active — that
  // surface owns the run rendering inline.
  if (workspaceMode) return null;
  if (!runId) return null;

  // Collapsed pill — small chip in the bottom-right corner.
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 right-4 z-[60] inline-flex items-center gap-2 rounded-full border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/15 px-3 py-1.5 text-[12px] text-[#f5d0b8] shadow-lg backdrop-blur transition-colors hover:bg-[var(--accent-primary)]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/60"
        aria-label="Expand active financial run"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent-primary)] opacity-75 motion-reduce:hidden"></span>
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent-primary)]"></span>
        </span>
        Active financial run
        <Maximize2 className="h-3 w-3" aria-hidden="true" />
      </button>
    );
  }

  return (
    <aside
      role="complementary"
      aria-label="Active financial operator run"
      className="fixed inset-y-0 right-0 z-[60] flex w-full max-w-md flex-col border-l border-[var(--border-color)] bg-[var(--bg-primary)]/95 shadow-[var(--shadow-xl)] backdrop-blur-md sm:max-w-lg lg:max-w-xl"
    >
      <header className="flex flex-shrink-0 flex-col gap-2 border-b border-[var(--border-color)] px-4 py-3">
        <div className="flex items-center gap-2">
          <ChevronRight size={16} strokeWidth={1.8} className="text-[var(--text-muted)]" aria-hidden="true" />
          <h2 className="type-label !tracking-[0.18em]">Active financial run</h2>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="rounded-full p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40"
              aria-label="Minimize"
            >
              <Minimize2 size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40"
              aria-label="Close run overlay"
            >
              <X size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        </div>
        <ModelCapabilityBadge model={OVERLAY_MODEL} />
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <FinancialOperatorTimeline runId={runId} />
      </div>
    </aside>
  );
}

/**
 * Helper for callers (chips, buttons, agent dispatchers): set the active
 * run in the URL so the overlay mounts. Any caller that has a runId can
 * invoke this — no direct dependency on FastAgentPanel internals.
 */
export function setActiveFinancialRun(
  runId: Id<"financialOperatorRuns"> | string,
) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set(URL_PARAM, String(runId));
  window.history.replaceState({}, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}
