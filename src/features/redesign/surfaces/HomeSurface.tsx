/**
 * Home — reduced layout (2026-05-08).
 *
 * Replaces the prior 11-section scroll with 5 visible sections, two
 * progressive-disclosure <details> sections, and zero redundant cards.
 *
 * Visible (above the fold): pulse hero + composer.
 * Then on scroll: ops dashboard, public research feed.
 * Then on demand: <details> for style gallery + situation templates.
 *
 * Removed (each had a duplicate signal somewhere else):
 *   - "Immediate start" CTA card  →  same data in pulse hero `continue` row
 *   - "First public dossier" banner  →  copy moved to composer placeholder
 *   - Memory-pulse ticker  →  vanity metrics; pulse hero text already gives the count
 *   - Active-event COVER HERO  →  duplicates pulse `action` row + Daily Brief
 *
 * Section order (top → bottom):
 *   1. Daily Intelligence Pulse — sparse 5-row hero (primary)
 *   2. WhatChangedStrip — single line, returning users only
 *   3. Headline + composer (tight)
 *   4. 3-column ops dashboard: Continue · Changed · Watchlist
 *   5. Latest public research — Pitchbook entity feed
 *   6. <details> Try a memo style (collapsed by default)
 *   7. <details> Pick the situation (collapsed by default)
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mic } from "lucide-react";
import { EditorialHomeSurface } from "./EditorialHomeSurface";
import { UniversalComposer } from "../components/UniversalComposer";
import { Pill } from "../components/Pill";
import { StyleGalleryCard } from "../components/StyleGalleryCard";
import { WhatChangedStrip } from "../components/WhatChangedStrip";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useHomePulseLive } from "../hooks/useHomePulseLive";
import { useLiveArtifacts } from "../hooks/useLiveArtifacts";
import { showToast } from "../components/Toast";
import {
  situations,
  memoStyles,
  type ContinueItem,
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

/**
 * Per docs/architecture/HOME_EDITORIAL_REDESIGN.md §8 (Phase 7d, 2026-05-08):
 * the editorial daily-edition render is now the DEFAULT at /redesign.
 * Legacy is opt-out via `?classic=1` (canonical) or `?edition=0`
 * (back-compat for existing bookmarks).  `?edition=1` is harmless and
 * still resolves to editorial since editorial is now default.
 *
 * Computed once per render (no useEffect) so SSR / first-paint match
 * the URL state.
 */
function shouldRenderLegacy(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("classic") === "1") return true;
    if (params.get("edition") === "0") return true;
    return false;
  } catch {
    return false;
  }
}

export function HomeSurface(props: HomeSurfaceProps) {
  // Gate the entire surface choice at the top level so each branch
  // owns its own hook order — avoids the "conditional hooks" lint.
  if (shouldRenderLegacy()) {
    return <LegacyHomeSurface {...props} />;
  }
  return <EditorialHomeSurface onAsk={props.onAsk} onOpenReport={props.onOpenReport} />;
}

