/**
 * Phase 2 hook for the production-fidelity chat — true streaming UX
 * via Convex's reactive subscriptions.
 *
 * submit(prompt, tier, contextRef) calls the `startChat` mutation which
 * returns a runId in <100ms (work runs in a scheduled internal action).
 * Hook subscribes to TWO live queries for that runId:
 *   streamEventsForRun(runId) — ordered event log
 *   getRun(runId)             — final packet + metadata when done
 * Convex re-runs both whenever the underlying tables change → live
 * progress without any HTTP SSE plumbing.
 *
 * Auth-gated: state.available=false when unauthenticated; caller falls
 * back to fixture path.
 */
import { useState, useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery, useConvexAuth } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { ChatAnswer } from "../fixtures";
import type { RouterTier } from "../components/UniversalComposer";

type EvidenceRow = ChatAnswer["evidence"][number];
type TraceRow = ChatAnswer["trace"][number];

export interface RealChatRun {
  runId: string;
  hash?: string;
  packet: ChatAnswer;
  totalLatencyMs?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  /** Live working-notes scratchpad (concatenated streamed chunks). */
  scratchpad: string;
  /** Per-stage tool-call cards as they fire. */
  toolCalls: TraceRow[];
  /** Grounded source URLs as they arrive. */
  groundingChunks: EvidenceRow[];
  status: "pending" | "running" | "complete" | "error";
  errorMessage?: string;
}

export interface ChatRunState {
  status: "idle" | "thinking" | "ok" | "error";
  run: RealChatRun | null;
  error: string | null;
  /** Whether the current user can run real chat (authenticated). */
  available: boolean;
}

export function useRedesignChatRun() {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const startChat = useMutation(api.domains.redesign.chatRuns.startChat);

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const events = useQuery(
    api.domains.redesign.chatRuns.streamEventsForRun,
    activeRunId ? { runId: activeRunId } : "skip",
  );
  const runRow = useQuery(
    api.domains.redesign.chatRuns.getRun,
    activeRunId ? { runId: activeRunId } : "skip",
  );

  const projected = useMemo<RealChatRun | null>(() => {
    if (!activeRunId) return null;
    const list = events ?? [];
    let scratchpad = "";
    const toolCalls: TraceRow[] = [];
    const groundingChunks: EvidenceRow[] = [];
    const sections: Record<string, any> = {};
    let terminalError: string | undefined;
    for (const ev of list) {
      switch (ev.eventType) {
        case "scratchpad":
          if (typeof ev.payload?.text === "string") scratchpad += ev.payload.text;
          break;
        case "tool_call":
          if (ev.payload && typeof ev.payload.step === "string") {
            toolCalls.push(ev.payload as TraceRow);
          }
          break;
        case "grounding_chunk":
          if (ev.payload?.url) {
            groundingChunks.push({
              idx: groundingChunks.length + 1,
              quote: ev.payload?.title ?? ev.payload.url,
              source: ev.payload.url,
            });
          }
          break;
        case "section":
          if (ev.payload?.name) sections[ev.payload.name] = ev.payload;
          break;
        case "error":
          terminalError = ev.payload?.errorMessage ?? "unknown error";
          break;
      }
    }

    const partial: ChatAnswer = {
      shortAnswer: sections.short_answer?.text ?? "",
      whyItMatters: sections.why_it_matters?.text ?? "",
      evidence: sections.evidence?.rows ?? groundingChunks,
      risks: sections.risks?.items ?? [],
      nextAction: sections.next_action?.text ?? "",
      sourceCount: (sections.evidence?.rows ?? groundingChunks).length,
      paidCalls: 1,
      fromMemory: false,
      trace: toolCalls,
    };

    const status: RealChatRun["status"] = (runRow?.status as RealChatRun["status"]) ?? "pending";
    const finalPacket = (runRow?.status === "complete" && runRow.packet)
      ? (runRow.packet as ChatAnswer)
      : partial;

    return {
      runId: activeRunId,
      hash: runRow?.hash ?? undefined,
      packet: finalPacket,
      totalLatencyMs: runRow?.totalLatencyMs,
      totalTokens: runRow?.totalTokens,
      estimatedCostUsd: runRow?.estimatedCostUsd,
      scratchpad,
      toolCalls,
      groundingChunks,
      status,
      errorMessage: terminalError ?? runRow?.errorMessage ?? undefined,
    };
  }, [activeRunId, events, runRow]);

  useEffect(() => {
    if (projected?.status === "error" && projected.errorMessage) {
      setError(projected.errorMessage);
    }
  }, [projected?.status, projected?.errorMessage]);

  const submit = useCallback(
    async (prompt: string, tier: RouterTier, contextRef?: string): Promise<string | null> => {
      if (!isAuthenticated) {
        setError("Sign in to run a real chat with grounded sources.");
        return null;
      }
      setError(null);
      try {
        const runId = await startChat({ prompt, tier, contextRef });
        setActiveRunId(runId);
        return runId;
      } catch (err: any) {
        const msg = (err?.message ?? String(err)).slice(0, 280);
        setError(msg);
        return null;
      }
    },
    [isAuthenticated, startChat],
  );

  const reset = useCallback(() => {
    setActiveRunId(null);
    setError(null);
  }, []);

  const externalStatus: ChatRunState["status"] =
    error ? "error"
    : !activeRunId ? "idle"
    : projected?.status === "complete" ? "ok"
    : projected?.status === "error" ? "error"
    : "thinking";

  return {
    state: {
      status: externalStatus,
      run: projected,
      error,
      available: !authLoading && isAuthenticated,
    } as ChatRunState,
    submit,
    reset,
    hash: projected?.hash ?? null,
  };
}

/** Phase 3 helper — subscribe to a completed run by hash for /r/{hash}. */
export function useRedesignChatByHash(hash: string | undefined) {
  return useQuery(
    api.domains.redesign.chatRuns.getByHash,
    hash ? { hash } : "skip",
  );
}

export type { ChatAnswer };
