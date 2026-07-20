/**
 * HyperLoopDashboard — Visualize archive quality improvements over time.
 *
 * Shows: archive stats, improvement@k curve, top variants, promotion timeline.
 * Fetches from /api/hyperloop/stats endpoint.
 */

import { useState, useEffect, useCallback } from "react";
import { TrendingUp, Archive, Star, ArrowUpRight, RefreshCw, Zap, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────

interface ArchiveStats {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  avgQuality: number;
}

interface EvalEntry {
  evalId: string;
  query: string;
  classification: string;
  qualityScore: number;
  improvementDelta: number;
  evidenceCoverage: number;
  groundingRate: number;
  latencyMs: number;
  toolCallCount: number;
  timestamp: string;
  rubricVersion: string;
  policyAction: "archive_only" | "candidate";
  scoreComponents: Array<{
    key: string;
    label: string;
    weight: number;
    rawValue: number;
    normalizedScore: number;
    weightedContribution: number;
    detail: string;
  }>;
  gates: Array<{
    key: string;
    label: string;
    passed: boolean;
    critical: boolean;
    reason: string;
  }>;
  llmJudge?: {
    verdict: string;
    score?: string;
    failingCriteria: string[];
    fixSuggestions: string[];
    reasoningSummary: string;
  };
}

interface ImprovementPoint {
  k: number;
  avgQuality: number;
  avgImprovement: number;
  sampleSize: number;
}

interface HyperLoopData {
  archive: ArchiveStats;
  recentEvals: EvalEntry[];
  improvementCurve: Record<string, ImprovementPoint[]>;
}

// ─── Fetch hook ──────────────────────────────────────────────────

function useHyperLoopData() {
  const [data, setData] = useState<HyperLoopData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 5000);
    try {
      const resp = await fetch("/api/hyperloop/stats", { signal: controller.signal });
      if (resp.ok) {
        setData(await resp.json());
      } else {
        setError(`Failed to load HyperLoop stats (${resp.status})`);
      }
    } catch {
      setError("HyperLoop stats are unavailable right now.");
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, error, refresh };
}

// ─── Sparkline (inline SVG) ──────────────────────────────────────

function QualitySparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 0.01);
  const w = 120;
  const h = 32;
  const polylinePoints = points
    .map((v, i) => `${(i / (points.length - 1)) * w},${h - (v / max) * h}`)
    .join(" ");

  return (
    <svg width={w} height={h} className="inline-block">
      <polyline
        points={polylinePoints}
        fill="none"
        stroke="var(--accent-primary)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Stat card ───────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: typeof TrendingUp;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", color ?? "text-accent-primary")} />
        <span className="text-[10px] font-medium uppercase tracking-wider text-content-muted">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-content">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-content-muted">{sub}</div>}
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────

