/**
 * WorkspaceModePane — operator-console takeover that follows the kit's
 * canonical chat-surface layout (per ui_kits/nodebench-web/ChatThread.jsx):
 *
 *   ┌─ chat header (sticky top, entity icon + title + meta + actions) ─┐
 *   │                                                                  │
 *   ├─ scrollable thread area ─────────────────────────────────────────┤
 *   │ [demo picker if no run, OR live operator-console timeline]       │
 *   │                                                                  │
 *   ├─ composer (pinned bottom) ───────────────────────────────────────┤
 *   │ pins · field with attach + textarea + send · model badge · chips │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * This is built ON TOP of the existing chat surface, not next to it: we
 * reuse the kit's chat-shell shape so when this pane mounts the user
 * doesn't perceive a regime change. The model badge + capabilities live
 * in the composer (where the kit puts them), not in the header.
 *
 * URL params drive everything (`?ws=1`, `?finRun=<id>`) so deep links
 * work without coupling to FastAgentPanel internals.
 */

import { useState, useEffect, useCallback } from "react";
import { useAction } from "convex/react";
import {
  Calculator,
  FileSpreadsheet,
  ScrollText,
  TrendingUp,
  X,
  ArrowLeft,
  Sparkles,
} from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { FinancialOperatorTimeline } from "./FinancialOperatorTimeline";
import { setActiveFinancialRun } from "./FinancialOperatorOverlay";
import {
  isWorkspaceModeActive,
  setWorkspaceMode,
} from "./WorkspaceModeToggle";
import { WorkspaceComposer } from "./WorkspaceComposer";

type DemoId = "att" | "crm" | "covenant" | "variance";

interface DemoOption {
  id: DemoId;
  label: string;
  blurb: string;
  icon: typeof Calculator;
  category: string;
}

const DEMOS: DemoOption[] = [
  {
    id: "att",
    label: "AT&T 10-K — ETR & cost of debt",
    blurb: "Locate filing sections, extract values, sandbox math, gather sources, draft a notebook + PR.",
    icon: Calculator,
    category: "Financial metric extraction",
  },
  {
    id: "crm",
    label: "CRM cleanup",
    blurb: "Profile a 387-row prospect list, dedupe, enrich, export CRM-ready CSV.",
    icon: FileSpreadsheet,
    category: "Data cleanup",
  },
  {
    id: "covenant",
    label: "Covenant compliance",
    blurb: "Locate the leverage covenant, extract terms + financials, sandbox compliance gate, draft memo.",
    icon: ScrollText,
    category: "Credit-agreement review",
  },
  {
    id: "variance",
    label: "Variance analysis",
    blurb: "Align CoA, compute per-line variance in sandbox, surface drivers, draft CFO summary.",
    icon: TrendingUp,
    category: "Monthly close",
  },
];

const FIN_RUN_PARAM = "finRun";

function readActiveRunId(): Id<"financialOperatorRuns"> | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get(FIN_RUN_PARAM);
  return v && v.length > 0 ? (v as Id<"financialOperatorRuns">) : null;
}

