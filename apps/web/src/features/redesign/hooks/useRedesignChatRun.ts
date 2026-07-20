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
 * Auth-safe: paid live runs require an email-backed account. Guests are
 * stopped client-side before the mutation call; Convex enforces the same
 * policy server-side so anonymous sessions cannot start paid work either.
 */
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useConvexAuth } from "convex/react";
import { api } from "@convex/_generated/api";
import type { ChatAnswer as BaseChatAnswer } from "../fixtures";
import type { RouterTier } from "../components/UniversalComposer";
import type { LiveGroundingDecision } from "shared/redesign/contextRuntimePolicy";

export type ChatRunTier = "free" | "fast" | "auto" | "deep";

export interface ConversationContextTurn {
  role: "user" | "assistant";
  text: string;
  sourceUrls?: string[];
}

export function createChatClientRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function normalizeRouterTierForChatRun(tier: RouterTier): ChatRunTier {
  if (tier === "answer") return "fast";
  if (tier === "compare") return "deep";
  return tier;
}

export type ChatAnswer = Omit<BaseChatAnswer, "paidCalls" | "fromMemory"> & {
  paidCalls?: number;
  fromMemory?: boolean;
};

type EvidenceRow = ChatAnswer["evidence"][number];
type TraceRow = ChatAnswer["trace"][number];

export type PlannerArtifactStatus = "selected" | "candidate" | "deferred" | "pending" | "complete" | "blocked";

export interface PlannerArtifact {
  id: string;
  label: string;
  status: PlannerArtifactStatus;
  detail: string;
  confidence?: number;
  riskTier?: "low" | "medium" | "high";
  costUsd?: number;
}

export interface RuntimeMetrics {
  runId?: string;
  model?: string;
  provider?: string;
  runtimeReceiptId?: string;
  conversationContext?: ConversationContextTurn[];
  parentRunHash?: string;
  createdAt?: number;
  completedAt?: number;
  totalLatencyMs?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  paidCalls?: number;
  sourceCount?: number;
  verifiedSourceCount?: number;
  softWarningSourceCount?: number;
  unsupportedSourceCount?: number;
  cachedSourceCount?: number;
  fetchBlockedSourceCount?: number;
  providerGroundedSourceCount?: number;
  toolCallCount?: number;
  liveSearchCalls?: number;
  memoryHitRate?: number;
  sourceCacheHitRate?: number;
  timeToFirstSourceMs?: number | null;
  timeToFinalMs?: number;
}

export interface RuntimeContextPacket {
  hasContext: boolean;
  contextRef: string | null;
  contextKind: "graph_packet" | "report" | "none";
  reportId: string | null;
  artifactKey: string | null;
  title: string;
  summary: string;
  selectedContext: string[];
  rejectedContext: string[];
  sourceRefs: Array<{
    title: string;
    url?: string;
    source?: string;
    publishedAt?: string;
    excerpt?: string;
  }>;
  graph: {
    mode: "bounded_packet";
    nodeCount: number;
    edgeCount: number;
    clusters: Array<{ name: "used" | "changed" | "needs_review" | "blocked"; count: number; sample: string[] }>;
  };
  notebook: {
    sectionTitles: string[];
    htmlPreview?: string;
  };
  verification: {
    tier: "deterministic" | "retrieval" | "judge_required";
    decisions: string[];
  };
  telemetry: {
    memoryHit: boolean;
    sourceCacheHit: boolean;
    candidateCount: number;
  };
}

export interface ClaimCheck {
  idx: number;
  status: string;
  method?: string;
  source?: string;
  detail?: string;
  verified?: boolean;
  validationError?: string;
  verificationState?: "verified" | "cached_reference" | "provider_grounded" | "fetch_blocked" | "unsupported";
  verificationDetail?: string;
  blocking?: boolean;
}

export interface RuntimeTrace {
  boardState?: Record<string, unknown>;
  contextCandidates: PlannerArtifact[];
  toolDecisions: PlannerArtifact[];
  claimChecks: ClaimCheck[];
  metrics?: RuntimeMetrics;
  contextPacket?: RuntimeContextPacket;
  liveGroundingDecision?: LiveGroundingDecision;
}

