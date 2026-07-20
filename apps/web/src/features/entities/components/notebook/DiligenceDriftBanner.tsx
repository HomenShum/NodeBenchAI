/**
 * DiligenceDriftBanner — entity-scoped regression alert.
 *
 * Renders a warning band above the notebook when recent runs for THIS
 * entity drop below a verified-rate floor. Designed to be:
 *   - silent when things are fine (no banner at all — zero noise)
 *   - explicit about the signal when it fires (% dropped, count of runs)
 *   - agency-giving: surfaces the dominant failure mode + suggested action
 *
 * Design posture:
 *   - BOUND: query capped at 50 rows (via listForEntity's default).
 *   - HONEST_SCORES: the rate is computed from actual rows — no hardcoded
 *     thresholds that fire artificially.
 *   - analyst_diagnostic.md: banner refuses to fire with < MIN_RUNS_FOR_ALERT
 *     sample — a single bad run is NOT a drift.
 *
 * Integration: <DiligenceDriftBanner entitySlug={slug} /> above the
 * verdict panel on the entity page.
 */

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";

type VerdictRow = {
  _id: string;
  verdict: string;
  judgedAt: number;
};

export type DiligenceDriftBannerProps = {
  entitySlug: string;
  /** Number of recent runs to evaluate (default 20). */
  windowSize?: number;
  /** Minimum verified rate below which we surface the alert (default 0.6). */
  verifiedRateFloor?: number;
  /** Don't fire unless we have this many recent runs (default 5). */
  minRunsForAlert?: number;
  className?: string;
};

type DriftState =
  | { kind: "hidden" }
  | { kind: "warn"; verifiedRate: number; total: number; failedCount: number; needsReviewCount: number };

export function computeDriftState(
  verdicts: ReadonlyArray<VerdictRow>,
  opts: {
    windowSize: number;
    verifiedRateFloor: number;
    minRunsForAlert: number;
  },
): DriftState {
  if (!verdicts || verdicts.length < opts.minRunsForAlert) return { kind: "hidden" };
  const window = verdicts.slice(0, opts.windowSize);
  const verified = window.filter((v) => v.verdict === "verified").length;
  const failedCount = window.filter((v) => v.verdict === "failed").length;
  const needsReviewCount = window.filter((v) => v.verdict === "needs_review").length;
  const verifiedRate = window.length === 0 ? 0 : verified / window.length;
  if (verifiedRate >= opts.verifiedRateFloor) return { kind: "hidden" };
  return {
    kind: "warn",
    verifiedRate,
    total: window.length,
    failedCount,
    needsReviewCount,
  };
}

export function DiligenceDriftBanner({
  entitySlug,
  windowSize = 20,
  verifiedRateFloor = 0.6,
  minRunsForAlert = 5,
  className,
}: DiligenceDriftBannerProps) {
  const verdicts = useQuery(api.domains.product.diligenceJudge.listForEntity, {
    entitySlug,
    limit: Math.max(minRunsForAlert, windowSize),
  }) as ReadonlyArray<VerdictRow> | undefined;

  const state = useMemo(() => {
    if (!verdicts) return { kind: "hidden" as const };
    return computeDriftState(verdicts, { windowSize, verifiedRateFloor, minRunsForAlert });
  }, [verdicts, windowSize, verifiedRateFloor, minRunsForAlert]);

  if (state.kind !== "warn") return null;

  const pct = Math.round(state.verifiedRate * 100);
  const floorPct = Math.round(verifiedRateFloor * 100);

  return (
    <div
      role="alert"
      aria-live="polite"
      className={
        "rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 " +
        (className ?? "")
      }
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium">Verdict drift</span>
        <span className="font-mono text-xs text-amber-200/80">
          {pct}% verified over last {state.total} runs (floor {floorPct}%)
        </span>
      </div>
      <p className="mt-1 text-xs text-amber-200/80">
        {state.failedCount > 0 ? `${state.failedCount} failed` : null}
        {state.failedCount > 0 && state.needsReviewCount > 0 ? " · " : ""}
        {state.needsReviewCount > 0 ? `${state.needsReviewCount} needs review` : null}
        {state.failedCount === 0 && state.needsReviewCount === 0
          ? "Recent runs dropped below the verified floor"
          : ""}
        . Open the verdict panel to see the dominant failing gate.
      </p>
    </div>
  );
}
