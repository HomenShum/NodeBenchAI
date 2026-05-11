/**
 * EditionPrintPage — Phase 7c print-friendly route at
 * `/redesign/edition/print?id=<editionId>`.
 *
 * Per the design doc Phase 7c "do NOT introduce new heavy
 * dependencies" — this is a stripped-down render of the same
 * editorial sections as the live home, but in a layout optimized for
 * `window.print()`.  The user clicks "PDF" in the FormatStrip, the
 * route opens in a new tab, the print dialog renders the edition.
 *
 * What's stripped:
 *   - The interactive composer + scroll-spy TOC
 *   - The "Switch to classic" link
 *   - All hover/focus chrome
 *   - Skeletons (we wait for data; if empty, render the empty state
 *     plainly)
 *
 * What's kept:
 *   - Section numbering (consecutive 01-N)
 *   - Footnote anchors (sup superscripts → fn-N targets)
 *   - The format strip caption (date + edition id) at the top so the
 *     PDF reader knows when it was generated
 *
 * Source spec: docs/architecture/HOME_EDITORIAL_REDESIGN.md Phase 7c
 * Rules: agentic_reliability (HONEST_STATUS — empty state is honest),
 *        reexamine_a11y (semantic landmarks preserved).
 */

import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { EditionErrorBoundary } from "../components/edition/EditionErrorBoundary";
import { Footnote } from "../components/edition/Footnote";
import { Scoreboard } from "../components/edition/Scoreboard";
import { CapabilitiesMap } from "../components/edition/CapabilitiesMap";
import { EvidenceChecklistStrip } from "../components/edition/EvidenceChecklistStrip";
import { useTodayPulse } from "../hooks/useTodayPulse";
import { useActiveHypotheses } from "../hooks/useActiveHypotheses";
import { useTopForecasts } from "../hooks/useTopForecasts";
import { useLatestDailyBriefSnapshot } from "../hooks/useLatestDailyBriefSnapshot";
import { useEditionFootnotes } from "../hooks/useEditionFootnotes";
import {
  getForecastReviewSummary,
  getHypothesisReviewSummary,
  getHypothesisReviewTitle,
  HOME_AUDIENCE_RELEVANCE_SECTION,
  HOME_EVIDENCE_WATCHLIST_SECTION,
} from "../surfaces/EditorialHomeAudienceRelevance";
import "../components/edition/edition.css";
import "../components/edition/edition-print.css";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatProbability(p: number | null): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  return `${Math.round(p * 100)}%`;
}

