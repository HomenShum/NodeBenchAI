"use client";

import React, { useState, useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import {
  BarChart3,
  FileText,
  TrendingUp,
  Eye,
  MousePointerClick,
  Percent,
  Clock,
  Activity,
  Calendar,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from 'lucide-react';
import { normalizeSourceLabel } from '@/lib/displayText';
import { PageHeroHeader } from '@/shared/ui/PageHeroHeader';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  accent?: boolean;
  trend?: {
    value: number;
    direction: 'up' | 'down' | 'neutral';
  };
}

const INTEGER_FORMATTER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const ONE_DECIMAL_FORMATTER = new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

function formatInteger(value: number): string {
  return INTEGER_FORMATTER.format(Math.round(value));
}

function formatPercent(value: number): string {
  return `${ONE_DECIMAL_FORMATTER.format(value)}%`;
}

function formatDisplayDate(value?: string): string {
  if (!value) return "Latest";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return DATE_FORMATTER.format(date);
}

function MetricCard({ title, value, subtitle, icon, accent, trend }: MetricCardProps) {
  const trendTone =
    trend?.direction === 'up'
      ? 'text-primary'
      : trend?.direction === 'down'
        ? 'text-content-secondary'
        : 'text-content-muted';
  const TrendIcon =
    trend?.direction === 'up' ? ChevronUp : trend?.direction === 'down' ? ChevronDown : Activity;

  return (
    <div
      className={`nb-surface-card p-4 transition-colors hover:border-content-muted/30${accent ? ' border-l-2 border-l-primary bg-surface-secondary/30' : ''}`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="text-xs font-medium text-content-secondary">{title}</div>
        <div className={accent ? 'text-primary' : 'text-content-secondary'}>{icon}</div>
      </div>
      <div className="text-2xl font-semibold mb-1 text-content">{value}</div>
      {subtitle && <div className="text-xs text-content-secondary">{subtitle}</div>}
      {trend && (
        <div className={`flex items-center gap-1 text-xs mt-2 ${trendTone}`}>
          <TrendIcon size={14} />
          <span>{Math.abs(trend.value)}%</span>
        </div>
      )}
    </div>
  );
}

interface SourcePerformanceBarProps {
  sourceName: string;
  itemCount: number;
  maxCount: number;
  totalCount?: number;
  clicks?: number;
  impressions?: number;
  ctr?: number;
}

function normalizeSourceKey(sourceName: string) {
  const raw = normalizeSourceLabel(String(sourceName ?? "").trim(), "").trim();
  if (!raw) return "";
  return raw.toLowerCase();
}

function formatSourceLabel(sourceName: string) {
  const raw = String(sourceName ?? "").trim();
  if (!raw) return "Unknown";
  const normalizedBrand = normalizeSourceLabel(raw, "Unknown");
  if (normalizedBrand !== raw) return normalizedBrand;

  const lower = raw.toLowerCase();
  const roundMap: Record<string, string> = {
    "series-a": "Series A",
    "series-b": "Series B",
    "series-c": "Series C",
    "series-d": "Series D",
    "series-d-plus": "Series D+",
    "seed": "Seed",
    "pre-seed": "Pre-seed",
  };
  if (roundMap[lower]) return roundMap[lower];

  if (lower === "unknown") return "Unknown";

  const acronyms = new Set(["ai", "ml", "ui", "ux", "api", "mcp", "qa", "gpu", "slo"]);
  const parts = raw.split(/[_-]+/g).filter(Boolean);
  if (parts.length <= 1) return raw.charAt(0).toUpperCase() + raw.slice(1);
  return parts
    .map((p) => {
      const pl = p.toLowerCase();
      if (acronyms.has(pl)) return pl.toUpperCase();
      return pl.charAt(0).toUpperCase() + pl.slice(1);
    })
    .join(" ");
}

function SourcePerformanceBar({
  sourceName,
  itemCount,
  maxCount,
  totalCount = 0,
  clicks = 0,
  impressions = 0,
  ctr = 0,
}: SourcePerformanceBarProps) {
  const percentage = maxCount > 0 ? (itemCount / maxCount) * 100 : 0;
  const ofTotal = totalCount > 0 ? (itemCount / totalCount) * 100 : 0;
  const title = `${formatSourceLabel(sourceName)} — ${formatInteger(itemCount)} ${itemCount === 1 ? "item" : "items"} (${formatPercent(ofTotal)} of total)`;

  return (
    <div className="group -mx-2 px-2 py-2 rounded-md border-b border-edge last:border-0 hover:bg-surface-hover/50 transition-colors" title={title}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-medium text-content-secondary truncate flex-1">
          {formatSourceLabel(sourceName)}
        </div>
        <div className="flex items-center gap-3 text-xs text-content-secondary whitespace-nowrap shrink-0">
          <span className="font-mono">{formatInteger(itemCount)} {itemCount === 1 ? 'item' : 'items'}</span>
          {impressions > 0 && (
            <>
              <span className="text-content-muted">|</span>
              <span className="flex items-center gap-1">
                <Eye size={12} />
                {formatInteger(impressions)}
              </span>
            </>
          )}
          {clicks > 0 && (
            <>
              <span className="text-content-muted">|</span>
              <span className="flex items-center gap-1">
                <MousePointerClick size={12} />
                {formatInteger(clicks)}
              </span>
            </>
          )}
          {ctr > 0 && (
            <>
              <span className="text-content-muted">|</span>
              <span className="font-semibold text-primary">
                {formatPercent(ctr * 100)} CTR
              </span>
            </>
          )}
        </div>
      </div>
      <div className="h-2 bg-surface-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-primary/80 rounded-full transition-all duration-500 group-hover:bg-primary"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

interface CategoryBreakdownProps {
  category: string;
  itemCount: number;
  percentage: number;
  avgReadTime?: number;
}

function formatCategoryLabel(category: string | undefined | null) {
  const raw = String(category ?? "").trim();
  if (!raw) return "";

  if (raw.toLowerCase() === "ai_ml") return "AI & ML";

  const acronyms = new Set(["ai", "ml", "ui", "ux", "api", "mcp", "qa", "gpu", "slo"]);
  const parts = raw.split(/[_-]+/g).filter(Boolean);
  return parts
    .map((part) => {
      const lower = part.toLowerCase();
      if (acronyms.has(lower)) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function CategoryBreakdown({ category, itemCount, percentage, avgReadTime }: CategoryBreakdownProps) {
  const label = formatCategoryLabel(category) || category;
  return (
    <div className="flex items-center justify-between py-2 border-b border-edge last:border-0">
      <div className="flex-1">
        <div className="text-sm font-medium text-content-secondary" title={category}>{label}</div>
        <div className="flex items-center gap-2 mt-1">
          <div className="h-1.5 bg-surface-secondary rounded-full flex-1 max-w-[100px]">
            <div
              className="h-full bg-primary/70 rounded-full"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <span className="text-xs text-content-secondary">{percentage.toFixed(0)}%</span>
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-content-secondary">
        <span className="font-mono">{formatInteger(itemCount)} {itemCount === 1 ? 'item' : 'items'}</span>
        {avgReadTime && avgReadTime > 0 && (
          <>
            <span className="text-content-muted">|</span>
            <span className="flex items-center gap-1">
              <Clock size={12} />
              {formatInteger(avgReadTime)} sec
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export default function ComponentMetricsDashboard() {
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [dateRange, setDateRange] = useState<number>(7); // Last 7 days

  // Query metrics for selected date
  const todayMetrics = useQuery(
    api.domains.analytics.componentMetrics.getComponentMetricsByDate,
    { date: selectedDate }
  );

  // Query top performing sources
  const startDate = useMemo(() => {
    const date = new Date(selectedDate);
    date.setDate(date.getDate() - dateRange);
    return date.toISOString().split('T')[0];
  }, [selectedDate, dateRange]);

  const topSources = useQuery(
    api.domains.analytics.componentMetrics.getTopPerformingSources,
    {
      startDate,
      endDate: selectedDate,
      limit: 10,
    }
  );

  // Calculate aggregate metrics
  const aggregates = useMemo(() => {
    if (!todayMetrics) return null;

    const totalItems = todayMetrics.reduce((sum: number, m: any) => sum + m.itemCount, 0);
    const totalImpressions = todayMetrics.reduce((sum: number, m: any) => sum + (m.impressions || 0), 0);
    const totalClicks = todayMetrics.reduce((sum: number, m: any) => sum + (m.clicks || 0), 0);
    const avgCTR = totalImpressions > 0 ? totalClicks / totalImpressions : 0;

    const metricsWithReadTime = todayMetrics.filter((m: any) => m.avgReadTimeSeconds && m.avgReadTimeSeconds > 0);
    const avgReadTime = metricsWithReadTime.length > 0
      ? metricsWithReadTime.reduce((sum: number, m: any) => sum + (m.avgReadTimeSeconds || 0), 0) / metricsWithReadTime.length
      : 0;

    const uniqueSources = new Set(todayMetrics.map((m: any) => m.sourceName)).size;
    const uniqueReportTypes = new Set(todayMetrics.map((m: any) => m.reportType)).size;

    return {
      totalItems,
      totalImpressions,
      totalClicks,
      avgCTR,
      avgReadTime,
      uniqueSources,
      uniqueReportTypes,
    };
  }, [todayMetrics]);

  // Group metrics by source for chart
  const sourceMetrics = useMemo(() => {
    if (!todayMetrics) return [];

    const grouped = new Map<string, {
      sourceName: string;
      itemCount: number;
      impressions: number;
      clicks: number;
      ctr: number;
    }>();

    for (const metric of todayMetrics) {
      const key = normalizeSourceKey(metric.sourceName);
      if (key === "all sources") continue; // Avoid confusing aggregate rows in the per-source leaderboard.
      const existing = grouped.get(key) || {
        sourceName: formatSourceLabel(metric.sourceName),
        itemCount: 0,
        impressions: 0,
        clicks: 0,
        ctr: 0,
      };

      existing.itemCount += metric.itemCount;
      existing.impressions += metric.impressions || 0;
      existing.clicks += metric.clicks || 0;

      grouped.set(key, existing);
    }

    // Calculate CTR for each source
    for (const [, source] of grouped) {
      source.ctr = source.impressions > 0 ? source.clicks / source.impressions : 0;
    }

    return Array.from(grouped.values())
      .sort((a, b) => b.itemCount - a.itemCount);
  }, [todayMetrics]);

  // Group metrics by category
  const categoryMetrics = useMemo(() => {
    if (!todayMetrics) return [];

    const grouped = new Map<string, {
      category: string;
      itemCount: number;
      avgReadTime: number;
      recordCount: number;
    }>();

    for (const metric of todayMetrics) {
      if (!metric.category) continue;

      const existing = grouped.get(metric.category) || {
        category: metric.category,
        itemCount: 0,
        avgReadTime: 0,
        recordCount: 0,
      };

      existing.itemCount += metric.itemCount;
      if (metric.avgReadTimeSeconds && metric.avgReadTimeSeconds > 0) {
        existing.avgReadTime += metric.avgReadTimeSeconds;
        existing.recordCount++;
      }

      grouped.set(metric.category, existing);
    }

    const total = Array.from(grouped.values()).reduce((sum, c) => sum + c.itemCount, 0);

    return Array.from(grouped.values())
      .map(c => ({
        ...c,
        percentage: total > 0 ? (c.itemCount / total) * 100 : 0,
        avgReadTime: c.recordCount > 0 ? c.avgReadTime / c.recordCount : 0,
      }))
      .sort((a, b) => b.itemCount - a.itemCount);
  }, [todayMetrics]);

  const maxSourceCount = sourceMetrics.length > 0
    ? Math.max(...sourceMetrics.map(s => s.itemCount))
    : 0;

  const isLoading = todayMetrics === undefined || topSources === undefined;
  const selectedDateLabel = formatDisplayDate(selectedDate);

  return (
    <div className="nb-page-shell">
      <div className="nb-page-inner">
        <div className="nb-page-frame space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <PageHeroHeader
            icon={<BarChart3 size={24} />}
            title="Performance Analytics"
            subtitle="Component-level report performance across sources"
          />

          <div className="flex items-center gap-3 shrink-0 mt-1">
            {/* Date Selector */}
            <div className="flex items-center gap-2">
              <Calendar size={18} className="text-content-muted" />
              <div className="relative">
                {/* NOTE(coworker): Keep one date format across this view to avoid QA churn. */}
                <span className="px-3 py-2 text-sm text-content-secondary border border-edge rounded-lg bg-surface inline-block min-w-[160px]">
                  {formatDisplayDate(selectedDate || new Date().toISOString().split('T')[0])}
                </span>
                <input
                  type="date"
                  value={selectedDate}
                  aria-label="Select date"
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full"
                />
              </div>
            </div>

            {/* Range Selector */}
            <select
              value={dateRange}
              onChange={(e) => setDateRange(Number(e.target.value))}
              className="px-3 py-2 border border-edge bg-surface text-content-secondary rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value={1}>Last 24 hours</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
            </select>

            <button
              onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
              className="p-2 border border-edge rounded-lg hover:bg-surface-hover transition-colors"
              title="Go to today"
            >
              <RefreshCw size={18} className="text-content-secondary" />
            </button>
          </div>
        </div>

        {/* Loading state - skeleton grid */}
        {isLoading && (
          <div className="space-y-6 no-skeleton-animation" aria-busy="true" aria-live="polite">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-28 rounded-lg bg-surface-secondary/50" />
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="h-64 rounded-lg bg-surface-secondary/50" />
              <div className="h-64 rounded-lg bg-surface-secondary/50" />
            </div>
            <div className="h-48 rounded-lg bg-surface-secondary/50" />
          </div>
        )}

        {/* Metrics Content */}
        {!isLoading && aggregates && (
          <>
            {/* Overview Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                title="Total Items"
                value={formatInteger(aggregates.totalItems)}
                subtitle={aggregates.uniqueSources === 0 ? 'No sources yet' : `from ${aggregates.uniqueSources} ${aggregates.uniqueSources === 1 ? 'source' : 'sources'}`}
                icon={<FileText size={20} />}
                accent={aggregates.totalItems > 0}
              />

              <MetricCard
                title="Impressions"
                value={formatInteger(aggregates.totalImpressions > 0 ? aggregates.totalImpressions : 0)}
                subtitle={aggregates.totalImpressions > 0 ? 'Across selected range' : 'No views recorded yet'}
                icon={<Eye size={20} />}
                accent={aggregates.totalImpressions > 0}
              />

              <MetricCard
                title="Click-Through Rate"
                value={aggregates.avgCTR > 0 ? formatPercent(aggregates.avgCTR * 100) : '0%'}
                subtitle={aggregates.totalClicks > 0 ? `${formatInteger(aggregates.totalClicks)} tracked clicks` : 'No click data yet'}
                icon={<Percent size={20} />}
              />

              <MetricCard
                title="Avg Read Time"
                value={aggregates.avgReadTime > 0 ? `${formatInteger(aggregates.avgReadTime)} sec` : '0 sec'}
                subtitle={aggregates.avgReadTime > 0 ? 'Per engaged source' : 'No read sessions recorded yet'}
                icon={<Clock size={20} />}
              />
            </div>

            {/* Source Performance */}
            <div className="nb-surface-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-content">
                  Source Performance
                </h2>
                <span className="text-sm text-content-secondary">
                  {selectedDateLabel}
                </span>
              </div>

              {sourceMetrics.length === 0 ? (
                <div className="text-center py-8 text-content-secondary">
                  No source data available for {selectedDateLabel}
                </div>
              ) : (
                <div className="space-y-1">
                  {sourceMetrics.map((source) => (
                    <SourcePerformanceBar
                      key={source.sourceName}
                      sourceName={source.sourceName}
                      itemCount={source.itemCount}
                      maxCount={maxSourceCount}
                      totalCount={aggregates?.totalItems ?? 0}
                      clicks={source.clicks}
                      impressions={source.impressions}
                      ctr={source.ctr}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Two Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Category Breakdown */}
              <div className="nb-surface-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-content">
                    Category Breakdown
                  </h2>
                  <span className="text-sm text-content-secondary">
                    {categoryMetrics.length === 0 ? 'No categories' : `${categoryMetrics.length} ${categoryMetrics.length === 1 ? 'category' : 'categories'}`}
                  </span>
                </div>

                {categoryMetrics.length === 0 ? (
                  <div className="text-center py-8 text-content-secondary">
                    No category data available for {selectedDateLabel}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {categoryMetrics.slice(0, 10).map((category) => (
                      <CategoryBreakdown
                        key={category.category}
                        category={category.category}
                        itemCount={category.itemCount}
                        percentage={category.percentage}
                        avgReadTime={category.avgReadTime}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Top Performers (Last 7 Days) */}
              <div className="nb-surface-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-content">
                    Top Performers
                  </h2>
                  <span className="text-sm text-content-secondary">
                    Last {dateRange} days
                  </span>
                </div>

                {!topSources || topSources.length === 0 ? (
                  <div className="text-center py-8 text-content-secondary">
                    No performance data available
                  </div>
                ) : (
                  <div className="space-y-3">
                    {topSources.map((source: any, index: number) => (
                      <div
                        key={source.sourceName}
                        className="flex items-center justify-between p-3 bg-surface-secondary rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`
                            flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm
                            ${index === 0
                                ? 'bg-primary/10 text-primary border border-primary/30'
                                : index === 1
                                  ? 'bg-surface border border-edge text-content-secondary'
                                  : index === 2
                                    ? 'bg-surface-secondary border border-edge text-content-secondary'
                                    : 'bg-surface-secondary text-content-secondary'}
                          `}>
                            {index + 1}
                          </div>
                          <div>
                            <div className="font-medium text-content">
                              {formatSourceLabel(source.sourceName)}
                            </div>
                            <div className="text-xs text-content-secondary">
                              {formatInteger(source.totalItems)} {source.totalItems === 1 ? 'item' : 'items'} • {formatInteger(source.recordCount)} {source.recordCount === 1 ? 'record' : 'records'}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          {source.avgCTR > 0 && (
                            <div className="text-sm font-semibold text-primary">
                              {formatPercent(source.avgCTR * 100)} CTR
                            </div>
                          )}
                          {source.avgEngagement > 0 && (
                            <div className="text-xs text-content-secondary">
                              {formatInteger(source.avgEngagement)} engagement
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Integration Status Banner */}
            {aggregates.totalImpressions === 0 && (
              <div className="nb-surface-card border-primary/20 bg-primary/10 p-4">
                <div className="flex items-start gap-3">
                  <TrendingUp className="text-primary mt-0.5" size={20} />
                  <div>
                    <h3 className="font-semibold text-content mb-1">
                      Engagement Tracking Not Yet Active
                    </h3>
                    <p className="text-sm text-content-secondary mb-2">
                      Component metrics are being collected, but user engagement tracking (impressions, clicks, CTR)
                      is not yet integrated. See{' '}
                      <a
                        href="/docs/engagement-tracking"
                        className="underline font-medium hover:text-content"
                      >
                        integration guide
                      </a>
                      {' '}to enable full analytics.
                    </p>
                    <div className="text-xs text-content-muted">
                      Expected metrics after integration: Impressions, Clicks, CTR, Avg Read Time
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  );
}

