"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import SmartLink from "./SmartLink";
import { InteractiveSpanParser } from "./InteractiveSpanParser";
import DeepDiveAccordion from "./DeepDiveAccordion";
import streamData from "@/features/research/content/researchStream.json";
import LiveDashboard from "./LiveDashboard";
import SafeVegaChart from "./SafeVegaChart";
import type { DashboardState, StorySection } from "@/features/research/types";
import { isUIFlagEnabled } from "../../../../convex/lib/featureFlags";
import type { Signal, Action, VizArtifact } from "@/features/research/types/dailyBriefSchema";
import { PageHeroHeader } from "@shared/ui/PageHeroHeader";
import { SignalList } from "./SignalCard";
import { ActionList } from "./ActionCard";
import TimelineScrubber from "./TimelineScrubber";

// Define a proper type to avoid JSON inference issues
export interface ScrollySection {
  id: string;
  meta: { date: string; title: string };
  content: {
    body: string[];
    deepDives: Array<{ title: string; content: string }>;
    /** Optional: Structured signals for Act II (replaces raw body when present) */
    signals?: Signal[];
    /** Optional: Structured actions for Act III (replaces raw body when present) */
    actions?: Action[];
  };
  dashboard: {
    phaseLabel: string;
    kpis: Array<{ label: string; value: number; unit: string; color: string }>;
    marketSentiment: number;
    activeRegion: string;
  };
  dashboard_update?: DashboardState;
  timelineState?: StorySection;
  smartLinks?: Record<string, { summary: string; source?: string }>;
  /** Optional section-specific visualization artifact (Vega-Lite) */
  vizArtifact?: VizArtifact;
}

type ActId = "actI" | "actII" | "actIII";

const getActForIndex = (idx: number): ActId => {
	if (idx <= 0) return "actI";
	if (idx === 1) return "actII";
	return "actIII";
};

// Lightweight intersection observer hook to avoid external dependency
const useInView = (options?: IntersectionObserverInit) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observerOptions: IntersectionObserverInit = {
      // Center-band activation for deterministic scrolly binding.
      threshold: options?.threshold ?? 0,
      rootMargin: options?.rootMargin ?? "-45% 0px -45% 0px",
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => setInView(entry.isIntersecting));
      },
      observerOptions,
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [options]);

  return { ref, inView };
};

const parseSmartLinks = (text: string, linksData?: Record<string, { summary: string; source?: string }>) => {
  // Basic parser for <SmartLink id='x'>Label</SmartLink> tags
  const regex = /<SmartLink id=['"]([^'"]+)['"]>(.*?)<\/SmartLink>/g;
  const parts: Array<string | { id: string; label: string }> = [];
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push({ id: match[1], label: match[2] });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.map((part, idx) => {
    if (typeof part === "string") return <React.Fragment key={idx}>{part}</React.Fragment>;
    const link = linksData?.[part.id];
    return (
      <SmartLink key={`${part.id}-${idx}`} summary={link?.summary} source={link?.source}>
        {part.label}
      </SmartLink>
    );
  });
};

interface SectionRendererProps {
  section: ScrollySection;
  onVisible: () => void;
  isLast?: boolean;
  /** Callback for Ask AI button click */
  onAskAI?: (sectionId: string, sectionTitle: string) => void;
}

