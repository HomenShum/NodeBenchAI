/**
 * Chat — the live operating surface.
 *
 * Spec: not just message bubbles. Where research becomes memory.
 * Center: active conversation + answer packets + run checkpoints + capture acks.
 * Bottom: UniversalComposer.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { UniversalComposer, DEFAULT_TIERS, type RouterTier } from "../components/UniversalComposer";
import { Pill } from "../components/Pill";
import { StreamingMarkdown } from "../components/StreamingMarkdown";
import type { ActiveBatchRun, ChatAnswer } from "../fixtures";
import { useBatchLive } from "../hooks/useBatchLive";
import { useLiveArtifacts, type LiveArtifactDetail } from "../hooks/useLiveArtifacts";
import { ChatThinking } from "../components/ChatThinking";
import { ChatToolCall, type ToolCall } from "../components/ChatToolCall";

import { ChatEmptyState } from "../components/ChatEmptyState";
import { showToast } from "../components/Toast";
import {
  normalizeRouterTierForChatRun,
  useRedesignChatByHash,
  useRedesignChatRun,
  type ChatRunState,
  type ConversationContextTurn,
} from "../hooks/useRedesignChatRun";
import { buildGraphContextBridgePacket } from "../lib/graphContextBridge";
import { buildConversationContext } from "../lib/chatContinuation";
import { useMutation, useQuery, useConvexAuth } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { LiveResearchChecklist, type ResearchStage, type ResearchStageId } from "../../research/LiveResearchChecklist";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ai-ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ai-ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ai-ui/tooltip";

/**
 * Sprint 4 P2.13 — deterministic reproducibility hash for an answer.
 *
 * Hashes a stable subset of the packet (shortAnswer + sourceCount + tier +
 * trace step shape) so the same packet always produces the same hash. Once
 * chat is live-wired, replace with a server-side hash over
 * { model, params, sources, prompt } so the URL is replayable across
 * deployments.
 */