function LegacyHomeSurface({ onAsk, onOpenReport }: HomeSurfaceProps) {
  const navigate = useNavigate();
  const [contextLabel, setContextLabel] = useState("Auto: current context");
  const [situationWindow, setSituationWindow] = useState<SituationWindow>("today");
  const [entityFilter, setEntityFilter] = useState<EntityClass | "all">("all");
  const [entitySort, setEntitySort] = useState<"newest" | "confidence" | "delta">("newest");
  const [activeStyle, setActiveStyle] = useState<MemoStyle>(memoStyles.find((s) => s.id === "user.inferred") ?? memoStyles[0]);
  const isFirstVisit = useFirstVisit();
  const pulseVoice = useVoiceInput({
    mode: "browser",
    continuous: false,
    onTranscript: () => undefined,
    onEnd: (finalText) => {
      const text = finalText.trim();
      if (text) onAsk(text);
    },
  });
  // Sprint S4: pulse cards from durable live artifacts; optional supplements stay non-blocking.
  const { pulse: livePulse } = useHomePulseLive();
  const liveArtifacts = useLiveArtifacts(24);
  const pulseCards = liveArtifacts.pulse.length > 0 ? liveArtifacts.pulse : livePulse;
  const effectivePublicResearch = liveArtifacts.publicResearch;
  const primaryLiveReport = liveArtifacts.reports[0];
  const effectiveContinueWorking: ContinueItem[] = liveArtifacts.reports.slice(0, 3).map((report, index) => ({
    id: `live_continue_${report.id}`,
    reportId: report.id,
    title: report.entity,
    kind: report.kind,
    lastTouched: report.updatedAt,
    whatYouLeft: report.description,
    pendingFromAgent: index === 0 && report.followUps > 0 ? report.followUps : undefined,
  }));
  const effectiveWatchlist: WatchlistEntity[] = liveArtifacts.publicResearch.slice(0, 5).map((card, index) => ({
    id: `live_watch_${card.reportId ?? "research"}_${index}`,
    entity: card.entity,
    kind: card.entityClass === "role" ? "topic" : card.entityClass,
    signal: card.signal,
    delta: card.delta,
    confidence: card.confidence,
    lastSignalAt: card.whenAgo,
    trendUp: card.trendUp,
  }));
  const whatChangedItems = useMemo(() => pulseCards.map((card, index) => ({
    id: `pulse-${index}`,
    kind: card.kind === "follow_up" ? "follow_up" as const : card.kind === "memory_win" ? "claim" as const : "report" as const,
    title: card.title,
    detail: card.body,
    whenAgo: card.meta,
    href: primaryLiveReport ? `/redesign/workspace?report=${primaryLiveReport.id}&tab=brief` : undefined,
  })), [pulseCards, primaryLiveReport]);
  const tryStyle = (style: MemoStyle, entity: string) => {
    setActiveStyle(style);
    onAsk(`Run a ${style.name.toLowerCase()} on ${entity}.`);
  };

  const filteredSituations = useMemo(
    () => situations.filter((s) => s.window === situationWindow),
    [situationWindow]
  );

  const filteredEntities = useMemo(() => {
    let list = entityFilter === "all" ? effectivePublicResearch : effectivePublicResearch.filter((e) => e.entityClass === entityFilter);
    list = [...list];
    if (entitySort === "confidence") list.sort((a, b) => b.confidence - a.confidence);
    else if (entitySort === "delta") list.sort((a, b) => b.delta - a.delta);
    return list;
  }, [effectivePublicResearch, entityFilter, entitySort]);

  // Daily Intelligence Pulse — sparse 5-row hero (continues from prior version).
  const pulseLastResearch = effectiveContinueWorking[0];
  const pulseRelevantUpdate = whatChangedItems[0];
  const pulseEntityChanged = effectiveWatchlist.find((e) => e.delta !== 0) ?? effectiveWatchlist[0];
  const pulseRecommendedAction = primaryLiveReport && primaryLiveReport.followUps > 0
    ? { title: `${primaryLiveReport.followUps} follow-up${primaryLiveReport.followUps === 1 ? "" : "s"} pending`, detail: primaryLiveReport.entity, href: `/redesign/workspace?report=${primaryLiveReport.id}&tab=brief` }
    : pulseRelevantUpdate
      ? { title: "Re-run the latest brief", detail: pulseRelevantUpdate.title, href: pulseRelevantUpdate.href }
      : null;

  return (
    <div className="rd-stack" style={{ padding: "20px 40px 40px", gap: 20, maxWidth: 1180, margin: "0 auto" }}>
      {/* ─── 1. Daily Intelligence Pulse — sparse 5-row hero ─── */}
      <section
        className="rd-card"
        aria-label="Daily Intelligence Pulse"
        data-testid="daily-pulse-hero"
        style={{
          padding: "14px 18px",
          background: "var(--rd-paper-warm, #faf7f3)",
          borderColor: "var(--rd-line-faint)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <header className="rd-row" style={{ alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span className="rd-eyebrow" style={{ fontSize: 10, letterSpacing: "0.18em", color: "var(--rd-accent-strong)" }}>
            Daily intelligence pulse
          </span>
          <span className="rd-mono rd-faint" style={{ fontSize: 10.5 }}>
            {liveArtifacts.isLive ? `${effectiveContinueWorking.length} active reports · ${effectiveWatchlist.length} watched entities` : "starter pulse — sign in for live signals"}
          </span>
          {/* Phase 7d — return path to the editorial home.  After 7d,
              editorial is the default at /redesign and reaching this
              legacy surface means the user has `?classic=1` (or back-
              compat `?edition=0`) set.  Clicking this clears the
              query string and lands on default = editorial.  Reciprocal
              "← Switch to classic home" lives in EditorialHomeSurface
              and sets `?classic=1`. */}
          <a
            href="?"
            className="rd-edition-discover-link"
            data-edition-discover
            aria-label="Back to the daily edition (single-document brief)"
            style={{
              marginLeft: "auto",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
              color: "var(--rd-accent-strong, #d97757)",
              textDecoration: "none",
              padding: "4px 10px",
              borderRadius: 999,
              border: "1px solid var(--rd-accent-soft, rgba(217,119,87,0.32))",
              background: "var(--rd-accent-tint, rgba(217,119,87,0.08))",
              whiteSpace: "nowrap",
            }}
          >
            ← Back to daily edition
          </a>
          <button
            type="button"
            aria-label={pulseVoice.isListening ? "Stop voice input" : "Voice input using browser mode"}
            title={pulseVoice.isListening ? "Stop voice input" : "Voice input using browser mode"}
            onClick={pulseVoice.toggle}
            data-state={pulseVoice.isListening ? "active" : "idle"}
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              border: "1px solid var(--rd-line)",
              background: pulseVoice.isListening ? "var(--rd-accent-tint)" : "var(--rd-paper)",
              color: pulseVoice.isListening ? "var(--rd-accent-strong)" : "var(--rd-ink-mute)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.72)",
            }}
          >
            <Mic size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="rd-stack" style={{ gap: 4 }}>
          {pulseLastResearch ? (
            <button
              type="button"
              onClick={() => onOpenReport(pulseLastResearch.reportId)}
              style={{ display: "flex", gap: 12, padding: "8px 10px", borderRadius: 6, background: "transparent", border: "1px solid transparent", textAlign: "left", cursor: "pointer", alignItems: "center" }}
            >
              <span className="rd-mono rd-faint" style={{ width: 70, fontSize: 10.5, letterSpacing: "0.06em" }}>continue</span>
              <strong style={{ fontSize: 13.5, color: "var(--rd-ink-strong)", flex: 1 }}>{pulseLastResearch.title}</strong>
              <span className="rd-faint" style={{ fontSize: 11.5 }}>{pulseLastResearch.whatYouLeft}</span>
              <span className="rd-mono rd-faint" style={{ fontSize: 10 }}>{pulseLastResearch.lastTouched}</span>
            </button>
          ) : null}
          {pulseRelevantUpdate ? (
            <button
              type="button"
              onClick={() => { if (pulseRelevantUpdate.href) navigate(pulseRelevantUpdate.href); }}
              style={{ display: "flex", gap: 12, padding: "8px 10px", borderRadius: 6, background: "transparent", border: "1px solid transparent", textAlign: "left", cursor: "pointer", alignItems: "center" }}
            >
              <span className="rd-mono rd-faint" style={{ width: 70, fontSize: 10.5, letterSpacing: "0.06em" }}>update</span>
              <strong style={{ fontSize: 13.5, color: "var(--rd-ink-strong)", flex: 1 }}>{pulseRelevantUpdate.title}</strong>
              <span className="rd-faint" style={{ fontSize: 11.5 }}>{pulseRelevantUpdate.detail}</span>
              <span className="rd-mono rd-faint" style={{ fontSize: 10 }}>{pulseRelevantUpdate.whenAgo}</span>
            </button>
          ) : null}
          {pulseEntityChanged ? (
            <button
              type="button"
              onClick={() => onAsk(`What changed at ${pulseEntityChanged.entity}?`)}
              style={{ display: "flex", gap: 12, padding: "8px 10px", borderRadius: 6, background: "transparent", border: "1px solid transparent", textAlign: "left", cursor: "pointer", alignItems: "center" }}
            >
              <span className="rd-mono rd-faint" style={{ width: 70, fontSize: 10.5, letterSpacing: "0.06em" }}>watchlist</span>
              <strong style={{ fontSize: 13.5, color: "var(--rd-ink-strong)", flex: 1 }}>
                {pulseEntityChanged.entity}
                <span style={{ marginLeft: 8, fontSize: 11.5, color: pulseEntityChanged.trendUp ? "var(--rd-green, #15803d)" : "var(--rd-amber, #b45309)" }}>
                  {pulseEntityChanged.delta > 0 ? "↑" : pulseEntityChanged.delta < 0 ? "↓" : "·"} {pulseEntityChanged.signal}
                </span>
              </strong>
              <span className="rd-mono rd-faint" style={{ fontSize: 10 }}>{pulseEntityChanged.lastSignalAt}</span>
            </button>
          ) : null}
          {pulseRecommendedAction ? (
            <button
              type="button"
              onClick={() => { if (pulseRecommendedAction.href) navigate(pulseRecommendedAction.href); }}
              style={{ display: "flex", gap: 12, padding: "8px 10px", borderRadius: 6, background: "var(--rd-accent-tint)", border: "1px solid var(--rd-accent-ring)", textAlign: "left", cursor: "pointer", alignItems: "center" }}
            >
              <span className="rd-mono" style={{ width: 70, fontSize: 10.5, letterSpacing: "0.06em", color: "var(--rd-accent-strong)" }}>action</span>
              <strong style={{ fontSize: 13.5, color: "var(--rd-ink-strong)", flex: 1 }}>{pulseRecommendedAction.title}</strong>
              <span className="rd-faint" style={{ fontSize: 11.5 }}>{pulseRecommendedAction.detail}</span>
              <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-accent-strong)", fontWeight: 600 }}>open →</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onAsk("")}
            style={{ display: "flex", gap: 12, padding: "8px 10px", borderRadius: 6, background: "transparent", border: "1px dashed var(--rd-line-faint)", textAlign: "left", cursor: "pointer", alignItems: "center" }}
          >
            <span className="rd-mono rd-faint" style={{ width: 70, fontSize: 10.5, letterSpacing: "0.06em" }}>new</span>
            <strong style={{ fontSize: 13.5, color: "var(--rd-ink-mute)", flex: 1, fontWeight: 500 }}>Start new research</strong>
            <span className="rd-mono rd-faint" style={{ fontSize: 10 }}>jump to composer</span>
          </button>
        </div>
      </section>

      {/* ─── 2. What changed since last visit (returning users) ─── */}
      <WhatChangedStrip
        items={whatChangedItems}
        onOpen={(item) => {
          if (item.href) navigate(item.href);
          else showToast({ tone: "info", message: `Opening ${item.title}…` });
        }}
      />

      {/* ─── 3. Headline + composer (tight) ─── */}
      <header className="rd-stack" style={{ gap: 6, alignItems: "center", textAlign: "center", paddingTop: 4 }}>
        <h1 className="rd-display" style={{ textAlign: "center", margin: 0 }}>Ask once. Turn it into reusable intelligence.</h1>
        <p className="rd-body rd-faint" style={{ maxWidth: 600, fontSize: 14, lineHeight: 1.5, textAlign: "center", margin: 0 }}>
          Chat creates the intelligence. Reports preserve it. Notebook edits it. Sources prove it.
        </p>
      </header>

      <div style={{ maxWidth: 760, width: "100%", margin: "0 auto" }}>
        <UniversalComposer
          contextLabel={contextLabel}
          onContextChange={() =>
            setContextLabel(contextLabel.startsWith("Auto")
              ? `Adding to: ${primaryLiveReport?.entity ?? "current report"}`
              : "Auto: current context")
          }
          onSubmit={(text) => onAsk(text)}
          onChatNow={(text) => onAsk(text)}
          showRuntimeRibbon
          placeholder="First public dossier works without sign-in — ask a company, market, or question…"
        />
      </div>

      {/* ─── 4. 3-column ops dashboard ─── */}
      <section aria-label="Operations dashboard" className="rd-ops">
        <div className="rd-ops__col">
          <div className="rd-ops__head">
            <span className="rd-ops__title">Continue working</span>
            <span className="rd-ops__count">{effectiveContinueWorking.length} open</span>
          </div>
          {effectiveContinueWorking.length === 0 && (
            <div className="rd-ops__row">
              <div className="rd-ops__row-title">No live report in progress</div>
              <span style={{ fontSize: 12, color: "var(--rd-ink-mute)" }}>
                Run a daily brief or open Reports once live artifacts return.
              </span>
            </div>
          )}
          {effectiveContinueWorking.map((c) => (
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
          {pulseCards.length === 0 && (
            <div className="rd-ops__row">
              <div className="rd-ops__row-title">No new live changes yet</div>
              <span style={{ fontSize: 12, color: "var(--rd-ink-mute)", lineHeight: 1.45 }}>
                The archive and daily brief hooks are connected; this lane fills when Convex returns new artifacts.
              </span>
            </div>
          )}
          {pulseCards.map((card, index) => (
            <div key={`${card.meta}-${card.title}-${index}`} className="rd-ops__row">
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
            <span className="rd-ops__count">{effectiveWatchlist.length} entities</span>
          </div>
          {effectiveWatchlist.length === 0 && (
            <div className="rd-ops__row">
              <div className="rd-ops__row-title">No live watchlist signals</div>
              <span style={{ fontSize: 12, color: "var(--rd-ink-mute)" }}>
                Public archive rows and daily brief checks will appear here when available.
              </span>
            </div>
          )}
          {effectiveWatchlist.map((w) => (
            <WatchRow key={w.id} entity={w} />
          ))}
        </div>
      </section>

      {/* ─── 5. Latest Public Research (Pitchbook entity feed) ─── */}
      <section aria-label="Latest public research" className="rd-stack" style={{ gap: 10 }}>
        <div className="rd-row--between" style={{ alignItems: "flex-end" }}>
          <div>
            <div className="rd-eyebrow">{liveArtifacts.isLive ? "Live public artifacts" : "Latest public research"}</div>
            <h2 className="rd-h2" style={{ marginTop: 4 }}>
              {liveArtifacts.isLive
                ? "LinkedIn archive + daily brief memory, ready to reuse."
                : liveArtifacts.isLoading ? "Checking live archive and daily brief memory." : "No live public artifacts returned yet."}
            </h2>
          </div>
          <Pill tone={liveArtifacts.isLive ? "green" : "accent"}>
            {liveArtifacts.isLive ? liveArtifacts.sourceLabel : liveArtifacts.isLoading ? "Checking Convex" : "Empty live feed"}
          </Pill>
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
          {filteredEntities.length === 0 && (
            <div className="rd-card rd-card__pad" style={{ gridColumn: "1 / -1" }}>
              <div className="rd-eyebrow">Live feed empty</div>
              <p className="rd-body" style={{ marginTop: 6, color: "var(--rd-ink-mute)" }}>
                No LinkedIn archive rows or Daily Brief checks matched this filter. Clear filters or run an artifact refresh.
              </p>
            </div>
          )}
          {filteredEntities.slice(0, 6).map((e, index) => (
            <EntityCard
              key={`${e.reportId ?? e.entity}-${e.kind}-${index}`}
              card={e}
              onOpen={() => onOpenReport(e.reportId ?? `rep_${e.entity.toLowerCase().replace(/\s+/g, "_")}`)}
            />
          ))}
        </div>
        {filteredEntities.length > 6 && (
          <button
            type="button"
            className="rd-btn rd-btn--quiet rd-btn--sm"
            style={{ alignSelf: "flex-start" }}
            onClick={() => navigate("/redesign/reports")}
          >
            View all {filteredEntities.length} →
          </button>
        )}
      </section>

      {/* ─── 6. <details> Try a memo style (collapsed) ─── */}
      <details
        className="rd-card"
        style={{ padding: "14px 18px" }}
      >
        <summary
          style={{
            cursor: "pointer",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            listStyle: "none",
            gap: 10,
          }}
        >
          <div className="rd-stack" style={{ gap: 2 }}>
            <span className="rd-eyebrow">{isFirstVisit ? "Try a memo style" : "Your style + public references"}</span>
            <h2 className="rd-h2" style={{ marginTop: 0, fontSize: 16 }}>
              {isFirstVisit
                ? "Pick a memo style — see what NodeBench can become for you."
                : <>Active: <span style={{ color: "var(--rd-accent-strong)" }}>{activeStyle.name}</span></>}
            </h2>
          </div>
          <span className="rd-mono rd-faint" style={{ fontSize: 11 }}>open ▾</span>
        </summary>
        <div style={{ marginTop: 12 }}>
          {!isFirstVisit && (
            <div className="rd-row--between" style={{ alignItems: "center", marginBottom: 10 }}>
              <span className="rd-faint" style={{ fontSize: 12.5 }}>Drives every report you generate.</span>
              <button
                className="rd-btn rd-btn--quiet rd-btn--sm"
                onClick={() => navigate("/redesign/me")}
              >Manage style →</button>
            </div>
          )}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
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
        </div>
      </details>

      {/* ─── 7. <details> Pick the situation (collapsed) ─── */}
      <details
        className="rd-card"
        style={{ padding: "14px 18px" }}
      >
        <summary
          style={{
            cursor: "pointer",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            listStyle: "none",
            gap: 10,
          }}
        >
          <div className="rd-stack" style={{ gap: 2 }}>
            <span className="rd-eyebrow">Pick the situation</span>
            <h2 className="rd-h2" style={{ marginTop: 0, fontSize: 16 }}>
              NodeBench turns scattered context into a saved report.
            </h2>
          </div>
          <span className="rd-mono rd-faint" style={{ fontSize: 11 }}>open ▾</span>
        </summary>
        <div style={{ marginTop: 12 }}>
          <div className="rd-tabs" role="tablist" aria-label="Situation window" style={{ marginBottom: 12 }}>
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
        </div>
      </details>
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
