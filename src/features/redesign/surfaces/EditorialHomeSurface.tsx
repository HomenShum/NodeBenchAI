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
 * - Right-rail `<EditionTOC>` (desktop only, ≥1024px) with scroll-spy
 *   active state.
 *
 * ─── Phase 7c additions ─────────────────────────────────────────
 * - `<FormatStrip>` beneath §1 header — PDF + Copy share-link.
 * - "Switch to classic" link in the header (reciprocal of the
 *   discoverability link added to LegacyHomeSurface).
 */

import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
import { useCapabilitiesDelta } from "../hooks/useCapabilitiesDelta";
import { useEditionFootnotes } from "../hooks/useEditionFootnotes";
// P0 #3 — temporal browsing imports.  Note: useHomePulseLive +
// fixturePulseCards / watchlist / continueWorking from #285's branch
// were intentionally NOT carried forward here — P0 #1 removed those
// from the editorial path and they must not return.
import { useEditionView } from "../hooks/useEditionView";
import {
  useDailyEdition,
  useWeeklyDigest,
  useMonthlyRetrospective,
} from "../hooks/useTemporalEdition";
import { EditionSelector } from "../components/edition/EditionSelector";
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
      ariaLabel="The competing explanations"
      number={number}
      kicker={kicker}
      heading={heading}
    >
      <div>
        {hypotheses.map((h, i) => (
          <article
            key={h._id}
            className="rd-edition-hypothesis"
            data-hypothesis-id={h.hypothesisId}
            data-evidence-level={h.evidenceLevel}
          >
            <div className="rd-edition-hypothesis__head">
              <span className="rd-edition-hypothesis__label">{h.label}</span>
              <h3 className="rd-edition-hypothesis__title">
                {h.title}
                <Footnote
                  id={`hyp-${i + 1}`}
                  index={i + 1}
                  label={`Source for ${h.title}`}
                />
              </h3>
            </div>
            <p className="rd-edition-hypothesis__claim">{h.claimForm}</p>
            <EvidenceChecklistStrip
              checklist={h.evidenceChecklist}
              passing={h.evidenceChecksPassing}
              total={h.evidenceChecksTotal}
              level={h.evidenceLevel}
            />
            {h.falsificationCriteria && (
              <p className="rd-edition-hypothesis__falsify">
                Would change my mind: {h.falsificationCriteria}
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
        ariaLabel="What to look at this week"
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
      ariaLabel="What to look at this week"
      number={number}
      kicker={kicker}
      heading={heading}
    >
      {forecasts.length === 0 ? (
        <p className="rd-edition-empty">
          No active forecasts have updates yet. Check back after the next refresh.
        </p>
      ) : (
        <>
          <div>
            {forecasts.slice(0, 5).map((f) => {
              const delta = formatProbabilityDelta(f.probability, f.previousProbability);
              return (
                <article key={f._id} className="rd-edition-forecast" data-forecast-id={f._id}>
                  <p className="rd-edition-forecast__claim">{f.question}</p>
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

  // Phase 9a §5: optional 7-day delta badges next to each readiness
  // bucket.  `null` while loading or if no prior snapshot to compare
  // — CapabilitiesMap renders nothing in that case (HONEST_STATUS).
  const delta = useCapabilitiesDelta(7);

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
}: {
  number: string;
  kicker: string;
  heading: string;
  artifactIds: string[];
}) {
  const data = useEditionFootnotes(artifactIds, 8, 24);
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

  const totalCount = data.artifacts.length + data.industry.length;

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
  const data = useDailyEdition(dateKey);
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

function WeeklyBranch({
  weekKey,
  selection,
  onSwitchToClassic,
}: {
  weekKey: string;
  selection: { kind: "week"; weekKey: string };
  onSwitchToClassic: () => void;
}) {
  const data = useWeeklyDigest(weekKey);
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
                data-section-kicker="Top forecast moves"
                className="rd-edition-section"
                role="region"
                aria-label="Top forecast moves"
              >
                <p className="rd-edition-meta">02 · Top forecast moves</p>
                <ul>
                  {data.topForecasts.map((f) => {
                    const pp = Math.round(f.probabilityDelta * 100);
                    const tone = pp > 0 ? "up" : pp < 0 ? "down" : "flat";
                    return (
                      <li key={f._id} style={{ marginBottom: 8 }}>
                        <strong>{f.question}</strong>{" "}
                        <span
                          className={`rd-edition-scoreboard__delta rd-edition-scoreboard__delta--${tone}`}
                        >
                          [
                          {pp > 0 ? "+" : ""}
                          {pp}pp]
                        </span>{" "}
                        <span className="rd-edition-meta">
                          → {Math.round(f.probability * 100)}% by{" "}
                          {f.resolutionDate}
                        </span>
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
                data-section-kicker="Hypotheses moved"
                className="rd-edition-section"
                role="region"
                aria-label="Hypotheses moved this week"
              >
                <p className="rd-edition-meta">03 · Hypotheses moved</p>
                <ul>
                  {data.topHypotheses.map((h) => (
                    <li key={h._id} style={{ marginBottom: 8 }}>
                      <strong>
                        {h.label} {h.title}
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

function MonthlyBranch({
  monthKey,
  selection,
  onSwitchToClassic,
}: {
  monthKey: string;
  selection: { kind: "month"; monthKey: string };
  onSwitchToClassic: () => void;
}) {
  const data = useMonthlyRetrospective(monthKey);
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
      <WeeklyBranch
        weekKey={selection.weekKey}
        selection={selection}
        onSwitchToClassic={onSwitchToClassic}
      />
    );
  }
  if (selection.kind === "month") {
    return (
      <MonthlyBranch
        monthKey={selection.monthKey}
        selection={selection}
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
  const hypothesesSwr = useActiveHypothesesSwr(5);
  const forecastsSwr = useTopForecastsSwr(5);
  const todayPulseSwr = useTodayPulseSwr(12);
  const snapshotSwr = useLatestDailyBriefSnapshotSwr();

  const hypotheses = hypothesesSwr.data;
  const forecasts = forecastsSwr.data;
  const todayPulse = todayPulseSwr.data;
  const snapshot = snapshotSwr.data;

  // Aggregate cache state — chip renders only when at least one
  // section is showing cached data and not yet swapped to live.
  const cacheNoticeActive =
    (hypothesesSwr.swr.hydratedFromCache && !hypothesesSwr.swr.isLive) ||
    (forecastsSwr.swr.hydratedFromCache && !forecastsSwr.swr.isLive) ||
    (todayPulseSwr.swr.hydratedFromCache && !todayPulseSwr.swr.isLive) ||
    (snapshotSwr.swr.hydratedFromCache && !snapshotSwr.swr.isLive);

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

  // ── Build the visible-section list ─────────────────────────────
  // Bug 0a fix — section numbers are derived from the index in this
  // array, not hardcoded.  When `competing-explanations` hides
  // (no active hypotheses), every later section's number shifts down
  // by one so the eye reads consecutive 01 → 02 → 03 → 04 → 05.
  const visibleSections: SectionDescriptor[] = useMemo(() => {
    const sections: SectionDescriptor[] = [];
    sections.push({
      id: "what-moved",
      kicker: "Today's edition",
      tocLabel: "Pulse",
      heading: "What moved today",
    });
    if (Array.isArray(hypotheses) && hypotheses.length > 0) {
      sections.push({
        id: "competing-explanations",
        kicker: "Hypotheses under test",
        tocLabel: "Hypotheses",
        heading: "The competing explanations",
      });
    }
    sections.push({
      id: "what-to-look-at",
      kicker: "Forecasts in motion",
      tocLabel: "Forecasts",
      heading: "What to look at this week",
    });
    sections.push({
      id: "scoreboard",
      kicker: "Scoreboard",
      tocLabel: "Scoreboard",
      heading: "Today's scoreboard",
    });
    sections.push({
      id: "capabilities",
      kicker: "The capability landscape",
      tocLabel: "Capabilities",
      heading: "Capabilities map",
    });
    sections.push({
      id: "footnotes",
      kicker: "Sources",
      tocLabel: "Sources",
      heading: "Footnotes",
    });
    return sections;
  }, [hypotheses]);

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

  // Helper to look up a section's data and bail out cleanly when it's
  // not in the visible list.
  const find = (id: string) =>
    visibleSections.find((s) => s.id === id);
  const wm = find("what-moved")!;
  const ce = find("competing-explanations");
  const wl = find("what-to-look-at")!;
  const sb = find("scoreboard")!;
  const cap = find("capabilities")!;
  const fn = find("footnotes")!;

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
            Today's intelligence brief
          </h1>
          <p
            style={{
              fontSize: 15.5,
              lineHeight: 1.55,
              color: "var(--rd-ink-mute)",
              margin: 0,
            }}
          >
            Pulled live from your pulse, hypotheses, forecasts, and the latest
            daily brief. Ask anything below to extend the edition.
          </p>
        </header>

        <UniversalComposer
          onSubmit={(text) => onAsk(text)}
          onChatNow={(text) => onAsk(text)}
          placeholder="Ask to extend today's edition…"
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

        {ce && Array.isArray(hypotheses) && hypotheses.length > 0 && (
          <EditionErrorBoundary label="competing-explanations">
            <CompetingExplanationsSection
              number={numberForId.get(ce.id) ?? "02"}
              kicker={ce.kicker}
              heading={ce.heading}
              hypotheses={hypotheses}
            />
          </EditionErrorBoundary>
        )}

        <EditionErrorBoundary label="what-to-look-at">
          <WhatToLookAtSection
            number={numberForId.get(wl.id) ?? "03"}
            kicker={wl.kicker}
            heading={wl.heading}
            forecasts={forecasts}
          />
        </EditionErrorBoundary>

        <EditionErrorBoundary label="scoreboard">
          <ScoreboardSection
            number={numberForId.get(sb.id) ?? "04"}
            kicker={sb.kicker}
            heading={sb.heading}
            snapshot={snapshot}
          />
        </EditionErrorBoundary>

        <EditionErrorBoundary label="capabilities">
          <CapabilitiesSection
            number={numberForId.get(cap.id) ?? "05"}
            kicker={cap.kicker}
            heading={cap.heading}
            snapshot={snapshot}
          />
        </EditionErrorBoundary>

        <EditionErrorBoundary label="footnotes">
          <FootnotesSection
            number={numberForId.get(fn.id) ?? "06"}
            kicker={fn.kicker}
            heading={fn.heading}
            artifactIds={artifactIds}
          />
        </EditionErrorBoundary>
      </div>
    </div>
  );
}
