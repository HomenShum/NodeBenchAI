/**
 * EditorialHomeSurface — the single-column daily-edition render of
 * the redesign home (Phase 7a).  Gated behind `?edition=1` from
 * HomeSurface.tsx; the legacy render path is preserved for users
 * without the flag.
 *
 * Source spec: docs/architecture/HOME_EDITORIAL_REDESIGN.md (esp §3
 * Variant C, §5 data binding, §8 locked decisions).
 *
 * Layout: ONE column, max 720px, no card chrome, hairline rules
 * between sections.  Mobile and desktop are identical (per Variant C
 * — "mobile parity by construction").
 *
 * ─── Phase 7a follow-ups (2026-05-08) ───────────────────────────
 * Bug 0a — section numbers must be DYNAMIC.  Static "01..06" labels
 * break consecutive reading when conditional sections (hypotheses)
 * hide.  Fix: build a `visibleSections` array at the top, derive each
 * section's number from its index in that list, pass it to
 * `<EditorialSection number kicker ...>`.
 *
 * Bug 0b — kicker must be a STABLE labeled subtitle, never a raw
 * date.  The date appears once in the FormatStrip (`Today's edition ·
 * {dateString}`) and inline within sections that need it; the
 * eyebrow is always `{N} · {label}`.
 *
 * ─── Phase 7b additions ─────────────────────────────────────────
 * - Footnote `<sup>` anchors target `id="fn-{N}"` in §6, with
 *   `tabindex="-1"` on each `<li>` so screen readers focus the
 *   target.
 * - Right-rail `<EditionTOC>` (wide desktop only, ≥1440px) with scroll-spy
 *   active state.
 *
 * ─── Phase 7c additions ─────────────────────────────────────────
 * - `<FormatStrip>` beneath §1 header — PDF + Copy share-link.
 * - "Switch to classic" link in the header (reciprocal of the
 *   discoverability link added to LegacyHomeSurface).
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { UniversalComposer } from "../components/UniversalComposer";
import { StreamingMarkdown } from "../components/StreamingMarkdown";
import { EditorialSection } from "../components/edition/EditorialSection";
import { EditionErrorBoundary } from "../components/edition/EditionErrorBoundary";
import { EditionTOC, type EditionTOCEntry } from "../components/edition/EditionTOC";
import { FormatStrip } from "../components/edition/FormatStrip";
import { Footnote } from "../components/edition/Footnote";
import { VideoLiteEmbed } from "../components/edition/VideoLiteEmbed";
import { Scoreboard } from "../components/edition/Scoreboard";
import { CapabilitiesMap } from "../components/edition/CapabilitiesMap";
import { EvidenceChecklistStrip } from "../components/edition/EvidenceChecklistStrip";
import { isVideoUrl } from "../utils/videoProvider";
import { useTodayPulse } from "../hooks/useTodayPulse";
import { useTodayPulseSwr } from "../hooks/useTodayPulseSwr";
import { type EditionHypothesis } from "../hooks/useActiveHypotheses";
import { useActiveHypothesesSwr } from "../hooks/useActiveHypothesesSwr";
import { type EditionForecast } from "../hooks/useTopForecasts";
import { useTopForecastsSwr } from "../hooks/useTopForecastsSwr";
import { useLatestDailyBriefSnapshot } from "../hooks/useLatestDailyBriefSnapshot";
import { useLatestDailyBriefSnapshotSwr } from "../hooks/useLatestDailyBriefSnapshotSwr";
import { useCapabilitiesDeltaSwr } from "../hooks/useCapabilitiesDeltaSwr";
import { useEditionFootnotesSwr } from "../hooks/useEditionFootnotesSwr";
// P0 #3 — temporal browsing imports.  Note: useHomePulseLive +
// fixturePulseCards / watchlist / continueWorking from #285's branch
// were intentionally NOT carried forward here — P0 #1 removed those
// from the editorial path and they must not return.
import { useEditionView } from "../hooks/useEditionView";
import { useDailyEditionSwr } from "../hooks/useDailyEditionSwr";
import { useWeeklyDigestSwr } from "../hooks/useWeeklyDigestSwr";
import { useMonthlyRetrospectiveSwr } from "../hooks/useMonthlyRetrospectiveSwr";
import {
  useLiveArtifacts,
  type LiveArtifactsResult,
  type LiveArtifactSourceRow,
} from "../hooks/useLiveArtifacts";
import {
  getForecastReviewSummary,
  getHypothesisReviewSummary,
  getHypothesisReviewTitle,
  HOME_EVIDENCE_WATCHLIST_SECTION,
  HOME_AUDIENCE_RELEVANCE_SECTION,
} from "./EditorialHomeAudienceRelevance";
import { useOnlineStatus } from "../../../lib/performance/useOnlineStatus";
import { trackEvent } from "../../../lib/analytics";
import { getAnonymousProductSessionId } from "../../product/lib/productIdentity";
import {
  EditionSelector,
  type EditionSelection,
} from "../components/edition/EditionSelector";
import { Pill } from "../components/Pill";
import "../components/edition/edition.css";

interface Props {
  onAsk: (text: string) => void;
  onOpenReport: (id: string) => void;
}

const ABSENT = Symbol("absent");

/* ─── Helpers ───────────────────────────────────────────────────── */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

const DAY_MS = 86_400_000;

function clientDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isoWeekWindow(weekKey: string): { start: string; end: string } {
  const match = weekKey.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return { start: weekKey, end: weekKey };
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Day = new Date(jan4).getUTCDay() || 7;
  const week1Mon = jan4 - (jan4Day - 1) * DAY_MS;
  const startMs = week1Mon + (week - 1) * 7 * DAY_MS;
  return { start: clientDateKey(startMs), end: clientDateKey(startMs + 6 * DAY_MS) };
}

function monthWindow(monthKey: string): { start: string; end: string } {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return { start: monthKey, end: monthKey };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const startMs = Date.UTC(year, month - 1, 1);
  const endMs = Date.UTC(year, month, 1) - DAY_MS;
  return { start: clientDateKey(startMs), end: clientDateKey(endMs) };
}

function quarterWindow(quarterKey: string): { start: string; end: string } {
  const match = quarterKey.match(/^(\d{4})-Q([1-4])$/);
  if (!match) return { start: quarterKey, end: quarterKey };
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const startMonth = (quarter - 1) * 3;
  const startMs = Date.UTC(year, startMonth, 1);
  const endMs = Date.UTC(year, startMonth + 3, 1) - DAY_MS;
  return { start: clientDateKey(startMs), end: clientDateKey(endMs) };
}

function yearWindow(yearKey: string): { start: string; end: string } {
  return { start: `${yearKey}-01-01`, end: `${yearKey}-12-31` };
}

/**
 * Format an age in ms into a short human-readable string.  Used by the
 * offline banner so the user knows how stale the cached edition is.
 * Returns a bare "moments ago" for sub-minute, then "Nm", "Nh", "Nd".
 */
function formatAge(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return "moments ago";
  }
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "moments ago";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

/**
 * OfflineBanner — informational, NOT an alert, per
 * `.claude/rules/reexamine_a11y.md` (`role="status"` +
 * `aria-live="polite"`).  Renders when the browser is offline OR the
 * Convex websocket is disconnected; the cached edition is still
 * usable, so the banner is amber (warning), not red (error).
 *
 * Color is paired with explicit "You're offline" text + an icon-free
 * label so color-blind users still get the signal.
 *
 * Per `.claude/rules/agentic_reliability.md` HONEST_STATUS: this only
 * renders when the system is actually in a degraded state — no
 * theatre.
 */
function OfflineBanner({
  online,
  convexConnected,
  ageMs,
}: {
  online: boolean;
  convexConnected: boolean;
  ageMs: number | null;
}) {
  if (online && convexConnected) return null;
  const reason = !online ? "You're offline" : "Reconnecting to live data";
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="rd-offline-banner"
      data-online={online ? "true" : "false"}
      data-convex-connected={convexConnected ? "true" : "false"}
      className="rd-offline-banner"
    >
      <strong style={{ fontWeight: 600 }}>{reason}</strong>
      <span>
        {" "}
        — showing cached edition from {formatAge(ageMs)}.
      </span>
    </div>
  );
}

type CoordinatorStatus = "loading" | "ready" | "empty";

function statusFromCount(
  isLoading: boolean,
  count: number | null | undefined,
): CoordinatorStatus {
  if (isLoading) return "loading";
  return (count ?? 0) > 0 ? "ready" : "empty";
}

