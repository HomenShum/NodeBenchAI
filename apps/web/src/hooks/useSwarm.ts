/**
 * useSwarm.ts
 *
 * Frontend hooks for swarm state management.
 * Provides real-time subscriptions for swarm status and task progress.
 */

import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useMemo, useCallback } from "react";
import type { Id } from "../../convex/_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type SwarmStatus =
  | "pending"
  | "spawning"
  | "executing"
  | "gathering"
  | "synthesizing"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface SwarmTask {
  _id: string;
  swarmId: string;
  taskId: string;
  delegationId?: string;
  agentName: string;
  query: string;
  role: string;
  stateKeyPrefix: string;
  status: TaskStatus;
  result?: string;
  resultSummary?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  elapsedMs?: number;
  errorMessage?: string;
}

export interface Swarm {
  _id: string;
  swarmId: string;
  userId: string;
  threadId: string;
  name?: string;
  query: string;
  pattern: "fan_out_gather" | "pipeline" | "swarm";
  status: SwarmStatus;
  agentConfigs: Array<{
    agentName: string;
    role: string;
    query: string;
    stateKeyPrefix: string;
  }>;
  mergedResult?: string;
  confidence?: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  elapsedMs?: number;
}

export interface SwarmProgress {
  total: number;
  completed: number;
  running: number;
  pending: number;
  percentComplete: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOKS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Subscribe to swarm status and tasks
 */
export function useSwarm(swarmId: string | undefined) {
  const swarmData = useQuery(
    api.domains.agents.swarmQueries.subscribeToSwarmTasks,
    swarmId ? { swarmId } : "skip"
  );

  const isActive = useMemo(() => {
    if (!swarmData?.swarm) return false;
    return ["pending", "spawning", "executing", "gathering", "synthesizing"].includes(
      swarmData.swarm.status
    );
  }, [swarmData?.swarm?.status]);

  return {
    swarm: swarmData?.swarm as Swarm | undefined,
    tasks: (swarmData?.tasks || []) as SwarmTask[],
    progress: swarmData?.progress as SwarmProgress | undefined,
    isActive,
    isLoading: swarmId !== undefined && swarmData === undefined,
    isCompleted: swarmData?.swarm?.status === "completed",
    isFailed: swarmData?.swarm?.status === "failed",
    mergedResult: swarmData?.swarm?.mergedResult,
  };
}

/**
 * Check if a thread has an active swarm
 */
export function useThreadSwarm(threadId: string | undefined) {
  const swarmInfo = useQuery(
    api.domains.agents.swarmQueries.isThreadSwarmActive,
    threadId ? { threadId } : "skip"
  );

  return {
    hasSwarm: swarmInfo?.hasSwarm || false,
    isActive: swarmInfo?.isActive || false,
    swarmId: swarmInfo?.swarmId,
    status: swarmInfo?.status as SwarmStatus | undefined,
    isLoading: threadId !== undefined && swarmInfo === undefined,
  };
}

/**
 * Get swarm by thread with full context
 */
export function useSwarmByThread(threadId: string | undefined) {
  const swarm = useQuery(
    api.domains.agents.swarmQueries.getSwarmByThread,
    threadId ? { threadId } : "skip"
  ) as Swarm | null | undefined;

  const swarmId = swarm?.swarmId;

  const tasksData = useQuery(
    api.domains.agents.swarmQueries.subscribeToSwarmTasks,
    swarmId ? { swarmId } : "skip"
  );

  const isActive = useMemo(() => {
    if (!swarm) return false;
    return ["pending", "spawning", "executing", "gathering", "synthesizing"].includes(
      swarm.status
    );
  }, [swarm?.status]);

  return {
    swarm,
    tasks: (tasksData?.tasks || []) as SwarmTask[],
    progress: tasksData?.progress as SwarmProgress | undefined,
    isActive,
    isLoading: threadId !== undefined && swarm === undefined,
    hasSwarm: !!swarm,
  };
}

/**
 * Actions for swarm management
 */
export function useSwarmActions() {
  const createSwarmAction = useAction(api.domains.agents.swarmOrchestrator.createSwarm);
  const cancelSwarmAction = useAction(api.domains.agents.swarmOrchestrator.cancelSwarm);

  const spawnSwarm = useCallback(
    async (params: {
      query: string;
      agents: string[];
      pattern?: "fan_out_gather" | "pipeline" | "swarm";
      model?: string;
    }) => {
      return createSwarmAction(params);
    },
    [createSwarmAction]
  );

  const cancelSwarm = useCallback(
    async (swarmId: string) => {
      return cancelSwarmAction({ swarmId });
    },
    [cancelSwarmAction]
  );

  return {
    spawnSwarm,
    cancelSwarm,
  };
}

/**
 * Get threads with swarm info for tab bar
 */
export function useThreadsWithSwarmInfo(limit?: number) {
  const threads = useQuery(
    api.domains.agents.swarmQueries.getThreadsWithSwarmInfo,
    { limit: limit || 20 }
  );

  return {
    threads: threads || [],
    isLoading: threads === undefined,
  };
}

/**
 * Parse /spawn command from input
 */
export function parseSpawnCommand(input: string): {
  query: string;
  agents: string[];
} | null {
  const AGENT_SHORTCUTS: Record<string, string> = {
    doc: "DocumentAgent",
    media: "MediaAgent",
    sec: "SECAgent",
    finance: "OpenBBAgent",
    research: "EntityResearchAgent",
  };

  const VALID_AGENTS = [
    "DocumentAgent",
    "MediaAgent",
    "SECAgent",
    "OpenBBAgent",
    "EntityResearchAgent",
  ];

  // Match: /spawn "query" --agents=doc,media,sec
  // Or: /spawn query --agents=doc,media,sec
  const spawnMatch = input.match(/^\/spawn\s+(.+?)(?:\s+--agents?=([^\s]+))?$/i);
  if (!spawnMatch) return null;

  let query = spawnMatch[1].trim();
  // Remove quotes if present
  if (
    (query.startsWith('"') && query.endsWith('"')) ||
    (query.startsWith("'") && query.endsWith("'"))
  ) {
    query = query.slice(1, -1);
  }

  // Parse agents
  let agents: string[] = [];
  if (spawnMatch[2]) {
    agents = spawnMatch[2].split(",").map((a) => {
      const trimmed = a.trim().toLowerCase();
      return AGENT_SHORTCUTS[trimmed] || trimmed;
    });
  } else {
    // Default agents if none specified
    agents = ["DocumentAgent", "MediaAgent", "SECAgent"];
  }

  // Validate agents
  agents = agents.filter((a) => VALID_AGENTS.includes(a));

  if (agents.length === 0) {
    agents = ["DocumentAgent", "MediaAgent", "SECAgent"];
  }

  return { query, agents };
}

/**
 * Check if input is a spawn command
 */
export function isSpawnCommand(input: string): boolean {
  return input.trim().toLowerCase().startsWith("/spawn ");
}
