/**
 * Home — magnetic restructure (Pitchbook + Bloomberg + Stratechery + Notion).
 *
 * Section order (top → bottom):
 *   1. Hero composer + dual CTA + runtime ribbon (kept)
 *   2. First-public-dossier banner (kept)
 *   3. Memory pulse TICKER (Bloomberg slim ribbon, was a section)
 *   4. Active-event COVER HERO (Apple News-style, when an event is live)
 *   5. 3-column ops dashboard: Continue working · What changed · Watchlist
 *   6. LATEST PUBLIC RESEARCH — Pitchbook entity-card feed with delta arrows + filter/sort
 *   7. PICK THE SITUATION — Notion templates gallery with previews + time + uses count
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UniversalComposer } from "../components/UniversalComposer";
import { Pill } from "../components/Pill";
import { StyleGalleryCard } from "../components/StyleGalleryCard";
import { WhatChangedStrip } from "../components/WhatChangedStrip";
import { useHomePulseLive } from "../hooks/useHomePulseLive";
import { showToast } from "../components/Toast";
import {
  memoryPulse,
  pulseCards as fixturePulseCards,
  publicResearch,
  situations,
  watchlist,
  continueWorking,
  memoStyles,
  type SituationWindow,
  type EntityClass,
  type PublicResearchCard,
  type WatchlistEntity,
  type MemoStyle,
} from "../fixtures";

const FIRST_VISIT_KEY = "rd_first_visit_v1";

/** Tracks whether the user has been here before. localStorage-only for the showcase. */
function useFirstVisit(): boolean {
  const [isFirst, setIsFirst] = useState(false);
  useEffect(() => {
    try {
      const seen = localStorage.getItem(FIRST_VISIT_KEY);
      if (!seen) {
        setIsFirst(true);
        localStorage.setItem(FIRST_VISIT_KEY, new Date().toISOString());
      }
    } catch {
      // ignore localStorage errors
    }
  }, []);
  return isFirst;
}

interface HomeSurfaceProps {
  onAsk: (text: string) => void;
  onOpenReport: (id: string) => void;
}

