/**
 * JudgeDashboard — Verdict history and compliance trends per entity.
 *
 * Adapted from reference JudgeDashboardPage for NodeBench:
 * - Diligence grade history per entity (over time)
 * - Signal category coverage (which categories have strong/weak/missing signals)
 * - Remediation completion rate
 * - Compliance trend (improving, stable, regressing)
 */

import { memo } from "react";
import {
  CheckCircle, XCircle, TrendingUp, TrendingDown, Minus,
  Shield, Users, BarChart3, Zap, Target, AlertTriangle,
} from "lucide-react";

// ── Demo Data ────────────────────────────────────────────────────────────

const DEMO_ENTITIES = [
  {
    name: "NodeBench AI",
    searches: 4,
    latestGrade: "early-stage",
    latestConfidence: 85,
    gradeHistory: [
      { date: "Apr 4", grade: "insufficient-data", confidence: 50 },
      { date: "Apr 4", grade: "early-stage", confidence: 85 },
      { date: "Apr 5", grade: "early-stage", confidence: 85 },
      { date: "Apr 6", grade: "early-stage", confidence: 85 },
    ],
    signalCoverage: {
      team_founder: "medium",
      market: "weak",
      product: "strong",
      traction: "missing",
      moat_defensibility: "weak",
      financial_readiness: "weak",
      execution_risk: "medium",
    } as Record<string, string>,
    remediationTotal: 10,
    remediationClosed: 5,
    trend: "improving" as const,
  },
  {
    name: "Stripe",
    searches: 2,
    latestGrade: "investment-ready",
    latestConfidence: 85,
    gradeHistory: [
      { date: "Apr 5", grade: "investment-ready", confidence: 85 },
    ],
    signalCoverage: {
      team_founder: "strong",
      market: "strong",
      product: "strong",
      traction: "strong",
      moat_defensibility: "medium",
      financial_readiness: "strong",
      regulatory_compliance: "medium",
      execution_risk: "medium",
    } as Record<string, string>,
    remediationTotal: 3,
    remediationClosed: 0,
    trend: "stable" as const,
  },
  {
    name: "Tests Assured",
    searches: 3,
    latestGrade: "needs-more-data",
    latestConfidence: 85,
    gradeHistory: [
      { date: "Apr 4", grade: "insufficient-data", confidence: 20 },
      { date: "Apr 5", grade: "needs-more-data", confidence: 85 },
    ],
    signalCoverage: {
      team_founder: "weak",
      product: "medium",
      traction: "missing",
      financial_readiness: "missing",
    } as Record<string, string>,
    remediationTotal: 5,
    remediationClosed: 0,
    trend: "improving" as const,
  },
];

const GRADE_COLORS: Record<string, string> = {
  "investment-ready": "text-emerald-400 bg-emerald-500/15 border-emerald-500/30",
  "needs-more-data": "text-amber-400 bg-amber-500/15 border-amber-500/30",
  "early-stage": "text-blue-400 bg-blue-500/15 border-blue-500/30",
  "high-risk": "text-rose-400 bg-rose-500/15 border-rose-500/30",
  "insufficient-data": "text-zinc-400 bg-zinc-500/15 border-zinc-500/30",
};

const SCORE_COLORS: Record<string, string> = {
  strong: "bg-emerald-500",
  medium: "bg-amber-500",
  weak: "bg-rose-500",
  missing: "bg-zinc-700",
};

const CATEGORY_LABELS: Record<string, string> = {
  team_founder: "Team",
  market: "Market",
  product: "Product",
  traction: "Traction",
  gtm_distribution: "GTM",
  moat_defensibility: "Moat",
  technical_risk: "Tech Risk",
  financial_readiness: "Financial",
  diligence_verifiability: "Diligence",
  regulatory_compliance: "Regulatory",
  strategic_fit: "Strategic",
  execution_risk: "Execution",
};

export const JudgeDashboard = memo(function JudgeDashboard() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
          Diligence Verdicts
        </div>
        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
          demo data
        </span>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-content-muted">Entities Tracked</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-content">{DEMO_ENTITIES.length}</div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-content-muted">Total Searches</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-content">
            {DEMO_ENTITIES.reduce((s, e) => s + e.searches, 0)}
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-content-muted">Gaps Closed</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-400">
            {DEMO_ENTITIES.reduce((s, e) => s + e.remediationClosed, 0)}/{DEMO_ENTITIES.reduce((s, e) => s + e.remediationTotal, 0)}
          </div>
        </div>
      </div>

      {/* Entity Cards */}
      {DEMO_ENTITIES.map((entity) => (
        <div key={entity.name} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-content">{entity.name}</div>
              <div className="text-[10px] text-content-muted">{entity.searches} searches</div>
            </div>
            <div className="flex items-center gap-2">
              <TrendIcon trend={entity.trend} />
              <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${GRADE_COLORS[entity.latestGrade] ?? GRADE_COLORS["insufficient-data"]}`}>
                {entity.latestGrade.replace(/-/g, " ").toUpperCase()}
              </span>
            </div>
          </div>

          {/* Grade History */}
          <div className="mt-3">
            <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-content-muted mb-1">
              Grade History
            </div>
            <div className="flex gap-1">
              {entity.gradeHistory.map((h, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded px-1.5 py-1 text-center text-[9px] ${GRADE_COLORS[h.grade] ?? GRADE_COLORS["insufficient-data"]}`}
                  title={`${h.date}: ${h.grade} (${h.confidence}%)`}
                >
                  {h.confidence}%
                </div>
              ))}
            </div>
          </div>

          {/* Signal Coverage Bar */}
          <div className="mt-3">
            <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-content-muted mb-1">
              Signal Coverage
            </div>
            <div className="flex gap-0.5">
              {Object.entries(entity.signalCoverage).map(([cat, score]) => (
                <div
                  key={cat}
                  className={`h-3 flex-1 rounded-sm ${SCORE_COLORS[score] ?? SCORE_COLORS.missing}`}
                  title={`${CATEGORY_LABELS[cat] ?? cat}: ${score}`}
                />
              ))}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              {Object.entries(entity.signalCoverage).map(([cat, score]) => (
                <span key={cat} className="text-[8px] text-content-muted">
                  {CATEGORY_LABELS[cat] ?? cat}: <span className={score === "strong" ? "text-emerald-400" : score === "medium" ? "text-amber-400" : score === "weak" ? "text-rose-400" : "text-zinc-500"}>{score}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Remediation Progress */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-[9px]">
              <span className="font-semibold uppercase tracking-[0.1em] text-content-muted">Remediation</span>
              <span className="tabular-nums text-content-muted">
                {entity.remediationClosed}/{entity.remediationTotal} closed
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-white/[0.04]">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${entity.remediationTotal > 0 ? (entity.remediationClosed / entity.remediationTotal) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
});

function TrendIcon({ trend }: { trend: "improving" | "stable" | "regressing" }) {
  if (trend === "improving") return <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />;
  if (trend === "regressing") return <TrendingDown className="h-3.5 w-3.5 text-rose-400" />;
  return <Minus className="h-3.5 w-3.5 text-content-muted" />;
}

export default JudgeDashboard;
