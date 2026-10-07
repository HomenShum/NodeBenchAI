/**
 * GlobalPulsePage — `/pulse` route. Cross-entity digest of today's
 * unread pulse reports, grouped by entity.
 *
 * This is the "inbox" view over the Pulse system:
 *   - one row per (entity, date) pulse that's unread
 *   - click through to /entity-pulse/:slug for the full per-entity view
 *   - "Mark all read" action clears the badge everywhere
 *
 * Data source: pulseReports (populated by convex/domains/pulse/pulseWorker
 * — which itself layers on the existing LinkedIn daily-brief pipeline for
 * its synthesis substrate).
 */

import { memo, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { Activity, ArrowRight, Clock } from "lucide-react";
import { useConvexApi } from "@/lib/convexApi";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import { buildEntityPath, buildEntityPulsePath } from "@/features/entities/lib/entityExport";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";

type DigestRow = {
  _id: string;
  entitySlug: string;
  dateKey: string;
  summaryMarkdown?: string;
  changeCount: number;
  materialChangeCount: number;
  generatedAt: number;
};

function formatRelative(ts: number): string {
  const age = Math.max(0, Date.now() - ts);
  if (age < 60_000) return "just now";
  const m = Math.round(age / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * Inner query-ful component — isolated so a server-side error on
 * `listUnreadDigest` (e.g. schema drift before deploy) triggers an
 * ErrorBoundary that degrades to the empty state instead of crashing
 * the whole /pulse route. Same pattern as NotebookDismissalsSync.
 */
function GlobalPulseBody({
  onData,
}: {
  onData: (rows: DigestRow[]) => void;
}) {
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  // Deployed surface is `listRecentPulsesForOwner` (owner-scoped, most
  // recent first). Client-side filters to unread rows so the "inbox" feel
  // matches the original intent without adding a duplicate server query.
  const raw = useQuery(
    (api as any)?.domains?.product?.pulseReports?.listRecentPulsesForOwner ?? ("skip" as never),
    (api as any)?.domains?.product?.pulseReports?.listRecentPulsesForOwner
      ? ({ anonymousSessionId, limit: 40 } as never)
      : ("skip" as never),
  ) as (DigestRow & { readAt?: number | null })[] | undefined;

  useEffect(() => {
    if (raw === undefined) return;
    onData(raw.filter((r) => !r.readAt && r.changeCount > 0).slice(0, 20));
  }, [raw, onData]);
  return null;
}

function GlobalPulsePageBase() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<DigestRow[] | undefined>(undefined);
  const [queryFailed, setQueryFailed] = useState(false);
  const effectiveRows = queryFailed ? [] : rows;

  // Isolated query subtree — must mount unconditionally so the query
  // actually fires (an early-return skeleton would leave it unmounted
  // and stuck forever). Renders null, only plumbs state up via onData.
  const queryBody = (
    <ErrorBoundary section="Pulse digest" fallback={null} onError={() => setQueryFailed(true)}>
      <GlobalPulseBody onData={setRows} />
    </ErrorBoundary>
  );

  if (effectiveRows === undefined) {
    return (
      <div className="mx-auto max-w-[720px] px-6 py-12">
        {queryBody}
        <div className="h-7 w-40 animate-pulse rounded bg-white/[0.04]" />
        <div className="mt-8 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-white/[0.03]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[min(960px,95vw)] px-4 py-8 sm:px-6" data-view-mode="read">
      {queryBody}
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            Pulse
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {effectiveRows.length === 0
              ? "You're caught up. No unread deltas across your entities."
              : `${effectiveRows.length} unread pulse${effectiveRows.length === 1 ? "" : "s"} across your entities.`}
          </p>
        </div>
      </header>

      {effectiveRows.length === 0 ? (
        <div className="mt-12 flex flex-col items-center justify-center text-center">
          <Activity className="h-8 w-8 text-gray-400 dark:text-gray-500" />
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            Pulse generates a daily digest of what changed on each entity.
            Check back tomorrow — or trigger a refresh from an entity page.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {effectiveRows.map((row) => {
            const hasMaterial = row.materialChangeCount > 0;
            return (
              <li key={row._id}>
                <button
                  type="button"
                  onClick={() => navigate(buildEntityPulsePath(row.entitySlug))}
                  className="group flex w-full items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 text-left transition-colors hover:border-[var(--accent-primary)]/40 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.02] dark:hover:bg-white/[0.04]"
                >
                  <div className="mt-0.5 flex-shrink-0">
                    {hasMaterial ? (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]">
                        <span className="text-sm font-semibold">
                          {row.materialChangeCount}
                        </span>
                      </div>
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-white/[0.04] dark:text-gray-400">
                        <Activity className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {row.entitySlug}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500">
                        <Clock className="h-3 w-3" />
                        {row.dateKey}
                      </span>
                      <span className="text-[11px] text-gray-400 dark:text-gray-500">
                        · {formatRelative(row.generatedAt)}
                      </span>
                    </div>
                    {row.summaryMarkdown ? (
                      <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-gray-600 dark:text-gray-300">
                        {row.summaryMarkdown.replace(/^#+ .+$/gm, "").trim().slice(0, 240)}
                      </p>
                    ) : null}
                  </div>
                  <ArrowRight className="h-4 w-4 flex-shrink-0 text-gray-300 transition-colors group-hover:text-[var(--accent-primary)] dark:text-gray-600" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// buildEntityPath kept as an import hook for future pulse-to-notebook
// cross-links that preserve share tokens.
void buildEntityPath;

export const GlobalPulsePage = memo(GlobalPulsePageBase);
export default GlobalPulsePage;