export function HomeSurface({ onAsk, onOpenReport }: HomeSurfaceProps) {
  const navigate = useNavigate();
  const [contextLabel, setContextLabel] = useState("Auto: current context");
  const [situationWindow, setSituationWindow] = useState<SituationWindow>("today");
  const [entityFilter, setEntityFilter] = useState<EntityClass | "all">("all");
  const [entitySort, setEntitySort] = useState<"newest" | "confidence" | "delta">("newest");
  const [activeStyle, setActiveStyle] = useState<MemoStyle>(memoStyles.find((s) => s.id === "user.inferred") ?? memoStyles[0]);
  const isFirstVisit = useFirstVisit();
  // Sprint S4 (partial): pulse cards from live batchAutopilot briefMarkdown — falls back to fixture
  const { pulse: livePulse } = useHomePulseLive();
  const pulseCards = livePulse.length > 0 ? livePulse : fixturePulseCards;
  const tryStyle = (style: MemoStyle, entity: string) => {
    setActiveStyle(style);
    onAsk(`Run a ${style.name.toLowerCase()} on ${entity}.`);
  };

  const filteredSituations = useMemo(
    () => situations.filter((s) => s.window === situationWindow),
    [situationWindow]
  );

  const filteredEntities = useMemo(() => {
    let list = entityFilter === "all" ? publicResearch : publicResearch.filter((e) => e.entityClass === entityFilter);
    list = [...list];
    if (entitySort === "confidence") list.sort((a, b) => b.confidence - a.confidence);
    else if (entitySort === "delta") list.sort((a, b) => b.delta - a.delta);
    return list;
  }, [entityFilter, entitySort]);

  return (
    <div className="rd-stack" style={{ padding: "20px 40px 40px", gap: 28, maxWidth: 1180, margin: "0 auto" }}>
      {/* ─── 0. What changed since last visit (returning users) ─── */}
      <WhatChangedStrip
        onOpen={(item) => {
          if (item.href) navigate(item.href);
          else showToast({ tone: "info", message: `Opening ${item.title}…` });
        }}
      />

      {/* ─── 1. Hero ─── */}
      <header className="rd-stack" style={{ gap: 12, alignItems: "center", textAlign: "center", paddingTop: 16 }}>
        <span className="rd-eyebrow" style={{ fontSize: 11, letterSpacing: "0.18em" }}>On-the-go intelligence</span>
        <h1 className="rd-display" style={{ textAlign: "center" }}>Get the read before you walk in.</h1>
        <p className="rd-body rd-faint" style={{ maxWidth: 600, fontSize: 15, lineHeight: 1.55, textAlign: "center" }}>
          Research a person, school, company, product, or meeting. NodeBench keeps working server-side and turns the
          answer into sources, reports, notes, and exports.
        </p>
      </header>

      <div style={{ maxWidth: 760, width: "100%", margin: "0 auto" }}>
        <UniversalComposer
          contextLabel={contextLabel}
          onContextChange={() =>
            setContextLabel(contextLabel.startsWith("Auto") ? "Adding to: Ship Demo Day" : "Auto: current context")
          }
          onSubmit={(text) => onAsk(text)}
          onChatNow={(text) => onAsk(text)}
          showRuntimeRibbon
          placeholder="Ask anything — a company, a market, or a question..."
        />
      </div>

      {/* ─── 2. Public-dossier banner ─── */}
      <div
        className="rd-card"
        style={{
          maxWidth: 760, width: "100%", margin: "0 auto",
          padding: "12px 18px",
          display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 14, alignItems: "center",
        }}
      >
        <div aria-hidden="true" style={{
          width: 28, height: 28, borderRadius: 8,
          background: "var(--rd-accent-soft)", color: "var(--rd-accent-strong)",
          display: "grid", placeItems: "center",
        }}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </div>
        <div className="rd-stack" style={{ gap: 1 }}>
          <strong style={{ fontSize: 12.5, color: "var(--rd-ink-strong)" }}>First public dossier works without sign-in.</strong>
          <span style={{ fontSize: 11.5, color: "var(--rd-ink-mute)" }}>Link NodeBench after the first sourced result to keep memory, raise limits, and add team controls.</span>
        </div>
        <button className="rd-btn rd-btn--quiet rd-btn--sm">Link when ready</button>
      </div>

      {/* ─── Style strip (always visible, magnetic for first-time visitors) ─── */}
      <section
        aria-label={isFirstVisit ? "Try a style" : "Your style"}
        className="rd-stack"
        style={{ gap: 10 }}
      >
        <div className="rd-row--between" style={{ alignItems: "flex-end" }}>
          <div>
            <div className="rd-eyebrow">{isFirstVisit ? "Try a style" : "Your style + public references"}</div>
            <h2 className="rd-h2" style={{ marginTop: 4 }}>
              {isFirstVisit
                ? "Pick a memo style — see what NodeBench can become for you."
                : <>Active: <span style={{ color: "var(--rd-accent-strong)" }}>{activeStyle.name}</span> · drives every report you generate.</>}
            </h2>
          </div>
          {!isFirstVisit && (
            <button
              className="rd-btn rd-btn--quiet rd-btn--sm"
              onClick={() => navigate("/redesign/me")}
            >Manage style →</button>
          )}
        </div>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 10,
        }}>
          {(isFirstVisit ? memoStyles.filter((s) => s.id !== "user.inferred") : memoStyles).slice(0, 4).map((s) => (
            <StyleGalleryCard
              key={s.id}
              style={s}
              defaultTryEntity="Apple"
              selected={s.id === activeStyle.id}
              onSelect={(st) => setActiveStyle(st)}
              onTry={tryStyle}
            />
          ))}
        </div>
      </section>

      {/* ─── 3. Memory Pulse TICKER (Bloomberg-style ribbon) ─── */}
      <section aria-label="Memory pulse" className="rd-ticker" style={{ marginTop: -8 }}>
        {memoryPulse.map((m, i) => (
          <div key={m.label} className="rd-ticker__cell" style={i === 0 ? { paddingLeft: 0 } : undefined}>
            <span className="rd-ticker__label">{m.label}</span>
            <span className="rd-ticker__value">{m.value}</span>
            {m.delta && (
              <span className={`rd-ticker__delta ${m.delta.startsWith("+") || m.delta.includes("avoided") ? "rd-ticker__delta--up" : ""}`}>
                {m.delta.startsWith("+") || m.delta.match(/^\d/) ? `↑ ${m.delta}` : m.delta}
              </span>
            )}
            {m.hint && !m.delta && (
              <span className="rd-ticker__delta" style={{ color: "var(--rd-ink-soft)", fontWeight: 510 }}>{m.hint}</span>
            )}
          </div>
        ))}
      </section>

      {/* ─── 4. Active-event COVER HERO ─── */}
      <section aria-label="Active event" className="rd-stack" style={{ gap: 10 }}>
        <div className="rd-row--between">
          <div className="rd-eyebrow">Active event · live coverage</div>
          <button className="rd-btn rd-btn--quiet rd-btn--sm">Mute</button>
        </div>
        <article className="rd-cover-hero">
          <span className="rd-cover-hero__pulse">LIVE</span>
          <div className="rd-stack" style={{ gap: 12, color: "#fff" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", opacity: 0.85 }}>
              Today · in-person · 8 companies · 14 people
            </span>
            <h2 style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-1.2px", margin: 0, lineHeight: 1.05, color: "#fff" }}>
              Ship Demo Day
            </h2>
            <p style={{ fontSize: 14.5, lineHeight: 1.55, color: "rgba(255,255,255,0.92)", margin: 0, maxWidth: 480 }}>
              Event corpus is hot — answers serve from local memory before public search runs. <strong style={{ color: "#fff" }}>3 strong pilot intents detected so far.</strong>
            </p>
            <div className="rd-row" style={{ gap: 8, marginTop: 6 }}>
              <button className="rd-btn rd-btn--sm" style={{ background: "#fff", color: "var(--rd-accent-strong)", border: "1px solid #fff", fontWeight: 700 }}>
                Open event report →
              </button>
              <button className="rd-btn rd-btn--sm" style={{ background: "rgba(255,255,255,0.16)", color: "#fff", border: "1px solid rgba(255,255,255,0.30)", fontWeight: 590 }}>
                Capture quick note
              </button>
            </div>
          </div>
          <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, margin: 0 }}>
            <CoverStat label="Memory hit" value="78%" hint="answers served from corpus" />
            <CoverStat label="Paid calls" value="0" hint="cache + free public sources" />
            <CoverStat label="Captures" value="12" hint="across all attendees" />
            <CoverStat label="Follow-ups due" value="9" hint="3 due tomorrow" />
          </dl>
        </article>
      </section>

      {/* ─── 5. 3-column ops dashboard ─── */}
      <section aria-label="Operations dashboard" className="rd-ops">
        <div className="rd-ops__col">
          <div className="rd-ops__head">
            <span className="rd-ops__title">Continue working</span>
            <span className="rd-ops__count">{continueWorking.length} open</span>
          </div>
          {continueWorking.map((c) => (
            <div key={c.id} className="rd-ops__row" onClick={() => navigate(`/redesign/reports/${c.reportId}`)}>
              <div className="rd-ops__row-title">
                {c.title}
                {c.pendingFromAgent && (
                  <span style={{
                    background: "var(--rd-accent-soft)", color: "var(--rd-accent-strong)",
                    fontSize: 10, padding: "1px 6px", borderRadius: 999, fontWeight: 700,
                  }}>{c.pendingFromAgent} new</span>
                )}
              </div>
              <span className="rd-ops__row-meta">{c.kind} · {c.lastTouched}</span>
              <span style={{ fontSize: 12, color: "var(--rd-ink-mute)" }}>{c.whatYouLeft}</span>
            </div>
          ))}
        </div>

        <div className="rd-ops__col">
          <div className="rd-ops__head">
            <span className="rd-ops__title">What changed</span>
            <span className="rd-ops__count">today · {pulseCards.length}</span>
          </div>
          {pulseCards.map((card) => (
            <div key={card.title} className="rd-ops__row">
              <div className="rd-row" style={{ gap: 6 }}>
                <KindBadge kind={card.kind} />
                <span className="rd-ops__row-meta">{card.meta}</span>
              </div>
              <div className="rd-ops__row-title" style={{ fontSize: 13, fontWeight: 590, marginTop: 2 }}>{card.title}</div>
              <span style={{ fontSize: 12, color: "var(--rd-ink-mute)", lineHeight: 1.45 }}>{card.body}</span>
            </div>
          ))}
        </div>

        <div className="rd-ops__col">
          <div className="rd-ops__head">
            <span className="rd-ops__title">Watchlist</span>
            <span className="rd-ops__count">{watchlist.length} entities</span>
          </div>
          {watchlist.map((w) => (
            <WatchRow key={w.id} entity={w} />
          ))}
        </div>
      </section>

      {/* ─── 6. Latest Public Research (Pitchbook entity feed) ─── */}
      <section aria-label="Latest public research" className="rd-stack" style={{ gap: 10 }}>
        <div className="rd-row--between" style={{ alignItems: "flex-end" }}>
          <div>
            <div className="rd-eyebrow">Latest public research</div>
            <h2 className="rd-h2" style={{ marginTop: 4 }}>Reusable public memory from recent entity runs.</h2>
          </div>
          <Pill tone="accent">Public claims only</Pill>
        </div>

        <div className="rd-filter-bar">
          <div className="rd-filter-bar__chips">
            {([["all", "All"], ["company", "Companies"], ["person", "People"], ["topic", "Markets"], ["role", "Roles"], ["event", "Events"]] as const).map(([id, label]) => (
              <button
                key={id}
                className="rd-filter-chip"
                aria-pressed={entityFilter === id}
                onClick={() => setEntityFilter(id as EntityClass | "all")}
              >{label}</button>
            ))}
          </div>
          <select
            className="rd-sort-select"
            value={entitySort}
            onChange={(e) => setEntitySort(e.target.value as "newest" | "confidence" | "delta")}
            aria-label="Sort entity feed"
          >
            <option value="newest">Newest</option>
            <option value="confidence">By confidence</option>
            <option value="delta">Most movement</option>
          </select>
        </div>

        <div className="rd-entity-grid">
          {filteredEntities.map((e) => (
            <EntityCard key={e.entity} card={e} onOpen={() => onOpenReport(`rep_${e.entity.toLowerCase().replace(/\s+/g, "_")}`)} />
          ))}
        </div>
      </section>

      {/* ─── 7. Pick the situation (Notion-templates) ─── */}
      <section aria-label="Pick the situation" className="rd-stack" style={{ gap: 12 }}>
        <div className="rd-row--between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="rd-eyebrow">Pick the situation</div>
            <h2 className="rd-h2" style={{ marginTop: 4 }}>NodeBench turns scattered context into a saved report.</h2>
          </div>
          <div className="rd-tabs" role="tablist" aria-label="Situation window">
            {[
              { id: "today" as const, label: "Today", hint: "meeting or field note" },
              { id: "week" as const, label: "This week", hint: "compare options" },
              { id: "month" as const, label: "This month", hint: "track and export" },
            ].map((w) => (
              <button
                key={w.id}
                role="tab"
                aria-selected={situationWindow === w.id}
                className="rd-tab"
                onClick={() => setSituationWindow(w.id)}
                style={{ flexDirection: "column", alignItems: "flex-start", padding: "8px 12px", lineHeight: 1.2 }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 590 }}>{w.label}</span>
                <span style={{ fontSize: 9.5, fontWeight: 510, color: "var(--rd-ink-soft)" }}>{w.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rd-sit-grid">
          {filteredSituations.map((s) => (
            <article key={s.title} className="rd-sit-card">
              <div className="rd-sit-card__preview" aria-hidden="true">
                {s.previewLines.map((line, i) => (
                  <span key={i} className="rd-sit-card__preview-line">{line}</span>
                ))}
              </div>
              <div className="rd-sit-card__body">
                <div className="rd-row" style={{ gap: 6, justifyContent: "space-between" }}>
                  <Pill tone="accent">{s.persona}</Pill>
                  <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)" }}>
                    ~{s.estimateMinutes} min · used {s.usesCount.toLocaleString()}×
                  </span>
                </div>
                <h3 className="rd-sit-card__title">{s.title}</h3>
                <p className="rd-sit-card__desc">{s.description}</p>
                <div className="rd-row" style={{ gap: 5, flexWrap: "wrap" }}>
                  {s.chips.map((chip) => (
                    <span key={chip} className="rd-pill" style={{ background: "transparent", fontSize: 10.5 }}>
                      <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--rd-green)" }}>
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rd-sit-card__foot">
                <div
                  className="rd-sit-card__stats"
                  title={`Exports: ${s.exports.join(", ")}`}
                >
                  Exports: <span style={{ color: "var(--rd-ink)", fontWeight: 600 }}>{s.exports.join(" · ")}</span>
                </div>
                <div className="rd-row" style={{ gap: 6 }}>
                  <button className="rd-btn rd-btn--quiet rd-btn--sm">Fill prompt</button>
                  <button className="rd-btn rd-btn--primary rd-btn--sm">Run research →</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function CoverStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <dt style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.78)" }}>{label}</dt>
      <dd style={{ margin: "4px 0 0", fontSize: 26, fontWeight: 700, color: "#fff", letterSpacing: "-0.4px" }}>{value}</dd>
      <div style={{ color: "rgba(255,255,255,0.74)", fontSize: 11, marginTop: 2 }}>{hint}</div>
    </div>
  );
}

function WatchRow({ entity }: { entity: WatchlistEntity }) {
  const trend = entity.delta > 0 ? "up" : entity.delta < 0 ? "down" : "flat";
  return (
    <div className="rd-ops__row">
      <div className="rd-row" style={{ justifyContent: "space-between", gap: 6 }}>
        <span className="rd-ops__row-title" style={{ fontSize: 13 }}>{entity.entity}</span>
        <span className={`rd-entity-card__delta rd-entity-card__delta--${trend}`}>
          {trend === "up" ? "↑" : trend === "down" ? "↓" : "—"} {Math.abs(entity.delta)}
        </span>
      </div>
      <span style={{ fontSize: 12, color: "var(--rd-ink-mute)", lineHeight: 1.4 }}>{entity.signal}</span>
      <div className="rd-row" style={{ justifyContent: "space-between", marginTop: 2 }}>
        <span className="rd-ops__row-meta">{entity.kind} · {entity.lastSignalAt}</span>
        <span className="rd-mono" style={{ fontSize: 10, fontWeight: 700, color: "var(--rd-accent-strong)" }}>
          {(entity.confidence * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

function EntityCard({ card, onOpen }: { card: PublicResearchCard; onOpen: () => void }) {
  const trend = card.delta > 0 ? "up" : card.delta < 0 ? "down" : "flat";
  return (
    <article
      className="rd-entity-card"
      data-signal-class={card.signalClass}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
    >
      <div className="rd-entity-card__logo">{card.iconChar ?? card.entity.slice(0, 2)}</div>
      <div className="rd-entity-card__head">
        <span className="rd-entity-card__entity">{card.entity}</span>
        <span className="rd-entity-card__when">{card.whenAgo}</span>
      </div>
      <span className="rd-entity-card__kind">{card.kind}</span>
      <p className="rd-entity-card__signal">{card.signal}</p>
      <div className="rd-entity-card__metrics">
        <span className={`rd-entity-card__delta rd-entity-card__delta--${trend}`}>
          {trend === "up" ? "↑" : trend === "down" ? "↓" : "—"} {Math.abs(card.delta)} claims
        </span>
        <span>{card.sources} src</span>
        <span className="rd-entity-card__confidence">{(card.confidence * 100).toFixed(0)}% confidence</span>
      </div>
    </article>
  );
}

function KindBadge({ kind }: { kind: string }) {
  const map: Record<string, { label: string; tone: "green" | "blue" | "amber" | "accent" }> = {
    memory_win: { label: "Memory win", tone: "green" },
    report_update: { label: "Report updated", tone: "accent" },
    follow_up: { label: "Follow-up", tone: "amber" },
    event: { label: "Event", tone: "blue" },
  };
  const m = map[kind] ?? { label: kind, tone: "accent" as const };
  return <Pill tone={m.tone}>{m.label}</Pill>;
}