export function HyperLoopDashboard() {
  const { data, loading, error, refresh } = useHyperLoopData();

  // Demo data when API isn't connected
  const archive = data?.archive ?? { total: 0, byType: {}, byStatus: {}, avgQuality: 0 };
  const recentEvals = data?.recentEvals ?? [];
  const improvementCurve = data?.improvementCurve ?? {};

  const promoted = archive.byStatus?.promoted ?? 0;
  const validated = archive.byStatus?.validated ?? 0;
  const candidates = archive.byStatus?.candidate ?? 0;

  // Build quality sparkline from recent evals
  const qualityPoints = recentEvals.map((e) => e.qualityScore);
  const latestEval = recentEvals[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-content">HyperLoop</h3>
          <p className="text-[11px] text-content-muted">Archive-based self-improvement — quality metrics over time</p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-content-muted hover:bg-white/[0.06] hover:text-content"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Archive} label="Archive size" value={archive.total} sub={`${promoted} promoted, ${validated} validated`} />
        <StatCard icon={Star} label="Avg quality" value={`${Math.round(archive.avgQuality * 100)}%`} sub="Weighted composite score" color={archive.avgQuality > 0.7 ? "text-emerald-400" : "text-amber-400"} />
        <StatCard icon={Zap} label="Evaluations" value={recentEvals.length} sub="Tasks evaluated" />
        <StatCard icon={ShieldCheck} label="Candidates" value={candidates} sub="Awaiting validation" />
      </div>

      {/* Quality over time */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-medium uppercase tracking-wider text-content-muted">Quality trend</div>
          <QualitySparkline points={qualityPoints} />
        </div>

        {error ? (
          <p className="mt-4 text-center text-xs text-content-muted">{error}</p>
        ) : recentEvals.length === 0 ? (
          <p className="mt-4 text-center text-xs text-content-muted">
            No evaluations yet. Search for a company to start the improvement loop.
          </p>
        ) : (
          <div className="mt-3 space-y-1.5">
            {recentEvals.slice(0, 8).map((ev) => (
              <div key={ev.evalId} className="flex items-center gap-3 text-[12px]">
                <span className="w-12 shrink-0 text-right tabular-nums text-content-muted">
                  {Math.round(ev.qualityScore * 100)}%
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      ev.qualityScore >= 0.7 ? "bg-emerald-500" : ev.qualityScore >= 0.4 ? "bg-amber-500" : "bg-rose-500",
                    )}
                    style={{ width: `${ev.qualityScore * 100}%` }}
                  />
                </div>
                <span className={cn(
                  "w-10 shrink-0 text-right tabular-nums text-[11px]",
                  ev.improvementDelta > 0 ? "text-emerald-400" : ev.improvementDelta < 0 ? "text-rose-400" : "text-content-muted",
                )}>
                  {ev.improvementDelta > 0 ? "+" : ""}{Math.round(ev.improvementDelta * 100)}%
                </span>
                <span className="min-w-0 flex-1 truncate text-content-muted" title={ev.query}>
                  {ev.query.slice(0, 40)}
                </span>
                <span className="shrink-0 text-[10px] text-content-muted/50">
                  {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Improvement@k by classification */}
      {Object.keys(improvementCurve).length > 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-content-muted">
            Improvement@k by query type
          </div>
          <div className="mt-3 space-y-3">
            {Object.entries(improvementCurve).map(([classification, points]) => (
              <div key={classification}>
                <div className="flex items-center gap-2">
                  <ArrowUpRight className="h-3 w-3 text-accent-primary" />
                  <span className="text-[12px] font-medium text-content">{classification}</span>
                  <QualitySparkline points={points.map((p) => p.avgQuality)} />
                </div>
                <div className="ml-5 mt-1 flex gap-3">
                  {points.map((p) => (
                    <span key={p.k} className="text-[10px] tabular-nums text-content-muted">
                      k={p.k}: {Math.round(p.avgQuality * 100)}% ({p.sampleSize}n)
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Human-debuggable rubric */}
      {latestEval && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-content-muted">Judge breakdown</div>
              <div className="mt-1 text-sm font-medium text-content">
                {latestEval.query}
                <span className="ml-2 text-[11px] font-normal uppercase tracking-[0.14em] text-content-muted">
                  {latestEval.rubricVersion}
                </span>
              </div>
            </div>
            <div className={cn(
              "rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em]",
              latestEval.policyAction === "candidate"
                ? "bg-emerald-500/10 text-emerald-300"
                : "bg-amber-500/10 text-amber-300",
            )}>
              {latestEval.policyAction === "candidate" ? "Archive candidate" : "Archive only"}
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1.35fr_0.95fr]">
            <div className="space-y-2">
              <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-content-muted">Score components</div>
              {latestEval.scoreComponents.map((component) => (
                <div key={component.key} className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium text-content">{component.label}</div>
                      <div className="mt-0.5 text-[11px] text-content-muted">{component.detail}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[12px] font-semibold tabular-nums text-content">
                        {Math.round(component.weightedContribution * 100)} pts
                      </div>
                      <div className="text-[10px] tabular-nums text-content-muted">
                        raw {typeof component.rawValue === "number" && component.rawValue <= 1
                          ? `${Math.round(component.rawValue * 100)}%`
                          : component.rawValue}
                        {" · "}weight {Math.round(component.weight * 100)}%
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-content-muted">Deterministic gates</div>
                <div className="mt-2 space-y-2">
                  {latestEval.gates.map((gate) => (
                    <div key={gate.key} className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[12px] font-medium text-content">{gate.label}</div>
                        <div className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em]",
                          gate.passed ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300",
                        )}>
                          {gate.passed ? "Pass" : "Fail"}
                        </div>
                      </div>
                      <div className="mt-1 text-[11px] text-content-muted">
                        {gate.reason}
                        {gate.critical ? " Critical gate." : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {latestEval.llmJudge && (
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-content-muted">LLM judge</div>
                  <div className="mt-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[12px] font-medium text-content">{latestEval.llmJudge.verdict}</div>
                      {latestEval.llmJudge.score ? (
                        <div className="text-[11px] tabular-nums text-content-muted">{latestEval.llmJudge.score}</div>
                      ) : null}
                    </div>
                    <div className="mt-1 text-[11px] text-content-muted">{latestEval.llmJudge.reasoningSummary}</div>
                    {latestEval.llmJudge.fixSuggestions.length > 0 ? (
                      <div className="mt-2 text-[11px] text-content-muted">
                        Fixes: {latestEval.llmJudge.fixSuggestions.join("; ")}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Archive breakdown by type */}
      {archive.total > 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-content-muted">Archive by type</div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(archive.byType).map(([type, count]) => (
              <div key={type} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2">
                <span className="text-[11px] text-content-muted">{type.replace(/_/g, " ")}</span>
                <span className="text-[12px] font-medium tabular-nums text-content">{count as number}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default HyperLoopDashboard;
