// src/hooks/useAgentLanes.ts
// Frontend subscription hooks for parallel agent delegation
// Subscribes to agentDelegations + agentWriteEvents for live multi-lane streaming

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useMemo, useRef, useState, useEffect } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type AgentName = 
  | "DocumentAgent" 
  | "MediaAgent" 
  | "SECAgent" 
  | "OpenBBAgent" 
  | "EntityResearchAgent";

export type DelegationStatus = 
  | "scheduled" 
  | "running" 
  | "completed" 
  | "failed" 
  | "cancelled";

export type WriteEventKind = 
  | "delta" 
  | "tool_start" 
  | "tool_end" 
  | "note" 
  | "final";

export interface Delegation {
  _id: string;
  runId: string;
  delegationId: string;
  userId: string;
  agentName: AgentName;
  query: string;
  status: DelegationStatus;
  scheduledAt: number;
  startedAt?: number;
  finishedAt?: number;
  subagentThreadId?: string;
  errorMessage?: string;
  mergeStatus?: "pending" | "merged" | "rejected";
}

export interface WriteEvent {
  _id: string;
  delegationId: string;
  seq: number;
  kind: WriteEventKind;
  textChunk?: string;
  toolName?: string;
  metadata?: any;
  createdAt: number;
}

export interface AgentLane {
  delegation: Delegation;
  text: string;
  toolsUsed: string[];
  isStreaming: boolean;
  lastEventSeq: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOKS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Subscribe to all delegations for a run
 * Returns list of active agent lanes
 */
export function useAgentLanes(runId: string | undefined) {
  const delegations = useQuery(
    api.domains.agents.agentDelegations.listByRun,
    runId ? { runId } : "skip"
  ) as Delegation[] | undefined;
  
  const lanes = useMemo(() => {
    if (!delegations) return [];
    return delegations;
  }, [delegations]);
  
  const hasActiveDelegations = useMemo(() => {
    return lanes.some(d => d.status === "running" || d.status === "scheduled");
  }, [lanes]);
  
  const completedCount = useMemo(() => {
    return lanes.filter(d => d.status === "completed").length;
  }, [lanes]);
  
  return { 
    delegations: lanes,
    isLoading: delegations === undefined,
    hasActiveDelegations,
    completedCount,
    totalCount: lanes.length,
  };
}

/**
 * Subscribe to write events for a single delegation lane
 * INCREMENTAL: Only appends new chunks to avoid re-joining full text every tick
 * 
 * @param delegationId - The delegation to subscribe to
 */
export function useLaneEvents(delegationId: string | undefined) {
  // Persistent state across renders
  const [text, setText] = useState("");
  const [toolsUsed, setToolsUsed] = useState<string[]>([]);
  const [hasFinal, setHasFinal] = useState(false);
  const lastSeqRef = useRef(-1);
  const prevDelegationIdRef = useRef<string | undefined>(undefined);
  
  // Reset state when delegationId changes
  useEffect(() => {
    if (delegationId !== prevDelegationIdRef.current) {
      setText("");
      setToolsUsed([]);
      setHasFinal(false);
      lastSeqRef.current = -1;
      prevDelegationIdRef.current = delegationId;
    }
  }, [delegationId]);
  
  // Query for events after lastSeq (incremental fetch)
  const events = useQuery(
    api.domains.agents.agentDelegations.getWriteEvents,
    delegationId ? { 
      delegationId, 
      afterSeq: lastSeqRef.current >= 0 ? lastSeqRef.current : undefined,
      limit: 100 
    } : "skip"
  ) as WriteEvent[] | undefined;
  
  // Process only NEW events and append to state
  useEffect(() => {
    if (!events || events.length === 0) return;
    
    // Sort by seq and filter to only new events
    const sorted = [...events].sort((a, b) => a.seq - b.seq);
    const newEvents = sorted.filter(e => e.seq > lastSeqRef.current);
    
    if (newEvents.length === 0) return;
    
    // Update lastSeq
    const maxSeq = Math.max(...newEvents.map(e => e.seq));
    lastSeqRef.current = maxSeq;
    
    // Accumulate new text chunks
    const newChunks: string[] = [];
    const newTools: string[] = [];
    let foundFinal = false;
    
    for (const event of newEvents) {
      if (event.kind === "delta" || event.kind === "final") {
        if (event.textChunk) {
          newChunks.push(event.textChunk);
        }
        if (event.kind === "final") {
          foundFinal = true;
        }
      }
      
      if (event.kind === "tool_end" && event.toolName) {
        newTools.push(event.toolName);
      }
    }
    
    // Append to state (not replace)
    if (newChunks.length > 0) {
      setText(prev => prev + newChunks.join(""));
    }
    if (newTools.length > 0) {
      setToolsUsed(prev => {
        const combined = [...prev];
        for (const t of newTools) {
          if (!combined.includes(t)) combined.push(t);
        }
        return combined;
      });
    }
    if (foundFinal) {
      setHasFinal(true);
    }
  }, [events]);
  
  return {
    events,
    text,
    toolsUsed,
    lastSeq: lastSeqRef.current,
    isStreaming: !hasFinal && delegationId !== undefined,
    isLoading: events === undefined && delegationId !== undefined,
  };
}

/**
 * Combined hook for a complete agent lane with events
 * Convenience wrapper that combines delegation + events
 */
export function useAgentLane(delegationId: string | undefined) {
  const delegation = useQuery(
    api.domains.agents.agentDelegations.getByDelegationId,
    delegationId ? { delegationId } : "skip"
  ) as Delegation | null | undefined;
  
  const { text, toolsUsed, isStreaming, lastSeq } = useLaneEvents(delegationId);
  
  return {
    delegation,
    text,
    toolsUsed,
    isStreaming: delegation?.status === "running" || isStreaming,
    isCompleted: delegation?.status === "completed",
    isFailed: delegation?.status === "failed",
    lastSeq,
    isLoading: delegation === undefined,
  };
}

// Note: For rendering multiple lanes with events, use useAgentLanes() 
// to get delegations, then call useLaneEvents() per lane in the component.
// React hooks can't be called dynamically in loops.
