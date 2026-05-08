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
 */

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { UniversalComposer } from "../components/UniversalComposer";
import { EditorialSection } from "../components/edition/EditorialSection";
import { EditionErrorBoundary } from "../components/edition/EditionErrorBoundary";
import { Footnote } from "../components/edition/Footnote";
import { Scoreboard } from "../components/edition/Scoreboard";
import { CapabilitiesMap } from "../components/edition/CapabilitiesMap";
import { EvidenceChecklistStrip } from "../components/edition/EvidenceChecklistStrip";
import { useTodayPulse } from "../hooks/useTodayPulse";
import { useActiveHypotheses, type EditionHypothesis } from "../hooks/useActiveHypotheses";
import { useTopForecasts, type EditionForecast } from "../hooks/useTopForecasts";
import { useLatestDailyBriefSnapshot } from "../hooks/useLatestDailyBriefSnapshot";
import { useEditionFootnotes } from "../hooks/useEditionFootnotes";
import { useHomePulseLive } from "../hooks/useHomePulseLive";
import { pulseCards as fixturePulseCards, watchlist, continueWorking } from "../fixtures";
import { Pill } from "../components/Pill";
import "../components/edition/edition.css";

interface Props {
  onAsk: (text: string) => void;
  onOpenReport: (id: string) => void;
}

const ABSENT = Symbol("absent");

/* ─── helpers ───────────────────────────────────────────────────── */

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

/** Render markdown summary as serif paragraphs.  Phase 7a uses a
 * minimal renderer — strip headings, render leading bullet points
 * inline, preserve paragraph breaks.  Anything fancier waits for 7b. */
