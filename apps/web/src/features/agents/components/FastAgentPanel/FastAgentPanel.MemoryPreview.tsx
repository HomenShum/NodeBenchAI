// src/features/agents/components/FastAgentPanel/FastAgentPanel.MemoryPreview.tsx
// Memory preview card showing entity memory state before queries

import React, { useState } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import {
  Database,
  Clock,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Loader2,
  Sparkles,
  Info,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// TYPES
// ============================================================================

type QualityTier = "excellent" | "good" | "fair" | "poor";

interface MemorySummary {
  entityName: string;
  qualityTier: QualityTier;
  ageInDays: number;
  factCount: number;
  isStale: boolean;
}

interface MemoryPreviewData {
  found: boolean;
  summary?: MemorySummary;
  keyFacts?: string[];
}

interface MemoryPreviewCardProps {
  entityName: string;
  className?: string;
  onRefresh?: () => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const qualityTierConfig: Record<
  QualityTier,
  {
    color: string;
    bgColor: string;
    borderColor: string;
    label: string;
    description: string;
  }
> = {
  excellent: {
    color: "text-green-400",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
    label: "Excellent",
    description: "Banker-grade quality with 10+ verified facts",
  },
  good: {
    color: "text-blue-400",
    bgColor: "bg-violet-500/10",
    borderColor: "border-violet-500/30",
    label: "Good",
    description: "Solid foundation with 5+ facts",
  },
  fair: {
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/30",
    label: "Fair",
    description: "Basic information, may need enrichment",
  },
  poor: {
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
    label: "Poor",
    description: "Minimal data, enrichment recommended",
  },
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function MemoryPreviewCard({
  entityName,
  className,
  onRefresh,
}: MemoryPreviewCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Query memory preview
  const getMemoryPreview = useAction(
    api.domains.agents.promptEnhancer.getMemoryPreview
  );

  const [memoryData, setMemoryData] = useState<MemoryPreviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load memory on mount
  React.useEffect(() => {
    async function loadMemory() {
      setIsLoading(true);
      try {
        const result = await getMemoryPreview({ entityName });
        setMemoryData(result);
      } catch (error) {
        console.error("Failed to load memory preview:", error);
        setMemoryData({ found: false });
      } finally {
        setIsLoading(false);
      }
    }
    loadMemory();
  }, [entityName, getMemoryPreview]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const result = await getMemoryPreview({ entityName });
      setMemoryData(result);
      onRefresh?.();
    } catch (error) {
      console.error("Failed to refresh memory:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div
        className={cn(
          "bg-surface-secondary border border-edge rounded-lg p-3",
          className
        )}
      >
        <div className="flex items-center gap-2 text-content-muted">
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
          <span className="text-sm">Loading memory for {entityName}...</span>
        </div>
      </div>
    );
  }

  // Not found state
  if (!memoryData?.found) {
    return (
      <div
        className={cn(
          "bg-surface-secondary border border-edge rounded-lg p-3",
          className
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-content-muted" />
            <span className="text-sm font-medium text-content-secondary">
              {entityName}
            </span>
          </div>
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-surface-hover text-content-muted">
            Not in Memory
          </span>
        </div>
        <p className="mt-2 text-xs text-content-muted">
          No memory found for this entity. Research will trigger enrichment.
        </p>
      </div>
    );
  }

  const { summary, keyFacts } = memoryData;
  if (!summary) return null;

  const tierConfig = qualityTierConfig[summary.qualityTier];

  return (
    <div
      className={cn(
        "border rounded-lg overflow-hidden",
        tierConfig.bgColor,
        tierConfig.borderColor,
        className
      )}
    >
      {/* Header */}
      <div className="px-3 py-2 bg-surface-secondary">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className={cn("h-4 w-4", tierConfig.color)} />
            <span className="text-sm font-medium text-content">
              {summary.entityName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "px-2 py-0.5 rounded text-xs font-medium",
                tierConfig.bgColor,
                tierConfig.color
              )}
            >
              {tierConfig.label}
            </span>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1 rounded hover:bg-surface-hover transition-colors"
              title="Refresh memory"
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5 text-content-muted",
                  isRefreshing && "motion-safe:animate-spin"
                )}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="px-3 py-2 flex items-center gap-4 text-xs border-b border-edge">
        <div className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-content-muted" />
          <span className="text-content-secondary">{summary.factCount} facts</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-content-muted" />
          <span className="text-content-secondary">{summary.ageInDays}d old</span>
        </div>
        {summary.isStale && (
          <div className="flex items-center gap-1.5 text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Stale</span>
          </div>
        )}
        {!summary.isStale && summary.qualityTier === "excellent" && (
          <div className="flex items-center gap-1.5 text-green-400">
            <CheckCircle className="h-3.5 w-3.5" />
            <span>Fresh</span>
          </div>
        )}
      </div>

      {/* Expandable Key Facts */}
      {keyFacts && keyFacts.length > 0 && (
        <div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center justify-between w-full px-3 py-2 hover:bg-surface-hover transition-colors"
          >
            <span className="text-xs text-content-muted">
              {isExpanded ? "Hide" : "Show"} key facts
            </span>
            {isExpanded ? (
              <ChevronUp className="h-3 w-3 text-content-muted" />
            ) : (
              <ChevronDown className="h-3 w-3 text-content-muted" />
            )}
          </button>

          {isExpanded && (
            <div className="px-3 pb-3 space-y-1.5">
              {keyFacts.map((fact, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-xs text-content-secondary"
                >
                  <span className="text-content-muted shrink-0">{i + 1}.</span>
                  <span>{fact}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recommendation */}
      {(summary.isStale || summary.qualityTier === "poor") && (
        <div className="px-3 py-2 bg-amber-500/5 border-t border-amber-500/20">
          <div className="flex items-start gap-2">
            <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-600 dark:text-amber-300">
              {summary.isStale
                ? "Memory is stale. Research will trigger a refresh."
                : "Quality is low. Consider running enrichment."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// INLINE MEMORY BADGE (for use in messages/lists)
// ============================================================================

interface MemoryBadgeProps {
  entityName: string;
  qualityTier: QualityTier;
  ageInDays: number;
  factCount: number;
  isStale?: boolean;
  onClick?: () => void;
}

export function MemoryBadge({
  entityName,
  qualityTier,
  ageInDays,
  factCount,
  isStale,
  onClick,
}: MemoryBadgeProps) {
  const tierConfig = qualityTierConfig[qualityTier];

  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border transition-colors",
        tierConfig.bgColor,
        tierConfig.borderColor,
        onClick && "hover:opacity-80 cursor-pointer"
      )}
    >
      <Database className={cn("h-3 w-3", tierConfig.color)} />
      <span className={tierConfig.color}>{entityName}</span>
      <span className="text-content-muted">
        {factCount}f | {ageInDays}d
      </span>
      {isStale && <AlertTriangle className="h-3 w-3 text-amber-400" />}
    </button>
  );
}

// ============================================================================
// MEMORY STATUS INDICATOR (minimal inline indicator)
// ============================================================================

interface MemoryStatusIndicatorProps {
  found: boolean;
  qualityTier?: QualityTier;
  isStale?: boolean;
  className?: string;
}

export function MemoryStatusIndicator({
  found,
  qualityTier,
  isStale,
  className,
}: MemoryStatusIndicatorProps) {
  if (!found) {
    return (
      <div
        className={cn(
          "flex items-center gap-1 text-xs text-content-muted",
          className
        )}
        title="Entity not in memory"
      >
        <Database className="h-3 w-3" />
        <span>New</span>
      </div>
    );
  }

  const tierConfig = qualityTier
    ? qualityTierConfig[qualityTier]
    : qualityTierConfig.fair;

  return (
    <div
      className={cn(
        "flex items-center gap-1 text-xs",
        tierConfig.color,
        className
      )}
      title={`${tierConfig.label} quality${isStale ? " (stale)" : ""}`}
    >
      <Database className="h-3 w-3" />
      {isStale && <AlertTriangle className="h-3 w-3 text-amber-400" />}
    </div>
  );
}

// ============================================================================
// MULTI-ENTITY MEMORY PREVIEW
// ============================================================================

interface MultiEntityMemoryPreviewProps {
  entityNames: string[];
  className?: string;
}

export function MultiEntityMemoryPreview({
  entityNames,
  className,
}: MultiEntityMemoryPreviewProps) {
  if (entityNames.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2 text-xs text-content-muted">
        <Database className="h-3.5 w-3.5" />
        <span>Memory Preview ({entityNames.length} entities)</span>
      </div>
      <div className="space-y-2">
        {entityNames.map((name) => (
          <MemoryPreviewCard key={name} entityName={name} />
        ))}
      </div>
    </div>
  );
}

export default MemoryPreviewCard;
