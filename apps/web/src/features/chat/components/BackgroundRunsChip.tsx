/**
 * BackgroundRunsChip — top-bar chip that shows the count of background-mode
 * runs still in progress. Appears on every surface so users always know
 * something is cooking even while they navigate away.
 *
 * Pattern: persistent background-mode visibility.
 *
 * Prior art:
 *   - macOS Finder — background-copy progress chip in the sidebar
 *   - GitHub Actions — "running" chip in the top nav
 *   - Vercel — "building" indicator on every page
 *   - Linear — long-running sync chip
 *
 * See: docs/archive/2026-q1/architecture-superseded/BACKGROUND_MODE_AND_RELIABILITY.md
 *      .claude/rules/async_reliability.md
 *
 * UX invariants:
 *  - Hidden when count is 0 (don't advertise nothing)
 *  - Single-click opens a slim drawer showing per-run progress
 *  - "Running" state uses reduced-motion-safe pulse (CSS animation only)
 *  - Accessible: aria-live polite so screen readers are informed of new runs
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type BackgroundRunsChipProps = {
  /** Number of background runs currently in progress. */
  runningCount: number;
  /** Number of background runs that need the user's attention (failed, partial). */
  attentionCount?: number;
  /** Click handler — parent opens the drawer. */
  onClick?: () => void;
  /** Extra classes. */
  className?: string;
};

export function BackgroundRunsChip({
  runningCount,
  attentionCount = 0,
  onClick,
  className,
}: BackgroundRunsChipProps) {
  // Announce count changes politely to screen readers via aria-live;
  // we do this by composing a visually-hidden status line.
  const [prevCount, setPrevCount] = useState(runningCount);
  useEffect(() => {
    setPrevCount(runningCount);
  }, [runningCount]);

  // Invariant: hide entirely when nothing is running AND nothing needs attention.
  if (runningCount === 0 && attentionCount === 0) return null;

  const label = runningCount === 1 ? "1 running" : `${runningCount} running`;
  const hasAttention = attentionCount > 0;
  const attentionLabel =
    attentionCount === 1 ? "1 needs attention" : `${attentionCount} need attention`;

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        aria-label={`Background runs: ${label}${hasAttention ? `, ${attentionLabel}` : ""}. Click to review.`}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]",
          runningCount > 0
            ? "border-[#d97757]/30 bg-[#d97757]/10 text-[#d97757] hover:bg-[#d97757]/15 dark:border-[#d97757]/40 dark:bg-[#d97757]/15"
            : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300",
          className,
        )}
      >
        {/* Pulse dot — reduced-motion-safe via media query in global CSS. */}
        {runningCount > 0 ? (
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d97757] opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#d97757]" />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full bg-amber-600 dark:bg-amber-400"
          />
        )}
        <span className="tabular-nums">{runningCount > 0 ? label : null}</span>
        {hasAttention ? (
          <>
            {runningCount > 0 ? <span aria-hidden="true">·</span> : null}
            <span className="tabular-nums">{attentionLabel}</span>
          </>
        ) : null}
      </button>

      {/* Polite live region for screen readers — announces count changes. */}
      <span role="status" aria-live="polite" className="sr-only">
        {runningCount !== prevCount
          ? runningCount > prevCount
            ? `Started a background run. ${label} now.`
            : `A background run finished. ${label} now.`
          : null}
      </span>
    </>
  );
}

export default BackgroundRunsChip;
