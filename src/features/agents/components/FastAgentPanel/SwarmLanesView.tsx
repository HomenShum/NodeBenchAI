/**
 * SwarmLanesView.tsx
 *
 * Compact parallel lanes visualization for swarm execution.
 * Shows real-time progress of multiple agents working in parallel.
 */

import React, { memo } from "react";
import {
  Loader2,
  CheckCircle,
  XCircle,
  FileText,
  Video,
  Building,
  TrendingUp,
  Search,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSwarmByThread, SwarmTask, SwarmStatus, SwarmProgress } from "@/hooks/useSwarm";
import { useLaneEvents } from "@/hooks/useAgentLanes";

// ============================================================================
// Types & Constants
// ============================================================================

const AGENT_ICONS: Record<string, React.ElementType> = {
  DocumentAgent: FileText,
  MediaAgent: Video,
  SECAgent: Building,
  OpenBBAgent: TrendingUp,
  EntityResearchAgent: Search,
};

const AGENT_COLORS: Record<string, string> = {
  DocumentAgent: "text-violet-500 bg-violet-500/10 border-violet-500/20",
  MediaAgent: "text-purple-500 bg-purple-500/10 border-purple-500/20",
  SECAgent: "text-amber-500 bg-amber-500/10 border-amber-500/20",
  OpenBBAgent: "text-green-500 bg-green-500/10 border-green-500/20",
  EntityResearchAgent: "text-cyan-500 bg-cyan-500/10 border-cyan-500/20",
  default: "text-content-secondary bg-surface-secondary border-edge",
};

const AGENT_SHORT_NAMES: Record<string, string> = {
  DocumentAgent: "Doc",
  MediaAgent: "Media",
  SECAgent: "SEC",
  OpenBBAgent: "Finance",
  EntityResearchAgent: "Entity",
};

// ============================================================================
// Single Lane Component
// ============================================================================

