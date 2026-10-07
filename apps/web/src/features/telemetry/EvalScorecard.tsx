/**
 * EvalScorecard — Eval run results visualization.
 *
 * Shows latest eval run: pass rate, criteria rate, per-scenario breakdown
 * as mini bar chart, and 5-run history trend. Uses glass card DNA.
 */

import { memo } from "react";
import { BarChart3, CheckCircle2, TrendingUp, XCircle } from "lucide-react";
import type { EvalRunResult, EvalScorecardData } from "./types";

/* ─── Percentage ring ────────────────────────────────────────────────────── */

function PercentRing({
  value,
  label,
  size = 64,
}: {
  value: number;
  label: string;
  size?: number;
}) {
  const pct = Math.round(value * 100);
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - value);
  const color =
    pct >= 90
      ? "stroke-emerald-400"
      : pct >= 70
        ? "stroke-amber-400"
        : "stroke-rose-400";

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={4}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className={color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.6s ease-out" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span className="font-mono text-sm font-bold text-white/90 tabular-nums">
          {pct}%
        </span>
      </div>
      <span className="text-[10px] uppercase tracking-[0.15em] text-white/30 mt-0.5">
        {label}
      </span>
    </div>
  );
}

/* ─── Scenario bar chart ─────────────────────────────────────────────────── */

