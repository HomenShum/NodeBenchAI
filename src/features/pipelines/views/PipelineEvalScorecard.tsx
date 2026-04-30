/**
 * PipelineEvalScorecard
 *
 * Surfaces aggregate eval metrics over the most recent pipelineRuns:
 *   - Verdict accuracy (% verified)
 *   - Brier score (forecast-vs-outcome calibration)
 *   - Avg duration / cost
 *   - Per-kind breakdown
 *
 * Pure-data view — no LLM calls. Uses the existing `pipelineRuns`
 * substrate to derive scores deterministically.
 */

import React from "react";
import { useStableQuery } from "@/hooks/useStableQuery";
import { api } from "../../../../convex/_generated/api";
import { Gauge, TrendingUp } from "lucide-react";

function pct(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}

function ms(n?: number): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

function usd(n?: number): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return "—";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(3)}`;
}

function brierLabel(b?: number): { label: string; tone: string } {
  if (typeof b !== "number") return { label: "—", tone: "text-content-muted" };
  if (b < 0.15)
    return {
      label: `${b.toFixed(3)} · well-calibrated`,
      tone: "text-emerald-700 dark:text-emerald-300",
    };
  if (b < 0.25)
    return {
      label: `${b.toFixed(3)} · acceptable`,
      tone: "text-amber-700 dark:text-amber-300",
    };
  return {
    label: `${b.toFixed(3)} · poorly calibrated`,
    tone: "text-red-700 dark:text-red-300",
  };
}

export const PipelineEvalScorecard: React.FC = () => {
  const stats = useStableQuery(
    api.domains.pipelines.pipelineEvalQueries.getPipelineEvalScorecard,
    { limit: 100 },
  );

  if (stats === undefined) {
    return (
      <section
        data-testid="pipeline-eval-scorecard"
        className="nb-surface-card p-4 text-xs text-content-muted"
      >
        Loading eval scorecard…
      </section>
    );
  }
  if (stats.samples === 0) {
    return (
      <section
        data-testid="pipeline-eval-scorecard-empty"
        className="nb-surface-card p-4 space-y-2"
      >
        <header className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-violet-500/15 flex items-center justify-center">
            <Gauge className="w-4 h-4 text-violet-600 dark:text-violet-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-content">Eval scorecard</h3>
            <p className="text-[11px] text-content-muted">
              Brier + verdict accuracy across recent runs · empty until runs land.
            </p>
          </div>
        </header>
      </section>
    );
  }

  const brier = brierLabel(stats.brier);

  return (
    <section
      data-testid="pipeline-eval-scorecard"
      aria-label="Pipeline eval scorecard"
      className="nb-surface-card p-4 space-y-3"
    >
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-violet-500/15 flex items-center justify-center">
            <Gauge className="w-4 h-4 text-violet-600 dark:text-violet-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-content">Eval scorecard</h3>
            <p className="text-[11px] text-content-muted">
              Aggregated over the last {stats.samples} run(s)
            </p>
          </div>
        </div>
        <div className="text-[11px] text-content-muted">
          <span data-testid="pipeline-eval-accuracy">
            verified {pct(stats.verdictAccuracy)}
          </span>{" "}
          ·{" "}
          <span data-testid="pipeline-eval-brier" className={brier.tone}>
            Brier {brier.label}
          </span>{" "}
          · avg {ms(stats.avgDurationMs)} / {usd(stats.avgUsd)}
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {(
          [
            ["verified", "emerald"],
            ["provisionally_verified", "amber"],
            ["needs_review", "amber"],
            ["failed", "red"],
            ["other", "content-muted"],
          ] as const
        ).map(([key, tone]) => (
          <div
            key={key}
            data-testid={`pipeline-eval-count-${key}`}
            className="rounded-md border border-edge/60 px-2 py-1.5"
          >
            <div className="text-[10px] uppercase tracking-wide text-content-muted">
              {key.replace("_", " ")}
            </div>
            <div className={`text-sm font-semibold text-${tone}-700 dark:text-${tone}-300`}>
              {(stats.verdictCounts as any)[key]}
            </div>
          </div>
        ))}
      </div>

      {stats.byKind.length > 0 ? (
        <div data-testid="pipeline-eval-by-kind" className="text-[11px]">
          <div className="text-content-muted mb-1 inline-flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Per-kind breakdown
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-[10px] uppercase text-content-muted">
                <th className="text-left py-0.5">Kind</th>
                <th className="text-right py-0.5">Samples</th>
                <th className="text-right py-0.5">Verified%</th>
                <th className="text-right py-0.5">Avg duration</th>
                <th className="text-right py-0.5">Avg cost</th>
              </tr>
            </thead>
            <tbody>
              {stats.byKind.map((k) => (
                <tr key={k.pipelineKind} className="border-t border-edge/40">
                  <td className="py-0.5 text-content">{k.pipelineKind.replace("_", " ")}</td>
                  <td className="py-0.5 text-right text-content-muted">{k.samples}</td>
                  <td className="py-0.5 text-right text-content-muted">
                    {pct(k.verifiedShare)}
                  </td>
                  <td className="py-0.5 text-right text-content-muted">
                    {ms(k.avgDurationMs)}
                  </td>
                  <td className="py-0.5 text-right text-content-muted">
                    {usd(k.avgUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
};

export default PipelineEvalScorecard;