const SwarmLane = memo(function SwarmLane({ task }: { task: SwarmTask }) {
  const Icon = AGENT_ICONS[task.agentName] || Zap;
  const colorClass = AGENT_COLORS[task.agentName] || AGENT_COLORS.default;
  const shortName = AGENT_SHORT_NAMES[task.agentName] || task.agentName;

  // Get streaming events for this task's delegation
  const { text, toolsUsed, isStreaming } = useLaneEvents(task.delegationId);

  const isRunning = task.status === "running";
  const isCompleted = task.status === "completed";
  const isFailed = task.status === "failed";
  const isPending = task.status === "pending";

  // Preview text - show streaming or result
  const previewText = isRunning
    ? text?.slice(-150) || "Starting..."
    : task.resultSummary || task.result?.slice(0, 150) || "";

  return (
    <div
      className={cn(
        "flex flex-col gap-1 p-2 rounded-lg border transition-all",
        colorClass,
        isRunning && "ring-1 ring-offset-1 ring-offset-surface",
        isPending && "opacity-60"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5" />
          <span className="text-xs font-medium">{shortName}</span>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-1">
          {isPending && (
            <span className="text-xs text-content-muted">Pending</span>
          )}
          {isRunning && (
            <Loader2 className="w-3 h-3 motion-safe:animate-spin" />
          )}
          {isCompleted && (
            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
          )}
          {isFailed && (
            <XCircle className="w-3.5 h-3.5 text-red-500" />
          )}
        </div>
      </div>

      {/* Preview text */}
      {(isRunning || isCompleted) && previewText && (
        <div className="text-xs text-content-secondary line-clamp-2 min-h-[2em]">
          {isRunning && isStreaming && (
            <span className="inline-block w-1.5 h-3 bg-current motion-safe:animate-pulse mr-0.5" />
          )}
          {previewText}
        </div>
      )}

      {/* Tools used */}
      {toolsUsed.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {toolsUsed.slice(0, 3).map((tool) => (
            <span
              key={tool}
              className="text-[8px] px-1 py-0.5 rounded bg-surface-secondary text-content-muted"
            >
              {tool.replace(/Tool$/, "")}
            </span>
          ))}
          {toolsUsed.length > 3 && (
            <span className="text-[8px] text-content-muted">
              +{toolsUsed.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Error message */}
      {isFailed && task.errorMessage && (
        <div className="text-xs text-red-500 truncate">
          {task.errorMessage}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// Synthesis Lane Component
// ============================================================================

const SynthesisLane = memo(function SynthesisLane({
  status,
  mergedResult,
}: {
  status: SwarmStatus;
  mergedResult?: string;
}) {
  const isSynthesizing = status === "synthesizing";
  const isCompleted = status === "completed";
  const isGathering = status === "gathering";

  if (!isSynthesizing && !isCompleted && !isGathering) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-1 p-2 rounded-lg border transition-all col-span-full",
        "text-indigo-500 bg-indigo-500/10 border-indigo-500/20",
        isSynthesizing && "ring-1 ring-ring"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5" />
          <span className="text-xs font-medium">Synthesis</span>
        </div>

        <div className="flex items-center gap-1">
          {(isSynthesizing || isGathering) && (
            <>
              <Loader2 className="w-3 h-3 motion-safe:animate-spin" />
              <span className="text-xs">
                {isGathering ? "Gathering..." : "Synthesizing..."}
              </span>
            </>
          )}
          {isCompleted && (
            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
          )}
        </div>
      </div>

      {isCompleted && mergedResult && (
        <div className="text-xs text-content-secondary line-clamp-3">
          {mergedResult.slice(0, 200)}...
        </div>
      )}
    </div>
  );
});

// ============================================================================
// Progress Bar Component
// ============================================================================

const SwarmProgressBar = memo(function SwarmProgressBar({
  progress,
  status,
}: {
  progress: SwarmProgress;
  status: SwarmStatus;
}) {
  const isActive = ["pending", "spawning", "executing", "gathering", "synthesizing"].includes(status);

  return (
    <div className="flex items-center gap-2">
      {/* Progress bar */}
      <div className="flex-1 h-1.5 bg-surface-secondary rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            status === "completed" ? "bg-green-500" :
            status === "failed" ? "bg-red-500" :
            "bg-violet-500"
          )}
          style={{ width: `${progress.percentComplete}%` }}
        />
      </div>

      {/* Status text */}
      <span className="text-xs text-content-muted flex-shrink-0">
        {isActive ? (
          <>
            {progress.completed} of {progress.total}
          </>
        ) : status === "completed" ? (
          "Complete"
        ) : status === "failed" ? (
          "Failed"
        ) : (
          status
        )}
      </span>
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

interface SwarmLanesViewProps {
  threadId: string;
  compact?: boolean;
  className?: string;
}

export function SwarmLanesView({
  threadId,
  compact = false,
  className,
}: SwarmLanesViewProps) {
  const { swarm, tasks, progress, isActive, hasSwarm } = useSwarmByThread(threadId);

  // Don't render if no swarm
  if (!hasSwarm || !swarm) {
    return null;
  }

  // Compact view for completed swarms
  if (compact && !isActive) {
    return (
      <div className={cn("px-3 py-2", className)}>
        <div className="flex items-center gap-2 text-xs text-content-muted">
          <Zap className="w-3.5 h-3.5 text-green-500" />
          <span>Team completed: {tasks.length} agents</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "px-3 py-2 border-b border-edge bg-surface/50",
        className
      )}
    >
      {/* Header with progress */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <Zap className={cn(
            "w-4 h-4",
            isActive ? "text-violet-500" : "text-green-500"
          )} />
          <span className="text-xs font-medium text-content">
            Parallel Agents
          </span>
        </div>

        {progress && (
          <SwarmProgressBar progress={progress} status={swarm.status} />
        )}
      </div>

      {/* Agent lanes grid */}
      <div className={cn(
        "grid gap-2",
        tasks.length <= 2 ? "grid-cols-2" :
        tasks.length === 3 ? "grid-cols-3" :
        "grid-cols-2 sm:grid-cols-3"
      )}>
        {tasks.map((task) => (
          <SwarmLane key={task.taskId} task={task} />
        ))}

        {/* Synthesis lane */}
        <SynthesisLane
          status={swarm.status}
          mergedResult={swarm.mergedResult}
        />
      </div>
    </div>
  );
}

export default SwarmLanesView;
