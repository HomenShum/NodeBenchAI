/**
 * BenchmarkComparison — 4-way comparison matrix proving NodeBench value.
 *
 * Baselines:
 * 0. Social baseline (screenshot-level: short thesis + 3 names + no evidence)
 * 1. Model-only (same prompt, no tools, no web, no structured output)
 * 2. Model + generic browsing (frontier model with basic web search)
 * 3. NodeBench frontier run (structured tool plan, evidence ledger, role lens, packet output)
 * 4. NodeBench replay/distilled run (same task class through retained/attrited workflow)
 *
 * Judged across 6 axes: factual correctness, evidence quality, completeness,
 * actionability, uncertainty calibration, cost/latency.
 */

import { memo, useState, useMemo } from "react";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle,
  XCircle,
  AlertTriangle,
  DollarSign,
  Clock,
  Shield,
  Target,
  Lightbulb,
  Zap,
  Trophy,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type BaselineId = "social" | "model-only" | "model-browse" | "nodebench" | "nodebench-distilled";

interface BaselineResult {
  id: BaselineId;
  label: string;
  description: string;
  scores: Record<MetricId, number>; // 0-100
  costUsd: number;
  latencySec: number;
}

type MetricId =
  | "factual"
  | "evidence"
  | "completeness"
  | "actionability"
  | "uncertainty"
  | "costEfficiency";

interface MetricMeta {
  id: MetricId;
  label: string;
  description: string;
  icon: typeof Target;
}

// ─── Metric definitions ──────────────────────────────────────────────────────

const METRICS: MetricMeta[] = [
  {
    id: "factual",
    label: "Factual Correctness",
    description: "Are the stated facts actually true and verifiable?",
    icon: Shield,
  },
  {
    id: "evidence",
    label: "Evidence Quality",
    description: "Are claims backed by dated, attributable sources?",
    icon: Target,
  },
  {
    id: "completeness",
    label: "Completeness",
    description: "Are key constraints, risks, and unresolved questions covered?",
    icon: CheckCircle,
  },
  {
    id: "actionability",
    label: "Actionability",
    description: "Can the reader take a specific next step from this output?",
    icon: Zap,
  },
  {
    id: "uncertainty",
    label: "Uncertainty Calibration",
    description: "Does the output honestly flag what is unknown vs known?",
    icon: AlertTriangle,
  },
  {
    id: "costEfficiency",
    label: "Cost Efficiency",
    description: "Quality achieved per dollar spent on compute/API calls",
    icon: DollarSign,
  },
];

// ─── Demo data (SMR example from user's spec) ───────────────────────────────

const DEMO_BASELINES: BaselineResult[] = [
  {
    id: "social",
    label: "Social Baseline",
    description: "Short thesis + 3 stock names, no evidence ledger",
    scores: {
      factual: 45,
      evidence: 10,
      completeness: 15,
      actionability: 20,
      uncertainty: 5,
      costEfficiency: 90,
    },
    costUsd: 0.0,
    latencySec: 0,
  },
  {
    id: "model-only",
    label: "Model Only",
    description: "Same prompt, no tools, no web, free-form answer",
    scores: {
      factual: 55,
      evidence: 20,
      completeness: 30,
      actionability: 35,
      uncertainty: 25,
      costEfficiency: 75,
    },
    costUsd: 0.02,
    latencySec: 8,
  },
  {
    id: "model-browse",
    label: "Model + Browse",
    description: "Frontier model with basic web search, free-form answer",
    scores: {
      factual: 70,
      evidence: 50,
      completeness: 45,
      actionability: 50,
      uncertainty: 35,
      costEfficiency: 55,
    },
    costUsd: 0.15,
    latencySec: 25,
  },
  {
    id: "nodebench",
    label: "NodeBench Frontier",
    description: "Structured tool plan, evidence ledger, contradiction check, role lens, packet output",
    scores: {
      factual: 88,
      evidence: 82,
      completeness: 78,
      actionability: 85,
      uncertainty: 72,
      costEfficiency: 45,
    },
    costUsd: 0.35,
    latencySec: 45,
  },
  {
    id: "nodebench-distilled",
    label: "NodeBench Distilled",
    description: "Retained/attrited workflow replay — cheaper path for similar task class",
    scores: {
      factual: 82,
      evidence: 75,
      completeness: 72,
      actionability: 80,
      uncertainty: 68,
      costEfficiency: 80,
    },
    costUsd: 0.08,
    latencySec: 15,
  },
];

