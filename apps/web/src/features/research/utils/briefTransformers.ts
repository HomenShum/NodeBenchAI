import type { DashboardState, ChartSeries, TrendLineConfig } from "@/features/research/types";
import type { ExecutiveBriefRecord } from "@/features/research/types/dailyBriefSchema";
import type { ScrollySection } from "@/features/research/components/ScrollytellingLayout";

type HistoricalSnapshot = {
  dateString: string;
  generatedAt: number;
  version: number;
  sourceSummary?: {
    totalItems?: number;
    bySource?: Record<string, number>;
    topTrending?: string[];
  };
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function safeDate(dateString: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
  const d = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatAxisLabel(dateString: string): string {
  const d = safeDate(dateString);
  if (!d) return dateString;
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" }).replace(" ", " ");
}

function buildSharedSeriesFromHistory(args: {
  todayDateString: string;
  todayTotalItems: number;
  history?: HistoricalSnapshot[] | null;
}): { xAxisLabels: string[]; values: number[] } {
  const today = safeDate(args.todayDateString);
  if (!today) {
    // Fall back to 6-point synthetic series centered on today's totalItems.
    const base = Math.max(1, args.todayTotalItems);
    const vals = [base - 18, base - 12, base - 6, base, base + 6, base + 10].map((v) => Math.max(1, v));
    return { xAxisLabels: ["-3", "-2", "-1", "Today", "+1", "+2"], values: vals };
  }

  const snapshots = Array.isArray(args.history) ? args.history : [];
  const sorted = snapshots
    .filter((s) => typeof s?.dateString === "string" && safeDate(s.dateString))
    .sort((a, b) => String(a.dateString).localeCompare(String(b.dateString)));

  const byDate = new Map<string, number>();
  for (const snap of sorted) {
    const total = snap?.sourceSummary?.totalItems;
    if (typeof total === "number") byDate.set(snap.dateString, total);
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const pastDates: string[] = [];
  for (let i = 3; i >= 1; i--) {
    const d = new Date(today.getTime() - i * dayMs);
    pastDates.push(d.toISOString().slice(0, 10));
  }

  const todayKey = args.todayDateString;
  const historyVals = [
    ...pastDates.map((ds) => byDate.get(ds)),
    byDate.get(todayKey) ?? args.todayTotalItems,
  ].map((v, idx) => (typeof v === "number" ? v : Math.max(1, args.todayTotalItems - (3 - idx) * 6)));

  const deltas = historyVals.slice(1).map((v, i) => v - historyVals[i]);
  const avgDelta = deltas.length ? deltas.reduce((sum, d) => sum + d, 0) / deltas.length : 0;

  const future1 = Math.max(1, Math.round(historyVals[3] + avgDelta));
  const future2 = Math.max(1, Math.round(future1 + avgDelta));

  const futureDates: string[] = [];
  for (let i = 1; i <= 2; i++) {
    const d = new Date(today.getTime() + i * dayMs);
    futureDates.push(d.toISOString().slice(0, 10));
  }

  const labels = [...pastDates, todayKey, ...futureDates].map((d, idx) =>
    idx === 3 ? "Today" : formatAxisLabel(d),
  );
  const values = [...historyVals, future1, future2].map((v) => Math.max(1, v));
  return { xAxisLabels: labels, values };
}

function toMarketShare(bySource: Record<string, number>): DashboardState["charts"]["marketShare"] {
  const entries = Object.entries(bySource)
    .filter(([, count]) => typeof count === "number" && count > 0)
    .sort(([, a], [, b]) => (b) - (a))
    .slice(0, 3);

  const colors = ["black", "accent", "gray"] as const;
  return entries.map(([label, value], idx) => ({ label, value, color: colors[idx] }));
}

export function buildResearchStreamViewModel(args: {
  record: ExecutiveBriefRecord | null | undefined;
  history?: HistoricalSnapshot[] | null;
}): ScrollySection[] {
  const record = args.record;
  if (!record || record.status !== "valid") return [];

  const brief = record.brief;
  const evidence = Array.isArray(record.evidence) ? record.evidence : [];
  if (evidence.length === 0) return [];

  const visibleActions = (brief.actIII?.actions ?? []).filter((action) => {
    if (!action) return false;
    if (!["proposed", "in_progress", "completed"].includes(action.status)) return false;
    const text = (action.resultMarkdown ?? action.content ?? "").trim();
    if (!text) return false;
    if (/no meaningful output produced/i.test(text)) return false;
    if (/^pending\b/i.test(text)) return false;
    if (/^completed\b/i.test(text) && /no notes/i.test(text)) return false;
    return true;
  });

  const presentIndex = 3;
  const { xAxisLabels, values } = buildSharedSeriesFromHistory({
    todayDateString: brief.meta.date,
    todayTotalItems: brief.actI.totalItems,
    history: args.history,
  });

  const linkedEvidenceIds = brief.actII?.signals?.flatMap((s) => (s.evidence ?? []).map((e) => e.id)) ?? [];
  const uniqueEvidenceIds = [...new Set(linkedEvidenceIds)].slice(0, 4);

  const baseSeries: ChartSeries = {
    id: "series-coverage",
    label: "Coverage",
    type: "solid",
    color: "accent",
    data: values.map((v, idx) => ({
      value: v,
      tooltip:
        idx === presentIndex
          ? {
              title: "Today’s Briefing",
              body: brief.meta.summary,
              kicker: "Focus",
              linkedEvidenceIds: uniqueEvidenceIds,
            }
          : undefined,
      linkedEvidenceIds: idx === presentIndex ? uniqueEvidenceIds : undefined,
    })),
  };

  const baseTrend: Omit<TrendLineConfig, "visibleEndIndex"> = {
    title: "Coverage (items)",
    xAxisLabels,
    series: [baseSeries],
    presentIndex,
    yAxisUnit: "items",
    timeWindow: "6-point narrative arc",
    lastUpdated: brief.actI.latestItemAt,
  };

  const bySource = brief.dashboard?.sourceBreakdown ?? {};
  const sourceCount = brief.actI.sourcesCount || Object.keys(bySource).length;

  const buildDashboardState = (act: 1 | 2 | 3): DashboardState => {
    const visibleEndIndex = act === 1 ? 2 : act === 2 ? presentIndex : 5;
    const focusIndex = act === 2 ? presentIndex : undefined;
    const trendLine: TrendLineConfig = {
      ...baseTrend,
      visibleEndIndex,
      focusIndex,
    };

    const keyStats =
      act === 1
        ? [
            { label: "Items", value: String(brief.actI.totalItems) },
            { label: "Sources", value: String(sourceCount) },
            { label: "Latest", value: brief.actI.latestItemAt ? new Date(brief.actI.latestItemAt).toLocaleString() : "" },
          ].filter((s) => s.value)
        : act === 2
          ? [
              { label: "Signals", value: String(brief.actII.signals.length) },
              { label: "Focus", value: "Today" },
              { label: "Evidence", value: String(uniqueEvidenceIds.length) },
            ]
          : [
              { label: "Actions", value: String(visibleActions.length) },
              { label: "Projection", value: "+2 days" },
              { label: "Ship", value: "Fast Agent" },
            ];

    return {
      meta: {
        currentDate: brief.meta.date,
        timelineProgress: act === 1 ? 0.25 : act === 2 ? 0.62 : 0.96,
      },
      charts: {
        trendLine,
        marketShare: toMarketShare(bySource),
      },
      techReadiness: {
        existing: Math.min(8, Math.round((brief.meta.confidence ?? 55) / 15)),
        emerging: Math.min(8, Math.round(brief.actII.signals.length)),
        sciFi: Math.min(8, Math.round(visibleActions.length)),
      },
      keyStats: keyStats.map((s) => ({ label: s.label, value: s.value })),
      capabilities: [
        { label: "Coverage", score: clamp(Math.round((brief.actI.totalItems / 200) * 100), 0, 100), icon: "shield-alert" },
        { label: "Signals", score: clamp(Math.round((brief.actII.signals.length / 6) * 100), 0, 100), icon: "code" },
        { label: "Actions", score: clamp(Math.round((visibleActions.length / 6) * 100), 0, 100), icon: "vote" },
      ],
      annotations: [],
    };
  };

  const didYouKnow = brief.didYouKnow;
  const didYouKnowSection: ScrollySection | null =
    didYouKnow && didYouKnow.passed && typeof didYouKnow.messageText === "string" && didYouKnow.messageText.trim().length > 0
      ? {
          id: "did-you-know",
          meta: { date: "Did you know", title: "Did you know" },
          content: {
            body: [didYouKnow.messageText.trim()],
            deepDives: [],
          },
          dashboard: {
            phaseLabel: "Did you know",
            kpis: [],
            marketSentiment: clamp(Math.round((brief.meta.confidence ?? 55)), 0, 100),
            activeRegion: "Global",
          },
        }
      : null;

  const sections: ScrollySection[] = [
    ...(didYouKnowSection ? [didYouKnowSection] : []),
    {
      id: "act-1-setup",
      meta: { date: "Today's Briefing", title: brief.actI.title },
      content: {
        body: [
          brief.actI.synthesis,
          `Coverage: ${brief.actI.totalItems} items across ${sourceCount} sources.`,
          brief.actI.topSources?.length
            ? `Top sources: ${brief.actI.topSources
                .slice(0, 6)
                .map((s) => `${s.source}: ${s.count}`)
                .join(" · ")}.`
            : "",
          brief.actI.latestItemAt ? `Latest item: ${new Date(brief.actI.latestItemAt).toLocaleString()}.` : "",
        ].filter(Boolean),
        deepDives: [],
      },
      dashboard: {
        phaseLabel: "Quick Pulse",
        kpis: [
          { label: "Items", value: brief.actI.totalItems, unit: "", color: "bg-slate-900" },
          { label: "Sources", value: sourceCount, unit: "", color: "bg-slate-600" },
        ],
        marketSentiment: clamp(Math.round((brief.meta.confidence ?? 55)), 0, 100),
        activeRegion: "Global",
      },
      dashboard_update: buildDashboardState(1),
      vizArtifact: brief.dashboard?.vizArtifact,
    },
    {
      id: "act-2-signal",
      meta: { date: "Signals", title: brief.actII.title },
      content: {
        body: [brief.actII.synthesis].filter(Boolean),
        deepDives: [],
        signals: brief.actII.signals,
      },
      dashboard: {
        phaseLabel: "Analysis",
        kpis: [
          { label: "Signals", value: brief.actII.signals.length, unit: "", color: "bg-slate-900" },
        ],
        marketSentiment: clamp(Math.round((brief.meta.confidence ?? 55)), 0, 100),
        activeRegion: "Global",
      },
      dashboard_update: buildDashboardState(2),
    },
    {
      id: "act-3-move",
      meta: { date: "Actions", title: brief.actIII.title },
      content: {
        body: [brief.actIII.synthesis, "Open the follow-ups below to review or continue the work."].filter(Boolean),
        deepDives: [],
        actions: visibleActions,
      },
      dashboard: {
        phaseLabel: "Deep Dive",
        kpis: [
          { label: "Actions", value: visibleActions.length, unit: "", color: "bg-slate-900" },
        ],
        marketSentiment: clamp(Math.round((brief.meta.confidence ?? 55)), 0, 100),
        activeRegion: "Global",
      },
      dashboard_update: buildDashboardState(3),
    },
  ];

  return sections;
}
