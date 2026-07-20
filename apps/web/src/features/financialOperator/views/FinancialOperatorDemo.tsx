/**
 * Financial Operator Console — demo surface.
 *
 * Built on the kit's canonical surface utilities (per
 * docs/architecture/FINANCIAL_OPERATOR_DESIGN_ALIGNMENT.md):
 *   - `.nb-panel-soft` for the workflow-picker tiles
 *   - `.type-page-title` / `.type-body` / `.type-label` for type
 *   - `.btn-primary-sm` / `.btn-ghost-sm` for actions
 *   - `var(--accent-primary)` for the terracotta accent (no raw hex)
 *
 * No new design tokens were introduced; every class on this page already
 * existed in src/index.css before this surface was built. This page
 * sits *inside* the existing UI kit, not next to it.
 */

import { useState } from "react";
import { useAction } from "convex/react";
import {
  Calculator,
  FileSpreadsheet,
  ScrollText,
  TrendingUp,
  MessageSquare,
} from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { FinancialOperatorTimeline } from "../components/FinancialOperatorTimeline";
import { setActiveFinancialRun } from "../components/FinancialOperatorOverlay";
import { ModelCapabilityBadge } from "../components/ModelCapabilityBadge";

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
    blurb:
      "Locate filing sections, extract structured values, run sandbox math, gather sources, draft a notebook + PR.",
    icon: Calculator,
    category: "Financial metric extraction",
  },
  {
    id: "crm",
    label: "CRM cleanup",
    blurb:
      "Profile a 387-row prospect list, dedupe by name + domain, enrich with sector/HQ/last round, export CRM-ready CSV.",
    icon: FileSpreadsheet,
    category: "Data cleanup",
  },
  {
    id: "covenant",
    label: "Covenant compliance",
    blurb:
      "Locate the leverage covenant, extract terms + financials, run a sandbox compliance gate, draft a reviewer memo.",
    icon: ScrollText,
    category: "Credit-agreement review",
  },
  {
    id: "variance",
    label: "Variance analysis",
    blurb:
      "Align chart of accounts, compute per-line variance in sandbox, surface drivers, draft a CFO summary.",
    icon: TrendingUp,
    category: "Monthly close",
  },
];

// Active orchestration model. The orchestrator currently calls Claude
// Opus 4.7 for the real-PDF extractor; the fixture-based demos use no
// LLM at all (deterministic mock data + JS sandbox math). When a real
// PDF run is triggered, this is the model the agent reaches for.
const ACTIVE_MODEL = "claude-opus-4-7";

export function FinancialOperatorDemo() {
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

  const [activeRunId, setActiveRunId] =
    useState<Id<"financialOperatorRuns"> | null>(null);
  const [activeDemoId, setActiveDemoId] = useState<DemoId | null>(null);
  const [pendingDemoId, setPendingDemoId] = useState<DemoId | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleStart(demo: DemoOption) {
    setPendingDemoId(demo.id);
    setError(null);
    try {
      let result: { runId: Id<"financialOperatorRuns"> };
      switch (demo.id) {
        case "att":      result = await runAtt({}); break;
        case "crm":      result = await runCrm({}); break;
        case "covenant": result = await runCovenant({}); break;
        case "variance": result = await runVariance({}); break;
      }
      setActiveRunId(result.runId);
      setActiveDemoId(demo.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start run");
    } finally {
      setPendingDemoId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <header className="space-y-3">
        <p className="type-label !tracking-[0.18em]">
          Financial operator console — demo
        </p>
        <h1 className="type-page-title text-[var(--text-primary)]">
          Watch the agent show its work
        </h1>
        <p className="type-body text-[var(--text-secondary)]">
          Four canonical financial workflows. Each one streams typed cards
          (plan → tool calls → extraction → validation → sandbox calculation →
          evidence → artifact → approval) so users see observable work, not
          hidden reasoning. Math runs in JavaScript, never in the language
          model.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <ModelCapabilityBadge model={ACTIVE_MODEL} />
        </div>
      </header>

      <section
        aria-label="Pick a workflow"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {DEMOS.map((demo) => {
          const Icon = demo.icon;
          const isActive = activeDemoId === demo.id;
          const isPending = pendingDemoId === demo.id;
          return (
            <button
              key={demo.id}
              type="button"
              onClick={() => handleStart(demo)}
              disabled={pendingDemoId !== null}
              aria-pressed={isActive}
              className={[
                "nb-panel group text-left transition-colors",
                "hover:!border-[color:color-mix(in_oklab,var(--accent-primary)_30%,transparent)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40",
                "disabled:cursor-not-allowed disabled:opacity-60",
                isActive
                  ? "!border-[color:color-mix(in_oklab,var(--accent-primary)_40%,transparent)] !bg-[var(--accent-primary-bg)]"
                  : "",
              ].join(" ")}
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={[
                    "mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[10px] border",
                    isActive
                      ? "border-[color:color-mix(in_oklab,var(--accent-primary)_30%,transparent)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]"
                      : "border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-muted)] group-hover:text-[var(--accent-primary)]",
                  ].join(" ")}
                >
                  <Icon size={20} strokeWidth={1.8} />
                </span>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="type-card-title text-[var(--text-primary)]">
                      {demo.label}
                    </span>
                    {isPending && (
                      <span className="type-label !tracking-[0.18em]">
                        starting…
                      </span>
                    )}
                    {isActive && !isPending && (
                      <span className="type-label !tracking-[0.18em] text-[var(--accent-primary)]">
                        running
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
      </section>

      {error && (
        <p
          role="alert"
          className="rounded-[10px] border border-[rgba(220,38,38,0.20)] bg-[rgba(220,38,38,0.06)] px-3 py-2 text-[13px] text-[var(--destructive,#DC2626)]"
        >
          {error}
        </p>
      )}

      {activeRunId && (
        <section className="space-y-3" aria-label="Live run">
          <div className="flex items-center gap-2">
            <span className="type-label !tracking-[0.18em]">Live run</span>
            <button
              type="button"
              onClick={() => {
                setActiveFinancialRun(activeRunId);
                if (typeof window !== "undefined") {
                  window.location.assign(`/?surface=ask&finRun=${activeRunId}`);
                }
              }}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1 text-[12px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40"
              aria-label="View this run in the chat surface"
            >
              <MessageSquare size={14} strokeWidth={1.8} aria-hidden="true" />
              View in chat
            </button>
          </div>
          <FinancialOperatorTimeline runId={activeRunId} />
        </section>
      )}

      {!activeRunId && (
        <section
          aria-label="Empty state"
          className="rounded-[12px] border border-dashed border-[var(--border-color)] bg-[var(--bg-secondary)]/50 px-4 py-6 text-center"
        >
          <p className="text-[13px] text-[var(--text-muted)]">
            Pick a workflow above to start a live run. Each step appears as a
            typed card.
          </p>
        </section>
      )}
    </main>
  );
}

export default FinancialOperatorDemo;