export function EditionPrintPage() {
  const location = useLocation();
  const editionId = useMemo(() => {
    return new URLSearchParams(location.search).get("id") ?? "current";
  }, [location.search]);

  const todayPulse = useTodayPulse(12);
  const hypotheses = useActiveHypotheses(5);
  const forecasts = useTopForecasts(5);
  const snapshot = useLatestDailyBriefSnapshot();

  const artifactIds = useMemo(() => {
    const ids: string[] = [];
    if (Array.isArray(hypotheses)) {
      for (const h of hypotheses) {
        for (const id of h.evidenceArtifactIds ?? []) ids.push(id);
      }
    }
    return ids;
  }, [hypotheses]);

  const footnoteData = useEditionFootnotes(artifactIds, 8, 24);

  // Once all data has loaded, automatically trigger the print dialog
  // so the PDF tab "just works" without an extra click — but only on
  // first mount, not on every state update.
  const allLoaded =
    todayPulse !== undefined &&
    hypotheses !== undefined &&
    forecasts !== undefined &&
    snapshot !== undefined &&
    footnoteData !== undefined;

  useEffect(() => {
    if (!allLoaded) return;
    if (typeof window === "undefined") return;
    // Tiny delay so the browser paints first.
    const t = window.setTimeout(() => {
      try {
        window.print();
      } catch {
        // ignore — user can still trigger via menu
      }
    }, 600);
    return () => window.clearTimeout(t);
  }, [allLoaded]);

  // Build the visible section list (mirror the surface logic).
  const visibleSections: Array<{ id: string; kicker: string; heading: string }> = [];
  visibleSections.push({
    id: "what-moved",
    kicker: "Today's edition",
    heading: "What moved today",
  });
  if (Array.isArray(hypotheses) && hypotheses.length > 0) {
    visibleSections.push({
      id: "competing-explanations",
      kicker: HOME_AUDIENCE_RELEVANCE_SECTION.kicker,
      heading: HOME_AUDIENCE_RELEVANCE_SECTION.heading,
    });
  }
  visibleSections.push({
    id: "what-to-look-at",
    kicker: HOME_EVIDENCE_WATCHLIST_SECTION.kicker,
    heading: HOME_EVIDENCE_WATCHLIST_SECTION.heading,
  });
  visibleSections.push({
    id: "scoreboard",
    kicker: "Scoreboard",
    heading: "Today's scoreboard",
  });
  visibleSections.push({
    id: "capabilities",
    kicker: "The capability landscape",
    heading: "Capabilities map",
  });
  visibleSections.push({
    id: "footnotes",
    kicker: "Sources",
    heading: "Footnotes",
  });

  const dateString =
    snapshot?.dateString ??
    (todayPulse ? todayPulse.dateKey : new Date().toISOString().slice(0, 10));

  const numberFor = (idx: number) => pad2(idx + 1);

  return (
    <div data-redesign data-edition data-edition-print>
      <div className="rd-edition-root rd-edition-root--print">
        <header className="rd-edition-print-header">
          <p className="rd-edition-meta" aria-label="Edition metadata">
            Today's edition · {dateString} · id:{editionId}
          </p>
          <h1 className="rd-edition-print-title">Today's intelligence brief</h1>
        </header>

        <EditionErrorBoundary label="print-what-moved">
          <section
            role="region"
            aria-label="What moved today"
            className="rd-edition-section"
            data-section="what-moved"
            data-section-number={numberFor(visibleSections.findIndex((s) => s.id === "what-moved"))}
            data-section-kicker="Today's edition"
          >
            <header>
              <p className="rd-edition-section__eyebrow">
                {numberFor(visibleSections.findIndex((s) => s.id === "what-moved"))} · Today's edition
              </p>
              <h2 className="rd-edition-section__h2">What moved today</h2>
            </header>
            {todayPulse?.pulses.length === 0 ? (
              <p className="rd-edition-empty">No pulse generated yet today.</p>
            ) : (
              <div className="rd-edition-prose">
                {(todayPulse?.pulses ?? []).map((p, i) => (
                  <article key={p._id} style={{ marginBottom: 12 }}>
                    <p>
                      <strong style={{ textTransform: "capitalize" }}>
                        {p.entitySlug.replace(/-/g, " ")}
                      </strong>{" "}
                      <span className="rd-edition-meta">
                        · {p.changeCount} change{p.changeCount === 1 ? "" : "s"}
                      </span>
                      <Footnote id={`pulse-${i + 1}`} index={i + 1} />
                    </p>
                    {p.summaryMarkdown && (
                      <p>{p.summaryMarkdown.split("\n\n")[0]?.replace(/^#+\s*/, "")}</p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </EditionErrorBoundary>

        {Array.isArray(hypotheses) && hypotheses.length > 0 && (
          <EditionErrorBoundary label="print-hypotheses">
            <section
              role="region"
              aria-label="Audience relevance and evidence review queue"
              className="rd-edition-section"
              data-section="competing-explanations"
              data-section-number={numberFor(visibleSections.findIndex((s) => s.id === "competing-explanations"))}
              data-section-kicker={HOME_AUDIENCE_RELEVANCE_SECTION.kicker}
            >
              <header>
                <p className="rd-edition-section__eyebrow">
                  {numberFor(visibleSections.findIndex((s) => s.id === "competing-explanations"))} · {HOME_AUDIENCE_RELEVANCE_SECTION.kicker}
                </p>
                <h2 className="rd-edition-section__h2">
                  {HOME_AUDIENCE_RELEVANCE_SECTION.heading}
                </h2>
              </header>
              {hypotheses.map((h) => (
                <article key={h._id} className="rd-edition-hypothesis">
                  <div className="rd-edition-hypothesis__head">
                    <span className="rd-edition-hypothesis__label">{h.label}</span>
                    <h3 className="rd-edition-hypothesis__title">
                      {getHypothesisReviewTitle(h)}
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
                </article>
              ))}
            </section>
          </EditionErrorBoundary>
        )}

        <EditionErrorBoundary label="print-forecasts">
          <section
            role="region"
            aria-label="Evidence watchlist"
            className="rd-edition-section"
            data-section="what-to-look-at"
            data-section-number={numberFor(visibleSections.findIndex((s) => s.id === "what-to-look-at"))}
            data-section-kicker={HOME_EVIDENCE_WATCHLIST_SECTION.kicker}
          >
            <header>
              <p className="rd-edition-section__eyebrow">
                {numberFor(visibleSections.findIndex((s) => s.id === "what-to-look-at"))} · {HOME_EVIDENCE_WATCHLIST_SECTION.kicker}
              </p>
              <h2 className="rd-edition-section__h2">
                {HOME_EVIDENCE_WATCHLIST_SECTION.heading}
              </h2>
            </header>
            {(forecasts ?? []).length === 0 ? (
              <p className="rd-edition-empty">No evidence watchlist items.</p>
            ) : (
              (forecasts ?? []).slice(0, 5).map((f) => (
                <article key={f._id} className="rd-edition-forecast">
                  <p className="rd-edition-forecast__claim">
                    Forecast evidence review
                  </p>
                  <p className="rd-edition-meta">
                    {getForecastReviewSummary(f)}
                  </p>
                  <span className="rd-edition-forecast__prob">
                    {formatProbability(f.probability)}
                  </span>
                </article>
              ))
            )}
          </section>
        </EditionErrorBoundary>

        <EditionErrorBoundary label="print-scoreboard">
          <section
            role="region"
            aria-label="Today's scoreboard"
            className="rd-edition-section"
            data-section="scoreboard"
            data-section-number={numberFor(visibleSections.findIndex((s) => s.id === "scoreboard"))}
            data-section-kicker="Scoreboard"
          >
            <header>
              <p className="rd-edition-section__eyebrow">
                {numberFor(visibleSections.findIndex((s) => s.id === "scoreboard"))} · Scoreboard
              </p>
              <h2 className="rd-edition-section__h2">Today's scoreboard</h2>
            </header>
            <Scoreboard stats={snapshot?.dashboardMetrics?.keyStats ?? []} />
          </section>
        </EditionErrorBoundary>

        <EditionErrorBoundary label="print-capabilities">
          <section
            role="region"
            aria-label="Capabilities map"
            className="rd-edition-section"
            data-section="capabilities"
            data-section-number={numberFor(visibleSections.findIndex((s) => s.id === "capabilities"))}
            data-section-kicker="The capability landscape"
          >
            <header>
              <p className="rd-edition-section__eyebrow">
                {numberFor(visibleSections.findIndex((s) => s.id === "capabilities"))} · The capability landscape
              </p>
              <h2 className="rd-edition-section__h2">Capabilities map</h2>
            </header>
            <CapabilitiesMap
              techReadiness={snapshot?.dashboardMetrics?.techReadiness ?? null}
              capabilities={snapshot?.dashboardMetrics?.capabilities ?? null}
            />
          </section>
        </EditionErrorBoundary>

        {footnoteData && (footnoteData.artifacts.length > 0 || footnoteData.industry.length > 0) && (
          <EditionErrorBoundary label="print-footnotes">
            <section
              role="region"
              aria-label="Footnotes and sources"
              className="rd-edition-section"
              data-section="footnotes"
              data-section-number={numberFor(visibleSections.findIndex((s) => s.id === "footnotes"))}
              data-section-kicker="Sources"
            >
              <header>
                <p className="rd-edition-section__eyebrow">
                  {numberFor(visibleSections.findIndex((s) => s.id === "footnotes"))} · Sources
                </p>
                <h2 className="rd-edition-section__h2">Footnotes</h2>
              </header>
              <div className="rd-edition-footnotes">
                <ol>
                  {footnoteData.artifacts.map((a, i) => (
                    <li key={a._id} id={`fn-${i + 1}`}>
                      <span>
                        {a.publisher || (() => { try { return new URL(a.url).hostname; } catch { return a.url; } })()}
                        {a.firstQuote ? ` — "${a.firstQuote}"` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          </EditionErrorBoundary>
        )}
      </div>
    </div>
  );
}
