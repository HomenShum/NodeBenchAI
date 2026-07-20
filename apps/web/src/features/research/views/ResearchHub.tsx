import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { ArrowRight, Check, Link2, Newspaper, Zap, TrendingUp, LayoutGrid, Layers, Globe2, ShieldCheck } from "lucide-react";
import { formatBriefDate, isBriefDateToday } from "@/lib/briefDate";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { EvidenceProvider, useEvidence } from "@/features/research/contexts/EvidenceContext";
import { useFastAgent } from "@/features/agents/context/FastAgentContext";
import { ErrorBoundary as SectionErrorBoundary } from "@/shared/components/ErrorBoundary";
import type { FeedItem } from "@/features/research/components/FeedCard";
import type { Evidence } from "@/features/research/types";
// Critical-path imports: always visible on default 'overview' tab
import { DigestSection } from "@/features/research/sections/DigestSection";
import { PersonalPulse } from "@/features/research/components/PersonalPulse";
import { DashboardSection } from "@/features/research/sections/DashboardSection";
import { ActAwareDashboard } from "@/features/research/components/ActAwareDashboard";
// Tab-gated sections: lazy-loaded since they only render on non-default tabs
const BriefingSection = React.lazy(() => import("@/features/research/sections/BriefingSection").then(m => ({ default: m.BriefingSection })));
const FeedSection = React.lazy(() => import("@/features/research/sections/FeedSection").then(m => ({ default: m.FeedSection })));
// Lazy-load secondary components (below fold, behind tabs, or in hidden sidebar)
const ForecastCockpit = React.lazy(() => import("@/features/research/components/ForecastCockpit"));
const IntelPulseMonitor = React.lazy(() => import("@/features/research/components/IntelPulseMonitor").then(m => ({ default: m.IntelPulseMonitor })));
const NotificationActivityPanel = React.lazy(() => import("@/features/agents/components/NotificationActivityPanel").then(m => ({ default: m.NotificationActivityPanel })));
const FeedReaderModal = React.lazy(() => import("@/features/research/components/FeedReaderModal").then(m => ({ default: m.FeedReaderModal })));
const EntityContextDrawer = React.lazy(() => import("@/features/research/components/EntityContextDrawer").then(m => ({ default: m.EntityContextDrawer })));

import { usePersonalBrief } from "@/features/research/hooks/usePersonalBrief";
import { TimelineStrip, type TimelineEvent, type TemporalPhase } from "@/features/research/components/TimelineStrip";
import type { ReaderItem } from "@/features/research/components/FeedReaderModal";
import { cn } from "@/lib/utils";
import { SurfacePageHeader } from "@/shared/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ai-ui/tabs";

function SectionFallback({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
      <h4 className="text-sm font-semibold text-content">{title}</h4>
      <p className="mt-1 text-xs text-content-muted/70">{message}</p>
    </div>
  );
}

// Tab definitions for the main content sections
type ContentTab = 'overview' | 'signals' | 'briefing' | 'forecasts';

const CONTENT_TABS: Array<{ id: ContentTab; label: string; icon: React.ElementType; description: string }> = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid, description: 'Digest + Personal Pulse' },
  { id: 'signals', label: 'Signals', icon: Zap, description: 'Live Signal Stream' },
  { id: 'briefing', label: 'Briefing', icon: Layers, description: 'Deep Analysis' },
  { id: 'forecasts', label: 'Forecasts', icon: TrendingUp, description: 'Prediction Cockpit' },
];

export interface ResearchHubProps {
  onDocumentSelect?: (documentId: string) => void;
  onEnterWorkspace?: () => void;
  /** When true, renders content-only (no sidebar/header) for use inside MainLayout */
  embedded?: boolean;
  /** Optional initial tab when opening the hub */
  initialTab?: ContentTab;
  /** Called when the user switches tabs — lets the parent sync tab state to the URL */
  onTabChange?: (tab: string) => void;
  /** Source toggles from parent (MainLayout) - used in embedded mode */
  activeSources?: string[];
  onToggleSource?: (sourceId: string) => void;
  onGoHome?: () => void;
  onNavigateToPath?: (path: string) => void;
}

function useShareUrl() {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).catch(() => {});
    setCopied(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }, []);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  return { copied, copy };
}

