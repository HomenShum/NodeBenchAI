// src/components/views/LiveAgentLanes.tsx
// Multi-agent parallel streaming visualization
// Matches existing LiveAgentTicker aesthetic (glass containers, AgentIcon, ToolChip)

import React, { useMemo } from "react";
import {
  Users,
  FileText,
  Database,
  Briefcase,
  Globe,
  Bot,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Zap,
} from "lucide-react";
import { useAgentLanes, useLaneEvents, type Delegation, type AgentName } from "@/hooks/useAgentLanes";

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TYPES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

interface LiveAgentLanesProps {
  runId: string | undefined;
  className?: string;
}

interface LaneCardProps {
  delegation: Delegation;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// AGENT ICONS (matches LiveDossierDocument.tsx)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const agentIcons: Record<AgentName, React.ReactNode> = {
  DocumentAgent: <FileText className="w-4 h-4" />,
  MediaAgent: <Database className="w-4 h-4" />,
  SECAgent: <Briefcase className="w-4 h-4" />,
  OpenBBAgent: <Globe className="w-4 h-4" />,
  EntityResearchAgent: <Users className="w-4 h-4" />,
};

const agentLabels: Record<AgentName, string> = {
  DocumentAgent: "Documents",
  MediaAgent: "Media",
  SECAgent: "SEC",
  OpenBBAgent: "Finance",
  EntityResearchAgent: "Research",
};

const statusColors = {
  scheduled: "bg-surface-secondary/20 text-content-muted border-edge/30",
  running: "bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
  completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
  cancelled: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

const statusIcons = {
  scheduled: <Loader2 className="w-3 h-3 text-content-muted" />,
  running: <Loader2 className="w-3 h-3 text-indigo-600 dark:text-indigo-400 motion-safe:animate-spin" />,
  completed: <CheckCircle2 className="w-3 h-3 text-emerald-400" />,
  failed: <AlertCircle className="w-3 h-3 text-red-400" />,
  cancelled: <AlertCircle className="w-3 h-3 text-yellow-400" />,
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// LANE CARD (individual agent stream)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function LaneCard({ delegation }: LaneCardProps) {
  const { text, toolsUsed, isStreaming } = useLaneEvents(delegation.delegationId);

  const truncatedText = useMemo(() => {
    if (!text) return "";
    // Show last 500 chars for streaming preview
    return text.length > 500 ? "..." + text.slice(-500) : text;
  }, [text]);

  const isActive = delegation.status === "running" || delegation.status === "scheduled";

  return (
    <div
      className={`
        relative overflow-hidden rounded-lg border transition-all duration-300
        ${isActive ? 'border-indigo-500/30 shadow-lg shadow-[rgb(79, 70, 229)]/10' : 'border-edge'}
        bg-gradient-to-br from-surface/80 to-surface-secondary/80 backdrop-blur-sm
      `}
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-3 border-b border-edge">
        {/* Agent Icon */}
        <div className={`
          relative w-8 h-8 rounded-lg border flex items-center justify-center
          transition-all duration-300 ${statusColors[delegation.status]}
        `}>
          {agentIcons[delegation.agentName] || <Bot className="w-4 h-4" />}
          {isActive && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-indigo-600 rounded-full motion-safe:animate-pulse" />
          )}
        </div>

        {/* Agent Name & Status */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">
              {agentLabels[delegation.agentName]}
            </span>
            <span className={`
              flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium
              ${statusColors[delegation.status]}
            `}>
              {statusIcons[delegation.status]}
              <span className="capitalize">{delegation.status}</span>
            </span>
          </div>
          <p className="text-xs text-white/50 truncate mt-0.5">
            {delegation.query.slice(0, 60)}{delegation.query.length > 60 ? "..." : ""}
          </p>
        </div>
      </div>

      {/* Tools Used */}
      {toolsUsed.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-edge">
          {toolsUsed.slice(0, 4).map((tool) => (
            <span
              key={tool}
              className="px-2 py-0.5 rounded-full bg-indigo-600/10 border border-indigo-500/20 text-xs text-indigo-600 dark:text-indigo-400"
            >
              {tool}
            </span>
          ))}
          {toolsUsed.length > 4 && (
            <span className="px-2 py-0.5 rounded-full bg-surface-secondary/10 border border-edge/20 text-xs text-content-muted">
              +{toolsUsed.length - 4} more
            </span>
          )}
        </div>
      )}

      {/* Streaming Text Preview */}
      <div className="p-3 max-h-32 overflow-y-auto">
        {text ? (
          <p className="text-xs text-white/70 font-mono leading-relaxed whitespace-pre-wrap">
            {truncatedText}
            {isStreaming && (
              <span className="inline-block w-1.5 h-4 bg-indigo-600 ml-0.5 motion-safe:animate-pulse" />
            )}
          </p>
        ) : isActive ? (
          <div className="flex items-center gap-2 text-white/40 text-xs">
            <Loader2 className="w-3 h-3 motion-safe:animate-spin" />
            <span>Initializing...</span>
          </div>
        ) : delegation.status === "failed" ? (
          <p className="text-xs text-red-400">
            {delegation.errorMessage || "Delegation failed"}
          </p>
        ) : null}
      </div>

      {/* Completed indicator */}
      {delegation.status === "completed" && (
        <div className="absolute top-2 right-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        </div>
      )}
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MAIN COMPONENT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

export function LiveAgentLanes({ runId, className = "" }: LiveAgentLanesProps) {
  const { delegations, isLoading, hasActiveDelegations, completedCount, totalCount } =
    useAgentLanes(runId) as {
      delegations: Delegation[];
      isLoading: boolean;
      hasActiveDelegations: boolean;
      completedCount: number;
      totalCount: number;
    };

  // Don't render if no delegations
  if (!runId || (delegations.length === 0 && !isLoading)) {
    return null;
  }

  return (
    <div className={`${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <span className="text-sm font-semibold text-white">Parallel Agents</span>
          {hasActiveDelegations && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-600/20 border border-indigo-500/30">
              <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full motion-safe:animate-pulse" />
              <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">LIVE</span>
            </span>
          )}
        </div>
        <span className="text-xs text-white/40">
          {completedCount}/{totalCount} complete
        </span>
      </div>

      {/* Loading State */}
      {isLoading && delegations.length === 0 && (
        <div className="flex items-center justify-center py-8 text-white/40">
          <Loader2 className="w-5 h-5 motion-safe:animate-spin mr-2" />
          <span className="text-sm">Loading agent lanes...</span>
        </div>
      )}

      {/* Lanes Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {delegations.map((delegation) => (
          <LaneCard key={delegation.delegationId} delegation={delegation} />
        ))}
      </div>
    </div>
  );
}

export default LiveAgentLanes;

