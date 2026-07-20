/**
 * FreeModelRankingsPanel.tsx
 *
 * Displays ranked list of discovered free models from OpenRouter.
 * Shows performance scores, capabilities, and evaluation metrics.
 */

import React, { memo, useState } from "react";
import { useQuery } from "convex/react";
import {
  Trophy,
  ChevronDown,
  ChevronUp,
  Eye,
  Wrench,
  Zap,
  Clock,
  Target,
  Loader2,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "../../../../convex/_generated/api";

// ============================================================================
// Types
// ============================================================================

interface FreeModel {
  id: string;
  openRouterId: string;
  name: string;
  contextLength: number;
  capabilities: {
    toolUse: boolean;
    streaming: boolean;
    structuredOutputs: boolean;
    vision: boolean;
  };
  performanceScore: number;
  reliabilityScore: number;
  latencyAvgMs: number;
  rank: number;
  isActive: boolean;
  lastEvaluated: number;
  evaluationCount: number;
  successRate: number;
}

// ============================================================================
// Capability Badge
// ============================================================================

const CapabilityBadge = memo(function CapabilityBadge({
  icon: Icon,
  label,
  active,
}: {
  icon: React.ElementType;
  label: string;
  active: boolean;
}) {
  if (!active) return null;

  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20"
      title={label}
    >
      <Icon className="w-2.5 h-2.5" />
      {label}
    </span>
  );
});

// ============================================================================
// Score Bar
// ============================================================================

const ScoreBar = memo(function ScoreBar({
  score,
  label,
  color = "bg-indigo-600",
}: {
  score: number;
  label: string;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-content-muted w-12">{label}</span>
      <div className="flex-1 h-1.5 bg-surface-secondary rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-xs font-mono text-content-secondary w-8">
        {score}%
      </span>
    </div>
  );
});

// ============================================================================
// Model Row
// ============================================================================

const ModelRow = memo(function ModelRow({
  model,
  isTop3,
}: {
  model: FreeModel;
  isTop3: boolean;
}) {
  const formatContext = (ctx: number): string => {
    if (ctx >= 1000000) return `${(ctx / 1000000).toFixed(0)}M`;
    if (ctx >= 1000) return `${(ctx / 1000).toFixed(0)}K`;
    return String(ctx);
  };

  const formatLatency = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const rankColors: Record<number, string> = {
    1: "text-amber-500",
    2: "text-slate-400",
    3: "text-amber-700",
  };

  return (
    <div
      className={cn(
        "p-3 rounded-lg border transition-colors",
        isTop3
          ? "bg-indigo-500/10/50 border-indigo-500/20"
          : "border-edge hover:bg-surface-hover"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Rank & Name */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div
            className={cn(
              "flex items-center justify-center w-7 h-7 rounded-lg font-bold text-sm",
              isTop3
                ? "bg-indigo-500/10 border border-indigo-500/20"
                : "bg-surface-secondary"
            )}
          >
            <span className={rankColors[model.rank] || "text-content-muted"}>
              {model.rank}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-content truncate">
                {model.name}
              </span>
              {isTop3 && (
                <Trophy className={cn("w-3.5 h-3.5 flex-shrink-0", rankColors[model.rank])} />
              )}
            </div>
            <div className="text-xs text-content-muted truncate">
              {model.openRouterId}
            </div>
          </div>
        </div>

        {/* Context & Latency */}
        <div className="flex items-center gap-4 text-right">
          <div>
            <div className="text-xs text-content-muted">Context</div>
            <div className="text-sm font-mono text-content-secondary">
              {formatContext(model.contextLength)}
            </div>
          </div>
          <div>
            <div className="text-xs text-content-muted">Latency</div>
            <div className="text-sm font-mono text-content-secondary">
              {formatLatency(model.latencyAvgMs)}
            </div>
          </div>
        </div>
      </div>

      {/* Capabilities */}
      <div className="flex items-center gap-1.5 mt-2">
        <CapabilityBadge
          icon={Wrench}
          label="Tools"
          active={model.capabilities.toolUse}
        />
        <CapabilityBadge
          icon={Eye}
          label="Vision"
          active={model.capabilities.vision}
        />
        <CapabilityBadge
          icon={Zap}
          label="Stream"
          active={model.capabilities.streaming}
        />
        <CapabilityBadge
          icon={Target}
          label="Struct"
          active={model.capabilities.structuredOutputs}
        />
      </div>

      {/* Score Bars */}
      <div className="mt-3 space-y-1.5">
        <ScoreBar
          score={model.performanceScore}
          label="Perf"
          color="bg-blue-500"
        />
        <ScoreBar
          score={model.reliabilityScore}
          label="Reliable"
          color="bg-green-500"
        />
        <ScoreBar
          score={model.successRate}
          label="Success"
          color="bg-purple-500"
        />
      </div>

      {/* Footer */}
      <div className="flex items-center gap-4 mt-2 pt-2 border-t border-edge text-xs text-content-muted">
        <span>{model.evaluationCount} evals</span>
        <span>
          Last: {new Date(model.lastEvaluated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </div>
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

export const FreeModelRankingsPanel = memo(function FreeModelRankingsPanel() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const models = useQuery(
    api.domains.agents.agentHubQueries.getFreeModelRankings,
    { limit: showAll ? 26 : 10, activeOnly: true }
  ) as FreeModel[] | undefined;

  const activeCount = models?.length ?? 0;

  return (
    <div className="bg-surface rounded-lg border border-edge">
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-500" />
          <h3 className="text-sm font-semibold text-content">
            Free Model Rankings
          </h3>
          <span className="px-1.5 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 text-purple-600 border border-purple-500/20">
            {activeCount} active
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-content-muted" />
        ) : (
          <ChevronDown className="w-4 h-4 text-content-muted" />
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-edge pt-4">
          {models === undefined ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 motion-safe:animate-spin text-content-muted" />
            </div>
          ) : models.length === 0 ? (
            <div className="text-center py-6">
              <Sparkles className="w-8 h-8 mx-auto text-content-muted mb-2" />
              <p className="text-sm text-content-muted">
                No free models discovered yet
              </p>
              <p className="text-xs text-content-muted mt-1">
                Run the discovery cron to find available models
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {models.map((model) => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    isTop3={model.rank <= 3}
                  />
                ))}
              </div>

              {/* Show All Toggle */}
              {activeCount >= 10 && !showAll && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="w-full mt-4 py-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-colors"
                >
                  Show all models
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
});

export default FreeModelRankingsPanel;