const SectionRenderer = ({ section, onVisible, isLast = false, onAskAI }: SectionRendererProps) => {
  const { ref, inView } = useInView({ threshold: 0, rootMargin: "-45% 0px -45% 0px" });
  const onVisibleRef = useRef(onVisible);

  useEffect(() => {
    onVisibleRef.current = onVisible;
  }, [onVisible]);

  useEffect(() => {
    if (inView) onVisibleRef.current?.();
  }, [inView]);

  return (
	    <div ref={ref} id={section.id} className="relative mb-10 scroll-mt-16 pl-8 xl:pl-4">
      {/* Timeline Connector Line - Simplified for Clean Look */}
      {!isLast && (
        <div className="absolute left-0 top-10 bottom-[-48px] w-px bg-surface-secondary hidden xl:block" />
      )}
      {/* Timeline Dot - Static Minimalist */}
      <div className="absolute left-[-4px] top-[14px] hidden xl:block">
        <div className="h-2.5 w-2.5 rounded-full bg-content ring-4 ring-[#fbfaf2]"></div>
      </div>

      {/* Date Badge - Inline with dot */}
      <div className="mb-3 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-content-secondary"></span>
        <span className="text-xs font-medium text-content-secondary tracking-wide">
          {section.meta.date}
        </span>
      </div>

      {/* Section Title - Clean Sans */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 className="text-2xl font-semibold tracking-tight text-content leading-tight">
          {section.meta.title}
        </h2>
        {onAskAI && (
          <button
            type="button"
            onClick={() => onAskAI(section.id, section.meta.title)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-full transition-colors shrink-0"
            title="Ask AI about this section"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Ask AI</span>
          </button>
        )}
      </div>

      {/* Narrative Body */}
      {section.content.body.length > 0 && (
        <div className="prose prose-base prose-slate text-slate-900 leading-relaxed max-w-none not-italic">
          {section.content.body.map((paragraph, idx) => (
            <p key={idx} className="mb-6 last:mb-0">
              <InteractiveSpanParser
                text={paragraph}
                smartLinks={
                  (section.smartLinks ?? {}) as Record<string, { summary: string; source?: string }>
                }
                spanPrefix={`${section.id}-p${idx}`}
              />
            </p>
          ))}
        </div>
      )}

      {/* Act II: Structured Signals */}
      {section.content.signals && section.content.signals.length > 0 && (
        <div className="mt-6">
          <SignalList signals={section.content.signals} />
        </div>
      )}

      {/* Act III: Structured Actions */}
      {section.content.actions && section.content.actions.length > 0 && (
        <div className="mt-6">
          <ActionList actions={section.content.actions} />
        </div>
      )}

      {section.content.deepDives.length > 0 && (
        <div className="mt-8 space-y-4">
          {section.content.deepDives.map((dd, idx) => (
            <DeepDiveAccordion key={idx} title={dd.title} content={dd.content} />
          ))}
        </div>
      )}
    </div>
  );
};

/** Chart data point context for AI agent integration */
export interface ChartPointClickContext {
  seriesId: string;
  dataIndex: number;
  dataLabel: string;
  value: number;
  unit?: string;
}

interface ScrollytellingLayoutProps {
  data?: ScrollySection[];
  /** If true, shows the "free daily" badge and sign-in prompt */
  isGuestMode?: boolean;
  /** If true, hides the HeroSection (useful when parent already has a hero) */
  hideHero?: boolean;
  /** Callback when active act changes (for right-rail dashboard sync) */
	  onActChange?: (act: ActId) => void;
  /** Callback for Ask AI button click (opens Fast Agent panel with section context) */
  onAskAI?: (sectionId: string, sectionTitle: string) => void;
  /** Callback for chart data point clicks (opens Fast Agent panel with data point context) */
  onChartPointClick?: (point: ChartPointClickContext) => void;
}

export const ScrollytellingLayout: React.FC<ScrollytellingLayoutProps> = ({ data, isGuestMode, hideHero, onActChange, onAskAI, onChartPointClick }) => {
  // Priority: props data > static fallback
  const sourceData = useMemo(() => {
    if (data && data.length) return data;
    return streamData as unknown as ScrollySection[];
  }, [data]);

  const sectionCount = sourceData.length;

  const showGuestBadge = isGuestMode ?? !data?.length;
  const isLiveData = false;

  const initialLegacy = useMemo(
    () =>
      sourceData[0]?.dashboard ?? {
        phaseLabel: "",
        kpis: [],
        marketSentiment: 0,
        activeRegion: "",
      },
    [sourceData],
  );
  const fallbackDashboardData = useCallback(
    (section: ScrollySection | undefined, idx: number): DashboardState => {
      const normalizeTrendLine = (raw: any, labelFallback = "Briefing"): DashboardState["charts"]["trendLine"] => {
        // Agent protocol: numeric series + optional ghost + gridScale
        if (raw?.series && Array.isArray(raw.series) && raw.series.every((n: any) => typeof n === "number")) {
          const safeData = raw.series.map((value: number) => ({ value: Number(value ?? 0) }));
          if (safeData.length === 1) safeData.push({ ...safeData[0] });
          if (safeData.length === 0) safeData.push({ value: 0 }, { value: 0 });
          const labels =
            raw.xAxisLabels?.length === safeData.length
              ? raw.xAxisLabels
              : safeData.map((_: any, i: number) => `T${i + 1}`);
          const ghostSeries =
            raw.ghostSeries && Array.isArray(raw.ghostSeries)
              ? raw.ghostSeries.map((value: number) => ({ value: Number(value ?? 0) }))
              : null;
          return {
            title: raw.label ?? labelFallback,
            xAxisLabels: labels,
            series: [
              {
                id: "series-0",
                label: raw.label ?? labelFallback,
                type: "solid",
                color: "accent",
                data: safeData,
              },
              ...(ghostSeries
                ? [
                    {
                      id: "ghost-0",
                      label: "Previous",
                      type: "ghost",
                      color: "gray",
                      data:
                        ghostSeries.length === safeData.length
                          ? ghostSeries
                          : safeData.map((v: any, idx: number) => ghostSeries[idx] ?? v),
                    },
                  ]
                : []),
            ],
            visibleEndIndex: Math.max(0, safeData.length - 1),
            focusIndex: Math.max(0, safeData.length - 1),
            gridScale: raw.gridScale,
          };
        }

        // Already enriched chart config
        if (raw?.series?.length && Array.isArray(raw.series[0]?.data)) {
          const safeLabels =
            raw.xAxisLabels && raw.xAxisLabels.length
              ? raw.xAxisLabels
              : raw.series?.[0]?.data?.map((_: unknown, i: number) => `T${i + 1}`) ?? ["T0"];
          return {
            title: raw.title ?? labelFallback,
            xAxisLabels: safeLabels,
            series: raw.series.map((s: any, i: number) => {
              const normalizedData = (s.data ?? []).map((pt: any) => ({
                value: Number(pt?.value ?? 0),
                tooltip: pt?.tooltip,
              }));
              if (normalizedData.length === 1) {
                normalizedData.push({ ...normalizedData[0] });
              }
              if (normalizedData.length === 0) {
                normalizedData.push({ value: 0 }, { value: 0 });
              }

              return {
                id: s.id ?? `series-${i}`,
                label: s.label ?? `Series ${i + 1}`,
                type: s.type ?? "solid",
                color: s.color,
                data: normalizedData,
              };
            }),
            visibleEndIndex: Math.max(
              0,
              Math.min(
                typeof raw.visibleEndIndex === "number" ? raw.visibleEndIndex : safeLabels.length - 1,
                safeLabels.length - 1,
              ),
            ),
            focusIndex:
              typeof raw.focusIndex === "number"
                ? raw.focusIndex
                : typeof raw.visibleEndIndex === "number"
                  ? raw.visibleEndIndex
                  : safeLabels.length - 1,
            gridScale: raw.gridScale,
          };
        }

        // Legacy flat data array
        if (raw?.data?.length) {
          const safeData = raw.data.map((value: number) => ({ value: Number(value ?? 0) }));
          if (safeData.length === 1) {
            safeData.push({ ...safeData[0] });
          }
          if (safeData.length === 0) {
            safeData.push({ value: 0 }, { value: 0 });
          }
          return {
            title: raw.label ?? labelFallback,
            xAxisLabels: safeData.map((_: any, i: number) => `T${i + 1}`),
            series: [
              {
                id: "series-0",
                label: raw.label ?? labelFallback,
                type: "solid",
                color: "black",
                data: safeData,
              },
            ],
            visibleEndIndex: safeData.length - 1,
            focusIndex: safeData.length - 1,
          };
        }

        // Fallback zeroed config
        return {
          title: labelFallback,
          xAxisLabels: ["T1", "T2"],
          series: [
            {
              id: "series-0",
              label: labelFallback,
              type: "solid",
              color: "black",
              data: [{ value: 0 }, { value: 0 }],
            },
          ],
          visibleEndIndex: 1,
          focusIndex: 1,
        };
      };

      if (!section) {
        return {
          meta: { currentDate: "Now", timelineProgress: 0 },
          charts: { trendLine: normalizeTrendLine(null), marketShare: [] },
          techReadiness: { existing: 0, emerging: 0, sciFi: 0 },
          keyStats: [],
          capabilities: [],
        };
      }

      if (section.timelineState?.dashboard_state) {
        const ds = section.timelineState.dashboard_state;
        const deltaStats =
          (ds as any)?.deltas && typeof (ds as any).deltas === "object"
            ? Object.entries((ds as any).deltas).map(([label, val]) => ({
                label,
                value: (val as any)?.value ?? "",
                sub: (val as any)?.change,
                trend: (val as any)?.direction,
              }))
            : [];
        return {
          ...ds,
          charts: {
            ...ds.charts,
            trendLine: normalizeTrendLine(ds.charts.trendLine, ds.charts.trendLine?.title ?? "Briefing"),
          },
          annotations: ds.annotations,
          keyStats: ds.keyStats?.length ? ds.keyStats : deltaStats,
        };
      }

      if (section.dashboard_update) {
        // Convert legacy mainTrend ?+" trendLine if present
        const du = section.dashboard_update as any;
        const hasMain = du?.charts?.mainTrend;
        const deltaStats =
          du?.deltas && typeof du.deltas === "object"
            ? Object.entries(du.deltas).map(([label, val]) => ({
                label,
                value: (val as any)?.value ?? "",
                sub: (val as any)?.change,
                trend: (val as any)?.direction,
              }))
            : [];
        return {
          ...du,
          charts: {
            trendLine: normalizeTrendLine(
              hasMain ? du.charts.mainTrend : du.charts.trendLine,
              (hasMain ? du.charts.mainTrend : du.charts.trendLine)?.label ?? "Briefing",
            ),
            marketShare: du.charts.marketShare ?? [],
          },
          annotations: du.annotations ?? du?.charts?.trendLine?.annotations ?? [],
          keyStats: du.keyStats?.length ? du.keyStats : deltaStats,
        };
      }
      const base = section.dashboard ?? {
        phaseLabel: "Briefing",
        kpis: [],
        marketSentiment: 0,
        activeRegion: "Global",
      };
      return {
        meta: {
          currentDate: section.meta?.date ?? "Now",
          timelineProgress: sectionCount > 1 ? idx / Math.max(sectionCount - 1, 1) : 1,
        },
        charts: {
          trendLine: normalizeTrendLine(
            {
              data: base.kpis?.map((kpi) => kpi.value) ?? [base.marketSentiment ?? 0],
              label: base.phaseLabel ?? "Briefing",
            },
            base.phaseLabel ?? "Briefing",
          ),
          marketShare:
            base.kpis?.slice(0, 3).map((kpi, i) => ({
              label: kpi.label,
              value: Math.max(0, Math.min(100, kpi.value)),
              color: i === 0 ? "black" : i === 1 ? "accent" : "gray",
            })) ?? [],
        },
        techReadiness: {
          existing: Math.min(8, Math.round((base.marketSentiment ?? 0) / 15)),
          emerging: Math.min(8, Math.round((base.kpis?.[0]?.value ?? 0) / 20)),
          sciFi: Math.min(8, Math.round((base.kpis?.[1]?.value ?? 0) / 20)),
        },
        keyStats:
          base.kpis?.slice(0, 3).map((kpi) => ({
            label: kpi.label,
            value: `${kpi.value}${kpi.unit ?? ""}`,
          })) ?? [],
        capabilities:
          base.kpis?.slice(0, 3).map((kpi, i) => ({
            label: kpi.label,
            score: Math.max(0, Math.min(100, kpi.value)),
            icon: i === 0 ? "shield-alert" : i === 1 ? "code" : "vote",
          })) ?? [],
      };
    },
    [sectionCount],
  );
  const initialDashboardData = useMemo(() => fallbackDashboardData(sourceData[0], 0), [fallbackDashboardData, sourceData]);
  const initialVizArtifact = useMemo(() => (sourceData[0] as ScrollySection | undefined)?.vizArtifact ?? null, [sourceData]);

  const [activeLegacy, setActiveLegacy] = useState(initialLegacy);
  const [activeDashboard, setActiveDashboard] = useState<DashboardState>(initialDashboardData);
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const [activeVizArtifact, setActiveVizArtifact] = useState<VizArtifact | null>(initialVizArtifact);
	  const currentAct: ActId = getActForIndex(activeSectionIndex);

	  const handleScrubToSection = useCallback(
	    (index: number) => {
	      if (!Number.isFinite(index) || sourceData.length === 0) return;
	      const clamped = Math.max(0, Math.min(index, sourceData.length - 1));
	      const section = sourceData[clamped] as ScrollySection;

	      setActiveSectionIndex(clamped);
	      setActiveLegacy(section.dashboard ?? initialLegacy);
	      setActiveDashboard(fallbackDashboardData(section, clamped));
	      setActiveVizArtifact(section.vizArtifact ?? null);

	      if (onActChange) {
	        onActChange(getActForIndex(clamped));
	      }

	      if (typeof document !== "undefined") {
	        const el = document.getElementById(section.id);
	        if (el) {
	          el.scrollIntoView({ behavior: "smooth", block: "start" });
	        }
	      }
	    },
	    [fallbackDashboardData, initialLegacy, onActChange, sourceData],
	  );

  useEffect(() => {
    setActiveLegacy(initialLegacy);
    setActiveDashboard(initialDashboardData);
    setActiveSectionIndex(0);
    setActiveVizArtifact(initialVizArtifact);
  }, [initialDashboardData, initialLegacy, initialVizArtifact]);

  // Generate today's date for the header
  const todayFormatted = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }, []);

  return (
    <div className="w-full pb-12">
      {/* Compact header to keep content higher on the page */}
      {showGuestBadge && !hideHero && (
        <div className="px-4 sm:px-6 lg:px-8 max-w-[1600px] mx-auto pt-6 pb-4">
          <PageHeroHeader
            icon={<span className="text-sm font-semibold">AI</span>}
            title="Daily Brief"
            date={todayFormatted}
            subtitle={`${sectionCount} stories · ~${Math.ceil(sectionCount * 2.5)} min read`}
            className="pb-2"
            accent
          />
        </div>
      )}

      {/* Mobile/Tablet Compact Dashboard (Sticky Top) */}
      <div className="lg:hidden relative mt-6 mb-8 mx-4 bg-[#fbfaf2]/90  border border-edge rounded-lg px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-indigo-500 motion-safe:animate-pulse" />
            <span className="text-xs font-bold text-content">{activeLegacy.phaseLabel || "Briefing"}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs text-content-secondary font-medium">Sentiment</div>
              <div className="text-sm font-bold text-content">{activeLegacy.marketSentiment}/100</div>
            </div>
          </div>
        </div>
        {/* Progress Bar */}
        <div className="mt-3 h-1 w-full rounded-full bg-surface-secondary overflow-hidden">
          <div
            className="h-full bg-content transition-all duration-1000 ease-out"
            style={{ width: `${activeLegacy.marketSentiment}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 px-4 sm:px-6 lg:px-8 max-w-[1600px] mx-auto">
        <div className="lg:col-span-7 xl:col-span-8 pb-8 relative">
          {sourceData.length === 0 && (
            <div className="p-8 text-center text-content-secondary bg-surface/50 rounded-lg border border-edge">
              <p>No briefing data available for this view.</p>
            </div>
          )}
          {sourceData.map((section, idx) => (
            <SectionRenderer
              key={section.id}
              section={section as ScrollySection}
              onVisible={() => {
                if (activeSectionIndex === idx) return;
                setActiveSectionIndex(idx);
                setActiveLegacy(section.dashboard ?? initialLegacy);
                setActiveDashboard(fallbackDashboardData(section, idx));
                setActiveVizArtifact((section as ScrollySection).vizArtifact ?? null);
                // Notify parent of act change for right-rail dashboard sync
                if (onActChange) {
	                  onActChange(getActForIndex(idx));
                }
              }}
              isLast={idx === sourceData.length - 1}
              onAskAI={onAskAI}
            />
          ))}
        </div>
	        <div className="hidden lg:block lg:col-span-5 xl:col-span-4">
	          <div className="sticky top-24 min-h-[400px] space-y-3">
	            <TimelineScrubber
	              totalSections={sectionCount}
	              activeIndex={activeSectionIndex}
	              currentAct={currentAct}
	              onScrubToSection={handleScrubToSection}
	            />
	            {/* VizArtifact rendering behind feature flag */}
	            {isUIFlagEnabled("ENABLE_VIZ_ARTIFACT") && activeVizArtifact && (
	              <SafeVegaChart artifact={activeVizArtifact} className="mb-3" />
	            )}
	            <LiveDashboard
	              mode="controlled"
	              fallbackData={activeDashboard}
	              onDataPointClick={onChartPointClick}
	            />
	          </div>
	        </div>
      </div>

      {/* Footer / CTA for Guests */}
      {showGuestBadge && (
        <div className="mt-24 border-t border-edge pt-16 text-center">
          <h3 className="mb-4 text-2xl font-medium text-content">
            Dive deeper with your own data
          </h3>
          <p className="mx-auto mb-8 max-w-xl text-content-secondary">
            Connect your workspace to generate personalized intelligence briefings,
            track your specific deals, and get real-time market alerts.
          </p>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-semibold text-white shadow-lg transition-transform hover:bg-gray-800"
          >
            <span>Start Free Trial</span>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </button>
          <p className="mt-6 text-xs text-content-secondary">
            No credit card required · SOC2 Compliant
          </p>
        </div>
      )}
    </div>
  );
};

export default ScrollytellingLayout;
