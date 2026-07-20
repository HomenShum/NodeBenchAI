"use node";

import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { DashboardState, KeyStat, CapabilityEntry, MarketShareSegment } from "../../../src/features/research/types";
import { createHash } from "crypto";

/**
 * Calculate dashboard metrics from aggregated feed data
 * This runs daily to populate the StickyDashboard with fresh data
 */
export const calculateDashboardMetrics = internalAction({
  args: {},
  handler: async (ctx): Promise<{ dashboardMetrics: DashboardState; sourceSummary: any }> => {
    const startTime = Date.now();

    // Fetch recent feed items (last 24 hours)
    const feedItems = await ctx.runQuery(internal.domains.research.dashboardQueries.getFeedItemsForMetrics);

    const sourceSummary = calculateSourceSummary(feedItems);
    
    // Calculate various metrics
    const currentDate = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const timelineProgress = calculateTimelineProgress();
    
    // Calculate capability scores based on feed content
    const capabilities = calculateCapabilities(feedItems);
    
    // Calculate key stats from feed data
    const keyStats = calculateKeyStats(feedItems);
    
    // Calculate market share distribution
    const marketShare = calculateMarketShare(feedItems);
    
    // Calculate tech readiness buckets
    const techReadiness = calculateTechReadiness(feedItems);
    
    // Generate trend line data
    const trendLine = await generateTrendLineData(ctx, feedItems);
    
    // Calculate agent count metrics
    const agentCount = calculateAgentCount(feedItems);
    
    const processingTime = Date.now() - startTime;
    console.log(`[dashboardMetrics] Calculated metrics in ${processingTime}ms`);
    
    const dashboardMetrics: DashboardState = {
      meta: {
        currentDate,
        timelineProgress,
      },
      charts: {
        trendLine,
        marketShare,
      },
      techReadiness,
      keyStats,
      capabilities,
      agentCount,
    };

    return { dashboardMetrics, sourceSummary };
  },
});

// ============================================================================
// Helper Functions for Metric Calculations
// ============================================================================

function calculateTimelineProgress(): number {
  // Calculate progress through 2025 (0.0 to 1.0)
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1);
  const progress = (now.getTime() - yearStart.getTime()) / (yearEnd.getTime() - yearStart.getTime());
  return Math.min(Math.max(progress, 0), 1);
}