// ─── Subcomponents ─────────────────────────────────────────────────────────

function ScoreBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = (value / max) * 100;
  const color =
    pct >= 75
      ? "bg-emerald-500"
      : pct >= 50
        ? "bg-amber-500"
        : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-white/[0.06]">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right text-xs font-mono text-content-muted">
        {value}
      </span>
    </div>
  );
}

function BaselineColumn({
  baseline,
  isHighlighted,
}: {
  baseline: BaselineResult;
  isHighlighted: boolean;
}) {
  const avgScore = Math.round(
    Object.values(baseline.scores).reduce((a, b) => a + b, 0) /
      Object.values(baseline.scores).length,
  );

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        isHighlighted
          ? "border-accent-primary/30 bg-accent-primary/[0.06]"
          : "border-white/[0.06] bg-white/[0.02]"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-content">
          {baseline.label}
        </h3>
        <span className="text-lg font-bold text-content">{avgScore}</span>
      </div>
      <p className="text-[11px] text-content-muted leading-relaxed mb-3">
        {baseline.description}
      </p>

      {/* Metrics */}
      <div className="space-y-2">
        {METRICS.map((metric) => (
          <div key={metric.id}>
            <div className="text-[10px] text-content-muted mb-0.5">
              {metric.label}
            </div>
            <ScoreBar value={baseline.scores[metric.id]} />
          </div>
        ))}
      </div>

      {/* Cost + latency */}
      <div className="mt-3 flex gap-3 text-[10px] text-content-muted">
        <span className="flex items-center gap-1">
          <DollarSign className="h-2.5 w-2.5" />$
          {baseline.costUsd.toFixed(2)}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" />
          {baseline.latencySec}s
        </span>
      </div>
    </div>
  );
}

