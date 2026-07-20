"use client";

import React from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { StickyDashboard } from "./StickyDashboard";
import { RefreshCw, AlertCircle, ChevronLeft, ChevronRight, Calendar, RotateCcw } from "lucide-react";
import type { DashboardState } from "@/features/research/types";
import { useBriefDateSelection } from "@/lib/useBriefDateSelection";
import { formatBriefDate, formatBriefDateTime } from "@/lib/briefDate";
import { buttonIcon, buttonSecondary } from "@/lib/buttonClasses";
import type { ChartDataPointContext } from "./EnhancedLineChart";

/**
 * LiveDashboard - Wrapper component that fetches live dashboard data
 * from daily brief snapshots and displays it using StickyDashboard
 *
 * Features:
 * - Auto-refresh when new data available
 * - Manual refresh button
 * - Historical data navigation (last 7 days)
 * - Date picker for specific dates
 * - "Return to Latest" button when viewing historical data
 */
export const LiveDashboard: React.FC<{
  fallbackData?: DashboardState;
  mode?: "live" | "controlled";
  /** Callback for chart data point clicks (AI agent integration) */
  onDataPointClick?: (point: ChartDataPointContext) => void;
}> = ({ fallbackData, mode = "live", onDataPointClick }) => {
  const [selectedDate, setSelectedDate] = useBriefDateSelection();
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  // Scrolly/story mode wants a stable "latest" snapshot for source summaries and
  // renders the passed-in dashboard state (progressive charts) instead.
  React.useEffect(() => {
    if (mode !== "controlled") return;
    if (selectedDate !== null) setSelectedDate(null);
  }, [mode, selectedDate, setSelectedDate]);

  // Fetch latest snapshot or specific date
  const latestSnapshot = useQuery(
    api.domains.research.dashboardQueries.getLatestDashboardSnapshot,
    selectedDate ? "skip" : {}
  );

  const dateSnapshot = useQuery(
    api.domains.research.dashboardQueries.getDashboardSnapshotByDate,
    selectedDate ? { dateString: selectedDate } : "skip"
  );

  // Fetch historical snapshots for navigation
  const historicalSnapshots = useQuery(
    api.domains.research.dashboardQueries.getHistoricalSnapshots,
    { days: 7 }
  );

  const refreshMetrics = useAction(api.domains.research.dashboardQueries.refreshDashboardMetrics);

  // Determine which snapshot to display
  const snapshot = selectedDate ? dateSnapshot : latestSnapshot;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshMetrics({});
      setSelectedDate(null); // Return to latest after refresh
    } catch (error) {
      console.error("Failed to refresh dashboard metrics:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Navigation helpers
  const availableDates = React.useMemo(() => {
    if (!historicalSnapshots) return [];
    // Deduplicate dates using Set to avoid duplicate key errors
    const uniqueDates = [...new Set(historicalSnapshots.map(s => s.dateString))];
    return uniqueDates.sort().reverse();
  }, [historicalSnapshots]);

  const currentDateIndex = React.useMemo(() => {
    if (!selectedDate || availableDates.length === 0) return -1;
    return availableDates.indexOf(selectedDate);
  }, [selectedDate, availableDates]);

  const canGoPrevious = currentDateIndex < availableDates.length - 1;
  const canGoNext = currentDateIndex > 0;

  const handlePreviousDay = () => {
    if (canGoPrevious) {
      setSelectedDate(availableDates[currentDateIndex + 1]);
    }
  };

  const handleNextDay = () => {
    if (canGoNext) {
      setSelectedDate(availableDates[currentDateIndex - 1]);
    }
  };

  const handleReturnToLatest = () => {
    setSelectedDate(null);
  };

  const isViewingHistorical = selectedDate !== null;

  // Controlled mode: always render the passed-in data (progressive charts),
  // while still showing live source summaries when available.
  if (mode === "controlled" && fallbackData) {
    const lastUpdated = snapshot?.generatedAt ? formatBriefDateTime(snapshot.generatedAt) : null;
    return (
      <div className="relative">
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="text-xs text-content-secondary font-mono">
            {lastUpdated ? <span>Latest: {lastUpdated}</span> : <span>Loading live metrics…</span>}
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={`${buttonSecondary} px-2 py-1 text-xs`}
            title="Refresh dashboard metrics"
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? "motion-safe:animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>

        <StickyDashboard data={fallbackData} onDataPointClick={onDataPointClick} />

        {/* Source summary footer */}
        {snapshot?.sourceSummary && (
          <div className="mt-2 px-3 py-2 bg-surface-secondary rounded-lg border border-edge">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs text-content-muted">
                Data Sources
              </div>
              {availableDates.length > 0 && (
                <div className="text-xs text-content-secondary">
                  {availableDates.length} day{availableDates.length !== 1 ? "s" : ""} available
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-content-secondary">
              {Object.entries(snapshot.sourceSummary.bySource || {}).map(([source, count]) => (
                <span key={source} className="flex items-center gap-1">
                  <span className="font-medium">{source}:</span>
                  <span className="text-content-secondary">{count as number}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Show loading state while fetching
  if (snapshot === undefined) {
    return (
      <div className="w-full font-mono text-content">
        <div className="sticky top-4 z-10 rounded-lg border border-edge bg-surface shadow-sm p-3">
          <div className="flex items-center justify-center h-[400px] text-content-muted">
            <div className="flex flex-col items-center gap-2">
              <RefreshCw className="w-6 h-6 motion-safe:animate-spin" />
              <span className="text-sm">Loading dashboard...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show fallback or empty state if no snapshot exists
  if (!snapshot) {
    if (fallbackData) {
      return (
        <div className="relative">
          <div className="absolute top-2 right-2 z-20">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={`${buttonSecondary} px-2 py-1 text-xs`}
              title="Generate fresh metrics"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'motion-safe:animate-spin' : ''}`} />
              <span>Generate</span>
            </button>
          </div>
          <StickyDashboard data={fallbackData} onDataPointClick={onDataPointClick} />
        </div>
      );
    }

    return (
      <div className="w-full font-mono text-content">
        <div className="sticky top-4 z-10 rounded-lg border border-edge bg-surface shadow-sm p-3">
          <div className="flex flex-col items-center justify-center h-[400px] text-content-muted gap-4">
            <AlertCircle className="w-8 h-8" />
            <div className="text-center">
              <p className="text-sm font-medium mb-1">No dashboard data available</p>
              <p className="text-xs text-content-secondary mb-4">
                Daily metrics will be generated automatically at 6:00 AM UTC
              </p>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white rounded-lg text-sm transition-colors mx-auto"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'motion-safe:animate-spin' : ''}`} />
                <span>{isRefreshing ? 'Generating...' : 'Generate Now'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Render dashboard with live data
  const lastUpdated = formatBriefDateTime(snapshot.generatedAt);
  const displayDate = selectedDate || snapshot.dateString;
  const displayDateLabel = formatBriefDate(displayDate);

  return (
    <div className="relative">
      {/* Historical Data Navigation Bar */}
      {isViewingHistorical && (
        <div className="mb-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-3 h-3 text-amber-600" />
              <span className="text-xs text-amber-800 font-medium">
                Viewing historical data: {displayDateLabel}
              </span>
            </div>
            <button
              type="button"
              onClick={handleReturnToLatest}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors"
              title="Return to latest data"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Latest</span>
            </button>
          </div>
        </div>
      )}

      {/* Header with navigation, timestamp, and refresh button */}
      <div className="flex items-center justify-between mb-2 px-1">
        {/* Left: Date Navigation */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePreviousDay}
              disabled={!canGoPrevious}
              className={buttonIcon}
              title="Previous day"
            >
              <ChevronLeft className="w-3 h-3 text-content-secondary" />
            </button>
            <button
              type="button"
              onClick={handleNextDay}
              disabled={!canGoNext}
              className={buttonIcon}
              title="Next day"
            >
              <ChevronRight className="w-3 h-3 text-content-secondary" />
            </button>
          </div>
          <div className="text-xs text-content-secondary font-mono">
            {isViewingHistorical ? (
              <span className="text-amber-600 font-medium">{displayDateLabel}</span>
            ) : (
              <span>Latest: {lastUpdated}</span>
            )}
          </div>
        </div>

        {/* Right: Refresh Button */}
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className={`${buttonSecondary} px-2 py-1 text-xs`}
          title="Refresh dashboard metrics"
        >
          <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'motion-safe:animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Dashboard component */}
      <StickyDashboard data={snapshot.dashboardMetrics} onDataPointClick={onDataPointClick} />

      {/* Source summary footer */}
      {snapshot.sourceSummary && (
        <div className="mt-2 px-3 py-2 bg-surface-secondary rounded-lg border border-edge">
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs text-content-muted">
              Data Sources
            </div>
            {availableDates.length > 0 && (
              <div className="text-xs text-content-secondary">
                {availableDates.length} day{availableDates.length !== 1 ? 's' : ''} available
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-content-secondary">
            {Object.entries(snapshot.sourceSummary.bySource || {}).map(([source, count]) => (
              <span key={source} className="flex items-center gap-1">
                <span className="font-medium">{source}:</span>
                <span className="text-content-secondary">{count as number}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Historical Date Picker */}
      {availableDates.length > 1 && (
        <div className="mt-2 px-3 py-2 bg-surface-secondary rounded-lg border border-edge">
          <div className="text-xs text-content-muted mb-2">
            Historical Data
          </div>
          <div className="flex flex-wrap gap-1">
            {availableDates.map((date) => (
              <button
                key={date}
                type="button"
                onClick={() => setSelectedDate(date === selectedDate ? null : date)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  date === displayDate
                    ? 'bg-[var(--accent-primary)] text-white font-medium'
                    : 'bg-surface hover:bg-surface-hover text-content-secondary border border-edge'
                }`}
                title={`View data from ${date}`}
              >
                {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveDashboard;
