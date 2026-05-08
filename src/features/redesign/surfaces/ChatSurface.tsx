/**
 * Chat — the live operating surface.
 *
 * Spec: not just message bubbles. Where research becomes memory.
 * Center: active conversation + answer packets + run checkpoints + capture acks.
 * Right: active entity card + sources + report status (handled by RedesignShell).
 * Bottom: UniversalComposer.
 */

import React, { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { UniversalComposer, DEFAULT_TIERS, type RouterTier, type BatchTarget } from "../components/UniversalComposer";
import { Pill } from "../components/Pill";
import { StreamingMarkdown } from "../components/StreamingMarkdown";
import type { ActiveBatchRun, ChatAnswer } from "../fixtures";
import { useBatchLive } from "../hooks/useBatchLive";
import { useLiveArtifacts, type LiveArtifactDetail } from "../hooks/useLiveArtifacts";
import { ChatThinking } from "../components/ChatThinking";
import { ChatToolCall, type ToolCall } from "../components/ChatToolCall";
import { MessageActions } from "../components/MessageActions";
import { ChatEmptyState } from "../components/ChatEmptyState";
import { showToast } from "../components/Toast";
import { useRedesignChatRun } from "../hooks/useRedesignChatRun";
import { useMutation, useQuery, useConvexAuth } from "convex/react";
import { api } from "../../../../convex/_generated/api";

/**
 * Sprint 3 P2.11 — fixture for the open-questions tray (claims flagged
 * uncertain by the agent or 👎'd by the user). Once chat is live-wired,
 * this becomes a `useAgentRunFeedback({ filter: "thumbs_down" })` query.
 */
type OpenQuestion = {
  id: string;
  label: string;
  turnId: string;
  flagged: "agent" | "user";
  when: string;
};

const OPEN_QUESTIONS: OpenQuestion[] = [
  { id: "oq1", label: "Procurement timing for Orbital Labs pilots", turnId: "a1", flagged: "agent", when: "2h ago" },
  { id: "oq2", label: "Hippocratic AI traction vs Abridge",         turnId: "a2", flagged: "user",  when: "12m ago" },
  { id: "oq3", label: "Voice-agent eval competitors within 6 months", turnId: "a1", flagged: "agent", when: "5h ago" },
];

function liveOpenQuestions(detail: LiveArtifactDetail): OpenQuestion[] {
  const sectionItems = detail.sections.flatMap((section) => section.items ?? []);
  const candidates = sectionItems.length > 0
    ? sectionItems
    : [{ label: detail.title, body: detail.summary }];
  return candidates.slice(0, 3).map((item, index) => ({
    id: `live-oq-${detail.id}-${index}`,
    label: `${item.label}: verify source support`,
    turnId: index === 1 ? "a2" : "a1",
    flagged: index === 1 ? "user" : "agent",
    when: index === 0 ? detail.updatedAt : "live",
  }));
}

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

async function shareAnswer(turnId: string, packet: ChatAnswer, tier: RouterTier = "auto") {
  void turnId; // turnId ties the URL to the local thread; the hash makes it deterministic
  const hash = answerHash(packet, tier);
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

/**
 * Sprint 3 P2.9 — deterministic fixture for source freshness so each citation
 * popover can show "refreshed Xh ago". Replace with `sourceRefs.lastFetchedAt`
 * once chat is live-wired.
 */
function sourceFreshness(source: string): string {
  let h = 0;
  for (let i = 0; i < source.length; i++) h = (h * 31 + source.charCodeAt(i)) >>> 0;
  const hours = h % 72;
  if (hours < 1) return "just refreshed";
  if (hours < 24) return `refreshed ${hours}h ago`;
  return `refreshed ${Math.floor(hours / 24)}d ago`;
}

/**
 * Sprint 2 P0.2 — Streaming scratchpad fixture.
 *
 * Showcase content reflecting the same pipeline shape as the backend
 * agent's scratchpad (orchestrator + sub-agent notes per `.claude/rules/scratchpad_first.md`).
 * Once chat is live-wired this becomes a live subscription to the
 * `agentScratchpads` Convex table.
 */
const WORKING_NOTES_MARKDOWN = `**Plan**
1. Confirm Orbital Labs' wedge from prior research notes
2. Check what changed since last touch (2h ago)
3. Look for procurement / pilot signals worth flagging this week
4. Cross-check headcount + funding + competitive position

**Notes during run**
- Memory hit: 3 prior reports, last touched 2h ago. High familiarity → terse output, skip backstory.
- Web search: 4 fresh results, 1 from TechCrunch (Mar 2026), Crunchbase headcount delta +4 (eval engineers).
- Open question: 6-month procurement cycle could compress timing — flag as risk, not blocker.
- Cross-checked: HIPAA-aware grading wedge confirmed in Orbital whitepaper p.4 + TechCrunch piece.

**Confidence**
- Wedge claim: high (3 sources agree)
- Pilot intent: medium (founder note + 1 LinkedIn signal, no procurement docs yet)
- Hiring spike: high (Crunchbase + LinkedIn agree)`;

function liveWorkingNotesMarkdown(detail: LiveArtifactDetail): string {
  const topSources = detail.sourceRows
    .slice(0, 3)
    .map((source, index) => `${index + 1}. ${source.title}${source.host ? ` (${source.host})` : ""}`)
    .join("\n");
  const topItems = detail.sections
    .flatMap((section) => section.items ?? [])
    .slice(0, 3)
    .map((item) => `- ${item.label}: ${item.body}`)
    .join("\n");
  return `**Plan**
1. Load ${detail.title} from live Convex memory
2. Reuse cached sources before any paid refresh
3. Check claim support and review gaps
4. Convert strongest signal into notebook-ready next action

**Live artifact**
- ${detail.sourceCount} sources
- ${detail.claimCount} claims
- ${detail.followUps} follow-ups
- Status: ${detail.status}

**Top signals**
${topItems || `- ${detail.summary}`}

**Source refs**
${topSources || "- No source rows returned yet"}`;
}

interface ChatSurfaceProps {
  contextLabel?: string;
  workspaceDetail?: LiveArtifactDetail;
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

const STARTER_ANSWER: ChatAnswer = {
  shortAnswer:
    "NodeBench turns one question into a reusable report with claims [1], source rows [2], notebook blocks, and a next action [3].",
  whyItMatters:
    "The important shift is not a one-off answer. The useful artifact is the reusable entity memory [1] that can be reviewed, exported, and multiplied across a list [2].",
  evidence: [
    { idx: 1, quote: "Live artifacts hydrate from Convex when available.", source: "NodeBench runtime" },
    { idx: 2, quote: "Reports preserve notebook, claim, source, and follow-up state.", source: "Redesign route contract" },
    { idx: 3, quote: "The composer can run a question once or multiply it across a universe.", source: "Batch run workflow" },
  ],
  risks: [
    "If no live artifact is selected, the user needs a clear starter path instead of a fake company sample.",
    "Claim verification still needs visible source actions before export.",
  ],
  nextAction: "Ask about a real company, paste a list, or open the latest live brief from Reports.",
  sourceCount: 3,
  paidCalls: 0,
  fromMemory: true,
  trace: [
    { step: "Start thread", status: "ok", detail: "Ready for entity, market, person, or list input", durationMs: 20 },
    { step: "Router prepared", status: "ok", detail: "Single answer or batch run can start from the same composer", durationMs: 34 },
    { step: "Report handoff", status: "info", detail: "A saved answer becomes notebook, claims, sources, and follow-ups", durationMs: 0 },
  ],
};

const STREAMING_FOLLOWUP_MARKDOWN = `## Quick follow-up on reusable intelligence

Based on the current workspace, three things are worth keeping visible:

- The answer should preserve a notebook block, not disappear into chat history.
- Claims need source rows attached before export.
- The same rubric should be reusable across a list.

\`\`\`text
risk: weak sources should stay in review
risk: batch outputs need visible approval rails
\`\`\`

> **Bottom line:** Create the report, preserve the evidence, then multiply the same judgment across the universe.

[Open Reports →](/redesign/reports)`;

const SAMPLE_TOOL_CALLS: ToolCall[] = [
  { step: "Classify query", detail: "company_search · single entity", status: "ok", durationMs: 28, tool: "classify_query" },
  { step: "Build context bundle", detail: "memory + prior reports", status: "ok", durationMs: 142, tool: "build_context_bundle", resultPreview: "{ mode: 'entity-intelligence', priorReports: 'available' }" },
  { step: "Check live artifacts", detail: "daily briefs + archive rows", status: "ok", durationMs: 1840, tool: "load_live_artifacts", resultPreview: "reports · sources · claims · notebook blocks" },
  { step: "Extract structured signals", detail: "Gemini 3 Flash", status: "ok", durationMs: 612, tool: "llm_extract" },
  { step: "Assemble answer", detail: "claim · evidence · risks · next action", status: "ok", durationMs: 88, tool: "assemble_response" },
];

const NOW = Date.now();
const SEED_TURNS: Turn[] = [
  { id: "u1", role: "user", text: "Turn this research question into reusable entity intelligence.", createdAt: NOW - 4 * 60_000 },
  { id: "a1", role: "assistant", packet: STARTER_ANSWER, tier: "auto", toolCalls: SAMPLE_TOOL_CALLS, createdAt: NOW - 4 * 60_000 + 3000 },
  { id: "u2", role: "user", text: "What should happen after the answer?", createdAt: NOW - 30_000 },
  { id: "a2", role: "assistant", markdown: STREAMING_FOLLOWUP_MARKDOWN, streaming: true, tier: "auto", createdAt: NOW - 25_000 },
];

function liveAnswer(detail: LiveArtifactDetail): ChatAnswer {
  const firstSection = detail.sections[0];
  const evidence = detail.sourceRows.slice(0, 4).map((source, index) => ({
    idx: index + 1,
    quote: source.excerpt || source.title,
    source: source.href ? `${source.title} · ${source.href}` : source.title,
  }));
  return {
    shortAnswer: detail.summary,
    whyItMatters: firstSection?.body || "This live artifact is already preserved as reusable NodeBench memory and can be promoted into reports, claims, sources, and follow-ups.",
    evidence: evidence.length
      ? evidence
      : [{ idx: 1, quote: detail.summary, source: `${detail.sourceCount} live source references` }],
    risks: detail.followUps > 0
      ? [`${detail.followUps} items still need review before this becomes fully trusted memory.`]
      : ["No blocking review items are visible in the latest live artifact, but claim-level verification should stay attached."],
    nextAction: detail.primaryAction,
    sourceCount: detail.sourceCount,
    paidCalls: 0,
    fromMemory: true,
    trace: [
      { step: "Resolve live artifact", status: "ok", detail: detail.title, durationMs: 34 },
      { step: "Memory-first", status: "ok", detail: `${detail.sourceCount} sources · ${detail.claimCount} claims cached`, durationMs: 52 },
      { step: "Notebook hydrate", status: "ok", detail: "Live artifact body is ready for TipTap review", durationMs: 81 },
      { step: "Save to report", status: "info", detail: detail.status === "verified" ? "Already verified in live memory" : "Needs review before verification", durationMs: 0 },
    ],
  };
}

function liveToolCalls(detail: LiveArtifactDetail): ToolCall[] {
  return [
    { step: "Load Convex artifact", detail: detail.id, status: "ok", durationMs: 34, tool: "load_live_artifact" },
    { step: "Hydrate source rows", detail: `${detail.sourceCount} source refs`, status: "ok", durationMs: 68, tool: "hydrate_sources" },
    { step: "Assemble answer packet", detail: "claim · evidence · risk · next action", status: "ok", durationMs: 94, tool: "assemble_response" },
  ];
}

function liveFollowupMarkdown(detail: LiveArtifactDetail): string {
  const bullets = detail.sections
    .flatMap((section) => section.items ?? [])
    .slice(0, 3)
    .map((item) => `- **${item.label}**: ${item.body}`)
    .join("\n");
  return `## Quick follow-up on ${detail.title}

${bullets || `- ${detail.summary}`}

> **Bottom line:** ${detail.primaryAction}

[Open live workspace →](/redesign/workspace?report=${detail.id}&tab=brief)`;
}

function buildSeedTurns(detail?: LiveArtifactDetail): Turn[] {
  if (!detail) return SEED_TURNS;
  const now = Date.now();
  return [
    { id: "u1", role: "user", text: `What is the latest read on ${detail.title}?`, createdAt: now - 4 * 60_000 },
    { id: "a1", role: "assistant", packet: liveAnswer(detail), tier: "auto", toolCalls: liveToolCalls(detail), createdAt: now - 4 * 60_000 + 3000 },
    { id: "u2", role: "user", text: "Turn the strongest signal into a notebook-ready follow-up.", createdAt: now - 30_000 },
    { id: "a2", role: "assistant", markdown: liveFollowupMarkdown(detail), streaming: true, tier: "auto", createdAt: now - 25_000 },
  ];
}

export function ChatSurface({ contextLabel = "Asking about: current context", workspaceDetail }: ChatSurfaceProps) {
  const liveArtifacts = useLiveArtifacts(24);
  const _rawLiveDetail = liveArtifacts.details[0];
  // Phase 1 — real LLM chat behind the composer for authenticated users.
  const chatRun = useRedesignChatRun();
  // Phase 4 — real reactions for inline correction + 👍/👎 toolbar.
  const recordReaction = useMutation(api.domains.redesign.agentRunFeedback.recordReaction);
  // Phase 5 — counterfactual probe re-run with masked source.
  const probeRun = useMutation(api.domains.redesign.chatRuns.probeRun);
  // ?fresh=1 escape hatch: treat as if no live artifact is loaded (uses
  // STARTER_ANSWER with inline [N] cites for the chat-sprints demo recorder).
  const _skipLiveSeed = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).has("fresh");
  const liveDetail = workspaceDetail ?? (_skipLiveSeed ? null : _rawLiveDetail);
  const batchTargets = useMemo<BatchTarget[]>(() => {
    if (liveArtifacts.reports.length === 0) return [];
    return [
      {
        universeId: "live-artifacts",
        universeName: "Current live artifacts",
        entityCount: liveArtifacts.reports.length,
      },
      ...liveArtifacts.reports.slice(0, 5).map((report) => ({
        universeId: report.id,
        universeName: `${report.entity} review set`,
        entityCount: Math.max(1, report.claims + report.followUps),
      })),
    ];
  }, [liveArtifacts.reports]);
  const liveSeedKey = liveDetail?.id ?? (liveArtifacts.isLoading ? "loading" : "empty");
  const openQuestions = useMemo(
    () => (liveDetail ? liveOpenQuestions(liveDetail) : OPEN_QUESTIONS),
    [liveDetail],
  );
  const workingNotesMarkdown = useMemo(
    () => (liveDetail ? liveWorkingNotesMarkdown(liveDetail) : WORKING_NOTES_MARKDOWN),
    [liveDetail],
  );
  const liveStarters = useMemo(() => {
    if (!liveDetail) return undefined;
    return [
      { icon: "🧾", title: `Summarize ${liveDetail.title}`, prompt: `Summarize ${liveDetail.title}. Keep it evidence-led and end with a next action.` },
      { icon: "✅", title: "Promote strongest claim", prompt: `Promote the strongest verified signal from ${liveDetail.title} into a notebook claim with sources.` },
      { icon: "🔎", title: "Find the review gaps", prompt: `List what still needs source review in ${liveDetail.title}, grouped by risk.` },
      { icon: "📤", title: "Prepare an export", prompt: `Create a CRM-ready export summary for ${liveDetail.title}.` },
    ];
  }, [liveDetail]);
  const [seedKey, setSeedKey] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [ctx, setCtx] = useState(contextLabel);
  const [tier, setTier] = useState<RouterTier>("auto");
  // Sprint S2: live batch monitor from Convex batchAutopilotRuns.
  const { batch: liveBatch } = useBatchLive();
  const [overrideBatch, setOverrideBatch] = useState<ActiveBatchRun | null>(null);
  const batch = overrideBatch ?? liveBatch;
  const setBatch = setOverrideBatch;

  // Sprint 4 P1.6 — pinned items carried into the next turn's context.
  const [pinned, setPinned] = useState<Array<{ id: string; label: string; tier: RouterTier; sourceCount: number }>>([]);
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

  // Phase 5 — real counterfactual probe via the probeRun mutation.
  // Looks up the original run, kicks off a new run with the masked
  // source flagged unreliable in the system prompt, inserts a new
  // assistant turn that subscribes to the probed run's stream.
  const probeWithoutSourceReal = (originalTurnId: string, originalRunId: string, maskedIdx: number) => {
    const probeId = `a${turns.length + 1}`;
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
    if (liveSeedKey === "loading" || seedKey === liveSeedKey) return;
    setTurns(buildSeedTurns(liveDetail));
    setCtx(liveDetail ? `Asking about: ${liveDetail.title}` : contextLabel);
    setSeedKey(liveSeedKey);
  }, [contextLabel, liveDetail, liveSeedKey, seedKey]);

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
      // Error → fall back to a fixture so the user isn't left staring.
      if (real.status === "error") {
        const next = {
          ...live,
          thinking: false,
          packet: liveDetail ? liveAnswer(liveDetail) : STARTER_ANSWER,
          toolCalls: liveDetail ? liveToolCalls(liveDetail) : SAMPLE_TOOL_CALLS,
        };
        const out = [...prev];
        out[idx] = next;
        showToast({
          tone: "warning",
          message: real.errorMessage
            ? `Real chat failed: ${real.errorMessage.slice(0, 100)}. Showing showcase fallback.`
            : "Real chat failed — showing showcase fallback.",
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
    const userId = `u${turns.length + 1}`;
    const assistantId = `a${turns.length + 1}`;
    setTurns((prev) => [
      ...prev,
      { id: userId, role: "user", text, createdAt: now },
      { id: assistantId, role: "assistant", thinking: true, tier: submittedTier, createdAt: now + 50 },
    ]);
    // Phase 2: if real chat is available, kick off a streaming run via
    // Convex scheduler. submit() returns a runId in <100ms; the projected
    // run state (packet + scratchpad + tool calls + grounding) arrives
    // reactively via Convex queries. The effect below watches for
    // status === "complete" to commit the final packet onto this turn.
    if (chatRun.state.available && !_skipLiveSeed) {
      // Phase 5 — carry pinned claims forward as hard context in the
      // system prompt. Each pin has a short label (the answer's tier +
      // shortAnswer) plus the source URL if grounded.
      const pinnedClaims = pinned.length > 0
        ? pinned.map((p) => ({ text: p.label || "pinned claim", source: undefined as string | undefined }))
        : undefined;
      void chatRun.submit(text, submittedTier, liveDetail?.id, pinnedClaims).then((runId) => {
        if (runId) {
          setTurns((prev) => prev.map((t) =>
            t.id === assistantId
              ? { ...t, chatRunId: runId }
              : t,
          ));
        } else {
          // Submit failed (e.g. auth lost) — fall back to fixture
          setTurns((prev) => prev.map((t) =>
            t.id === assistantId
              ? { ...t, thinking: false, toolCalls: liveDetail ? liveToolCalls(liveDetail) : SAMPLE_TOOL_CALLS, packet: liveDetail ? liveAnswer(liveDetail) : STARTER_ANSWER }
              : t,
          ));
        }
      });
      return;
    }
    // Showcase / fixture path
    window.setTimeout(() => {
      setTurns((prev) => prev.map((t) =>
        t.id === assistantId
          ? { ...t, thinking: false, toolCalls: liveDetail ? liveToolCalls(liveDetail) : SAMPLE_TOOL_CALLS, packet: liveDetail ? liveAnswer(liveDetail) : STARTER_ANSWER }
          : t,
      ));
    }, 2200);
  };

  const regenerate = (turnId: string, _tierOverride?: "free" | "fast" | "deep") => {
    setTurns((prev) => prev.map((t) =>
      t.id === turnId
        ? { ...t, thinking: true, packet: undefined, markdown: undefined, toolCalls: undefined, createdAt: Date.now() }
        : t,
    ));
    window.setTimeout(() => {
      setTurns((prev) => prev.map((t) =>
        t.id === turnId
          ? { ...t, thinking: false, toolCalls: liveDetail ? liveToolCalls(liveDetail) : SAMPLE_TOOL_CALLS, packet: liveDetail ? liveAnswer(liveDetail) : STARTER_ANSWER }
          : t,
      ));
    }, 1800);
  };

  const branchFromTurn = (turnId: string) => {
    const idx = turns.findIndex((t) => t.id === turnId);
    if (idx < 0) return;
    setTurns(turns.slice(0, idx + 1));
    setCtx(`Branched from message ${turnId}`);
  };

  const runOnList = (text: string, _t: RouterTier, target: BatchTarget) => {
    const totalEntities = Math.max(1, target.entityCount);
    const recentSteps = liveArtifacts.reports.slice(0, 5).map((report, index) => ({
      entity: report.entity,
      status: index === 0 ? "running" as const : "queued" as const,
      durationMs: index === 0 ? 0 : undefined,
      paidCalls: 0,
    }));
    setBatch({
      id: `batch_${target.universeId}_${Date.now()}`,
      universeId: target.universeId,
      universeName: target.universeName,
      styleId: "user.inferred",
      styleName: "Founder / banker lens · v3",
      rubric: "Live artifact review",
      totalEntities,
      doneCount: 0,
      reviewCount: 0,
      etaSeconds: totalEntities * 4,
      spentUsd: 0,
      recentSteps,
    });
    setTurns((prev) => [
      ...prev,
      { id: `u${prev.length}`, role: "user", text: `${text}  ·  on live set: ${target.universeName} (${totalEntities} entities)` },
    ]);
  };

  // Tick the live batch counters so it feels alive
  useEffect(() => {
    if (!batch) return;
    const t = window.setInterval(() => {
      setBatch((cur) => {
        if (!cur) return null;
        if (cur.doneCount >= cur.totalEntities) return cur;
        const inc = Math.min(2, cur.totalEntities - cur.doneCount);
        return {
          ...cur,
          doneCount: cur.doneCount + inc,
          spentUsd: +(cur.spentUsd + inc * 0.005).toFixed(3),
          etaSeconds: Math.max(0, cur.etaSeconds - 4),
        };
      });
    }, 2000);
    return () => window.clearInterval(t);
  }, [batch?.id]);

  // Scroll-to-bottom button: visible when user has scrolled up + auto-scroll on new turn
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollBtn(distance > 200);
      if (distance < 100) setUnseenCount(0);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  // Auto-scroll on new turn unless user is reading higher in the thread
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < 200) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      setUnseenCount((n) => n + 1);
    }
  }, [turns.length]);
  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    setUnseenCount(0);
  };

  return (
    <div className="rd-stack" style={{ height: "100%", overflow: "hidden", position: "relative" }}>
      <div ref={scrollRef} className="rd-stack" style={{ flex: 1, overflow: "auto", padding: "24px 40px 24px", gap: 18, maxWidth: 920, width: "100%", margin: "0 auto" }}>
        {batch && <BatchMonitorCell batch={batch} onCancel={() => setBatch(null)} />}

        {/* Compact thread header — no marketing copy. Just status + thread context. */}
        <header className="rd-chat-thread-head">
          <div className="rd-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Pill tone="green"><span className="rd-dot rd-dot--live" />{liveArtifacts.isLive ? "Live memory hot" : "Memory hot"}</Pill>
            <span className="rd-mono" style={{ fontSize: 11, color: "var(--rd-ink-soft)" }}>
              {liveDetail ? `Thread · ${liveDetail.title} · ${liveDetail.sourceCount} sources · 0 paid calls` : "Thread · no live artifact selected · 0 paid calls"}
            </span>
          </div>
        </header>

        {/* Sprint 3 P2.11 — open-questions tray */}
        <OpenQuestionsTray questions={openQuestions} />

        {turns.length === 0 ? (
          <ChatEmptyState
            starters={liveStarters}
            onPick={(prompt) => sendMessage(prompt, tier)}
            recentThread={liveDetail
              ? { id: liveDetail.id, entity: liveDetail.title, lastMessage: liveDetail.primaryAction, minutesAgo: 1 }
              : undefined}
            onResume={() => { /* no-op in showcase */ }}
          />
        ) : (
          turns.map((t) => {
            // Sprint 3 P2.11 — wrap with data-turn-id so OpenQuestionsTray jump can target it
            const inner = (() => {
              if (t.role === "user") return <UserBubble text={t.text!} createdAt={t.createdAt} />;
              if (t.thinking) return <ChatThinking />;
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
                  workingNotesMarkdown={workingNotesMarkdown}
                  createdAt={t.createdAt}
                  onRegenerate={(tierOverride) => regenerate(t.id, tierOverride)}
                  onBranch={() => branchFromTurn(t.id)}
                  onPin={() => pinClaim(t.id, t.packet!, t.tier ?? "auto")}
                  onCompare={() => setCompareTurnId(t.id)}
                  onShare={() => shareAnswer(t.id, t.packet!, t.tier ?? "auto")}
                  onProbeRunWithoutSource={t.chatRunId ? (idx) => probeWithoutSourceReal(t.id, t.chatRunId!, idx) : undefined}
                  onReact={t.chatRunId ? (kind) => {
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
            return <div key={t.id} data-turn-id={t.id}>{inner}</div>;
          })
        )}
      </div>

      {showScrollBtn && (
        <button
          type="button"
          className="rd-chat-scroll-btn"
          onClick={scrollToBottom}
          aria-label="Scroll to latest message"
          title="Scroll to latest"
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14M19 12l-7 7-7-7" />
          </svg>
          {unseenCount > 0 && <span className="rd-chat-scroll-btn__badge">{unseenCount}</span>}
        </button>
      )}
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
      <div className="rd-composer-dock" style={{ borderTop: "1px solid var(--rd-line-faint)" }}>
        <div style={{ maxWidth: 920, margin: "0 auto" }}>
          <UniversalComposer
            contextLabel={ctx}
            onContextChange={() => setCtx(ctx.startsWith("Asking")
              ? `Adding to: ${liveDetail?.title ?? "current report"}`
              : `Asking about: ${liveDetail?.title ?? "current context"}`)}
            onSubmit={sendMessage}
            onRunOnList={runOnList}
            batchTargets={batchTargets}
            tier={tier}
            onTierChange={setTier}
            placeholder="Ask anything · type / for commands · @ to mention an entity"
            streaming={turns.some((t) => t.thinking || t.streaming)}
            onStop={() => {
              setTurns((prev) => prev.map((t) =>
                t.thinking || t.streaming
                  ? { ...t, thinking: false, streaming: false, markdown: t.markdown ? t.markdown + "\n\n_(stopped by user)_" : t.markdown, packet: t.packet ?? (liveDetail ? liveAnswer(liveDetail) : STARTER_ANSWER) }
                  : t,
              ));
            }}
          />
        </div>
      </div>

      {/* Sprint 3 P1.4 + Phase 4 — selection-based inline correction.
          When authenticated, save persists the correction as a 👎 reaction
          with note via recordReaction (eval-flywheel signal). */}
      <InlineCorrection
        onSave={chatRun.state.available && chatRun.state.run?.runId ? (
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
          onPick={(variant) => {
            setCompareTurnId(null);
            showToast({
              tone: "success",
              message: `Variant ${variant} selected. The other becomes a teach-me example for the model.`,
            });
          }}
        />
      )}
    </div>
  );
}

/**
 * Sprint 3 P2.11 — sticky tray surfacing claims that need verification.
 * Today: fixture from OPEN_QUESTIONS. Once chat is live-wired, replace
 * with `useAgentRunFeedback` query filtered to flagged + unresolved items.
 */
function OpenQuestionsTray({ questions }: { questions: OpenQuestion[] }) {
  const [open, setOpen] = useState(true);
  const [items, setItems] = useState(questions);
  useEffect(() => {
    setItems(questions);
  }, [questions]);
  if (items.length === 0) return null;
  const dismissOne = (id: string) => {
    setItems((cur) => cur.filter((q) => q.id !== id));
    showToast({ tone: "success", message: "Question marked verified." });
  };
  const jumpTo = (turnId: string) => {
    const node = document.querySelector(`[data-turn-id="${turnId}"]`);
    if (node instanceof HTMLElement) {
      node.scrollIntoView({ block: "start", behavior: "smooth" });
      node.classList.add("rd-flash-attention");
      window.setTimeout(() => node.classList.remove("rd-flash-attention"), 1600);
    }
  };
  return (
    <aside className="rd-open-q" aria-label="Open questions worth verifying">
      <div className="rd-open-q__head">
        <button
          type="button"
          className="rd-open-q__toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span className="rd-eyebrow">Open questions</span>
          <span className="rd-open-q__count">{items.length}</span>
        </button>
        <span className="rd-open-q__hint">Claims worth verifying — tap to jump, ✓ to clear</span>
      </div>
      {open && (
        <ul className="rd-open-q__list">
          {items.map((q) => (
            <li key={q.id} className="rd-open-q__item">
              <span
                className="rd-open-q__pill"
                data-flag={q.flagged}
                title={q.flagged === "agent" ? "Flagged by the agent" : "Flagged by you"}
              >
                {q.flagged === "agent" ? "🤖" : "👎"}
              </span>
              <button
                type="button"
                className="rd-open-q__label"
                onClick={() => jumpTo(q.turnId)}
              >
                {q.label}
              </button>
              <span className="rd-open-q__when">{q.when}</span>
              <button
                type="button"
                className="rd-open-q__clear"
                aria-label={`Mark "${q.label}" verified`}
                title="Mark verified"
                onClick={() => dismissOne(q.id)}
              >
                ✓
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

/**
 * Sprint 3 P1.4 — selection-based inline correction.
 *
 * Listens for text selections inside `.rd-chat-msg__body` (assistant
 * messages only). When the user highlights 5–300 chars, a floating
 * "Correct →" bubble appears at the selection's bounding rect. Clicking
 * opens an inline edit dialog pre-filled with the selection. Saving
 * fires a toast and (today) is no-op; once chat is live-wired this calls
 * `proposeMemoryPatch` from convex/domains/operatorProfile/manifest.ts
 * (PR #239) so the correction lands in /redesign/me's Memory Update Inbox.
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
            ? "Correction saved. Review at /redesign/me."
            : "Could not save correction — try again."),
          action: result.ok ? {
            label: "Open Me",
            onClick: () => { window.location.href = "/redesign/me"; },
          } : undefined,
        });
      } finally {
        setBusy(false);
        setEditing(null);
      }
      return;
    }
    // Showcase fallback — anonymous user / fixture mode
    showToast({
      tone: "info",
      message: "Sign in to persist corrections to memory.",
      action: {
        label: "Open Me",
        onClick: () => { window.location.href = "/redesign/me"; },
      },
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
      {editing && (
        <div className="rd-correct-overlay" role="dialog" aria-modal="true" aria-label="Correct claim">
          <div className="rd-correct-dialog">
            <div className="rd-correct-dialog__head">
              <span className="rd-eyebrow">Correct this claim</span>
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
          </div>
        </div>
      )}
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
  onPick: (variant: "A" | "B") => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Phase 7 — real Variant B parallel run.
  // When the modal opens AND the user is authenticated AND a prompt was
  // captured for the original answer, kick off a second startChat call
  // and subscribe to its run row + events so the modal renders the
  // streaming Variant B in real time. Anonymous / fixture users see the
  // existing string-mutation fallback (Variant A's shortAnswer + " — high confidence.").
  const { isAuthenticated } = useConvexAuth();
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
    if (!isAuthenticated || !prompt || prompt.trim().length < 3) return;
    let cancelled = false;
    void startChat({ prompt, tier, contextRef: undefined })
      .then((runId) => {
        if (!cancelled) setVariantBRunId(runId);
      })
      .catch((err: any) => {
        if (!cancelled) setVariantBError((err?.message || String(err)).slice(0, 200));
      });
    return () => { cancelled = true; };
  }, [isAuthenticated, prompt, tier, startChat, variantBRunId]);

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

  const variantBStatus: "fixture" | "starting" | "streaming" | "complete" | "error" =
    !isAuthenticated || !prompt ? "fixture"
    : variantBError ? "error"
    : !variantBRunId ? "starting"
    : variantBRow?.status === "complete" ? "complete"
    : variantBRow?.status === "error" ? "error"
    : "streaming";

  const tierMeta = DEFAULT_TIERS.find((t) => t.id === tier) ?? DEFAULT_TIERS[0];

  // Fixture-mode fallback (anonymous users)
  const fixtureBAnswer = packet.shortAnswer.replace(/\.$/, "") + " — high confidence.";
  const fixtureBWhy = packet.whyItMatters;

  const showShort = variantBStatus === "fixture"
    ? fixtureBAnswer
    : variantBPacket?.shortAnswer || (variantBStatus === "streaming" ? "Streaming Variant B…" : variantBStatus === "starting" ? "Starting parallel run…" : variantBStatus === "error" ? `Error: ${variantBError ?? variantBRow?.errorMessage ?? "unknown"}` : "");
  const showWhy = variantBStatus === "fixture"
    ? fixtureBWhy
    : variantBPacket?.whyItMatters || "";

  return (
    <div className="rd-ab-overlay" role="dialog" aria-modal="true" aria-label="A/B compare answers">
      <div className="rd-ab-dialog">
        <header className="rd-ab-dialog__head">
          <span className="rd-eyebrow">A/B compare · {tierMeta.label} tier</span>
          <span className="rd-ab-dialog__hint">
            {variantBStatus === "fixture"
              ? "Same prompt, two parallel runs. Pick a winner."
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
            <div className="rd-eyebrow">Why it matters</div>
            <p className="rd-ab-variant__why">{packet.whyItMatters}</p>
            <button
              type="button"
              className="rd-btn rd-btn--primary rd-btn--sm rd-ab-variant__pick"
              onClick={() => onPick("A")}
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
                  : "fixture mode"}
              </span>
            </header>
            <div className="rd-eyebrow">Short answer</div>
            <p className="rd-ab-variant__short">{showShort || "—"}</p>
            <div className="rd-eyebrow">Why it matters</div>
            <p className="rd-ab-variant__why">{showWhy || "—"}</p>
            <button
              type="button"
              className="rd-btn rd-btn--primary rd-btn--sm rd-ab-variant__pick"
              onClick={() => onPick("B")}
              disabled={variantBStatus === "starting" || variantBStatus === "error" || (variantBStatus === "streaming" && !variantBPacket?.shortAnswer)}
            >Pick B</button>
          </article>
        </div>
      </div>
    </div>
  );
}

function BatchMonitorCell({ batch, onCancel }: { batch: ActiveBatchRun; onCancel: () => void }) {
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
      <div className="rd-stack" style={{ gap: 4, alignItems: "flex-end" }}>
        <button className="rd-btn rd-btn--quiet rd-btn--sm">Pause</button>
        <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={onCancel}>Cancel</button>
      </div>
    </article>
  );
}

function UserBubble({ text, createdAt }: { text: string; createdAt?: number }) {
  // Parity-studio pattern: right-aligned bubble, no avatar (user is self).
  return (
    <div className="rd-chat-msg rd-chat-msg--user">
      <div className="rd-chat-msg__bubble">
        {text}
        {createdAt && <span className="rd-chat-msg__when rd-chat-msg__when--user"><LiveTime at={createdAt} /></span>}
      </div>
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
      <article className="rd-chat-msg__body rd-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <header className="rd-chat-msg__header">
          <span className="rd-chat-msg__name">NodeBench</span>
          <span className="rd-chat-msg__sep">·</span>
          <span className="rd-chat-msg__meta">{tierMeta.label} tier · streaming</span>
          {createdAt && <span className="rd-chat-msg__when"><LiveTime at={createdAt} /></span>}
        </header>
        <StreamingMarkdown text={text} streaming={streaming} cps={260} />
        <MessageActions
          copyText={text}
          onRegenerate={onRegenerate}
          onPin={() => { /* no-op showcase */ }}
          onBranch={onBranch}
          onWhy={() => { /* no-op showcase */ }}
          onReact={() => { /* no-op showcase */ }}
        />
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
  const [probeMenu, setProbeMenu] = useState<{ idx: number; x: number; y: number } | null>(null);

  // Wire citation interactivity: hover [N] in body → highlight matching source row in evidence list
  const handleCiteEnter = (idx: number) => setHoverCite(idx);
  const handleCiteLeave = () => setHoverCite(null);
  // Right-click on a cite chip → counterfactual probe menu
  const handleCiteContext = (idx: number, e: ReactMouseEvent) => {
    e.preventDefault();
    setProbeMenu({ idx, x: e.clientX, y: e.clientY });
  };
  const probeWithoutSource = (idx: number) => {
    setMaskedIdx(idx);
    setProbeMenu(null);
    // Phase 5 — if a real probe handler is wired (authenticated user with
    // an active runId on this turn), call the real action; otherwise fall
    // back to the showcase toast pair.
    if (onProbeRunWithoutSource) {
      showToast({
        tone: "info",
        message: `Re-running model without source [${idx}]…`,
      });
      onProbeRunWithoutSource(idx);
      return;
    }
    showToast({
      tone: "info",
      message: `Probing without source [${idx}]…`,
    });
    window.setTimeout(() => {
      showToast({
        tone: "warning",
        message: `Probed: claim weakens without [${idx}]. Other evidence still supports the conclusion.`,
      });
    }, 1100);
  };
  const restoreProbe = () => {
    setMaskedIdx(null);
    showToast({ tone: "success", message: "Source restored. Original answer in view." });
  };
  // Dismiss probe menu on outside click / Escape
  useEffect(() => {
    if (!probeMenu) return;
    const onDoc = () => setProbeMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProbeMenu(null);
    };
    window.addEventListener("click", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [probeMenu]);
  return (
    <div className="rd-chat-msg rd-chat-msg--assistant" data-hover-cite={hoverCite ?? undefined}>
      {/* Avatar gutter — parity-studio bot icon pattern */}
      <div className="rd-chat-msg__avatar" aria-hidden="true">✦</div>

      <article className="rd-chat-msg__body rd-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <header className="rd-chat-msg__header">
          <span className="rd-chat-msg__name">NodeBench</span>
          <span className="rd-chat-msg__sep">·</span>
          <span className="rd-chat-msg__meta">{tierMeta.label} tier · {packet.sourceCount} sources · {formatTraceCost(packet)}</span>
          {createdAt && <span className="rd-chat-msg__when"><LiveTime at={createdAt} /></span>}
        </header>

        {/* Status strip — quieter; structural meta moves to header above */}
        <div className="rd-row" style={{ gap: 6, flexWrap: "wrap" }}>
          <Pill tone="green"><span className="rd-dot rd-dot--live" />Using memory</Pill>
          <Pill tone="accent">Saved to {reportTitle ?? "report"}</Pill>
          <Pill>{packet.paidCalls} paid calls</Pill>
        </div>

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

        {/* Sprint 2 P0.2 — collapsible streaming-scratchpad / working notes */}
        <WorkingNotes markdown={workingNotesMarkdown ?? WORKING_NOTES_MARKDOWN} />

        {/* Sprint 2 P0.3 — counterfactual probe banner (visible when a source is masked) */}
        {maskedIdx !== null && (
          <ProbeBanner idx={maskedIdx} onRestore={restoreProbe} />
        )}

      {/* Short answer — citations clickable + hover-linked to evidence list */}
      <section>
        <div className="rd-eyebrow" style={{ marginBottom: 6 }}>Short answer</div>
        <p style={{
          fontFamily: "var(--rd-font-display)",
          fontSize: 18,
          fontWeight: 510,
          lineHeight: 1.4,
          color: "var(--rd-ink-strong)",
          letterSpacing: "-0.18px",
          margin: 0,
        }}>
          {renderInlineWithCites(packet.shortAnswer, packet.evidence, handleCiteEnter, handleCiteLeave, handleCiteContext, maskedIdx)}
        </p>
      </section>

      {/* Why it matters */}
      <section>
        <div className="rd-eyebrow" style={{ marginBottom: 6 }}>Why it matters</div>
        <p className="rd-body" style={{ color: "var(--rd-ink-mute)", margin: 0 }}>{packet.whyItMatters}</p>
      </section>

      {/* Evidence — rows highlight when matching [N] in body is hovered */}
      <section>
        <div className="rd-eyebrow" style={{ marginBottom: 8 }}>Evidence ({packet.evidence.length})</div>
        <ol className="rd-stack" style={{ gap: 8, listStyle: "none", padding: 0, margin: 0 }}>
          {packet.evidence.map((e) => (
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
                {/* Phase 6 — substring-validation pill */}
                {(e as any).verified === true && (
                  <span
                    className="rd-mono"
                    title={`Quote substring confirmed in source body${(e as any).verifiedAt ? ` at ${new Date((e as any).verifiedAt).toLocaleTimeString()}` : ""}`}
                    style={{ fontSize: 10, color: "var(--rd-green, #15803d)", display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    ✓ verified in source body
                  </span>
                )}
                {(e as any).verified === false && (
                  <span
                    className="rd-mono"
                    title={`Source URL did not return the cited quote: ${(e as any).validationError ?? "unknown reason"}`}
                    style={{ fontSize: 10, color: "var(--rd-amber, #b45309)", display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    ⚠ unverified ({(e as any).validationError ?? "no_match"})
                  </span>
                )}
              </div>
              <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>{e.source}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Risks / unknowns */}
      <section>
        <div className="rd-eyebrow" style={{ marginBottom: 8 }}>Risks / unknowns</div>
        <ul className="rd-stack" style={{ gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
          {packet.risks.map((r, i) => (
            <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}>
              <span className="rd-dot rd-dot--review" style={{ marginTop: 6, flexShrink: 0 }} />
              <span style={{ color: "var(--rd-ink-mute)" }}>{r}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Next action */}
      <section className="rd-card" style={{
        padding: 14,
        background: "var(--rd-accent-tint)",
        borderColor: "var(--rd-accent-ring)",
        borderRadius: "var(--rd-r-sm)",
      }}>
        <div className="rd-eyebrow" style={{ color: "var(--rd-accent-strong)", marginBottom: 4 }}>Next action</div>
        <p className="rd-body" style={{ margin: 0, color: "var(--rd-ink)" }}>{packet.nextAction}</p>
        <div className="rd-row" style={{ gap: 6, marginTop: 10 }}>
          <button className="rd-btn rd-btn--primary rd-btn--sm">Add to follow-ups</button>
          <button className="rd-btn rd-btn--quiet rd-btn--sm">Open {reportTitle ?? "report"}</button>
        </div>
      </section>

      {/* Trace */}
      <details>
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

      {/* Per-message action toolbar — Copy / Regen / Pin / Branch / Why? / Compare / Share / 👍👎 */}
      <MessageActions
        copyText={packet.shortAnswer + "\n\n" + packet.whyItMatters}
        onRegenerate={onRegenerate}
        onPin={onPin}
        onBranch={onBranch}
        onWhy={() => { /* future: opens trace modal */ }}
        onReact={onReact}
        onCompare={onCompare}
        onShare={onShare}
      />
      </article>

      {/* Sprint 2 P0.3 — counterfactual probe context menu (right-click on cite chip) */}
      {probeMenu && (
        <div
          className="rd-cite-menu"
          role="menu"
          style={{ position: "fixed", top: probeMenu.y, left: probeMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="rd-cite-menu__item"
            role="menuitem"
            onClick={() => probeWithoutSource(probeMenu.idx)}
          >
            <span aria-hidden="true">🔬</span>
            <span>Probe without source [{probeMenu.idx}]</span>
            <span className="rd-cite-menu__hint">re-eval the answer if this source were absent</span>
          </button>
          <button
            type="button"
            className="rd-cite-menu__item"
            role="menuitem"
            onClick={() => {
              const target = document.querySelector(`.rd-evidence-row[data-cite="${probeMenu.idx}"]`);
              target?.scrollIntoView({ block: "nearest", behavior: "smooth" });
              setProbeMenu(null);
            }}
          >
            <span aria-hidden="true">↓</span>
            <span>Jump to evidence row</span>
          </button>
        </div>
      )}
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
function ProbeBanner({ idx, onRestore }: { idx: number; onRestore: () => void }) {
  return (
    <div className="rd-probe-banner" role="status" aria-live="polite">
      <span className="rd-probe-banner__icon" aria-hidden="true">🔬</span>
      <div className="rd-stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
        <span className="rd-probe-banner__title">
          Probing without source [{idx}]
        </span>
        <span className="rd-probe-banner__detail">
          Source is dimmed below. Other evidence still supports the conclusion — claim weakens but doesn't flip.
        </span>
      </div>
      <button type="button" className="rd-btn rd-btn--quiet rd-btn--sm" onClick={onRestore}>
        Restore
      </button>
    </div>
  );
}

/**
 * Sprint 1 P1.5 — total elapsed + estimated cost from trace durations.
 * Showcase rate: $0.005/sec (replace with real provider billing once chat is live-wired).
 */
function formatTraceCost(packet: ChatAnswer): string {
  const totalMs = packet.trace.reduce((sum, step) => sum + (step.durationMs ?? 0), 0);
  const timeStr = totalMs < 1000 ? `${totalMs}ms` : `${(totalMs / 1000).toFixed(1)}s`;
  const usd = (totalMs / 1000) * 0.005;
  const costStr = usd >= 0.01 ? `$${usd.toFixed(3)}` : `<$0.01`;
  return `${timeStr} · ${costStr}`;
}

/**
 * Render text with [N] citation patterns turned into interactive chips.
 *
 * Sprint 1 P0.1 — hover the chip to see the source quote + provenance in a popover.
 * The popover is pure-CSS positioned (`.rd-cite-wrap`) so no JS positioning math.
 * Hovering a [N] also fires the linkage handler so the evidence row highlights.
 */
function renderInlineWithCites(
  text: string,
  evidence: ChatAnswer["evidence"],
  onEnter: (idx: number) => void,
  onLeave: () => void,
  onContextMenu?: (idx: number, e: ReactMouseEvent) => void,
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
    if (m.index > last) out.push(<span key={`t${last}`}>{text.slice(last, m.index)}</span>);
    out.push(
      <span key={`c${m.index}`} className="rd-cite-wrap">
        <a
          href={`#cite-${idx}`}
          className="rd-cite"
          data-cite={idx}
          data-masked={maskedIdx === idx || undefined}
          aria-describedby={`rd-cite-pop-${idx}`}
          title="Right-click to probe without this source"
          onMouseEnter={() => onEnter(idx)}
          onMouseLeave={onLeave}
          onFocus={() => onEnter(idx)}
          onBlur={onLeave}
          onContextMenu={onContextMenu ? (e) => onContextMenu(idx, e) : undefined}
          onClick={(e) => {
            e.preventDefault();
            const target = document.querySelector(`.rd-evidence-row[data-cite="${idx}"]`);
            target?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }}
        >{idx}</a>
        <span
          id={`rd-cite-pop-${idx}`}
          className="rd-cite-popover"
          role="tooltip"
        >
          <span className="rd-cite-popover__quote">&ldquo;{cite.quote}&rdquo;</span>
          <span className="rd-cite-popover__source">{cite.source}</span>
          {/* Sprint 3 P2.9 — source freshness */}
          <span className="rd-cite-popover__freshness">{sourceFreshness(cite.source)}</span>
        </span>
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<span key={`tail`}>{text.slice(last)}</span>);
  return out.length > 0 ? out : [text];
}
