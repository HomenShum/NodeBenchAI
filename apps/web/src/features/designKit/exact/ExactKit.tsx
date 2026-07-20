import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api as generatedApi } from "../../../../convex/_generated/api";
import { useConvexApi } from "@/lib/convexApi";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import { useFastAgent } from "@/features/agents/context/FastAgentContext";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  Command,
  Copy,
  Eye,
  FileText,
  Grid3X3,
  Inbox,
  Link2,
  List,
  MessageSquare,
  Mic,
  Repeat,
  Send,
  Settings,
  Sparkles,
  User,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { buildCockpitPath, type CockpitSurfaceId } from "@/lib/registry/viewRegistry";
import { EntityFindingsPanel } from "@/features/narrative/components/social/EntityFindingsPanel";
import { PipelineRunsPanel } from "@/features/pipelines/views/PipelineRunsPanel";
import { PipelineLauncher } from "@/features/pipelines/views/PipelineLauncher";
import { PipelineSchedulesPanel } from "@/features/pipelines/views/PipelineSchedulesPanel";
import { PipelineEvalScorecard } from "@/features/pipelines/views/PipelineEvalScorecard";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { ExactComposer } from "@/features/designKit/exact/ExactComposer";
import {
  buildWorkspaceUrl,
  type WorkspaceTab,
} from "@/features/workspace/lib/workspaceRouting";
import { buildCompactReportsReadModel } from "@/features/reports/lib/compactReportsReadModel";
import {
  REPORT_CONTEXTUAL_ACTIONS,
  downloadReportCrmCsv,
  type ReportActionId,
} from "@/features/reports/lib/reportActions";
import { useIdleGate } from "@/lib/performance/useIdleGate";
import { useRoutePerformanceRecord } from "@/lib/performance/routeTiming";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useViewportMobile, TAILWIND_MD_QUERY } from "@/hooks/useViewportMobile";
import {
  FIRST_IMPRESSION_HORIZONS,
  createBackgroundResearchRequest,
  getFirstImpressionCards,
  type FirstImpressionCard,
  type FirstImpressionHorizon,
} from "@/features/home/lib/firstImpressionResearch";
import {
  useRedesignChatRun,
  type ChatAnswer as LiveChatAnswer,
  type RealChatRun,
} from "@/features/redesign/hooks/useRedesignChatRun";
import {
  acquireExactChatSubmitLock,
  hasSavedEntityReport,
  isExactChatRunInFlight,
  projectExactRuntimeSources,
  requireSuccessfulInboxMutation,
  type ExactRuntimeSource,
} from "@/features/designKit/exact/exactRuntimeContracts";

import "./exactKit.css";

type WebSurfaceProps = {
  onSurfaceChange?: (surface: CockpitSurfaceId) => void;
};

type MobileSurface = "home" | "reports" | "chat" | "inbox" | "me";

type PublicResearchHomeRow = {
  researchRunId: string;
  status: string;
  entityKey: string;
  entityName: string;
  entityType: string;
  updatedAt: number;
  claimCount: number;
  sourceCount: number;
  summary?: string;
  sources?: Array<{ title?: string; url: string }>;
};

const PROMPT_CARDS: Array<{ icon: LucideIcon; prompt: string }> = [
  { icon: Sparkles, prompt: "Research a company before a meeting." },
  { icon: FileText, prompt: "Summarize pasted filing text into a one-page brief." },
  { icon: Eye, prompt: "Compare two companies using current sources." },
];

function openWorkspace(workspaceId: string, tab: WorkspaceTab) {
  window.location.assign(buildWorkspaceUrl({ workspaceId, tab }));
}

