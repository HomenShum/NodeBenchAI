/**
 * HypothesisScorecard - Phase 7 Competing Hypotheses Display
 *
 * Shows all hypotheses for a narrative thread with:
 * - Status badges (active/supported/weakened/inconclusive/retired)
 * - Confidence bars
 * - Evidence counts (supporting vs contradicting)
 * - Speculative risk labels
 * - Falsification criteria
 *
 * @module features/narrative/components/HypothesisScorecard
 */

import React from "react";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useHypothesisScorecard } from "../../hooks/useHypotheses";

interface HypothesisScorecardProps {
  threadId: Id<"narrativeThreads">;
  className?: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active: { bg: "bg-blue-100 dark:bg-blue-950/30", text: "text-blue-700 dark:text-blue-400" },
  supported: { bg: "bg-green-100 dark:bg-green-950/30", text: "text-green-700 dark:text-green-400" },
  weakened: { bg: "bg-orange-100 dark:bg-orange-950/30", text: "text-orange-700 dark:text-orange-400" },
  inconclusive: { bg: "bg-surface-secondary", text: "text-content-secondary" },
  retired: { bg: "bg-red-100 dark:bg-red-950/30", text: "text-red-600 dark:text-red-400" },
};

const RISK_COLORS: Record<string, { bg: string; text: string }> = {
  grounded: { bg: "bg-emerald-100 dark:bg-emerald-950/30", text: "text-emerald-700 dark:text-emerald-400" },
  mixed: { bg: "bg-amber-100 dark:bg-amber-950/30", text: "text-amber-700 dark:text-amber-400" },
  speculative: { bg: "bg-violet-100 dark:bg-violet-950/30", text: "text-violet-700 dark:text-violet-400" },
};

export function HypothesisScorecard({ threadId, className = "" }: HypothesisScorecardProps) {
  const scorecard = useHypothesisScorecard(threadId);

  if (!scorecard) {
    return (
      <div className={`motion-safe:animate-pulse rounded-lg border border-edge bg-surface p-4 ${className}`}>
        <div className="h-4 w-48 rounded bg-surface-secondary mb-3" />
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-surface-secondary dark:bg-white/[0.05]" />
          <div className="h-3 w-3/4 rounded bg-surface-secondary dark:bg-white/[0.05]" />
        </div>
      </div>
    );
  }

  if (scorecard.totalHypotheses === 0) {
    return null;
  }

  return (
    <div className={`rounded-lg border border-edge bg-surface ${className}`}>
      {/* Header */}
      <div className="border-b border-edge px-4 py-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-content">
            Competing Predictions
          </h3>
          <span className="text-xs text-content-secondary">
            {scorecard.totalHypotheses} prediction{scorecard.totalHypotheses !== 1 ? "s" : ""}
          </span>
        </div>
        {/* Summary badges */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(scorecard.byStatus).map(([status, count]) =>
            count > 0 ? (
              <span
                key={status}
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status]?.bg ?? "bg-surface-secondary"} ${STATUS_COLORS[status]?.text ?? "text-content-secondary"}`}
              >
                {count} {status}
              </span>
            ) : null
          )}
        </div>
      </div>

      {/* Hypothesis List */}
      <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
        {scorecard.hypotheses.map((h) => {
          const statusColor = STATUS_COLORS[h.status] ?? STATUS_COLORS.active;
          const riskColor = RISK_COLORS[h.speculativeRisk] ?? RISK_COLORS.mixed;
          const confidencePct = Math.round(h.confidence * 100);
          const totalEvidence = h.supportingEvidenceCount + h.contradictingEvidenceCount;

          return (
            <div key={String(h._id)} className="px-4 py-3">
              {/* Label + Title */}
              <div className="flex items-start gap-2">
                <span className="shrink-0 rounded bg-gray-800 dark:bg-white/[0.12] px-1.5 py-0.5 text-xs font-mono font-bold text-white dark:text-gray-100">
                  {h.label}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-content leading-tight">
                    {h.title}
                  </p>
                </div>
              </div>

              {/* Badges row */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor.bg} ${statusColor.text}`}>
                  {h.status}
                </span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${riskColor.bg} ${riskColor.text}`}>
                  {h.speculativeRisk}
                </span>
              </div>

              {/* Confidence bar */}
              <div className="mt-2">
                <div className="flex items-center justify-between text-xs text-content-secondary mb-1">
                  <span>Confidence</span>
                  <span className="font-mono">{confidencePct}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-surface-secondary dark:bg-white/[0.08] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      confidencePct >= 75 ? "bg-green-500"
                      : confidencePct >= 50 ? "bg-blue-500"
                      : confidencePct >= 30 ? "bg-amber-500"
                      : "bg-red-400"
                    }`}
                    style={{ width: `${confidencePct}%` }}
                  />
                </div>
              </div>

              {/* Evidence counts */}
              {totalEvidence > 0 && (
                <div className="mt-2 flex items-center gap-3 text-xs text-content-secondary">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
                    {h.supportingEvidenceCount} supporting
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full bg-red-400" />
                    {h.contradictingEvidenceCount} contradicting
                  </span>
                </div>
              )}

              {/* Falsification criteria */}
              {h.falsificationCriteria && (
                <p className="mt-2 text-xs text-content-muted italic leading-snug">
                  Disproved if: {h.falsificationCriteria}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default HypothesisScorecard;