function ShareButton() {
  const { copied, copy } = useShareUrl();
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs text-content-muted hover:bg-white/[0.04] hover:text-content transition-colors"
      aria-label={copied ? "Link copied" : "Copy shareable link"}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Link2 className="h-3.5 w-3.5" />}
      {copied ? "Copied!" : "Share"}
    </button>
  );
}

function ResearchHubContent(props: ResearchHubProps) {
  const {
    embedded = false,
    onDocumentSelect: _onDocumentSelect,
    onEnterWorkspace: _onEnterWorkspace,
    initialTab,
    onTabChange,
    activeSources: _activeSources,
    onToggleSource: _onToggleSource,
    onGoHome,
    onNavigateToPath,
  } = props;

  const { openWithContext } = useFastAgent();
  const { registerEvidence } = useEvidence();
  const updateFocus = useMutation(api.domains.dossier.focusState.updateFocus);
  const seedAuditSignals = useMutation(api.feed.seedAuditSignals);
  const [activeAct, setActiveAct] = useState<"actI" | "actII" | "actIII">("actI");
  const [activeTimelineEventId, setActiveTimelineEventId] = useState<string | undefined>(undefined);
  const [phaseFilter, setPhaseFilter] = useState<TemporalPhase | "all">("all");
  const [selectedDate, setSelectedDate] = useState<string | undefined>(undefined);
  const [readerItem, setReaderItem] = useState<ReaderItem | null>(null);
  const [activeEntity, setActiveEntity] = useState<{ name: string; type: "company" | "person" } | null>(null);
  const seededAuditRef = useRef(false);
  const validTabs: ContentTab[] = ['overview', 'signals', 'briefing', 'forecasts'];
  const [activeTab, setActiveTab] = useState<ContentTab>(() =>
    initialTab && validTabs.includes(initialTab) ? initialTab : 'overview'
  );

  useEffect(() => {
    if (initialTab && validTabs.includes(initialTab) && initialTab !== activeTab) {
      setActiveTab(initialTab);
    }
  }, [activeTab, initialTab, validTabs]);

  // Fetch all brief data (Global + Personal)
  const {
    executiveBrief,
    sourceSummary,
    dashboardMetrics,
    evidence,
    deltas,
    briefMemory,
    personalizedContext,
    tasksToday,
    recentDocs,
    taskResults,
    availableDates,
    briefingDateString,
    isLoading
  } = usePersonalBrief({ dateString: selectedDate });

  const userPreferences = useQuery(api.domains.auth.userPreferences.getUserPreferences);
  const trackedHashtags = userPreferences?.trackedHashtags ?? [];
  const techStack = userPreferences?.techStack?.length
    ? userPreferences.techStack
    : ["AWS", "Vercel", "Postgres", "Cloudflare"];

  const isBriefToday = isBriefDateToday(briefingDateString);
  const briefLabel = isBriefToday ? "The Daily Brief" : "Latest Daily Brief";
  const briefDateLabel = briefingDateString ? formatBriefDate(briefingDateString) : null;

  const briefId = (briefMemory as any)?._id || "morning_brief_latest";
  const dossierContextBase = useMemo(() => ({
    briefId,
    currentAct: activeAct,
  }), [briefId, activeAct]);

  useEffect(() => {
    if (evidence && evidence.length > 0) {
      registerEvidence(evidence);
    }
  }, [evidence, registerEvidence]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (seededAuditRef.current) return;
    seededAuditRef.current = true;
    seedAuditSignals({})
      .then((result: any) => {
        if (result?.inserted) {
          console.info(`[ResearchHub] Seeded ${result.inserted} audit signals.`);
        }
      })
      .catch((err: any) => console.warn("[ResearchHub] Audit signal seed failed:", err?.message || err));
  }, [seedAuditSignals]);

  // FeedReaderModal and EntityContextDrawer are lazy-loaded on demand.
  // Removed warm imports that defeated the lazy boundary.

  const phasedDashboardMetrics = useMemo(() => {
    if (!dashboardMetrics) return null;
    const trendLine = dashboardMetrics.charts?.trendLine;
    if (!trendLine || !trendLine.series?.length) return dashboardMetrics;

    const totalPoints = trendLine.xAxisLabels?.length ?? trendLine.series[0]?.data?.length ?? 0;
    const basePresent = typeof trendLine.presentIndex === "number"
      ? trendLine.presentIndex
      : (trendLine.visibleEndIndex ?? totalPoints - 1);
    const safePresent = Math.max(0, Math.min(basePresent, Math.max(0, totalPoints - 1)));

    let visibleEnd = trendLine.visibleEndIndex ?? Math.max(0, totalPoints - 1);
    let presentIndex = safePresent;
    let timeWindow = trendLine.timeWindow;

    if (phaseFilter === "past") {
      visibleEnd = Math.max(0, safePresent - 1);
      presentIndex = visibleEnd;
      timeWindow = "Historical window";
    } else if (phaseFilter === "future") {
      presentIndex = Math.max(0, safePresent - 2);
      timeWindow = "Projection window";
    } else if (phaseFilter === "present") {
      visibleEnd = safePresent;
      presentIndex = safePresent;
      timeWindow = "Current window";
    }

    const phaseScalar = phaseFilter === "past" ? 0.96 : phaseFilter === "future" ? 1.04 : 1;
    const capabilities = (dashboardMetrics.capabilities ?? []).map((cap: any) => ({
      ...cap,
      score: Math.round(Math.min(100, cap.score * phaseScalar)),
    }));
    const keyStats = (dashboardMetrics.keyStats ?? []).map((stat: any) => ({
      ...stat,
      context:
        phaseFilter === "future"
          ? "Projection"
          : phaseFilter === "past"
            ? "Historical"
            : stat.context,
    }));

    return {
      ...dashboardMetrics,
      keyStats,
      capabilities,
      charts: {
        ...dashboardMetrics.charts,
        trendLine: {
          ...trendLine,
          visibleEndIndex: Math.min(Math.max(visibleEnd, 0), Math.max(0, totalPoints - 1)),
          presentIndex,
          timeWindow,
        },
      },
    };
  }, [dashboardMetrics, phaseFilter]);

  // Hoist agent plans for the adaptive HUD
  const agentPlans = useQuery(
    api.domains.agents.agentPlanning.listPlans,
    { limit: 3 }
  );

  const workflowSteps = useMemo(() => {
    if (!agentPlans || agentPlans.length === 0) return [];
    const latestPlan = agentPlans[0];
    return latestPlan.steps || [];
  }, [agentPlans]);

  // Timeline events derived from evidence and dashboard data
  const timelineEvents: TimelineEvent[] = useMemo(() => {
    const events: TimelineEvent[] = [];
    const now = new Date();
    const toIso = (value: unknown): string | null => {
      if (typeof value !== "string" && typeof value !== "number") return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed.toISOString();
    };

    // Past events from evidence
    evidence?.forEach((e: any, idx: number) => {
      if (e.date || e.timestamp) {
        const dateIso = toIso(e.date ?? e.timestamp);
        if (!dateIso) return;
        events.push({
          id: `evidence-${idx}`,
          date: dateIso,
          label: e.title || e.label || 'Evidence',
          description: e.summary || e.text,
          phase: 'past',
        });
      }
    });

    // Present: Today's briefing
    const briefingIso = briefingDateString ? toIso(`${briefingDateString}T00:00:00Z`) : null;
    if (briefingIso) {
      events.push({
        id: 'today-briefing',
        date: briefingIso,
        label: briefLabel,
        description: executiveBrief?.meta?.summary || 'Current market synthesis',
        phase: 'present',
        isCurrent: true,
      });
    }

    // Future projections from dashboard forecasts
    const futureDate = new Date(now);
    futureDate.setDate(futureDate.getDate() + 7);
    events.push({
      id: 'forecast-week',
      date: futureDate.toISOString(),
      label: 'Weekly Outlook',
      description: 'Projected market movements and upcoming catalysts',
      phase: 'future',
    });

    return events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [evidence, briefingDateString, executiveBrief, briefLabel]);

  const resolvedActiveTimelineEventId = useMemo(() => {
    if (activeTimelineEventId && timelineEvents.some((event) => event.id === activeTimelineEventId)) {
      return activeTimelineEventId;
    }
    return timelineEvents.find((event) => event.isCurrent)?.id ?? timelineEvents.find((event) => event.phase === "present")?.id;
  }, [activeTimelineEventId, timelineEvents]);

  useEffect(() => {
    if (activeTimelineEventId && !timelineEvents.some((event) => event.id === activeTimelineEventId)) {
      setActiveTimelineEventId(undefined);
    }
  }, [activeTimelineEventId, timelineEvents]);

  useEffect(() => {
    if (!activeTimelineEventId) {
      const next = timelineEvents.find((event) => event.isCurrent)?.id ?? timelineEvents.find((event) => event.phase === "present")?.id;
      if (next) setActiveTimelineEventId(next);
    }
  }, [activeTimelineEventId, timelineEvents]);

  const formatTimestamp = useCallback((value?: string) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }, []);

  const formatDayChipDate = useCallback((value: string) => {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }, []);

  const briefingDateStamp = useMemo(() => {
    // NOTE(coworker): Keep this defensive to avoid full-view crashes from malformed dates.
    return typeof briefingDateString === "string" ? briefingDateString.replace(/-/g, ".") : "Live";
  }, [briefingDateString]);

  const buildReaderItem = useCallback((input: {
    id?: string;
    title?: string;
    url?: string;
    source?: string;
    summary?: string;
    relevance?: string;
    publishedAt?: string;
    tags?: string[];
    subtitle?: string;
    timestamp?: string;
  }): ReaderItem => {
    const title = input.title ?? input.url ?? "Source";
    const subtitle = input.subtitle ?? input.summary ?? input.relevance ?? "";
    const timestamp = input.timestamp ?? formatTimestamp(input.publishedAt);
    const tags = input.tags ?? (input.source ? [input.source] : []);
    return {
      id: input.id ?? input.url ?? title,
      title,
      subtitle,
      timestamp,
      url: input.url,
      source: input.source,
      tags,
      raw: input,
    };
  }, [formatTimestamp]);

  // Intersection Observer for Act tracking
  const actIRef = useRef<HTMLElement>(null);
  const actIIRef = useRef<HTMLElement>(null);
  const actIIIRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const actId = entry.target.getAttribute("data-act-id") as "actI" | "actII" | "actIII";
            if (actId) {
              setActiveAct(actId);
              // Update focus in Convex for bidirectional sync
              updateFocus({
                briefId: (briefMemory as any)?._id || "morning_brief_latest",
                currentAct: actId,
                focusSource: "panel_action"
              }).catch((err: any) => console.error("Failed to update act focus:", err));
            }
          }
        });
      },
      { threshold: 0.3, rootMargin: "-10% 0px -70% 0px" }
    );

    [actIRef, actIIRef, actIIIRef].forEach((ref) => {
      if (ref.current) observer.observe(ref.current);
    });

    return () => observer.disconnect();
  }, [updateFocus]);

  const handleFeedItemClick = useCallback((item: FeedItem) => {
    if (item.url) {
      setReaderItem(item);
      return;
    }

    openWithContext({
      contextTitle: item.title,
      initialMessage: `Analyze this feed item and summarize key takeaways.\n\n${item.title}${item.subtitle ? `\n\n${item.subtitle}` : ""}`,
      dossierContext: {
        ...dossierContextBase,
        activeSectionId: "signal_stream",
      },
    });
  }, [openWithContext, dossierContextBase]);

  const handleOpenReader = useCallback((input: {
    id?: string;
    title?: string;
    url?: string;
    source?: string;
    summary?: string;
    relevance?: string;
    publishedAt?: string;
    tags?: string[];
    subtitle?: string;
    timestamp?: string;
    category?: string;
  }) => {
    if (!input.url) return;
    setReaderItem(buildReaderItem({
      ...input,
      tags: input.tags ?? (input.category ? [input.category] : undefined),
    }));
  }, [buildReaderItem]);

  const handleEvidenceOpen = useCallback((ev: Evidence) => {
    handleOpenReader({
      id: ev.id,
      title: ev.title ?? ev.source,
      url: ev.url,
      source: ev.source,
      relevance: ev.relevance,
      summary: ev.summary,
      publishedAt: ev.publishedAt,
      tags: ev.source ? [ev.source] : [],
    });
  }, [handleOpenReader]);

  const handleCoverageOpen = useCallback((item: {
    title?: string;
    url?: string;
    source?: string;
    summary?: string;
    category?: string;
  }) => {
    handleOpenReader({
      title: item.title,
      url: item.url,
      source: item.source,
      summary: item.summary,
      category: item.category,
    });
  }, [handleOpenReader]);

  const handleEntityOpen = useCallback((entityName: string, entityType?: "company" | "person") => {
    if (!entityName) return;
    setActiveEntity({ name: entityName, type: entityType ?? "company" });
  }, []);

  const handleEntityClose = useCallback(() => {
    setActiveEntity(null);
  }, []);

  const handleFeedOpenWithAgent = useCallback((item: FeedItem) => {
    openWithContext({
      contextTitle: item.title,
      contextWebUrls: item.url ? [item.url] : undefined,
      initialMessage: `Deep dive on: ${item.title}\n\nWhat happened, why it matters, and what to watch next?`,
      dossierContext: {
        ...dossierContextBase,
        activeSectionId: "signal_stream",
      },
    });
  }, [openWithContext, dossierContextBase]);

  const handleDigestItemClick = useCallback((item: { text: string; relevance?: string; linkedEntity?: string }) => {
    openWithContext({
      contextTitle: item.linkedEntity ? `Digest: ${item.linkedEntity}` : "Morning Digest",
      initialMessage: `Expand on this digest item:\n\n${item.text}`,
      dossierContext: {
        ...dossierContextBase,
        currentAct: "actI",
        activeSectionId: "executive_synthesis",
      },
    });
  }, [openWithContext, dossierContextBase]);

  const handleAskAI = useCallback((prompt: string) => {
    openWithContext({
      contextTitle: "Executive Brief",
      initialMessage: prompt,
      dossierContext: {
        ...dossierContextBase,
        activeSectionId: "institutional_briefing",
      },
    });
  }, [openWithContext, dossierContextBase]);

  const handleAskAgentAboutChanges = useCallback((input: { prompt: string; urls?: string[] }) => {
    openWithContext({
      contextTitle: "What Changed",
      contextWebUrls: input.urls,
      initialMessage: input.prompt,
      dossierContext: {
        ...dossierContextBase,
        activeSectionId: "knowledge_product_changes",
      },
    });
  }, [openWithContext, dossierContextBase]);

  const handleDashboardPointClick = useCallback((point: { seriesId: string; dataIndex: number; dataLabel: string; value: number; unit?: string }) => {
    openWithContext({
      contextTitle: "Pulse Overview",
      initialMessage: `Analyze this chart point:\n- Series: ${point.seriesId}\n- Point: ${point.dataLabel}\n- Value: ${point.value}${point.unit ?? ""}\n\nWhat changed, what it implies, and the next actions to consider.`,
      dossierContext: {
        ...dossierContextBase,
        focusedDataIndex: point.dataIndex,
        chartContext: {
          seriesId: point.seriesId,
          dataLabel: point.dataLabel,
          value: point.value,
          unit: point.unit,
        },
      },
    });
  }, [openWithContext, dossierContextBase]);

  return (
    <div className={`${embedded ? "h-full" : "h-screen"} flex flex-col bg-surface overflow-hidden view-atmosphere-research`}>
      {!embedded && (
        <header className="h-16 bg-background/95  sticky top-0 z-50 flex items-center justify-between px-6 lg:px-8 border-b border-edge">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-[var(--accent-primary)] rounded-md flex items-center justify-center text-white shadow-none transform transition-transform duration-300">
              <span className="text-2xl">N</span>
            </div>
            <div>
              <div className="text-xl font-semibold tracking-tight text-content leading-none cursor-pointer" onClick={onGoHome}>Research Hub</div>
              <div className="text-xs text-content-secondary mt-1 ml-0.5">Research &amp; Insights</div>
            </div>
          </div>

          {onGoHome && (
            <button
              type="button"
              onClick={onGoHome}
              className="flex items-center gap-2 text-xs font-medium text-content-muted hover:text-content transition-colors"
            >
              <ArrowRight className="w-3 h-3 rotate-180" />
              <span>Return to Pulse</span>
            </button>
          )}

          <div className="flex items-center gap-6">
            {/* Historical Date Selector */}
            <div className="flex items-center gap-2 p-1 bg-surface-secondary border border-edge rounded-md">
              {availableDates && availableDates.length > 0 ? (
                <>
                  {availableDates.slice(0, 3).map((date: string) => (
                    <button
                      type="button"
                      key={date}
                      onClick={() => setSelectedDate(date)}
                      className={`px-3 py-1 text-xs font-medium transition-all ${(selectedDate === date || (!selectedDate && date === briefingDateString))
                        ? "bg-[var(--accent-primary)] text-white"
                        : "text-content-muted hover:text-content"
                        }`}
                    >
                      {formatDayChipDate(date)}
                    </button>
                  ))}
                  <div className="w-[1px] h-3 bg-edge mx-1" />
                  <button
                    type="button"
                    onClick={() => setSelectedDate(undefined)}
                    className={`px-3 py-1 text-xs font-medium transition-all ${!selectedDate ? "bg-[var(--accent-primary)] text-white" : "text-content-muted"}`}
                  >
                    Latest
                  </button>
                </>
              ) : (
                <span className="px-3 py-1 text-xs font-medium text-content-muted">Live</span>
              )}
            </div>

            <div className="hidden sm:flex items-center gap-3 text-xs font-medium text-content-secondary">
              <div className="w-2 h-2 rounded-full bg-content-muted motion-safe:animate-pulse" />
              <span>Secure Feed</span>
            </div>
            <div className="hidden sm:block w-[1px] h-6 bg-edge" />
            <div className="text-sm font-medium text-content-secondary font-mono">
              <span>{briefingDateStamp}</span>
            </div>
          </div>
        </header>
      )}

      {/* UNIFIED SCROLL CONTAINER */}
      <main className="flex-1 overflow-y-auto custom-scrollbar bg-surface pb-20 sm:pb-14">
        {embedded && (
          <div className="mx-auto max-w-[1600px] px-6 md:px-12 xl:px-16 pt-6">
            <div className="flex items-start justify-between gap-4">
              <SurfacePageHeader
                title="Research Hub"
                subtitle="Live signals, source-backed briefs, and forecast context in one place."
                badge={briefDateLabel ? (
                  <span className="text-xs font-mono text-content-secondary">
                    {isBriefToday ? "Updated today" : `Latest brief: ${briefDateLabel}`}
                  </span>
                ) : undefined}
              />
              <ShareButton />
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onNavigateToPath?.("/research/world-monitor")}
                className="inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.02] px-4 py-2 text-sm text-content-muted/70 transition hover:bg-white/[0.04] hover:text-content"
              >
                <Globe2 className="w-4 h-4" />
                World Monitor
              </button>
              <button
                type="button"
                onClick={() => onNavigateToPath?.("/research/watchlists")}
                className="inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.02] px-4 py-2 text-sm text-content-muted/70 transition hover:bg-white/[0.04] hover:text-content"
              >
                <ShieldCheck className="w-4 h-4" />
                Watchlists
              </button>
            </div>
          </div>
        )}
        {/* TIMELINE STRIP - Past + Present + Future temporal context */}
        <SectionErrorBoundary
          section="Timeline"
          fallback={
            <div className="mx-auto max-w-[1600px] px-8 md:px-12 pt-6">
              <SectionFallback
                title="Timeline unavailable"
                message="The timeline encountered a render issue. Refresh to retry."
              />
            </div>
          }
        >
          <TimelineStrip
            events={timelineEvents}
            activeEventId={resolvedActiveTimelineEventId}
            phaseFilter={phaseFilter}
            onPhaseChange={setPhaseFilter}
            onEventClick={(event) => {
              setActiveTimelineEventId(event.id);
              const currentAct = event.phase === 'past' ? 'actI' : event.phase === 'present' ? 'actII' : 'actIII';
              openWithContext({
                contextTitle: `Timeline: ${event.label}`,
                initialMessage: `Tell me more about: "${event.label}" (${event.date})${event.description ? `\n\nContext: ${event.description}` : ''}`,
                dossierContext: {
                  ...dossierContextBase,
                  currentAct,
                  activeSectionId: "timeline_strip",
                },
              });
              // Also update the active act based on event phase
              if (event.phase === 'past') setActiveAct('actI');
              else if (event.phase === 'present') setActiveAct('actII');
              else setActiveAct('actIII');
              setPhaseFilter(event.phase);
            }}
            className="mx-auto max-w-[1600px] px-8 md:px-12 pt-6"
          />
        </SectionErrorBoundary>

        <div className="max-w-[1600px] mx-auto flex items-start gap-4">

          {/* LEFT: MAIN CONTENT WITH TABS */}
          <div className="flex-1 pl-6 md:pl-10 pr-4 md:pr-6 py-4 pb-28 sm:pb-20">
            <Tabs
              value={activeTab}
              onValueChange={(value) => {
                const tab = value as ContentTab;
                setActiveTab(tab);
                onTabChange?.(tab);
              }}
              className="contents"
            >

            {/* TAB NAVIGATION */}
            <TabsList className="mb-4 flex h-auto justify-start gap-1 rounded-none border-b border-edge bg-transparent p-0" aria-label="Research views">
              {CONTENT_TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    className={cn(
                      'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150 data-[state=active]:bg-transparent data-[state=active]:text-content data-[state=active]:shadow-none',
                      isActive
                        ? 'border-indigo-500 text-content'
                        : 'border-transparent text-content-muted hover:text-content'
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{tab.label}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {/* TAB CONTENT */}
            <div className="space-y-6">

              {/* OVERVIEW TAB: Digest + Personal Pulse */}
              <TabsContent value="overview" className="mt-0">
                <div className="space-y-6">
                  {/* Executive Synthesis */}
                  <section ref={actIRef} data-act-id="actI">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Newspaper className="w-4 h-4 text-content-muted" />
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">Daily Summary</h3>
                        {selectedDate && (
                          <span className="px-1.5 py-0.5 bg-white/[0.04] text-content-muted/70 text-xs font-medium border border-white/[0.06] rounded">Past</span>
                        )}
                      </div>
                      <div className={cn('w-1.5 h-1.5 rounded-full motion-safe:animate-pulse', selectedDate ? 'bg-content-secondary' : 'bg-[var(--accent-primary)]')} />
                    </div>
                    <SectionErrorBoundary
                      section="Daily summary"
                      fallback={
                        <SectionFallback
                          title="Daily summary unavailable"
                          message="This panel hit a render issue. Refresh to retry."
                        />
                      }
                    >
                      <DigestSection
                        onItemClick={handleDigestItemClick}
                        onEntityClick={handleEntityOpen}
                      />
                    </SectionErrorBoundary>
                  </section>

                  {/* Personal Pulse */}
                  <section className="pt-2">
                    <SectionErrorBoundary
                      section="Personal pulse"
                      fallback={
                        <SectionFallback
                          title="Personal pulse unavailable"
                          message="We couldn't render personalized signals right now."
                        />
                      }
                    >
                      <PersonalPulse
                        personalizedContext={personalizedContext}
                        tasksToday={tasksToday || []}
                        recentDocs={recentDocs || []}
                        onDocumentSelect={props.onDocumentSelect}
                      />
                    </SectionErrorBoundary>
                  </section>
                </div>
              </TabsContent>

              {/* SIGNALS TAB: Live Signal Stream */}
              <TabsContent value="signals" className="mt-0">
                <section ref={actIIIRef} data-act-id="actIII" className="animate-in fade-in duration-300">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <TrendingUp className="w-4 h-4 text-content-muted" />
                      <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">Latest Updates</h3>
                    </div>
                    <div className="px-1.5 py-0.5 bg-white/[0.04] text-content-muted/70 border border-white/[0.06] text-xs font-medium rounded">Live</div>
                  </div>
                  <SectionErrorBoundary
                    section="Signals"
                    fallback={
                      <SectionFallback
                        title="Signals unavailable"
                        message="We couldn't render the signal stream right now. Refresh to retry."
                      />
                    }
                  >
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                      <FeedSection
                        onItemClick={handleFeedItemClick}
                        onOpenWithAgent={handleFeedOpenWithAgent}
                      />
                    </div>
                  </SectionErrorBoundary>
                </section>
              </TabsContent>

              {/* BRIEFING TAB: Institutional Briefing */}
              <TabsContent value="briefing" className="mt-0">
                <section ref={actIIRef} data-act-id="actII" className="animate-in fade-in duration-300">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Layers className="w-4 h-4 text-content-muted" />
                      <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">Full Briefing</h3>
                    </div>
                    <span className="text-xs font-medium text-content-muted">In-depth</span>
                  </div>
                  <SectionErrorBoundary
                    section="Briefing"
                    fallback={
                      <SectionFallback
                        title="Briefing unavailable"
                        message="The full briefing panel hit a render issue. Refresh to retry."
                      />
                    }
                  >
                    <BriefingSection
                      onActChange={(act) => {
                        setActiveAct(act as any);
                        updateFocus({ briefId: (briefMemory as any)?._id || "morning_brief_latest", currentAct: act as any });
                      }}
                      onAskAI={handleAskAI}
                      onOpenReader={handleOpenReader}
                    />
                  </SectionErrorBoundary>
                </section>
              </TabsContent>

              {/* FORECASTS TAB: Prediction Cockpit */}
              <TabsContent value="forecasts" className="mt-0">
                <section className="animate-in fade-in duration-300 pb-8">
                  <SectionErrorBoundary
                    section="Forecasts"
                    fallback={
                      <SectionFallback
                        title="Forecasts unavailable"
                        message="Forecast charts could not render. Refresh to retry."
                      />
                    }
                  >
                    <React.Suspense fallback={<div className="h-[120px]" />}>
                      <ForecastCockpit />
                    </React.Suspense>
                  </SectionErrorBoundary>
                </section>
              </TabsContent>

              {/* Deals, Changes, Changelog tabs removed — accessible via Cmd+K */}
            </div>
            </Tabs>
          </div>

          {/* RIGHT: COMPACT HUD SIDEBAR */}
          <aside className="w-[340px] shrink-0 sticky top-0 h-fit py-4 pr-6 hidden overflow-hidden">
            {/* Gradient separator */}
            <div className="absolute left-0 top-4 bottom-4 w-px bg-gradient-to-b from-transparent via-edge to-transparent" />

            <div className="space-y-4 pl-4">
              <SectionErrorBoundary
                section="Context graph"
                fallback={
                  <SectionFallback
                    title="Context graph unavailable"
                    message="The context panel failed to render. Refresh to retry."
                  />
                }
              >
                {phasedDashboardMetrics ? (
                  <ActAwareDashboard
                    activeAct={activeAct}
                    dashboardData={phasedDashboardMetrics}
                    executiveBrief={executiveBrief as any}
                    sourceSummary={sourceSummary}
                    evidence={evidence || []}
                    workflowSteps={workflowSteps}
                    deltas={deltas}
                    onDataPointClick={handleDashboardPointClick}
                    onEvidenceClick={handleEvidenceOpen}
                  />
                ) : (
                  <DashboardSection activeAct={activeAct} />
                )}
              </SectionErrorBoundary>
              <SectionErrorBoundary
                section="Activity log"
                fallback={
                  <SectionFallback
                    title="Activity log unavailable"
                    message="Recent activity could not be loaded right now."
                  />
                }
              >
                <React.Suspense fallback={<div className="h-[80px]" />}>
                  <NotificationActivityPanel
                    mode="topic"
                    variant="hub"
                    title="Activity Log"
                    limit={4}
                  />
                </React.Suspense>
              </SectionErrorBoundary>
            </div>
          </aside>
        </div>
      </main>

      {/* LIVE INTEL FLOW MONITOR */}
      <SectionErrorBoundary section="Intel monitor" fallback={null}>
        <React.Suspense fallback={null}>
          <IntelPulseMonitor taskResults={taskResults || []} />
        </React.Suspense>
      </SectionErrorBoundary>

      <SectionErrorBoundary section="Reader modal" fallback={null}>
        <React.Suspense fallback={null}>
          <FeedReaderModal
            item={readerItem}
            techStack={techStack}
            onClose={() => setReaderItem(null)}
          />
        </React.Suspense>
      </SectionErrorBoundary>
      <SectionErrorBoundary section="Entity drawer" fallback={null}>
        <React.Suspense fallback={null}>
          <EntityContextDrawer
            isOpen={Boolean(activeEntity)}
            entityName={activeEntity?.name ?? null}
            entityType={activeEntity?.type}
            trackedHashtags={trackedHashtags}
            techStack={techStack}
            onClose={handleEntityClose}
            onOpenReader={handleOpenReader}
          />
        </React.Suspense>
      </SectionErrorBoundary>
    </div>
  );
}

export default function ResearchHub(props: ResearchHubProps) {
  return (
    <EvidenceProvider>
      <ResearchHubContent {...props} />
    </EvidenceProvider>
  );
}
