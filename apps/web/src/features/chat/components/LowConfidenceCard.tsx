/**
 * LowConfidenceCard
 *
 * Visible surface for the backend's retrieval-confidence signal. Rendered
 * alongside any search response whose `retrievalConfidence` is "low" OR
 * that includes a `lowConfidenceCard` payload from the server guard.
 *
 * Checkpoint 4 — "Trust is enforced, not implied." We never fabricate
 * specifics when retrieval is thin; we surface it and offer escalation.
 *
 * Backend source: server/routes/search.ts (guard attaches card to /search
 * response), convex/domains/agents/safety/lowConfidenceGuard.ts (logic).
 */

import { memo } from "react";

export interface LowConfidenceCardPayload {
  kind?: string;
  title?: string;
  body?: string;
  ctaLabel?: string;
  ctaAction?: string;
  snippetCount?: number;
  reason?: string;
}

export interface LowConfidenceCardProps {
  payload: LowConfidenceCardPayload;
  onEscalate?: () => void;
  onDismiss?: () => void;
}

export const LowConfidenceCard = memo(function LowConfidenceCard({
  payload,
  onEscalate,
  onDismiss,
}: LowConfidenceCardProps) {
  const title = payload.title ?? "Limited sources — answer provisional";
  const body =
    payload.body ??
    "I don't have enough fresh sources to answer this confidently. Running a deeper research pass would surface more context.";
  const ctaLabel = payload.ctaLabel ?? "Run deep research";
  const snippetCount = typeof payload.snippetCount === "number" ? payload.snippetCount : null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="low-confidence-card"
      className="relative mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left dark:border-amber-500/20 dark:bg-amber-500/[0.06]"
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/[0.12] dark:text-amber-300"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[14px] font-semibold text-amber-900 dark:text-amber-100">
              {title}
            </h3>
            {snippetCount !== null ? (
              <span
                data-testid="low-confidence-source-count"
                className="shrink-0 rounded-full border border-amber-300 bg-white/60 px-2 py-[2px] text-[11px] font-medium text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/[0.12] dark:text-amber-200"
              >
                {snippetCount} {snippetCount === 1 ? "source" : "sources"}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[13px] leading-5 text-amber-900/80 dark:text-amber-100/80">
            {body}
          </p>
          <div className="mt-3 flex items-center gap-2">
            {onEscalate ? (
              <button
                type="button"
                data-testid="low-confidence-escalate"
                onClick={onEscalate}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-amber-950"
              >
                {ctaLabel}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </button>
            ) : null}
            {onDismiss ? (
              <button
                type="button"
                onClick={onDismiss}
                className="inline-flex items-center rounded-lg border border-amber-300 bg-white/60 px-3 py-1.5 text-[13px] font-medium text-amber-800 transition-colors hover:bg-white dark:border-amber-400/30 dark:bg-transparent dark:text-amber-100 dark:hover:bg-amber-500/[0.10]"
              >
                Keep this answer
              </button>
            ) : null}
          </div>
          {payload.reason ? (
            <p className="mt-2 text-[11px] text-amber-800/70 dark:text-amber-200/60">
              {payload.reason}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
});
