"use client";

/**
 * ChangeCard Component
 *
 * Displays a detected change from an authoritative source.
 * Part of the Knowledge Product Layer (Phase 1).
 *
 * Features:
 * - Change type badge (Added/Removed/Breaking/Deprecated)
 * - Severity indicator (Critical = red, High = orange, etc.)
 * - Title + summary
 * - Affected sections
 * - "View diff" expand button
 */

import React, { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  AlertCircle,
  Info,
  PlusCircle,
  MinusCircle,
  Zap,
  Clock,
  ExternalLink,
  FileText,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type ChangeType =
  | "guidance_added"
  | "guidance_removed"
  | "guidance_modified"
  | "breaking_change"
  | "deprecation"
  | "new_pattern"
  | "pricing_change"
  | "api_change"
  | "model_update"
  | "minor_update";

export type Severity = "critical" | "high" | "medium" | "low";

export interface DiffHunk {
  type: "add" | "remove" | "modify";
  oldText?: string;
  newText?: string;
  context?: string;
}

export interface SourceDiff {
  _id: string;
  registryId: string;
  fromSnapshotAt: number;
  toSnapshotAt: number;
  changeType: ChangeType;
  severity: Severity;
  changeTitle: string;
  changeSummary: string;
  affectedSections: string[];
  diffHunks?: DiffHunk[];
  classifiedBy?: string;
  classificationConfidence?: number;
  detectedAt: number;
}

export interface SourceInfo {
  name: string;
  domain: string;
  canonicalUrl: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Components
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Severity badge with appropriate coloring
 */
function SeverityBadge({ severity }: { severity: Severity }) {
  const config: Record<
    Severity,
    { bg: string; text: string; border: string; icon: React.ReactNode; label: string }
  > = {
    critical: {
      bg: "bg-red-500/10",
      text: "text-red-400 dark:text-red-300",
      border: "border-red-500/20",
      icon: <AlertTriangle className="w-3 h-3" />,
      label: "Critical",
    },
    high: {
      bg: "bg-amber-500/10",
      text: "text-amber-500 dark:text-amber-300",
      border: "border-amber-500/20",
      icon: <AlertCircle className="w-3 h-3" />,
      label: "High",
    },
    medium: {
      bg: "bg-surface-secondary",
      text: "text-content-secondary",
      border: "border-edge",
      icon: <Info className="w-3 h-3" />,
      label: "Medium",
    },
    low: {
      bg: "bg-surface-secondary",
      text: "text-content-muted",
      border: "border-edge",
      icon: <Info className="w-3 h-3" />,
      label: "Low",
    },
  };

  const { bg, text, border, icon, label } = config[severity];

  return (
    <div
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${bg} ${text} ${border}`}
    >
      {icon}
      <span>{label}</span>
    </div>
  );
}

/**
 * Change type badge
 */
function ChangeTypeBadge({ changeType }: { changeType: ChangeType }) {
  const config: Record<
    ChangeType,
    { bg: string; text: string; icon: React.ReactNode; label: string }
  > = {
    guidance_added: {
      bg: "bg-surface-secondary",
      text: "text-content-secondary",
      icon: <PlusCircle className="w-3 h-3" />,
      label: "Added",
    },
    guidance_removed: {
      bg: "bg-red-500/10",
      text: "text-red-400 dark:text-red-300",
      icon: <MinusCircle className="w-3 h-3" />,
      label: "Removed",
    },
    guidance_modified: {
      bg: "bg-surface-secondary",
      text: "text-content-secondary",
      icon: <FileText className="w-3 h-3" />,
      label: "Modified",
    },
    breaking_change: {
      bg: "bg-red-500/10",
      text: "text-red-400 dark:text-red-300",
      icon: <AlertTriangle className="w-3 h-3" />,
      label: "Breaking",
    },
    deprecation: {
      bg: "bg-amber-500/10",
      text: "text-amber-500 dark:text-amber-300",
      icon: <Clock className="w-3 h-3" />,
      label: "Deprecated",
    },
    new_pattern: {
      bg: "bg-surface-secondary",
      text: "text-content-secondary",
      icon: <Zap className="w-3 h-3" />,
      label: "New Pattern",
    },
    pricing_change: {
      bg: "bg-surface-secondary",
      text: "text-content-secondary",
      icon: <Info className="w-3 h-3" />,
      label: "Pricing",
    },
    api_change: {
      bg: "bg-surface-secondary",
      text: "text-content-secondary",
      icon: <Zap className="w-3 h-3" />,
      label: "API Change",
    },
    model_update: {
      bg: "bg-surface-secondary",
      text: "text-content-secondary",
      icon: <Zap className="w-3 h-3" />,
      label: "Model Update",
    },
    minor_update: {
      bg: "bg-surface-secondary",
      text: "text-content-muted",
      icon: <Info className="w-3 h-3" />,
      label: "Minor",
    },
  };

  const { bg, text, icon, label } = config[changeType];

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${bg} ${text}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

/**
 * Time ago helper
 */
function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Diff hunk display
 */
function DiffHunkDisplay({ hunk }: { hunk: DiffHunk }) {
  return (
    <div className="font-mono text-xs rounded border border-edge overflow-hidden">
      {hunk.context && (
        <div className="bg-surface-secondary px-3 py-1 text-content-secondary border-b border-edge">
          {hunk.context}
        </div>
      )}
      {hunk.type === "remove" && hunk.oldText && (
        <div className="bg-red-50 px-3 py-1 text-red-700">
          <span className="text-red-500">- </span>
          {hunk.oldText}
        </div>
      )}
      {hunk.type === "add" && hunk.newText && (
        <div className="bg-indigo-50 px-3 py-1 text-content-secondary">
          <span className="text-indigo-500">+ </span>
          {hunk.newText}
        </div>
      )}
      {hunk.type === "modify" && (
        <>
          {hunk.oldText && (
            <div className="bg-red-50 px-3 py-1 text-red-700">
              <span className="text-red-500">- </span>
              {hunk.oldText}
            </div>
          )}
          {hunk.newText && (
            <div className="bg-indigo-50 px-3 py-1 text-content-secondary">
              <span className="text-indigo-500">+ </span>
              {hunk.newText}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════

interface ChangeCardProps {
  diff: SourceDiff;
  source?: SourceInfo;
  defaultExpanded?: boolean;
  onViewSource?: (url: string) => void;
}

export function ChangeCard({
  diff,
  source,
  defaultExpanded = false,
  onViewSource,
}: ChangeCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Determine accent color based on severity
  const accentColors: Record<Severity, string> = {
    critical: "bg-red-400 dark:bg-red-500",
    high: "bg-amber-400 dark:bg-amber-500",
    medium: "bg-content-muted",
    low: "bg-content-muted",
  };

  return (
    <div
      className="group relative bg-surface border border-edge rounded-lg overflow-hidden
                 hover:shadow-md hover:border-primary/20 transition-all duration-200"
    >
      {/* Left Accent Border */}
      <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${accentColors[diff.severity]}`} />

      {/* Header - Always Visible */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full text-left pl-5 pr-4 py-4 flex items-start gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded"
      >
        {/* Change Type Icon */}
        <div className="flex-shrink-0 mt-0.5">
          <ChangeTypeBadge changeType={diff.changeType} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Title Row */}
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="text-sm font-semibold text-content leading-tight min-w-0 truncate">
              {diff.changeTitle}
            </h3>
            <SeverityBadge severity={diff.severity} />
          </div>

          {/* Source & Time */}
          <div className="flex items-center gap-2 text-xs text-content-muted mb-2">
            {source && (
              <>
                <span className="font-medium text-content-secondary">
                  {source.name}
                </span>
                <span>•</span>
              </>
            )}
            <span>{formatTimeAgo(diff.detectedAt)}</span>
          </div>

          {/* Summary */}
          <p className="text-sm text-content-secondary line-clamp-2">
            {diff.changeSummary}
          </p>

          {/* Affected Sections Preview */}
          {diff.affectedSections.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {diff.affectedSections.slice(0, 3).map((section) => (
                <span
                  key={section}
                  className="px-1.5 py-0.5 text-xs bg-surface-secondary text-content-secondary rounded"
                >
                  {section}
                </span>
              ))}
              {diff.affectedSections.length > 3 && (
                <span className="px-1.5 py-0.5 text-xs bg-surface-secondary text-content-secondary rounded">
                  +{diff.affectedSections.length - 3} more
                </span>
              )}
            </div>
          )}
        </div>

        {/* Expand/Collapse Indicator */}
        <div className="flex-shrink-0 text-content-muted">
          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="pl-5 pr-4 pb-4 border-t border-edge">
          {/* Diff Hunks */}
          {diff.diffHunks && diff.diffHunks.length > 0 && (
            <div className="mt-4 space-y-2">
              <h4 className="text-xs font-medium text-content-muted mb-2">
                Changes
              </h4>
              {diff.diffHunks.map((hunk, i) => (
                <DiffHunkDisplay key={i} hunk={hunk} />
              ))}
            </div>
          )}

          {/* All Affected Sections */}
          {diff.affectedSections.length > 3 && (
            <div className="mt-4">
              <h4 className="text-xs font-medium text-content-muted mb-2">
                All Affected Sections
              </h4>
              <div className="flex flex-wrap gap-1">
                {diff.affectedSections.map((section) => (
                  <span
                    key={section}
                    className="px-2 py-1 text-xs bg-surface-secondary text-content-secondary rounded"
                  >
                    {section}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Classification Metadata */}
          {diff.classifiedBy && (
            <div className="mt-4 flex items-center gap-2 text-xs text-content-muted">
              <span>Classified by: {diff.classifiedBy}</span>
              {diff.classificationConfidence && (
                <>
                  <span>•</span>
                  <span>Confidence: {Math.round(diff.classificationConfidence * 100)}%</span>
                </>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 flex items-center gap-3">
            {source && (
              <button
                type="button"
                onClick={() => onViewSource?.(source.canonicalUrl)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                         bg-surface-secondary text-content-secondary rounded-lg hover:bg-surface-hover transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View Source
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
interface ChangeListItemProps {
  diff: SourceDiff;
  source?: SourceInfo;
  selected?: boolean;
  onSelect?: () => void;
}

export function ChangeListItem({ diff, source, selected = false, onSelect }: ChangeListItemProps) {
  const severityColor: Record<Severity, string> = {
    critical: "bg-red-400 dark:bg-red-500",
    high: "bg-amber-400 dark:bg-amber-500",
    medium: "bg-content-muted",
    low: "bg-content-muted",
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
        selected
          ? "border-edge bg-surface-secondary"
          : "border-edge bg-surface hover:bg-surface-hover"
      }`}
      aria-current={selected}
    >
      <div className="flex items-start gap-2.5">
        <span className={`mt-1.5 h-2 w-2 rounded-full ${severityColor[diff.severity]}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold text-content leading-tight line-clamp-2">
              {diff.changeTitle}
            </p>
            <span className="flex-shrink-0">
              <ChangeTypeBadge changeType={diff.changeType} />
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-content-muted">
            <span className="truncate">{source?.name ?? diff.registryId}</span>
            <span>•</span>
            <span>{formatTimeAgo(diff.detectedAt)}</span>
          </div>
          <p className="mt-1 text-xs text-content-secondary line-clamp-2">
            {diff.changeSummary}
          </p>
        </div>
      </div>
    </button>
  );
}

// Change Card List Component
// ═══════════════════════════════════════════════════════════════════════════

interface ChangeCardListProps {
  diffs: SourceDiff[];
  sources?: Map<string, SourceInfo>;
  emptyMessage?: string;
  onViewSource?: (url: string) => void;
}

export function ChangeCardList({
  diffs,
  sources,
  emptyMessage = "No changes detected",
  onViewSource,
}: ChangeCardListProps) {
  if (diffs.length === 0) {
    return (
      <div className="text-center py-8 text-content-muted">
        <Info className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {diffs.map((diff) => (
        <ChangeCard
          key={diff._id}
          diff={diff}
          source={sources?.get(diff.registryId)}
          onViewSource={onViewSource}
        />
      ))}
    </div>
  );
}

export default ChangeCard;