function HomePulseCoordinatorTrace({
  period,
  periodKey,
  pulses,
  hypotheses,
  forecasts,
  snapshot,
  liveArtifacts,
  artifactIds,
  windowLabel,
  windowStart,
  windowEnd,
  retrospectiveCount,
  retrospectiveSource = "live",
}: {
  period: "today" | "week" | "month" | "quarter" | "year";
  periodKey: string;
  pulses: ReturnType<typeof useTodayPulse>;
  hypotheses: EditionHypothesis[] | undefined;
  forecasts: EditionForecast[] | undefined;
  snapshot: ReturnType<typeof useLatestDailyBriefSnapshot>;
  liveArtifacts: LiveArtifactsResult;
  artifactIds: string[];
  windowLabel: string;
  windowStart: string;
  windowEnd: string;
  retrospectiveCount: number;
  retrospectiveSource?: string;
}) {
  const reportCount = liveArtifacts.reports.length;
  const sourceCount =
    liveArtifacts.details.reduce((total, detail) => total + detail.sourceRows.length, 0) +
    artifactIds.length;
  const actionCount = liveArtifacts.reports.reduce(
    (total, report) => total + report.followUps,
    0,
  );
  const pulseCount = pulses?.pulses.length ?? 0;
  const hypothesisCount = hypotheses?.length ?? 0;
  const forecastCount = forecasts?.length ?? 0;
  const cells = useMemo(() => [
    {
      label: "Memory",
      value: reportCount,
      status: statusFromCount(liveArtifacts.isLoading, reportCount),
    },
    {
      label: "Pulse",
      value: pulseCount,
      status: statusFromCount(pulses === undefined, pulseCount),
    },
    {
      label: "Reports",
      value: reportCount,
      status: statusFromCount(liveArtifacts.isLoading, reportCount),
    },
    {
      label: "Sources",
      value: sourceCount,
      status: statusFromCount(false, sourceCount),
    },
    {
      label: "Hypotheses",
      value: hypothesisCount,
      status: statusFromCount(hypotheses === undefined, hypothesisCount),
    },
    {
      label: "Forecasts",
      value: forecastCount,
      status: statusFromCount(forecasts === undefined, forecastCount),
    },
    {
      label: "Actions",
      value: actionCount,
      status: statusFromCount(liveArtifacts.isLoading, actionCount),
    },
    {
      label: "Rollup",
      value: retrospectiveCount,
      status: statusFromCount(false, retrospectiveCount),
    },
  ], [
    actionCount,
    forecastCount,
    forecasts,
    hypothesisCount,
    hypotheses,
    liveArtifacts.isLoading,
    pulseCount,
    pulses,
    reportCount,
    retrospectiveCount,
    sourceCount,
  ]);
  useEffect(() => {
    trackEvent("HOME-010.start", {
      period,
      periodKey,
      windowStart,
      windowEnd,
    });
    trackEvent("rollup.window.selected", {
      period,
      periodKey,
      windowStart,
      windowEnd,
      source: retrospectiveSource,
      count: retrospectiveCount,
    });
    for (const cell of cells) {
      trackEvent(`coordinator.fanIn.${cell.label.toLowerCase()}`, {
        period,
        periodKey,
        source: cell.label,
        status: cell.status,
        count: cell.value,
      });
    }
    trackEvent("HOME-010.complete", {
      period,
      periodKey,
      reports: reportCount,
      sources: sourceCount,
      actions: actionCount,
      retrospective: retrospectiveCount,
    });
  }, [
    actionCount,
    period,
    periodKey,
    reportCount,
    retrospectiveCount,
    retrospectiveSource,
    sourceCount,
    windowEnd,
    windowStart,
    cells,
  ]);

  return (
    <section
      className="rd-coordinator-trace"
      aria-label="Pulse provenance"
      data-home-pulse-coordinator
      data-run-id={`home-pulse-${period}-${periodKey}`}
      data-period={period}
      data-period-key={periodKey}
      data-window-start={windowStart}
      data-window-end={windowEnd}
      data-live-artifacts={liveArtifacts.isLive ? "true" : "false"}
      data-snapshot={snapshot ? "ready" : snapshot === undefined ? "loading" : "empty"}
      data-report-count={reportCount}
      data-source-count={sourceCount}
      data-action-count={actionCount}
      data-retrospective-count={retrospectiveCount}
      data-retrospective-source={retrospectiveSource}
      data-telemetry-traces="HOME-010.start coordinator.fanIn.* rollup.window.selected HOME-010.complete"
    >
      <div className="rd-coordinator-trace__head">
        <span className="rd-edition-meta">{windowLabel}</span>
        <span className="rd-edition-meta">
          {windowStart} to {windowEnd} - {retrospectiveSource}
        </span>
      </div>
      <div className="rd-coordinator-trace__grid">
        {cells.map((cell) => (
          <span
            key={cell.label}
            className="rd-coordinator-trace__cell"
            data-source={cell.label.toLowerCase()}
            data-status={cell.status}
          >
            <strong>{cell.value}</strong> {cell.label}
          </span>
        ))}
      </div>
    </section>
  );
}

function formatProbability(p: number | null): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  return `${Math.round(p * 100)}%`;
}

function formatProbabilityDelta(
  current: number | null,
  prev: number | null,
): { text: string; tone: "up" | "down" | "flat" } | null {
  if (current === null || prev === null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(prev)) return null;
  const pp = Math.round((current - prev) * 100);
  if (pp === 0) {
    return { text: `was ${Math.round(prev * 100)}%, ±0pp`, tone: "flat" };
  }
  return {
    text: `was ${Math.round(prev * 100)}%, ${pp > 0 ? "+" : ""}${pp}pp`,
    tone: pp > 0 ? "up" : "down",
  };
}

function renderPulseMarkdown(md: string): string[] {
  return md
    .split(/\r?\n\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 4);
}

/**
 * Extract video URLs from a chunk of markdown / prose text.  Returns
 * a deduped list capped at MAX_VIDEOS_PER_PULSE so a single rogue
 * pulse can't render 50 thumbnails.
 *
 * Captures bare URLs and markdown link syntax `[text](url)`.  The
 * detection regex is permissive (`https://...` until whitespace or `)`);
 * downstream `isVideoUrl` rejects anything that isn't a supported
 * provider.
 */
const MAX_VIDEOS_PER_PULSE = 3;

function extractVideoUrlsFromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/https:\/\/[^\s)\]]+/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of matches) {
    // Strip trailing punctuation that often follows a URL in prose.
    const cleaned = raw.replace(/[.,;:'"!?]+$/, "");
    if (seen.has(cleaned)) continue;
    if (!isVideoUrl(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= MAX_VIDEOS_PER_PULSE) break;
  }
  return out;
}

/* ─── Section descriptors ──────────────────────────────────────── */

interface SectionDescriptor {
  id: string;
  /** Stable label used in eyebrow + TOC.  NEVER a date. */
  kicker: string;
  /** Short TOC label (the rail uses this). */
  tocLabel: string;
  /** Section heading. */
  heading: string;
}

/* ─── §1 — What moved today ─────────────────────────────────────── */

function WhatMovedSection({
  number,
  kicker,
  heading,
  dateString,
  editionId,
  pulses,
}: {
  number: string;
  kicker: string;
  heading: string;
  dateString: string;
  editionId: string;
  pulses: ReturnType<typeof useTodayPulse>;
}) {
  if (pulses === undefined) {
    return (
      <EditorialSection
        id="what-moved"
        ariaLabel="What moved today"
        number={number}
        kicker={kicker}
        heading={heading}
      >
        <FormatStrip dateString={dateString} editionId={editionId} />
        <div className="rd-edition-skeleton" style={{ width: "92%" }} />
        <div className="rd-edition-skeleton" style={{ width: "78%" }} />
        <div className="rd-edition-skeleton" style={{ width: "84%" }} />
      </EditorialSection>
    );
  }
  const totalMaterial = pulses.pulses.reduce(
    (n, p) => n + (p.materialChangeCount ?? 0),
    0,
  );
  // P0 #2: provenance tells us whether this is the user's own pulse or
  // the public-trending fallback (or honestly empty).
  const provenance = pulses.provenance;
  const isTrending = provenance === "public-trending";

  return (
    <EditorialSection
      id="what-moved"
      ariaLabel="What moved today"
      number={number}
      kicker={kicker}
      heading={heading}
      data-provenance={provenance}
    >
      <FormatStrip dateString={dateString} editionId={editionId} />
      {isTrending && (
        <p
          className="rd-edition-trending-leadin"
          data-trending-leadin
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "baseline",
            gap: 8,
            margin: "0 0 10px",
            color: "var(--rd-ink-mute)",
            fontSize: 14,
          }}
        >
          <span
            data-provenance-badge
            aria-label="Public trending fallback"
            style={{
              fontFamily: "var(--rd-mono, ui-monospace, monospace)",
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--rd-accent, #d97757)",
              border: "1px solid var(--rd-accent, #d97757)",
              padding: "2px 6px",
              borderRadius: 3,
            }}
          >
            Public · trending
          </span>
          <span>
            You haven&rsquo;t run a pulse today. Here&rsquo;s what&rsquo;s
            trending publicly.
          </span>
        </p>
      )}
      {pulses.pulses.length === 0 ? (
        <p className="rd-edition-empty">
          No pulse generated yet today.
          {pulses.lastDateKey ? ` Last pulse: ${pulses.lastDateKey}.` : ""}
        </p>
      ) : (
        <>
          {!isTrending && (
            <p className="rd-edition-meta">
              <span
                className="rd-edition-delta"
                aria-label={`${totalMaterial} material changes`}
              >
                {totalMaterial} material change{totalMaterial === 1 ? "" : "s"}
              </span>{" "}
              across {pulses.pulses.length} entit
              {pulses.pulses.length === 1 ? "y" : "ies"}
            </p>
          )}
          <div className="rd-edition-prose">
            {pulses.pulses.map((p, i) => (
              <article
                key={p._id}
                data-pulse-entity={p.entitySlug}
                style={{ marginBottom: 18 }}
              >
                <p style={{ margin: "0 0 6px" }}>
                  <strong style={{ textTransform: "capitalize" }}>
                    {p.entitySlug.replace(/-/g, " ")}
                  </strong>{" "}
                  <span className="rd-edition-meta">
                    {isTrending
                      ? "· trending"
                      : `· ${p.changeCount} change${p.changeCount === 1 ? "" : "s"}${
                          p.materialChangeCount > 0
                            ? `, ${p.materialChangeCount} material`
                            : ""
                        }`}
                  </span>
                  <Footnote
                    id={`pulse-${i + 1}`}
                    index={i + 1}
                    label={`Pulse for ${p.entitySlug}`}
                  />
                </p>
                {p.summaryMarkdown
                  ? renderPulseMarkdown(p.summaryMarkdown).map((para, j) => (
                      <StreamingMarkdown
                        key={j}
                        text={para.replace(/^#+\s*/, "")}
                        streaming={false}
                      />
                    ))
                  : (
                    <p className="rd-edition-empty" style={{ padding: 0 }}>
                      Pulse generated; full summary pending.
                    </p>
                  )}
                {/* Video lite-embed: render a thumbnail card for any
                 * supported video URL that appears in the pulse
                 * markdown.  Capped at MAX_VIDEOS_PER_PULSE per
                 * article so one rogue pulse can't flood §1. */}
                {p.summaryMarkdown
                  ? extractVideoUrlsFromText(p.summaryMarkdown).map((vurl) => (
                      <VideoLiteEmbed
                        key={vurl}
                        url={vurl}
                        fallbackTitle={p.entitySlug.replace(/-/g, " ")}
                      />
                    ))
                  : null}
              </article>
            ))}
          </div>
        </>
      )}
    </EditorialSection>
  );
}

/* ─── §2 — Competing explanations ───────────────────────────────── */

function CompetingExplanationsSection({
  number,
  kicker,
  heading,
  hypotheses,
}: {
  number: string;
  kicker: string;
  heading: string;
  hypotheses: EditionHypothesis[];
}) {
  return (
    <EditorialSection
      id="competing-explanations"
      ariaLabel="Audience relevance and evidence review queue"
      number={number}
      kicker={kicker}
      heading={heading}
    >
      <div>
        {hypotheses.length === 0 ? (
          <p className="rd-edition-empty">
            No active hypothesis evidence changed in this edition. Use the
            changed reports, source rows, and actions below as the decision
            queue; NodeBench only elevates a thesis when citations and evidence
            checks move.
          </p>
        ) : hypotheses.map((h, i) => (
          <article
            key={h._id}
            className="rd-edition-hypothesis"
            data-hypothesis-id={h.hypothesisId}
            data-evidence-level={h.evidenceLevel}
          >
            <div className="rd-edition-hypothesis__head">
              <span className="rd-edition-hypothesis__label">{h.label}</span>
              <h3 className="rd-edition-hypothesis__title">
                {getHypothesisReviewTitle(h)}
                <Footnote
                  id={`hyp-${i + 1}`}
                  index={i + 1}
                  label={`Source for ${getHypothesisReviewTitle(h)}`}
                />
              </h3>
            </div>
            <p className="rd-edition-hypothesis__claim">
              {getHypothesisReviewSummary(h)}
            </p>
            <EvidenceChecklistStrip
              checklist={h.evidenceChecklist}
              passing={h.evidenceChecksPassing}
              total={h.evidenceChecksTotal}
              level={h.evidenceLevel}
            />
            {h.falsificationCriteria && (
              <p className="rd-edition-hypothesis__falsify">
                Escalate for review if: {h.falsificationCriteria}
              </p>
            )}
            <p className="rd-edition-hypothesis__tally">
              {h.supportingEvidenceCount} supporting · {h.contradictingEvidenceCount} contradicting · {h.threadName}
            </p>
          </article>
        ))}
      </div>
    </EditorialSection>
  );
}

/* ─── §3 — What to look at this week ────────────────────────────── */

function WhatToLookAtSection({
  number,
  kicker,
  heading,
  forecasts,
}: {
  number: string;
  kicker: string;
  heading: string;
  forecasts: EditionForecast[] | undefined;
}) {
  const navigate = useNavigate();
  if (forecasts === undefined) {
    return (
      <EditorialSection
        id="what-to-look-at"
        ariaLabel="Evidence watchlist"
        number={number}
        kicker={kicker}
        heading={heading}
      >
        <div className="rd-edition-skeleton" style={{ width: "85%" }} />
        <div className="rd-edition-skeleton" style={{ width: "60%" }} />
        <div className="rd-edition-skeleton" style={{ width: "75%" }} />
      </EditorialSection>
    );
  }

  return (
    <EditorialSection
      id="what-to-look-at"
      ariaLabel="Evidence watchlist"
      number={number}
      kicker={kicker}
      heading={heading}
    >
      {forecasts.length === 0 ? (
        <p className="rd-edition-empty">
          No evidence watchlist items have updates yet. Check back after the
          next source refresh.
        </p>
      ) : (
        <>
          <div>
            {forecasts.slice(0, 5).map((f) => {
              const delta = formatProbabilityDelta(f.probability, f.previousProbability);
              return (
                <article key={f._id} className="rd-edition-forecast" data-forecast-id={f._id}>
                  <p className="rd-edition-forecast__claim">
                    Forecast evidence review
                  </p>
                  <p className="rd-edition-meta">
                    {getForecastReviewSummary(f)}
                  </p>
                  <div className="rd-edition-forecast__row">
                    <span className="rd-edition-forecast__prob">
                      {formatProbability(f.probability)}
                    </span>
                    {delta && (
                      <span
                        className={`rd-edition-scoreboard__delta rd-edition-scoreboard__delta--${delta.tone}`}
                        aria-label={`Probability ${delta.text}`}
                      >
                        {delta.tone === "up" && "↑ "}
                        {delta.tone === "down" && "↓ "}
                        [{delta.text}]
                      </span>
                    )}
                    <span className="rd-edition-meta">
                      Resolves {f.resolutionDate}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="rd-edition-meta" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="rd-btn rd-btn--quiet rd-btn--sm"
              onClick={() => navigate("/forecasts")}
            >
              View all forecasts →
            </button>
          </p>
        </>
      )}
    </EditorialSection>
  );
}

/* ─── §4 — Scoreboard + Operations accordion ────────────────────── */

function ScoreboardSection({
  number,
  kicker,
  heading,
  snapshot,
}: {
  number: string;
  kicker: string;
  heading: string;
  snapshot: ReturnType<typeof useLatestDailyBriefSnapshot>;
}) {
  // Operations accordion removed (P0 #1 — 2026-05-09).
  //
  // The previous render leaned on `useHomePulseLive`, which has been a
  // stub since Sprint S4 (`{ pulse: [], isLive: false, isLoading: false }`),
  // and on a fixture import (`fixturePulseCards`, `continueWorking`,
  // `watchlist` from ../fixtures).  When the hook returned empty (always),
  // the accordion fell through to fixture data — exactly the kind of
  // silent fake the editorial home was promoted as the antidote to
  // (HOME_EDITORIAL_REDESIGN.md §0 / §3 Variant C).
  //
  // Per analyst-diagnostic + agentic_reliability HONEST_STATUS, we
  // delete the accordion entirely.  If a future iteration wants
  // operations on the editorial home, it should source from
  // `useLiveArtifacts` (the same path the legacy home now uses) — not
  // a direct call to `batchAutopilot.queries.getRecentRuns`, which the
  // stub's header comment explicitly forbade ("must not call unstable
  // operations queries from the public shell").
  if (snapshot === undefined) {
    return (
      <EditorialSection
        id="scoreboard"
        ariaLabel="Today's scoreboard"
        number={number}
        kicker={kicker}
        heading={heading}
      >
        <div className="rd-edition-skeleton" style={{ width: "100%", height: 28 }} />
        <div className="rd-edition-skeleton" style={{ width: "92%", height: 28 }} />
        <div className="rd-edition-skeleton" style={{ width: "85%", height: 28 }} />
      </EditorialSection>
    );
  }

  const stats = snapshot?.dashboardMetrics?.keyStats ?? [];

  return (
    <EditorialSection
      id="scoreboard"
      ariaLabel="Today's scoreboard"
      number={number}
      kicker={kicker}
      heading={heading}
    >
      <Scoreboard stats={stats} />
    </EditorialSection>
  );
}

/* ─── §5 — Capabilities map ─────────────────────────────────────── */

function ReportsTouchedSection({
  number,
  kicker,
  heading,
  snapshot,
  reports,
}: {
  number: string;
  kicker: string;
  heading: string;
  snapshot: ReturnType<typeof useLatestDailyBriefSnapshot>;
  reports?: LiveArtifactsResult["reports"];
}) {
  if (snapshot === undefined) {
    return (
      <EditorialSection
        id="reports-touched"
        ariaLabel="Reports touched"
        number={number}
        kicker={kicker}
        heading={heading}
      >
        <div className="rd-edition-skeleton" style={{ width: "88%" }} />
        <div className="rd-edition-skeleton" style={{ width: "64%" }} />
      </EditorialSection>
    );
  }

  const stats = snapshot?.dashboardMetrics?.keyStats ?? [];
  const generatedAt = snapshot?.generatedAt
    ? new Date(snapshot.generatedAt).toISOString().slice(0, 16)
    : null;
  const liveReports = reports ?? [];

  return (
    <EditorialSection
      id="reports-touched"
      ariaLabel="Reports touched"
      number={number}
      kicker={kicker}
      heading={heading}
    >
      {snapshot ? (
        <>
          <p>
            Latest daily brief snapshot: <strong>{snapshot.dateString}</strong>
            {generatedAt ? (
              <span className="rd-edition-meta"> - generated {generatedAt}Z</span>
            ) : null}
            .
          </p>
          {stats.length > 0 ? (
            <ul>
              {stats.slice(0, 4).map((stat: any, index: number) => (
                <li key={`${stat.label ?? "stat"}-${index}`} style={{ marginBottom: 6 }}>
                  <strong>{stat.label ?? "Metric"}</strong>
                  {stat.value !== undefined ? `: ${stat.value}` : ""}
                  {stat.delta !== undefined ? (
                    <span className="rd-edition-meta"> - {stat.delta}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rd-edition-empty" style={{ padding: 0 }}>
              Snapshot loaded, but no report metrics were attached.
            </p>
          )}
          {liveReports.length > 0 ? (
            <>
              <p className="rd-edition-meta" style={{ marginTop: 12 }}>
                Live report handles
              </p>
              <ul>
                {liveReports.map((report) => (
                  <li key={report.id} style={{ marginBottom: 6 }}>
                    <a href={`/redesign/reports/${report.id}`}>
                      {report.entity}
                    </a>{" "}
                    <span className="rd-edition-meta">
                      {report.kind} - {report.status} - {report.sources} sources -{" "}
                      {report.claims} claims - {report.followUps} follow-ups
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="rd-edition-empty" style={{ padding: 0 }}>
              No live report handles are available yet.
            </p>
          )}
        </>
      ) : (
        <p className="rd-edition-empty">
          No daily brief snapshot is available yet, so there are no report
          updates to attribute.
        </p>
      )}
    </EditorialSection>
  );
}

function ActionsCreatedSection({
  number,
  kicker,
  heading,
  pulses,
  hypotheses,
  forecasts,
  onAsk,
  reports,
  actionPrompt = "Turn today's Home Pulse actions into follow-ups and notebook patch proposals.",
  nudgeKey = "home-pulse-actions",
}: {
  number: string;
  kicker: string;
  heading: string;
  pulses: ReturnType<typeof useTodayPulse>;
  hypotheses: EditionHypothesis[] | undefined;
  forecasts: EditionForecast[] | undefined;
  onAsk: Props["onAsk"];
  reports?: LiveArtifactsResult["reports"];
  actionPrompt?: string;
  nudgeKey?: string;
}) {
  const createHomePulseNudge = useMutation(
    (api as unknown as {
      domains: {
        product: {
          nudges: {
            createHomePulseFollowupNudge: unknown;
          };
        };
      };
    }).domains.product.nudges.createHomePulseFollowupNudge as Parameters<
      typeof useMutation
    >[0],
  );
  const [nudgeState, setNudgeState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const materialChanges =
    pulses?.pulses.reduce((n, p) => n + (p.materialChangeCount ?? 0), 0) ?? 0;
  const reportFollowUps =
    reports?.reduce((total, report) => total + (report.followUps ?? 0), 0) ?? 0;
  const actionItems = [
    reportFollowUps > 0
      ? `${reportFollowUps} existing follow-up ${
          reportFollowUps === 1 ? "record is" : "records are"
        } already linked to live reports.`
      : null,
    materialChanges > 0
      ? `Refresh reports touched by ${materialChanges} material change${
          materialChanges === 1 ? "" : "s"
        }.`
      : null,
    hypotheses && hypotheses.length > 0
      ? `Review ${hypotheses.length} active hypothesis ${
          hypotheses.length === 1 ? "thread" : "threads"
        } before updating the notebook.`
      : null,
    forecasts && forecasts.length > 0
      ? `Check ${forecasts.length} forecast ${
          forecasts.length === 1 ? "move" : "moves"
        } for follow-up timing.`
      : null,
  ].filter((item): item is string => item !== null);
  const actionSummary =
    actionItems.length > 0
      ? actionItems.join(" ")
      : "Review the latest Home Pulse and decide which report, notebook, or source trail needs a follow-up.";

  const handleCreateNudge = async () => {
    setNudgeState("saving");
    trackEvent("HOME-015.start", {
      target: nudgeKey,
      actionCount: actionItems.length,
    });
    try {
      await createHomePulseNudge({
        anonymousSessionId: getAnonymousProductSessionId(),
        title: "Home Pulse follow-up",
        summary: actionSummary,
        actionLabel: "Open in Chat",
        actionTargetSurface: "chat",
        actionTargetId: nudgeKey,
      });
      trackEvent("action.created", {
        target: nudgeKey,
        surface: "inbox",
        actionCount: actionItems.length,
      });
      trackEvent("HOME-015.complete", {
        target: nudgeKey,
        status: "saved",
      });
      setNudgeState("saved");
    } catch (error) {
      console.error("[home-pulse] failed to create follow-up nudge", error);
      trackEvent("HOME-015.failed", {
        target: nudgeKey,
        status: "error",
      });
      setNudgeState("error");
    }
  };

  return (
    <EditorialSection
      id="actions-created"
      ariaLabel="Actions created"
      number={number}
      kicker={kicker}
      heading={heading}
    >
      {actionItems.length === 0 ? (
        <p className="rd-edition-empty">
          No automatic actions were created by this read-only Home render.
          Ask NodeBench to create a follow-up, notebook patch, or report refresh
          when a signal matters.
        </p>
      ) : (
        <>
          <ul>
            {actionItems.map((item) => (
              <li key={item} style={{ marginBottom: 8 }}>
                {item}
              </li>
            ))}
          </ul>
          <p className="rd-edition-meta" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="rd-btn rd-btn--quiet rd-btn--sm"
              onClick={handleCreateNudge}
              disabled={nudgeState === "saving"}
              data-telemetry-traces="HOME-015.start action.created HOME-015.complete"
            >
              {nudgeState === "saving" ? "Creating..." : "Create Inbox follow-up"}
            </button>{" "}
            <button
              type="button"
              className="rd-btn rd-btn--quiet rd-btn--sm"
              onClick={() => onAsk(actionPrompt)}
            >
              Open Chat
            </button>
            {nudgeState === "saved" ? (
              <span className="rd-edition-meta"> Follow-up saved to Inbox.</span>
            ) : nudgeState === "error" ? (
              <span className="rd-edition-meta"> Could not save. Open Chat instead.</span>
            ) : null}
          </p>
        </>
      )}
    </EditorialSection>
  );
}

function CapabilitiesSection({
  number,
  kicker,
  heading,
  snapshot,
}: {
  number: string;
  kicker: string;
  heading: string;
  snapshot: ReturnType<typeof useLatestDailyBriefSnapshot>;
}) {
  // Phase 9a §5: optional 7-day delta badges next to each readiness
  // bucket.  `null` while loading or if no prior snapshot to compare
  // — CapabilitiesMap renders nothing in that case (HONEST_STATUS).
  //
  // SWR-wrapped (Phase 9b follow-up, 2026-05-11): hydrate from IDB on
  // warm visits so badges paint instantly while Convex revalidates.
  // The hook is called unconditionally so the React hooks rule holds
  // even when the section returns the skeleton early below.
  const deltaSwr = useCapabilitiesDeltaSwr(7);
  const delta = deltaSwr.data;

  if (snapshot === undefined) {
    return (
      <EditorialSection
        id="capabilities"
        ariaLabel="Capabilities map"
        number={number}
        kicker={kicker}
        heading={heading}
      >
        <div className="rd-edition-skeleton" style={{ width: "70%", height: 18 }} />
        <div className="rd-edition-skeleton" style={{ width: "70%", height: 18 }} />
        <div className="rd-edition-skeleton" style={{ width: "70%", height: 18 }} />
      </EditorialSection>
    );
  }

  const tr = snapshot?.dashboardMetrics?.techReadiness ?? null;
  const caps = snapshot?.dashboardMetrics?.capabilities ?? null;

  return (
    <EditorialSection
      id="capabilities"
      ariaLabel="Capabilities map"
      number={number}
      kicker={kicker}
      heading={heading}
    >
      <CapabilitiesMap
        techReadiness={tr}
        capabilities={caps}
        deltas={delta?.deltas ?? null}
        windowDays={delta?.windowDays}
        priorDateString={delta?.priorDateString ?? null}
      />
    </EditorialSection>
  );
}

/* ─── §6 — Footnotes ──────────────────────────────────────────── */

function FootnotesSection({
  number,
  kicker,
  heading,
  artifactIds,
  liveSourceRows = [],
}: {
  number: string;
  kicker: string;
  heading: string;
  artifactIds: string[];
  liveSourceRows?: LiveArtifactSourceRow[];
}) {
  // SWR-wrapped (Phase 9b follow-up): footnotes paint from IDB cache on
  // warm visits while Convex revalidates.  The cache key uses sorted
  // ids so re-renders that produce the same logical set hit the cache.
  const { data } = useEditionFootnotesSwr(artifactIds, 8, 24);
  if (data === undefined) {
    return (
      <EditorialSection
        id="footnotes"
        ariaLabel="Footnotes and sources"
        number={number}
        kicker={kicker}
        heading={heading}
      >
        <div className="rd-edition-skeleton" style={{ width: "60%" }} />
        <div className="rd-edition-skeleton" style={{ width: "85%" }} />
      </EditorialSection>
    );
  }

  const liveRows = liveSourceRows
    .filter((row) => row.href)
    .filter(
      (row, index, rows) =>
        rows.findIndex((candidate) => candidate.href === row.href) === index,
    )
    .slice(0, 24);
  const totalCount = data.artifacts.length + data.industry.length + liveRows.length;

  return (
    <EditorialSection
      id="footnotes"
      ariaLabel="Footnotes and sources"
      number={number}
      kicker={kicker}
      heading={heading}
    >
      {totalCount === 0 ? (
        <p className="rd-edition-empty">
          No source artifacts referenced in today's edition.
        </p>
      ) : (
        <div className="rd-edition-footnotes">
          <ol>
            {data.artifacts.map((a, i) => {
              const isVid = isVideoUrl(a.url);
              return (
                <li key={a._id} id={`fn-${i + 1}`} tabIndex={-1}>
                  <span>
                    <a href={a.url} target="_blank" rel="noopener noreferrer">
                      {a.publisher || (() => {
                        try { return new URL(a.url).hostname; }
                        catch { return a.url; }
                      })()}
                    </a>
                    {a.firstQuote ? <> — &ldquo;{a.firstQuote}&rdquo;</> : null}
                    {a.publishedAt ? (
                      <span className="rd-edition-meta">
                        {" "}· {new Date(a.publishedAt).toISOString().slice(0, 10)}
                      </span>
                    ) : null}
                  </span>
                  {isVid ? (
                    <div style={{ marginTop: 6, maxWidth: 480 }}>
                      <VideoLiteEmbed
                        url={a.url}
                        fallbackTitle={a.publisher || a.firstQuote || a.url}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
            {data.industry.map((u, i) => {
              const isVid = isVideoUrl(u.url);
              return (
                <li
                  key={u._id}
                  id={`fn-${data.artifacts.length + i + 1}`}
                  tabIndex={-1}
                >
                  <span>
                    <a href={u.url} target="_blank" rel="noopener noreferrer">
                      {u.providerName} — {u.title}
                    </a>
                    <span className="rd-edition-meta">
                      {" "}· {new Date(u.scannedAt).toISOString().slice(0, 10)}
                    </span>
                  </span>
                  {isVid ? (
                    <div style={{ marginTop: 6, maxWidth: 480 }}>
                      <VideoLiteEmbed
                        url={u.url}
                        fallbackTitle={`${u.providerName} — ${u.title}`}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
            {liveRows.map((row, i) => (
              <li
                key={`live-${row.id}`}
                id={`fn-${data.artifacts.length + data.industry.length + i + 1}`}
                tabIndex={-1}
              >
                <span>
                  <a href={row.href} target="_blank" rel="noopener noreferrer">
                    {row.title}
                  </a>
                  <span className="rd-edition-meta">
                    {" "}Â· {row.refreshed}
                  </span>
                  {row.excerpt ? <> â€” &ldquo;{row.excerpt}&rdquo;</> : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </EditorialSection>
  );
}

/* ─── Archived-day render branch (P0 #3) ────────────────────────── */

function ArchivedDayBranch({
  dateKey,
  selection,
  onSwitchToClassic,
}: {
  dateKey: string;
  selection: { kind: "day"; dateKey: string };
  onSwitchToClassic: () => void;
}) {
  const navigate = useNavigate();
  const dailySwr = useDailyEditionSwr(dateKey);
  const data = dailySwr.data;
  const { online, convexConnected } = useOnlineStatus();
  // While loading we keep the chrome so the selector remains responsive.
  return (
    <div data-edition data-edition-kind="day">
      <div className="rd-edition-root">
        <header
          className="rd-edition-header"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            paddingBottom: 8,
            borderBottom: "1px solid var(--rd-edition-rule-strong)",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <Pill tone="accent">Daily edition</Pill>
            <span className="rd-edition-meta">
              Archive view · {dateKey}
            </span>
            <button
              type="button"
              onClick={onSwitchToClassic}
              className="rd-edition-switch"
              aria-label="Switch to classic home"
              data-edition-switch
              style={{
                marginLeft: "auto",
                background: "transparent",
                border: "none",
                color: "var(--rd-ink-mute)",
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "0.04em",
                cursor: "pointer",
                padding: "4px 8px",
                borderRadius: 4,
                textDecoration: "underline",
                textUnderlineOffset: 3,
              }}
            >
              ← Switch to classic home
            </button>
          </div>
          <EditionSelector
            selection={selection}
            earliestDateKey={
              data && !data.available ? data.earliestDateKey : null
            }
          />
          <h1
            style={{
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: "-0.6px",
              margin: 0,
              lineHeight: 1.18,
              color: "var(--rd-ink-strong)",
            }}
          >
            Edition · {dateKey}
          </h1>
        </header>

        <OfflineBanner
          online={online}
          convexConnected={convexConnected}
          ageMs={dailySwr.swr.ageMs}
        />

        {data === undefined && (
          <section data-section="day-loading" className="rd-edition-section">
            <div className="rd-edition-skeleton" style={{ width: "85%" }} />
            <div className="rd-edition-skeleton" style={{ width: "62%" }} />
          </section>
        )}

        {data && !data.available && (
          <section
            data-section="archive-empty"
            className="rd-edition-section"
            role="region"
            aria-label="No edition for this date"
          >
            <p className="rd-edition-empty">
              No edition for {dateKey}.
              {data.earliestDateKey ? (
                <>
                  {" "}
                  Earliest available edition:{" "}
                  <button
                    type="button"
                    className="rd-btn rd-btn--quiet rd-btn--sm"
                    onClick={() => {
                      const params = new URLSearchParams();
                      params.set("edition", data.earliestDateKey ?? "");
                      navigate(`/redesign?${params.toString()}`);
                    }}
                  >
                    {data.earliestDateKey}
                  </button>
                  .
                </>
              ) : null}
            </p>
          </section>
        )}

        {data && data.available && (
          <>
            <section
              data-section="archive-summary"
              data-section-number="01"
              data-section-kicker="Archived edition"
              className="rd-edition-section"
              role="region"
              aria-label={`Archived edition for ${dateKey}`}
            >
              <p className="rd-edition-meta">
                01 · Archived edition · {dateKey}
              </p>
              <p>
                Pulses captured this day: <strong>{data.pulses.length}</strong>.
                Hypotheses updated: <strong>{data.hypothesisCount}</strong>.
                Forecasts active: <strong>{data.forecastCount}</strong>.
              </p>
              {data.snapshot ? (
                <p className="rd-edition-meta">
                  Daily brief snapshot v{data.snapshot.version} captured at{" "}
                  {new Date(data.snapshot.generatedAt).toISOString().slice(0, 16)}Z.
                </p>
              ) : (
                <p className="rd-edition-empty" style={{ padding: 0 }}>
                  No daily-brief snapshot was captured this day.
                </p>
              )}
            </section>

            {data.snapshot && (
              <EditionErrorBoundary label="archive-scoreboard">
                <ScoreboardSection
                  number="02"
                  kicker="Scoreboard"
                  heading="Day's scoreboard"
                  snapshot={
                    data.snapshot as ReturnType<typeof useLatestDailyBriefSnapshot>
                  }
                />
              </EditionErrorBoundary>
            )}

            {data.snapshot && (
              <EditionErrorBoundary label="archive-capabilities">
                <CapabilitiesSection
                  number={data.snapshot ? "03" : "02"}
                  kicker="The capability landscape"
                  heading="Capabilities map"
                  snapshot={
                    data.snapshot as ReturnType<typeof useLatestDailyBriefSnapshot>
                  }
                />
              </EditionErrorBoundary>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Weekly-digest render branch (P0 #3) ───────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function WeeklyBranch({
  weekKey,
  selection,
  onSwitchToClassic,
}: {
  weekKey: string;
  selection: { kind: "week"; weekKey: string };
  onSwitchToClassic: () => void;
}) {
  const weeklySwr = useWeeklyDigestSwr(weekKey);
  const data = weeklySwr.data;
  const { online, convexConnected } = useOnlineStatus();
  return (
    <div data-edition data-edition-kind="week">
      <div className="rd-edition-root">
        <header
          className="rd-edition-header"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            paddingBottom: 8,
            borderBottom: "1px solid var(--rd-edition-rule-strong)",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <Pill tone="accent">This week</Pill>
            <span className="rd-edition-meta">
              {data && data.available
                ? `${data.startDateKey} → ${data.endDateKey}`
                : weekKey}
            </span>
            <button
              type="button"
              onClick={onSwitchToClassic}
              className="rd-edition-switch"
              aria-label="Switch to classic home"
              data-edition-switch
              style={{
                marginLeft: "auto",
                background: "transparent",
                border: "none",
                color: "var(--rd-ink-mute)",
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "0.04em",
                cursor: "pointer",
                padding: "4px 8px",
                borderRadius: 4,
                textDecoration: "underline",
                textUnderlineOffset: 3,
              }}
            >
              ← Switch to classic home
            </button>
          </div>
          <EditionSelector selection={selection} />
          <h1
            style={{
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: "-0.6px",
              margin: 0,
              lineHeight: 1.18,
              color: "var(--rd-ink-strong)",
            }}
          >
            This week
          </h1>
        </header>

        <OfflineBanner
          online={online}
          convexConnected={convexConnected}
          ageMs={weeklySwr.swr.ageMs}
        />

        {data === undefined && (
          <section data-section="week-loading" className="rd-edition-section">
            <div className="rd-edition-skeleton" style={{ width: "90%" }} />
            <div className="rd-edition-skeleton" style={{ width: "70%" }} />
          </section>
        )}

        {data && !data.available && (
          <section
            data-section="archive-empty"
            className="rd-edition-section"
            role="region"
            aria-label="No edition for this week"
          >
            <p className="rd-edition-empty">No edition for {weekKey}.</p>
          </section>
        )}

        {data && data.available && (
          <>
            <section
              data-section="week-totals"
              data-section-number="01"
              data-section-kicker="Week in totals"
              className="rd-edition-section"
              role="region"
              aria-label="This week in totals"
            >
              <p className="rd-edition-meta">01 · Week in totals</p>
              <p>
                <strong>{data.totals.materialChanges}</strong> material
                change{data.totals.materialChanges === 1 ? "" : "s"} across{" "}
                <strong>{data.totals.pulseCount}</strong> pulse
                {data.totals.pulseCount === 1 ? "" : "s"}.
              </p>
            </section>

            {data.topForecasts.length > 0 && (
              <section
                data-section="week-forecasts"
                data-section-number="02"
                data-section-kicker={HOME_EVIDENCE_WATCHLIST_SECTION.kicker}
                className="rd-edition-section"
                role="region"
                aria-label="Weekly evidence watchlist"
              >
                <p className="rd-edition-meta">
                  02 · {HOME_EVIDENCE_WATCHLIST_SECTION.kicker}
                </p>
                <ul>
                  {data.topForecasts.map((f) => {
                    const pp = Math.round(f.probabilityDelta * 100);
                    const tone = pp > 0 ? "up" : pp < 0 ? "down" : "flat";
                    return (
                      <li key={f._id} style={{ marginBottom: 8 }}>
                        <strong>Forecast evidence review</strong>{" "}
                        <span
                          className={`rd-edition-scoreboard__delta rd-edition-scoreboard__delta--${tone}`}
                        >
                          [
                          {pp > 0 ? "+" : ""}
                          {pp}pp]
                        </span>{" "}
                        <p className="rd-edition-meta">
                          {getForecastReviewSummary(f)}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {data.topHypotheses.length > 0 && (
              <section
                data-section="week-hypotheses"
                data-section-number="03"
                data-section-kicker="Evidence reviews"
                className="rd-edition-section"
                role="region"
                aria-label="Hypothesis evidence reviews this week"
              >
                <p className="rd-edition-meta">03 · Evidence reviews</p>
                <ul>
                  {data.topHypotheses.map((h) => (
                    <li key={h._id} style={{ marginBottom: 8 }}>
                      <strong>
                        {getHypothesisReviewTitle({ label: h.label })}
                      </strong>
                      <p className="rd-edition-meta">
                        {h.supportingEvidenceCount} supporting ·{" "}
                        {h.contradictingEvidenceCount} contradicting
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Monthly retrospective render branch (P0 #3, minimal) ──────── */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function MonthlyBranch({
  monthKey,
  selection,
  onSwitchToClassic,
}: {
  monthKey: string;
  selection: { kind: "month"; monthKey: string };
  onSwitchToClassic: () => void;
}) {
  const monthlySwr = useMonthlyRetrospectiveSwr(monthKey);
  const data = monthlySwr.data;
  const { online, convexConnected } = useOnlineStatus();
  return (
    <div data-edition data-edition-kind="month">
      <div className="rd-edition-root">
        <header
          className="rd-edition-header"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            paddingBottom: 8,
            borderBottom: "1px solid var(--rd-edition-rule-strong)",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <Pill tone="accent">This month</Pill>
            <span className="rd-edition-meta">{monthKey}</span>
            <button
              type="button"
              onClick={onSwitchToClassic}
              className="rd-edition-switch"
              aria-label="Switch to classic home"
              data-edition-switch
              style={{
                marginLeft: "auto",
                background: "transparent",
                border: "none",
                color: "var(--rd-ink-mute)",
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "0.04em",
                cursor: "pointer",
                padding: "4px 8px",
                borderRadius: 4,
                textDecoration: "underline",
                textUnderlineOffset: 3,
              }}
            >
              ← Switch to classic home
            </button>
          </div>
          <EditionSelector selection={selection} />
          <h1
            style={{
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: "-0.6px",
              margin: 0,
              lineHeight: 1.18,
              color: "var(--rd-ink-strong)",
            }}
          >
            This month
          </h1>
        </header>

        <OfflineBanner
          online={online}
          convexConnected={convexConnected}
          ageMs={monthlySwr.swr.ageMs}
        />

        {data === undefined && (
          <section data-section="month-loading" className="rd-edition-section">
            <div className="rd-edition-skeleton" style={{ width: "85%" }} />
          </section>
        )}

        {data && !data.available && (
          <section
            data-section="archive-empty"
            className="rd-edition-section"
            role="region"
            aria-label="No edition for this month"
          >
            <p className="rd-edition-empty">No edition for {monthKey}.</p>
          </section>
        )}

        {data && data.available && (
          <>
            <section
              data-section="month-summary"
              data-section-number="01"
              data-section-kicker="Top edition per week"
              className="rd-edition-section"
              role="region"
              aria-label="Top edition per week"
            >
              <p className="rd-edition-meta">01 · Top edition per week</p>
              {data.topPerWeek.length === 0 ? (
                <p className="rd-edition-empty" style={{ padding: 0 }}>
                  No daily-brief snapshots were captured in {monthKey}.
                </p>
              ) : (
                <ul>
                  {data.topPerWeek.map((w) => (
                    <li key={w.weekKey} style={{ marginBottom: 4 }}>
                      <strong>{w.weekKey}</strong> — top day {w.dateString}{" "}
                      <span className="rd-edition-meta">
                        ({w.keyStatCount} key stats)
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section
              data-section="month-brier"
              data-section-number="02"
              data-section-kicker="Forecast resolution"
              className="rd-edition-section"
              role="region"
              aria-label="Forecast resolution"
            >
              <p className="rd-edition-meta">02 · Forecast resolution</p>
              <p>
                <strong>{data.resolvedForecastCount}</strong> forecast
                {data.resolvedForecastCount === 1 ? "" : "s"} resolved this
                month.
                {data.meanBrier !== null
                  ? ` Mean Brier score: ${data.meanBrier.toFixed(3)}.`
                  : " No Brier scores recorded."}
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── EditorialHomeSurface root ─────────────────────────────────── */

function LongHorizonBranch({
  period,
  periodKey,
  selection,
  onAsk,
  onSwitchToClassic,
}: {
  period: "week" | "month" | "quarter" | "year";
  periodKey: string;
  selection:
    | Extract<EditionSelection, { kind: "week" }>
    | Extract<EditionSelection, { kind: "month" }>
    | Extract<EditionSelection, { kind: "quarter" }>
    | Extract<EditionSelection, { kind: "year" }>;
  onAsk: Props["onAsk"];
  onSwitchToClassic: () => void;
}) {
  const hypothesesSwr = useActiveHypothesesSwr(5);
  const forecastsSwr = useTopForecastsSwr(5);
  const todayPulseSwr = useTodayPulseSwr(12);
  const snapshotSwr = useLatestDailyBriefSnapshotSwr();
  const liveArtifacts = useLiveArtifacts(8);
  const weeklySwr = useWeeklyDigestSwr(period === "week" ? periodKey : null);
  const monthlySwr = useMonthlyRetrospectiveSwr(period === "month" ? periodKey : null);

  const hypotheses = hypothesesSwr.data;
  const forecasts = forecastsSwr.data;
  const todayPulse = todayPulseSwr.data;
  const snapshot = snapshotSwr.data;
  const weeklyData = weeklySwr.data;
  const monthlyData = monthlySwr.data;
  const { online, convexConnected } = useOnlineStatus();

  const oldestAgeMs = [
    hypothesesSwr.swr,
    forecastsSwr.swr,
    todayPulseSwr.swr,
    snapshotSwr.swr,
    weeklySwr.swr,
    monthlySwr.swr,
  ]
    .filter((s) => s.hydratedFromCache && !s.isLive)
    .map((s) => s.ageMs ?? 0)
    .reduce<number | null>(
      (acc, v) => (acc === null || v > acc ? v : acc),
      null,
    );

  const artifactIds = useMemo(() => {
    const ids: string[] = [];
    if (Array.isArray(hypotheses)) {
      for (const h of hypotheses) {
        for (const id of h.evidenceArtifactIds ?? []) ids.push(id);
      }
    }
    return ids;
  }, [hypotheses]);
  const liveSourceRows = useMemo(
    () => liveArtifacts.details.flatMap((detail) => detail.sourceRows),
    [liveArtifacts.details],
  );

  const visibleSections: SectionDescriptor[] = useMemo(
    () => [
      {
        id: "what-changed",
        kicker:
          period === "week"
            ? "This week"
            : period === "month"
              ? "This month"
              : period === "quarter"
                ? "This quarter"
                : "This year",
        tocLabel: "Changed",
        heading: "What changed",
      },
      {
        id: "competing-explanations",
        ...HOME_AUDIENCE_RELEVANCE_SECTION,
      },
      {
        id: "what-to-look-at",
        ...HOME_EVIDENCE_WATCHLIST_SECTION,
      },
      {
        id: "reports-touched",
        kicker: "Reports touched",
        tocLabel: "Reports",
        heading: "Reports touched",
      },
      {
        id: "footnotes",
        kicker: "Sources used",
        tocLabel: "Sources",
        heading: "Sources used",
      },
      {
        id: "actions-created",
        kicker: "Actions created",
        tocLabel: "Actions",
        heading: "Actions created",
      },
    ],
    [period],
  );

  const numberForId = useMemo(() => {
    const map = new Map<string, string>();
    visibleSections.forEach((s, i) => map.set(s.id, pad2(i + 1)));
    return map;
  }, [visibleSections]);

  const tocEntries: EditionTOCEntry[] = useMemo(
    () =>
      visibleSections.map((s) => ({
        id: s.id,
        number: numberForId.get(s.id) ?? "",
        label: s.tocLabel,
      })),
    [visibleSections, numberForId],
  );

  const title =
    period === "week"
      ? "This week"
      : period === "month"
        ? "This month"
        : period === "quarter"
          ? "This quarter"
          : "This year";
  const memoHeading =
    period === "week"
      ? "Weekly intelligence brief"
      : period === "month"
        ? "Monthly intelligence memo"
        : period === "quarter"
          ? "Quarterly intelligence memo"
          : "Annual intelligence memo";
  const pulseCount = todayPulse?.pulses.length ?? 0;
  const materialChanges =
    todayPulse?.pulses.reduce((n, p) => n + (p.materialChangeCount ?? 0), 0) ??
    0;
  const reportMetricCount = snapshot?.dashboardMetrics?.keyStats?.length ?? 0;
  const liveSourceCount = liveArtifacts.details.reduce(
    (total, detail) => total + detail.sourceRows.length,
    0,
  );
  const fallbackWindow =
    period === "week"
      ? isoWeekWindow(periodKey)
      : period === "month"
        ? monthWindow(periodKey)
        : period === "quarter"
          ? quarterWindow(periodKey)
          : yearWindow(periodKey);
  const windowStart =
    period === "week" && weeklyData?.available
      ? weeklyData.startDateKey
      : fallbackWindow.start;
  const windowEnd =
    period === "week" && weeklyData?.available
      ? weeklyData.endDateKey
      : fallbackWindow.end;
  const retrospectiveCount =
    period === "week" && weeklyData?.available
      ? weeklyData.topPulses.length +
        weeklyData.topForecasts.length +
        weeklyData.topHypotheses.length
      : period === "month" && monthlyData?.available
        ? monthlyData.topPerWeek.length +
          monthlyData.resolvedForecastCount +
          (monthlyData.dailyHistogram?.filter((value) => value > 0).length ?? 0)
        : period === "quarter" || period === "year"
          ? reportMetricCount + liveSourceCount
          : 0;
  const retrospectiveSource =
    period === "week"
      ? "weekly Convex rollup"
      : period === "month"
        ? "monthly Convex rollup"
        : "live coverage substrate";
  const actionPrompt =
    period === "week"
      ? "Turn this week Home Pulse into a weekly intelligence brief with report refresh proposals."
      : period === "month"
        ? "Turn this month Home Pulse into a monthly intelligence memo with coverage-book updates."
        : period === "quarter"
      ? "Turn this quarter Home Pulse into a quarterly intelligence memo with report refresh proposals."
      : "Turn this year Home Pulse into an annual intelligence memo with coverage-book updates.";

  return (
    <div data-edition data-edition-kind={period}>
      <EditionTOC entries={tocEntries} />
      <div className="rd-edition-root">
        <header
          className="rd-edition-header"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            paddingBottom: 8,
            borderBottom: "1px solid var(--rd-edition-rule-strong)",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <Pill tone="accent">{title}</Pill>
            <span className="rd-edition-meta">{periodKey}</span>
            <button
              type="button"
              onClick={onSwitchToClassic}
              className="rd-edition-switch"
              aria-label="Switch to classic home"
              data-edition-switch
              style={{
                marginLeft: "auto",
                background: "transparent",
                border: "none",
                color: "var(--rd-ink-mute)",
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "0.04em",
                cursor: "pointer",
                padding: "4px 8px",
                borderRadius: 4,
                textDecoration: "underline",
                textUnderlineOffset: 3,
              }}
            >
              Switch to classic home
            </button>
          </div>
          <EditionSelector selection={selection} />
          <h1
            style={{
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: "-0.6px",
              margin: 0,
              lineHeight: 1.18,
              color: "var(--rd-ink-strong)",
            }}
          >
            {memoHeading}
          </h1>
          <p
            style={{
              fontSize: 15.5,
              lineHeight: 1.55,
              color: "var(--rd-ink-mute)",
              margin: 0,
            }}
          >
            A long-horizon Home Pulse composed from live pulse, hypothesis,
            forecast, source, and daily brief state. Historical aggregation is
            explicit; no fixture fallback is used.
          </p>
        </header>

        <UniversalComposer
          onSubmit={(text) => onAsk(text)}
          onChatNow={(text) => onAsk(text)}
          placeholder={`Ask to extend ${title.toLowerCase()}...`}
        />

        <OfflineBanner
          online={online}
          convexConnected={convexConnected}
          ageMs={oldestAgeMs}
        />

        <HomePulseCoordinatorTrace
          period={period}
          periodKey={periodKey}
          pulses={todayPulse}
          hypotheses={hypotheses}
          forecasts={forecasts}
          snapshot={snapshot}
          liveArtifacts={liveArtifacts}
          artifactIds={artifactIds}
          windowLabel={`${memoHeading} coordinator`}
          windowStart={windowStart}
          windowEnd={windowEnd}
          retrospectiveCount={retrospectiveCount}
          retrospectiveSource={retrospectiveSource}
        />

        <EditorialSection
          id="what-changed"
          ariaLabel="What changed"
          number={numberForId.get("what-changed") ?? "01"}
          kicker={visibleSections[0].kicker}
          heading="What changed"
        >
          <p>
            NodeBench is tracking <strong>{pulseCount}</strong> current pulse
            item{pulseCount === 1 ? "" : "s"} with{" "}
            <strong>{materialChanges}</strong> material change
            {materialChanges === 1 ? "" : "s"} in the live Home substrate.
          </p>
          {todayPulse === undefined ? (
            <div className="rd-edition-skeleton" style={{ width: "82%" }} />
          ) : todayPulse.pulses.length === 0 ? (
            <p className="rd-edition-empty" style={{ padding: 0 }}>
              No live pulse items are available for this rollup yet.
            </p>
          ) : (
            <ul>
              {todayPulse.pulses.slice(0, 4).map((p) => (
                <li key={p._id} style={{ marginBottom: 6 }}>
                  <strong>{p.entitySlug.replace(/-/g, " ")}</strong>:{" "}
                  {p.changeCount} change{p.changeCount === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
          )}
        </EditorialSection>

        <CompetingExplanationsSection
          number={numberForId.get("competing-explanations") ?? "02"}
          kicker={HOME_AUDIENCE_RELEVANCE_SECTION.kicker}
          heading={HOME_AUDIENCE_RELEVANCE_SECTION.heading}
          hypotheses={hypotheses ?? []}
        />

        <WhatToLookAtSection
          number={numberForId.get("what-to-look-at") ?? "03"}
          kicker={HOME_EVIDENCE_WATCHLIST_SECTION.kicker}
          heading={HOME_EVIDENCE_WATCHLIST_SECTION.heading}
          forecasts={forecasts}
        />

        <ReportsTouchedSection
          number={numberForId.get("reports-touched") ?? "04"}
          kicker="Reports touched"
          heading="Reports touched"
          snapshot={snapshot}
          reports={liveArtifacts.reports}
        />

        <FootnotesSection
          number={numberForId.get("footnotes") ?? "05"}
          kicker="Sources used"
          heading="Sources used"
          artifactIds={artifactIds}
          liveSourceRows={liveSourceRows}
        />

        <ActionsCreatedSection
          number={numberForId.get("actions-created") ?? "06"}
          kicker="Actions created"
          heading="Actions created"
          pulses={todayPulse}
          hypotheses={hypotheses}
          forecasts={forecasts}
          reports={liveArtifacts.reports}
          onAsk={onAsk}
          actionPrompt={actionPrompt}
          nudgeKey={`home-pulse-actions-${period}-${periodKey}`}
        />

        <section
          data-section="memory-saved"
          className="rd-edition-section"
          role="region"
          aria-label="Memory saved"
        >
          <p className="rd-edition-meta">
            Memory saved: {reportMetricCount} live metric
            {reportMetricCount === 1 ? "" : "s"} reused from the latest daily
            brief snapshot instead of re-searching.
          </p>
          <button
            type="button"
            className="rd-btn rd-btn--quiet rd-btn--sm"
            onClick={() => onAsk(actionPrompt)}
          >
            Build the memo in Chat
          </button>
        </section>
      </div>
    </div>
  );
}

export function EditorialHomeSurface({ onAsk }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const selection = useEditionView();
  const onSwitchToClassic = () => {
    const params = new URLSearchParams(location.search);
    params.delete("edition");
    params.set("classic", "1");
    navigate(`${location.pathname}?${params.toString()}`, { replace: true });
  };

  // P0 #3: temporal branches use their own queries.  The "today"
  // branch (default + ?edition=1) keeps the existing today-render
  // path intact.
  if (selection.kind === "day") {
    return (
      <ArchivedDayBranch
        dateKey={selection.dateKey}
        selection={selection}
        onSwitchToClassic={onSwitchToClassic}
      />
    );
  }
  if (selection.kind === "week") {
    return (
      <LongHorizonBranch
        period="week"
        periodKey={selection.weekKey}
        selection={selection}
        onAsk={onAsk}
        onSwitchToClassic={onSwitchToClassic}
      />
    );
  }
  if (selection.kind === "month") {
    return (
      <LongHorizonBranch
        period="month"
        periodKey={selection.monthKey}
        selection={selection}
        onAsk={onAsk}
        onSwitchToClassic={onSwitchToClassic}
      />
    );
  }
  if (selection.kind === "quarter") {
    return (
      <LongHorizonBranch
        period="quarter"
        periodKey={selection.quarterKey}
        selection={selection}
        onAsk={onAsk}
        onSwitchToClassic={onSwitchToClassic}
      />
    );
  }
  if (selection.kind === "year") {
    return (
      <LongHorizonBranch
        period="year"
        periodKey={selection.yearKey}
        selection={selection}
        onAsk={onAsk}
        onSwitchToClassic={onSwitchToClassic}
      />
    );
  }

  return (
    <TodayRender
      onAsk={onAsk}
      selection={selection}
      onSwitchToClassic={onSwitchToClassic}
    />
  );
}

/* ─── Today render (Phase 7a-d body, lifted into a helper) ──────── */

function TodayRender({
  onAsk,
  selection,
  onSwitchToClassic,
}: {
  onAsk: Props["onAsk"];
  selection: { kind: "today" };
  onSwitchToClassic: () => void;
}) {
  // SWR wrappers: hydrate from IndexedDB cache on second-and-subsequent
  // visits so /redesign paints instantly while Convex revalidates.  See
  // src/lib/performance/idbSwrCache.ts for the bounded LRU + timeout
  // contract.  Per HONEST_STATUS, each `.swr` payload exposes
  // `hydratedFromCache` + `isLive` so we can render a quiet cache notice.
  //
  // Phase 9b follow-up (2026-05-11): footnotes + capabilities delta +
  // temporal hooks are also SWR-wrapped (see imports).  The aggregate
  // chip below + offline banner cover the editorial-home cache surface.
  const hypothesesSwr = useActiveHypothesesSwr(5);
  const forecastsSwr = useTopForecastsSwr(5);
  const todayPulseSwr = useTodayPulseSwr(12);
  const snapshotSwr = useLatestDailyBriefSnapshotSwr();
  const liveArtifacts = useLiveArtifacts(8);

  const hypotheses = hypothesesSwr.data;
  const forecasts = forecastsSwr.data;
  const todayPulse = todayPulseSwr.data;
  const snapshot = snapshotSwr.data;

  // Aggregate cache state — chip renders only when at least one
  // section is showing cached data and not yet swapped to live.  The
  // capabilities delta + footnotes + temporal sections wrap their own
  // SWR inside the child components, but the four §1-§4 wrappers here
  // are the dominant signal for the chip.  Aggregating all 7 would
  // require lifting state out of §5 + §6, which is gold-plating: any
  // of the four below being cached means the home is in cache mode.
  const cacheNoticeActive =
    (hypothesesSwr.swr.hydratedFromCache && !hypothesesSwr.swr.isLive) ||
    (forecastsSwr.swr.hydratedFromCache && !forecastsSwr.swr.isLive) ||
    (todayPulseSwr.swr.hydratedFromCache && !todayPulseSwr.swr.isLive) ||
    (snapshotSwr.swr.hydratedFromCache && !snapshotSwr.swr.isLive);

  // Offline detection — when the browser reports offline OR the Convex
  // websocket has dropped, we show an explicit banner so the user
  // doesn't silently consume stale cache.  Pair with the cache-notice
  // chip: chip = "we're getting fresh data", banner = "we can't right
  // now".
  const { online, convexConnected } = useOnlineStatus();
  // Oldest cached value still in play — use it for the banner copy.
  const oldestAgeMs = [
    hypothesesSwr.swr,
    forecastsSwr.swr,
    todayPulseSwr.swr,
    snapshotSwr.swr,
  ]
    .filter((s) => s.hydratedFromCache && !s.isLive)
    .map((s) => s.ageMs ?? 0)
    .reduce<number | null>(
      (acc, v) => (acc === null || v > acc ? v : acc),
      null,
    );

  // Collect artifactIds from §2's hypotheses for footnotes (§6).
  const artifactIds = useMemo(() => {
    const ids: string[] = [];
    if (Array.isArray(hypotheses)) {
      for (const h of hypotheses) {
        for (const id of h.evidenceArtifactIds ?? []) ids.push(id);
      }
    }
    void todayPulse;
    void ABSENT;
    return ids;
  }, [hypotheses, todayPulse]);
  const liveSourceRows = useMemo(
    () => liveArtifacts.details.flatMap((detail) => detail.sourceRows),
    [liveArtifacts.details],
  );

  // ── Build the visible-section list ─────────────────────────────
  // Bug 0a fix — section numbers are derived from the index in this
  // array, not hardcoded.  When `competing-explanations` hides
  // (no active hypotheses), every later section's number shifts down
  // by one so the eye reads consecutive 01 → 02 → 03 → 04 → 05.
  const visibleSections: SectionDescriptor[] = useMemo(() => {
    const sections: SectionDescriptor[] = [];
    sections.push({
      id: "what-moved",
      kicker: "Daily brief",
      tocLabel: "Changed",
      heading: "What changed",
    });
    sections.push({
      id: "competing-explanations",
      ...HOME_AUDIENCE_RELEVANCE_SECTION,
    });
    sections.push({
      id: "what-to-look-at",
      ...HOME_EVIDENCE_WATCHLIST_SECTION,
    });
    sections.push({
      id: "reports-touched",
      kicker: "Reports touched",
      tocLabel: "Reports",
      heading: "Reports touched",
    });
    sections.push({
      id: "footnotes",
      kicker: "Sources used",
      tocLabel: "Sources",
      heading: "Sources used",
    });
    sections.push({
      id: "actions-created",
      kicker: "Actions created",
      tocLabel: "Actions",
      heading: "Actions created",
    });
    return sections;
  }, []);

  // Map section id → its computed number for use in render.
  const numberForId = useMemo(() => {
    const map = new Map<string, string>();
    visibleSections.forEach((s, i) => map.set(s.id, pad2(i + 1)));
    return map;
  }, [visibleSections]);

  const tocEntries: EditionTOCEntry[] = useMemo(
    () =>
      visibleSections.map((s) => ({
        id: s.id,
        number: numberForId.get(s.id) ?? "",
        label: s.tocLabel,
      })),
    [visibleSections, numberForId],
  );

  // Derive a stable date string + edition id for the format strip.
  // The date prefers the daily-brief snapshot, falls back to today's
  // pulse `dateKey`, then a current-day ISO slice as a last resort.
  const dateString =
    snapshot?.dateString ??
    (todayPulse ? todayPulse.dateKey : new Date().toISOString().slice(0, 10));
  // Use the daily-brief snapshot id when present so the share URL
  // points to a stable artifact; fall back to the date key.
  const editionId =
    snapshot?._id ?? (todayPulse?.dateKey ?? "current");
  const todayRetrospectiveCount =
    (snapshot?.dashboardMetrics?.keyStats?.length ?? 0) +
    liveArtifacts.details.reduce(
      (total, detail) => total + detail.sourceRows.length,
      0,
    );

  // Helper to look up a section's data and bail out cleanly when it's
  // not in the visible list.
  const find = (id: string) =>
    visibleSections.find((s) => s.id === id);
  const wm = find("what-moved")!;
  const ce = find("competing-explanations")!;
  const wl = find("what-to-look-at")!;
  const rt = find("reports-touched")!;
  const fn = find("footnotes")!;
  const ac = find("actions-created")!;

  return (
    <div data-edition>
      <EditionTOC entries={tocEntries} />
      <div className="rd-edition-root">
        <header
          className="rd-edition-header"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            paddingBottom: 8,
            borderBottom: "1px solid var(--rd-edition-rule-strong)",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <Pill tone="accent">Daily edition</Pill>
            <span className="rd-edition-meta">
              Single-document brief · max 720px · keyboard-first
            </span>
            <button
              type="button"
              onClick={onSwitchToClassic}
              className="rd-edition-switch"
              aria-label="Switch to classic home"
              data-edition-switch
              style={{
                marginLeft: "auto",
                background: "transparent",
                border: "none",
                color: "var(--rd-ink-mute)",
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "0.04em",
                cursor: "pointer",
                padding: "4px 8px",
                borderRadius: 4,
                textDecoration: "underline",
                textUnderlineOffset: 3,
              }}
            >
              ← Switch to classic home
            </button>
          </div>
          <EditionSelector selection={selection} />
          <h1
            style={{
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: "-0.6px",
              margin: 0,
              lineHeight: 1.18,
              color: "var(--rd-ink-strong)",
            }}
          >
            Daily Brief
          </h1>
          <p
            style={{
              fontSize: 15.5,
              lineHeight: 1.55,
              color: "var(--rd-ink-mute)",
              margin: 0,
            }}
          >
            What changed, why it matters, what to do next, reports touched,
            sources used, and actions created from live NodeBench context.
          </p>
        </header>

        <UniversalComposer
          onSubmit={(text) => onAsk(text)}
          onChatNow={(text) => onAsk(text)}
          placeholder="Ask to extend today's edition…"
        />

        <OfflineBanner
          online={online}
          convexConnected={convexConnected}
          ageMs={oldestAgeMs}
        />

        {cacheNoticeActive && (
          <div
            role="status"
            aria-live="polite"
            data-testid="rd-cache-notice"
            className="rd-cache-notice"
          >
            Showing cached edition · refreshing…
          </div>
        )}

        <HomePulseCoordinatorTrace
          period="today"
          periodKey={dateString}
          pulses={todayPulse}
          hypotheses={hypotheses}
          forecasts={forecasts}
          snapshot={snapshot}
          liveArtifacts={liveArtifacts}
          artifactIds={artifactIds}
          windowLabel="Daily Brief coordinator"
          windowStart={dateString}
          windowEnd={dateString}
          retrospectiveCount={todayRetrospectiveCount}
          retrospectiveSource="daily Convex/live substrate"
        />

        <EditionErrorBoundary label="what-moved">
          <WhatMovedSection
            number={numberForId.get(wm.id) ?? "01"}
            kicker={wm.kicker}
            heading={wm.heading}
            dateString={dateString}
            editionId={editionId}
            pulses={todayPulse}
          />
        </EditionErrorBoundary>

        <EditionErrorBoundary label="competing-explanations">
          <CompetingExplanationsSection
            number={numberForId.get(ce.id) ?? "02"}
            kicker={ce.kicker}
            heading={ce.heading}
            hypotheses={hypotheses ?? []}
          />
        </EditionErrorBoundary>

        <EditionErrorBoundary label="what-to-look-at">
          <WhatToLookAtSection
            number={numberForId.get(wl.id) ?? "03"}
            kicker={wl.kicker}
            heading={wl.heading}
            forecasts={forecasts}
          />
        </EditionErrorBoundary>

        <EditionErrorBoundary label="reports-touched">
          <ReportsTouchedSection
            number={numberForId.get(rt.id) ?? "04"}
            kicker={rt.kicker}
            heading={rt.heading}
            snapshot={snapshot}
            reports={liveArtifacts.reports}
          />
        </EditionErrorBoundary>

        <EditionErrorBoundary label="footnotes">
          <FootnotesSection
            number={numberForId.get(fn.id) ?? "05"}
            kicker={fn.kicker}
            heading={fn.heading}
            artifactIds={artifactIds}
            liveSourceRows={liveSourceRows}
          />
        </EditionErrorBoundary>

        <EditionErrorBoundary label="actions-created">
          <ActionsCreatedSection
            number={numberForId.get(ac.id) ?? "06"}
            kicker={ac.kicker}
            heading={ac.heading}
            pulses={todayPulse}
            hypotheses={hypotheses}
            forecasts={forecasts}
            reports={liveArtifacts.reports}
            onAsk={onAsk}
            nudgeKey={`home-pulse-actions-${dateString}`}
          />
        </EditionErrorBoundary>
      </div>
    </div>
  );
}
