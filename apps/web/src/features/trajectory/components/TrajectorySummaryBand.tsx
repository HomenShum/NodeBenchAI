import { Activity, ArrowUpRight, Compass, TrendingDown, TrendingUp, Waypoints } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrajectoryCompoundingData, TrajectorySummaryData } from "../types";

function formatScore(score?: number) {
  if (typeof score !== "number") return "n/a";
  return `${Math.round(score * 100)}%`;
}

function formatRelativeReview(timestamp?: number) {
  if (!timestamp) return "Review window unset";
  const deltaMs = timestamp - Date.now();
  const days = Math.round(deltaMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Review due now";
  if (days === 1) return "Review in 1 day";
  return `Review in ${days} days`;
}

function labelTone(label?: string) {
  switch (label) {
    case "compounding":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "improving":
      return "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200";
    case "flat":
      return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-200";
    case "drifting":
      return "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-200";
    default:
      return "border-edge bg-surface text-content-secondary";
  }
}

export function TrajectorySummaryBand({
  summary,
  compounding,
  loading = false,
  emptyLabel = "No trajectory model has been projected for this surface yet.",
}: {
  summary?: TrajectorySummaryData | null;
  compounding?: TrajectoryCompoundingData | null;
  loading?: boolean;
  emptyLabel?: string;
}) {
  if (loading) {
    return (
      <section className="rounded-2xl border border-edge bg-surface p-4" aria-label="Trajectory Intelligence — loading" data-agent-surface="trajectory-summary">
        <div className="text-sm text-content-secondary" role="status">Loading trajectory intelligence...</div>
      </section>
    );
  }

  if (!summary) {
    return (
      <section className="rounded-2xl border border-dashed border-edge bg-surface-secondary/50 p-4" aria-label="Trajectory Intelligence — empty" data-agent-surface="trajectory-summary">
        <div className="flex items-center gap-2 text-sm font-medium text-content">
          <Waypoints className="h-4 w-4 text-content-muted" />
          Trajectory Intelligence
        </div>
        <p className="mt-2 text-sm text-content-secondary">{emptyLabel}</p>
      </section>
    );
  }

  const breakdown = summary.scoreBreakdown;
  const primary = compounding ?? (breakdown ? {
    entityKey: summary.entityKey,
    entityType: summary.entityType,
    windowDays: summary.windowDays,
    rawScore: breakdown.rawCompounding?.score ?? 0,
    rawLabel: breakdown.rawCompounding?.label ?? "unknown",
    rawExplanation: breakdown.rawCompounding?.explanation ?? "",
    trustAdjustedScore: breakdown.trustAdjustedCompounding?.score ?? 0,
    trustAdjustedLabel: breakdown.trustAdjustedCompounding?.label ?? "unknown",
    trustAdjustedExplanation: breakdown.trustAdjustedCompounding?.explanation ?? "",
    driftScore: breakdown.drift?.score ?? 0,
    driftLabel: breakdown.drift?.label ?? "unknown",
    driftExplanation: breakdown.drift?.explanation ?? "",
  } : null);

  return (
    <section className="rounded-2xl border border-edge bg-surface p-4" aria-labelledby="trajectory-heading" data-agent-surface="trajectory-summary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-content" id="trajectory-heading">
            <Waypoints className="h-4 w-4 text-accent" aria-hidden="true" />
            Trajectory Intelligence
          </div>
          <p className="mt-2 max-w-3xl text-sm text-content-secondary">{summary.summary}</p>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-content-muted">{summary.narrative}</p>
        </div>
        <div className="text-xs text-content-muted">{formatRelativeReview(summary.nextReviewAt)}</div>
      </div>

      {primary && (
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-edge bg-background/50 p-3">
          <div className="flex items-center gap-2 text-xs text-content-muted">
            <TrendingUp className="h-3.5 w-3.5" />
            Trust-adjusted compounding
          </div>
          <div className="mt-2 text-2xl font-semibold text-content">{formatScore(primary.trustAdjustedScore)}</div>
          <div className={cn("mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", labelTone(primary.trustAdjustedLabel))}>
            {primary.trustAdjustedLabel}
          </div>
        </div>

        <div className="rounded-xl border border-edge bg-background/50 p-3">
          <div className="flex items-center gap-2 text-xs text-content-muted">
            <ArrowUpRight className="h-3.5 w-3.5" />
            Raw compounding
          </div>
          <div className="mt-2 text-2xl font-semibold text-content">{formatScore(primary.rawScore)}</div>
          <div className={cn("mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", labelTone(primary.rawLabel))}>
            {primary.rawLabel}
          </div>
        </div>

        <div className="rounded-xl border border-edge bg-background/50 p-3">
          <div className="flex items-center gap-2 text-xs text-content-muted">
            <TrendingDown className="h-3.5 w-3.5" />
            Drift pressure
          </div>
          <div className="mt-2 text-2xl font-semibold text-content">{formatScore(primary.driftScore)}</div>
          <div className={cn("mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", labelTone(primary.driftLabel))}>
            {primary.driftLabel}
          </div>
        </div>

        <div className="rounded-xl border border-edge bg-background/50 p-3">
          <div className="flex items-center gap-2 text-xs text-content-muted">
            <Compass className="h-3.5 w-3.5" />
            Top intervention
          </div>
          <div className="mt-2 text-sm font-semibold text-content">
            {summary.topInterventions[0]?.title ?? "No interventions logged"}
          </div>
          <div className="mt-2 text-[11px] text-content-muted">
            {summary.topInterventions[0]
              ? `${formatScore(summary.topInterventions[0].observedScoreDelta)} uplift`
              : "Record an intervention event to track slope shifts."}
          </div>
        </div>
      </div>
      )}

      {breakdown && (
      <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr,0.8fr]">
        <div className="rounded-xl border border-edge bg-background/50 p-3">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-content-muted">
            <Activity className="h-3.5 w-3.5" />
            Score Drivers
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {([
              ["Action quality", breakdown.spanQuality],
              ["Evidence completeness", breakdown.evidenceCompleteness],
              ["Adaptation velocity", breakdown.adaptationVelocity],
              ["Trust leverage", breakdown.trustLeverage],
              ["Intervention effect", breakdown.interventionEffect],
              ["Drift", breakdown.drift],
            ] as [string, { score: number; label?: string; explanation: string }][]).map(([name, card]) => (
              <div key={name} className="rounded-lg border border-edge bg-surface px-3 py-2" data-agent-metric={name.toLowerCase().replace(/\s+/g, "-")}>
                <div className="text-[11px] uppercase tracking-wide text-content-muted">{name}</div>
                <div className="mt-1 text-lg font-semibold text-content">{formatScore(card?.score)}</div>
                {card?.label && (
                  <div className={cn("mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium", labelTone(card.label))}>
                    {card.label}
                  </div>
                )}
                <div className="mt-1 text-[11px] leading-5 text-content-secondary">{card?.explanation}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-edge bg-background/50 p-3">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-content-muted">Activity summary</div>
          <div className="mt-3 space-y-2 text-sm text-content-secondary">
            <div className="flex items-center justify-between gap-3">
              <span>Actions tracked</span>
              <span className="font-medium text-content">{summary.spanCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Evidence bundles</span>
              <span className="font-medium text-content">{summary.evidenceBundleCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Verdicts</span>
              <span className="font-medium text-content">{summary.verdictCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Feedback events</span>
              <span className="font-medium text-content">{summary.feedbackCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Benchmarks</span>
              <span className="font-medium text-content">{summary.benchmarkCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Trust amplifiers</span>
              <span className="font-medium text-content">{summary.trustEdgeCount}</span>
            </div>
          </div>
        </div>
      </div>
      )}
    </section>
  );
}

export default TrajectorySummaryBand;