function renderPulseMarkdown(md: string): string[] {
  return md
    .split(/\r?\n\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    // Keep up to 4 paragraphs to stay editorial.
    .slice(0, 4);
}

/* ─── §1 — What moved today ─────────────────────────────────────── */

function WhatMovedSection() {
  const data = useTodayPulse(12);
  if (data === undefined) {
    return (
      <EditorialSection
        id="what-moved"
        ariaLabel="What moved today"
        eyebrow="01 · Today's edition"
        heading="What moved today"
      >
        <div className="rd-edition-skeleton" style={{ width: "92%" }} />
        <div className="rd-edition-skeleton" style={{ width: "78%" }} />
        <div className="rd-edition-skeleton" style={{ width: "84%" }} />
      </EditorialSection>
    );
  }
  const { pulses, dateKey, lastDateKey } = data;
  const totalMaterial = pulses.reduce(
    (n, p) => n + (p.materialChangeCount ?? 0),
    0,
  );

  return (
    <EditorialSection
      id="what-moved"
      ariaLabel="What moved today"
      eyebrow={`01 · ${dateKey}`}
      heading="What moved today"
    >
      {pulses.length === 0 ? (
        <p className="rd-edition-empty">
          No pulse generated yet today.
          {lastDateKey ? ` Last pulse: ${lastDateKey}.` : ""}
        </p>
      ) : (
        <>
          <p className="rd-edition-meta">
            <span className="rd-edition-delta" aria-label={`${totalMaterial} material changes`}>
              {totalMaterial} material change{totalMaterial === 1 ? "" : "s"}
            </span>{" "}
            across {pulses.length} entit{pulses.length === 1 ? "y" : "ies"}
          </p>
          <div className="rd-edition-prose">
            {pulses.map((p, i) => (
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
                    · {p.changeCount} change{p.changeCount === 1 ? "" : "s"}
                    {p.materialChangeCount > 0
                      ? `, ${p.materialChangeCount} material`
                      : ""}
                  </span>
                  <Footnote id={`pulse-${i + 1}`} index={i + 1} label={`Pulse for ${p.entitySlug}`} />
                </p>
                {p.summaryMarkdown
                  ? renderPulseMarkdown(p.summaryMarkdown).map((para, j) => (
                      <p key={j}>{para.replace(/^#+\s*/, "")}</p>
                    ))
                  : (
                    <p className="rd-edition-empty" style={{ padding: 0 }}>
                      Pulse generated; full summary pending.
                    </p>
                  )}
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
  hypotheses,
}: {
  hypotheses: EditionHypothesis[] | undefined;
}) {
  if (hypotheses === undefined) {
    return (
      <EditorialSection
        id="competing-explanations"
        ariaLabel="The competing explanations"
        eyebrow="02 · Hypotheses under test"
        heading="The competing explanations"
      >
        <div className="rd-edition-skeleton" style={{ width: "70%" }} />
        <div className="rd-edition-skeleton" style={{ width: "92%" }} />
        <div className="rd-edition-skeleton" style={{ width: "60%" }} />
      </EditorialSection>
    );
  }

  if (hypotheses.length === 0) {
    // Spec §5: "Empty state: hide section. Don't fake hypotheses."
    return null;
  }

  return (
    <EditorialSection
      id="competing-explanations"
      ariaLabel="The competing explanations"
      eyebrow="02 · Hypotheses under test"
      heading="The competing explanations"
    >
      <div>
        {hypotheses.map((h) => (
          <article
            key={h._id}
            className="rd-edition-hypothesis"
            data-hypothesis-id={h.hypothesisId}
            data-evidence-level={h.evidenceLevel}
          >
            <div className="rd-edition-hypothesis__head">
              <span className="rd-edition-hypothesis__label">{h.label}</span>
              <h3 className="rd-edition-hypothesis__title">{h.title}</h3>
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
  forecasts,
}: {
  forecasts: EditionForecast[] | undefined;
}) {
  const navigate = useNavigate();
  if (forecasts === undefined) {
    return (
      <EditorialSection
        id="what-to-look-at"
        ariaLabel="What to look at this week"
        eyebrow="03 · Forecasts in motion"
        heading="What to look at this week"
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
      eyebrow="03 · Forecasts in motion"
      heading="What to look at this week"
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

function ScoreboardSection() {
  const snapshot = useLatestDailyBriefSnapshot();
  const { pulse: livePulseCards } = useHomePulseLive();
  const opsCards = livePulseCards.length > 0 ? livePulseCards : fixturePulseCards;

  if (snapshot === undefined) {
    return (
      <EditorialSection
        id="scoreboard"
        ariaLabel="Today's scoreboard"
        eyebrow="04 · Scoreboard"
        heading="Today's scoreboard"
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
      eyebrow={`04 · ${snapshot?.dateString ?? "Scoreboard"}`}
      heading="Today's scoreboard"
    >
      <Scoreboard stats={stats} />

      <details className="rd-edition-ops-details">
        <summary>Today's operations</summary>
        <div className="rd-ops" data-ops-source="legacy-fallback">
          <div className="rd-ops__col">
            <div className="rd-ops__head">
              <span className="rd-ops__title">Continue working</span>
              <span className="rd-ops__count">{continueWorking.length} open</span>
            </div>
            {continueWorking.slice(0, 3).map((c) => (
              <div key={c.id} className="rd-ops__row">
                <div className="rd-ops__row-title">{c.title}</div>
                <span className="rd-ops__row-meta">{c.kind} · {c.lastTouched}</span>
              </div>
            ))}
          </div>
          <div className="rd-ops__col">
            <div className="rd-ops__head">
              <span className="rd-ops__title">What changed</span>
              <span className="rd-ops__count">{opsCards.length}</span>
            </div>
            {opsCards.slice(0, 3).map((card) => (
              <div key={card.title} className="rd-ops__row">
                <div className="rd-ops__row-title" style={{ fontSize: 13 }}>{card.title}</div>
                <span style={{ fontSize: 12, color: "var(--rd-ink-mute)" }}>{card.body}</span>
              </div>
            ))}
          </div>
          <div className="rd-ops__col">
            <div className="rd-ops__head">
              <span className="rd-ops__title">Watchlist</span>
              <span className="rd-ops__count">{watchlist.length}</span>
            </div>
            {watchlist.slice(0, 3).map((w) => (
              <div key={w.id} className="rd-ops__row">
                <div className="rd-ops__row-title">{w.entity}</div>
                <span style={{ fontSize: 12, color: "var(--rd-ink-mute)" }}>{w.signal}</span>
              </div>
            ))}
          </div>
        </div>
      </details>
    </EditorialSection>
  );
}

/* ─── §5 — Capabilities map ─────────────────────────────────────── */

function CapabilitiesSection() {
  const snapshot = useLatestDailyBriefSnapshot();

  if (snapshot === undefined) {
    return (
      <EditorialSection
        id="capabilities"
        ariaLabel="Capabilities map"
        eyebrow="05 · The capability landscape"
        heading="Capabilities map"
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
      eyebrow="05 · The capability landscape"
      heading="Capabilities map"
    >
      <CapabilitiesMap techReadiness={tr} capabilities={caps} />
    </EditorialSection>
  );
}

/* ─── Footnotes ─────────────────────────────────────────────────── */

function FootnotesSection({
  artifactIds,
}: {
  artifactIds: string[];
}) {
  const data = useEditionFootnotes(artifactIds, 8, 24);
  if (data === undefined) {
    return (
      <EditorialSection
        id="footnotes"
        ariaLabel="Footnotes and sources"
        eyebrow="06 · Sources"
        heading="Footnotes"
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
      eyebrow="06 · Sources"
      heading="Footnotes"
    >
      {totalCount === 0 ? (
        <p className="rd-edition-empty">No source artifacts referenced in today's edition.</p>
      ) : (
        <div className="rd-edition-footnotes">
          <ol>
            {data.artifacts.map((a, i) => (
              <li key={a._id} id={`fn-art-${i + 1}`}>
                <span>
                  <a href={a.url} target="_blank" rel="noopener noreferrer">
                    {a.publisher || new URL(a.url).hostname}
                  </a>
                  {a.firstQuote ? <> — &ldquo;{a.firstQuote}&rdquo;</> : null}
                  {a.publishedAt ? (
                    <span className="rd-edition-meta">
                      {" "}· {new Date(a.publishedAt).toISOString().slice(0, 10)}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
            {data.industry.map((u, i) => (
              <li key={u._id} id={`fn-ind-${i + 1}`}>
                <span>
                  <a href={u.url} target="_blank" rel="noopener noreferrer">
                    {u.providerName} — {u.title}
                  </a>
                  <span className="rd-edition-meta">
                    {" "}· {new Date(u.scannedAt).toISOString().slice(0, 10)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </EditorialSection>
  );
}

/* ─── EditorialHomeSurface root ─────────────────────────────────── */

export function EditorialHomeSurface({ onAsk }: Props) {
  const hypotheses = useActiveHypotheses(5);
  const forecasts = useTopForecasts(5);
  const todayPulse = useTodayPulse(12);

  // Collect artifactIds from §2's hypotheses for footnotes (§6).
  const artifactIds = useMemo(() => {
    const ids: string[] = [];
    if (Array.isArray(hypotheses)) {
      for (const h of hypotheses) {
        for (const id of h.evidenceArtifactIds ?? []) ids.push(id);
      }
    }
    void todayPulse; // pulses don't carry artifactIds in v1 schema
    void ABSENT;
    return ids;
  }, [hypotheses, todayPulse]);

  return (
    <div data-edition>
      <div className="rd-edition-root">
        <header
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            paddingBottom: 8,
            borderBottom: "1px solid var(--rd-edition-rule-strong)",
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Pill tone="accent">Daily edition</Pill>
            <span className="rd-edition-meta">
              Single-document brief · max 720px · keyboard-first
            </span>
          </div>
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

        <EditionErrorBoundary label="what-moved">
          <WhatMovedSection />
        </EditionErrorBoundary>

        <EditionErrorBoundary label="competing-explanations">
          <CompetingExplanationsSection hypotheses={hypotheses} />
        </EditionErrorBoundary>

        <EditionErrorBoundary label="what-to-look-at">
          <WhatToLookAtSection forecasts={forecasts} />
        </EditionErrorBoundary>

        <EditionErrorBoundary label="scoreboard">
          <ScoreboardSection />
        </EditionErrorBoundary>

        <EditionErrorBoundary label="capabilities">
          <CapabilitiesSection />
        </EditionErrorBoundary>

        <EditionErrorBoundary label="footnotes">
          <FootnotesSection artifactIds={artifactIds} />
        </EditionErrorBoundary>
      </div>
    </div>
  );
}
