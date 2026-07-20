"use client";

/**
 * WhatChangedPanel Component
 *
 * Displays recent changes detected in authoritative sources.
 * Part of the Knowledge Product Layer (Phase 1).
 *
 * Features:
 * - Fetches recent diffs from source registry
 * - Filters by severity, domain, or time range
 * - Integrates with ChangeCard for individual change display
 */

import React, { useEffect, useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import {
  Bell,
  AlertTriangle,
  Clock,
  Filter,
  RefreshCw,
  Zap,
  BookOpen,
} from "lucide-react";
import {
  ChangeCard,
  ChangeCardList,
  ChangeListItem,
  type SourceDiff,
  type Severity,
  type SourceInfo,
} from "./ChangeCard";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface WhatChangedPanelProps {
  /** Maximum number of diffs to display */
  limit?: number;
  /** Filter by severity */
  severityFilter?: Severity;
  /** Filter by domain (e.g., "anthropic", "openai") */
  domainFilter?: string;
  /** Time range in days (default: 7) */
  daysBack?: number;
  /** Show header with stats */
  showHeader?: boolean;
  /** Compact mode for embedding */
  compact?: boolean;
  /** Callback when user clicks to view source */
  onViewSource?: (url: string) => void;
  /** Optional callback to open an agent with context */
  onAskAgent?: (input: { prompt: string; urls?: string[] }) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Components
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Filter bar for severity and time range
 */
function FilterBar({
  severity,
  onSeverityChange,
  daysBack,
  onDaysBackChange,
}: {
  severity: Severity | "all";
  onSeverityChange: (s: Severity | "all") => void;
  daysBack: number;
  onDaysBackChange: (d: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Severity Filter */}
      <div className="flex items-center gap-1.5">
        <Filter className="w-3.5 h-3.5 text-content-muted" />
        <select
          value={severity}
          onChange={(e) => onSeverityChange(e.target.value as Severity | "all")}
          className="text-xs bg-surface-secondary border border-edge rounded px-2 py-1 text-content-secondary focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Time Range Filter */}
      <div className="flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5 text-content-muted" />
        <select
          value={daysBack}
          onChange={(e) => onDaysBackChange(parseInt(e.target.value))}
          className="text-xs bg-surface-secondary border border-edge rounded px-2 py-1 text-content-secondary focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value={1}>Last 24 hours</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>
    </div>
  );
}

/**
 * Stats summary bar
 */
function StatsBar({
  total,
  critical,
  high,
  medium,
  low,
}: {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <div className="flex items-center gap-1.5 text-content-muted">
        <Zap className="w-3.5 h-3.5" />
        <span>{total} changes</span>
      </div>
      {critical > 0 && (
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
          <AlertTriangle className="w-3 h-3" />
          <span>{critical} critical</span>
        </div>
      )}
      {high > 0 && (
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">
          <span>{high} high</span>
        </div>
      )}
      {medium > 0 && (
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
          <span>{medium} medium</span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════

export function WhatChangedPanel({
  limit = 20,
  severityFilter,
  domainFilter,
  daysBack = 7,
  showHeader = true,
  compact = false,
  onViewSource,
  onAskAgent,
}: WhatChangedPanelProps) {
  // Local filter state
  const [selectedSeverity, setSelectedSeverity] = useState<Severity | "all">(severityFilter ?? "all");
  const [selectedDaysBack, setSelectedDaysBack] = useState(daysBack);
  const [selectedDiffId, setSelectedDiffId] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<
    | { status: "idle" }
    | { status: "running" }
    | { status: "done"; message: string }
    | { status: "error"; message: string }
  >({ status: "idle" });

  const refreshSummary = useQuery(api.domains.knowledge.sourceDiffs.getRefreshSummary, {});
  const refreshSourcesNow = useAction(api.domains.knowledge.sourceDiffs.refreshSourcesNow);

  // Calculate time cutoff
  const sinceTime = useMemo(() => {
    return Date.now() - selectedDaysBack * 24 * 60 * 60 * 1000;
  }, [selectedDaysBack]);

  // Fetch diffs from Convex
  const diffsData = useQuery(api.domains.knowledge.sourceDiffs.getAllRecentDiffs, {
    limit,
    severityFilter: selectedSeverity === "all" ? undefined : selectedSeverity,
    sinceTime,
  });

  // Fetch all sources for lookup
  const sourcesData = useQuery(api.domains.knowledge.sourceRegistry.getAllActiveSources, {});

  // Build source lookup map
  const sourcesMap = useMemo(() => {
    const map = new Map<string, SourceInfo>();
    if (sourcesData) {
      for (const source of sourcesData) {
        map.set(source.registryId, {
          name: source.name,
          domain: source.domain,
          canonicalUrl: source.canonicalUrl,
        });
      }
    }
    return map;
  }, [sourcesData]);

  // Filter by domain if specified
  const filteredDiffs = useMemo(() => {
    if (!diffsData) return [];
    if (!domainFilter) return diffsData;

    return diffsData.filter((diff: any) => {
      const source = sourcesMap.get(diff.registryId);
      return source?.domain === domainFilter;
    });
  }, [diffsData, domainFilter, sourcesMap]);

  // Compute stats
  const stats = useMemo(() => {
    const s: { total: number; critical: number; high: number; medium: number; low: number } = { total: 0, critical: 0, high: 0, medium: 0, low: 0 };
    for (const diff of filteredDiffs as any[]) {
      s.total++;
      (s as any)[diff.severity]++;
    }
    return s;
  }, [filteredDiffs]);

  // Handle view source
  const handleViewSource = (url: string) => {
    if (onViewSource) {
      onViewSource(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const diffs: SourceDiff[] = useMemo(
    () =>
      (filteredDiffs as any[]).map((d: any) => ({
        _id: d._id,
        registryId: d.registryId,
        fromSnapshotAt: d.fromSnapshotAt,
        toSnapshotAt: d.toSnapshotAt,
        changeType: d.changeType,
        severity: d.severity,
        changeTitle: d.changeTitle,
        changeSummary: d.changeSummary,
        affectedSections: d.affectedSections,
        diffHunks: d.diffHunks,
        classifiedBy: d.classifiedBy ?? undefined,
        classificationConfidence: d.classificationConfidence ?? undefined,
        detectedAt: d.detectedAt,
      })),
    [filteredDiffs]
  );

  useEffect(() => {
    if (diffs.length === 0) {
      if (selectedDiffId !== null) setSelectedDiffId(null);
      return;
    }

    if (!selectedDiffId) {
      setSelectedDiffId(diffs[0]._id);
      return;
    }

    if (!diffs.some((d) => d._id === selectedDiffId)) {
      setSelectedDiffId(diffs[0]._id);
    }
  }, [diffs, selectedDiffId]);

  const selectedDiff = useMemo(() => {
    if (!selectedDiffId) return diffs[0];
    return diffs.find((d) => d._id === selectedDiffId) ?? diffs[0];
  }, [diffs, selectedDiffId]);

  const selectedSource = useMemo(() => {
    if (!selectedDiff) return undefined;
    return sourcesMap.get(selectedDiff.registryId);
  }, [selectedDiff, sourcesMap]);

  const handleAskAgentClick = () => {
    if (!onAskAgent || !selectedDiff) return;
    const urls = selectedSource?.canonicalUrl ? [selectedSource.canonicalUrl] : undefined;
    const detectedAt = new Date(selectedDiff.detectedAt).toLocaleString();

    const prompt = [
      "Analyze this source update and summarize impact + next actions.",
      "",
      `Title: ${selectedDiff.changeTitle}`,
      `Source: ${selectedSource?.name ?? selectedDiff.registryId}`,
      `Detected: ${detectedAt}`,
      "",
      `Summary: ${selectedDiff.changeSummary}`,
      "",
      "Requirements: cite the source URL with date; separate verified facts vs speculation.",
    ].join("\n");

    onAskAgent({ prompt, urls });
  };

  const handleRefreshNow = async () => {
    if (refreshState.status === "running") return;
    setRefreshState({ status: "running" });
    try {
      const result = await refreshSourcesNow({ scope: "pinned", maxSources: 20 });
      setRefreshState({
        status: "done",
        message: `Refreshed ${result.processed} sources (${result.changed} changed, ${result.errors} errors)`,
      });
    } catch (err) {
      setRefreshState({
        status: "error",
        message: err instanceof Error ? err.message : "Refresh failed",
      });
    }
  };

  // Loading state
  if (diffsData === undefined) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-5 h-5 text-content-muted motion-safe:animate-spin" />
        <span className="ml-2 text-sm text-content-muted">Loading changes...</span>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${compact ? "gap-3" : "gap-4"}`}>
      {/* Header */}
      {showHeader && (
        <div className={`flex flex-col gap-3 ${compact ? "" : "pb-2 border-b border-edge"}`}>
          {/* Title Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-indigo-100">
                <Bell className="w-4 h-4 text-indigo-600" />
              </div>
              <h3 className="text-sm font-semibold text-content">
                What Changed
              </h3>
            </div>
            <StatsBar {...stats} />
          </div>

          {/* Filter + Actions */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <FilterBar
              severity={selectedSeverity}
              onSeverityChange={setSelectedSeverity}
              daysBack={selectedDaysBack}
              onDaysBackChange={setSelectedDaysBack}
            />

            <div className="flex items-center gap-2 flex-wrap justify-end">
              {typeof refreshSummary?.dueCount === "number" && refreshSummary.dueCount > 0 && (
                <span className="px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 rounded-full">
                  {refreshSummary.dueCount} due
                </span>
              )}
              <button
                type="button"
                onClick={handleRefreshNow}
                disabled={refreshState.status === "running"}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border
                           border-edge bg-surface hover:bg-surface-hover
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshState.status === "running" ? "motion-safe:animate-spin" : ""}`} />
                Refresh now
              </button>
              {onAskAgent && (
                <button
                  type="button"
                  onClick={handleAskAgentClick}
                  disabled={!selectedDiff}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg
                           bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Zap className="w-3.5 h-3.5" />
                  Ask agent
                </button>
              )}
            </div>
          </div>

          {/* Refresh Meta */}
          <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-content-muted">
            <span>
              {refreshSummary?.lastFetchedAt
                ? `Last refresh: ${new Date(refreshSummary.lastFetchedAt).toLocaleString()}`
                : "Last refresh: unknown"}
            </span>
            {refreshState.status === "done" && <span className="text-content-secondary">{refreshState.message}</span>}
            {refreshState.status === "error" && <span className="text-red-700">{refreshState.message}</span>}
          </div>
        </div>
      )}

      {/* Content */}
      {compact ? (
        <div className="space-y-3">
          <ChangeCardList
            diffs={diffs}
            sources={sourcesMap}
            emptyMessage={`No changes detected in the last ${selectedDaysBack} days`}
            onViewSource={handleViewSource}
          />
        </div>
      ) : diffs.length === 0 ? (
        <ChangeCardList
          diffs={diffs}
          sources={sourcesMap}
          emptyMessage={`No changes detected in the last ${selectedDaysBack} days`}
          onViewSource={handleViewSource}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,380px)_1fr] gap-4">
          <div className="min-w-0">
            <div className="text-xs font-medium text-content-muted tracking-wide mb-2">
              Recent changes
            </div>
            <div className="space-y-2 max-h-[70vh] overflow-auto pr-1">
              {diffs.map((diff) => (
                <ChangeListItem
                  key={diff._id}
                  diff={diff}
                  source={sourcesMap.get(diff.registryId)}
                  selected={diff._id === selectedDiffId}
                  onSelect={() => setSelectedDiffId(diff._id)}
                />
              ))}
            </div>
          </div>

          <div className="min-w-0">
            {selectedDiff && (
              <ChangeCard
                key={selectedDiff._id}
                diff={selectedDiff}
                source={sourcesMap.get(selectedDiff.registryId)}
                defaultExpanded
                onViewSource={handleViewSource}
              />
            )}
          </div>
        </div>
      )}

      {/* Footer - Show more link if at limit */}
      {filteredDiffs.length >= limit && (
        <div className="text-center py-2">
          <button
            type="button"
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
          >
            View all changes →
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Compact Widget for Dashboard
// ═══════════════════════════════════════════════════════════════════════════

interface WhatChangedWidgetProps {
  limit?: number;
  onViewAll?: () => void;
  onViewSource?: (url: string) => void;
}

export function WhatChangedWidget({
  limit = 5,
  onViewAll,
  onViewSource,
}: WhatChangedWidgetProps) {
  // Fetch only high-priority diffs
  const diffsData = useQuery(api.domains.knowledge.sourceDiffs.getAllRecentDiffs, {
    limit,
    sinceTime: Date.now() - 7 * 24 * 60 * 60 * 1000, // Last 7 days
  });

  const sourcesData = useQuery(api.domains.knowledge.sourceRegistry.getAllActiveSources, {});

  const sourcesMap = useMemo(() => {
    const map = new Map<string, SourceInfo>();
    if (sourcesData) {
      for (const source of sourcesData) {
        map.set(source.registryId, {
          name: source.name,
          domain: source.domain,
          canonicalUrl: source.canonicalUrl,
        });
      }
    }
    return map;
  }, [sourcesData]);

  // Sort by severity (critical first)
  const sortedDiffs = useMemo(() => {
    if (!diffsData) return [];
    const severityOrder: Record<Severity, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    return [...(diffsData as any[])].sort((a: any, b: any) => severityOrder[a.severity as Severity] - severityOrder[b.severity as Severity]);
  }, [diffsData]);

  const handleViewSource = (url: string) => {
    if (onViewSource) {
      onViewSource(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  if (!diffsData || diffsData.length === 0) {
    return (
      <div className="border border-edge rounded-lg p-4 bg-surface">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="w-4 h-4 text-content-muted" />
          <h4 className="text-sm font-medium text-content">Source Updates</h4>
        </div>
        <p className="text-xs text-content-muted">
          No recent changes in tracked sources.
        </p>
      </div>
    );
  }

  const criticalCount = sortedDiffs.filter((d) => d.severity === "critical").length;
  const highCount = sortedDiffs.filter((d) => d.severity === "high").length;

  return (
    <div className="border border-edge rounded-lg overflow-hidden bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-edge bg-surface-secondary/50">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded bg-indigo-100">
            <Bell className="w-3.5 h-3.5 text-indigo-600" />
          </div>
          <h4 className="text-sm font-medium text-content">What Changed</h4>
        </div>
        <div className="flex items-center gap-2">
          {criticalCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
              {criticalCount} critical
            </span>
          )}
          {highCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700 rounded-full">
              {highCount} high
            </span>
          )}
        </div>
      </div>

      {/* Compact list */}
      <div className="divide-y divide-[color:var(--border-color)]">
        {sortedDiffs.slice(0, limit).map((diff) => {
          const source = sourcesMap.get(diff.registryId);
          return (
            <div
              key={diff._id}
              className="px-4 py-3 hover:bg-surface-hover transition-colors cursor-pointer"
              onClick={() => source && handleViewSource(source.canonicalUrl)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-content truncate">
                    {diff.changeTitle}
                  </p>
                  <p className="text-xs text-content-muted mt-0.5">
                    {source?.name ?? diff.registryId}
                  </p>
                </div>
                <span
                  className={`px-1.5 py-0.5 text-xs font-medium rounded ${
                    diff.severity === "critical"
                      ? "bg-red-100 text-red-700"
                      : diff.severity === "high"
                      ? "bg-orange-100 text-orange-700"
                      : diff.severity === "medium"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {diff.severity}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      {onViewAll && (
        <div className="px-4 py-2 border-t border-edge bg-surface-secondary/30">
          <button
            type="button"
            onClick={onViewAll}
            className="w-full text-xs text-indigo-600 hover:text-indigo-800 font-medium text-center"
          >
            View all changes →
          </button>
        </div>
      )}
    </div>
  );
}

export default WhatChangedPanel;