function answerHash(packet: ChatAnswer, tier: RouterTier): string {
  const sortedTraceShape = [...packet.trace]
    .map((s) => `${s.step}|${s.detail}|${s.status}`)
    .sort()
    .join("\n");
  const seed = `${tier}::${packet.shortAnswer}::${packet.sourceCount}::${sortedTraceShape}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x1b873593;
  for (let i = 0; i < seed.length; i++) {
    h1 ^= seed.charCodeAt(i);
    h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ seed.charCodeAt(i), 2654435761) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, 12);
}

async function shareAnswer(turnId: string, packet: ChatAnswer, tier: RouterTier = "auto", serverHash?: string) {
  void turnId; // turnId ties the URL to the local thread; the hash makes it deterministic
  const hash = serverHash || answerHash(packet, tier);
  const url = `${window.location.origin}/redesign/chat/r/${hash}`;
  let copied = false;
  try {
    await navigator.clipboard.writeText(url);
    copied = true;
  } catch {
    // Clipboard may be blocked in sandbox / iframe; fall back to manual select
    copied = false;
  }
  showToast({
    tone: copied ? "success" : "info",
    message: copied
      ? `Reproducible link copied: …/r/${hash}`
      : `Link: ${url}  (clipboard blocked — copy manually)`,
    action: {
      label: "Open link",
      onClick: () => {
        window.open(url, "_blank", "noopener,noreferrer");
      },
    },
  });
}

function sourceUrlFromText(source: string): string | null {
  const match = source.match(/https?:\/\/[^\s)>\]]+/i);
  if (!match) return null;
  return match[0].replace(/[.,;:]+$/, "");
}

function sourceLabel(source: string): string {
  const url = sourceUrlFromText(source);
  if (!url) return source;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const title = source.slice(0, source.indexOf(url)).replace(/\s+[^\w\s]\s*$/g, "").trim();
    return title ? `${title} - ${host}` : host;
  } catch {
    return source;
  }
}

interface ChatSurfaceProps {
  contextLabel?: string;
  workspaceDetail?: LiveArtifactDetail;
  initialPrompt?: string;
  continuationHash?: string;
}

interface Turn {
  id: string;
  role: "user" | "assistant";
  text?: string;
  /** Free-form streaming markdown answer (for chat-style follow-ups, no structured packet). */
  markdown?: string;
  /** True only on the most recent assistant turn while it's still streaming in. */
  streaming?: boolean;
  /** Pre-stream thinking placeholder — shown while the model reasons before tokens arrive. */
  thinking?: boolean;
  /** Inline tool calls the agent executed during this turn (parity-studio pattern). */
  toolCalls?: ToolCall[];
  /** Created-at timestamp for live timestamp updating */
  createdAt?: number;
  packet?: ChatAnswer;
  tier?: RouterTier;
  /** Phase 1+ real chat — reproducibility hash for /redesign/chat/r/{hash}. */
  runHash?: string;
  /** Phase 2 streaming — Convex runId; while set, this turn is awaiting completion. */
  chatRunId?: string;
  /** Phase 2 streaming — live working-notes scratchpad text from the agent. */
  liveScratchpad?: string;
}

function restoredTurns(context: ConversationContextTurn[] | undefined, createdAt: number): Turn[] {
  return (context ?? []).map((turn, index) => ({
    id: `history-${createdAt}-${index}`,
    role: turn.role,
    ...(turn.role === "user" ? { text: turn.text } : { markdown: turn.text }),
    createdAt: createdAt - ((context?.length ?? 0) - index) * 2,
  }));
}

function compactRunId(runId?: string): string | undefined {
  if (!runId) return undefined;
  if (runId.length <= 16) return runId;
  return `${runId.slice(0, 6)}...${runId.slice(-6)}`;
}

function isBlockingClaimCheck(check: { status?: string; verified?: boolean; blocking?: boolean; verificationState?: string }): boolean {
  return check.blocking === true || check.verificationState === "unsupported" || check.status === "source_validation_failed";
}

function sourceTrustBadge(row: {
  verified?: boolean;
  validationError?: string;
  verificationState?: string;
  verificationDetail?: string;
}): { label: string; title: string; color: string } | null {
  if (row.verified === true || row.verificationState === "verified") {
    return {
      label: "verified in source body",
      title: row.verificationDetail ?? "Quote substring confirmed in source body.",
      color: "var(--rd-green, #15803d)",
    };
  }
  if (row.verificationState === "cached_reference") {
    return {
      label: "cached reference",
      title: row.verificationDetail ?? "Cached memory/source-cache reference; no URL fetch was available.",
      color: "var(--rd-amber, #b45309)",
    };
  }
  if (row.verificationState === "fetch_blocked") {
    return {
      label: "fetch blocked",
      title: row.verificationDetail ?? `Publisher fetch blocked post-hoc validation: ${row.validationError ?? "unknown reason"}`,
      color: "var(--rd-amber, #b45309)",
    };
  }
  if (row.verificationState === "provider_grounded") {
    return {
      label: "provider-grounded",
      title: row.verificationDetail ?? "Search provider supplied the source, but the exact snippet was not found during post-hoc fetch.",
      color: "var(--rd-amber, #b45309)",
    };
  }
  if (row.verified === false || row.verificationState === "unsupported") {
    return {
      label: `unsupported (${row.validationError ?? "no_match"})`,
      title: row.verificationDetail ?? `Source validation failed: ${row.validationError ?? "unknown reason"}`,
      color: "var(--rd-red, #b91c1c)",
    };
  }
  return null;
}

function buildLiveContextRef(detail: LiveArtifactDetail | null, artifactKey?: string | null): string | undefined {
  if (!detail) return undefined;
  const base = buildGraphContextBridgePacket({ detail, mode: "agent" }).contextRef;
  return artifactKey ? `${base}::artifact:${encodeURIComponent(artifactKey)}` : base;
}

interface RunScopeSnapshot {
  status: "idle" | "thinking" | "ok" | "error";
  reads: string;
  writes: string;
  verification: string;
}

function buildRunScopeSnapshot(args: {
  chatState: ChatRunState;
  liveDetail: LiveArtifactDetail | null | undefined;
  turns: Turn[];
}): RunScopeSnapshot {
  const { chatState, liveDetail, turns } = args;
  const run = chatState.run;
  const lastAssistantPacket = [...turns].reverse().find((turn) => turn.role === "assistant" && turn.packet)?.packet;
  const activePacket = run?.packet ?? lastAssistantPacket;
  const runtime = run?.runtime ?? activePacket?.runtime;
  const runtimeContextPacket = runtime?.contextPacket;
  const claimChecks = runtime?.claimChecks ?? [];
  const metrics = runtime?.metrics;
  const sourceCount = metrics?.sourceCount ?? run?.groundingChunks.length ?? activePacket?.sourceCount ?? liveDetail?.sourceCount ?? 0;
  const verifiedSourceCount = metrics?.verifiedSourceCount
    ?? claimChecks.filter((check) => check.verified === true).length;
  const softWarningSourceCount = metrics?.softWarningSourceCount
    ?? claimChecks.filter((check) => check.verified === false && !isBlockingClaimCheck(check)).length;
  const blockedClaimCount = metrics?.unsupportedSourceCount
    ?? claimChecks.filter((check) => isBlockingClaimCheck(check)).length;
  const isRunning = chatState.status === "thinking" || run?.status === "pending" || run?.status === "running";
  const hasAnswer = Boolean(activePacket?.shortAnswer);

  return {
    status: isRunning
      ? "thinking"
      : chatState.status === "error"
        ? "error"
        : hasAnswer || liveDetail
          ? "ok"
          : "idle",
    reads: runtimeContextPacket?.hasContext
      ? `${runtimeContextPacket.selectedContext.length} selected context items · ${runtimeContextPacket.sourceRefs.length} source refs`
      : liveDetail
        ? `${liveDetail.title} · ${liveDetail.sourceCount} attached source${liveDetail.sourceCount === 1 ? "" : "s"}`
        : "Prompt only · no report context attached",
    writes: "Review mode · no automatic shared writes",
    verification: blockedClaimCount > 0
      ? `${blockedClaimCount} unsupported source${blockedClaimCount === 1 ? "" : "s"} blocking review`
      : claimChecks.length > 0
        ? `${verifiedSourceCount} verified · ${softWarningSourceCount} limited · ${sourceCount} total`
        : isRunning
          ? "Checks pending"
          : "No claim checks recorded",
  };
}

/**
 * Phase 7 — per-tool-card error boundary so a single ChatToolCall render
 * failure (bad tool name, malformed payload, etc.) doesn't crash the
 * whole AnswerPacket. Renders a quiet inline pill in the failed slot.
 */
class ToolCallBoundary extends React.Component<
  { children: ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(err: any) {
    return { hasError: true, message: (err?.message || String(err)).slice(0, 80) };
  }
  componentDidCatch(err: any) {
    // Surface to console for debugging but don't propagate
    if (typeof console !== "undefined") {
      console.warn("[ChatToolCall render error]", err);
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          className="rd-card rd-card__pad-tight rd-mono"
          role="status"
          style={{ fontSize: 11, color: "var(--rd-amber, #b45309)", padding: "6px 10px" }}
        >
          ⚠ tool-call render error: {this.state.message}
        </div>
      );
    }
    return this.props.children;
  }
}

function BatchLiveBridge({ onBatch }: { onBatch: (batch: ActiveBatchRun | null) => void }) {
  const { batch } = useBatchLive();
  useEffect(() => {
    onBatch(batch);
  }, [batch, onBatch]);
  return null;
}

class BatchLiveBoundary extends React.Component<
  { children: ReactNode; onError: () => void },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; onError: () => void }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: any) {
    this.props.onError();
    if (typeof console !== "undefined") {
      console.warn("[BatchLiveBridge error]", err);
    }
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

/** Phase 1: map server-side trace rows to the existing ChatToolCall shape so
 *  the inline tool-call card list (Sprint 1 affordance) renders real timings. */
function traceToToolCalls(trace: ChatAnswer["trace"]): ToolCall[] {
  return trace.map((row) => ({
    step: row.step,
    detail: row.detail,
    status: row.status === "ok" ? "ok"
      : row.status === "error" ? "error"
      : row.status === "warn" ? "warn"
      : "ok",
    durationMs: row.durationMs,
    tool: row.step.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
  }));
}

function liveChatUnavailableMarkdown(reason: string, detail?: LiveArtifactDetail | null): string {
  const context = detail
    ? `Current live context is **${detail.title}** with ${detail.sourceCount} sources and ${detail.claimCount} claims.`
    : "No live artifact context has loaded yet.";
  const nextStep = /sign in|account/i.test(reason)
    ? "Once authenticated, run live research from the composer below."
    : "Use the composer to start a live chat run and stream tool events, evidence rows, and the final answer packet.";
  return `## Live chat is not running

${reason}

${context}

${nextStep}`;
}

type ResearchTraceLike = { step: string; detail?: string; status?: string; tool?: string };

const RESEARCH_STAGE_TEMPLATE: Array<{ id: ResearchStageId; label: string }> = [
  { id: "understanding", label: "Understanding the prompt" },
  { id: "entity", label: "Entity identification" },
  { id: "memory", label: "Memory check" },
  { id: "source_plan", label: "Source plan" },
  { id: "official", label: "Official sources" },
  { id: "news_web", label: "News / web" },
  { id: "primary_reading", label: "Primary reading" },
  { id: "claims", label: "Claims extraction" },
  { id: "contradictions", label: "Contradictions check" },
  { id: "graph", label: "Graph build" },
  { id: "evidence_scoring", label: "Evidence scoring" },
  { id: "memo_draft", label: "Memo drafting" },
  { id: "citations", label: "Citations" },
  { id: "vault_save", label: "Vault save" },
];

function buildResearchStages(trace: ResearchTraceLike[] = [], running = false): ResearchStage[] {
  const patterns: Record<ResearchStageId, RegExp> = {
    understanding: /understand|prompt|goal/,
    entity: /entity|classif/,
    memory: /memory|context|artifact/,
    source_plan: /source plan|retrieval plan/,
    official: /official source/,
    news_web: /news|web search/,
    primary_reading: /primary read|fetch/,
    claims: /claim extract|claims/,
    contradictions: /contradiction/,
    graph: /graph/,
    evidence_scoring: /evidence scor|verify/,
    memo_draft: /memo draft|draft memo/,
    citations: /citation/,
    vault_save: /vault save|save vault/,
  };

  const grounded = RESEARCH_STAGE_TEMPLATE.flatMap((stage) => {
    const matchingTrace = trace.find((item) =>
      patterns[stage.id].test(`${item.step} ${item.detail ?? ""} ${item.tool ?? ""}`.toLowerCase()),
    );
    if (!matchingTrace) return [];
    const status = matchingTrace.status?.toLowerCase();
    if (status === "warn" || status === "error" || status === "failed") {
      return [{ ...stage, state: "warning" as const, detail: matchingTrace.detail, tool: matchingTrace.tool, warning: "Agent step returned a warning" }];
    }
    if (status === "running" || status === "pending") {
      return [{ ...stage, state: "running" as const, detail: matchingTrace.detail, tool: matchingTrace.tool }];
    }
    return [{ ...stage, state: "passed" as const, detail: matchingTrace.detail, tool: matchingTrace.tool }];
  });

  if (grounded.length > 0 || !running) return grounded;
  return [{ ...RESEARCH_STAGE_TEMPLATE[0], state: "running", detail: "Waiting for the first runtime event" }];
}

function LaunchContextCard({
  intent,
  artifactKey,
  requestedReportId,
  detail,
  isAuthenticated,
}: {
  intent: string | null;
  artifactKey: string | null;
  requestedReportId: string | null;
  detail: LiveArtifactDetail | null | undefined;
  isAuthenticated: boolean;
}) {
  if (!intent && !artifactKey && !requestedReportId) return null;

  const artifactLabels: Record<string, string> = {
    brief: "Brief",
    cards: "Claim card",
    map: "Map",
    notebook: "Notebook",
    sources: "Source",
  };
  const artifactLabel = artifactKey ? artifactLabels[artifactKey] ?? "Artifact" : null;

  let title = "Context selected";
  let body = detail
    ? `${detail.title} is attached to the next run with ${detail.sourceCount} source${detail.sourceCount === 1 ? "" : "s"}. Nothing is written until you explicitly ask.`
    : "The requested saved context is not available in this session. You can still ask a new question below.";

  if (artifactLabel) {
    title = `${artifactLabel} context selected`;
  } else if (requestedReportId || intent === "review-report") {
    title = detail ? "Report context selected" : "Requested report unavailable";
  } else if (intent === "account" || intent === "settings") {
    title = "Account controls";
    body = isAuthenticated
      ? "Use the account menu in the header to sign out. Your conversation remains on this workspace."
      : "Use Sign in in the header to connect an email-backed account and run live chat.";
  } else if (intent === "attention") {
    title = "Attention review";
    body = "Ask NodeBench to identify unresolved follow-ups, approvals, or evidence gaps. There is no separate inbox to manage.";
  } else if (intent === "reports") {
    title = "Saved research";
    body = "Ask for the report, company, or prior decision you need. Results stay in this conversation instead of opening a separate report browser.";
  } else if (intent === "sources") {
    title = "Source review";
    body = detail
      ? `${detail.sourceCount} source${detail.sourceCount === 1 ? "" : "s"} from ${detail.title} will ground the next run.`
      : "Attach a source or name the evidence you want reviewed in the composer below.";
  } else if (intent === "workspace") {
    title = detail ? "Workspace context selected" : "Workspace context unavailable";
  }

  return (
    <aside className="rd-launch-context" data-testid="chat-launch-context" aria-label={title}>
      <span className="rd-eyebrow">Current focus</span>
      <strong>{title}</strong>
      <p>{body}</p>
    </aside>
  );
}

export function ChatSurface({
  contextLabel = "Current context",
  workspaceDetail,
  initialPrompt,
  continuationHash,
}: ChatSurfaceProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const liveArtifacts = useLiveArtifacts(24);
  const launchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedReportId = launchParams.get("report");
  const requestedArtifactKey = launchParams.get("artifact");
  const requestedIntent = launchParams.get("intent");
  const _rawLiveDetail = requestedReportId
    ? liveArtifacts.details.find((detail) => detail.id === requestedReportId) ?? null
    : liveArtifacts.details[0];
  // Phase 1 — real LLM chat behind the composer for authenticated users.
  const chatRun = useRedesignChatRun();
  const continuedRun = useRedesignChatByHash(continuationHash);
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  // Phase 4 — real reactions for inline correction + 👍/👎 toolbar.
  const recordReaction = useMutation(api.domains.redesign.agentRunFeedback.recordReaction);
  // Phase 5 — counterfactual probe re-run with masked source.
  const probeRun = useMutation(api.domains.redesign.chatRuns.probeRun);
  // ?fresh=1 escape hatch: treat as if no live artifact is loaded and show the
  // explicit live-chat unavailable state instead of seeded showcase content.
  const _skipLiveSeed = launchParams.has("fresh");
  const liveDetail = workspaceDetail ?? (_skipLiveSeed ? null : _rawLiveDetail);
  const liveStarters = useMemo(() => {
    if (!liveDetail) return undefined;
    return [
      { icon: "🧾", title: `Summarize ${liveDetail.title}`, prompt: `Summarize ${liveDetail.title}. Keep it evidence-led and end with a next action.` },
      { icon: "✅", title: "Promote strongest claim", prompt: `Promote the strongest verified signal from ${liveDetail.title} into a notebook claim with sources.` },
      { icon: "🔎", title: "Find the review gaps", prompt: `List what still needs source review in ${liveDetail.title}, grouped by risk.` },
      { icon: "📤", title: "Prepare an export", prompt: `Create a CRM-ready export summary for ${liveDetail.title}.` },
    ];
  }, [liveDetail]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const recoveredRunIdRef = useRef<string | null>(null);
  const consumedContinuationRef = useRef<string | null>(null);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const consumedInitialPromptRef = useRef<string | null>(null);
  const hasInitialPrompt = Boolean(initialPrompt?.trim());
  const hasLaunchContext = hasInitialPrompt
    || Boolean(continuationHash || requestedIntent || requestedArtifactKey || requestedReportId);
  const turnIdCounterRef = useRef(0);
  const nextTurnId = (prefix: "u" | "a") => {
    turnIdCounterRef.current += 1;
    return `${prefix}-${Date.now().toString(36)}-${turnIdCounterRef.current}`;
  };
  const [ctx, setCtx] = useState(contextLabel);
  const [tier, setTier] = useState<RouterTier>("auto");
  const [liveBatch, setLiveBatch] = useState<ActiveBatchRun | null>(null);
  const batch = liveBatch;

  // Rebuild the newest owned conversation pair from the durable run after reload.
  useEffect(() => {
    const real = chatRun.state.run;
    if (continuationHash || !real?.prompt || turns.length > 0 || recoveredRunIdRef.current === real.runId) return;
    recoveredRunIdRef.current = real.runId;
    const createdAt = real.createdAt ?? Date.now();
    const terminalMarkdown = real.status === "cancelled"
      ? liveChatUnavailableMarkdown("This run was cancelled before a final answer packet was available.", liveDetail)
      : real.status === "error"
        ? liveChatUnavailableMarkdown(real.errorMessage ?? "The recovered run failed before producing a final packet.", liveDetail)
        : undefined;
    setTurns([
      ...restoredTurns(real.conversationContext, createdAt),
      { id: nextTurnId("u"), role: "user", text: real.prompt, createdAt },
      {
        id: nextTurnId("a"),
        role: "assistant",
        chatRunId: real.runId,
        thinking: real.status === "pending" || real.status === "running",
        packet: real.status === "complete" ? real.packet : undefined,
        runHash: real.hash,
        markdown: terminalMarkdown,
        tier: (real.tier ?? "auto") as RouterTier,
        createdAt: createdAt + 1,
      },
    ]);
  }, [chatRun.state.run, continuationHash, liveDetail, turns.length]);

  // Keep the receipt immutable while restoring it as the visible start of a
  // new local conversation. Future runs persist this transcript privately.
  useEffect(() => {
    const packet = continuedRun?.packet as ChatAnswer | undefined;
    if (
      !continuationHash ||
      !packet?.shortAnswer ||
      consumedContinuationRef.current === continuationHash ||
      turns.length > 0
    ) return;
    consumedContinuationRef.current = continuationHash;
    const createdAt = continuedRun.createdAt ?? Date.now();
    setHasUserInteracted(true);
    setCtx(`Continued from reproducible answer /r/${continuationHash}`);
    setTier((continuedRun.tier ?? "auto") as RouterTier);
    setTurns([
      { id: `receipt-user-${continuationHash}`, role: "user", text: continuedRun.prompt, createdAt },
      {
        id: `receipt-answer-${continuationHash}`,
        role: "assistant",
        packet,
        runHash: continuationHash,
        tier: (continuedRun.tier ?? "auto") as RouterTier,
        createdAt: createdAt + 1,
      },
    ]);
  }, [continuedRun, continuationHash, turns.length]);

  // Sprint 4 P1.6 — pinned items carried into the next turn's context.
  const [pinned, setPinned] = useState<Array<{ id: string; label: string; tier: RouterTier; sourceCount: number }>>([]);
  const [followUps, setFollowUps] = useState<Array<{ id: string; label: string; reportTitle?: string; createdAt: number }>>([]);
  const pinClaim = (turnId: string, packet: ChatAnswer, packetTier: RouterTier) => {
    const id = `${turnId}-${Date.now()}`;
    const label = packet.shortAnswer.length > 80
      ? packet.shortAnswer.slice(0, 77) + "…"
      : packet.shortAnswer;
    setPinned((cur) => [...cur, { id, label, tier: packetTier, sourceCount: packet.sourceCount }]);
    showToast({
      tone: "success",
      message: "Pinned. Carries forward into the next turn as hard context.",
    });
  };
  const unpinClaim = (id: string) => {
    setPinned((cur) => cur.filter((p) => p.id !== id));
  };
  const addFollowUp = (turnId: string, packet: ChatAnswer) => {
    const label = packet.nextAction || packet.shortAnswer;
    const id = `${turnId}-followup-${Date.now()}`;
    setFollowUps((cur) => [
      ...cur,
      {
        id,
        label: label.length > 120 ? `${label.slice(0, 117)}...` : label,
        reportTitle: liveDetail?.title,
        createdAt: Date.now(),
      },
    ]);
    showToast({
      tone: "success",
      message: "Follow-up queued in this conversation. Ask NodeBench to promote it when you are ready.",
    });
  };
  const removeFollowUp = (id: string) => {
    setFollowUps((cur) => cur.filter((item) => item.id !== id));
  };
  const openCurrentReport = () => {
    if (liveDetail?.id) {
      navigate(`/redesign/chat?report=${encodeURIComponent(liveDetail.id)}&artifact=brief`);
      return;
    }
    navigate("/redesign/chat?intent=reports");
  };

  const runScopeSnapshot = useMemo(() => buildRunScopeSnapshot({
    chatState: chatRun.state,
    liveDetail,
    turns,
  }), [chatRun.state, liveDetail, turns]);

  // Phase 5 — real counterfactual probe via the probeRun mutation.
  // Looks up the original run, kicks off a new run with the masked
  // source flagged unreliable in the system prompt, inserts a new
  // assistant turn that subscribes to the probed run's stream.
  const probeWithoutSourceReal = (originalTurnId: string, originalRunId: string, maskedIdx: number) => {
    const probeId = nextTurnId("a");
    setHasUserInteracted(true);
    setTurns((prev) => [
      ...prev,
      {
        id: probeId,
        role: "assistant",
        thinking: true,
        tier: "auto",
        createdAt: Date.now(),
        chatRunId: undefined,
      },
    ]);
    void probeRun({ originalRunId, maskedSourceIdx: maskedIdx })
      .then((probedRunId) => {
        setTurns((prev) => prev.map((t) =>
          t.id === probeId
            ? { ...t, chatRunId: probedRunId }
            : t,
        ));
        // Point the streaming hook at the probed run so its events
        // project into projected.run and the effect commits the packet.
        chatRun.subscribeTo(probedRunId);
        showToast({
          tone: "info",
          message: `Re-running without source [${maskedIdx}] — diff will appear inline.`,
        });
      })
      .catch((err: any) => {
        const msg = (err?.message || String(err)).slice(0, 200);
        setTurns((prev) => prev.filter((t) => t.id !== probeId));
        showToast({ tone: "warning", message: `Probe failed: ${msg}` });
      });
  };

  // Sprint 4 P2.7 — A/B compare modal state.
  const [compareTurnId, setCompareTurnId] = useState<string | null>(null);
  const compareTurn = compareTurnId ? turns.find((t) => t.id === compareTurnId) : undefined;

  useEffect(() => {
    if (hasUserInteracted || hasLaunchContext) return;
    setCtx(liveDetail?.title ?? contextLabel);
  }, [contextLabel, hasLaunchContext, hasUserInteracted, liveDetail]);

  // Phase 2 — when the streamed chat run completes, commit the final packet
  // onto whichever turn carries the matching chatRunId. While in flight,
  // also project the live scratchpad + partial tool calls into the turn so
  // the UI shows progressive streaming. Convex's reactive queries re-run
  // chatRun.state.run on every event, which triggers this effect.
  useEffect(() => {
    const real = chatRun.state.run;
    if (!real) return;
    setTurns((prev) => {
      const idx = prev.findIndex((t) => t.chatRunId === real.runId);
      if (idx < 0) return prev;
      const t = prev[idx];
      // Always reflect live scratchpad + tool-call cards as they grow.
      const live = {
        ...t,
        liveScratchpad: real.scratchpad || t.liveScratchpad,
        toolCalls: real.toolCalls.length > 0
          ? real.toolCalls.map((tc) => ({
              step: tc.step,
              detail: tc.detail,
              status: (tc.status === "ok" ? "ok"
                : tc.status === "error" ? "error"
                : tc.status === "warn" ? "warn"
                : "ok") as ToolCall["status"],
              durationMs: tc.durationMs,
              tool: tc.step.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
            }))
          : t.toolCalls,
      };
      // Once the run is complete, snap to the final packet.
      if (real.status === "complete" && real.packet?.shortAnswer) {
        const next = { ...live, thinking: false, packet: real.packet, runHash: real.hash };
        const out = [...prev];
        out[idx] = next;
        return out;
      }
      if (real.status === "cancelled") {
        const out = [...prev];
        out[idx] = {
          ...live,
          thinking: false,
          streaming: false,
          markdown: liveChatUnavailableMarkdown("Run cancelled. Any in-flight provider stream was aborted at the next cooperative checkpoint.", liveDetail),
        };
        return out;
      }
      if (real.packet?.runtime) {
        live.packet = real.packet;
      }
      // Error: keep the turn honest and avoid inserting a synthetic answer.
      if (real.status === "error") {
        const next = {
          ...live,
          thinking: false,
          packet: undefined,
          markdown: liveChatUnavailableMarkdown(
            real.errorMessage
          ? `The live chat run failed: ${real.errorMessage.slice(0, 180)}`
              : "The live chat run failed before producing a final packet.",
            liveDetail,
          ),
        };
        const out = [...prev];
        out[idx] = next;
        showToast({
          tone: "warning",
          message: real.errorMessage
            ? `Real chat failed: ${real.errorMessage.slice(0, 100)}. No fixture answer inserted.`
            : "Real chat failed. No fixture answer inserted.",
        });
        return out;
      }
      // Otherwise still in flight — keep thinking, but reflect live progress.
      const out = [...prev];
      out[idx] = live;
      return out;
    });
  }, [chatRun.state.run, liveDetail]);

  const sendMessage = (text: string, submittedTier: RouterTier) => {
    const now = Date.now();
    const userId = nextTurnId("u");
    const assistantId = nextTurnId("a");
    const conversationContext = buildConversationContext(turns);
    const parentRunHash = [...turns].reverse().find((turn) => turn.runHash)?.runHash;
    const canRunLiveChat = chatRun.state.available && !_skipLiveSeed;
    const unavailableReason = _skipLiveSeed
      ? "The `fresh=1` diagnostic flag disables live chat for this route."
      : authLoading
        ? "NodeBench is still resolving your account session before it can run live research."
        : !isAuthenticated
          ? "Sign in with an email-backed account before running live research."
          // BUG FIX (2026-07-01): `userLoading` means the account's eligibility check hasn't
          // resolved yet — a real, linked account can transiently look "not eligible" for a
          // moment right after sign-in. Show an honest retry message instead of the misleading
          // "link an account" text, which was shown even to correctly-linked accounts.
          // See docs/LIVE-USER-BENCHMARK-FINDING.md.
          : chatRun.state.userLoading
            ? "NodeBench is still confirming your account. Send your message again in a moment."
          : !chatRun.state.paidEligible
            ? "Link an email or Google account before running live research. Anonymous sessions can browse public memory only."
            : "NodeBench is still preparing the live chat runtime.";
    setHasUserInteracted(true);
    setTurns((prev) => [
      ...prev,
      { id: userId, role: "user", text, createdAt: now },
      canRunLiveChat
        ? { id: assistantId, role: "assistant", thinking: true, tier: submittedTier, createdAt: now + 50 }
        : {
            id: assistantId,
            role: "assistant",
            markdown: liveChatUnavailableMarkdown(unavailableReason, liveDetail),
            streaming: false,
            tier: submittedTier,
            createdAt: now + 50,
          },
    ]);
    // Phase 2: if real chat is available, kick off a streaming run via
    // Convex scheduler. submit() returns a runId in <100ms; the projected
    // run state (packet + scratchpad + tool calls + grounding) arrives
    // reactively via Convex queries. The effect below watches for
    // status === "complete" to commit the final packet onto this turn.
    if (canRunLiveChat) {
      // Phase 5 — carry pinned claims forward as hard context in the
      // system prompt. Each pin has a short label (the answer's tier +
      // shortAnswer) plus the source URL if grounded.
      const pinnedClaims = pinned.length > 0
        ? pinned.map((p) => ({ text: p.label || "pinned claim", source: undefined as string | undefined }))
        : undefined;
      const contextRef = liveDetail
        ? buildLiveContextRef(liveDetail, requestedArtifactKey)
        : undefined;
      void chatRun.submit(
        text,
        submittedTier,
        contextRef,
        pinnedClaims,
        conversationContext,
        parentRunHash,
      ).then((runId) => {
        if (runId) {
          setTurns((prev) => prev.map((t) =>
            t.id === assistantId
              ? { ...t, chatRunId: runId }
              : t,
          ));
        } else {
          // Submit failed: keep the assistant turn explicit instead of
          // fabricating a fallback answer packet.
          setTurns((prev) => prev.map((t) =>
            t.id === assistantId
              ? {
                  ...t,
                  thinking: false,
                  toolCalls: undefined,
                  packet: undefined,
                  markdown: liveChatUnavailableMarkdown(
                    chatRun.state.error ?? "The live chat run could not be started.",
                    liveDetail,
                  ),
                }
              : t,
          ));
        }
      });
      return;
    }
    // The assistant turn already renders the durable unavailable reason inline.
    // A second toast obscured the user's prompt on mobile without adding recovery value.
  };

  useEffect(() => {
    const prompt = initialPrompt?.trim();
    if (!prompt || consumedInitialPromptRef.current === prompt) return;
    if ((authLoading || liveArtifacts.isLoading) && !_skipLiveSeed) return;
    consumedInitialPromptRef.current = prompt;
    sendMessage(prompt, tier);
  // sendMessage intentionally stays outside the dependency list because it is
  // scoped to the current render state and this effect is keyed by URL prompt
  // plus live-run availability to avoid consuming q= while Convex auth loads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, chatRun.state.available, initialPrompt, liveArtifacts.isLoading, _skipLiveSeed, tier]);

  const regenerate = (turnId: string, _tierOverride?: "free" | "fast" | "deep") => {
    const targetIndex = turns.findIndex((t) => t.id === turnId);
    const priorTurns = targetIndex > 0 ? turns.slice(0, targetIndex) : [];
    const conversationContext = buildConversationContext(priorTurns);
    const parentRunHash = [...priorTurns].reverse().find((turn) => turn.runHash)?.runHash;
    const prompt = (() => {
      for (let i = targetIndex - 1; i >= 0; i--) {
        if (turns[i].role === "user" && turns[i].text?.trim()) return turns[i].text.trim();
      }
      return "";
    })();
    const requestedTier = (_tierOverride ?? turns[targetIndex]?.tier ?? tier) as RouterTier;
    setTurns((prev) => prev.map((t) =>
      t.id === turnId
        ? { ...t, thinking: true, packet: undefined, markdown: undefined, toolCalls: undefined, createdAt: Date.now() }
        : t,
    ));
    if (prompt && chatRun.state.available && !_skipLiveSeed) {
      const pinnedClaims = pinned.length > 0
        ? pinned.map((p) => ({ text: p.label || "pinned claim", source: undefined as string | undefined }))
        : undefined;
      const contextRef = liveDetail
        ? buildLiveContextRef(liveDetail, requestedArtifactKey)
        : undefined;
      void chatRun.submit(
        prompt,
        requestedTier,
        contextRef,
        pinnedClaims,
        conversationContext,
        parentRunHash,
      ).then((runId) => {
        setTurns((prev) => prev.map((t) =>
          t.id === turnId
            ? runId
              ? { ...t, chatRunId: runId, tier: requestedTier }
              : {
                  ...t,
                  thinking: false,
                  markdown: liveChatUnavailableMarkdown(
                    chatRun.state.error ?? "Regenerate could not start a live chat run.",
                    liveDetail,
                  ),
                }
            : t,
        ));
      });
      return;
    }
    setTurns((prev) => prev.map((t) =>
      t.id === turnId
        ? {
            ...t,
            thinking: false,
            toolCalls: undefined,
            packet: undefined,
            markdown: liveChatUnavailableMarkdown(
              prompt
                ? "Regenerate needs the live chat runtime to be ready."
                : "Regenerate needs an original user prompt for this turn.",
              liveDetail,
            ),
          }
        : t,
    ));
  };

  const branchFromTurn = (turnId: string) => {
    const idx = turns.findIndex((t) => t.id === turnId);
    if (idx < 0) return;
    setHasUserInteracted(true);
    setTurns(turns.slice(0, idx + 1));
    setCtx(`Branched from message ${turnId}`);
  };

  return (
    <div
      className="rd-chat-workspace"
      data-agent-runtime-surface="redesign-chat"
      data-empty={turns.length === 0 ? "true" : undefined}
      data-continuation={continuationHash ? "true" : undefined}
    >
      {continuationHash && (
        <aside
          className="rd-continuation-context"
          data-testid="continued-chat-context"
          data-state={continuedRun === undefined ? "loading" : continuedRun === null ? "unavailable" : "ready"}
          aria-live="polite"
        >
          <div>
            <span className="rd-eyebrow">Continued conversation</span>
            <p>
              {continuedRun === undefined
                ? "Restoring the reproducible answer and its evidence…"
                : continuedRun === null
                  ? "That reproducible answer is unavailable. You can still start a new chat below."
                  : `Prompt, answer, and ${continuedRun.packet?.sourceCount ?? 0} source${continuedRun.packet?.sourceCount === 1 ? "" : "s"} are carried into new messages.`}
            </p>
          </div>
          <a className="rd-btn rd-btn--quiet rd-btn--sm" href={`/redesign/chat/r/${encodeURIComponent(continuationHash)}`}>
            View immutable receipt
          </a>
        </aside>
      )}
      <BatchLiveBoundary onError={() => setLiveBatch(null)}>
        <BatchLiveBridge onBatch={setLiveBatch} />
      </BatchLiveBoundary>
      <Conversation className="rd-chat-transcript">
        <ConversationContent className="rd-chat-transcript__content">
        <LaunchContextCard
          intent={requestedIntent}
          artifactKey={requestedArtifactKey}
          requestedReportId={requestedReportId}
          detail={liveDetail}
          isAuthenticated={isAuthenticated}
        />
        {batch && <BatchMonitorCell batch={batch} />}

        {turns.length === 0 && continuationHash && continuedRun === undefined ? (
          <div className="rd-card rd-card__pad" role="status">Restoring conversation context…</div>
        ) : turns.length === 0 ? (
          <ChatEmptyState
            starters={liveStarters}
            onPick={(prompt) => sendMessage(prompt, tier)}
          />
        ) : (
          turns.map((t) => {
            const inner = (() => {
              if (t.role === "user") return <UserBubble text={t.text!} createdAt={t.createdAt} />;
              if (t.thinking) return (
                <div className="rd-stack" style={{ gap: 10 }}>
                  <ChatThinking />
                  <LiveResearchChecklist
                    compact
                    title="Live research run"
                    stages={buildResearchStages(t.toolCalls ?? [], true)}
                  />
                  <RuntimeBoard runtime={t.packet?.runtime} />
                </div>
              );
              if (t.markdown) return (
                <StreamingAnswer
                  text={t.markdown}
                  streaming={t.streaming}
                  tier={t.tier ?? "auto"}
                  createdAt={t.createdAt}
                  onRegenerate={(tierOverride) => regenerate(t.id, tierOverride)}
                  onBranch={() => branchFromTurn(t.id)}
                />
              );
              return (
                <AnswerPacket
                  packet={t.packet!}
                  tier={t.tier ?? "auto"}
                  toolCalls={t.toolCalls}
                  reportTitle={liveDetail?.title}
                  workingNotesMarkdown={t.liveScratchpad}
                  createdAt={t.createdAt}
                  onRegenerate={(tierOverride) => regenerate(t.id, tierOverride)}
                  onBranch={() => branchFromTurn(t.id)}
                  onPin={() => pinClaim(t.id, t.packet!, t.tier ?? "auto")}
                  onAddFollowUp={() => addFollowUp(t.id, t.packet!)}
                  onOpenReport={openCurrentReport}
                  onCompare={t.chatRunId ? () => setCompareTurnId(t.id) : undefined}
                  onShare={() => shareAnswer(t.id, t.packet!, t.tier ?? "auto", t.runHash)}
                  onProbeRunWithoutSource={t.chatRunId ? (idx) => probeWithoutSourceReal(t.id, t.chatRunId!, idx) : undefined}
                  onReact={t.chatRunId ? (kind) => {
                    if (!isAuthenticated) {
                      showToast({
                        tone: "info",
                        message: kind === "up"
                          ? "Marked helpful locally. Sign in to persist this to the eval flywheel."
                          : "Marked not helpful locally. Sign in to persist this to the eval flywheel.",
                      });
                      return;
                    }
                    void recordReaction({
                      runId: t.chatRunId!,
                      runSource: "redesign-chat",
                      turnId: t.id,
                      reaction: kind,
                    }).then(() => {
                      showToast({ tone: kind === "up" ? "success" : "info", message: kind === "up" ? "Thanks — recorded as 👍." : "Recorded as 👎. Feeds the eval flywheel." });
                    }).catch((err: any) => {
                      showToast({ tone: "warning", message: `Could not save reaction: ${(err?.message || String(err)).slice(0, 100)}` });
                    });
                  } : undefined}
                />
              );
            })();
            return (
              <div
                key={t.id}
                data-turn-id={t.id}
                data-chat-run-id={t.chatRunId || undefined}
              >
                {inner}
              </div>
            );
          })
        )}
        </ConversationContent>
        <ConversationScrollButton className="rd-chat-scroll-btn" aria-label="Scroll to latest message" />
      </Conversation>
      {/* Sprint 4 P1.6 — pinned items carry forward into next turn */}
      {pinned.length > 0 && (
        <div className="rd-pinned-bar" role="region" aria-label="Pinned context for next turn">
          <span className="rd-eyebrow rd-pinned-bar__eyebrow">📌 Carries forward · {pinned.length}</span>
          <ul className="rd-pinned-bar__list">
            {pinned.map((p) => (
              <li key={p.id} className="rd-pinned-chip">
                <span className="rd-pinned-chip__tier">{p.tier}</span>
                <span className="rd-pinned-chip__label" title={p.label}>{p.label}</span>
                <span className="rd-pinned-chip__count">[{p.sourceCount}]</span>
                <button
                  type="button"
                  className="rd-pinned-chip__close"
                  aria-label="Unpin"
                  onClick={() => unpinClaim(p.id)}
                >×</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {followUps.length > 0 && (
        <div className="rd-pinned-bar" role="region" aria-label="Queued follow-ups from this chat">
          <span className="rd-eyebrow rd-pinned-bar__eyebrow">Follow-ups queued · {followUps.length}</span>
          <ul className="rd-pinned-bar__list">
            {followUps.map((item) => (
              <li key={item.id} className="rd-pinned-chip">
                <span className="rd-pinned-chip__tier">next</span>
                <span className="rd-pinned-chip__label" title={item.label}>{item.label}</span>
                {item.reportTitle && <span className="rd-pinned-chip__count">{item.reportTitle}</span>}
                <button
                  type="button"
                  className="rd-pinned-chip__close"
                  aria-label="Remove queued follow-up"
                  onClick={() => removeFollowUp(item.id)}
                >×</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="rd-composer-dock">
        <div className="rd-composer-shell">
          <RunScopeDisclosure snapshot={runScopeSnapshot} />
          <UniversalComposer
            hideAttachments
            contextLabel={ctx}
            onSubmit={sendMessage}
            tier={tier}
            onTierChange={setTier}
            placeholder="Ask anything · type / for commands"
            streaming={turns.some((t) => t.thinking || t.streaming)}
            onStop={() => {
              const targetTurn = [...turns].reverse().find((turn) => turn.thinking || turn.streaming);
              if (!targetTurn) return;
              void chatRun.cancel(targetTurn.chatRunId ?? null).then((result) => {
                showToast({
                  tone: result === "unavailable" ? "warning" : "info",
                  message: result === "recorded"
                    ? "Cancellation recorded. The active stream will abort at its next checkpoint."
                    : result === "queued"
                      ? "Cancellation queued. It will be applied as soon as the run is registered."
                      : "The selected run was already terminal or unavailable.",
                });
                if (result === "unavailable") return;
                setTurns((prev) => prev.map((t) =>
                  t.id === targetTurn.id
                    ? {
                        ...t,
                        thinking: false,
                        streaming: false,
                        markdown: t.markdown
                          ? `${t.markdown}\n\n_(cancellation requested)_`
                          : liveChatUnavailableMarkdown("Cancellation requested before a live answer packet was available.", liveDetail),
                        packet: t.packet,
                      }
                    : t,
                ));
              });
            }}
          />
        </div>
      </div>

      {/* Sprint 3 P1.4 + Phase 4 — selection-based inline correction.
          When authenticated, save persists the correction as a 👎 reaction
          with note via recordReaction (eval-flywheel signal). */}
      <InlineCorrection
        onSave={isAuthenticated && chatRun.state.run?.runId ? (
          async (original, correction) => {
            try {
              await recordReaction({
                runId: chatRun.state.run!.runId,
                runSource: "redesign-chat",
                turnId: undefined,
                reaction: "down",
                note: `[correction] original: "${original.slice(0, 200)}" → corrected: "${correction.slice(0, 280)}"`,
              });
              return { ok: true };
            } catch (err: any) {
              return { ok: false, message: (err?.message || String(err)).slice(0, 200) };
            }
          }
        ) : undefined}
      />

      {/* Sprint 4 P2.7 + Phase 7 — A/B compare modal with real Variant B parallel run */}
      {compareTurn?.packet && (
        <ABCompareModal
          packet={compareTurn.packet}
          tier={compareTurn.tier ?? "auto"}
          prompt={(() => {
            // Find the user turn that precedes this assistant turn — its text is the prompt.
            const idx = turns.findIndex((t) => t.id === compareTurn.id);
            for (let i = idx - 1; i >= 0; i--) {
              if (turns[i].role === "user" && turns[i].text) return turns[i].text;
            }
            return undefined;
          })()}
          onClose={() => setCompareTurnId(null)}
          onPick={(variant, variantBRunId) => {
            setCompareTurnId(null);
            if (!isAuthenticated) {
              showToast({
                tone: "info",
                message: `Variant ${variant} selected locally. Sign in to persist A/B feedback to the eval flywheel.`,
              });
              return;
            }
            const writes: Array<Promise<unknown>> = [];
            if (compareTurn.chatRunId) {
              writes.push(recordReaction({
                runId: compareTurn.chatRunId,
                runSource: "redesign-chat",
                turnId: compareTurn.id,
                reaction: variant === "A" ? "up" : "down",
                note: `[ab_compare] picked ${variant}; original=A; variantB=${variantBRunId ?? "not-started"}`,
              }));
            }
            if (variantBRunId) {
              writes.push(recordReaction({
                runId: variantBRunId,
                runSource: "redesign-chat",
                turnId: undefined,
                reaction: variant === "B" ? "up" : "down",
                note: `[ab_compare] picked ${variant}; variantB=B; original=${compareTurn.chatRunId ?? "not-recorded"}`,
              }));
            }
            if (writes.length === 0) {
              showToast({ tone: "info", message: `Variant ${variant} selected locally.` });
              return;
            }
            void Promise.allSettled(writes).then((results) => {
              const failures = results.filter((r) => r.status === "rejected").length;
              showToast({
                tone: failures === writes.length ? "warning" : "success",
                message: failures === writes.length
                  ? `Variant ${variant} selected, but A/B feedback was not saved.`
                  : `Variant ${variant} selected and saved to the eval flywheel.`,
              });
            });
          }}
        />
      )}
    </div>
  );
}

function RunScopeDisclosure({ snapshot }: { snapshot: RunScopeSnapshot }) {
  return (
    <details className="rd-run-scope" data-status={snapshot.status}>
      <summary>
        <svg className="rd-run-scope__icon" width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
          <path d="m9 12 2 2 4-4" />
        </svg>
        <span>{snapshot.reads}</span>
        <span>Review · no shared writes</span>
      </summary>
      <dl>
        <div><dt>Reads</dt><dd>{snapshot.reads}</dd></div>
        <div><dt>Writes</dt><dd>{snapshot.writes}</dd></div>
        <div><dt>Checks</dt><dd>{snapshot.verification}</dd></div>
      </dl>
    </details>
  );
}

/**
 * Sprint 3 P1.4 — selection-based inline correction.
 *
 * Listens for text selections inside `.rd-chat-msg__body` (assistant
 * messages only). When the user highlights 5–300 chars, a floating
 * "Correct →" bubble appears at the selection's bounding rect. Clicking
 * opens an inline edit dialog pre-filled with the selection. Saving persists
 * against the current run when the user is authenticated; otherwise it gives
 * an explicit sign-in prompt instead of pretending the correction was stored.
 */
interface InlineCorrectionProps {
  /** Phase 4 — when set, save calls a real mutation against this run. */
  onSave?: (original: string, correction: string) => Promise<{ ok: boolean; message?: string }>;
}

function InlineCorrection({ onSave }: InlineCorrectionProps = {}) {
  const [bubble, setBubble] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const [editing, setEditing] = useState<{ original: string; draft: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editing) return; // pause selection observer while editing
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setBubble(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const txt = sel.toString().trim();
      if (txt.length < 5 || txt.length > 300) {
        setBubble(null);
        return;
      }
      // Confirm selection is inside an assistant message body
      const ancestor = range.commonAncestorContainer;
      const el = ancestor instanceof Element ? ancestor : ancestor.parentElement;
      if (!el?.closest(".rd-chat-msg--assistant")) {
        setBubble(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setBubble(null);
        return;
      }
      setBubble({
        x: rect.left + rect.width / 2,
        y: rect.top - 6,
        text: txt,
      });
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [editing]);

  // Esc closes editor
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  const startCorrection = () => {
    if (!bubble) return;
    setEditing({ original: bubble.text, draft: bubble.text });
    setBubble(null);
    window.getSelection()?.removeAllRanges();
  };

  const save = async () => {
    if (!editing) return;
    if (editing.draft.trim() === editing.original.trim()) {
      showToast({ tone: "info", message: "No change to save." });
      setEditing(null);
      return;
    }
    if (onSave) {
      // Phase 4 — real persistence path. Calls recordReaction with the
      // correction text as a 👎 note; the eval flywheel surfaces it.
      setBusy(true);
      try {
        const result = await onSave(editing.original, editing.draft);
        showToast({
          tone: result.ok ? "success" : "warning",
          message: result.message || (result.ok
            ? "Correction saved to your NodeBench memory."
            : "Could not save correction — try again."),
        });
      } finally {
        setBusy(false);
        setEditing(null);
      }
      return;
    }
    // Unsigned persistence fallback: the correction still stays visible locally,
    // but it is not written to the long-term feedback ledger.
    showToast({
      tone: "info",
      message: "Use Sign in in the header to persist corrections to memory.",
    });
    setEditing(null);
  };

  return (
    <>
      {bubble && !editing && (
        <button
          type="button"
          className="rd-correct-bubble"
          style={{
            position: "fixed",
            top: bubble.y,
            left: bubble.x,
            transform: "translate(-50%, -100%)",
          }}
          onMouseDown={(e) => e.preventDefault() /* keep selection alive */}
          onClick={startCorrection}
        >
          <span aria-hidden="true">✏️</span>
          <span>Correct this</span>
        </button>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        {editing && (
          <DialogContent
            className="rd-correct-dialog"
            overlayClassName="rd-correct-overlay"
            portalContainer={typeof document !== "undefined" ? document.querySelector<HTMLElement>("[data-redesign]") : null}
            showCloseButton={false}
          >
            <div className="rd-correct-dialog__head">
              <DialogTitle className="rd-eyebrow text-[10px] font-semibold leading-none tracking-[0.12em]">
                Correct this claim
              </DialogTitle>
              <button
                type="button"
                className="rd-correct-dialog__close"
                aria-label="Cancel correction"
                onClick={() => setEditing(null)}
              >
                ✕
              </button>
            </div>
            <div className="rd-correct-dialog__original">
              <span className="rd-mono rd-correct-dialog__label">Original</span>
              <p>{editing.original}</p>
            </div>
            <div className="rd-correct-dialog__edit">
              <label className="rd-mono rd-correct-dialog__label" htmlFor="rd-correct-input">
                Correction (writes a memory patch — review required)
              </label>
              <textarea
                id="rd-correct-input"
                className="rd-correct-dialog__textarea"
                value={editing.draft}
                onChange={(e) => setEditing({ ...editing, draft: e.target.value })}
                rows={4}
                autoFocus
              />
            </div>
            <div className="rd-correct-dialog__actions">
              <button type="button" className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className="rd-btn rd-btn--primary rd-btn--sm" onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Queue patch"}
              </button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

function ABCompareModal({
  packet,
  tier,
  prompt,
  onClose,
  onPick,
}: {
  packet: ChatAnswer;
  tier: RouterTier;
  /** Phase 7 — original prompt to re-run for Variant B real parallel call. */
  prompt?: string;
  onClose: () => void;
  onPick: (variant: "A" | "B", variantBRunId?: string) => void;
}) {
  // Phase 7 — real Variant B parallel run.
  // When the modal opens and the original prompt was captured, kick off a
  // second startChat call and subscribe to its run row + events so the modal
  // renders the streaming Variant B in real time.
  const { isLoading: authLoading } = useConvexAuth();
  const startChat = useMutation(api.domains.redesign.chatRuns.startChat);
  const [variantBRunId, setVariantBRunId] = useState<string | null>(null);
  const [variantBError, setVariantBError] = useState<string | null>(null);
  const variantBRow = useQuery(
    api.domains.redesign.chatRuns.getRun,
    variantBRunId ? { runId: variantBRunId } : "skip",
  );
  const variantBEvents = useQuery(
    api.domains.redesign.chatRuns.streamEventsForRun,
    variantBRunId ? { runId: variantBRunId } : "skip",
  );

  // Kick off the parallel run on first open. Use temperature variation by
  // randomly switching between auto/fast — Gemini's stochasticity gives
  // a genuinely different draft.
  useEffect(() => {
    if (variantBRunId) return;
    if (authLoading || !prompt || prompt.trim().length < 3) return;
    let cancelled = false;
    void startChat({ prompt, tier: normalizeRouterTierForChatRun(tier), contextRef: undefined })
      .then((runId) => {
        if (!cancelled) setVariantBRunId(runId);
      })
      .catch((err: any) => {
        if (!cancelled) setVariantBError((err?.message || String(err)).slice(0, 200));
      });
    return () => { cancelled = true; };
  }, [authLoading, prompt, tier, startChat, variantBRunId]);

  // Project Variant B from streamed sections so it renders progressively.
  const variantBPacket: { shortAnswer: string; whyItMatters: string } | null = (() => {
    if (variantBRow?.status === "complete" && variantBRow.packet) {
      return {
        shortAnswer: (variantBRow.packet as any).shortAnswer ?? "",
        whyItMatters: (variantBRow.packet as any).whyItMatters ?? "",
      };
    }
    if (!variantBEvents?.length) return null;
    const sections: Record<string, any> = {};
    for (const ev of variantBEvents) {
      if (ev.eventType === "section" && ev.payload?.name) {
        sections[ev.payload.name] = ev.payload;
      }
    }
    if (!sections.short_answer && !sections.why_it_matters) return null;
    return {
      shortAnswer: sections.short_answer?.text ?? "",
      whyItMatters: sections.why_it_matters?.text ?? "",
    };
  })();

  const variantBStatus: "blocked" | "starting" | "streaming" | "complete" | "error" =
    !prompt || prompt.trim().length < 3 ? "blocked"
    : variantBError ? "error"
    : !variantBRunId ? "starting"
    : variantBRow?.status === "complete" ? "complete"
    : variantBRow?.status === "error" ? "error"
    : "streaming";

  const tierMeta = DEFAULT_TIERS.find((t) => t.id === tier) ?? DEFAULT_TIERS[0];

  const showShort = variantBStatus === "blocked"
    ? "Variant B needs the original prompt to start a real parallel run."
    : variantBPacket?.shortAnswer || (variantBStatus === "streaming" ? "Streaming Variant B…" : variantBStatus === "starting" ? "Starting parallel run…" : variantBStatus === "error" ? `Error: ${variantBError ?? variantBRow?.errorMessage ?? "unknown"}` : "");
  const showWhy = variantBStatus === "blocked"
    ? "No fixture comparison is generated. Re-run from a turn with a captured user prompt."
    : variantBPacket?.whyItMatters || "";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="rd-ab-dialog"
        overlayClassName="rd-ab-overlay"
        portalContainer={typeof document !== "undefined" ? document.querySelector<HTMLElement>("[data-redesign]") : null}
        showCloseButton={false}
      >
        <header className="rd-ab-dialog__head">
          <DialogTitle className="rd-eyebrow text-[10px] font-semibold leading-none tracking-[0.12em]">
            A/B compare · {tierMeta.label} tier
          </DialogTitle>
          <span className="rd-ab-dialog__hint">
            {variantBStatus === "blocked"
              ? "Original prompt unavailable — no fixture Variant B generated."
              : variantBStatus === "complete"
              ? "Both runs complete — pick the winner. Loser becomes a teach-me example."
              : variantBStatus === "streaming"
              ? "Variant B streaming live from Gemini — pick when ready."
              : variantBStatus === "starting"
              ? "Starting parallel Variant B run…"
              : "Variant B errored — Variant A still pickable."}
          </span>
          <button
            type="button"
            className="rd-ab-dialog__close"
            aria-label="Close A/B compare"
            onClick={onClose}
          >{"✕"}</button>
        </header>
        <div className="rd-ab-dialog__grid">
          <article className="rd-ab-variant" data-variant="A">
            <header className="rd-ab-variant__head">
              <span className="rd-ab-variant__label">Variant A</span>
              <span className="rd-mono rd-ab-variant__meta">current</span>
            </header>
            <div className="rd-eyebrow">Short answer</div>
            <p className="rd-ab-variant__short">{packet.shortAnswer}</p>
            <div className="rd-eyebrow">Why useful</div>
            <p className="rd-ab-variant__why">{packet.whyItMatters}</p>
            <button
              type="button"
              className="rd-btn rd-btn--primary rd-btn--sm rd-ab-variant__pick"
              onClick={() => onPick("A", variantBRunId ?? undefined)}
            >Pick A</button>
          </article>
          <article className="rd-ab-variant" data-variant="B" data-status={variantBStatus}>
            <header className="rd-ab-variant__head">
              <span className="rd-ab-variant__label">Variant B</span>
              <span className="rd-mono rd-ab-variant__meta">
                {variantBStatus === "complete" ? "parallel run · complete"
                  : variantBStatus === "streaming" ? "parallel run · streaming…"
                  : variantBStatus === "starting" ? "parallel run · starting…"
                  : variantBStatus === "error" ? "parallel run · error"
                  : "blocked"}
              </span>
            </header>
            <div className="rd-eyebrow">Short answer</div>
            <p className="rd-ab-variant__short">{showShort || "—"}</p>
            <div className="rd-eyebrow">Why useful</div>
            <p className="rd-ab-variant__why">{showWhy || "—"}</p>
            <button
              type="button"
              className="rd-btn rd-btn--primary rd-btn--sm rd-ab-variant__pick"
              onClick={() => onPick("B", variantBRunId ?? undefined)}
              disabled={variantBStatus === "blocked" || variantBStatus === "starting" || variantBStatus === "error" || (variantBStatus === "streaming" && !variantBPacket?.shortAnswer)}
            >Pick B</button>
          </article>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BatchMonitorCell({ batch }: { batch: ActiveBatchRun }) {
  const pct = Math.round((batch.doneCount / batch.totalEntities) * 100);
  const eta = batch.etaSeconds < 60
    ? `${batch.etaSeconds}s`
    : `${Math.floor(batch.etaSeconds / 60)}m ${batch.etaSeconds % 60}s`;
  return (
    <article className="rd-batch-cell" aria-label="Active batch run">
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: "var(--rd-accent)", color: "#fff",
        display: "grid", placeItems: "center",
      }}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </div>
      <div className="rd-stack" style={{ gap: 6, minWidth: 0 }}>
        <div className="rd-batch-cell__head">
          <span className="rd-batch-cell__title">Running batch · {batch.universeName}</span>
          <Pill tone="accent">{batch.styleName}</Pill>
          <Pill>{batch.rubric}</Pill>
        </div>
        <div className="rd-batch-cell__bar"><span style={{ width: `${pct}%` }} /></div>
        <div className="rd-batch-cell__meta">
          {batch.doneCount} / {batch.totalEntities} done
          {batch.reviewCount > 0 && <> · <strong style={{ color: "var(--rd-amber)" }}>{batch.reviewCount} need review</strong></>}
          {" · ETA "}{eta}{" · $"}{batch.spentUsd.toFixed(3)} spent
        </div>
        {batch.recentSteps.length > 0 && (
          <div className="rd-batch-cell__steps">
            {batch.recentSteps.map((s) => (
              <div key={s.entity} className="rd-batch-cell__step" data-status={s.status}>
                <span>{s.status === "done" ? "✓" : s.status === "running" ? "●" : s.status === "review" ? "⚠" : "·"}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.entity}</span>
                <span>{s.durationMs ? `${(s.durationMs / 1000).toFixed(1)}s` : s.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function UserBubble({ text, createdAt }: { text: string; createdAt?: number }) {
  return (
    <div className="rd-chat-msg rd-chat-msg--user">
      <div className="rd-chat-msg__bubble">
        {text}
        {createdAt && <span className="rd-chat-msg__when rd-chat-msg__when--user"><LiveTime at={createdAt} /></span>}
      </div>
      <div className="rd-chat-msg__avatar rd-chat-msg__avatar--user" aria-hidden="true">You</div>
    </div>
  );
}

/** Live-updating relative timestamp ("just now" → "1m ago" → "5m ago"). */
function LiveTime({ at }: { at: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const delta = Date.now() - at;
  const m = Math.floor(delta / 60_000);
  if (m < 1) return <>just now</>;
  if (m < 60) return <>{m}m ago</>;
  const h = Math.floor(m / 60);
  if (h < 24) return <>{h}h ago</>;
  return <>{Math.floor(h / 24)}d ago</>;
}

/**
 * StreamingAnswer — chat-grade markdown response (parity-studio pattern).
 * Used for free-form follow-up answers that don't need the full structured packet.
 * Displays a typewriter caret while streaming; respects prefers-reduced-motion.
 */
function StreamingAnswer({
  text,
  streaming,
  tier,
  createdAt,
  onRegenerate,
  onBranch,
}: {
  text: string;
  streaming?: boolean;
  tier: RouterTier;
  createdAt?: number;
  onRegenerate?: (tierOverride?: "free" | "fast" | "deep") => void;
  onBranch?: () => void;
}) {
  const tierMeta = DEFAULT_TIERS.find((t) => t.id === tier) ?? DEFAULT_TIERS[0];
  return (
    <div className="rd-chat-msg rd-chat-msg--assistant">
      <div className="rd-chat-msg__avatar" aria-hidden="true">✦</div>
      <article className="rd-chat-msg__body" style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 8, background: "var(--rd-paper-warm)", borderRadius: "var(--rd-r-md)", borderBottomLeftRadius: 4 }}>
        <div className="rd-agent-lead">NodeBench</div>
        <div className="rd-agent-detail">
          <StreamingMarkdown text={text} streaming={streaming} cps={260} />
        </div>
        <div className="rd-tool-badges">
          <span className="rd-tool-badge">{tierMeta.label}</span>
          {streaming && <span className="rd-tool-badge">streaming</span>}
        </div>
        <div className="rd-feedback" role="toolbar" aria-label="Feedback">
          <FeedbackButton copyText={text} />
          <FeedbackThumb kind="up" onRegenerate={onRegenerate} />
          <FeedbackThumb kind="down" />
        </div>
      </article>
    </div>
  );
}

function AnswerPacket({
  packet,
  tier,
  toolCalls,
  reportTitle,
  workingNotesMarkdown,
  createdAt,
  onRegenerate,
  onBranch,
  onPin,
  onAddFollowUp,
  onOpenReport,
  onCompare,
  onShare,
  onReact,
  onProbeRunWithoutSource,
}: {
  packet: ChatAnswer;
  tier: RouterTier;
  toolCalls?: ToolCall[];
  reportTitle?: string;
  workingNotesMarkdown?: string;
  createdAt?: number;
  onRegenerate?: (tierOverride?: "free" | "fast" | "deep") => void;
  onBranch?: () => void;
  onPin?: () => void;
  onAddFollowUp?: () => void;
  onOpenReport?: () => void;
  onCompare?: () => void;
  onShare?: () => void;
  /** Phase 5 — when set, the 👍/👎 buttons persist via recordReaction. */
  onReact?: (kind: "up" | "down") => void;
  /** Phase 5 — when set, "Probe without [N]" calls a real action that
   *  re-runs the model with that source masked. The handler returns the
   *  probedRunId so the AnswerPacket can swap into the probed answer. */
  onProbeRunWithoutSource?: (maskedSourceIdx: number) => void;
}) {
  const tierMeta = DEFAULT_TIERS.find((t) => t.id === tier) ?? DEFAULT_TIERS[0];
  const [hoverCite, setHoverCite] = useState<number | null>(null);
  // Sprint 2 P0.3 — counterfactual probe state
  const [maskedIdx, setMaskedIdx] = useState<number | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const traceRef = useRef<HTMLDetailsElement | null>(null);
  const researchStages = buildResearchStages(toolCalls ?? packet.trace);
  const isCompactResponse =
    !packet.whyItMatters.trim() &&
    packet.risks.length === 0 &&
    !packet.nextAction.trim();

  // Wire citation interactivity: hover [N] in body → highlight matching source row in evidence list
  const handleCiteEnter = (idx: number) => setHoverCite(idx);
  const handleCiteLeave = () => setHoverCite(null);
  const probeWithoutSource = (idx: number) => {
    // Phase 5 — if a real probe handler is wired (authenticated user with
    // an active runId on this turn), call the real action.
    if (onProbeRunWithoutSource) {
      setMaskedIdx(idx);
      showToast({
        tone: "info",
        message: `Re-running model without source [${idx}]…`,
      });
      onProbeRunWithoutSource(idx);
      return;
    }
    showToast({
      tone: "warning",
      message: "Counterfactual probing is unavailable without an active runtime run.",
    });
  };
  const restoreProbe = () => {
    setMaskedIdx(null);
    showToast({ tone: "success", message: "Source restored. Original answer in view." });
  };
  const showTrace = () => {
    setTraceOpen(true);
    window.setTimeout(() => {
      traceRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
    }, 0);
  };
  return (
    <div className="rd-chat-msg rd-chat-msg--assistant" data-hover-cite={hoverCite ?? undefined}>
      {/* Avatar gutter — parity-studio bot icon pattern */}
      <div className="rd-chat-msg__avatar" aria-hidden="true">✦</div>

      <article className="rd-chat-msg__body" style={{ padding: "var(--rd-s-2) var(--rd-s-3)", display: "flex", flexDirection: "column", gap: "var(--rd-s-2)", background: "var(--rd-paper-warm)", borderRadius: "var(--rd-r-md)", borderBottomLeftRadius: 4 }}>
        <div className="rd-agent-lead">{packet.shortAnswer.length > 60 ? "Research complete" : "NodeBench"}</div>
        <header className="rd-chat-msg__header" style={{ fontSize: 10, color: "var(--rd-ink-faint)" }}>
          <span>{tierMeta.label}</span>
          <span>·</span>
          <span>{packet.sourceCount} sources</span>
          <span>·</span>
          <span>{formatTraceTelemetry(packet)}</span>
          {createdAt && <span className="rd-chat-msg__when"><LiveTime at={createdAt} /></span>}
        </header>

        {/* Status strip — tool badges (home-v3 parity) */}
        <div className="rd-tool-badges">
          {reportTitle && <span className="rd-tool-badge">{reportTitle}</span>}
          {typeof packet.runtime?.metrics?.memoryHitRate === "number" && (
            <span className="rd-tool-badge">{Math.round(packet.runtime.metrics.memoryHitRate * 100)}% memory hit</span>
          )}
          {typeof packet.paidCalls === "number" && (
            <span className="rd-tool-badge">{packet.paidCalls} external refresh{packet.paidCalls === 1 ? "" : "es"}</span>
          )}
        </div>

        {researchStages.length > 0 && (
          <LiveResearchChecklist compact title="Research run" stages={researchStages} />
        )}
        <RuntimeBoard runtime={packet.runtime} />

        {/* Inline tool-call cards (parity-studio pattern) — render the agent's actual reasoning.
            Phase 7 — each card wrapped in an error boundary so one failed
            card render doesn't crash the entire AnswerPacket. */}
        {toolCalls && toolCalls.length > 0 && (
          <div className="rd-toolcall-list">
            {toolCalls.map((c, i) => (
              <ToolCallBoundary key={i}>
                <ChatToolCall call={c} />
              </ToolCallBoundary>
            ))}
          </div>
        )}

        {/* Scratchpad is runtime-derived. No notes render when the run emitted none. */}
        {workingNotesMarkdown && <WorkingNotes markdown={workingNotesMarkdown} />}

        {/* Sprint 2 P0.3 — counterfactual probe banner (visible when a source is masked) */}
        {maskedIdx !== null && (
          <ProbeBanner idx={maskedIdx} onRestore={restoreProbe} />
        )}

      {/* Short answer — citations clickable + hover-linked to evidence list */}
      <section>
        <div className="rd-eyebrow" style={{ marginBottom: 6 }}>Short answer</div>
        <TooltipProvider delayDuration={180}>
          <p className="rd-answer-copy">
            {renderInlineWithCites(packet.shortAnswer, packet.evidence, handleCiteEnter, handleCiteLeave, onProbeRunWithoutSource ? probeWithoutSource : undefined, maskedIdx)}
          </p>
        </TooltipProvider>
      </section>

      {/* Compact response shapes intentionally omit memo-only sections. */}
      {packet.whyItMatters.trim() && (
        <section>
          <div className="rd-eyebrow" style={{ marginBottom: 6 }}>Why useful</div>
          <p className="rd-body" style={{ color: "var(--rd-ink-mute)", margin: 0 }}>{packet.whyItMatters}</p>
        </section>
      )}

      {/* Evidence — rows highlight when matching [N] in body is hovered */}
      {!isCompactResponse && packet.evidence.length > 0 && <section>
        <div className="rd-eyebrow" style={{ marginBottom: 8 }}>Evidence ({packet.evidence.length})</div>
        <ol className="rd-stack" style={{ gap: 8, listStyle: "none", padding: 0, margin: 0 }}>
          {packet.evidence.map((e) => {
            const trustBadge = sourceTrustBadge(e);
            return (
            <li
              key={e.idx}
              className="rd-evidence-row rd-card rd-card__pad-tight"
              data-cite={e.idx}
              data-active={hoverCite === e.idx || undefined}
              data-masked={maskedIdx === e.idx || undefined}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: 10,
                alignItems: "start",
                borderRadius: "var(--rd-r-sm)",
              }}
              onMouseEnter={() => handleCiteEnter(e.idx)}
              onMouseLeave={handleCiteLeave}
            >
              <span className="rd-cite rd-cite--block" data-cite={e.idx}>[{e.idx}]</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <p className="rd-body" style={{ margin: 0, fontSize: 13 }}>{e.quote}</p>
                {trustBadge && (
                  <span
                    className="rd-mono"
                    title={trustBadge.title}
                    style={{ fontSize: 10, color: trustBadge.color, display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    {e.verified === true ? "ok" : e.blocking ? "blocked" : "warn"} - {trustBadge.label}
                  </span>
                )}
              </div>
              {sourceUrlFromText(e.source) ? (
                <a
                  className="rd-mono"
                  href={sourceUrlFromText(e.source) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 10.5, color: "var(--rd-accent-strong)", textDecoration: "none", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {sourceLabel(e.source)}
                </a>
              ) : (
                <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>{e.source}</span>
              )}
            </li>
            );
          })}
        </ol>
      </section>}

      {/* Risks / unknowns */}
      {packet.risks.length > 0 && <section>
        <div className="rd-eyebrow" style={{ marginBottom: 8 }}>Risks / unknowns</div>
        <ul className="rd-stack" style={{ gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
          {packet.risks.map((r, i) => (
            <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}>
              <span className="rd-dot rd-dot--review" style={{ marginTop: 6, flexShrink: 0 }} />
              <span style={{ color: "var(--rd-ink-mute)" }}>{r}</span>
            </li>
          ))}
        </ul>
      </section>}

      {/* Next action */}
      {packet.nextAction.trim() && <section className="rd-card" style={{
        padding: 14,
        background: "var(--rd-accent-tint)",
        borderColor: "var(--rd-accent-ring)",
        borderRadius: "var(--rd-r-sm)",
      }}>
        <div className="rd-eyebrow" style={{ color: "var(--rd-accent-strong)", marginBottom: 4 }}>Next action</div>
        <p className="rd-body" style={{ margin: 0, color: "var(--rd-ink)" }}>{packet.nextAction}</p>
        <div className="rd-action-chips" style={{ marginTop: 10 }}>
          <button type="button" className="rd-action-chip rd-action-chip--primary" onClick={onAddFollowUp}>Add to follow-ups</button>
          <button type="button" className="rd-action-chip" onClick={onOpenReport}>Open {reportTitle ?? "report"}</button>
          <button type="button" className="rd-action-chip" onClick={onShare}>Export memo</button>
        </div>
      </section>}

      {/* Trace */}
      <details ref={traceRef} open={traceOpen} onToggle={(e) => setTraceOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="rd-eyebrow" style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: 6 }}>
          <span>How we got this answer</span>
          <span className="rd-mono" style={{ fontSize: 10, color: "var(--rd-ink-soft)" }}>{packet.trace.length} steps</span>
        </summary>
        <ol className="rd-stack" style={{ marginTop: 10, gap: 4, listStyle: "none", padding: 0 }}>
          {packet.trace.map((step, i) => (
            <li key={i} className="rd-row" style={{ gap: 12, fontSize: 12, padding: "6px 8px" }}>
              <span className="rd-mono" style={{ width: 24, color: "var(--rd-ink-soft)" }}>{String(i + 1).padStart(2, "0")}</span>
              <span className={`rd-dot rd-dot--${step.status === "ok" ? "live" : step.status === "warn" ? "review" : "watch"}`} />
              <span style={{ flex: 1, color: "var(--rd-ink)" }}>
                <strong style={{ fontWeight: 590 }}>{step.step}.</strong>{" "}
                <span style={{ color: "var(--rd-ink-mute)" }}>{step.detail}</span>
              </span>
              <span className="rd-mono" style={{ color: "var(--rd-ink-soft)", fontSize: 10.5 }}>
                {step.durationMs ? `${step.durationMs}ms` : "—"}
              </span>
            </li>
          ))}
        </ol>
      </details>

      {/* Minimal feedback row (home-v3 parity) */}
      <div className="rd-feedback" role="toolbar" aria-label="Feedback">
        <FeedbackButton copyText={packet.shortAnswer + "\n\n" + packet.whyItMatters} />
        <FeedbackThumb kind="up" />
        <FeedbackThumb kind="down" onRegenerate={onRegenerate} />
      </div>
      </article>

    </div>
  );
}

/**
 * Sprint 2 P0.2 — collapsible "Working notes" preview of the agent's scratchpad.
 *
 * Mirrors the `agentScratchpads` Convex table shape (per `.claude/rules/scratchpad_first.md`).
 * Once chat is live-wired, this becomes a `useScratchpadLive(runId)` subscription.
 * Today: fixture-driven preview that bridges the gap between thinking dots
 * and the structured AnswerPacket.
 */
function WorkingNotes({ markdown }: { markdown: string }) {
  const [open, setOpen] = useState(false);
  const lineCount = useMemo(() => markdown.split("\n").filter((l) => l.trim()).length, [markdown]);
  return (
    <details
      className="rd-working-notes"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="rd-working-notes__summary">
        <span className="rd-eyebrow rd-working-notes__eyebrow">Working notes</span>
        <span className="rd-working-notes__count">{lineCount} lines</span>
        <span className="rd-working-notes__chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
      </summary>
      <div className="rd-working-notes__body">
        {markdown.split("\n").map((line, i) => {
          if (!line.trim()) return <span key={i} className="rd-working-notes__br" />;
          if (line.startsWith("**") && line.endsWith("**")) {
            return (
              <div key={i} className="rd-working-notes__heading">{line.replace(/\*\*/g, "")}</div>
            );
          }
          return <div key={i} className="rd-working-notes__line">{line}</div>;
        })}
      </div>
    </details>
  );
}

/**
 * Sprint 2 P0.3 — counterfactual probe banner shown when a source is masked.
 * The full feature would re-run the model with that source filtered out and
 * diff the answers; today we surface the affordance + a degradation note.
 */
function RuntimeBoard({ runtime }: { runtime?: ChatAnswer["runtime"] }) {
  const contextCandidates = runtime?.contextCandidates ?? [];
  const toolDecisions = runtime?.toolDecisions ?? [];
  const claimChecks = runtime?.claimChecks ?? [];
  const metrics = runtime?.metrics;
  const contextPacket = runtime?.contextPacket;
  const liveGroundingDecision = runtime?.liveGroundingDecision;
  const boardState = runtime?.boardState ?? {};
  if (contextCandidates.length === 0 && toolDecisions.length === 0 && claimChecks.length === 0 && !metrics && !contextPacket) {
    return null;
  }
  const goal = typeof boardState.goal === "string" ? boardState.goal.replace(/_/g, " ") : "answer with cited research";
  const entity = typeof boardState.entity === "string" ? boardState.entity : "no entity locked";
  const targetReport = typeof boardState.targetReport === "string" ? boardState.targetReport : "no report selected";
  return (
    <details className="rd-runtime-board" data-testid="chat-runtime-board" open>
      <summary className="rd-runtime-board__summary">
        <span>
          <span className="rd-eyebrow">Runtime board</span>
          <span className="rd-runtime-board__title">{goal}</span>
        </span>
        <span className="rd-runtime-board__meta">
          {contextCandidates.length} context · {toolDecisions.length} decisions · {claimChecks.length} checks
        </span>
      </summary>
      <div className="rd-runtime-board__body">
        <div className="rd-runtime-board__strip">
          <RuntimeMetric label="Entity" value={entity} />
          <RuntimeMetric label="Target" value={targetReport} />
          <RuntimeMetric label="Cost" value={formatUsd(metrics?.estimatedCostUsd)} />
          <RuntimeMetric label="Tokens" value={typeof metrics?.totalTokens === "number" ? metrics.totalTokens.toLocaleString() : "pending"} />
          <RuntimeMetric label="Latency" value={formatMs(metrics?.totalLatencyMs ?? metrics?.timeToFinalMs)} />
          <RuntimeMetric label="Model" value={metrics?.model ?? "pending"} />
          <RuntimeMetric label="Provider" value={metrics?.provider ?? "pending"} />
          <RuntimeMetric label="Receipt" value={compactRunId(metrics?.runtimeReceiptId) ?? "pending"} />
          <RuntimeMetric label="Memory hit" value={formatPct(metrics?.memoryHitRate)} />
          <RuntimeMetric label="Live search" value={liveGroundingDecision ? liveGroundingDecision.useLiveGrounding ? "on" : "skipped" : `${metrics?.liveSearchCalls ?? 0}`} />
        </div>
        {contextPacket && (
          <section className="rd-runtime-table">
            <div className="rd-runtime-table__title">Context runtime packet</div>
            <div className="rd-runtime-table__rows">
              <div className="rd-runtime-row">
                <span className="rd-runtime-row__status" data-status={contextPacket.hasContext ? "selected" : "blocked"}>
                  {contextPacket.hasContext ? "resolved" : "unresolved"}
                </span>
                <span className="rd-runtime-row__main">{contextPacket.title}</span>
                <span className="rd-runtime-row__detail">
                  {contextPacket.graph.nodeCount} nodes · {contextPacket.sourceRefs.length} sources · {contextPacket.verification.tier}
                </span>
              </div>
              {contextPacket.graph.clusters.slice(0, 4).map((cluster) => (
                <div key={cluster.name} className="rd-runtime-row">
                  <span className="rd-runtime-row__status" data-status={cluster.name === "blocked" && cluster.count > 0 ? "blocked" : "complete"}>
                    {cluster.name}
                  </span>
                  <span className="rd-runtime-row__main">{cluster.count} item{cluster.count === 1 ? "" : "s"}</span>
                  <span className="rd-runtime-row__detail">{cluster.sample.join(" · ") || "No sample in packet."}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        <RuntimeArtifactTable title="Context candidates" rows={contextCandidates} />
        <RuntimeArtifactTable title="Tool decisions" rows={toolDecisions} />
        {claimChecks.length > 0 && (
          <section className="rd-runtime-table">
            <div className="rd-runtime-table__title">Claim checks</div>
            <div className="rd-runtime-table__rows">
              {claimChecks.slice(0, 6).map((row, index) => (
                <div key={`${row.idx}-${row.status}-${index}`} className="rd-runtime-row">
                  <span className="rd-runtime-row__status" data-status={isBlockingClaimCheck(row) ? "blocked" : row.verified === false ? "warning" : row.status}>{row.status}</span>
                  <span className="rd-runtime-row__main">Source [{row.idx}]</span>
                  <span className="rd-runtime-row__detail">{row.verificationDetail ?? row.validationError ?? row.detail ?? row.method ?? "verification queued"}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </details>
  );
}

function RuntimeArtifactTable({ title, rows }: { title: string; rows: NonNullable<ChatAnswer["runtime"]>["contextCandidates"] }) {
  if (!rows || rows.length === 0) return null;
  return (
    <section className="rd-runtime-table">
      <div className="rd-runtime-table__title">{title}</div>
      <div className="rd-runtime-table__rows">
        {rows.map((row) => (
          <div key={row.id} className="rd-runtime-row">
            <span className="rd-runtime-row__status" data-status={row.status}>{row.status}</span>
            <span className="rd-runtime-row__main">{row.label}</span>
            <span className="rd-runtime-row__detail">
              {row.confidence !== undefined ? `${Math.round(row.confidence * 100)}% · ` : ""}
              {row.riskTier ? `${row.riskTier} risk · ` : ""}
              {row.detail}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RuntimeMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="rd-runtime-metric">
      <span className="rd-runtime-metric__label">{label}</span>
      <span className="rd-runtime-metric__value">{value}</span>
    </span>
  );
}

function ProbeBanner({ idx, onRestore }: { idx: number; onRestore: () => void }) {
  return (
    <div className="rd-probe-banner" role="status" aria-live="polite">
      <span className="rd-probe-banner__icon" aria-hidden="true">🔬</span>
      <div className="rd-stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
        <span className="rd-probe-banner__title">
          Probing without source [{idx}]
        </span>
        <span className="rd-probe-banner__detail">
          Re-running without this source. Awaiting a verified result from the active runtime.
        </span>
      </div>
      <button type="button" className="rd-btn rd-btn--quiet rd-btn--sm" onClick={onRestore}>
        Restore
      </button>
    </div>
  );
}

/** Runtime telemetry only; missing cost data is never inferred from duration. */
function formatTraceTelemetry(packet: ChatAnswer): string {
  if (packet.runtime?.metrics) {
    const metrics = packet.runtime.metrics;
    return `${formatMs(metrics.totalLatencyMs ?? metrics.timeToFinalMs)} · ${formatUsd(metrics.estimatedCostUsd)}`;
  }
  const recordedDurations = packet.trace
    .map((step) => step.durationMs)
    .filter((duration): duration is number => typeof duration === "number" && Number.isFinite(duration));
  if (recordedDurations.length === 0) return "telemetry not recorded";
  const totalMs = recordedDurations.reduce((sum, duration) => sum + duration, 0);
  return `${formatMs(totalMs)} · cost not recorded`;
}

function formatUsd(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "pending";
  return value >= 0.01 ? `$${value.toFixed(3)}` : "<$0.01";
}

function formatMs(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "pending";
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`;
}

