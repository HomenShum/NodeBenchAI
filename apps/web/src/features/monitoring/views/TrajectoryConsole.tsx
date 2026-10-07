/**
 * TrajectoryConsole — NodeBench's trajectory evidence console.
 *
 * Adapted from the reference UI (homen-ta/test) for founder intelligence:
 * - What the agent tried, saw, thought, called, and concluded
 * - Signal taxonomy classification with controlled vocabulary
 * - Workflow compliance (required steps vs completed)
 * - Judge verdict + savings
 * - Nudge events as first-class timeline items
 *
 * Layout:
 *   Top header: run metadata (entity, lens, model, cost, time, verdict)
 *   Left rail: step timeline (numbered, icons for tool/thought/nudge)
 *   Center: selected step detail (tool call, result, evidence)
 *   Right rail: workflow checklist + classified signals + verdict
 */

import { memo, useCallback, useEffect, useState } from "react";
import {
  CheckCircle, XCircle, Clock, Zap, Search, Brain, Shield,
  AlertTriangle, ChevronRight, BarChart3, Users, Target,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────

interface TraceStep {
  step: string;
  tool?: string;
  status: string;
  detail?: string;
  durationMs?: number;
  startedAt: number;
}

interface ClassifiedSignal {
  signal_id: string;
  category: string;
  label: string;
  score: string;
  confidence: number;
  summary: string;
  repeat_count: number;
  needs_review: boolean;
}

interface SearchSession {
  _id: string;
  query: string;
  lens: string;
  status: string;
  trace: TraceStep[];
  classification?: { type: string; entity?: string };
  result?: {
    entityName?: string;
    confidence?: number;
    classifiedSignals?: ClassifiedSignal[];
    signals?: Array<{ title: string; body: string; confidence: number }>;
    risks?: Array<{ title: string; body: string }>;
    diligenceGrade?: string;
    researchDepth?: { totalSearches: number; maxDepth: number; totalFindings: number; totalSources: number };
    remediation?: Array<{ gap: string; severity: string; action: string; effort: string }>;
    seoAudit?: { score: number; issues: string[] };
    missingPresence?: string[];
    nextQuestions?: string[];
  };
  startedAt: number;
  completedAt?: number;
}

interface TrajectoryConsoleProps {
  session: SearchSession | null;
}

// ── Score Colors ─────────────────────────────────────────────────────────

const SCORE_COLORS: Record<string, string> = {
  strong: "text-emerald-400",
  medium: "text-amber-400",
  weak: "text-rose-400",
  missing: "text-zinc-500",
  contradicted: "text-red-500",
};

const SCORE_BG: Record<string, string> = {
  strong: "bg-emerald-500/15",
  medium: "bg-amber-500/15",
  weak: "bg-rose-500/15",
  missing: "bg-zinc-500/15",
  contradicted: "bg-red-500/15",
};

const CATEGORY_ICONS: Record<string, typeof Users> = {
  team_founder: Users,
  market: BarChart3,
  product: Zap,
  traction: BarChart3,
  gtm_distribution: Target,
  moat_defensibility: Shield,
  technical_risk: AlertTriangle,
  financial_readiness: BarChart3,
  diligence_verifiability: CheckCircle,
  regulatory_compliance: Shield,
  strategic_fit: Target,
  execution_risk: Zap,
};

// ── Main Component ───────────────────────────────────────────────────────

export const TrajectoryConsole = memo(function TrajectoryConsole({ session }: TrajectoryConsoleProps) {
  const [selectedStep, setSelectedStep] = useState<number>(0);

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-content-muted">
        No session selected. Run a search to see the trajectory.
      </div>
    );
  }

  const r = session.result;
  const trace = session.trace ?? [];
  const signals = r?.classifiedSignals ?? [];
  const depth = r?.researchDepth;
  const durationMs = session.completedAt ? session.completedAt - session.startedAt : 0;
  const durationS = (durationMs / 1000).toFixed(1);

  // Workflow compliance checklist
  const workflowSteps = [
    { label: "Entity resolution", done: !!session.classification?.entity },
    { label: "People research", done: (r as any)?.people?.length > 0 },
    { label: "Timeline research", done: (r as any)?.timeline?.length > 0 },
    { label: "Financial research", done: (r as any)?.financialMetrics?.length > 0 },
    { label: "Competitive research", done: (r as any)?.competitiveLandscape?.length > 0 },
    { label: "Product research", done: (r as any)?.productIntelligence?.length > 0 },
    { label: "Risk analysis", done: (r as any)?.diligenceFlags?.length > 0 },
    { label: "Signal classification", done: signals.length > 0 },
    { label: "Gap remediation", done: (r?.remediation?.length ?? 0) > 0 },
    { label: "SEO audit", done: r?.seoAudit?.score !== undefined },
  ];
  const completedSteps = workflowSteps.filter((s) => s.done).length;

  return (
    <div className="flex h-full flex-col gap-0 overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.01]">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 border-b border-white/[0.06] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-content">
            {r?.entityName ?? session.query}
          </div>
          <div className="text-[10px] text-content-muted">
            {session.lens} lens · {session.classification?.type ?? "unknown"}
          </div>
        </div>
        <MetricPill label="Time" value={`${durationS}s`} />
        <MetricPill label="Sources" value={String(depth?.totalSources ?? 0)} />
        <MetricPill label="Findings" value={String(depth?.totalFindings ?? 0)} />
        <MetricPill label="Depth" value={String(depth?.maxDepth ?? 0)} />
        <MetricPill
          label="Confidence"
          value={`${r?.confidence ?? 0}%`}
          highlight={(r?.confidence ?? 0) >= 70}
        />
        <VerdictBadge grade={r?.diligenceGrade} />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left Rail: Step Timeline ───────────────────────────── */}
        <div className="w-56 shrink-0 overflow-y-auto border-r border-white/[0.06] py-2">
          {trace.map((step, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSelectedStep(i)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                selectedStep === i
                  ? "bg-white/[0.06] text-content"
                  : "text-content-muted hover:bg-white/[0.03] hover:text-content-secondary"
              }`}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/[0.1] text-[9px] tabular-nums">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{step.tool ?? step.step}</div>
                {step.detail && (
                  <div className="truncate text-[10px] text-content-muted">{step.detail.slice(0, 40)}</div>
                )}
              </div>
              <StepStatusIcon status={step.status} />
            </button>
          ))}
        </div>

        {/* ── Center: Step Detail ────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4">
          {trace[selectedStep] ? (
            <StepDetail step={trace[selectedStep]} index={selectedStep} />
          ) : (
            <div className="text-sm text-content-muted">Select a step from the timeline.</div>
          )}

          {/* Classified Signals (below step detail) */}
          {signals.length > 0 && (
            <div className="mt-6">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                Classified Signals ({signals.length})
              </div>
              <div className="mt-2 flex flex-col gap-1.5">
                {signals.map((s, i) => {
                  const Icon = CATEGORY_ICONS[s.category] ?? Search;
                  return (
                    <div
                      key={i}
                      className={`rounded-lg border border-white/[0.06] px-3 py-2 ${SCORE_BG[s.score] ?? "bg-white/[0.02]"}`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className={`h-3.5 w-3.5 ${SCORE_COLORS[s.score] ?? "text-content-muted"}`} />
                        <span className="text-xs font-medium text-content">{s.label}</span>
                        <span className={`text-[10px] font-semibold ${SCORE_COLORS[s.score]}`}>
                          {s.score.toUpperCase()}
                        </span>
                        <span className="ml-auto text-[10px] tabular-nums text-content-muted">
                          {Math.round(s.confidence * 100)}% · {s.repeat_count}x
                        </span>
                        {s.needs_review && (
                          <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[8px] font-semibold text-amber-400">
                            REVIEW
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[11px] leading-relaxed text-content-secondary">
                        {s.summary.slice(0, 200)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Right Rail: Workflow + Verdict ─────────────────────── */}
        <div className="w-56 shrink-0 overflow-y-auto border-l border-white/[0.06] p-3">
          {/* Workflow Compliance */}
          <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-content-muted">
            Workflow Compliance
          </div>
          <div className="mt-1 text-lg font-bold tabular-nums text-content">
            {completedSteps}/{workflowSteps.length}
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {workflowSteps.map((ws, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                {ws.done ? (
                  <CheckCircle className="h-3 w-3 text-emerald-400" />
                ) : (
                  <XCircle className="h-3 w-3 text-zinc-600" />
                )}
                <span className={ws.done ? "text-content-secondary" : "text-content-muted"}>
                  {ws.label}
                </span>
              </div>
            ))}
          </div>

          {/* Remediation Summary */}
          {r?.remediation && r.remediation.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-content-muted">
                Remediation ({r.remediation.length})
              </div>
              <div className="mt-2 flex flex-col gap-1">
                {r.remediation.slice(0, 5).map((item, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[10px]">
                    <SeverityDot severity={item.severity} />
                    <span className="text-content-secondary">{item.gap}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SEO Audit */}
          {r?.seoAudit && (
            <div className="mt-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-content-muted">
                SEO Score
              </div>
              <div className={`mt-1 text-lg font-bold tabular-nums ${
                r.seoAudit.score >= 70 ? "text-emerald-400" : r.seoAudit.score >= 50 ? "text-amber-400" : "text-rose-400"
              }`}>
                {r.seoAudit.score}/100
              </div>
            </div>
          )}

          {/* Follow-up Questions */}
          {r?.nextQuestions && r.nextQuestions.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-content-muted">
                Follow-ups
              </div>
              <div className="mt-2 flex flex-col gap-1.5">
                {r.nextQuestions.slice(0, 3).map((q, i) => (
                  <div key={i} className="text-[10px] leading-relaxed text-content-muted">
                    {q.slice(0, 80)}...
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// ── Sub-Components ───────────────────────────────────────────────────────

function MetricPill({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border px-2.5 py-1 ${highlight ? "border-[#d97757]/30 bg-[#d97757]/10" : "border-white/[0.06] bg-white/[0.02]"}`}>
      <div className="text-[8px] font-semibold uppercase tracking-[0.1em] text-content-muted">{label}</div>
      <div className={`text-xs font-bold tabular-nums ${highlight ? "text-[#d97757]" : "text-content"}`}>{value}</div>
    </div>
  );
}

