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

import React, { useState, useCallback, useMemo, lazy, Suspense, useId } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import {
  Bot,
  Zap,
  Activity,
  ChevronDown,
  ChevronUp,
  Cpu,
  ClipboardList,
  ExternalLink,
} from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import { loadAgentsViewMode, saveAgentsViewMode } from "@/features/controlPlane/lib/onboardingState";

// Shared UI components
import { TopDividerBar } from "@shared/ui/TopDividerBar";
import { UnifiedHubPills } from "@/shared/ui/UnifiedHubPills";
import { PageHeroHeader } from "@shared/ui/PageHeroHeader";

// Agent-specific components (always visible on initial render)
import { AgentStatusCard, AGENT_CONFIGS, type AgentStatus } from "../components/AgentStatusCard";
import { AgentCommandBar, type ApprovedModel } from "../components/AgentCommandBar";

// Lazy-loaded heavy sub-components (behind tabs/expandable sections/conditional rendering)
const HumanApprovalQueue = lazy(() =>
  import("../components/HumanApprovalQueue").then((mod) => ({ default: mod.HumanApprovalQueue }))
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
import { useFastAgent } from "@/features/agents/context/FastAgentContext";

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

export async function routeAgentCommand(
  query: string,
  options: { model: ApprovedModel; agents?: string[] },
  actions: {
    canSpawn?: boolean;
    spawnSwarm: (params: {
      query: string;
      agents: string[];
      pattern: "fan_out_gather";
      model: ApprovedModel;
    }) => Promise<unknown>;
    openWithContext: (options: { initialMessage: string; initialTab: "chat" }) => void;
  },
) {
  if (options.agents && options.agents.length > 0 && actions.canSpawn !== false) {
    await actions.spawnSwarm({
      query,
      agents: options.agents,
      pattern: "fan_out_gather",
      model: options.model,
    });
    return;
  }

  actions.openWithContext({ initialMessage: query, initialTab: "chat" });
}

// ============================================================================
// Agent Grid Component
// ============================================================================

export function AgentGrid() {
  const agentStatuses = useQuery(
    api.domains.agents.agentHubQueries.getAllAgentStatuses
  ) as AgentStatusData[] | undefined;

  if (agentStatuses === undefined) {
    return (
      <div
        className="nb-surface-card px-4 py-6 text-sm text-content-muted"
        role="status"
      >
        Loading live agent status...
      </div>
    );
  }

  const formatTimeAgo = (timestamp: number | null): string => {
    if (!timestamp) return "No recorded activity";
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const agents = agentStatuses
    .filter((statusData) => Boolean(AGENT_CONFIGS[statusData.agentType]))
    .map((statusData) => {
      return {
        id: statusData.agentType,
        status: statusData.status as AgentStatus,
        lastActivity: formatTimeAgo(statusData.lastActivity),
        tasksCompleted: statusData.tasksCompleted,
        currentTask: statusData.currentTask || undefined,
      };
    });

  if (agents.length === 0) {
    return (
      <div className="nb-surface-card px-4 py-6 text-sm text-content-muted">
        No agent runtime activity has been recorded.
      </div>
    );
  }

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
  const contentId = useId();

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
        aria-expanded={isExpanded}
        aria-controls={contentId}
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
        <div id={contentId} className="border-t border-edge">
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

export function AgentsHub() {
  const { isAuthenticated } = useConvexAuth();
  const [advancedMode, setAdvancedMode] = useState(() => {
    return loadAgentsViewMode() === "advanced";
  });
  const [commandError, setCommandError] = useState<string | null>(null);
  const toggleMode = useCallback(() => {
    setAdvancedMode((prev) => {
      const next = !prev;
      saveAgentsViewMode(next ? "advanced" : "basic");
      return next;
    });
  }, []);

  const { spawnSwarm } = useSwarmActions();
  const { openWithContext } = useFastAgent();

  const handleCommandSubmit = useCallback(
    async (
      query: string,
      options: { model: ApprovedModel; agents?: string[] }
    ) => {
      try {
        setCommandError(null);
        await routeAgentCommand(query, options, { canSpawn: isAuthenticated, spawnSwarm, openWithContext });
      } catch {
        setCommandError("NodeBench could not start that request. Try again or review the active runtime status.");
      }
    },
    [isAuthenticated, openWithContext, spawnSwarm]
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
              <AgentCommandBar onSubmit={handleCommandSubmit} allowSpawn={isAuthenticated} />
              {commandError ? (
                <p
                  className="mt-2 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300"
                  role="alert"
                >
                  {commandError}
                </p>
              ) : null}
            </div>

            <div className="mb-6">
              <Suspense fallback={<div className="h-[100px]" />}>
                <TopicCanvasPanel />
              </Suspense>
            </div>


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

            {/* Mode toggle */}
            <div className="mb-6">
              <button
                type="button"
                onClick={toggleMode}
                className="flex items-center gap-2 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-content-muted transition hover:bg-surface-hover hover:text-content-secondary"
              >
                <Cpu className="h-3.5 w-3.5" />
                {advancedMode ? "Show less" : "Advanced view"}
              </button>
            </div>

            {/* ── Advanced sections ── */}
            {advancedMode && (
              <>
                {/* Autonomous operations are deliberate operator controls, not landing-page chrome. */}
                <div className="mb-6">
                  <Suspense fallback={<div className="h-[64px]" />}>
                    <AutonomousOperationsPanel />
                  </Suspense>
                </div>

                {/* Oracle Control Tower */}
                <div className="mb-6">
                  <Suspense fallback={<div className="h-[120px]" />}>
                    <OracleControlTowerPanel />
                  </Suspense>
                </div>

                {/* Agent runtime is owner-scoped; guests never receive invented idle rows. */}
                {isAuthenticated ? (
                  <div className="mb-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Activity className="w-4 h-4 text-accent" />
                      <h2 className="type-section-title text-content">
                        Agent runtime
                      </h2>
                    </div>
                    <AgentGrid />
                  </div>
                ) : null}

                {/* Free Model Rankings */}
                <div className="mb-6">
                  <Suspense fallback={<div className="h-[200px]" />}>
                    <FreeModelRankingsPanel />
                  </Suspense>
                </div>

                {/* Private task history is owner-scoped and absent for guests. */}
                {isAuthenticated ? (
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
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AgentsHub;
