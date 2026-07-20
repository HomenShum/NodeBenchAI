import { useState } from "react";
import { TrendingUp, Target, BarChart3, ChevronDown, ChevronUp } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { ForecastCard } from "./ForecastCard";
import { CalibrationPlot } from "./CalibrationPlot";
import { BrierTrendChart } from "./BrierTrendChart";
import type { Id } from "../../../../convex/_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// FORECAST COCKPIT
//
// Assembles ForecastCard, CalibrationPlot, BrierTrendChart into a cohesive
// forecast monitoring surface. Progressive disclosure:
// glance → evidence → trace → raw data.
//
// All Convex queries return `undefined` while loading and `null` when the
// backend function doesn't exist yet — both are handled as empty state.
// ═══════════════════════════════════════════════════════════════════════════

const BRIER_LABELS: Array<{ max: number; label: string }> = [
  { max: 0.12, label: "top 5%" },
  { max: 0.15, label: "top 15%" },
  { max: 0.20, label: "top 30%" },
  { max: 1, label: "building" },
];

function brierLabel(brier: number | null | undefined): string {
  if (brier == null) return "n/a";
  return BRIER_LABELS.find((b) => brier <= b.max)?.label ?? "building";
}

export function ForecastCockpit() {
  // ── Convex queries — all nullable-safe ──
  const summary = useQuery(api.domains.forecasting.forecastManager.getDashboardSummary);
  const activeForecasts = useQuery(api.domains.forecasting.forecastManager.getActiveForecasts);
  const resolvedForecasts = useQuery(api.domains.forecasting.forecastManager.getResolvedForecasts);
  const calibration = useQuery(api.domains.forecasting.forecastManager.getLatestCalibration);
  const brierTrend = useQuery(api.domains.forecasting.forecastManager.getBrierTrend);

  const [showResolved, setShowResolved] = useState(false);
  const [expandedForecast, setExpandedForecast] = useState<string | null>(null);

  // ── Loading state ──
  if (summary === undefined) {
    return (
      <div className="space-y-6">
        <div className="h-20 bg-surface-secondary rounded-lg" />
        <div className="grid grid-cols-2 gap-4">
          <div className="h-56 bg-surface-secondary rounded-lg" />
          <div className="h-56 bg-surface-secondary rounded-lg" />
        </div>
        <div className="h-40 bg-surface-secondary rounded-lg" />
      </div>
    );
  }

  // ── Empty state: no forecasts yet ──
  if (!summary || (summary.activeCount === 0 && summary.resolvedCount === 0)) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center mb-4">
          <Target className="w-8 h-8 text-indigo-500" />
        </div>
        <h3 className="text-lg font-semibold text-content mb-2">
          Forecast Cockpit
        </h3>
        <p className="text-sm text-content-secondary max-w-md mb-6">
          Track predictions with calibration scoring, evidence timelines, and
          full provenance. Forecasts are created via AI tools and refreshed
          daily before the LinkedIn digest.
        </p>
        <div className="rounded-lg border border-dashed border-edge dark:border-gray-600 bg-surface-secondary p-4 max-w-sm w-full text-left">
          <p className="text-xs font-semibold text-content-muted mb-2">
            Quick start
          </p>
          <ol className="space-y-1.5 text-sm text-content-secondary">
            <li className="flex gap-2">
              <span className="text-indigo-500 font-semibold shrink-0">1.</span>
              <span>
                Run <code className="text-xs bg-surface-secondary dark:bg-gray-700 px-1 rounded font-mono">create_forecast</code> with a
                question, probability, and resolution date
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-indigo-500 font-semibold shrink-0">2.</span>
              <span>Daily cron auto-refreshes probabilities from new signals</span>
            </li>
            <li className="flex gap-2">
              <span className="text-indigo-500 font-semibold shrink-0">3.</span>
              <span>Calibration and Brier scores build here as forecasts resolve</span>
            </li>
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header Stats ── */}
      <div className="rounded-lg border border-edge/50 bg-gradient-to-br from-white to-gray-50/50 dark:from-gray-900 dark:to-gray-800/30 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-indigo-500" />
            <h2 className="text-lg font-semibold text-content">
              Forecast Cockpit
            </h2>
          </div>
          {summary.overallBrier != null && (
            <span className="text-sm font-mono text-indigo-600 dark:text-indigo-400">
              Brier: {summary.overallBrier.toFixed(3)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-6 text-sm text-content-secondary">
          <span>{summary.activeCount} active</span>
          <span className="text-gray-300 dark:text-content-secondary">&middot;</span>
          <span>{summary.resolvedCount} resolved</span>
          {summary.scoredCount > 0 && (
            <>
              <span className="text-gray-300 dark:text-content-secondary">&middot;</span>
              <span>{brierLabel(summary.overallBrier)} calibration</span>
            </>
          )}
        </div>
      </div>

      {/* ── Charts Row ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Calibration Plot */}
        <div className="rounded-lg border border-edge/50 bg-surface p-4">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4 text-content-muted" />
            <h3 className="text-sm font-medium text-content-secondary">Calibration</h3>
          </div>
          <CalibrationPlot bins={calibration?.bins ?? []} />
        </div>

        {/* Brier Trend */}
        <div className="rounded-lg border border-edge/50 bg-surface p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-content-muted" />
            <h3 className="text-sm font-medium text-content-secondary">Brier Trend</h3>
          </div>
          <BrierTrendChart dataPoints={brierTrend ?? []} />
        </div>
      </div>

      {/* ── Active Forecasts ── */}
      {activeForecasts && activeForecasts.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-content-secondary mb-3">
            Active Forecasts
          </h3>
          <div className="space-y-3">
            {activeForecasts.map((f) => (
              <ForecastCardWithEvidence
                key={f._id}
                forecast={f}
                expanded={expandedForecast === f._id}
                onToggleExpand={() =>
                  setExpandedForecast(expandedForecast === f._id ? null : f._id)
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Resolved Forecasts (collapsible) ── */}
      {resolvedForecasts && resolvedForecasts.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowResolved(!showResolved)}
            className="flex items-center gap-2 text-sm font-medium text-content-secondary mb-3 hover:text-content transition-colors"
          >
            Resolved ({resolvedForecasts.length})
            {showResolved ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showResolved && (
            <div className="space-y-2">
              {resolvedForecasts.map((f) => (
                <ForecastCard
                  key={f._id}
                  question={f.question}
                  probability={f.probability ?? 0.5}
                  resolutionDate={f.resolutionDate}
                  topDrivers={[]}
                  topCounterarguments={[]}
                  updateCount={0}
                  status="resolved"
                  outcome={f.outcome === "yes"}
                  brierScore={f.brierScore ?? undefined}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FORECAST CARD WITH EVIDENCE (lazy-loads evidence on expand)
// ═══════════════════════════════════════════════════════════════════════════

function ForecastCardWithEvidence({
  forecast,
  expanded,
  onToggleExpand,
}: {
  forecast: {
    _id: Id<"forecasts">;
    question: string;
    probability?: number;
    confidenceInterval?: { lower: number; upper: number };
    resolutionDate: string;
    topDrivers: string[];
    topCounterarguments: string[];
    updateCount: number;
    previousProbability?: number;
  };
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const evidence = useQuery(
    api.domains.forecasting.forecastManager.getEvidenceTimelineForDashboard,
    expanded ? { forecastId: forecast._id } : "skip",
  );

  return (
    <ForecastCard
      question={forecast.question}
      probability={forecast.probability ?? 0.5}
      confidenceInterval={forecast.confidenceInterval}
      resolutionDate={forecast.resolutionDate}
      topDrivers={forecast.topDrivers}
      topCounterarguments={forecast.topCounterarguments}
      updateCount={forecast.updateCount}
      previousProbability={forecast.previousProbability}
      status="active"
      evidenceTimeline={expanded ? (evidence ?? []) : undefined}
      onExpandTrace={onToggleExpand}
    />
  );
}

export default ForecastCockpit;