export function WorkspaceModePane() {
  const [active, setActive] = useState<boolean>(() => isWorkspaceModeActive());
  const [activeRunId, setActiveRunId] = useState<Id<"financialOperatorRuns"> | null>(
    () => readActiveRunId(),
  );
  const [pendingDemoId, setPendingDemoId] = useState<DemoId | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sync with URL on mount + popstate
  useEffect(() => {
    const onPop = () => {
      setActive(isWorkspaceModeActive());
      setActiveRunId(readActiveRunId());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const runAtt = useAction(
    api.domains.financialOperator.orchestrator.runAttCostOfDebtDemo,
  );
  const runCrm = useAction(
    api.domains.financialOperator.orchestratorExamples.runCrmCleanupDemo,
  );
  const runCovenant = useAction(
    api.domains.financialOperator.orchestratorExamples.runCovenantComplianceDemo,
  );
  const runVariance = useAction(
    api.domains.financialOperator.orchestratorExamples.runVarianceAnalysisDemo,
  );

  const handleStart = useCallback(
    async (id: DemoId) => {
      setPendingDemoId(id);
      setError(null);
      try {
        let result: { runId: Id<"financialOperatorRuns"> };
        switch (id) {
          case "att":      result = await runAtt({}); break;
          case "crm":      result = await runCrm({}); break;
          case "covenant": result = await runCovenant({}); break;
          case "variance": result = await runVariance({}); break;
        }
        setActiveFinancialRun(result.runId);
        setActiveRunId(result.runId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to start run");
      } finally {
        setPendingDemoId(null);
      }
    },
    [runAtt, runCrm, runCovenant, runVariance],
  );

  const handleClearRun = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete(FIN_RUN_PARAM);
    window.history.replaceState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  if (!active) return null;

  // Title + meta mirror the kit's .nb-chat-header pattern.
  const headerTitle = activeRunId ? "Live operator-console run" : "Pick a workflow";
  const headerMeta = activeRunId
    ? "Cards stream live · math runs in JS sandbox · sources cited"
    : `${DEMOS.length} canonical workflows · math sandboxed · approval-gated`;

  return (
    <section
      role="region"
      aria-label="Workspace mode — operator console"
      // Kit-shell layout: header (sticky top), scrollable middle, composer
      // (pinned bottom). Three-row CSS grid keeps everything aligned.
      style={{ backgroundColor: "var(--bg-primary)" }}
      className="fixed inset-0 z-[80] isolate grid grid-rows-[auto_1fr_auto] overflow-hidden"
    >
      {/* ── Header (sticky top) ────────────────────────────────────── */}
      <header
        className="flex flex-wrap items-center gap-3 border-b border-[var(--border-color)] px-4 py-3 sm:px-6"
        style={{ backgroundColor: "var(--bg-primary)" }}
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] text-white"
          style={{ backgroundColor: "var(--accent-primary)" }}
        >
          <Sparkles size={16} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="type-label !tracking-[0.18em] text-[10px]">
            Workspace mode
          </p>
          <h2 className="type-card-title truncate text-[var(--text-primary)]">
            {headerTitle}
          </h2>
        </div>
        <span className="hidden font-mono text-[11px] text-[var(--text-tertiary)] sm:inline">
          {headerMeta}
        </span>
        {activeRunId && (
          <button
            type="button"
            onClick={handleClearRun}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1 text-[12px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40"
            aria-label="Back to workflow picker"
          >
            <ArrowLeft size={14} strokeWidth={1.8} aria-hidden="true" />
            Picker
          </button>
        )}
        <button
          type="button"
          onClick={() => setWorkspaceMode(false)}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1 text-[12px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40"
          aria-label="Close workspace mode"
        >
          <X size={14} strokeWidth={1.8} aria-hidden="true" />
          Close
        </button>
      </header>

      {/* ── Scrollable middle (operator console cards) ─────────────── */}
      <div
        className="overflow-y-auto"
        style={{ backgroundColor: "var(--bg-app, var(--bg-primary))" }}
      >
        <div className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
          {error && (
            <p
              role="alert"
              className="rounded-[10px] border border-[rgba(220,38,38,0.20)] bg-[rgba(220,38,38,0.06)] px-3 py-2 text-[13px] text-[var(--destructive,#DC2626)]"
            >
              {error}
            </p>
          )}

          {!activeRunId && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {DEMOS.map((demo) => {
                const Icon = demo.icon;
                const isPending = pendingDemoId === demo.id;
                return (
                  <button
                    key={demo.id}
                    type="button"
                    onClick={() => handleStart(demo.id)}
                    disabled={pendingDemoId !== null}
                    className="nb-panel group text-left transition-colors hover:!border-[color:color-mix(in_oklab,var(--accent-primary)_30%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className="mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-muted)] group-hover:text-[var(--accent-primary)]"
                      >
                        <Icon size={20} strokeWidth={1.8} />
                      </span>
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="type-card-title text-[var(--text-primary)]">
                            {demo.label}
                          </span>
                          {isPending && (
                            <span className="type-label !tracking-[0.18em] text-[var(--accent-primary)]">
                              starting…
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[13px] leading-[1.5] text-[var(--text-secondary)]">
                          {demo.blurb}
                        </p>
                        <p className="type-label mt-2 !tracking-[0.18em]">
                          {demo.category}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {activeRunId && <FinancialOperatorTimeline runId={activeRunId} />}
        </div>
      </div>

      {/* ── Composer (pinned bottom) ───────────────────────────────── */}
      <WorkspaceComposer
        activeRunId={activeRunId}
        onRunStarted={(id) => setActiveRunId(id)}
      />
    </section>
  );
}