function calculateSourceSummary(feedItems: any[]) {
  // Initialize expected sources with 0 so they always appear
  // Include both original sources AND new RSS funding sources
  const bySource: Record<string, number> = {
    GitHub: 0,
    ArXiv: 0,
    HackerNews: 0,
    Reddit: 0,
    "Dev.to": 0,
    YCombinator: 0,
    // Enhanced RSS funding sources
    "TechCrunch Venture": 0,
    "TechCrunch Startups": 0,
    "VentureBeat Deals": 0,
    FierceBiotech: 0,
    "BioPharma Dive": 0,
    TechCrunch: 0, // General TechCrunch feed
    "Ars Technica": 0,
    Wired: 0,
  };
  const byCategory: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};

  for (const item of feedItems) {
    const source = item.source || "Unknown";
    bySource[source] = (bySource[source] || 0) + 1;

    const category = item.category || "uncategorized";
    byCategory[category] = (byCategory[category] || 0) + 1;

    const tags: string[] = Array.isArray(item.tags) ? item.tags : [];
    for (const tag of tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  const topTrending = Object.entries(tagCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([tag]) => tag);

  return {
    totalItems: feedItems.length,
    bySource,
    byCategory,
    topTrending,
  };
}

function calculateCapabilities(feedItems: any[]): CapabilityEntry[] {
  // Calculate capability scores based on feed content topics
  const aiMlCount = feedItems.filter(item => 
    item.category === 'ai_ml' || /ai|ml|llm|gpt|model/i.test(item.title)
  ).length;
  
  const securityCount = feedItems.filter(item =>
    /security|vulnerability|cve|hack/i.test(item.title)
  ).length;
  
  const uptimeCount = feedItems.filter(item =>
    /outage|downtime|reliability|uptime/i.test(item.title)
  ).length;
  
  // Normalize scores to 0-100 range
  const total = feedItems.length || 1;

  const toPercent = (value: number) => Math.round(Math.max(0, Math.min(value, 1)) * 100);

  return [
    { label: "Reasoning", score: toPercent(Math.min((aiMlCount / total) * 2, 1)), icon: "brain" },
    { label: "Uptime", score: toPercent(Math.max(1 - (uptimeCount / total) * 3, 0.5)), icon: "activity" },
    { label: "Safety", score: toPercent(Math.max(1 - (securityCount / total) * 3, 0.6)), icon: "lock" },
  ];
}

function calculateKeyStats(feedItems: any[]): KeyStat[] {
  // Calculate key statistics from feed data
  const fundingItems = feedItems.filter(item =>
    /funding|raise|series|valuation|\$\d+/i.test(item.title)
  );

  const outageItems = feedItems.filter(item =>
    /outage|downtime|failure/i.test(item.title)
  );

  const aiItems = feedItems.filter(item =>
    item.category === 'ai_ml' || /ai|ml|llm/i.test(item.title)
  );

  // Calculate "gap width" as a proxy for AI capability vs deployment gap
  const gapWidth = Math.max(45 - (aiItems.length * 2), 20);

  // Calculate fail rate from outage mentions
  const failRate = Math.min((outageItems.length / feedItems.length) * 100, 25);

  // Estimate latency trend
  const avgLatency = 2.4 - (aiItems.length * 0.05);

  return [
    {
      label: "AI Topics",
      value: `${aiItems.length}`,
      context: gapWidth > 35 ? "Low signal" : "In your feed",
      trend: gapWidth > 35 ? "down" : "up",
    },
    {
      label: "Alert Rate",
      value: `${failRate.toFixed(1)}%`,
      context: "Outage mentions",
      trend: failRate > 15 ? "down" : "up",
    },
    {
      label: "Speed",
      value: `${avgLatency.toFixed(1)}s`,
      trend: avgLatency < 2.0 ? "up" : "down",
    },
  ];
}

function calculateMarketShare(feedItems: any[]): MarketShareSegment[] {
  // Calculate market share distribution by source
  const sourceCounts: Record<string, number> = {};

  feedItems.forEach(item => {
    sourceCounts[item.source] = (sourceCounts[item.source] || 0) + 1;
  });

  const total = feedItems.length || 1;
  const topSources = Object.entries(sourceCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);

  const colors = ["black", "gray", "accent"];

  return topSources.map(([source, count], index) => ({
    label: source,
    value: Math.round((count / total) * 100),
    color: colors[index] || "gray",
  }));
}

function calculateTechReadiness(feedItems: any[]): { existing: number; emerging: number; sciFi: number } {
  // Categorize items into tech readiness buckets
  const existing = feedItems.filter(item =>
    /production|deployed|available|launch/i.test(item.title)
  ).length;

  const emerging = feedItems.filter(item =>
    /beta|preview|experimental|research/i.test(item.title)
  ).length;

  const sciFi = feedItems.filter(item =>
    /future|agi|quantum|breakthrough/i.test(item.title)
  ).length;

  const total = feedItems.length || 1;

  return {
    existing: Math.round((existing / total) * 10),
    emerging: Math.round((emerging / total) * 10),
    sciFi: Math.round((sciFi / total) * 10),
  };
}

function evidenceIdForUrl(url: string): string {
  const canonical = (url || "").trim();
  return `ev-${createHash("sha256").update(canonical).digest("hex").slice(0, 12)}`;
}

function buildDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function generateTrendLineData(_ctx: any, feedItems: any[]): Promise<any> {
  const windowDays = 7;
  const today = new Date();
  const start = new Date();
  start.setDate(today.getDate() - (windowDays - 1));

  const dayBuckets = new Map<string, any[]>();
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dayBuckets.set(buildDateKey(d), []);
  }

  feedItems.forEach((item) => {
    if (!item.publishedAt) return;
    const dateKey = buildDateKey(new Date(item.publishedAt));
    if (dayBuckets.has(dateKey)) {
      dayBuckets.get(dateKey)?.push(item);
    }
  });

  const xAxisLabels = Array.from(dayBuckets.keys()).map(formatLabel);
  const dailyStats = Array.from(dayBuckets.entries()).map(([dateKey, items]) => {
    const total = items.length || 1;
    const aiItems = items.filter((item) =>
      item.category === "ai_ml" || /ai|model|llm|agent/i.test(item.title),
    );
    const outageItems = items.filter((item) => /outage|downtime|failure|cve/i.test(item.title));
    const avgScore =
      items.reduce((sum, item) => sum + (item.score ?? 0), 0) / total;
    const aiScore =
      aiItems.length > 0
        ? aiItems.reduce((sum, item) => sum + (item.score ?? 0), 0) / aiItems.length
        : avgScore;
    const outageRatio = outageItems.length / total;
    const evidenceIds = items
      .map((item) => (item.url ? evidenceIdForUrl(item.url) : null))
      .filter(Boolean) as string[];
    return {
      dateKey,
      avgScore,
      aiScore,
      outageRatio,
      evidenceIds: Array.from(new Set(evidenceIds)),
      topItem: items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0],
    };
  });

  const maxScore = Math.max(1, ...dailyStats.map((d) => d.avgScore));
  const scale = (value: number) => Math.min(100, Math.round((value / maxScore) * 100));

  const capabilitySeries = dailyStats.map((day) => ({
    value: scale(day.aiScore),
    linkedEvidenceIds: day.evidenceIds,
  }));
  const reliabilitySeries = dailyStats.map((day) => ({
    value: Math.max(10, Math.round(100 - day.outageRatio * 100)),
    linkedEvidenceIds: day.evidenceIds,
  }));

  const annotations = dailyStats
    .filter((day) => day.topItem?.title)
    .slice(-3)
    .map((day, idx) => ({
      id: `ann-${idx}-${day.dateKey}`,
      title: day.topItem.title,
      description: day.topItem.summary ?? "Notable signal.",
      targetIndex: dailyStats.findIndex((d) => d.dateKey === day.dateKey),
      sentiment: /outage|cve|breach/i.test(day.topItem.title) ? "negative" : "neutral",
    }));

  const deltaValue = capabilitySeries.length > 1
    ? capabilitySeries[capabilitySeries.length - 1].value - capabilitySeries[capabilitySeries.length - 2].value
    : 0;

  return {
    title: "Capability vs. Reliability Index",
    xAxisLabels,
    series: [
      {
        id: "model-capability",
        label: "Model Capability",
        type: "ghost" as const,
        color: "gray",
        data: capabilitySeries,
      },
      {
        id: "infra-reliability",
        label: "Infra Reliability",
        type: "solid" as const,
        color: "accent",
        data: reliabilitySeries,
      },
    ],
    visibleEndIndex: xAxisLabels.length - 1,
    presentIndex: xAxisLabels.length - 1,
    annotations,
    gridScale: { min: 0, max: 100 },
    yAxisUnit: "pts",
    timeWindow: "Last 7 days",
    delta: {
      value: deltaValue,
      label: "vs prior day",
      direction: deltaValue > 0 ? "up" : deltaValue < 0 ? "down" : "flat",
    },
  };
}

function calculateAgentCount(feedItems: any[]): { count: number; label: string; speed: number } {
  // Calculate agent count based on AI/ML activity
  const aiItems = feedItems.filter(item =>
    item.category === 'ai_ml' || /ai|ml|agent|llm/i.test(item.title)
  );

  // Scale agent count based on activity level
  const baseCount = 12500;
  const activityMultiplier = Math.min(aiItems.length / 10, 8);
  const count = Math.round(baseCount * (1 + activityMultiplier));

  // Determine agent reliability tier
  let label = "Unreliable Agent";
  let speed = 2;

  if (count > 50000) {
    label = "Autonomous Agent";
    speed = 20;
  } else if (count > 25000) {
    label = "Reliable Agent";
    speed = 10;
  }

  return { count, label, speed };
}
