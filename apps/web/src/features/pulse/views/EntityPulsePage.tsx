/**
 * EntityPulsePage — `/entity/:slug/pulse` route.
 *
 * Per-entity daily digest view. Same notebook-surface rendering contract
 * as the main entity page (so the read experience feels like a Notion
 * page, not a dashboard), but the source of truth is `pulseReports`
 * instead of live `productBlocks`.
 *
 * Pulse as a surface:
 *   - Daily cadence (one row per entity per day)
 *   - Read-leaning (markdown summary + material change count)
 *   - Mark-all-read on mount
 *   - Date scrubber navigates older pulses
 *   - Accept item → promotes a pulse bullet into main notebook
 *     (lands as an agent-authored productBlocks row; Accept-to-freeze
 *     pattern mirrors DiligenceDecorationPlugin semantics)
 *
 * Pattern: layered on top of the LinkedIn daily-brief pipeline
 * (convex/domains/research/dailyBriefWorker.ts) — same synthesis /
 * fact-check substrate, different sink (pulseReports vs LinkedIn API).
 */

import { memo, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { useConvexApi } from "@/lib/convexApi";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import { buildEntityPulsePath, buildEntityPath } from "@/features/entities/lib/entityExport";
import { cn } from "@/lib/utils";

type PulseRow = {
  _id: string;
  dateKey: string;
  status: "generating" | "ready" | "failed";
  summaryMarkdown?: string;
  changeCount: number;
  materialChangeCount: number;
  generatedAt: number;
  readAt: number | null;
  errorMessage?: string;
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

function EntityPulsePageBase() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();

  // Resolve canonical /entity/:slug/pulse(/:dateKey), legacy /entity-pulse/:slug,
  // or the cockpit-flattened ?entity= query param.
  const routeTarget = useMemo(() => {
    const canonicalMatch = location.pathname.match(
      /^\/entity[/\\]([^/\\]+)[/\\]pulse(?:[/\\](\d{4}-\d{2}-\d{2}))?$/i,
    );
    if (canonicalMatch) {
      return {
        slug: decodeURIComponent(canonicalMatch[1]),
        dateKey: canonicalMatch[2] ?? null,
      };
    }

    const legacyMatch = location.pathname.match(/^\/entity-pulse[/\\](.+)$/i);
    if (legacyMatch) {
      return {
        slug: decodeURIComponent(legacyMatch[1]),
        dateKey: null,
      };
    }

    return {
      slug: searchParams.get("entity") ?? null,
      dateKey: searchParams.get("dateKey"),
    };
  }, [location.pathname, searchParams]);
  const slug = routeTarget.slug;

  const pulses = useQuery(
    (api as any)?.domains?.product?.pulseReports?.listPulsesForEntity ?? ("skip" as never),
    slug
      ? ({ anonymousSessionId, entitySlug: slug, limit: 14 } as never)
      : ("skip" as never),
  ) as PulseRow[] | undefined;

  const markPulseRead = useMutation(
    (api as any)?.domains?.product?.pulseReports?.markPulseRead ??
      ("skip" as never),
  );

  // Default to today's pulse; scrubber moves through older dates.
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  useEffect(() => {
    setSelectedDateKey(routeTarget.dateKey ?? null);
  }, [routeTarget.dateKey, slug]);
  const selectedPulse = useMemo(() => {
    if (!pulses || pulses.length === 0) return null;
    if (selectedDateKey) {
      return pulses.find((p) => p.dateKey === selectedDateKey) ?? pulses[0];
    }
    return pulses[0];
  }, [pulses, selectedDateKey]);

  // Mark unread pulses read on mount (once per slug change). Iterates
  // per-row since the deployed pulseReports module exposes a single-row
  // markPulseRead; the per-entity list is already bounded to 14 rows.
  useEffect(() => {
    if (!slug || !pulses || pulses.length === 0) return;
    if (!(api as any)?.domains?.product?.pulseReports?.markPulseRead) return;
    const unread = pulses.filter((p) => !p.readAt);
    if (unread.length === 0) return;
    for (const p of unread) {
      markPulseRead({ anonymousSessionId, pulseId: p._id as unknown as never }).catch(() => {
        // Non-fatal — badge will retry on next visit.
      });
    }
  }, [anonymousSessionId, api, markPulseRead, pulses, slug]);

  if (!slug) return null;

  if (pulses === undefined) {
    return (
      <div className="mx-auto max-w-[720px] px-6 py-12">
        <div className="h-6 w-48 animate-pulse rounded bg-white/[0.04]" />
        <div className="mt-4 h-4 w-full animate-pulse rounded bg-white/[0.04]" />
        <div className="mt-2 h-4 w-5/6 animate-pulse rounded bg-white/[0.04]" />
      </div>
    );
  }

  return (
    <div
      // Single-column notebook shell — same 920px cap as EntityNotebookLive,
      // so breadcrumb + date scrubber live in the same column as the sheet.
      // `data-view-mode="read"` further narrows the article to 720px via
      // the global CSS rule in index.css (classic document rhythm).
      className="mx-auto w-full max-w-[920px] px-4 py-6 pb-16 sm:px-6 sm:py-8"
      data-view-mode="read"
    >
      {/* Sticky breadcrumb — same shape as the entity page so the user */}
      {/* doesn't re-learn navigation. */}
      <div className="sticky top-0 z-30 -mx-4 mb-5 border-b border-black/[0.04] bg-white/85 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 dark:border-white/[0.06] dark:bg-[#151413]/85">
        <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(buildEntityPath(slug))}
              className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-gray-500 transition-colors hover:bg-black/[0.04] hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.04] dark:hover:text-gray-200"
            >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to {slug}</span>
          </button>
          <div className="h-4 w-px shrink-0 bg-gray-200 dark:bg-white/[0.08]" aria-hidden="true" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
            Pulse · {slug}
          </h2>
        </div>
      </div>

      {/* Empty state — no pulse yet */}
      {pulses.length === 0 ? (
        <article className="notebook-sheet">
          <div className="mx-auto max-w-[640px] py-16 text-center">
            <Clock className="mx-auto h-8 w-8 text-gray-400 dark:text-gray-500" />
            <h1 className="mt-4 text-xl font-semibold text-gray-900 dark:text-gray-100">
              No pulse yet
            </h1>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Pulse generates a daily digest of what changed on this entity.
              Your first pulse will appear here after the next daily cron run.
            </p>
          </div>
        </article>
      ) : null}

      {/* Date scrubber + latest pulse */}
      {pulses.length > 0 && selectedPulse ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {pulses.slice(0, 7).map((p) => {
              const isActive = p.dateKey === selectedPulse.dateKey;
              const latestDateKey = pulses[0]?.dateKey ?? null;
              return (
                <button
                  key={p._id}
                  type="button"
                  onClick={() => {
                    setSelectedDateKey(p.dateKey);
                    navigate(buildEntityPulsePath(slug, p.dateKey === latestDateKey ? null : p.dateKey));
                  }}
                  className={cn(
                    "relative rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
                    isActive
                      ? "bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]"
                      : "text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.04] dark:hover:text-gray-200",
                  )}
                >
                  {p.dateKey}
                  {p.materialChangeCount > 0 ? (
                    <span className="ml-1.5 inline-flex items-center rounded-full bg-[var(--accent-primary)]/20 px-1.5 py-0.5 text-[10px] text-[var(--accent-primary)]">
                      {p.materialChangeCount}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <article className="notebook-sheet">
            <header className="mb-6 border-b border-gray-200/70 pb-4 dark:border-white/10">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                <Clock className="h-3 w-3" />
                <span>{selectedPulse.dateKey}</span>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span>{formatRelative(selectedPulse.generatedAt)}</span>
                {selectedPulse.status === "generating" ? (
                  <>
                    <span className="text-gray-300 dark:text-gray-600">·</span>
                    <span className="text-amber-500">generating…</span>
                  </>
                ) : selectedPulse.status === "failed" ? (
                  <>
                    <span className="text-gray-300 dark:text-gray-600">·</span>
                    <span className="inline-flex items-center gap-1 text-rose-500">
                      <AlertCircle className="h-3 w-3" />
                      failed
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-gray-300 dark:text-gray-600">·</span>
                    <span className="inline-flex items-center gap-1 text-emerald-500">
                      <CheckCircle2 className="h-3 w-3" />
                      ready
                    </span>
                  </>
                )}
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                {selectedPulse.changeCount === 0
                  ? "Quiet day"
                  : selectedPulse.materialChangeCount > 0
                    ? `${selectedPulse.materialChangeCount} material change${selectedPulse.materialChangeCount === 1 ? "" : "s"}`
                    : `${selectedPulse.changeCount} signal${selectedPulse.changeCount === 1 ? "" : "s"}`}
              </h1>
            </header>

            {selectedPulse.errorMessage ? (
              <div className="mb-4 rounded-md border border-rose-400/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
                {selectedPulse.errorMessage}
              </div>
            ) : null}

            {/* Markdown summary rendered as plain prose for now. The full */}
            {/* rendering-into-Tiptap-substrate wire-up lands with the worker */}
            {/* once pulseLens ships. */}
            <div className="prose prose-sm max-w-none whitespace-pre-line text-[15px] leading-[1.6] text-gray-700 dark:text-gray-200">
              {selectedPulse.summaryMarkdown || "Pulse generated — no material changes detected."}
            </div>
          </article>
        </>
      ) : null}
    </div>
  );
}

export const EntityPulsePage = memo(EntityPulsePageBase);
export default EntityPulsePage;
