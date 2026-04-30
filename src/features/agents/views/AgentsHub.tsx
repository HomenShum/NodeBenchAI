/**
 * AgentsHub - Central hub for viewing and managing AI agents
 *
 * Redesigned to match Documents/Calendar hub patterns with:
 * - TopDividerBar + PageHeroHeader layout
 * - Collapsible sidebar with queue, recent runs, memory stats
 * - Real-time agent status cards with live subscriptions
 * - Command bar with /spawn syntax support
 * - Swarm visualization for parallel execution
 * - Human-in-the-loop approval queue
 */

import React, { useState, useCallback, useMemo, lazy, Suspense } from "react";
import { useQuery, useAction } from "convex/react";
import {
  Bot,
  Zap,
  Sparkles,
  TrendingUp,
  Activity,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Cpu,
  ClipboardList,
  ExternalLink,
  PanelTop,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "../../../../convex/_generated/api";
import { loadAgentsViewMode, saveAgentsViewMode } from "@/features/controlPlane/lib/onboardingState";

// Shared UI components
import { TopDividerBar } from "@shared/ui/TopDividerBar";
import { UnifiedHubPills } from "@/shared/ui/UnifiedHubPills";
import { PageHeroHeader } from "@shared/ui/PageHeroHeader";

// Agent-specific components (always visible on initial render)
import { AgentStatusCard, AGENT_CONFIGS, type AgentStatus } from "../components/AgentStatusCard";
import { AgentCommandBar, type AgentMode, type ApprovedModel } from "../components/AgentCommandBar";

// Lazy-loaded heavy sub-components (behind tabs/expandable sections/conditional rendering)
const HumanApprovalQueue = lazy(() =>
  import("../components/HumanApprovalQueue").then((mod) => ({ default: mod.HumanApprovalQueue }))
);
const AgentSidebar = lazy(() =>
  import("../components/AgentSidebar").then((mod) => ({ default: mod.AgentSidebar }))
);
const AutonomousOperationsPanel = lazy(() =>
  import("../components/AutonomousOperationsPanel").then((mod) => ({ default: mod.AutonomousOperationsPanel }))
);
const OracleControlTowerPanel = lazy(() =>
  import("../components/OracleControlTowerPanel").then((mod) => ({ default: mod.OracleControlTowerPanel }))
);
const TopicCanvasPanel = lazy(() =>
  import("../components/TopicCanvasPanel").then((mod) => ({ default: mod.TopicCanvasPanel }))
);
const SwarmLanesView = lazy(() =>
  import("../components/FastAgentPanel/SwarmLanesView").then((mod) => ({ default: mod.SwarmLanesView }))
);
const FreeModelRankingsPanel = lazy(() =>
  import("../components/FreeModelRankingsPanel").then((mod) => ({ default: mod.FreeModelRankingsPanel }))
);
const TaskManagerView = lazy(() =>
  import("../components/TaskManager").then((mod) => ({ default: mod.TaskManagerView }))
);

// Hooks
import { useSwarmActions } from "@/hooks/useSwarm";

// ============================================================================
// Types
// ============================================================================

interface AgentStatusData {
  agentType: string;
  status: "running" | "idle";
  lastActivity: number | null;
  tasksCompleted: number;
  currentTask: string | null;
}

// ============================================================================
// Quick Stats Component
// ============================================================================

function QuickStatsBar() {
  const stats = useQuery(api.domains.agents.agentHubQueries.getAgentStats);
  const costMetrics = useQuery(
    api.domains.agents.agentHubQueries.getCostSavingsMetrics,
    { windowHours: 24 }
  );

  if (!stats) {
    return (
      <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="nb-surface-card p-4 no-skeleton-animation"
            aria-busy="true"
          >
            <div className="h-6 w-12 bg-surface-secondary rounded mb-1" />
            <div className="h-4 w-20 bg-surface-secondary rounded" />
          </div>
        ))}
      </div>
    );
  }

  const statItems = [
    {
      value: stats.totalAgents,
      label: "AI Assistants",
      icon: Bot,
      color: "text-accent",
    },
    {
      value: stats.activeNow,
      label: "Active Now",
      icon: Activity,
      color: stats.activeNow > 0 ? "text-content" : "text-content-muted",
    },
    {
      value: stats.tasksCompleted,
      label: "Tasks Completed",
      icon: TrendingUp,
      color: "text-content",
    },
    {
      value: `${stats.successRate}%`,
      label: "Success Rate",
      icon: Sparkles,
      color: "text-content-secondary",
    },
    {
      value: costMetrics ? `$${costMetrics.dollarsSaved.toFixed(2)}` : "$0.00",
      label: "Cost Saved (24h)",
      icon: DollarSign,
      color: "text-content",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {statItems.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className="nb-surface-card p-4"
          >
            <div className="flex items-center gap-2">
              <Icon className={cn("w-4 h-4", item.color)} />
              <span className={cn("text-2xl font-bold", item.color)}>
                {item.value}
              </span>
            </div>
            <p className="text-xs text-content-muted mt-1">{item.label}</p>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Agent Grid Component
// ============================================================================

function AgentGrid() {
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());

  const agentStatuses = useQuery(
    api.domains.agents.agentHubQueries.getAllAgentStatuses
  ) as AgentStatusData[] | undefined;

  const toggleExpand = useCallback((agentId: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  }, []);

  const formatTimeAgo = (timestamp: number | null): string => {
    if (!timestamp) return "Never";
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  // Use static agent list if query is loading
  const agents = useMemo(() => {
    const agentTypes = ["coordinator", "document", "media", "sec", "openbb", "arbitrage"];

    return agentTypes.map((agentType) => {
      const statusData = agentStatuses?.find((s) => s.agentType === agentType);
      return {
        id: agentType,
        status: (statusData?.status || "idle") as AgentStatus,
        lastActivity: formatTimeAgo(statusData?.lastActivity || null),
        tasksCompleted: statusData?.tasksCompleted || 0,
        currentTask: statusData?.currentTask || undefined,
      };
    });
  }, [agentStatuses]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {agents.map((agent) => (
        <AgentStatusCard
          key={agent.id}
          agentId={agent.id}
          status={agent.status}
          lastActivity={agent.lastActivity}
          tasksCompleted={agent.tasksCompleted}
          currentTask={agent.currentTask}
          isExpanded={expandedAgents.has(agent.id)}
          onToggleExpand={() => toggleExpand(agent.id)}
          onConfigure={() => {}}
          onToggleStatus={() => {}}
        />
      ))}
    </div>
  );
}

// ============================================================================
// Active Swarms Section
// ============================================================================

function ActiveSwarmsSection() {
  const [isExpanded, setIsExpanded] = useState(true);

  const activeSwarms = useQuery(api.domains.agents.agentHubQueries.getActiveSwarms, {
    limit: 5,
  });

  // Filter to only active swarms
  const runningSwarms = useMemo(() => {
    return (
      activeSwarms?.filter((s) =>
        ["pending", "spawning", "executing", "gathering", "synthesizing"].includes(
          s.status
        )
      ) || []
    );
  }, [activeSwarms]);

  if (runningSwarms.length === 0) {
    return null;
  }

  return (
    <div className="nb-surface-card">
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <h3 className="type-section-title text-content">
            Running Tasks
          </h3>
          <span className="px-1.5 py-0.5 rounded-full text-xs font-medium bg-accent/10 text-accent border border-accent/20">
            {runningSwarms.length}
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
        <div className="border-t border-edge">
          <Suspense fallback={<div className="p-4 text-xs text-content-muted">Loading swarm...</div>}>
            {runningSwarms.map((swarm) => (
              <SwarmLanesView
                key={swarm.swarmId}
                threadId={swarm.threadId}
                className="border-b last:border-b-0 border-edge"
              />
            ))}
          </Suspense>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

function QuickActionsSummary({ onShowAdvanced }: { onShowAdvanced: () => void }) {
  return (
    <div className="nb-surface-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <PanelTop className="h-4 w-4 text-accent" />
            <h2 className="type-section-title text-content">Quick actions</h2>
          </div>
          <p className="mt-2 text-sm text-content-secondary">
            Start a request, review running tasks, or approve blocked work without opening the full operator cockpit.
          </p>
        </div>
        <button
          type="button"
          onClick={onShowAdvanced}
          className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-content-muted transition hover:bg-surface-hover hover:text-content-secondary"
        >
          Open advanced view
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {[
          {
            title: "Run a request",
            body: "Use the command bar to launch research, compare sources, or hand work to an agent.",
          },
          {
            title: "Review active work",
            body: "The running tasks lane below is the fastest way to see what the system is doing right now.",
          },
          {
            title: "Approve blocked actions",
            body: "Use the human approval queue for any step that needs review before it can continue.",
          },
        ].map((item) => (
          <div key={item.title} className="rounded-xl border border-edge bg-surface-secondary/40 p-4">
            <div className="text-sm font-medium text-content">{item.title}</div>
            <p className="mt-1 text-xs leading-relaxed text-content-muted">{item.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgentsHub() {
  const [advancedMode, setAdvancedMode] = useState(() => {
    return loadAgentsViewMode() === "advanced";
  });
  const setViewMode = useCallback((mode: "basic" | "advanced") => {
    saveAgentsViewMode(mode);
    setAdvancedMode(mode === "advanced");
  }, []);
  const toggleMode = useCallback(() => {
    setAdvancedMode((prev) => {
      const next = !prev;
      saveAgentsViewMode(next ? "advanced" : "basic");
      return next;
    });
  }, []);

  const { spawnSwarm } = useSwarmActions();

  const handleCommandSubmit = useCallback(
    async (
      query: string,
      options: { mode: AgentMode; model: ApprovedModel; agents?: string[] }
    ) => {

      if (options.agents && options.agents.length > 0) {
        // Spawn swarm
        try {
          await spawnSwarm({
            query,
            agents: options.agents,
            pattern: "fan_out_gather",
            model: options.model,
          });
        } catch (error) {
          console.error("Failed to spawn swarm:", error);
        }
      } else {
        // Single agent query - would route to FastAgentPanel
      }
    },
    [spawnSwarm]
  );

  return (
    <div className="nb-page-shell view-atmosphere-agents">
      <div className="nb-page-inner">
        <div className="nb-page-frame flex gap-6 stagger [&>*]:animate-[fade-slide-in_0.5s_var(--ease-out-expo)_both]">
          {/* Main Content */}
          <div className="flex-1 min-w-0">
            {/* Top Divider Bar */}
            <TopDividerBar
              left={
                <UnifiedHubPills active="agents" showRoadmap roadmapDisabled={false} />
              }
            />

            {/* Hero Header */}
            <PageHeroHeader
              icon={<Bot className="w-6 h-6" />}
              title="AI Assistants"
              subtitle="Direct AI to research, analyze, and automate tasks for you"
              accent
              className="mb-6"
            />

            {/* Command Bar — always visible */}
            <div className="mb-6">
              <AgentCommandBar onSubmit={handleCommandSubmit} />
            </div>

            <div className="mb-6">
              <Suspense fallback={<div className="h-[100px]" />}>
                <TopicCanvasPanel />
              </Suspense>
            </div>

            {!advancedMode && (
              <div className="mb-6">
                <QuickActionsSummary onShowAdvanced={() => setViewMode("advanced")} />
              </div>
            )}

            {/* Active Swarms — always visible */}
            <div className="mb-6">
              <ActiveSwarmsSection />
            </div>

            {/* Human Approval Queue — always visible */}
            <div className="mb-6">
              <Suspense fallback={<div className="h-[80px]" />}>
                <HumanApprovalQueue />
              </Suspense>
            </div>

            {/* Autonomous Operations Status - always visible for operator QA */}
            <div className="mb-6">
              <Suspense fallback={<div className="h-[120px]" />}>
                <AutonomousOperationsPanel />
              </Suspense>
            </div>

            {/* Mode toggle */}
            <div className="mb-6 flex items-center justify-between">
              <button
                type="button"
                onClick={toggleMode}
                className="flex items-center gap-2 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-content-muted transition hover:bg-surface-hover hover:text-content-secondary"
              >
                <Cpu className="h-3.5 w-3.5" />
                {advancedMode ? "Show less" : "Advanced view"}
              </button>
              {!advancedMode && (
                <p className="text-[11px] text-content-muted">
                  Advanced view adds the operator sidebar, Oracle controls, stats, rankings, and task history.
                </p>
              )}
            </div>

            {/* ── Advanced sections ── */}
            {advancedMode && (
              <>
                {/* Quick Stats */}
                <div className="mb-6">
                  <QuickStatsBar />
                </div>

                {/* Oracle Control Tower */}
                <div className="mb-6">
                  <Suspense fallback={<div className="h-[120px]" />}>
                    <OracleControlTowerPanel />
                  </Suspense>
                </div>

                {/* Agent Status Grid */}
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity className="w-4 h-4 text-accent" />
                    <h2 className="type-section-title text-content">
                      Available Agents
                    </h2>
                  </div>
                  <AgentGrid />
                </div>

                {/* Free Model Rankings */}
                <div className="mb-6">
                  <Suspense fallback={<div className="h-[200px]" />}>
                    <FreeModelRankingsPanel />
                  </Suspense>
                </div>

                {/* Task Manager - Agent Task History & Telemetry */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <ClipboardList className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      <h2 className="type-section-title text-content">
                        Task History
                      </h2>
                    </div>
                    <a
                      href="/#activity"
                      className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:text-indigo-300 hover:underline"
                    >
                      Public Feed <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div className="nb-surface-card overflow-hidden h-[500px]">
                    <Suspense fallback={<div className="h-full flex items-center justify-center text-xs text-content-muted">Loading tasks...</div>}>
                      <TaskManagerView isPublic={false} className="h-full" />
                    </Suspense>
                  </div>
                </div>
              </>
            )}

            {/* Background Research Banner — always visible */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-6">
              <div className="flex items-center gap-3 mb-2">
                <Sparkles className="w-5 h-5 text-accent" />
                <h3 className="font-semibold text-content">
                  Background Research Active
                </h3>
              </div>
              <p className="text-sm text-content-secondary">
                AI is continuously researching in the background — scanning news, processing signals,
                and publishing updates at no extra cost.
                More powerful analysis runs when you ask for deep research.
              </p>
            </div>
          </div>

          {/* Sidebar */}
          {advancedMode ? <Suspense fallback={<div className="w-64" />}><AgentSidebar /></Suspense> : null}
        </div>
      </div>
    </div>
  );
}

export default AgentsHub;
