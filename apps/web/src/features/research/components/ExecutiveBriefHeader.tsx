"use client";

/**
 * ExecutiveBriefHeader - Above-the-fold header for Morning Dossier
 *
 * Features:
 * - Day thesis (1-sentence executive summary)
 * - Three KPI tiles: Coverage, Freshness, Confidence
 * - Topic/Source filters
 */

import React from "react";
import { Database, Clock, Shield, Filter, Calendar, Tag } from "lucide-react";
import type { QualityMetrics } from "../types/dailyBriefSchema";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ExecutiveBriefHeaderProps {
  /** Editorial headline (optional, defaults to "Morning Dossier") */
  headline?: string;
  /** Day thesis (1-sentence summary) - can also be passed as dayThesis */
  thesis?: string;
  /** Alternative prop name for thesis */
  dayThesis?: string;
  /** Date string for display */
  date?: string;
  /** Quality metrics for KPI tiles */
  quality?: QualityMetrics;
  /** Available topic tags for filtering */
  topicTags?: string[];
  /** Alternative prop name for topics */
  topics?: string[];
  /** Currently selected topics */
  selectedTopics?: string[];
  /** Available source types */
  sourceTypes?: string[];
  /** Alternative prop name for sources */
  sources?: string[];
  /** Currently selected sources */
  selectedSources?: string[];
  /** Time window options */
  timeWindows?: Array<{ label: string; value: string }>;
  /** Currently selected time window */
  selectedTimeWindow?: string;
  /** Callbacks */
  onTopicToggle?: (topic: string) => void;
  /** Alternative callback for topic filter */
  onTopicFilter?: (topic: string) => void;
  onSourceToggle?: (source: string) => void;
  /** Alternative callback for source filter */
  onSourceFilter?: (source: string) => void;
  onTimeWindowChange?: (window: string) => void;
  /** Additional className */
  className?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// KPI TILE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

interface KPITileProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sublabel?: string;
  color: "blue" | "green" | "amber" | "red";
}

