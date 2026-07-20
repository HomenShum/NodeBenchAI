/**
 * AgentStatusCard.tsx
 *
 * Real-time agent status card with live subscriptions.
 * Displays only live agent status and task telemetry.
 */

import React, { memo } from "react";
import {
  FileText,
  Video,
  Building,
  TrendingUp,
  Search,
  Zap,
  Clock,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SignatureOrb } from "@/shared/ui/SignatureOrb";

// ============================================================================
// Types & Constants
// ============================================================================

export type AgentStatus = "active" | "idle" | "paused" | "running" | "error" | "complete";

export interface AgentConfig {
  id: string;
  name: string;
  shortName: string;
  description: string;
  icon: React.ElementType;
  colorClass: string;
  bgColorClass: string;
  borderColorClass: string;
}

export const AGENT_CONFIGS: Record<string, AgentConfig> = {
  coordinator: {
    id: "coordinator",
    name: "Coordinator Agent",
    shortName: "Coordinator",
    description: "Orchestrates subagents for complex tasks",
    icon: Zap,
    colorClass: "text-indigo-600",
    bgColorClass: "bg-indigo-500/10",
    borderColorClass: "border-indigo-500/20",
  },
  document: {
    id: "document",
    name: "Document Agent",
    shortName: "Document",
    description: "Document search, retrieval, creation",
    icon: FileText,
    colorClass: "text-blue-600",
    bgColorClass: "bg-blue-500/10",
    borderColorClass: "border-blue-500/20",
  },
  media: {
    id: "media",
    name: "Media Agent",
    shortName: "Media",
    description: "YouTube, web content, media analysis",
    icon: Video,
    colorClass: "text-purple-600",
    bgColorClass: "bg-purple-500/10",
    borderColorClass: "border-purple-500/20",
  },
  sec: {
    id: "sec",
    name: "SEC Agent",
    shortName: "SEC",
    description: "SEC filings and company info",
    icon: Building,
    colorClass: "text-amber-600",
    bgColorClass: "bg-amber-500/10",
    borderColorClass: "border-amber-500/20",
  },
  openbb: {
    id: "openbb",
    name: "Finance Agent",
    shortName: "Finance",
    description: "Stock, crypto, market data",
    icon: TrendingUp,
    colorClass: "text-green-600",
    bgColorClass: "bg-green-500/10",
    borderColorClass: "border-green-500/20",
  },
  arbitrage: {
    id: "arbitrage",
    name: "Research Agent",
    shortName: "Research",
    description: "Multi-source research with contradiction detection",
    icon: Search,
    colorClass: "text-cyan-600",
    bgColorClass: "bg-cyan-500/10",
    borderColorClass: "border-cyan-500/20",
  },
};

export interface AgentStatusCardProps {
  agentId: string;
  status: AgentStatus;
  lastActivity?: string;
  tasksCompleted?: number;
  currentTask?: string;
}

// ============================================================================
// Status Indicator Component
// ============================================================================

const StatusIndicator = memo(function StatusIndicator({ status }: { status: AgentStatus }) {
  const isLive = status === "active" || status === "running";
  const statusConfig = {
    active: { label: "Active" },
    running: { label: "Running" },
    idle: { dot: "status-dot pending", label: "Idle" },
    paused: { dot: "status-dot paused", label: "Paused" },
    error: { dot: "status-dot error", label: "Error", icon: AlertCircle },
    complete: { dot: "status-dot complete", label: "Complete", icon: CheckCircle },
  };

  const config = statusConfig[status];
  const Icon = "icon" in config ? config.icon : null;

  return (
    <div className="flex items-center gap-1.5" role="status" aria-label={`Agent status: ${config.label}`}>
      {isLive ? (
        <SignatureOrb variant="indicator" />
      ) : (
        <>
          {"dot" in config && <span className={cn("agent-dashboard", config.dot)} aria-hidden="true" />}
          {Icon && <Icon className="w-3 h-3" aria-hidden="true" />}
        </>
      )}
      <span className="text-xs font-medium text-content-secondary">
        {config.label}
      </span>
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

export const AgentStatusCard = memo(function AgentStatusCard({
  agentId,
  status,
  lastActivity,
  tasksCompleted = 0,
  currentTask,
}: AgentStatusCardProps) {
  const config = AGENT_CONFIGS[agentId] || AGENT_CONFIGS.coordinator;
  const Icon = config.icon;

  const isActive = status === "active" || status === "running";

  return (
    <div
      className={cn(
        "group bg-surface rounded-container border border-edge",
        "transition-all duration-200 hover:shadow-hover hover:bg-surface-secondary focus-within:ring-1 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-surface",
        isActive && "ring-1 ring-offset-1 ring-offset-surface ring-ring"
      )}
    >
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          {/* Agent Icon & Info */}
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center",
                config.bgColorClass,
                "border",
                config.borderColorClass
              )}
            >
              <Icon className={cn("w-5 h-5 transition-transform duration-200 group-hover:scale-[1.05]", config.colorClass)} aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-semibold text-content text-sm">
                {config.name}
              </h3>
              <p className="text-xs text-content-muted">
                {config.description}
              </p>
            </div>
          </div>

          {/* Status Badge */}
          <StatusIndicator status={status} />
        </div>

        {/* Current Task Preview (if running) */}
        {currentTask && isActive && (
          <div className="mt-3 p-2 bg-surface-secondary rounded-lg border border-edge">
            <div className="flex items-center gap-1.5 mb-1">
              <Loader2 className="w-3 h-3 motion-safe:animate-spin text-indigo-600 dark:text-indigo-400" />
              <span className="text-xs font-medium text-content-muted">
                Current Task
              </span>
            </div>
            <p className="text-xs text-content-secondary line-clamp-2">
              {currentTask}
            </p>
          </div>
        )}

        {/* Meta Info */}
        <div className="flex items-center gap-4 mt-3 text-xs text-content-muted">
          {lastActivity && (
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              <span>{lastActivity}</span>
            </div>
          )}
          {tasksCompleted > 0 && (
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5" />
              <span>{tasksCompleted} tasks</span>
            </div>
          )}
        </div>
      </div>

    </div>
  );
});

export default AgentStatusCard;
