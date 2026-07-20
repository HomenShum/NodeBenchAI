/**
 * PipelineRollupPanel — global health readout for the three-layer pipeline.
 *
 * Three parallel rollups side-by-side:
 *   1. Telemetry   — throughput, error rate, p50/p95 latency
 *   2. Deterministic verdicts — verified / provisionally / needs_review / failed
 *   3. LLM semantic — parse/request success + 4 dimension averages
 *
 * Design posture:
 *   - BOUND: every rollup query caps at 200 rows (see Convex queries).
 *   - HONEST_SCORES: numbers rendered straight from rollup queries; no
 *     re-scaling, no floors.
 *   - analyst_diagnostic.md "would hiding the problem make it invisible?" —
 *     zero-state is explicit ("No runs yet"), not an empty card.
 *
 * Integration:
 *   Drop into the `/?surface=telemetry` view (AgentTelemetryDashboard.tsx)
 *   as the top hero band. Collapses cleanly on mobile to 1 column.
 */

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

type TelemetryRollup = {
  total: number;
  errors: number;
  created: number;
  updated: number;
  stale: number;
  errorRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  meanLatencyMs: number;
};

type VerdictRollup = {
  total: number;
  verified: number;
  provisionally_verified: number;
  needs_review: number;
  failed: number;
  averageScore: number;
  verifiedRate: number;
};

type LlmRollup = {
  total: number;
  scored: number;
  parseErrors: number;
  requestFailures: number;
  averageOverall: number;
  averageProse: number;
  averageCitation: number;
  averageSource: number;
  averageTierAppropriate: number;
};

export type PipelineRollupPanelProps = {
  limit?: number;
  className?: string;
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function KpiCard({
  label,
  primary,
  secondary,
  tone,
}: {
  label: string;
  primary: string;
  secondary?: string;
  tone?: "emerald" | "sky" | "amber" | "rose" | "white";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "sky"
        ? "text-sky-300"
        : tone === "amber"
          ? "text-amber-300"
          : tone === "rose"
            ? "text-rose-300"
            : "text-white";
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-white/50">{label}</div>
      <div className={`mt-1 font-mono text-xl leading-none ${toneClass}`}>{primary}</div>
      {secondary ? (
        <div className="mt-1 font-mono text-[11px] text-white/50">{secondary}</div>
      ) : null}
    </div>
  );
}

export function PipelineRollupPanel({ limit = 200, className }: PipelineRollupPanelProps) {
  const cappedLimit = Math.max(1, Math.min(limit, 200));

  const telemetry = useQuery(
    api.domains.product.diligenceRunTelemetry.rollupRecent,
    { limit: cappedLimit },
  ) as TelemetryRollup | undefined;

  const verdicts = useQuery(
    api.domains.product.diligenceJudge.rollupVerdicts,
    { limit: cappedLimit },
  ) as VerdictRollup | undefined;

  const llm = useQuery(
    api.domains.product.diligenceLlmJudgeRuns.rollupRecent,
    { limit: cappedLimit },
  ) as LlmRollup | undefined;

  const loading = telemetry === undefined || verdicts === undefined || llm === undefined;

  return (
    <section
      className={"space-y-3 " + (className ?? "")}
      role="region"
      aria-label="Pipeline rollup dashboard"
      aria-busy={loading ? "true" : "false"}
    >
      <header className="flex items-baseline justify-between">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-white/60">
          Pipeline health (last {cappedLimit} runs)
        </h2>
        {telemetry && telemetry.total === 0 ? (
          <span className="text-[11px] text-white/50">No runs yet</span>
        ) : null}
      </header>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 rounded-lg border border-white/[0.06] bg-white/[0.02] motion-safe:animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* ---- Telemetry column ---- */}
          <div className="space-y-2" aria-label="Telemetry rollup">
            <h3 className="text-[10px] uppercase tracking-[0.18em] text-white/50">
              Throughput
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <KpiCard
                label="Runs"
                primary={String(telemetry!.total)}
                secondary={`${telemetry!.created}c ${telemetry!.updated}u ${telemetry!.stale}s`}
              />
              <KpiCard
                label="Errors"
                primary={String(telemetry!.errors)}
                secondary={pct(telemetry!.errorRate)}
                tone={
                  telemetry!.errorRate >= 0.1
                    ? "rose"
                    : telemetry!.errorRate > 0
                      ? "amber"
                      : "emerald"
                }
              />
              <KpiCard
                label="p50 Latency"
                primary={`${telemetry!.p50LatencyMs}ms`}
                tone={telemetry!.p50LatencyMs > 10_000 ? "amber" : "white"}
              />
              <KpiCard
                label="p95 Latency"
                primary={`${telemetry!.p95LatencyMs}ms`}
                tone={
                  telemetry!.p95LatencyMs > 25_000
                    ? "rose"
                    : telemetry!.p95LatencyMs > 15_000
                      ? "amber"
                      : "white"
                }
              />
            </div>
          </div>

          {/* ---- Verdict column ---- */}
          <div className="space-y-2" aria-label="Deterministic verdict rollup">
            <h3 className="text-[10px] uppercase tracking-[0.18em] text-white/50">
              Deterministic verdicts
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <KpiCard
                label="Verified rate"
                primary={pct(verdicts!.verifiedRate)}
                secondary={`${verdicts!.verified}/${verdicts!.total}`}
                tone={
                  verdicts!.verifiedRate >= 0.8
                    ? "emerald"
                    : verdicts!.verifiedRate >= 0.5
                      ? "sky"
                      : verdicts!.verifiedRate >= 0.3
                        ? "amber"
                        : "rose"
                }
              />
              <KpiCard
                label="Avg score"
                primary={pct(verdicts!.averageScore)}
                tone={verdicts!.averageScore >= 0.8 ? "emerald" : "white"}
              />
              <KpiCard
                label="Needs review"
                primary={String(verdicts!.needs_review)}
                tone={verdicts!.needs_review > 0 ? "amber" : "white"}
              />
              <KpiCard
                label="Failed"
                primary={String(verdicts!.failed)}
                tone={verdicts!.failed > 0 ? "rose" : "white"}
              />
            </div>
          </div>

          {/* ---- LLM semantic column ---- */}
          <div className="space-y-2" aria-label="LLM semantic rollup">
            <h3 className="text-[10px] uppercase tracking-[0.18em] text-white/50">
              LLM semantic
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <KpiCard
                label="Scored"
                primary={`${llm!.scored}/${llm!.total}`}
                secondary={
                  llm!.requestFailures + llm!.parseErrors > 0
                    ? `${llm!.parseErrors}pe ${llm!.requestFailures}rf`
                    : undefined
                }
                tone={
                  llm!.total === 0
                    ? "white"
                    : llm!.scored / llm!.total >= 0.9
                      ? "emerald"
                      : llm!.scored / llm!.total >= 0.7
                        ? "sky"
                        : "amber"
                }
              />
              <KpiCard
                label="Overall"
                primary={pct(llm!.averageOverall)}
                tone={
                  llm!.averageOverall >= 0.8
                    ? "emerald"
                    : llm!.averageOverall >= 0.6
                      ? "sky"
                      : llm!.averageOverall >= 0.4
                        ? "amber"
                        : "rose"
                }
              />
              <KpiCard
                label="Prose ↔ Citation"
                primary={`${pct(llm!.averageProse)} · ${pct(llm!.averageCitation)}`}
              />
              <KpiCard
                label="Sources ↔ Tier"
                primary={`${pct(llm!.averageSource)} · ${pct(llm!.averageTierAppropriate)}`}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