function ReportThumb({
  label,
  colorA,
  colorB,
}: {
  label: string;
  colorA: string;
  colorB: string;
}) {
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <svg viewBox="0 0 420 236" role="img" aria-label={`${label} report preview`}>
      <defs>
        <linearGradient id={`g-${label.replace(/[^a-z0-9]/gi, "-")}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor={colorA} />
          <stop offset="100%" stopColor={colorB} />
        </linearGradient>
      </defs>
      <rect width="420" height="236" fill={`url(#g-${label.replace(/[^a-z0-9]/gi, "-")})`} />
      <circle cx="350" cy="36" r="70" fill="rgba(255,255,255,.14)" />
      <circle cx="68" cy="192" r="92" fill="rgba(255,255,255,.10)" />
      <rect x="28" y="28" width="104" height="26" rx="13" fill="rgba(255,255,255,.22)" />
      <rect x="28" y="76" width="270" height="14" rx="7" fill="rgba(255,255,255,.22)" />
      <rect x="28" y="101" width="222" height="10" rx="5" fill="rgba(255,255,255,.16)" />
      <text x="32" y="174" fill="#fffaf0" fontFamily="monospace" fontSize="44" fontWeight="800">{initials}</text>
    </svg>
  );
}

/**
* ResponsiveSurface keeps one canonical, runtime-backed surface tree at every
 * viewport. Mobile receives its established smoke-test wrapper and compact
 * styling, but never swaps in a second fixture-only implementation.
 */
function ResponsiveSurface({
  mobile,
  children,
}: {
  mobile: MobileSurface;
  children: ReactNode;
}) {
  const isMobile = useViewportMobile(TAILWIND_MD_QUERY);
  return (
    <div
      className={`nb-kit min-h-full${isMobile ? " nb-kit-responsive-mobile" : ""}`}
      data-testid={isMobile ? `mobile-${mobile}-surface` : undefined}
      data-responsive-surface={isMobile ? "mobile" : "desktop"}
      data-mobile-surface={mobile}
    >
      <div className="nb-shell">{children}</div>
    </div>
  );
}

/* Runtime-backed Home intelligence sections. */

function DeferredReportsPanel({ label }: { label: string }) {
  return (
    <section className="nb-deferred-panel" aria-label={`${label} loading`}>
      <span className="nb-deferred-panel-dot" aria-hidden />
      <span>{label} loading after the first reports view.</span>
    </section>
  );
}

function PipelineRuntimeUnavailable({ testId, label }: { testId: string; label: string }) {
  return (
    <section className="nb-deferred-panel" data-testid={testId} role="status">
      <span className="nb-deferred-panel-dot" aria-hidden />
      <span>{label} is temporarily unavailable. Saved reports remain accessible.</span>
    </section>
  );
}

function RuntimeEmptyState({
  testId,
  title,
  description,
}: {
  testId: string;
  title: string;
  description: string;
}) {
  return (
    <section className="nb-panel nb-runtime-empty" data-testid={testId} role="status">
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}

function FirstImpressionBoard({
  horizon,
  cards,
  onHorizonChange,
  onUsePrompt,
  onRunCard,
  submitting,
}: {
  horizon: FirstImpressionHorizon;
  cards: FirstImpressionCard[];
  onHorizonChange: (horizon: FirstImpressionHorizon) => void;
  onUsePrompt: (prompt: string) => void;
  onRunCard: (card: FirstImpressionCard) => void;
  submitting: boolean;
}) {
  return (
    <section className="nb-first-board" data-testid="home-first-impression-board">
      <header className="nb-first-board-head">
        <div>
          <div className="nb-kicker">Immediate relevance</div>
          <h2>Pick the situation. NodeBench turns scattered context into a background research bundle.</h2>
        </div>
        <div className="nb-first-tabs" role="tablist" aria-label="Research horizon">
          {FIRST_IMPRESSION_HORIZONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={horizon === item.id}
              data-active={horizon === item.id}
              onClick={() => onHorizonChange(item.id)}
            >
              {item.label}
              <small>{item.note}</small>
            </button>
          ))}
        </div>
      </header>
      <div className="nb-first-list">
        {cards.map((card) => (
          <article key={card.id} className="nb-first-card" data-audience={card.audience.toLowerCase()}>
            <div className="nb-first-card-main">
              <div className="nb-first-card-top">
                <span className="nb-badge nb-badge-accent">{card.audience}</span>
                <span className="nb-first-card-horizon">{card.horizon}</span>
              </div>
              <h3>{card.title}</h3>
              <p>{card.prompt}</p>
              <div className="nb-first-proof">
                {card.proofPoints.slice(0, 3).map((point) => (
                  <span key={point}><Check size={11} /> {point}</span>
                ))}
              </div>
            </div>
            <div className="nb-first-actions">
              <button type="button" className="nb-btn nb-btn-secondary" onClick={() => onUsePrompt(card.prompt)}>
                Fill prompt
              </button>
              <button
                type="button"
                className="nb-btn nb-btn-primary"
                disabled={submitting}
                onClick={() => onRunCard(card)}
              >
                <Clock3 size={13} />
                Run research
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

type TodayLane = {
  id: string;
  title: string;
  accent: "accent" | "indigo" | "success" | "warning";
  count: number;
  items: { hd: string; meta: string }[];
};

function NBTodayIntel({ liveEntities }: { liveEntities?: Array<any> }) {
  const live = Array.isArray(liveEntities) && liveEntities.length > 0;
  const liveSorted = live
    ? [...liveEntities!]
        .filter((e) => typeof e?.latestReportUpdatedAt === "number")
        .sort((a, b) => (b.latestReportUpdatedAt as number) - (a.latestReportUpdatedAt as number))
        .slice(0, 3)
    : [];

  const api = useConvexApi();
  const freshSignals = useQuery(
    api?.domains.ai.morningDigestQueries.getFreshCriticalSignals ?? "skip",
    api?.domains.ai.morningDigestQueries.getFreshCriticalSignals
      ? { lookbackHours: 48, maxSignals: 6 }
      : "skip",
  );
  const digest = useQuery(
    api?.domains.ai.morningDigestQueries.getDigestData ?? "skip",
    api?.domains.ai.morningDigestQueries.getDigestData ? {} : "skip",
  );
  const liveSignalItems: Array<{ hd: string; meta: string }> = ((freshSignals as any)?.signals as any[] | undefined)
    ?.slice(0, 3)
    .map((s) => ({
      hd: String(s?.title ?? "Untitled signal").slice(0, 80),
      meta: `${s?.source ?? "feed"} · ${formatRelativeWhen(typeof s?.timestamp === "number" ? s.timestamp : undefined)}`,
    })) ?? [];
  const liveWatchlistItems: Array<{ hd: string; meta: string }> = (
    (digest as any)?.watchlistRelevant as any[] | undefined
  )
    ?.slice(0, 3)
    .map((w) => ({
      hd: String(w?.title ?? "Watchlist item").slice(0, 80),
      meta: `${w?.source ?? "feed"} · ${formatRelativeWhen(typeof w?._creationTime === "number" ? w._creationTime : undefined)}`,
    })) ?? [];

  const lanes: TodayLane[] = [];
  if (liveSignalItems.length > 0) {
    const totalAvailable = (freshSignals as any)?.totalAvailable;
    lanes.push({
      id: "signal",
      title: "New signals",
      accent: "accent",
      count: typeof totalAvailable === "number" ? totalAvailable : liveSignalItems.length,
      items: liveSignalItems,
    });
  }
  if (live && liveSorted.length > 0) {
    lanes.push({
      id: "updated",
      title: "Reports updated",
      accent: "indigo",
      count: liveSorted.length,
      items: liveSorted.map((entity) => ({
          hd: String(entity?.name ?? "Untitled"),
          meta: `${entity?.reportCount ?? 0} reports · ${formatRelativeWhen(entity?.latestReportUpdatedAt as number | undefined)}`,
      })),
    });
  }
  if (liveWatchlistItems.length > 0) {
    lanes.push({
      id: "watchlist",
      title: "Watchlist changes",
      accent: "success",
      count: (digest as any)?.watchlistRelevant?.length ?? liveWatchlistItems.length,
      items: liveWatchlistItems,
    });
  }
  if (lanes.length === 0) return null;
  return (
    <section className="nb-home-block" data-testid="exact-home-today-intel">
      <header className="nb-home-block-head">
        <div>
          <div className="nb-kicker">Today&apos;s intelligence</div>
          <h3 className="nb-home-block-title">Pick up where memory left off.</h3>
        </div>
      </header>
      <div className="nb-today-grid">
        {lanes.map((lane) => (
          <article key={lane.id} className="nb-today-lane" data-accent={lane.accent}>
            <header className="nb-today-lane-head">
              <span className="nb-today-lane-dot" />
              <span className="nb-today-lane-title">{lane.title}</span>
              <span className="nb-today-lane-count">{lane.count}</span>
            </header>
            <ul className="nb-today-list">
              {lane.items.map((it, i) => (
                <li key={i} className="nb-today-item">
                  <div className="hd">{it.hd}</div>
                  <div className="meta">{it.meta}</div>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

function NBActiveEvent() {
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  const snapshot = useQuery(
    api?.domains.product.entities.getActiveEventSnapshot ?? "skip",
    api?.domains.product.entities.getActiveEventSnapshot
      ? { anonymousSessionId }
      : "skip",
  );
  const liveSnap = (snapshot as any)?.live === true && (snapshot as any)?.workspaceId;
  if (!liveSnap) return null;
  const title = String((snapshot as any).title ?? "Active workspace");
  const stats: Array<{ v: string | number; l: string; emph: boolean }> = [
    { v: Number((snapshot as any).entitiesDiscovered ?? 0), l: "entities discovered", emph: false },
    { v: Number((snapshot as any).evidenceCount ?? 0), l: "evidence items", emph: false },
    { v: Number((snapshot as any).followupCount ?? 0), l: "follow-ups", emph: false },
    { v: Number((snapshot as any).captureCount ?? 0), l: "private capture sessions", emph: false },
  ];
  const liveCaptures = ((snapshot as any).recentCaptures as Array<any> | undefined) ?? [];
  const captures = liveCaptures.length > 0
    ? liveCaptures.map((c) => ({
        time: formatRelativeWhen(typeof c?.time === "number" ? c.time : undefined),
        who: String(c?.who ?? "Capture"),
        note: String(c?.note ?? ""),
      }))
    : [];
  const freshness = (snapshot as any).lastUpdated
    ? `corpus freshness · ${formatRelativeWhen((snapshot as any).lastUpdated as number)}`
    : "freshness unavailable";
  return (
    <section className="nb-home-block nb-event" data-testid="exact-home-active-event">
      <header className="nb-home-block-head">
        <div>
          <div className="nb-kicker">
            <span className="nb-event-pip" /> Active workspace · {title}
          </div>
          <h3 className="nb-home-block-title">Corpus is compounding in real time.</h3>
        </div>
      </header>
      <div className="nb-event-stats">
        {stats.map((s, i) => (
          <div key={i} className="nb-event-stat" data-emph={s.emph}>
            <div className="v">{s.v}</div>
            <div className="l">{s.l}</div>
          </div>
        ))}
      </div>
      <div className="nb-event-captures">
        <div className="nb-event-captures-head">
          <span className="nb-kicker">Latest captures</span>
          <span className="nb-event-captures-meta">{freshness}</span>
        </div>
        <ul className="nb-event-cap-list">
          {captures.map((c, i) => (
            <li key={i} className="nb-event-cap">
              <span className="t">{c.time}</span>
              <span className="who">{c.who}</span>
              <span className="note">{c.note}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

type RecentEntry = {
  id: string;
  title: string;
  eyebrow: string;
  fresh: "fresh" | "updated" | "older";
  meta: string;
  teaser: string;
};

function NBRecentReports({
  onOpenReport,
  liveEntities,
}: {
  onOpenReport: (id: string) => void;
  liveEntities?: Array<any>;
}) {
  const liveCards: RecentEntry[] | undefined = liveEntities === undefined
    ? undefined
    : [...liveEntities]
        .filter((e) => typeof e?.latestReportUpdatedAt === "number" || (e?.reportCount ?? 0) > 0)
        .sort((a, b) => {
          const at = (a?.latestReportUpdatedAt as number | undefined) ?? a?.updatedAt ?? 0;
          const bt = (b?.latestReportUpdatedAt as number | undefined) ?? b?.updatedAt ?? 0;
          return bt - at;
        })
        .slice(0, 3)
        .map((entity) => {
          const latestUpdated = (entity?.latestReportUpdatedAt as number | undefined) ?? entity?.updatedAt;
          const ageMs = typeof latestUpdated === "number" ? Date.now() - latestUpdated : Infinity;
          const fresh: RecentEntry["fresh"] =
            ageMs < 1000 * 60 * 60 * 24 ? "fresh" : ageMs < 1000 * 60 * 60 * 24 * 7 ? "updated" : "older";
          const reportCount = entity?.reportCount ?? 0;
          return {
            id: String(entity?.slug ?? entity?._id ?? entity?.name ?? "entity"),
            title: String(entity?.name ?? "Untitled"),
            eyebrow: `${humanizeEntityType(entity?.entityType)} · ${formatRelativeWhen(latestUpdated)}`.toLowerCase(),
            fresh,
            meta: `${reportCount} report${reportCount === 1 ? "" : "s"}`,
            teaser: String(entity?.summary ?? "").slice(0, 180) || "Saved entity memory — open to see the full report.",
          };
        });
  const cards = liveCards ?? [];
  return (
    <section className="nb-home-block" data-testid="exact-home-recent-reports">
      <header className="nb-home-block-head">
        <div>
          <div className="nb-kicker">Recent reports</div>
          <h3 className="nb-home-block-title">Memory you can pick up at any branch.</h3>
        </div>
        <button type="button" className="nb-home-block-link" onClick={() => onOpenReport("__all__")}>All reports</button>
      </header>
      {liveCards === undefined ? (
        <RuntimeEmptyState
          testId="home-recent-reports-loading"
          title="Loading saved reports"
          description="Checking the runtime entity and report ledgers."
        />
      ) : cards.length === 0 ? (
        <RuntimeEmptyState
          testId="home-recent-reports-empty"
          title="No saved reports yet"
          description="Saved reports appear here only after a report-producing workflow completes."
        />
      ) : <div className="nb-recent-grid">
        {cards.map((r) => (
          // Mouse onClick anywhere on the card opens the report (preserves the
          // "whole card is clickable" affordance), but the article is NOT a
          // role="button" with tabIndex — that nests interactive controls
          // inside the inner Brief/Explore/Chat buttons (axe nested-interactive
          // serious violation). Keyboard users tab through the 3 inner buttons.
          <article
            key={r.id}
            className="nb-recent-card"
            onClick={() => onOpenReport(r.id)}
          >
            <header className="nb-recent-head">
              <span className="nb-recent-eye">{r.eyebrow}</span>
              <span className="nb-recent-fresh" data-state={r.fresh}>● {r.fresh}</span>
            </header>
            <h4 className="nb-recent-title">{r.title}</h4>
            <p className="nb-recent-teaser">{r.teaser}</p>
            <div className="nb-recent-meta">{r.meta}</div>
            <div className="nb-recent-actions">
              <button type="button" className="nb-recent-action" data-primary="true" onClick={(e) => { e.stopPropagation(); onOpenReport(r.id); }}>Open</button>
            </div>
          </article>
        ))}
      </div>}
    </section>
  );
}

export function ExactHomeSurface(_props: WebSurfaceProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [horizon, setHorizon] = useState<FirstImpressionHorizon>("today");
  const [backgroundSubmitting, setBackgroundSubmitting] = useState(false);
  const [backgroundFeedback, setBackgroundFeedback] = useState<{
    kind: "ok" | "error";
    message: string;
  } | null>(null);
  const voice = useVoiceInput({
    mode: "browser",
    continuous: false,
    onTranscript: (text) => {
      if (text.trim()) setQuery(text);
    },
    onEnd: (finalText) => {
      if (finalText.trim()) setQuery(finalText);
    },
  });
  const voiceActive = voice.isListening || voice.isTranscribing;

  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  const entities = useQuery(
    api?.domains.product.entities.listEntities ?? "skip",
    api?.domains.product.entities.listEntities
      ? { anonymousSessionId, search: "", filter: "All" }
      : "skip",
  );
  const latestPublicResearch = useQuery(
    (api as any)?.domains?.publicResearch?.core?.listLatestPublicEntityResearch ?? "skip",
    (api as any)?.domains?.publicResearch?.core?.listLatestPublicEntityResearch
      ? { limit: 8 }
      : "skip",
  ) as PublicResearchHomeRow[] | undefined;
  const startPipelineRun = useMutation(
    generatedApi.domains.pipelines.pipelineWorkflow.startPipelineRun,
  );
  const liveEntities = entities as Array<any> | undefined;
  const firstImpressionCards = useMemo(() => getFirstImpressionCards(horizon), [horizon]);

  const start = (nextQuery = query) => {
    const resolved = nextQuery.trim();
    navigate(buildCockpitPath({
      surfaceId: "workspace",
      extra: resolved ? { q: resolved } : undefined,
    }));
  };

  const startBackgroundResearch = async (nextQuery = query, title?: string) => {
    if (backgroundSubmitting) return;
    if (!isAuthenticated) {
      try {
        const redirectTo = (() => {
          if (typeof window === "undefined") return "/?surface=ask";
          const url = new URL(window.location.href);
          const pendingQuery = nextQuery.trim();
          if (pendingQuery) url.searchParams.set("q", pendingQuery);
          return url.toString();
        })();
        await signIn("google", {
          redirectTo,
        });
      } catch {
        setBackgroundFeedback({ kind: "error", message: "Sign-in could not be started. Try again." });
      }
      return;
    }
    const request = createBackgroundResearchRequest({
      query: nextQuery,
      title,
    });
    if (!request.spec.trim()) {
      setBackgroundFeedback({ kind: "error", message: "Add a query or choose a scenario first." });
      return;
    }
    setBackgroundSubmitting(true);
    setBackgroundFeedback(null);
    try {
      await startPipelineRun(request);
      setBackgroundFeedback({
        kind: "ok",
        message: "Background run started. Follow its progress and export the completed bundle from Reports Background runs.",
      });
      setQuery(request.spec);
    } catch (error) {
      setBackgroundFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBackgroundSubmitting(false);
    }
  };

  const openReport = (id: string) => {
    if (id === "__all__") {
      navigate(buildCockpitPath({ surfaceId: "packets" }));
      return;
    }
    navigate(buildCockpitPath({ surfaceId: "packets", extra: { report: id } }));
  };

  useRoutePerformanceRecord({
    routeId: "home",
    surfaceId: "home",
    rootSelector: '[data-testid="exact-web-home-surface"]',
    firstActionSelector: '[data-nb-perf-action="home-primary"]',
    dataSource: liveEntities === undefined ? "loading" : liveEntities.length > 0 ? "live_convex" : "empty",
  });

  return (
    <ResponsiveSurface mobile="home">
      <div
        className="nb-home-pulse"
        data-testid="exact-web-home-surface"
        data-nb-perf-root="home"
        style={{ display: "flex", flexDirection: "column", gap: 28 }}
      >
      <section className="nb-composer-hero">
        <div className="nb-kicker">On-the-go intelligence</div>
        <h1>Get the read before you walk in.</h1>
        <p>Ask in Chat for an immediate answer, or start background research you can inspect and export under Reports, in Background runs.</p>

        <div className="nb-composer-box" data-testid="exact-web-home-composer">
          <textarea
            className="nb-composer-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                start();
              }
            }}
            placeholder="Ask anything - a company, a market, or a question..."
            aria-label="Ask anything - a company, a market, or a question"
          />
          <div className="nb-composer-bottom">
            <span style={{ color: "var(--text-faint)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
              <Command size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> Enter
            </span>
            <button
              type="button"
              className="nb-icon-btn"
              aria-label={voiceActive ? "Stop voice input" : `Voice input using ${voice.mode} mode`}
              aria-pressed={voiceActive}
              title={voiceActive ? "Stop voice input" : `Voice input (${voice.mode})`}
              onClick={voice.toggle}
              data-state={voiceActive ? "active" : "inactive"}
            >
              <Mic size={15} />
            </button>
            <button
              type="button"
              className="nb-btn nb-btn-secondary"
              aria-label="Open workspace"
              onClick={() => start()}
            >
              <MessageSquare size={14} />
              Chat now
            </button>
            <button
              type="button"
              className="nb-btn nb-btn-primary"
              data-nb-perf-action="home-primary"
              data-testid="home-background-run"
              disabled={authLoading || backgroundSubmitting || (isAuthenticated && !query.trim())}
              title={
                !isAuthenticated
                  ? "Sign in to start background research"
                  : !query.trim()
                    ? "Add a research question first"
                    : undefined
              }
              onClick={() => void startBackgroundResearch()}
            >
              {backgroundSubmitting ? <Clock3 size={14} /> : <Send size={14} />}
              {isAuthenticated ? "Run research" : "Sign in to run"}
            </button>
          </div>
        </div>

        <div className="nb-async-proof" data-testid="home-async-proof">
          <span><Clock3 size={12} /> Background runs continue server-side and stay visible in Reports.</span>
        </div>
        {voiceActive || voice.error ? (
          <div className="nb-voice-status" role={voice.error ? "alert" : "status"} aria-live="polite">
            {voice.error ? voice.error : voice.isTranscribing ? "Transcribing voice input..." : "Listening for voice input..."}
          </div>
        ) : null}

        <div
          style={{
            alignItems: "center",
            background: "rgba(255,255,255,0.76)",
            border: "1px solid var(--border-default)",
            borderRadius: 18,
            boxShadow: "0 18px 42px -34px rgba(15,23,42,0.38)",
            display: "flex",
            gap: 12,
            justifyContent: "space-between",
            margin: "14px auto 0",
            maxWidth: 680,
            padding: "12px 14px",
            width: "100%",
          }}
        >
          <div style={{ minWidth: 0, textAlign: "left" }}>
            <div style={{ alignItems: "center", color: "var(--text-primary)", display: "flex", fontSize: 13, fontWeight: 800, gap: 7 }}>
              <Link2 size={14} />
              <span>First public dossier works without sign-in.</span>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.55, margin: "4px 0 0" }}>
              Link NodeBench after the first sourced result to keep memory, raise limits, and add team controls.
            </p>
          </div>
          <button
            type="button"
            className="nb-btn nb-btn-secondary"
            onClick={() => navigate("/settings?tab=connections")}
            style={{ flexShrink: 0 }}
          >
            Link when ready
          </button>
        </div>

        {backgroundFeedback ? (
          <div
            className="nb-background-feedback"
            data-state={backgroundFeedback.kind}
            role={backgroundFeedback.kind === "error" ? "alert" : "status"}
          >
            {backgroundFeedback.message}
            {backgroundFeedback.kind === "ok" ? (
              <button
                type="button"
                className="nb-btn nb-btn-secondary"
                onClick={() => navigate(buildCockpitPath({ surfaceId: "packets" }))}
              >
                View activity
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="nb-example-strip" aria-label="Example research prompts">
          {PROMPT_CARDS.map(({ icon: Icon, prompt }) => (
            <button
              key={prompt}
              type="button"
              className="nb-example-chip"
              onClick={() => {
                setQuery(prompt);
                start(prompt);
              }}
            >
              <span className="nb-prompt-icon"><Icon size={13} /></span>
              <span>{prompt}</span>
            </button>
          ))}
        </div>
      </section>

      {(latestPublicResearch?.length ?? 0) > 0 ? (
        <section className="nb-public-memory" data-testid="exact-latest-public-research">
          <div className="nb-public-memory-head">
            <div>
              <div className="nb-kicker">Latest public research</div>
              <h2>Reusable public memory from recent entity runs.</h2>
            </div>
            <span>Public claims only</span>
          </div>
          <div className="nb-public-memory-grid">
            {latestPublicResearch?.slice(0, 6).map((item) => (
              <button
                key={item.entityKey}
                type="button"
                className="nb-public-memory-card"
                onClick={() => start(`Open public dossier for ${item.entityName}`)}
              >
                <div className="nb-public-memory-card-top">
                  <div>
                    <strong>{item.entityName}</strong>
                    <small>{item.entityType} - {item.status.replace(/_/g, " ")} - {formatRelativeWhen(item.updatedAt)}</small>
                  </div>
                  <ArrowUpRight size={15} />
                </div>
                <p>{item.summary || "Research run recorded. Verified public claims appear as sources are extracted."}</p>
                <div className="nb-public-memory-meta">
                  <span>{item.claimCount} claim{item.claimCount === 1 ? "" : "s"}</span>
                  <span>{item.sourceCount} source{item.sourceCount === 1 ? "" : "s"}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <FirstImpressionBoard
        horizon={horizon}
        cards={firstImpressionCards}
        onHorizonChange={setHorizon}
        onUsePrompt={setQuery}
        onRunCard={(card) => void startBackgroundResearch(card.prompt, card.title)}
        submitting={backgroundSubmitting}
      />

      <details className="nb-home-more">
        <summary>
          <span>Recent intelligence and saved reports</span>
          <small>Open when you want the dashboard view</small>
        </summary>
        <div className="nb-home-more-body">
          <div className="nb-home-grid">
            <NBTodayIntel liveEntities={liveEntities} />
            <NBActiveEvent />
          </div>

          <NBRecentReports onOpenReport={openReport} liveEntities={liveEntities} />
        </div>
      </details>
      </div>
    </ResponsiveSurface>
  );
}

/* Runtime entity-to-report projection used by the canonical Reports surface. */
const ENTITY_TONE_PAIRS: Record<string, [string, string]> = {
  company: ["#1a365d", "#d97757"],
  person: ["#6b3ba3", "#d97757"],
  job: ["#0e7a5c", "#5e6ad2"],
  market: ["#0e7a5c", "#16a37e"],
  note: ["#475569", "#d97757"],
};

function humanizeEntityType(value?: string): string {
  if (!value) return "Entity";
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "company") return "Company";
  if (trimmed === "person") return "Person";
  if (trimmed === "job") return "Role";
  if (trimmed === "market") return "Market";
  if (trimmed === "note") return "Note";
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
}

type ExactReportCard = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  state: string;
  sources: number;
  updated: string;
  watched: boolean;
  colorA: string;
  colorB: string;
};

/* ──────────────────────────────────────────────────────────────────────────
   Inline report detail (cockpit-embedded)
   When ?surface=packets&report=<id> is set, ExactReportsSurface renders
   ExactReportDetailSurface inline instead of the grid — matches the design
   system mock (claude.ai/design preview): breadcrumb back + header + actions
   + section content, all within the cockpit shell. No subdomain redirect.
   ────────────────────────────────────────────────────────────────────────── */

type ReportSection = { id: string; heading: string; body: string; quote?: { text: string; cite: string } };

type ReportDetail = {
  id: string;
  eyebrow: string;
  title: string;
  template: string;
  scope: string;
  branches: number;
  sources: number;
  saved: string;
  sections: ReportSection[];
  card?: { kind: string; name: string; rows: [string, string][] };
};

export function ExactReportDetailSurface({ reportId, onBack }: { reportId: string; onBack: () => void }) {
  const navigate = useNavigate();

  // Pull the live entity workspace by slug. Missing runtime content stays
  // missing rather than substituting a completed dossier.
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  const liveWorkspace = useQuery(
    api?.domains.product.entities.getEntityWorkspace ?? "skip",
    api?.domains.product.entities.getEntityWorkspace
      ? { anonymousSessionId, entitySlug: reportId }
      : "skip",
  );

  const liveDetail = useMemo<ReportDetail | null>(() => {
    if (!liveWorkspace) return null;
    const ws = liveWorkspace as any;
    const entity = ws?.entity;
    const latest = ws?.latest;
    if (!entity) return null;
    const liveSections: ReportSection[] =
      Array.isArray(latest?.sections) && latest!.sections.length > 0
        ? latest!.sections.slice(0, 8).map((s: any, idx: number) => ({
            id: String(s?.id ?? `s-${idx}`),
            heading: String(s?.title ?? `Section ${idx + 1}`),
            body: String(s?.body ?? "").slice(0, 2400),
          }))
        : [];
    if (liveSections.length === 0) return null;
    const reportCount = Number(entity?.reportCount ?? 0);
    const sourceCount = Array.isArray(latest?.sources) ? latest.sources.length : 0;
    return {
      id: String(entity?.slug ?? entity?._id ?? reportId),
      eyebrow: `${humanizeEntityType(entity?.entityType)} · ${formatRelativeWhen(latest?.updatedAt as number | undefined)}`,
      title: String(entity?.name ?? "Untitled"),
      template: String(latest?.type ?? "Saved entity"),
      scope: latest?.routing?.routingReason
        ? String(latest.routing.routingReason).slice(0, 60)
        : "Saved entity context",
      branches: reportCount,
      sources: sourceCount,
      saved: `Saved ${formatRelativeWhen(latest?.updatedAt as number | undefined)}`,
      sections: liveSections,
    };
  }, [liveWorkspace, reportId]);

  if (liveWorkspace === undefined) {
    return (
      <ResponsiveSurface mobile="reports">
        <RuntimeEmptyState
          testId="report-detail-loading"
          title="Loading report"
          description="NodeBench is checking the runtime report store."
        />
      </ResponsiveSurface>
    );
  }
  const detail = liveDetail;
  if (!detail) {
    return (
      <ResponsiveSurface mobile="reports">
        <section style={{ padding: 24 }} data-testid="exact-web-report-detail" data-report-id={reportId}>
          <button
            type="button"
            className="nb-btn nb-btn-secondary"
            data-testid="report-detail-back"
            onClick={onBack}
          >
            ← Back to reports
          </button>
          <p style={{ marginTop: 12, color: "var(--text-muted)" }}>No runtime-backed report was found for this id.</p>
        </section>
      </ResponsiveSurface>
    );
  }

  return (
    <ResponsiveSurface mobile="reports">
      <section className="nb-rdetail-cockpit" data-testid="exact-web-report-detail" data-report-id={detail.id}>
        <header className="nb-rdetail-cockpit-head">
          <nav className="nb-rdetail-crumb" aria-label="Breadcrumb">
            <button
              type="button"
              className="nb-rdetail-back"
              data-testid="report-detail-back"
              onClick={onBack}
              aria-label="Back to reports"
            >
              <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
            </button>
            <button
              type="button"
              className="nb-rdetail-crumb-link"
              onClick={onBack}
            >
              Reports
            </button>
            <span className="nb-rdetail-crumb-sep">/</span>
            <span className="nb-rdetail-crumb-link" aria-disabled>{detail.template.split(" ")[0]}</span>
            <span className="nb-rdetail-crumb-sep">/</span>
            <span className="nb-rdetail-crumb-current">{detail.title}</span>
          </nav>
          <div className="nb-rdetail-actions">
            <span className="nb-rdetail-live" aria-label="Saved report status">
              Saved · {detail.saved.replace(/^Saved\s+/, "")}
            </span>
            <button
              type="button"
              className="nb-btn nb-btn-primary nb-rdetail-action"
              onClick={() => navigate(buildCockpitPath({ surfaceId: "workspace", extra: { q: detail.title } }))}
            >
              <MessageSquare size={13} /> Ask agent
            </button>
          </div>
        </header>

        <div className="nb-rdetail-eyebrow">{detail.eyebrow}</div>
        <h1 className="nb-rdetail-title">{detail.title}</h1>

        <div className="nb-rdetail-meta">
          <span className="nb-badge">{detail.template}</span>
          <span className="nb-badge">{detail.scope}</span>
          <span className="nb-badge">{detail.branches} saved report{detail.branches === 1 ? "" : "s"} · {detail.sources} sources</span>
          <span className="nb-badge nb-badge-quiet">{detail.saved}</span>
        </div>

        <div className="nb-rdetail-body">
          {detail.sections.map((section) => (
            <section key={section.id} className="nb-rdetail-section" id={`s-${section.id}`}>
              <h2 className="nb-rdetail-section-head">{section.heading}</h2>
              <p className="nb-rdetail-section-body">{section.body}</p>
              {section.quote && (
                <blockquote className="nb-rdetail-quote">
                  <p>{section.quote.text}</p>
                  <cite>— {section.quote.cite}</cite>
                </blockquote>
              )}
              {section.id === "product" && detail.card && (
                <div className="nb-rdetail-card" role="region" aria-label={`${detail.card.kind} card · ${detail.card.name}`}>
                  <header className="nb-rdetail-card-head">
                    <span className="nb-rdetail-card-kind">{detail.card.kind}</span>
                    <span className="nb-rdetail-card-tag">EMBEDDED CARD</span>
                  </header>
                  <h3 className="nb-rdetail-card-name">{detail.card.name}</h3>
                  <dl className="nb-rdetail-card-rows">
                    {detail.card.rows.map(([k, v]) => (
                      <div key={k} className="nb-rdetail-card-row">
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </section>
          ))}
        </div>
      </section>
    </ResponsiveSurface>
  );
}

export function ExactReportsSurface() {
  const [searchParams, setSearchParams] = useSearchParams();
  const reportParam = searchParams.get("report");
  const navigate = useNavigate();

  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  const entities = useQuery(
    api?.domains.product.entities.listEntities ?? "skip",
    api?.domains.product.entities.listEntities
      ? { anonymousSessionId, search: "", filter: "All" }
      : "skip",
  );

  const liveReports: ExactReportCard[] | undefined = useMemo(() => {
    const list = entities as Array<any> | undefined;
    if (list === undefined) return undefined;
    return list.filter(hasSavedEntityReport).map((entity) => {
      const tone = ENTITY_TONE_PAIRS[String(entity.entityType ?? "").toLowerCase()] ?? ["#475569", "#d97757"];
      const reportCount = typeof entity.reportCount === "number" ? entity.reportCount : 0;
      const updatedAt = typeof entity.latestReportUpdatedAt === "number" ? entity.latestReportUpdatedAt : entity.updatedAt;
      return {
        id: String(entity.slug ?? entity._id ?? entity.name),
        kind: humanizeEntityType(entity.entityType),
        title: String(entity.name ?? "Untitled"),
        summary: String(entity.summary ?? ""),
        state: "saved",
        sources: Array.isArray(entity.sourceUrls) ? entity.sourceUrls.length : 0,
        updated: formatRelativeWhen(typeof updatedAt === "number" ? updatedAt : undefined),
        watched: false,
        colorA: tone[0],
        colorB: tone[1],
      };
    });
  }, [entities]);

  const [view, setView] = useState<"grid" | "list">("grid");
  const [visibleReportCount, setVisibleReportCount] = useState(12);
  const [reportsOpsOpen, setReportsOpsOpen] = useState(false);
  const backgroundReady = useIdleGate({ timeoutMs: 850 });

  useEffect(() => {
    setVisibleReportCount(12);
  }, [liveReports]);

  const reportsReadModel = useMemo(
    () =>
      buildCompactReportsReadModel({
        liveReports,
        filter: "all",
        visibleCount: visibleReportCount,
      }),
    [liveReports, visibleReportCount],
  );

  useRoutePerformanceRecord({
    routeId: reportParam ? "reports-detail" : "reports",
    surfaceId: "reports",
    rootSelector: reportParam ? '[data-testid="exact-web-report-detail"]' : '[data-testid="reports-performance-root"]',
    firstActionSelector: reportParam ? '[data-testid="report-detail-back"]' : '[data-testid="pipeline-launcher-submit"], [data-testid="report-card"]',
    dataSource: reportsReadModel.sourceKind,
  });

  const goBackToGrid = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("report");
    setSearchParams(next, { replace: false });
  };

  const openInlineReport = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("surface", "packets");
    next.set("report", id);
    setSearchParams(next, { replace: false });
  };

  const handleReportAction = (
    report: ExactReportCard,
    actionId: ReportActionId,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    event.stopPropagation();
    if (actionId === "open_sources") {
      openWorkspace(report.id, "sources");
      return;
    }
    if (actionId === "open_notebook") {
      openWorkspace(report.id, "notebook");
      return;
    }
    if (actionId === "resume_chat") {
      navigate(buildCockpitPath({ surfaceId: "workspace", extra: { q: report.title, report: report.id } }));
      return;
    }
    if (actionId === "export_crm_csv") {
      downloadReportCrmCsv(report);
    }
  };

  // Inline detail view: ?surface=packets&report=<id> renders within the
  // cockpit shell instead of redirecting to the workspace subdomain.
  if (reportParam) {
    return <ExactReportDetailSurface reportId={reportParam} onBack={goBackToGrid} />;
  }

  return (
    <ResponsiveSurface mobile="reports">
      <section data-testid="reports-performance-root" data-reports-source={reportsReadModel.sourceKind}>
        <div className="nb-reports-toolbar">
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 760, letterSpacing: "-0.02em" }}>Reports</h1>
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
              Saved research reports with sources, review status, exports, and follow-up actions.
            </p>
          </div>
          {reportsReadModel.sourceKind === "live_convex" && reportsReadModel.filteredReports.length > 0 ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="nb-reports-source-pill" data-source={reportsReadModel.sourceKind}>
                {reportsReadModel.sourceLabel} - {reportsReadModel.filteredReports.length} reports
              </span>
              <div className="nb-view-toggle" aria-label="Report view">
                <button type="button" data-active={view === "grid"} onClick={() => setView("grid")}><Grid3X3 size={13} /> Grid</button>
                <button type="button" data-active={view === "list"} onClick={() => setView("list")}><List size={13} /> List</button>
              </div>
            </div>
          ) : null}
        </div>

        <section className="nb-research-workbench nb-research-workbench-minimal" data-testid="reports-research-workbench">
          <header className="nb-report-command-head">
            <span className="nb-report-command-title">Start background research</span>
            <span className="nb-report-command-note">continues server-side</span>
          </header>
          <div className="nb-workbench-panel" data-testid="reports-pipeline-launcher-slot">
            <PipelineLauncher />
          </div>
          <div data-testid="reports-pipelines-panel-slot">
            <ErrorBoundary
              section="Background runs"
              fallback={<PipelineRuntimeUnavailable testId="pipeline-runs-unavailable" label="Background-run activity" />}
            >
              <PipelineRunsPanel initialVisibleCount={4} queryLimit={12} windowStep={4} />
            </ErrorBoundary>
          </div>
          <details
            className="nb-reports-ops-disclosure"
            open={reportsOpsOpen}
            onToggle={(event) => setReportsOpsOpen(event.currentTarget.open)}
          >
            <summary>Advanced</summary>
            {reportsOpsOpen ? (
              <div className="nb-reports-ops-grid">
                <div data-testid="reports-pipeline-eval-slot">
                  {backgroundReady ? (
                    <ErrorBoundary
                      section="Research quality"
                      fallback={<PipelineRuntimeUnavailable testId="pipeline-eval-unavailable" label="Research quality" />}
                    >
                      <PipelineEvalScorecard />
                    </ErrorBoundary>
                  ) : <DeferredReportsPanel label="Research quality" />}
                </div>
                <div className="nb-workbench-stack">
                  <div data-testid="reports-pipeline-schedules-slot">
                    {backgroundReady ? (
                      <ErrorBoundary
                        section="Automatic refreshes"
                        fallback={<PipelineRuntimeUnavailable testId="pipeline-schedules-unavailable" label="Automatic refreshes" />}
                      >
                        <PipelineSchedulesPanel initialVisibleCount={3} queryLimit={9} windowStep={3} />
                      </ErrorBoundary>
                    ) : (
                      <DeferredReportsPanel label="Automatic refreshes" />
                    )}
                  </div>
                  <div data-testid="reports-findings-panel-slot">
                    {backgroundReady ? <EntityFindingsPanel /> : <DeferredReportsPanel label="Entity findings" />}
                  </div>
                </div>
              </div>
            ) : null}
          </details>
        </section>

        {reportsReadModel.sourceKind === "loading" ? (
          <RuntimeEmptyState
            testId="reports-loading"
            title="Loading saved reports"
            description="NodeBench is checking the runtime report store."
          />
        ) : reportsReadModel.sourceKind === "empty" ? (
          <RuntimeEmptyState
            testId="reports-empty"
            title="No saved reports yet"
            description="No saved entity reports yet. Background-run progress and output are listed above."
          />
        ) : <div className="nb-reports-grid" data-view={view}>
          {reportsReadModel.visibleReports.map((report) => (
            <article
              key={report.id}
              className="nb-rcard"
              data-testid="report-card"
              data-exact-testid="exact-report-card"
            >
              <div className="nb-rcard-thumb">
                <ReportThumb label={report.title} colorA={report.colorA} colorB={report.colorB} />
                <div className="nb-rcard-thumb-overlay">
                  <span className="nb-badge nb-badge-accent">{report.kind}</span>
                  <span className={report.state === "verified" ? "nb-badge nb-badge-success" : "nb-badge"}>
                    {report.state}
                  </span>
                </div>
              </div>
              <div className="nb-rcard-body">
                <button
                  type="button"
                  className="nb-rcard-title"
                  aria-label={`Open ${report.title} report`}
                  onClick={() => openInlineReport(report.id)}
                >
                  {report.title}
                </button>
                <div className="nb-rcard-sub">{report.summary}</div>
                <div data-testid="report-card-actions" className="nb-rcard-actions">
                  {REPORT_CONTEXTUAL_ACTIONS.filter((action) => action.id === "resume_chat").map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className="nb-btn nb-btn-secondary"
                      data-nb-action={action.id}
                      aria-label={action.ariaLabel}
                      onClick={(event) => handleReportAction(report, action.id, event)}
                    >
                      {action.label}
                    </button>
                  ))}
                  <details className="nb-rcard-more">
                    <summary>More</summary>
                    <div className="nb-rcard-more-actions">
                      {REPORT_CONTEXTUAL_ACTIONS.filter((action) => action.id !== "resume_chat").map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          className="nb-btn nb-btn-secondary"
                          data-nb-action={action.id}
                          aria-label={action.ariaLabel}
                          onClick={(event) => handleReportAction(report, action.id, event)}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </details>
                </div>
                <div className="nb-rcard-foot">
                  {report.sources > 0 ? <span>{report.sources} linked source{report.sources === 1 ? "" : "s"}</span> : null}
                  <span>{report.updated}</span>
                </div>
              </div>
            </article>
          ))}
        </div>}
        {reportsReadModel.hasMore ? (
          <div className="nb-show-more-row">
            <button
              type="button"
              className="nb-btn nb-btn-secondary"
              data-testid="reports-show-more"
              onClick={() => setVisibleReportCount((count) => count + 12)}
            >
              Show {Math.min(12, reportsReadModel.hiddenCount)} more reports
            </button>
          </div>
        ) : null}
      </section>
    </ResponsiveSurface>
  );
}

/* Runtime-backed profile, recent entities, sessions, theme, and settings. */

type RecencyDot = "hot" | "warm" | "cool";

function RecentEntityRow({ name, detail, dot, color }: { name: string; detail: string; dot: RecencyDot; color: string }) {
  return (
    <div className="nb-avm-watch-row">
      <div className="nb-avm-watch-mark" style={{ background: `${color}22`, color }}>{name[0]}</div>
      <div className="nb-avm-watch-body">
        <div className="nb-avm-watch-name">{name}</div>
        <div className="nb-avm-watch-detail">{detail}</div>
      </div>
      <span className="nb-avm-watch-dot" data-dot={dot} />
    </div>
  );
}

function SessionRow({ time, device, current = false }: { time: string; device: string; current?: boolean }) {
  return (
    <div className="nb-avm-session">
      <span className="nb-avm-session-dot" data-current={current} />
      <span className="nb-avm-session-time">{time}</span>
      <span className="nb-avm-session-device">{device}</span>
      {current && <span className="nb-avm-session-this">THIS</span>}
    </div>
  );
}

function ThemeSegment({ resolvedMode, setMode }: { resolvedMode: "light" | "dark"; setMode: (m: "light" | "dark") => void }) {
  return (
    <div className="nb-avm-theme">
      {(["light", "dark"] as const).map((id) => {
        const active = resolvedMode === id;
        return (
          <button
            key={id}
            type="button"
            className="nb-avm-theme-opt"
            data-active={active}
            onClick={() => { if (!active) setMode(id); }}
          >
            {id === "light" ? "Light" : "Dark"}
          </button>
        );
      })}
    </div>
  );
}

export function ExactAvatarMenu({
  resolvedMode,
  setMode,
  onSurfaceChange,
}: {
  resolvedMode: "light" | "dark";
  setMode: (m: "light" | "dark") => void;
  onSurfaceChange?: (s: CockpitSurfaceId) => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  const loggedInUser = useQuery(
    (api as any)?.domains?.auth?.auth?.loggedInUser ?? "skip",
  ) as { name?: string; email?: string } | null | undefined;
  const recentEntities = useQuery(
    api?.domains.product.entities.listEntities ?? "skip",
    api?.domains.product.entities.listEntities
      ? { anonymousSessionId, search: "", filter: "All" }
      : "skip",
  );
  const liveEntitiesArr = recentEntities as Array<any> | undefined;

  const recordSession = useMutation(api?.domains.product.entities.recordCurrentSession);
  const recentSessions = useQuery(
    api?.domains.product.entities.listRecentSessions ?? "skip",
    api?.domains.product.entities.listRecentSessions
      ? { anonymousSessionId }
      : "skip",
  );
  useEffect(() => {
    if (!recordSession) return;
    let sessionKey = "";
    try {
      const k = sessionStorage.getItem("nb-session-key");
      if (k) sessionKey = k;
      else {
        sessionKey = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        sessionStorage.setItem("nb-session-key", sessionKey);
      }
    } catch {
      sessionKey = `s-fallback-${Date.now()}`;
    }
    const ua = navigator.userAgent;
    const platform =
      /Mac/i.test(ua) ? "MacBook" : /Windows/i.test(ua) ? "Windows" : /Linux/i.test(ua) ? "Linux" : /iPhone/i.test(ua) ? "iPhone" : /Android/i.test(ua) ? "Android" : "Device";
    const browser =
      /Edg\//i.test(ua) ? "Edge" : /Chrome\//i.test(ua) ? "Chrome" : /Safari\//i.test(ua) ? "Safari" : /Firefox\//i.test(ua) ? "Firefox" : "Browser";
    const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone.split("/")[1]?.slice(0, 3).toUpperCase() ?? ""; } catch { return ""; } })();
    const deviceLabel = [platform, browser, tz].filter(Boolean).join(" · ");
    void recordSession({ anonymousSessionId, sessionKey, deviceLabel }).catch(() => {});
  }, [recordSession, anonymousSessionId]);
  const liveSessionRows = recentSessions as Array<any> | undefined;

  const recentEntityPreview =
    Array.isArray(liveEntitiesArr) && liveEntitiesArr.length > 0
      ? [...liveEntitiesArr]
          .sort((a, b) => (b?.updatedAt ?? 0) - (a?.updatedAt ?? 0))
          .slice(0, 3)
          .map((entity) => {
            const ageMs =
              typeof entity?.updatedAt === "number" ? Date.now() - entity.updatedAt : Infinity;
            const dot: "hot" | "warm" | "cool" =
              ageMs < 1000 * 60 * 60 * 6 ? "hot" : ageMs < 1000 * 60 * 60 * 24 * 2 ? "warm" : "cool";
            const reportCount = entity?.reportCount ?? 0;
            return {
              name: String(entity?.name ?? "Entity"),
              detail: `${reportCount} report${reportCount === 1 ? "" : "s"} · ${formatRelativeWhen(entity?.updatedAt as number | undefined)}`,
              dot,
              color: dot === "hot" ? "#D97757" : dot === "warm" ? "#5E6AD2" : "#3F8F6E",
            };
          })
      : [];
  const recentEntityTotal =
    Array.isArray(liveEntitiesArr) ? liveEntitiesArr.length : 0;
  const identityName = loggedInUser?.name?.trim() || "Guest workspace";
  const identityDetail = loggedInUser?.email?.trim() || "Anonymous session";
  const identityInitial = identityName.slice(0, 1).toUpperCase() || "N";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const goMe = () => {
    setOpen(false);
    onSurfaceChange?.("connect");
  };
  const goSettings = () => {
    setOpen(false);
    navigate("/settings");
  };

  return (
    <div ref={ref} className="nb-avm-root">
      <button
        type="button"
        className="nb-avm-trigger"
        data-active={open}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open profile"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="nb-avm-avatar-sm">{identityInitial}</div>
        <ChevronRight size={12} className="nb-avm-chev" data-open={open} style={{ transform: open ? "rotate(90deg)" : "rotate(90deg)" }} />
      </button>
      {open && (
        <div role="menu" className="nb-avm-menu" data-testid="exact-avatar-menu">
          <div className="nb-avm-identity">
            <div className="nb-avm-avatar-lg">{identityInitial}</div>
            <div className="nb-avm-identity-body">
              <div className="nb-avm-name">{identityName}</div>
              <div className="nb-avm-id">{identityDetail}</div>
            </div>
          </div>

          <div className="nb-avm-section">
            <div className="nb-avm-section-head">
              <span className="nb-avm-section-label">Recent entities · {recentEntityTotal}</span>
              <button type="button" className="nb-avm-section-link" onClick={goMe}>See all</button>
            </div>
            {liveEntitiesArr === undefined ? (
              <div className="nb-avm-empty">Loading runtime memory…</div>
            ) : recentEntityPreview.length > 0 ? (
              recentEntityPreview.map((entity, i) => (
                <RecentEntityRow key={i} name={entity.name} detail={entity.detail} dot={entity.dot} color={entity.color} />
              ))
            ) : (
              <div className="nb-avm-empty">No saved entities yet.</div>
            )}
          </div>

          <div className="nb-avm-section nb-avm-section-divided">
            <div className="nb-avm-section-label">Recent sessions</div>
            <div className="nb-avm-sessions">
              {liveSessionRows === undefined ? (
                <div className="nb-avm-empty">Loading runtime sessions…</div>
              ) : liveSessionRows.length > 0 ? (
                liveSessionRows.slice(0, 3).map((s, i) => (
                  <SessionRow
                    key={s.sessionKey ?? i}
                    time={formatRelativeWhen(typeof s?.lastSeenAt === "number" ? s.lastSeenAt : undefined)}
                    device={String(s?.deviceLabel ?? "Device")}
                    current={Boolean(s?.isCurrent)}
                  />
                ))
              ) : (
                <div className="nb-avm-empty">No runtime sessions recorded yet.</div>
              )}
            </div>
          </div>

          <div className="nb-avm-footer">
            <div className="nb-avm-theme-row">
              <span className="nb-avm-section-label">Theme</span>
              <ThemeSegment resolvedMode={resolvedMode} setMode={setMode} />
            </div>
            <div className="nb-avm-links">
              <button type="button" className="nb-avm-link" onClick={goSettings}>
                <Settings size={13} /> <span>Settings</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   ChatStream — full conversation surface (kit ChatStream port)
   Was: static AnswerPacket. Now: ChatStream with thread header + save bar +
   conversation thread (user + agent turns with run-bar / trace / capture
   chips / follow-ups) + composer with pinned context + suggest chips.
   Class names mirror the kit verbatim so kit.css lifts apply.
   ────────────────────────────────────────────────────────────────────────── */

type ChatRunKind = "context" | "capture" | "research" | "lookup";
type ChatRunBar = { kind: ChatRunKind; summary: string; detail?: string };
type ChatTraceStep = { step: string; label: string; hits?: string };
type ChatRunUpdate = { kind: "session" | "graph" | "notebook" | "followup"; label: string; detail?: string };
type ChatSegment =
  | { t: "t"; v: string }
  | { t: "strong"; v: string }
  | { t: "cite"; n: number };
type ChatBlock =
  | { kind: "p"; segs: ChatSegment[] }
  | { kind: "h"; v: string }
  | { kind: "list"; items: ChatSegment[][] };
type ChatSource = ExactRuntimeSource;

type ChatTurn =
  | { id: string; role: "user"; time: string; text: string }
  | {
      id: string;
      role: "agent";
      time: string;
      run?: ChatRunBar;
      trace?: ChatTraceStep[];
      body?: ChatBlock[];
      runUpdates?: ChatRunUpdate[];
      sources?: ChatSource[];
      followups?: string[];
    };

const RUN_KIND_GLYPH: Record<ChatRunKind, string> = {
  context: "◷",
  capture: "⊕",
  research: "⚙",
  lookup: "⌕",
};

const RUN_UPDATE_GLYPH: Record<ChatRunUpdate["kind"], string> = {
  session: "◷",
  graph: "◇",
  notebook: "☰",
  followup: "→",
};

function ChatRunBarView({ run }: { run: ChatRunBar }) {
  return (
    <div className="nb-runbar" data-kind={run.kind}>
      <span className="ic">{RUN_KIND_GLYPH[run.kind]}</span>
      <span className="sum"><strong>{run.summary}</strong></span>
      {run.detail && <span className="dt">· {run.detail}</span>}
    </div>
  );
}

function ChatTraceView({ trace }: { trace: ChatTraceStep[] }) {
  if (!trace.length) return null;
  const summary = `${trace.length} recorded runtime event${trace.length === 1 ? "" : "s"}`;
  const tags = trace.map((s) => s.step).join(" + ");
  return (
    <details className="nb-runtrace">
      <summary>
        <span className="nb-runtrace-sum">{summary}</span>
        <span className="nb-runtrace-tags">{tags}</span>
      </summary>
      <div className="nb-runtrace-list">
        {trace.map((step, i) => (
          <div key={i} className="nb-runtrace-step">
            <span className="step">{step.step}</span>
            <span className="lbl">{step.label}</span>
            {step.hits && <span className="hits">· {step.hits}</span>}
          </div>
        ))}
      </div>
    </details>
  );
}

function renderSegments(segs: ChatSegment[]) {
  return segs.map((s, i) => {
    if (s.t === "strong") return <strong key={i}>{s.v}</strong>;
    if (s.t === "cite") return <sup key={i} className="nb-cite">{s.n}</sup>;
    return <span key={i}>{s.v}</span>;
  });
}

function ChatTurnView({
  turn,
  onFollowup,
}: {
  turn: ChatTurn;
  onFollowup: (text: string) => void;
}) {
  if (turn.role === "user") {
    return (
      <div className="nb-turn" data-role="user">
        <div className="nb-turn-avatar" data-role="user" aria-hidden="true"><User size={12} /></div>
        <div className="nb-turn-body">
          <div className="nb-turn-head">
            <span className="nb-turn-who">You</span>
            <span className="nb-turn-time">{turn.time}</span>
          </div>
          <div className="nb-turn-text">{turn.text}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="nb-turn" data-role="agent">
      <div className="nb-turn-avatar" data-role="agent"><Sparkles size={12} /></div>
      <div className="nb-turn-body">
        <div className="nb-turn-head">
          <span className="nb-turn-who">NodeBench</span>
          <span className="nb-turn-time">{turn.time}</span>
        </div>
        {turn.run && <ChatRunBarView run={turn.run} />}
        {turn.trace && turn.trace.length > 0 && <ChatTraceView trace={turn.trace} />}
        {turn.body && (
          <div className="nb-turn-text">
            {turn.body.map((b, i) => {
              if (b.kind === "p") {
                return <p key={i} className="nb-block-p">{renderSegments(b.segs)}</p>;
              }
              if (b.kind === "h") {
                return <h4 key={i} className="nb-block-h">{b.v}</h4>;
              }
              if (b.kind === "list") {
                return (
                  <ul key={i} className="nb-block-list">
                    {b.items.map((segs, j) => (
                      <li key={j}>{renderSegments(segs)}</li>
                    ))}
                  </ul>
                );
              }
              return null;
            })}
          </div>
        )}
        {turn.sources && turn.sources.length > 0 && (
          <div className="nb-turn-sources">
            <span className="ttl">Sources</span>
            {turn.sources.map((s) => (
              <button
                key={s.n}
                type="button"
                className="nb-src-chip"
                title={s.title}
                onClick={() => {
                  if (typeof window !== "undefined" && s.url) {
                    window.open(s.url, "_blank", "noopener,noreferrer");
                  }
                }}
                disabled={!s.url}
              >
                <span className="fav">{s.fav}</span>
                <span className="n">{s.n}</span>
                <span className="dom">{s.domain}</span>
                {s.cached === true && <span className="badge">cached</span>}
                {s.cached === false && <span className="badge live">live</span>}
              </button>
            ))}
          </div>
        )}
        {turn.runUpdates && turn.runUpdates.length > 0 && (
          <div className="nb-runups">
            {turn.runUpdates.map((u, i) => (
              <div key={i} className="nb-runup" data-kind={u.kind}>
                <span className="ic">{RUN_UPDATE_GLYPH[u.kind]}</span>
                <span className="lbl">
                  <strong>{u.label}</strong>
                  {u.detail && <span className="dim">{` · ${u.detail}`}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
        {turn.followups && turn.followups.length > 0 && (
          <div className="nb-followups">
            {turn.followups.map((f, i) => (
              <button key={i} type="button" className="nb-followup-chip" onClick={() => onFollowup(f)}>
                {f}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const STREAM_PROMPTS = ["Research a company", "Compare two companies", "Ask about a person"];

function liveAnswerSources(packet: LiveChatAnswer): ChatSource[] {
  return projectExactRuntimeSources(packet.evidence ?? []);
}

function liveAnswerTrace(run: RealChatRun | null): ChatTraceStep[] {
  const runtime = run?.runtime;
  const contextRows = runtime?.contextCandidates?.slice(0, 3).map((row) => ({
    step: "context",
    label: `${row.status} - ${row.label}`,
    hits: row.detail,
  })) ?? [];
  const toolRows = runtime?.toolDecisions?.slice(0, 3).map((row) => ({
    step: "tool",
    label: `${row.status} - ${row.label}`,
    hits: row.detail,
  })) ?? [];
  const claimRows = runtime?.claimChecks?.slice(0, 3).map((row) => ({
    step: "verify",
    label: `${row.status} - claim ${row.idx}`,
    hits: row.detail ?? row.verificationDetail ?? row.validationError,
  })) ?? [];
  const streamRows = run?.toolCalls?.slice(0, 4).map((row) => ({
    step: row.step || "tool",
    label: row.detail || row.step || "runtime checkpoint",
    hits: typeof row.durationMs === "number" ? `${row.durationMs}ms` : undefined,
  })) ?? [];
  return [...contextRows, ...toolRows, ...claimRows, ...streamRows].slice(0, 8);
}

function liveAnswerBlocks(packet: LiveChatAnswer, scratchpad?: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  if (packet.shortAnswer) {
    blocks.push({ kind: "h", v: "Short answer" });
    blocks.push({ kind: "p", segs: [{ t: "t", v: packet.shortAnswer }] });
  } else if (scratchpad) {
    blocks.push({ kind: "p", segs: [{ t: "t", v: scratchpad.slice(0, 900) }] });
  } else {
    blocks.push({ kind: "p", segs: [{ t: "t", v: "The runtime accepted the request. Recorded evidence and sources will appear here as they are emitted." }] });
  }
  if (packet.whyItMatters) {
    blocks.push({ kind: "h", v: "Why it matters" });
    blocks.push({ kind: "p", segs: [{ t: "t", v: packet.whyItMatters }] });
  }
  const evidence = (packet.evidence ?? []).slice(0, 4);
  if (evidence.length > 0) {
    blocks.push({ kind: "h", v: "Evidence" });
    blocks.push({
      kind: "list",
      items: evidence.map((row, index) => [
        { t: "t", v: row.quote || row.source || "Source-backed evidence" },
        { t: "cite", n: row.idx ?? index + 1 },
      ]),
    });
  }
  if (packet.risks?.length) {
    blocks.push({ kind: "h", v: "Open risks" });
    blocks.push({
      kind: "list",
      items: packet.risks.slice(0, 4).map((risk) => [{ t: "t", v: risk }]),
    });
  }
  if (packet.nextAction) {
    blocks.push({ kind: "h", v: "Next action" });
    blocks.push({ kind: "p", segs: [{ t: "t", v: packet.nextAction }] });
  }
  return blocks;
}

function liveRunUpdates(run: RealChatRun | null): ChatRunUpdate[] {
  const metrics = run?.runtime.metrics;
  const packet = run?.runtime.contextPacket;
  const updates: ChatRunUpdate[] = [];
  if (packet) {
    updates.push({
      kind: "graph",
      label: "ContextRuntimePacket loaded",
      detail: `${packet.telemetry.candidateCount} candidates - ${packet.graph.nodeCount} nodes - ${packet.graph.edgeCount} edges`,
    });
  }
  if (metrics) {
    const metricDetails = [
      typeof metrics.totalLatencyMs === "number"
        ? `${metrics.totalLatencyMs}ms`
        : typeof metrics.timeToFinalMs === "number"
          ? `${metrics.timeToFinalMs}ms`
          : null,
      typeof metrics.estimatedCostUsd === "number"
        ? `$${metrics.estimatedCostUsd.toFixed(4)}`
        : null,
    ].filter((detail): detail is string => Boolean(detail));
    if (metricDetails.length > 0) {
      updates.push({
        kind: "session",
        label: "Cost and latency tracked",
        detail: metricDetails.join(" - "),
      });
    }
  }
  const pendingClaims = run?.runtime.claimChecks?.filter((row) => !row.verified).length ?? 0;
  if (pendingClaims > 0) {
    updates.push({
      kind: "notebook",
      label: `${pendingClaims} claims need review`,
      detail: "High-impact writes stay gated before notebook patching.",
    });
  }
  if (run?.status === "complete") {
    updates.push({
      kind: "followup",
      label: "Run complete",
      detail: run.hash ? `Share hash ${run.hash}` : undefined,
    });
  }
  return updates;
}

function liveAgentTurnFromRun(turnId: string, run: RealChatRun, previous?: ChatTurn): ChatTurn {
  const statusText = run.status === "complete"
    ? "Live answer ready"
    : run.status === "error"
      ? "Live run failed"
      : "Live run in progress";
  const runtimeCounts = [
    run.runtime.contextCandidates.length > 0
      ? `${run.runtime.contextCandidates.length} context candidates`
      : null,
    run.runtime.toolDecisions.length > 0
      ? `${run.runtime.toolDecisions.length} tool decisions`
      : null,
  ].filter((detail): detail is string => Boolean(detail));
  const sources = liveAnswerSources(run.packet);
  const followups = run.status === "complete"
    ? [
        "Draft a follow-up based on this answer",
        ...(sources.length > 0 ? ["Compare related entities using these sources"] : []),
      ]
    : undefined;
  return {
    id: turnId,
    role: "agent",
    time: previous?.role === "agent" ? previous.time : nowTime(),
    run: {
      kind: "research",
      summary: statusText,
      detail: runtimeCounts.length > 0 ? runtimeCounts.join(" - ") : undefined,
    },
    trace: liveAnswerTrace(run),
    body: run.status === "error"
      ? [{ kind: "p", segs: [{ t: "t", v: run.errorMessage ?? "The live run failed before producing an answer packet." }] }]
      : liveAnswerBlocks(run.packet, run.scratchpad),
    sources,
    runUpdates: liveRunUpdates(run),
    followups,
  };
}

function liveUnavailableTurn(turnId: string, reason: string): ChatTurn {
  return {
    id: turnId,
    role: "agent",
    time: nowTime(),
    run: { kind: "context", summary: "Live runtime not started", detail: "No fixture answer inserted" },
    body: [
      { kind: "p", segs: [{ t: "t", v: reason }] },
      { kind: "p", segs: [{ t: "t", v: "The paid research runtime did not return a run. No synthetic answer was inserted; retry here or use the session agent." }] },
    ],
  };
}

function initialLiveChatTurn(): ChatTurn {
  return {
    id: "live-ready",
    role: "agent",
    time: nowTime(),
    body: [
      {
        kind: "p",
        segs: [
          { t: "t", v: "Ask about a company, person, event, market, or saved report. Runtime evidence and sources appear after you send." },
        ],
      },
    ],
  };
}

function contextRefFromPins(searchParams: URLSearchParams, pins: Array<{ kind: string; label: string }>) {
  const explicit = searchParams.get("contextRef");
  if (explicit) return explicit;
  const report = searchParams.get("report");
  if (report) return report.startsWith("graphctx:") ? report : `graphctx:${report}`;
  const firstPin = pins[0];
  if (!firstPin?.label) return undefined;
  const slug = firstPin.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug ? `graphctx:${firstPin.kind}_${slug}` : undefined;
}

export function ExactChatSurface() {
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const [composer, setComposer] = useState(initialQuery);
  const [pins, setPins] = useState<{ kind: string; label: string }[]>(() => {
    const reportId = searchParams.get("report")?.trim();
    return reportId ? [{ kind: "report", label: reportId }] : [];
  });
  const realChat = useRedesignChatRun();
  const fastAgent = useFastAgent();
  const [activeLiveTurnId, setActiveLiveTurnId] = useState<string | null>(null);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const submitLockRef = useRef(false);
  const [submissionPending, setSubmissionPending] = useState(false);
  const chatRunInFlight = isExactChatRunInFlight(realChat.state.status, activeLiveTurnId, submissionPending);

  // Live cockpit chat: prefer a persisted Convex thread when one exists.
  // Otherwise start from an honest live-ready state, not a synthetic answer.
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  const liveThread = useQuery(
    api?.domains.product.entities.getMostRecentChatThread ?? "skip",
    api?.domains.product.entities.getMostRecentChatThread
      ? { anonymousSessionId }
      : "skip",
  );
  const liveThreadTurns: ChatTurn[] | null = (() => {
    if (!realChat.state.available) return null;
    if (!liveThread || !(liveThread as any)?.live) return null;
    const lt = liveThread as any;
    if (!Array.isArray(lt.turns) || lt.turns.length === 0) return null;
    return lt.turns.map((t: any): ChatTurn =>
      t.role === "user"
        ? { id: String(t.id), role: "user", time: String(t.time), text: String(t.text ?? "") }
        : { id: String(t.id), role: "agent", time: String(t.time), body: [{ kind: "p", segs: [{ t: "t", v: String(t.text ?? "") }] }] },
    );
  })();
  const [turns, setTurns] = useState<ChatTurn[]>(liveThreadTurns ?? [initialLiveChatTurn()]);
  // When the live thread arrives later (Convex query resolves async), swap.
  useEffect(() => {
    if (!hasUserInteracted && liveThreadTurns && liveThreadTurns.length > 0) setTurns(liveThreadTurns);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveThread, hasUserInteracted]);

  useEffect(() => {
    if (!activeLiveTurnId) return;
    const run = realChat.state.run;
    if (!run) return;
    setTurns((prev) => prev.map((turn) =>
      turn.id === activeLiveTurnId
        ? liveAgentTurnFromRun(activeLiveTurnId, run, turn)
        : turn,
    ));
    if (run.status === "complete" || run.status === "error") {
      setActiveLiveTurnId(null);
    }
  }, [activeLiveTurnId, realChat.state.run]);

  useEffect(() => {
    if (!activeLiveTurnId || realChat.state.status !== "error" || !realChat.state.error) return;
    setTurns((prev) => prev.map((turn) =>
      turn.id === activeLiveTurnId
        ? liveUnavailableTurn(activeLiveTurnId, realChat.state.error ?? "The live run could not be started.")
        : turn,
    ));
    setActiveLiveTurnId(null);
  }, [activeLiveTurnId, realChat.state.error, realChat.state.status]);

  const sendTurn = (text: string) => {
    const t = text.trim();
    if (!t || chatRunInFlight || !acquireExactChatSubmitLock(submitLockRef)) return;
    setSubmissionPending(true);
    if (!realChat.state.available) {
      setHasUserInteracted(true);
      setComposer("");
      fastAgent.openWithContext({
        initialTab: "chat",
        initialMessage: t,
        contextTitle: pins.length > 0 ? pins.map((pin) => pin.label).join(", ") : undefined,
      });
      queueMicrotask(() => {
        submitLockRef.current = false;
        setSubmissionPending(false);
      });
      return;
    }
    const userTurnId = `u${Date.now()}`;
    const agentTurnId = `a${Date.now()}`;
    const contextRef = contextRefFromPins(searchParams, pins);
    setHasUserInteracted(true);
    setTurns((prev) => [
      ...prev,
      { id: userTurnId, role: "user", time: nowTime(), text: t },
      {
        id: agentTurnId,
        role: "agent",
        time: nowTime(),
        run: {
          kind: "research",
          summary: "Submitting research request",
          detail: contextRef ? `context ${contextRef}` : "prompt-only context",
        },
        trace: [{ step: "submit", label: "request sent", hits: "waiting for a runtime run id" }],
        body: [{ kind: "p", segs: [{ t: "t", v: "Request submitted. Waiting for the runtime to emit a run and its recorded evidence." }] }],
      },
    ]);
    setComposer("");
    void realChat.submit(t, "auto", contextRef)
      .then((runId) => {
        if (runId) {
          setActiveLiveTurnId(agentTurnId);
          return;
        }
        setTurns((prev) => prev.map((turn) =>
          turn.id === agentTurnId
            ? liveUnavailableTurn(
                agentTurnId,
                realChat.state.error ?? "The paid research runtime could not start. Try again or use the session agent.",
              )
            : turn,
        ));
      })
      .finally(() => {
        submitLockRef.current = false;
        setSubmissionPending(false);
      });
  };

  useRoutePerformanceRecord({
    routeId: "chat",
    surfaceId: "chat",
    rootSelector: '[data-testid="exact-web-chat-stream"]',
    firstActionSelector: '[data-nb-perf-action="chat-send"]',
    dataSource: realChat.state.run ? "live_convex_run" : liveThreadTurns ? "live_convex_thread" : "live_runtime_ready",
  });

  return (
    <ResponsiveSurface mobile="chat">
      <section
        data-testid="exact-web-chat-stream"
        data-chat-live-status={realChat.state.status}
        data-chat-live-eligible={realChat.state.available ? "true" : "false"}
        data-chat-runtime-route={realChat.state.available ? "paid-redesign" : "session-fast-agent"}
        data-chat-run-id={realChat.state.run?.runId ?? ""}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text-primary)", margin: 0 }}>
            Chat
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            Ask a question. Sources, runtime progress, and any proposed writes appear only after the run starts.
          </div>
        </div>

        <div className="nb-stream-root">
          <div className="nb-stream-main">
            <div className="nb-stream-header">
              <div className="nb-chat-header-icon">O</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2>Live Context Runtime</h2>
                <div className="nb-stream-header-meta">
                  <span>{turns.length} turns</span>
                  {realChat.state.run ? (
                    <>
                      {realChat.state.run.packet.sourceCount > 0 ? (
                        <><span>·</span><span>{realChat.state.run.packet.sourceCount} sources</span></>
                      ) : null}
                      {realChat.state.run.runtime.contextCandidates.length > 0 ? (
                        <><span>·</span><span>{realChat.state.run.runtime.contextCandidates.length} context candidates</span></>
                      ) : null}
                      {typeof realChat.state.run.packet.paidCalls === "number" ? (
                        <><span>·</span><span>{realChat.state.run.packet.paidCalls} paid calls</span></>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="nb-stream-scroll">
              <div className="nb-stream-inner">
                {turns.map((turn) => (
                  <ChatTurnView key={turn.id} turn={turn} onFollowup={sendTurn} />
                ))}
              </div>
            </div>

            <div className="nb-stream-composer">
              <ExactComposer
                value={composer}
                onValueChange={setComposer}
                onSubmit={() => sendTurn(composer)}
                placeholder="Ask or paste text... (@ to mention an entity)"
                ariaLabel="Chat composer"
                enableEntityMentions
                pins={pins.map((pin) => ({ ...pin, removable: true }))}
                onRemovePin={(index) => setPins((prev) => prev.filter((_, idx) => idx !== index))}
                footerMeta="Runtime-routed"
                submitPerfAction="chat-send"
                submitDisabled={!composer.trim() || chatRunInFlight}
                suggestions={STREAM_PROMPTS}
                onSuggestion={(prompt) => setComposer(`${prompt} `)}
              />
            </div>
          </div>
        </div>
      </section>
    </ResponsiveSurface>
  );
}

function nowTime() {
  const d = new Date();
  const h = d.getHours();
  const m = d.getMinutes();
  const hr = ((h + 11) % 12) + 1;
  const mm = m < 10 ? `0${m}` : `${m}`;
  return `${hr}:${mm} ${h < 12 ? "AM" : "PM"}`;
}

/* Runtime nudge snapshot projected into the canonical Inbox rows. */
const ICON_BY_PRIORITY: Record<"act" | "auto" | "watch" | "fyi", LucideIcon> = {
  act: Zap,
  auto: Check,
  watch: Eye,
  fyi: Repeat,
};

function derivePriority(nudge: { type?: string; bucket?: string }): "act" | "auto" | "watch" | "fyi" {
  const type = String(nudge.type ?? "");
  if (nudge.bucket === "action_required" || type === "verification_needed" || type === "follow_up_due") return "act";
  if (type.includes("automation") || type.includes("connector")) return "auto";
  if (type === "watchlist_update" || type === "report_changed" || type === "refresh_recommended") return "watch";
  return "fyi";
}

function deriveActions(priority: "act" | "auto" | "watch" | "fyi"): string[] {
  if (priority === "act") return ["open", "snooze", "dismiss"];
  return ["open", "dismiss"];
}

function formatRelativeWhen(ts?: number): string {
  if (!ts) return "time unavailable";
  const ageMs = Date.now() - ts;
  const minutes = Math.max(1, Math.round(ageMs / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days <= 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return "earlier";
}

function humanizeEntity(slug?: string | null): string {
  if (!slug) return "Inbox";
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

type ExactInboxItem = {
  id: string;
  when: string;
  entity: string;
  priority: "act" | "auto" | "watch" | "fyi";
  icon: LucideIcon;
  title: string;
  body: string;
  actions: string[];
  report: string | null;
};

export function ExactInboxSurface() {
  const navigate = useNavigate();
  const api = useConvexApi();
  const convex = useConvex();
  const anonymousSessionId = getAnonymousProductSessionId();
  const snapshot = useQuery(
    api?.domains.product.nudges.getNudgesSnapshot ?? "skip",
    api?.domains.product.nudges.getNudgesSnapshot ? { anonymousSessionId } : "skip",
  );

  const liveItems: ExactInboxItem[] | undefined = useMemo(() => {
    if (snapshot === undefined) return undefined;
    const nudges = snapshot?.nudges as Array<any> | undefined;
    return (nudges ?? []).map((n) => {
      const priority = derivePriority(n);
      return {
        id: String(n._id),
        when: formatRelativeWhen(typeof n.createdAt === "number" ? n.createdAt : undefined),
        entity: n.linkedReportTitle?.split(/[-—:]/)[0]?.trim() ?? humanizeEntity(n.linkedEntitySlug),
        priority,
        icon: ICON_BY_PRIORITY[priority],
        title: String(n.title ?? "Update"),
        body: String(n.summary ?? n.title ?? ""),
        actions: deriveActions(priority),
        report: n.linkedReportTitle ?? null,
      };
    });
  }, [snapshot]);

  const [filter, setFilter] = useState<"all" | "act" | "auto" | "watch">("all");
  const [items, setItems] = useState<ExactInboxItem[]>([]);
  const [pendingAction, setPendingAction] = useState<{ id: string; action: "snooze" | "dismiss" } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Sync live items when the Convex query resolves with data.
  useEffect(() => {
    if (liveItems !== undefined) setItems(liveItems);
  }, [liveItems]);
  const counts = useMemo(
    () => ({
      all: items.length,
      act: items.filter((item) => item.priority === "act").length,
      auto: items.filter((item) => item.priority === "auto").length,
      watch: items.filter((item) => item.priority === "watch").length,
    }),
    [items],
  );
  const visible = filter === "all" ? items : items.filter((item) => item.priority === filter);

  const act = async (id: string, action: "open" | "snooze" | "dismiss") => {
    if (action === "open") {
      navigate(buildCockpitPath({ surfaceId: "packets" }));
      return;
    }
    if (liveItems === undefined || !api || pendingAction) return;

    setPendingAction({ id, action });
    setActionError(null);
    try {
      const mutation = action === "dismiss"
        ? api.domains.product.nudges.completeNudge
        : api.domains.product.nudges.snoozeNudge;
      const result = await convex.mutation(mutation, { nudgeId: id, anonymousSessionId });
      requireSuccessfulInboxMutation(result);
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The inbox action failed. Try again.");
    } finally {
      setPendingAction(null);
    }
  };

  useRoutePerformanceRecord({
    routeId: "inbox",
    surfaceId: "inbox",
    rootSelector: '[data-testid="exact-web-inbox-surface"]',
    firstActionSelector: '[data-nb-perf-action="inbox-filter"]',
    dataSource: liveItems === undefined ? "loading" : liveItems.length > 0 ? "live_convex" : "empty",
  });

  return (
    <ResponsiveSurface mobile="inbox">
      <section data-testid="exact-web-inbox-surface">
        <div className="nb-inbox-head">
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 760, letterSpacing: "-0.02em" }}>Inbox</h1>
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
              Return at the right moment - only when something meaningful changed about an entity you watch.
            </p>
          </div>
          <div className="nb-inbox-filter" role="tablist" aria-label="Inbox filters">
            {[
              ["all", "All", counts.all],
              ["act", "Act", counts.act],
              ["auto", "Auto", counts.auto],
              ["watch", "Watch", counts.watch],
            ].map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                data-active={filter === key}
                data-nb-perf-action={key === "all" ? "inbox-filter" : undefined}
                onClick={() => setFilter(key as typeof filter)}
              >
                {label} <span style={{ marginLeft: 5, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>{count}</span>
              </button>
            ))}
          </div>
        </div>

        {actionError ? (
          <div
            role="alert"
            style={{ marginTop: 14, padding: "10px 12px", border: "1px solid var(--danger)", borderRadius: 10, color: "var(--danger)", fontSize: 13 }}
          >
            {actionError}
          </div>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
          {liveItems === undefined ? (
            <RuntimeEmptyState
              testId="inbox-loading"
              title="Loading inbox"
              description="Checking runtime nudges for this workspace."
            />
          ) : visible.length === 0 ? (
            <div className="nb-panel" style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>
              <Check size={24} />
              <div style={{ marginTop: 8 }}>
                {items.length === 0
                  ? "No runtime nudges. New items arrive when watched entities move."
                  : "Nothing matches this filter."}
              </div>
            </div>
          ) : (
            visible.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.id} className="nb-ibx-row" data-priority={item.priority}>
                  <div className="nb-ibx-icon"><Icon size={15} /></div>
                  <div>
                    <div className="nb-ibx-top">
                      <span className="nb-ibx-entity">{item.entity}</span>
                      <span className="nb-ibx-title">{item.title}</span>
                      <span className="nb-ibx-when">{item.when}</span>
                    </div>
                    <div className="nb-ibx-msg">{item.body}</div>
                    <div className="nb-ibx-actions">
                      {item.actions.includes("open") ? <button onClick={() => void act(item.id, "open")}><FileText size={11} /> Open reports</button> : null}
                      {item.actions.includes("snooze") ? <button disabled={pendingAction?.id === item.id} onClick={() => void act(item.id, "snooze")}><Clock3 size={11} /> Snooze 24h</button> : null}
                      {item.actions.includes("dismiss") ? <button disabled={pendingAction?.id === item.id} onClick={() => void act(item.id, "dismiss")}><X size={11} /> Dismiss</button> : null}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                    <span className="nb-ibx-priority">{item.priority === "act" ? "act now" : item.priority === "auto" ? "auto" : item.priority === "watch" ? "watch" : "fyi"}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </ResponsiveSurface>
  );
}

/* Runtime entity memory projected into the canonical Me surface. */
type ExactNotebookEntity = {
  id: string;
  name: string;
  tag: string;
  lastReport: string;
  reports: number;
};

function formatShortDate(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "2-digit" });
}

export function ExactMeSurface() {
  const navigate = useNavigate();
  const api = useConvexApi();
  const anonymousSessionId = getAnonymousProductSessionId();
  const loggedInUser = useQuery(
    (api as any)?.domains?.auth?.auth?.loggedInUser ?? "skip",
  ) as { name?: string; email?: string } | null | undefined;
  const liveEntities = useQuery(
    api?.domains.product.entities.listEntities ?? "skip",
    api?.domains.product.entities.listEntities
      ? { anonymousSessionId, search: "", filter: "All" }
      : "skip",
  );

  const liveNotebook: ExactNotebookEntity[] | undefined = useMemo(() => {
    const list = liveEntities as Array<any> | undefined;
    if (list === undefined) return undefined;
    return list.map((entity) => {
      const updatedAt = typeof entity.latestReportUpdatedAt === "number" ? entity.latestReportUpdatedAt : entity.updatedAt;
      const reportCount = typeof entity.reportCount === "number" ? entity.reportCount : 0;
      // "changes" = revisions beyond the first — a user-visible signal that
      // this entity has been re-investigated and gained new context.
      return {
        id: String(entity.slug ?? entity._id ?? entity.name),
        name: String(entity.name ?? "Untitled"),
        tag: humanizeEntityType(entity.entityType).toLowerCase(),
        lastReport: formatShortDate(typeof updatedAt === "number" ? updatedAt : undefined),
        reports: reportCount,
      };
    });
  }, [liveEntities]);

  const entities = liveNotebook ?? [];
  const identityName = loggedInUser?.name?.trim() || "Guest workspace";
  const identityDetail = loggedInUser?.email?.trim() || "Anonymous session";
  const identityInitial = identityName.slice(0, 1).toUpperCase() || "N";

  useRoutePerformanceRecord({
    routeId: "me",
    surfaceId: "me",
    rootSelector: '[data-testid="exact-web-me-surface"]',
    firstActionSelector: '[data-nb-perf-action="me-settings"]',
    dataSource: liveNotebook === undefined ? "loading" : liveNotebook.length > 0 ? "live_convex" : "empty",
  });

  return (
    <ResponsiveSurface mobile="me">
      <section className="nb-me-grid" data-testid="exact-web-me-surface">
        <aside className="nb-me-sidenav">
          <div className="hd">
            <div className="av">{identityInitial}</div>
            <div style={{ minWidth: 0 }}>
              <div className="nm">{identityName}</div>
              <div className="em">{identityDetail}</div>
            </div>
          </div>
          <div className="section-title">Account</div>
          <button
            type="button"
            data-nb-perf-action="me-settings"
            onClick={() => navigate("/settings")}
          >
            <Settings size={14} />
            <span>Settings</span>
          </button>
        </aside>

        <section>
          <h1 className="nb-settings-h1">Memory</h1>
          <p className="nb-settings-sub">Runtime entities connected to saved reports and inbox nudges.</p>
          {liveNotebook === undefined ? (
            <RuntimeEmptyState
              testId="me-memory-loading"
              title="Loading memory"
              description="Checking the workspace entity ledger."
            />
          ) : entities.length === 0 ? (
            <RuntimeEmptyState
              testId="me-memory-empty"
              title="No saved entities"
              description="Entities appear here after a saved report or runtime workflow links them."
            />
          ) : (
            <div className="nb-settings-section" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ borderBottom: "1px solid var(--border-subtle)", padding: "14px 20px" }}>
                <div style={{ fontSize: 13.5, fontWeight: 800 }}>
                  {entities.length} runtime entit{entities.length === 1 ? "y" : "ies"}
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 11.5 }}>
                  Report counts and activity dates come from the entity ledger.
                </div>
              </div>
              {entities.map((entity, index) => (
                  <div
                    key={entity.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "36px minmax(0, 1fr) auto",
                      gap: 14,
                      alignItems: "center",
                      borderTop: index === 0 ? 0 : "1px solid var(--border-subtle)",
                      padding: "12px 20px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 9, background: "var(--accent-primary-tint)", color: "var(--accent-ink)", fontWeight: 800 }}>
                      {entity.name[0]}
                    </div>
                    <div>
                      <div style={{ fontWeight: 750 }}>{entity.name}</div>
                      <div style={{ color: "var(--text-muted)", fontSize: 11.5 }}>
                        {entity.tag} - {entity.reports} {entity.reports === 1 ? "report" : "reports"} - last activity {entity.lastReport}
                      </div>
                    </div>
                    {entity.reports > 0 ? (
                      <button
                        type="button"
                        className="nb-btn nb-btn-secondary"
                        onClick={() => navigate(buildCockpitPath({ surfaceId: "packets", extra: { report: entity.id } }))}
                      >
                        <FileText size={12} /> Reports
                      </button>
                    ) : null}
                  </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </ResponsiveSurface>
  );
}

export function ExactMcpTerminalPage() {
  const copyCommand = "claude mcp add nodebench -- npx -y nodebench-mcp";
  const hostedPublicUrl = "https://nodebench-mcp-unified.onrender.com?profile=public-research";
  const [copied, setCopied] = useState(false);
  const [copiedHosted, setCopiedHosted] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(copyCommand).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const copyHosted = () => {
    void navigator.clipboard.writeText(hostedPublicUrl).then(() => {
      setCopiedHosted(true);
      setTimeout(() => setCopiedHosted(false), 1500);
    });
  };
  return (
    <div className="nb-kit nb-mcp-page" style={{ minHeight: "100dvh", background: "#09090b", color: "#e5e7eb" }}>
      <div className="nb-shell">
        <a className="nb-mcp-back" href="/">{"<- Back to NodeBench"}</a>
        <div className="nb-mcp-layout">
          <section className="nb-mcp-copy">
            <div className="nb-kicker" style={{ color: "#d97757" }}>CLI / MCP</div>
            <h1 className="nb-mcp-title">Bring NodeBench into Claude, Cursor, and agent workflows.</h1>
            <p className="nb-mcp-intro">Start with a public dossier from the hosted MCP endpoint, no sign-in required. Link NodeBench after the first useful result to keep memory, raise limits, and manage teams.</p>
            <div className="nb-mcp-actions">
              <button className="nb-btn nb-btn-primary" type="button" onClick={copy}>
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? "Copied" : "Copy install command"}
              </button>
              <button className="nb-btn" type="button" onClick={copyHosted} style={{ border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.04)", color: "#e5e7eb" }}>
                {copiedHosted ? <Check size={15} /> : <Link2 size={15} />}
                {copiedHosted ? "Copied" : "Copy hosted public URL"}
              </button>
            </div>
          </section>
          <TerminalCard title="Connection setup" badge="not connected">
            <div data-testid="mcp-terminal-empty">
              <TerminalLine>status &gt; No MCP call has run on this page.</TerminalLine>
              <TerminalDivider />
              <TerminalLine tone="accent">Copy an endpoint above, then connect it from your agent client.</TerminalLine>
              <TerminalLine tone="ok">Tool results stay in that client and appear in the MCP ledger after a real call.</TerminalLine>
            </div>
          </TerminalCard>
        </div>
        <div className="nb-mcp-benefits">
          {[
            { title: "Use anonymously", body: "Public research and Gmail profiles return sourced dossiers without a token." },
            { title: "Link after value", body: "Prompt sign-in once the user sees sources, freshness, and missing information." },
            { title: "Unlock controls", body: "Linked accounts get history, higher budgets, API keys, team usage, webhooks, and billing." },
          ].map((item) => (
            <section className="nb-mcp-benefit" key={item.title}>
              <div style={{ color: "#e59579", fontFamily: "var(--font-mono)", fontSize: 13 }}>{item.title}</div>
              <p style={{ color: "#a1a1aa", fontSize: 13, lineHeight: 1.7 }}>{item.body}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function TerminalCard({ title, badge, children }: { title: string; badge: string; children: ReactNode }) {
  return (
    <section className="nb-mcp-terminal">
      <div className="nb-mcp-terminal-head">
        <span style={{ display: "flex", gap: 5 }}><i style={dot("#ff605c")} /><i style={dot("#ffbd44")} /><i style={dot("#00ca4e")} /></span>
        <span style={{ border: "1px solid rgba(255,255,255,.06)", borderRadius: 5, background: "rgba(255,255,255,.04)", color: "#e5e7eb", padding: "4px 8px", fontFamily: "var(--font-mono)", fontSize: 11 }}>{title}</span>
        <span style={{ marginLeft: "auto", border: "1px solid rgba(217,119,87,.3)", borderRadius: 5, background: "rgba(217,119,87,.10)", color: "#e59579", padding: "4px 8px", fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase" }}>{badge}</span>
      </div>
      <div className="nb-mcp-terminal-body">{children}</div>
    </section>
  );
}

function TerminalLine({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" | "ok" }) {
  const color = tone === "ok" ? "#86efac" : tone === "accent" ? "#e59579" : "#cbd5e1";
  return <div style={{ color, fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.8 }}>{children}</div>;
}

function TerminalDivider() {
  return <div style={{ height: 1, background: "rgba(255,255,255,.06)", margin: "6px 0" }} />;
}

function dot(background: string): CSSProperties {
  return { display: "inline-block", width: 10, height: 10, borderRadius: 999, background };
}
