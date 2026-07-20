/**
 * useOracleSession — Frontend hook for Oracle-tracked task sessions
 *
 * Provides a lifecycle API for creating, updating, and completing
 * Oracle-aware sessions from any view. Wraps Convex task session
 * mutations with goalId, visionSnapshot, crossCheckStatus tracking.
 *
 * Per ORACLE_VISION.md Non-Negotiable #4: Every long-running task stores
 * goalId, visionSnapshot, successCriteria[], sourceRefs[],
 * crossCheckStatus, deltaFromVision, dogfoodRunId.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// ─── Types ───────────────────────────────────────────────────────────────────

export type OracleCrossCheckStatus = "aligned" | "drifting" | "violated";

export interface OracleSourceRef {
  label: string;
  href?: string;
  note?: string;
  kind?: string;
}

export interface OracleSessionConfig {
  title: string;
  description?: string;
  type?: "manual" | "agent" | "swarm";
  visibility?: "public" | "private";
  goalId?: string;
  visionSnapshot?: string;
  successCriteria?: string[];
  sourceRefs?: OracleSourceRef[];
}

export interface OracleSessionState {
  sessionId: Id<"agentTaskSessions"> | null;
  isActive: boolean;
  crossCheckStatus: OracleCrossCheckStatus | null;
  deltaFromVision: string | null;
  toolsUsed: string[];
  startedAt: number | null;
}

export interface UseOracleSessionReturn {
  /** Current session state */
  state: OracleSessionState;

  /** Start a new Oracle-tracked session */
  startSession: (config: OracleSessionConfig) => Promise<Id<"agentTaskSessions">>;

  /** Update cross-check status (drift detection) */
  updateCrossCheck: (
    status: OracleCrossCheckStatus,
    delta?: string,
  ) => Promise<void>;

  /** Update Oracle context fields (non-destructive) */
  updateOracleContext: (fields: {
    goalId?: string;
    visionSnapshot?: string;
    successCriteria?: string[];
    sourceRefs?: OracleSourceRef[];
    dogfoodRunId?: Id<"dogfoodQaRuns">;
  }) => Promise<void>;

  /** Record a tool usage */
  recordToolUsed: (toolName: string) => void;

  /** Complete the session successfully */
  completeSession: () => Promise<void>;

  /** Fail the session with an error */
  failSession: (errorMessage: string) => Promise<void>;

  /** Cancel the session */
  cancelSession: () => Promise<void>;

  /** Whether a session is currently active */
  hasActiveSession: boolean;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useOracleSession(): UseOracleSessionReturn {
  const createSessionMutation = useMutation(
    api.domains.taskManager.mutations.createSession,
  );
  const updateStatusMutation = useMutation(
    api.domains.taskManager.mutations.updateSessionStatus,
  );
  const updateOracleContextMutation = useMutation(
    api.domains.taskManager.mutations.updateSessionOracleContext,
  );
  const updateMetricsMutation = useMutation(
    api.domains.taskManager.mutations.updateSessionMetrics,
  );

  const [state, setState] = useState<OracleSessionState>({
    sessionId: null,
    isActive: false,
    crossCheckStatus: null,
    deltaFromVision: null,
    toolsUsed: [],
    startedAt: null,
  });

  // Track tools in a ref to avoid re-renders on every tool call
  const toolsRef = useRef<Set<string>>(new Set());

  const startSession = useCallback(
    async (config: OracleSessionConfig): Promise<Id<"agentTaskSessions">> => {
      const sessionId = await createSessionMutation({
        title: config.title,
        description: config.description,
        type: config.type ?? "manual",
        visibility: config.visibility ?? "public",
        goalId: config.goalId,
        visionSnapshot: config.visionSnapshot,
        successCriteria: config.successCriteria,
        sourceRefs: config.sourceRefs,
        crossCheckStatus: "aligned" as const,
      });

      toolsRef.current = new Set();
      setState({
        sessionId,
        isActive: true,
        crossCheckStatus: "aligned",
        deltaFromVision: null,
        toolsUsed: [],
        startedAt: Date.now(),
      });

      return sessionId;
    },
    [createSessionMutation],
  );

  const updateCrossCheck = useCallback(
    async (status: OracleCrossCheckStatus, delta?: string) => {
      if (!state.sessionId) return;

      await updateStatusMutation({
        sessionId: state.sessionId,
        status: "running",
        crossCheckStatus: status,
        deltaFromVision: delta,
      });

      setState((prev) => ({
        ...prev,
        crossCheckStatus: status,
        deltaFromVision: delta ?? prev.deltaFromVision,
      }));
    },
    [state.sessionId, updateStatusMutation],
  );

  const updateOracleContext = useCallback(
    async (fields: {
      goalId?: string;
      visionSnapshot?: string;
      successCriteria?: string[];
      sourceRefs?: OracleSourceRef[];
      dogfoodRunId?: Id<"dogfoodQaRuns">;
    }) => {
      if (!state.sessionId) return;

      await updateOracleContextMutation({
        sessionId: state.sessionId,
        ...fields,
      });
    },
    [state.sessionId, updateOracleContextMutation],
  );

  const recordToolUsed = useCallback((toolName: string) => {
    toolsRef.current.add(toolName);
    setState((prev) => ({
      ...prev,
      toolsUsed: Array.from(toolsRef.current),
    }));
  }, []);

  const flushToolMetrics = useCallback(async () => {
    if (!state.sessionId || toolsRef.current.size === 0) return;
    await updateMetricsMutation({
      sessionId: state.sessionId,
      toolsUsed: Array.from(toolsRef.current),
    });
  }, [state.sessionId, updateMetricsMutation]);

  const completeSession = useCallback(async () => {
    if (!state.sessionId) return;
    await flushToolMetrics();
    await updateStatusMutation({
      sessionId: state.sessionId,
      status: "completed",
    });
    setState((prev) => ({ ...prev, isActive: false }));
  }, [state.sessionId, flushToolMetrics, updateStatusMutation]);

  const failSession = useCallback(
    async (errorMessage: string) => {
      if (!state.sessionId) return;
      await flushToolMetrics();
      await updateStatusMutation({
        sessionId: state.sessionId,
        status: "failed",
        errorMessage,
      });
      setState((prev) => ({ ...prev, isActive: false }));
    },
    [state.sessionId, flushToolMetrics, updateStatusMutation],
  );

  const cancelSession = useCallback(async () => {
    if (!state.sessionId) return;
    await updateStatusMutation({
      sessionId: state.sessionId,
      status: "cancelled",
    });
    setState((prev) => ({ ...prev, isActive: false }));
  }, [state.sessionId, updateStatusMutation]);

  return useMemo<UseOracleSessionReturn>(() => ({
    state,
    startSession,
    updateCrossCheck,
    updateOracleContext,
    recordToolUsed,
    completeSession,
    failSession,
    cancelSession,
    hasActiveSession: state.isActive,
  }), [state, startSession, updateCrossCheck, updateOracleContext, recordToolUsed, completeSession, failSession, cancelSession]);
}
