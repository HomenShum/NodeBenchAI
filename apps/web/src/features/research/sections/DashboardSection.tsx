/**
 * DashboardSection - Right-rail dashboard metrics wrapper
 *
 * Provides:
 * - Snapshot fetching (latest + historical)
 * - Loading skeleton
 * - Error boundary isolation
 */

import React, { useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { Calendar, ChevronLeft, ChevronRight, RefreshCw, RotateCcw } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import { StickyDashboard } from "../components/StickyDashboard";
import type { ChartDataPointContext } from "../components/EnhancedLineChart";
import { useBriefDateSelection } from "@/lib/useBriefDateSelection";
import { formatBriefDate, formatBriefDateTime } from "@/lib/briefDate";
import { buttonIcon, buttonSecondary } from "@/lib/buttonClasses";
import { DashboardSkeleton } from "@/components/skeletons";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";

export interface DashboardSectionProps {
  className?: string;
  onDataPointClick?: (point: ChartDataPointContext) => void;
  historyDays?: number;
  activeAct?: "actI" | "actII" | "actIII";
}

function DashboardSectionInner({
  className = "",
  onDataPointClick,
  historyDays = 7,
  activeAct = "actI"
}: DashboardSectionProps) {
  const [selectedDate, setSelectedDate] = useBriefDateSelection();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const latestSnapshot = useQuery(
    api.domains.research.dashboardQueries.getLatestDashboardSnapshot,
    selectedDate ? "skip" : {}
  );

  const dateSnapshot = useQuery(
    api.domains.research.dashboardQueries.getDashboardSnapshotByDate,
    selectedDate ? { dateString: selectedDate } : "skip"
  );

  const historicalSnapshots = useQuery(
    api.domains.research.dashboardQueries.getHistoricalSnapshots,
    { days: historyDays }
  );

  const refreshMetrics = useAction(api.domains.research.dashboardQueries.refreshDashboardMetrics);

  // Deep wiring: Real-time agent plans
  const agentPlans = useQuery(
    api.domains.agents.agentPlanning.listPlans,
    { limit: 3 }
  );

  const workflowSteps = useMemo(() => {
    if (!agentPlans || agentPlans.length === 0) return [];
    const latestPlan = agentPlans[0];
    return latestPlan.steps || [];
  }, [agentPlans]);

  const snapshot = selectedDate ? dateSnapshot : latestSnapshot;

  const availableDates = useMemo(() => {
    if (!historicalSnapshots) return [];
    const unique = [...new Set(historicalSnapshots.map((s) => s.dateString))];
    return unique.sort().reverse();
  }, [historicalSnapshots]);

  const currentDateIndex = useMemo(() => {
    if (!selectedDate || availableDates.length === 0) return -1;
    return availableDates.indexOf(selectedDate);
  }, [selectedDate, availableDates]);

  const canGoPrevious = currentDateIndex < availableDates.length - 1;
  const canGoNext = currentDateIndex > 0;

  const handlePreviousDay = () => {
    if (!canGoPrevious) return;
    setSelectedDate(availableDates[currentDateIndex + 1]);
  };

  const handleNextDay = () => {
    if (!canGoNext) return;
    setSelectedDate(availableDates[currentDateIndex - 1]);
  };

  const handleReturnToLatest = () => {
    setSelectedDate(null);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshMetrics({});
      setSelectedDate(null);
    } catch (error) {
      console.error("Failed to refresh dashboard metrics:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  if (snapshot === undefined) {
    return (
      <div className={className}>
        <DashboardSkeleton />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className={`${className} p-4`}>
        <div className="rounded-lg border border-edge bg-surface p-6 text-center">
          <div className="text-sm font-medium text-content mb-1">No dashboard data yet</div>
          <div className="text-xs text-content-secondary mb-4">Search for a company or run a briefing to populate your dashboard.</div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={`${buttonSecondary} px-3 py-2 text-xs`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "motion-safe:animate-spin" : ""}`} />
            <span>Generate now</span>
          </button>
        </div>
      </div>
    );
  }

  const isViewingHistorical = selectedDate !== null;
  const displayDate = selectedDate ?? snapshot.dateString;
  const displayDateLabel = displayDate ? formatBriefDate(displayDate) : "Latest";
  const lastUpdated = snapshot.generatedAt ? formatBriefDateTime(snapshot.generatedAt) : null;

  return (
    <div className={className}>
      {isViewingHistorical && (
        <div className="mb-2 px-3 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
              <span className="text-xs text-content font-medium">
                Viewing historical data: {displayDateLabel}
              </span>
            </div>
            <button
              type="button"
              onClick={handleReturnToLatest}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white rounded transition-colors"
              title="Return to latest data"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Latest</span>
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-2 px-1">
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
              <span className="text-indigo-600 dark:text-indigo-400 font-medium">{displayDateLabel}</span>
            ) : (
              <span>{lastUpdated ? `Latest: ${lastUpdated}` : "Latest"}</span>
            )}
          </div>
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

      <StickyDashboard
        data={snapshot.dashboardMetrics}
        onDataPointClick={onDataPointClick}
        activeAct={activeAct}
        workflowSteps={workflowSteps}
      />

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
                className={`px-2 py-1 text-xs rounded transition-colors ${date === displayDate
                    ? "bg-[var(--accent-primary)] text-white font-medium"
                    : "bg-surface hover:bg-surface-hover text-content-secondary border border-edge"
                  }`}
                title={`View data from ${date}`}
              >
                {new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function DashboardSection(props: DashboardSectionProps) {
  return (
    <ErrorBoundary section="Dashboard">
      <DashboardSectionInner {...props} />
    </ErrorBoundary>
  );
}

export default DashboardSection;