function KPITile({ icon, label, value, sublabel }: KPITileProps) {
  return (
    <div className="flex items-center gap-4 px-5 py-4 rounded-lg border border-edge bg-surface transition-colors hover:bg-surface-hover group">
      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-surface-secondary border border-edge transition-transform flex items-center justify-center text-content-secondary">
        <div className="[&>svg]:w-6 [&>svg]:h-6">
          {icon}
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-xs font-bold opacity-60 mb-1 font-outfit">{label}</div>
        <div className="text-2xl font-bold leading-none tracking-tight text-content">{value}</div>
        {sublabel && <div className="text-xs font-bold opacity-50 truncate mt-1.5 font-mono">{sublabel}</div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FILTER CHIP COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

interface FilterChipProps {
  label: string;
  isSelected: boolean;
  onClick: () => void;
}

function FilterChip({ label, isSelected, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-xs font-medium rounded-lg transition-all ${isSelected
        ? "bg-[var(--accent-primary)] text-white shadow-sm"
        : "bg-surface text-content-secondary hover:text-content hover:bg-surface-hover border border-edge"
        }`}
    >
      {label}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function ExecutiveBriefHeader({
  headline,
  thesis,
  dayThesis,
  date,
  quality,
  topicTags = [],
  topics = [],
  selectedTopics = [],
  sourceTypes = [],
  sources = [],
  selectedSources = [],
  timeWindows = [
    { label: "Today", value: "today" },
    { label: "24h", value: "24h" },
    { label: "3d", value: "3d" },
    { label: "7d", value: "7d" },
  ],
  selectedTimeWindow = "24h",
  onTopicToggle,
  onTopicFilter,
  onSourceToggle,
  onSourceFilter,
  onTimeWindowChange,
  className,
}: ExecutiveBriefHeaderProps) {
  // Merge alternative prop names
  const effectiveThesis = thesis ?? dayThesis ?? "AI-synthesized briefing on trends, deals, and deep dives.";
  const effectiveHeadline = headline ?? "Morning Brief";
  const effectiveDate = date ?? new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const effectiveTopics = topicTags.length > 0 ? topicTags : topics;
  const effectiveSources = sourceTypes.length > 0 ? sourceTypes : sources;
  const handleTopicClick = onTopicToggle ?? onTopicFilter;
  const handleSourceClick = onSourceToggle ?? onSourceFilter;
  // Derive KPI values from quality metrics
  const coverageValue = quality?.coverage
    ? `${quality.coverage.itemsScanned} item${quality.coverage.itemsScanned !== 1 ? 's' : ''}`
    : "—";
  const coverageSublabel = quality?.coverage
    ? `${quality.coverage.sourcesCount} source${quality.coverage.sourcesCount !== 1 ? 's' : ''}`
    : undefined;

  const freshnessValue = quality?.freshness
    ? quality.freshness.medianAgeHours < 1
      ? "< 1h"
      : `${Math.round(quality.freshness.medianAgeHours)}h`
    : "—";
  const freshnessSublabel = quality?.freshness?.windowLabel;

  const confidenceValue = quality?.confidence
    ? `${quality.confidence.score}%`
    : "—";
  const confidenceColor = quality?.confidence?.level === "high"
    ? "green" as const
    : quality?.confidence?.level === "low"
      ? "red" as const
      : "amber" as const;
  const confidenceSublabel = quality?.confidence?.hasDisagreement
    ? "Sources disagree"
    : quality?.confidence?.level === "high"
      ? "Sources agree"
      : undefined;

  return (
    <header className={`bg-surface border border-edge rounded-lg overflow-hidden ${className ?? ""}`}>
      {/* Top row: Headline + Date */}
      <div className="px-8 py-6 border-b border-edge">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl font-bold text-content tracking-tight italic">
              {effectiveHeadline}
            </h1>
            <p className="mt-2 text-base text-content-secondary font-medium leading-relaxed max-w-2xl">
              {effectiveThesis}
            </p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary/50 rounded-full text-xs font-bold text-content-secondary flex-shrink-0">
            <Calendar className="w-3 h-3" />
            <span>{effectiveDate}</span>
          </div>
        </div>
      </div>

      {/* KPI Tiles Row */}
      <div className="px-8 py-6 border-b border-[color:var(--bg-secondary)]/50">
        <div className="flex items-center gap-5">
          <KPITile
            icon={<Database className="w-5 h-5" />}
            label="Digital Coverage"
            value={coverageValue}
            sublabel={coverageSublabel}
            color="blue"
          />
          <KPITile
            icon={<Clock className="w-5 h-5" />}
            label="Signal Freshness"
            value={freshnessValue}
            sublabel={freshnessSublabel}
            color="green"
          />
          <KPITile
            icon={<Shield className="w-5 h-5" />}
            label="Asset Confidence"
            value={confidenceValue}
            sublabel={confidenceSublabel}
            color={confidenceColor}
          />
        </div>
      </div>

      {/* Filters Row */}
      <div className="px-8 py-3 flex items-center gap-8 overflow-x-auto bg-surface-secondary/20">
        {/* Time Window */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs font-bold text-content-secondary">Horizon</span>
          <div className="flex gap-1.5">
            {timeWindows.map((tw) => (
              <FilterChip
                key={tw.value}
                label={tw.label}
                isSelected={selectedTimeWindow === tw.value}
                onClick={() => onTimeWindowChange?.(tw.value)}
              />
            ))}
          </div>
        </div>

        {/* Topic Tags */}
        {effectiveTopics.length > 0 && (
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-xs font-bold text-content-secondary">Focus</span>
            <div className="flex gap-1.5 flex-wrap">
              {effectiveTopics.slice(0, 6).map((tag) => (
                <FilterChip
                  key={tag}
                  label={tag}
                  isSelected={selectedTopics.includes(tag)}
                  onClick={() => handleTopicClick?.(tag)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
export default ExecutiveBriefHeader;