function ScenarioBarChart({
  scenarios,
}: {
  scenarios: EvalRunResult["byScenario"];
}) {
  if (scenarios.length === 0) return null;

  const maxTotal = Math.max(...scenarios.map((s) => s.totalCount), 1);

  return (
    <div className="space-y-1.5">
      {scenarios.map((s) => {
        const pct = Math.round(s.passRate * 100);
        const barColor =
          pct >= 90
            ? "bg-emerald-400/70"
            : pct >= 70
              ? "bg-amber-400/70"
              : "bg-rose-400/70";
        return (
          <div key={s.scenario} className="flex items-center gap-2">
            <span className="text-[10px] text-white/40 w-28 truncate shrink-0 text-right">
              {s.scenario.replace(/_/g, " ")}
            </span>
            <div className="flex-1 h-3 rounded-full bg-white/[0.04] overflow-hidden">
              <div
                className={`h-full rounded-full ${barColor} transition-all duration-500`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="font-mono text-[10px] tabular-nums text-white/50 w-8 text-right">
              {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── History trend sparkline ────────────────────────────────────────────── */

function HistoryTrend({ runs }: { runs: EvalRunResult[] }) {
  if (runs.length < 2) return null;

  const rates = runs.map((r) => r.passRate);
  const max = Math.max(...rates, 1);
  const min = Math.min(...rates, 0);
  const range = max - min || 0.1;

  // SVG sparkline
  const width = 180;
  const height = 36;
  const padding = 4;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;

  const points = rates.map((r, i) => {
    const x = padding + (i / (rates.length - 1)) * usableWidth;
    const y = padding + (1 - (r - min) / range) * usableHeight;
    return `${x},${y}`;
  });

  const latestRate = rates[rates.length - 1];
  const prevRate = rates[rates.length - 2];
  const delta = latestRate - prevRate;
  const deltaColor = delta >= 0 ? "text-emerald-400" : "text-rose-400";
  const deltaSign = delta >= 0 ? "+" : "";

  return (
    <div className="flex items-center gap-3">
      <svg width={width} height={height} className="shrink-0">
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="rgba(217,119,87,0.6)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Dots */}
        {rates.map((r, i) => {
          const x = padding + (i / (rates.length - 1)) * usableWidth;
          const y = padding + (1 - (r - min) / range) * usableHeight;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={2.5}
              fill={i === rates.length - 1 ? "#d97757" : "rgba(255,255,255,0.2)"}
            />
          );
        })}
      </svg>
      <div className="flex flex-col">
        <span className={`font-mono text-xs font-semibold tabular-nums ${deltaColor}`}>
          {deltaSign}{(delta * 100).toFixed(1)}%
        </span>
        <span className="text-[9px] text-white/25">vs prev</span>
      </div>
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */

export interface EvalScorecardProps {
  data: EvalScorecardData;
  className?: string;
}

export const EvalScorecard = memo(function EvalScorecard({
  data,
  className = "",
}: EvalScorecardProps) {
  const { latest, history } = data;
  const pctPass = Math.round(latest.passRate * 100);
  const pctCriteria = Math.round(latest.criteriaRate * 100);

  return (
    <div
      className={`rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-white/[0.04]">
        <BarChart3 className="h-4 w-4 text-[#d97757]" aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40 flex-1">
          Eval Scorecard
        </span>
        <span className="text-[10px] text-white/20">
          {new Date(latest.timestamp).toLocaleDateString()} &middot;{" "}
          {latest.totalQueries} queries
        </span>
      </div>

      <div className="px-5 py-4 space-y-5">
        {/* Top-level metrics */}
        <div className="flex items-center gap-6">
          <div className="relative">
            <PercentRing value={latest.passRate} label="Pass Rate" size={72} />
          </div>
          <div className="relative">
            <PercentRing value={latest.criteriaRate} label="Criteria" size={72} />
          </div>
          <div className="flex-1 space-y-2 pl-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-xs text-white/60">
                {Math.round(latest.passRate * latest.totalQueries)} / {latest.totalQueries} passed
              </span>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="h-3.5 w-3.5 text-rose-400/60" />
              <span className="text-xs text-white/40">
                {latest.totalQueries - Math.round(latest.passRate * latest.totalQueries)} failed
              </span>
            </div>
          </div>
        </div>

        {/* Per-scenario breakdown */}
        {latest.byScenario.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-white/25 mb-2">
              By Scenario
            </div>
            <ScenarioBarChart scenarios={latest.byScenario} />
          </div>
        )}

        {/* History trend */}
        {history.length >= 2 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingUp className="h-3 w-3 text-white/25" />
              <span className="text-[10px] uppercase tracking-[0.15em] text-white/25">
                Last {history.length} Runs
              </span>
            </div>
            <HistoryTrend runs={history} />
          </div>
        )}
      </div>
    </div>
  );
});

/* ─── Demo data factory ──────────────────────────────────────────────────── */

export function createDemoEvalData(): EvalScorecardData {
  const scenarios = [
    "weekly_reset",
    "important_change",
    "company_search",
    "competitor",
    "multi_entity",
    "pre_delegation",
    "memo_export",
    "packet_diff",
  ];

  const latest: EvalRunResult = {
    runId: "eval-2026-03-24-001",
    timestamp: new Date().toISOString(),
    passRate: 0.9,
    criteriaRate: 0.85,
    totalQueries: 500,
    byScenario: scenarios.map((s) => ({
      scenario: s,
      passCount: Math.floor(40 + Math.random() * 23),
      totalCount: 53,
      passRate: 0.7 + Math.random() * 0.3,
    })),
  };

  const history: EvalRunResult[] = [
    { ...latest, runId: "eval-001", passRate: 0.435, criteriaRate: 0.4, timestamp: new Date(Date.now() - 4 * 86_400_000).toISOString(), byScenario: [] },
    { ...latest, runId: "eval-002", passRate: 0.82, criteriaRate: 0.75, timestamp: new Date(Date.now() - 3 * 86_400_000).toISOString(), byScenario: [] },
    { ...latest, runId: "eval-003", passRate: 0.928, criteriaRate: 0.88, timestamp: new Date(Date.now() - 2 * 86_400_000).toISOString(), byScenario: [] },
    { ...latest, runId: "eval-004", passRate: 0.34, criteriaRate: 0.3, timestamp: new Date(Date.now() - 86_400_000).toISOString(), byScenario: [] },
    latest,
  ];

  return { latest, history };
}

export default EvalScorecard;
