// src/features/agents/components/FastAgentPanel/FastAgentPanel.Scratchpad.tsx
// Real-time scratchpad visibility component showing agent state

import React, { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import {
  Brain,
  Target,
  Database,
  Gauge,
  Clock,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Tag,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// TYPES
// ============================================================================

interface Scratchpad {
  messageId: string;
  activeEntities: string[];
  memoryUpdatedEntities: string[];
  currentIntent: string;
  stepCount: number;
  toolCallCount: number;
  planningCallCount: number;
  capabilitiesVersion?: string;
  compactedAt?: number;
  lastToolCall?: string;
  errors?: string[];
}

interface ScratchpadViewProps {
  threadId: string;
  className?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_STEPS = 8;
const MAX_TOOL_CALLS = 12;
const MAX_PLANNING_CALLS = 2;

const intentColors: Record<string, string> = {
  "deep-research": "bg-purple-500/20 text-purple-400 border-purple-500/30",
  comparison: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  "news-lookup": "bg-green-500/20 text-green-400 border-green-500/30",
  "sec-lookup": "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "outreach-prep": "bg-pink-500/20 text-pink-400 border-pink-500/30",
  "general-query": "bg-surface-secondary/50 text-content-muted border-edge",
  unknown: "bg-surface-secondary/50 text-content-muted border-edge",
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ScratchpadView({
  threadId,
  className,
  collapsed = false,
  onToggleCollapse,
}: ScratchpadViewProps) {
  // In a real implementation, this would query the scratchpad from Convex
  // For now, we use a mock or the agentScratchpads table if available
  const scratchpad = useQuery(
    api.domains.agents.agentScratchpads?.getScratchpad as any,
    threadId ? { threadId } : "skip"
  ) as Scratchpad | null | undefined;

  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["entities", "counters"])
  );

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // Show loading state
  if (scratchpad === undefined) {
    return (
      <div
        className={cn(
          "bg-surface-secondary border border-edge rounded-lg p-3",
          className
        )}
      >
        <div className="flex items-center gap-2 text-content-muted">
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
          <span className="text-sm">Loading scratchpad...</span>
        </div>
      </div>
    );
  }

  // Show empty state if no scratchpad
  if (!scratchpad) {
    return (
      <div
        className={cn(
          "bg-surface-secondary border border-edge rounded-lg p-3",
          className
        )}
      >
        <div className="flex items-center gap-2 text-content-muted">
          <Brain className="h-4 w-4" />
          <span className="text-sm">No active scratchpad</span>
        </div>
      </div>
    );
  }

  // Calculate safety status
  const stepProgress = (scratchpad.stepCount / MAX_STEPS) * 100;
  const toolProgress = (scratchpad.toolCallCount / MAX_TOOL_CALLS) * 100;
  const isNearLimit = stepProgress > 75 || toolProgress > 75;
  const isAtLimit = stepProgress >= 100 || toolProgress >= 100;

  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapse}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors w-full",
          isAtLimit
            ? "bg-red-500/10 border-red-500/30 text-red-400"
            : isNearLimit
              ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
              : "bg-surface-secondary border-edge text-content-muted hover:bg-surface-hover",
          className
        )}
      >
        <Brain className="h-4 w-4" />
        <span className="text-sm font-medium">Scratchpad</span>
        <span className="text-xs opacity-75">
          {scratchpad.activeEntities.length} entities |{" "}
          {scratchpad.stepCount}/{MAX_STEPS} steps
        </span>
        <ChevronDown className="h-4 w-4 ml-auto" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "bg-surface-secondary border border-edge rounded-lg overflow-hidden",
        className
      )}
    >
      {/* Header */}
      <button
        onClick={onToggleCollapse}
        className="flex items-center justify-between w-full px-3 py-2 bg-surface-hover hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-purple-400" />
          <span className="text-sm font-medium text-content">Scratchpad</span>
          {isAtLimit && (
            <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
          )}
          {isNearLimit && !isAtLimit && (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
          )}
        </div>
        <ChevronUp className="h-4 w-4 text-content-muted" />
      </button>

      {/* Content */}
      <div className="p-3 space-y-3">
        {/* Active Entities */}
        <ScratchpadSection
          icon={<Target className="h-4 w-4" />}
          title="Active Entities"
          count={scratchpad.activeEntities.length}
          expanded={expandedSections.has("entities")}
          onToggle={() => toggleSection("entities")}
        >
          <div className="flex flex-wrap gap-1.5">
            {scratchpad.activeEntities.length > 0 ? (
              scratchpad.activeEntities.map((entity, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded text-xs font-medium bg-surface-hover text-content-secondary border border-edge"
                >
                  {entity}
                </span>
              ))
            ) : (
              <span className="text-xs text-content-muted">No entities tracked</span>
            )}
          </div>
        </ScratchpadSection>

        {/* Memory Updated */}
        {scratchpad.memoryUpdatedEntities.length > 0 && (
          <ScratchpadSection
            icon={<Database className="h-4 w-4" />}
            title="Memory Updated"
            count={scratchpad.memoryUpdatedEntities.length}
            expanded={expandedSections.has("memory")}
            onToggle={() => toggleSection("memory")}
          >
            <div className="flex flex-wrap gap-1.5">
              {scratchpad.memoryUpdatedEntities.map((entity, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30"
                >
                  <CheckCircle className="h-3 w-3" />
                  {entity}
                </span>
              ))}
            </div>
          </ScratchpadSection>
        )}

        {/* Current Intent */}
        <ScratchpadSection
          icon={<Zap className="h-4 w-4" />}
          title="Current Intent"
          expanded={expandedSections.has("intent")}
          onToggle={() => toggleSection("intent")}
        >
          <span
            className={cn(
              "px-2 py-1 rounded text-xs font-medium border",
              intentColors[scratchpad.currentIntent] || intentColors.unknown
            )}
          >
            {scratchpad.currentIntent || "unknown"}
          </span>
        </ScratchpadSection>

        {/* Safety Counters */}
        <ScratchpadSection
          icon={<Gauge className="h-4 w-4" />}
          title="Safety Counters"
          expanded={expandedSections.has("counters")}
          onToggle={() => toggleSection("counters")}
        >
          <div className="space-y-2">
            <CounterBar
              label="Steps"
              current={scratchpad.stepCount}
              max={MAX_STEPS}
            />
            <CounterBar
              label="Tool Calls"
              current={scratchpad.toolCallCount}
              max={MAX_TOOL_CALLS}
            />
            <CounterBar
              label="Planning"
              current={scratchpad.planningCallCount}
              max={MAX_PLANNING_CALLS}
            />
          </div>
        </ScratchpadSection>

        {/* Last Tool Call */}
        {scratchpad.lastToolCall && (
          <div className="flex items-center gap-2 text-xs text-content-muted">
            <Clock className="h-3 w-3" />
            <span>Last tool: {scratchpad.lastToolCall}</span>
          </div>
        )}

        {/* Compaction Status */}
        {scratchpad.compactedAt && (
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            <span>
              Context compacted at step {scratchpad.compactedAt}
            </span>
          </div>
        )}

        {/* Errors */}
        {scratchpad.errors && scratchpad.errors.length > 0 && (
          <div className="space-y-1 p-2 rounded bg-red-500/10 border border-red-500/30">
            <div className="flex items-center gap-1.5 text-xs font-medium text-red-400">
              <AlertTriangle className="h-3 w-3" />
              Errors
            </div>
            {scratchpad.errors.map((error, i) => (
              <p key={i} className="text-xs text-red-300">
                {error}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface ScratchpadSectionProps {
  icon: React.ReactNode;
  title: string;
  count?: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function ScratchpadSection({
  icon,
  title,
  count,
  expanded,
  onToggle,
  children,
}: ScratchpadSectionProps) {
  return (
    <div className="border border-edge rounded-md overflow-hidden">
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full px-2 py-1.5 bg-surface-hover/30 hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2 text-content-secondary">
          {icon}
          <span className="text-xs font-medium">{title}</span>
          {count !== undefined && (
            <span className="text-xs text-content-muted">({count})</span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="h-3 w-3 text-content-muted" />
        ) : (
          <ChevronDown className="h-3 w-3 text-content-muted" />
        )}
      </button>
      {expanded && <div className="px-2 py-2">{children}</div>}
    </div>
  );
}

interface CounterBarProps {
  label: string;
  current: number;
  max: number;
}

function CounterBar({ label, current, max }: CounterBarProps) {
  const percentage = (current / max) * 100;
  const isWarning = percentage > 75;
  const isDanger = percentage >= 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-content-muted">{label}</span>
        <span
          className={cn(
            "font-mono",
            isDanger
              ? "text-red-400"
              : isWarning
                ? "text-amber-400"
                : "text-content-secondary"
          )}
        >
          {current}/{max}
        </span>
      </div>
      <div className="h-1.5 bg-surface-hover rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isDanger
              ? "bg-red-500"
              : isWarning
                ? "bg-amber-500"
                : "bg-green-500"
          )}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  );
}

// ============================================================================
// COMPACT SCRATCHPAD (for sidebar)
// ============================================================================

interface CompactScratchpadProps {
  threadId: string;
  className?: string;
}

export function CompactScratchpad({
  threadId,
  className,
}: CompactScratchpadProps) {
  const scratchpad = useQuery(
    api.domains.agents.agentScratchpads?.getScratchpad as any,
    threadId ? { threadId } : "skip"
  ) as Scratchpad | null | undefined;

  if (!scratchpad) {
    return null;
  }

  const stepProgress = (scratchpad.stepCount / MAX_STEPS) * 100;
  const isWarning = stepProgress > 75;
  const isDanger = stepProgress >= 100;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1 rounded text-xs",
        isDanger
          ? "bg-red-500/10 text-red-400"
          : isWarning
            ? "bg-amber-500/10 text-amber-400"
            : "bg-surface-hover text-content-muted",
        className
      )}
    >
      <Brain className="h-3 w-3" />
      <span>{scratchpad.activeEntities.length} entities</span>
      <span className="opacity-50">|</span>
      <span>
        {scratchpad.stepCount}/{MAX_STEPS}
      </span>
    </div>
  );
}

export default ScratchpadView;
