/**
 * PipelineEvalScorecard
 *
 * User-facing observed outcome summary for recent background research runs.
 */

import React, { useMemo } from "react";
import { useStableQuery } from "@/hooks/useStableQuery";
import { api } from "../../../../convex/_generated/api";
import { Gauge, TrendingUp } from "lucide-react";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";

function pct(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}

function ms(n?: number): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "-";
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

function usd(n?: number): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return "-";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(3)}`;
}

function verdictLabel(key: string): string {
  if (key === "verified") return "verified";
  if (key === "provisionally_verified") return "partly verified";
  if (key === "needs_review") return "needs review";
  if (key === "failed") return "failed";
  return "other";
}

function kindLabel(kind: string): string {
  if (kind === "research") return "research";
  if (kind === "code_gen") return "code starter";
  if (kind === "design_gen") return "design brief";
  return kind.replaceAll("_", " ");
}

const COUNT_TONE: Record<string, string> = {
  verified: "text-emerald-700 dark:text-emerald-300",
  provisionally_verified: "text-amber-700 dark:text-amber-300",
  needs_review: "text-amber-700 dark:text-amber-300",
  failed: "text-red-700 dark:text-red-300",
  other: "text-content-muted",
};

export const PipelineEvalScorecard: React.FC = () => {
  const anonymousSessionId = useMemo(() => getAnonymousProductSessionId(), []);
  const stats = useStableQuery(
    api.domains.pipelines.pipelineEvalQueries.getPipelineEvalScorecard,
    { limit: 100, anonymousSessionId },
  );

  if (stats === undefined) {
    return (
      <section
        data-testid="pipeline-eval-scorecard"
        className="nb-surface-card p-4 text-xs text-content-muted"
      >
        Loading research quality...
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
            <h3 className="text-sm font-semibold text-content">Run outcomes</h3>
            <p className="text-[11px] text-content-muted">
              Final verdict, duration, and estimated-cost counters appear after runs finish.
            </p>
          </div>
        </header>
      </section>
    );
  }

  return (
    <section
      data-testid="pipeline-eval-scorecard"
      aria-label="Run outcomes"
      className="nb-surface-card p-4 space-y-3"
    >
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-violet-500/15 flex items-center justify-center">
            <Gauge className="w-4 h-4 text-violet-600 dark:text-violet-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-content">Run outcomes</h3>
            <p className="text-[11px] text-content-muted">
              Recorded final verdicts from the last {stats.samples} run(s)
            </p>
          </div>
        </div>
        <div className="text-[11px] text-content-muted">
          <span data-testid="pipeline-eval-verified-share">
            verified verdicts {pct(stats.verifiedShare)}
          </span>{" "}
          - avg {ms(stats.avgDurationMs)} / {usd(stats.avgUsd)} estimated
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {(
          [
            "verified",
            "provisionally_verified",
            "needs_review",
            "failed",
            "other",
          ] as const
        ).map((key) => (
          <div
            key={key}
            data-testid={`pipeline-eval-count-${key}`}
            className="rounded-md border border-edge/60 px-2 py-1.5"
          >
            <div className="text-[10px] uppercase tracking-wide text-content-muted">
              {verdictLabel(key)}
            </div>
            <div className={`text-sm font-semibold ${COUNT_TONE[key]}`}>
              {(stats.verdictCounts as any)[key]}
            </div>
          </div>
        ))}
      </div>

      {stats.byKind.length > 0 ? (
        <div data-testid="pipeline-eval-by-kind" className="text-[11px]">
          <div className="text-content-muted mb-1 inline-flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> By output type
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-[10px] uppercase text-content-muted">
                <th className="text-left py-0.5">Type</th>
                <th className="text-right py-0.5">Runs</th>
                <th className="text-right py-0.5">Verified</th>
                <th className="text-right py-0.5">Avg time</th>
                <th className="text-right py-0.5">Avg estimate</th>
              </tr>
            </thead>
            <tbody>
              {stats.byKind.map((k) => (
                <tr key={k.pipelineKind} className="border-t border-edge/40">
                  <td className="py-0.5 text-content">{kindLabel(k.pipelineKind)}</td>
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