function dedupePlannerArtifacts(rows: PlannerArtifact[]): PlannerArtifact[] {
  const byId = new Map<string, PlannerArtifact>();
  for (const row of rows) {
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

function dedupeClaimChecks(rows: ClaimCheck[]): ClaimCheck[] {
  const byIdx = new Map<number, ClaimCheck>();
  for (const row of rows) {
    byIdx.set(row.idx, row);
  }
  return [...byIdx.values()].sort((a, b) => a.idx - b.idx);
}

export function resolveRuntimeArtifacts({
  contextCandidates,
  toolDecisions,
  claimChecks,
}: {
  contextCandidates: PlannerArtifact[];
  toolDecisions: PlannerArtifact[];
  claimChecks: ClaimCheck[];
}) {
  return {
    contextCandidates: dedupePlannerArtifacts(contextCandidates),
    toolDecisions: dedupePlannerArtifacts(toolDecisions),
    claimChecks: dedupeClaimChecks(claimChecks),
  };
}

export function buildPartialChatAnswer({
  sections,
  groundingChunks,
  toolCalls,
  metrics,
}: {
  sections: Record<string, any>;
  groundingChunks: EvidenceRow[];
  toolCalls: TraceRow[];
  metrics?: RuntimeMetrics;
}): ChatAnswer {
  const evidence = sections.evidence?.rows ?? groundingChunks;
  return {
    shortAnswer: sections.short_answer?.text ?? "",
    whyItMatters: sections.why_it_matters?.text ?? "",
    evidence,
    risks: sections.risks?.items ?? [],
    nextAction: sections.next_action?.text ?? "",
    sourceCount: evidence.length,
    trace: toolCalls,
    ...(typeof metrics?.paidCalls === "number" ? { paidCalls: metrics.paidCalls } : {}),
  };
}

export interface RealChatRun {
  runId: string;
  prompt?: string;
  tier?: string;
  hash?: string;
  packet: ChatAnswer;
  totalLatencyMs?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  model?: string;
  provider?: string;
  runtimeReceiptId?: string;
  createdAt?: number;
  completedAt?: number;
  /** Live working-notes scratchpad (concatenated streamed chunks). */
  scratchpad: string;
  /** Per-stage tool-call cards as they fire. */
  toolCalls: TraceRow[];
  /** Grounded source URLs as they arrive. */
  groundingChunks: EvidenceRow[];
  /** Board-state, routing, tool-decision, claim-check, and metric artifacts. */
  runtime: RuntimeTrace;
  status: "pending" | "running" | "complete" | "error" | "cancelled";
  errorMessage?: string;
}

export interface ChatRunState {
  status: "idle" | "thinking" | "ok" | "error";
  run: RealChatRun | null;
  error: string | null;
  /** Whether the real chat pipeline can be started from the current auth state. */
  available: boolean;
  /** True only when the signed-in account is eligible for live research. */
  paidEligible: boolean;
  /** True while an authenticated user's profile (email/eligibility) is still resolving —
   *  distinct from `!paidEligible`, which means the check has resolved and failed. */
  userLoading: boolean;
}

export type CancelRunResult = "recorded" | "queued" | "unavailable";

export function isPaidChatEligibleUser(user: unknown): boolean {
  if (!user || typeof user !== "object") return false;
  const record = user as Record<string, unknown>;
  const email = typeof record.email === "string" ? record.email.trim() : "";
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(email);
}

export function useRedesignChatRun() {
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const startChat = useMutation(api.domains.redesign.chatRuns.startChat);
  const cancelRun = useMutation(api.domains.redesign.chatRuns.cancelRun);
  const user = useQuery(
    api.domains.auth.auth.loggedInUser,
    isAuthenticated ? {} : "skip",
  );

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingSubmissionRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const pendingCancellationRef = useRef<{ requestId: string } | null>(null);
  // BUG FIX (2026-07-01): `useQuery` returns `undefined` while `loggedInUser` is still resolving,
  // and `isPaidChatEligibleUser(undefined)` collapses that into "not eligible" — so a fully
  // authenticated, properly-linked user who sends a message right after page load was shown the
  // misleading "Link an email or Google account" message even though their account IS linked.
  // Distinguish "still loading" from "definitely ineligible" so callers can show an honest message.
  // See docs/LIVE-USER-BENCHMARK-FINDING.md.
  const userLoading = isAuthenticated && user === undefined;
  const paidEligible = isPaidChatEligibleUser(user);
  const latestOwnedRun = useQuery(
    api.domains.redesign.chatRuns.getLatestOwnedRun,
    paidEligible ? {} : "skip",
  );

  useEffect(() => {
    if (!activeRunId && latestOwnedRun?.runId) {
      setActiveRunId(latestOwnedRun.runId);
    }
  }, [activeRunId, latestOwnedRun?.runId]);

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
    const contextCandidates: PlannerArtifact[] = [];
    const toolDecisions: PlannerArtifact[] = [];
    const claimChecks: ClaimCheck[] = [];
    let boardState: RuntimeTrace["boardState"];
    let metrics: RuntimeMetrics | undefined;
    let contextPacket: RuntimeContextPacket | undefined;
    let liveGroundingDecision: LiveGroundingDecision | undefined;
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
        case "board_state":
          boardState = ev.payload as RuntimeTrace["boardState"];
          break;
        case "context_candidate":
          if (ev.payload?.id && ev.payload?.label) contextCandidates.push(ev.payload as PlannerArtifact);
          break;
        case "tool_decision":
          if (ev.payload?.id && ev.payload?.label) toolDecisions.push(ev.payload as PlannerArtifact);
          break;
        case "context_runtime_packet":
          if (ev.payload?.contextRef !== undefined) contextPacket = ev.payload as RuntimeContextPacket;
          break;
        case "live_grounding_decision":
          if (typeof ev.payload?.useLiveGrounding === "boolean") liveGroundingDecision = ev.payload as LiveGroundingDecision;
          break;
        case "claim_check":
          if (typeof ev.payload?.idx === "number") claimChecks.push(ev.payload as ClaimCheck);
          break;
        case "sources_validated":
          for (const item of [...(ev.payload?.warnings ?? []), ...(ev.payload?.unverified ?? [])]) {
            if (typeof item?.idx === "number") {
              claimChecks.push({
                idx: item.idx,
                status: item.status ?? (item.blocking ? "source_validation_failed" : "source_validation_warning"),
                verified: false,
                validationError: item.reason,
                verificationState: item.verificationState,
                verificationDetail: item.verificationDetail,
                blocking: item.blocking,
              });
            }
          }
          if (typeof ev.payload?.verified === "number" && typeof ev.payload?.total === "number") {
            metrics = {
              ...metrics,
              sourceCount: ev.payload.total,
              verifiedSourceCount: ev.payload.verified,
              softWarningSourceCount: ev.payload.softWarnings,
              unsupportedSourceCount: ev.payload.unverified?.length,
            };
          }
          break;
        case "run_metrics":
          metrics = ev.payload as RuntimeMetrics;
          break;
        case "error":
          terminalError = ev.payload?.errorMessage ?? "unknown error";
          break;
      }
    }

    const partial = buildPartialChatAnswer({ sections, groundingChunks, toolCalls, metrics });

    const status: RealChatRun["status"] = (runRow?.status as RealChatRun["status"]) ?? "pending";
    const finalPacket = (runRow?.status === "complete" && runRow.packet)
      ? (runRow.packet as ChatAnswer)
      : partial;
    const resolvedArtifacts = resolveRuntimeArtifacts({ contextCandidates, toolDecisions, claimChecks });
    const persistedMetrics: RuntimeMetrics = {
      ...metrics,
      runId: activeRunId,
      model: runRow?.model,
      provider: runRow?.provider,
      runtimeReceiptId: runRow?.runtimeReceiptId,
      conversationContext: runRow?.conversationContext as ConversationContextTurn[] | undefined,
      parentRunHash: runRow?.parentRunHash,
      createdAt: runRow?.createdAt,
      completedAt: runRow?.completedAt,
      totalLatencyMs: runRow?.totalLatencyMs ?? metrics?.totalLatencyMs,
      totalTokens: runRow?.totalTokens ?? metrics?.totalTokens,
      estimatedCostUsd: runRow?.estimatedCostUsd ?? metrics?.estimatedCostUsd,
    };
    const runtime: RuntimeTrace = {
      boardState,
      contextCandidates: resolvedArtifacts.contextCandidates,
      toolDecisions: resolvedArtifacts.toolDecisions,
      claimChecks: resolvedArtifacts.claimChecks,
      metrics: persistedMetrics,
      contextPacket: contextPacket ?? (finalPacket.runtime as RuntimeTrace | undefined)?.contextPacket,
      liveGroundingDecision: liveGroundingDecision ?? (finalPacket.runtime as RuntimeTrace | undefined)?.liveGroundingDecision,
    };
    const packet = {
      ...finalPacket,
      runtime,
    };

    return {
      runId: activeRunId,
      prompt: runRow?.prompt,
      tier: runRow?.tier,
      hash: runRow?.hash ?? undefined,
      packet,
      totalLatencyMs: runRow?.totalLatencyMs,
      totalTokens: runRow?.totalTokens,
      estimatedCostUsd: runRow?.estimatedCostUsd,
      model: runRow?.model,
      provider: runRow?.provider,
      runtimeReceiptId: runRow?.runtimeReceiptId,
      createdAt: runRow?.createdAt,
      completedAt: runRow?.completedAt,
      scratchpad,
      toolCalls,
      groundingChunks,
      runtime,
      status,
      errorMessage: terminalError ?? runRow?.errorMessage ?? undefined,
    };
  }, [activeRunId, events, runRow]);

  useEffect(() => {
    if (projected?.status === "error" && projected.errorMessage) {
      setError(projected.errorMessage);
    }
    if (projected?.status === "complete" || projected?.status === "error" || projected?.status === "cancelled") {
      pendingSubmissionRef.current = null;
    }
  }, [projected?.status, projected?.errorMessage]);

  const submit = useCallback(
    async (
      prompt: string,
      tier: RouterTier,
      contextRef?: string,
      pinnedClaims?: Array<{ text: string; source?: string }>,
      conversationContext?: ConversationContextTurn[],
      parentRunHash?: string,
    ): Promise<string | null> => {
      if (authLoading) {
        setError("Auth state is still loading. Try again in a moment.");
        return null;
      }
      if (!isAuthenticated) {
        setError("Sign in with an email-backed account before running live research.");
        return null;
      }
      if (!paidEligible) {
        setError("Link an email or Google account before running live research. Anonymous sessions can browse public memory only.");
        return null;
      }
      setError(null);
      const normalizedTier = normalizeRouterTierForChatRun(tier);
      const fingerprint = JSON.stringify({
        prompt: prompt.trim(),
        tier: normalizedTier,
        contextRef,
        pinnedClaims,
        conversationContext,
        parentRunHash,
      });
      const existingRequest = pendingSubmissionRef.current;
      const clientRequestId = existingRequest?.fingerprint === fingerprint
        ? existingRequest.requestId
        : createChatClientRequestId();
      const staleCancellation = pendingCancellationRef.current;
      if (staleCancellation && staleCancellation.requestId !== clientRequestId) {
        try {
          await cancelRun({ clientRequestId: staleCancellation.requestId });
          pendingCancellationRef.current = null;
        } catch {
          setError("The prior cancellation could not be confirmed. Retry before starting unrelated work.");
          return null;
        }
      }
      pendingSubmissionRef.current = { fingerprint, requestId: clientRequestId };
      try {
        const runId = await startChat({
          prompt,
          tier: normalizedTier,
          contextRef,
          pinnedClaims,
          conversationContext,
          parentRunHash,
          clientRequestId,
        });
        setActiveRunId(runId);
        if (pendingCancellationRef.current?.requestId === clientRequestId) {
          const cancellation = await cancelRun({ runId });
          if (cancellation.status === "cancelled" || cancellation.alreadyTerminal) {
            pendingCancellationRef.current = null;
          }
        }
        return runId;
      } catch (err: any) {
        if (pendingCancellationRef.current?.requestId === clientRequestId) {
          try {
            const cancellation = await cancelRun({ clientRequestId });
            if (cancellation.status === "cancelled" || cancellation.status === "unavailable" || cancellation.alreadyTerminal) {
              pendingCancellationRef.current = null;
            }
          } catch {
            // Keep the request-bound cancellation for an explicit retry.
          }
        }
        const raw = (err?.message ?? String(err)).slice(0, 280);
        const msg = /server error|not authenticated|anonymous|sign in|account/i.test(raw)
          ? "Sign in with an email-backed account before running live research."
          : raw;
        setError(msg);
        return null;
      }
    },
    [authLoading, cancelRun, isAuthenticated, paidEligible, startChat],
  );

  const reset = useCallback(() => {
    setActiveRunId(null);
    setError(null);
  }, []);

  const cancel = useCallback(async (targetRunId: string | null): Promise<CancelRunResult> => {
    if (!targetRunId) {
      if (!pendingSubmissionRef.current) return "unavailable";
      pendingCancellationRef.current = { requestId: pendingSubmissionRef.current.requestId };
      return "queued";
    }
    try {
      const result = await cancelRun({ runId: targetRunId });
      return result.status === "cancelled" && !result.alreadyTerminal ? "recorded" : "unavailable";
    } catch (err: any) {
      setError((err?.message ?? String(err)).slice(0, 280));
      return "unavailable";
    }
  }, [cancelRun]);

  /**
   * Phase 5 — point the hook at an existing runId (e.g. one returned
   * by a separate `probeRun` mutation) so its events stream into the
   * same projected state. Caller is responsible for inserting the
   * matching turn into the conversation.
   */
  const subscribeTo = useCallback((runId: string) => {
    setError(null);
    setActiveRunId(runId);
  }, []);

  const externalStatus: ChatRunState["status"] =
    error ? "error"
    : !activeRunId ? "idle"
    : projected?.status === "complete" ? "ok"
    : projected?.status === "cancelled" ? "idle"
    : projected?.status === "error" ? "error"
    : "thinking";

  return {
    state: {
      status: externalStatus,
      run: projected,
      error,
      available: !authLoading && isAuthenticated && paidEligible,
      paidEligible,
      userLoading,
    } as ChatRunState,
    submit,
    cancel,
    reset,
    subscribeTo,
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