function VerdictBadge({ grade }: { grade?: string }) {
  if (!grade) return null;
  const colors: Record<string, string> = {
    "investment-ready": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    "needs-more-data": "bg-amber-500/15 text-amber-400 border-amber-500/30",
    "early-stage": "bg-blue-500/15 text-blue-400 border-blue-500/30",
    "high-risk": "bg-rose-500/15 text-rose-400 border-rose-500/30",
    "insufficient-data": "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  };
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${colors[grade] ?? colors["insufficient-data"]}`}>
      {grade.replace(/-/g, " ").toUpperCase()}
    </span>
  );
}

function StepStatusIcon({ status }: { status: string }) {
  if (status === "ok") return <CheckCircle className="h-3 w-3 text-emerald-400" />;
  if (status === "error") return <XCircle className="h-3 w-3 text-rose-400" />;
  return <Clock className="h-3 w-3 text-content-muted" />;
}

function StepDetail({ step, index }: { step: TraceStep; index: number }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.06] text-[10px] font-bold tabular-nums text-content">
          {index + 1}
        </span>
        <span className="text-sm font-semibold text-content">{step.step}</span>
        {step.tool && (
          <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-content-secondary">
            {step.tool}
          </span>
        )}
        <StepStatusIcon status={step.status} />
        {step.durationMs !== undefined && (
          <span className="ml-auto text-[10px] tabular-nums text-content-muted">
            {step.durationMs}ms
          </span>
        )}
      </div>
      {step.detail && (
        <div className="mt-2 rounded-lg bg-black/20 p-3 font-mono text-[11px] leading-relaxed text-content-secondary">
          {step.detail}
        </div>
      )}
    </div>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: "bg-red-500",
    high: "bg-orange-500",
    medium: "bg-amber-500",
    low: "bg-zinc-500",
  };
  return <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${colors[severity] ?? "bg-zinc-500"}`} />;
}

export default TrajectoryConsole;