function GapClosureChart({ baselines }: { baselines: BaselineResult[] }) {
  const socialAvg = Math.round(
    Object.values(baselines[0].scores).reduce((a, b) => a + b, 0) /
      Object.values(baselines[0].scores).length,
  );
  const nodebenchAvg = Math.round(
    Object.values(baselines[3].scores).reduce((a, b) => a + b, 0) /
      Object.values(baselines[3].scores).length,
  );
  const distilledAvg = Math.round(
    Object.values(baselines[4].scores).reduce((a, b) => a + b, 0) /
      Object.values(baselines[4].scores).length,
  );
  const gapClosed = nodebenchAvg - socialAvg;
  const gapRetained = distilledAvg - socialAvg;

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Trophy className="h-4 w-4 text-emerald-400" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">
          Gap Closure
        </span>
      </div>
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-2xl font-bold text-content">{socialAvg}</div>
          <div className="text-[10px] text-content-muted">Social baseline</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-emerald-400">
            +{gapClosed}
          </div>
          <div className="text-[10px] text-content-muted">
            NodeBench frontier
          </div>
        </div>
        <div>
          <div className="text-2xl font-bold text-amber-400">
            +{gapRetained}
          </div>
          <div className="text-[10px] text-content-muted">
            Distilled replay
          </div>
        </div>
      </div>
      <div className="mt-3 text-[11px] text-content-muted text-center">
        Distilled replay retains{" "}
        {Math.round((gapRetained / gapClosed) * 100)}% of the quality gap at{" "}
        {Math.round(
          (baselines[4].costUsd / baselines[3].costUsd) * 100,
        )}
        % of the cost
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

function BenchmarkComparisonInner() {
  const [highlightedId, setHighlightedId] = useState<BaselineId>("nodebench");
  const [activeMetric, setActiveMetric] = useState<MetricId>("evidence");

  const baselines = DEMO_BASELINES;

  // Per-metric comparison
  const metricComparison = useMemo(() => {
    const metric = activeMetric;
    return baselines
      .map((b) => ({
        id: b.id,
        label: b.label,
        score: b.scores[metric],
      }))
      .sort((a, b) => b.score - a.score);
  }, [baselines, activeMetric]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="h-5 w-5 text-accent-primary" />
        <div>
          <h1 className="text-lg font-semibold text-content">
            Benchmark Comparison
          </h1>
          <p className="text-xs text-content-muted">
            5-baseline ladder proving NodeBench structured output vs shallow
            alternatives
          </p>
        </div>
      </div>

      {/* Gap closure summary */}
      <GapClosureChart baselines={baselines} />

      {/* 5-column comparison */}
      <div className="grid grid-cols-5 gap-2">
        {baselines.map((baseline) => (
          <button
            key={baseline.id}
            type="button"
            onClick={() => setHighlightedId(baseline.id)}
            className="text-left"
          >
            <BaselineColumn
              baseline={baseline}
              isHighlighted={highlightedId === baseline.id}
            />
          </button>
        ))}
      </div>

      {/* Per-metric drill-down */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted mb-3">
          Metric Drill-Down
        </div>

        {/* Metric selector */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {METRICS.map((metric) => (
            <button
              key={metric.id}
              type="button"
              onClick={() => setActiveMetric(metric.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeMetric === metric.id
                  ? "bg-accent-primary/15 text-accent-primary"
                  : "border border-white/[0.06] text-content-muted hover:bg-white/[0.04] hover:text-content"
              }`}
              aria-pressed={activeMetric === metric.id}
            >
              <metric.icon className="h-3 w-3" />
              {metric.label}
            </button>
          ))}
        </div>

        {/* Active metric description */}
        <p className="text-xs text-content-muted mb-3">
          {
            METRICS.find((m) => m.id === activeMetric)?.description
          }
        </p>

        {/* Ranked comparison */}
        <div className="space-y-2">
          {metricComparison.map((entry, rank) => (
            <div
              key={entry.id}
              className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-black/20 p-3"
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                  rank === 0
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-white/[0.06] text-content-muted"
                }`}
              >
                {rank + 1}
              </span>
              <span className="w-36 text-xs font-medium text-content">
                {entry.label}
              </span>
              <div className="flex-1">
                <ScoreBar value={entry.score} />
              </div>
              {rank === 0 && (
                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Benchmark task families */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted mb-3">
          Benchmark Task Families
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            "Company understanding",
            "Founder diligence",
            "Compare two entities",
            "Recent change summary",
            "Banker CRM prep",
            "Investor diligence prep",
            "Buyer/acquirer screen",
            "Event note compilation",
            "Sector thesis breakdown",
            "What would break this thesis?",
          ].map((task) => (
            <div
              key={task}
              className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-xs text-content-secondary"
            >
              {task}
            </div>
          ))}
        </div>
      </div>

      {/* External benchmarks */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted mb-3">
          External Benchmark Alignment
        </div>
        <div className="space-y-2 text-xs text-content-secondary">
          <div className="flex items-start gap-2">
            <CheckCircle className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
            <span>
              <strong className="text-content">GAIA</strong> — tests real-world
              assistant behavior with reasoning, tools, web use, and
              multimodality. Used for external credibility.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
            <span>
              <strong className="text-content">BrowseComp</strong> — measures
              ability to find hard-to-locate information. Proves generic models
              with light browsing still fail on persistence-heavy search.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
            <span>
              <strong className="text-content">NodeBench-native</strong> —
              entity diligence, investment screening, conference capture, and
              CRM/action generation benchmarks. Neither GAIA nor BrowseComp
              measures "produce a trustworthy diligence packet."
            </span>
          </div>
        </div>
      </div>

      {/* Demo notice */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 text-[10px] text-amber-400">
        Demo data using SMR (Small Modular Reactor) thesis example. Real
        benchmarks require running actual search pipelines against gold-standard
        packets.
      </div>
    </div>
  );
}

export const BenchmarkComparison = memo(BenchmarkComparisonInner);
export default BenchmarkComparison;