function formatPct(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "pending";
  return `${Math.round(value * 100)}%`;
}

/**
 * Render text with [N] citation patterns turned into interactive chips.
 *
 * Hover uses the shared Radix tooltip and right-click uses the shared Radix
 * context menu, keeping positioning, dismissal, and keyboard focus primitive-owned.
 * Hovering a [N] also fires the linkage handler so the evidence row highlights.
 */
function renderInlineWithCites(
  text: string,
  evidence: ChatAnswer["evidence"],
  onEnter: (idx: number) => void,
  onLeave: () => void,
  onProbe?: (idx: number) => void,
  maskedIdx?: number | null,
): ReactNode[] {
  const re = /\[(\d+)\]/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const idx = Number(m[1]);
    const cite = evidence.find((e) => e.idx === idx);
    if (!cite) continue;
    const sourceUrl = sourceUrlFromText(cite.source);
    if (m.index > last) out.push(<span key={`t${last}`}>{text.slice(last, m.index)}</span>);
    out.push(
      <ContextMenu key={`c${m.index}`}>
        <Tooltip>
          <TooltipTrigger asChild>
            <ContextMenuTrigger asChild>
              <a
                href={sourceUrl ?? `#cite-${idx}`}
                className="rd-cite"
                data-cite={idx}
                data-masked={maskedIdx === idx || undefined}
                title={onProbe ? "Right-click to probe without this source" : undefined}
                onMouseEnter={() => onEnter(idx)}
                onMouseLeave={onLeave}
                onFocus={() => onEnter(idx)}
                onBlur={onLeave}
                onClick={(e) => {
                  e.preventDefault();
                  if (sourceUrl) {
                    window.open(sourceUrl, "_blank", "noopener,noreferrer");
                    return;
                  }
                  const target = document.querySelector(`.rd-evidence-row[data-cite="${idx}"]`);
                  target?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                }}
              >{idx}</a>
            </ContextMenuTrigger>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs bg-[var(--rd-ink)] text-[var(--rd-paper)]">
            <span className="block">&ldquo;{cite.quote}&rdquo;</span>
            <span className="mt-1 block opacity-70">{sourceLabel(cite.source)}</span>
          </TooltipContent>
        </Tooltip>
        <ContextMenuContent
          className="rd-cite-menu min-w-[260px] bg-[var(--rd-paper)] text-[var(--rd-ink)]"
          portalContainer={typeof document !== "undefined" ? document.querySelector<HTMLElement>("[data-redesign]") : null}
        >
          {onProbe ? (
            <ContextMenuItem className="rd-cite-menu__item" onSelect={() => onProbe(idx)}>
              <span aria-hidden="true">🔬</span>
              <span>Probe without source [{idx}]</span>
              <span className="rd-cite-menu__hint">re-eval the answer if this source were absent</span>
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem
            className="rd-cite-menu__item"
            onSelect={() => {
              const target = document.querySelector(`.rd-evidence-row[data-cite="${idx}"]`);
              target?.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }}
          >
            <span aria-hidden="true">↓</span>
            <span>Jump to evidence row</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<span key={`tail`}>{text.slice(last)}</span>);
  return out.length > 0 ? out : [text];
}

function FeedbackButton({ copyText }: { copyText: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { /* sandbox may block */ }
  };
  return (
    <button
      type="button"
      className="rd-fb-btn"
      onClick={copy}
      title="Copy"
      aria-label="Copy message"
    >{copied ? "✓" : "⎘"}</button>
  );
}

function FeedbackThumb({ kind, onRegenerate }: { kind: "up" | "down"; onRegenerate?: (tier?: "free" | "fast" | "deep") => void }) {
  const [active, setActive] = useState(false);
  return (
    <button
      type="button"
      className="rd-fb-btn"
      data-active={active || undefined}
      onClick={() => {
        setActive((v) => !v);
        if (kind === "down" && onRegenerate) onRegenerate();
      }}
      title={kind === "up" ? "Helpful" : "Not helpful"}
      aria-label={kind === "up" ? "Thumbs up" : "Thumbs down"}
      aria-pressed={active}
    >{kind === "up" ? "△" : "▽"}</button>
  );
}

function SystemEvent({ icon, text, time }: { icon: string; text: string; time?: string }) {
  return (
    <div className="rd-system-event">
      <div className="rd-system-event__line">
        <div className="rd-system-event__body">
          <span className="rd-system-event__icon">{icon}</span>
          <span>{text}</span>
          {time && <time>{time}</time>}
        </div>
      </div>
    </div>
  );
}
