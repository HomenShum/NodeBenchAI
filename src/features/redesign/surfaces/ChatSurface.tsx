/**
 * Chat — the live operating surface.
 *
 * Spec: not just message bubbles. Where research becomes memory.
 * Center: active conversation + answer packets + run checkpoints + capture acks.
 * Right: active entity card + sources + report status (handled by RedesignShell).
 * Bottom: UniversalComposer.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { UniversalComposer, DEFAULT_TIERS, type RouterTier, type BatchTarget } from "../components/UniversalComposer";
import { Pill } from "../components/Pill";
import { StreamingMarkdown } from "../components/StreamingMarkdown";
import { sampleAnswer, universes, activeBatchRun, type ActiveBatchRun } from "../fixtures";
import { useBatchLive } from "../hooks/useBatchLive";
import { ChatThinking } from "../components/ChatThinking";
import { ChatToolCall, type ToolCall } from "../components/ChatToolCall";
import { MessageActions } from "../components/MessageActions";
import { ChatEmptyState } from "../components/ChatEmptyState";

const BATCH_TARGETS: BatchTarget[] = universes.map((u) => ({
  universeId: u.id,
  universeName: u.name,
  entityCount: u.entityCount,
}));

interface ChatSurfaceProps {
  contextLabel?: string;
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
  packet?: typeof sampleAnswer;
  tier?: RouterTier;
}

const STREAMING_FOLLOWUP_MARKDOWN = `## Quick follow-up on Orbital Labs

Based on **today's** check, three updates worth flagging:

- Headcount went from **14 → 18** in the last week (4 new ML eval engineers per LinkedIn).
- TechCrunch ran a piece on Mar 2026 confirming the *HIPAA-aware grading* wedge.
- Two regional hospital pilots are in active discussion — one is in the procurement queue.

\`\`\`text
risk: 6-month procurement cycle at regional hospitals
risk: 2 competitors within 6 months on the same wedge
\`\`\`

> **Bottom line:** Take the call this week. The hiring spike + healthcare pilot intent + verified \`HIPAA-aware grading\` wedge make this a structurally defensible bet.

[Open Orbital Labs report →](#)`;

const SAMPLE_TOOL_CALLS: ToolCall[] = [
  { step: "Classify query", detail: "company_search · single entity", status: "ok", durationMs: 28, tool: "classify_query" },
  { step: "Build context bundle", detail: "memory + 3 prior reports", status: "ok", durationMs: 142, tool: "build_context_bundle", resultPreview: "{ entity: 'Orbital Labs', priorReports: 3, lastTouched: '2h ago' }" },
  { step: "Web search", detail: "voice-agent eval HIPAA", status: "ok", durationMs: 1840, tool: "web_search", resultPreview: "4 results · TechCrunch · Crunchbase · Orbital whitepaper · LinkedIn" },
  { step: "Extract structured signals", detail: "Gemini 3 Flash", status: "ok", durationMs: 612, tool: "llm_extract" },
  { step: "Assemble answer", detail: "claim · evidence · risks · next action", status: "ok", durationMs: 88, tool: "assemble_response" },
];

const NOW = Date.now();
const SEED_TURNS: Turn[] = [
  { id: "u1", role: "user", text: "What's the Orbital Labs angle? Is it worth a follow-up call this week?", createdAt: NOW - 4 * 60_000 },
  { id: "a1", role: "assistant", packet: sampleAnswer, tier: "auto", toolCalls: SAMPLE_TOOL_CALLS, createdAt: NOW - 4 * 60_000 + 3000 },
  { id: "u2", role: "user", text: "Anything new since last week? Quick markdown summary please.", createdAt: NOW - 30_000 },
  { id: "a2", role: "assistant", markdown: STREAMING_FOLLOWUP_MARKDOWN, streaming: true, tier: "auto", createdAt: NOW - 25_000 },
];

export function ChatSurface({ contextLabel = "Asking about: Orbital Labs" }: ChatSurfaceProps) {
  const [turns, setTurns] = useState<Turn[]>(SEED_TURNS);
  const [ctx, setCtx] = useState(contextLabel);
  const [tier, setTier] = useState<RouterTier>("auto");
  // Sprint S2: live batch monitor — falls back to the fixture run when unauthenticated
  const { batch: liveBatch } = useBatchLive();
  const [overrideBatch, setOverrideBatch] = useState<ActiveBatchRun | null>(null);
  const batch = overrideBatch ?? liveBatch;
  const setBatch = setOverrideBatch;

  const sendMessage = (text: string, submittedTier: RouterTier) => {
    const now = Date.now();
    const userId = `u${turns.length + 1}`;
    const assistantId = `a${turns.length + 1}`;
    setTurns((prev) => [
      ...prev,
      { id: userId, role: "user", text, createdAt: now },
      { id: assistantId, role: "assistant", thinking: true, tier: submittedTier, createdAt: now + 50 },
    ]);
    // Simulate the tool-call sequence streaming in over ~2.5s, then snap to the final packet
    window.setTimeout(() => {
      setTurns((prev) => prev.map((t) =>
        t.id === assistantId
          ? { ...t, thinking: false, toolCalls: SAMPLE_TOOL_CALLS, packet: sampleAnswer }
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
          ? { ...t, thinking: false, toolCalls: SAMPLE_TOOL_CALLS, packet: sampleAnswer }
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
    // Spin up a fake batch run for the chosen universe
    setBatch({
      ...activeBatchRun,
      id: `batch_${target.universeId}_${Date.now()}`,
      universeId: target.universeId,
      universeName: target.universeName,
      totalEntities: target.entityCount,
      doneCount: 0,
      reviewCount: 0,
      etaSeconds: target.entityCount * 4,
      spentUsd: 0,
      recentSteps: [],
    });
    setTurns((prev) => [
      ...prev,
      { id: `u${prev.length}`, role: "user", text: `${text}  ·  on universe: ${target.universeName} (${target.entityCount} entities)` },
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
            <Pill tone="green"><span className="rd-dot rd-dot--live" />Memory hot</Pill>
            <span className="rd-mono" style={{ fontSize: 11, color: "var(--rd-ink-soft)" }}>
              Thread #2,841 · Orbital Labs · 0 paid calls
            </span>
          </div>
        </header>

        {turns.length === 0 ? (
          <ChatEmptyState
            onPick={(prompt) => sendMessage(prompt, tier)}
            recentThread={{ id: "2841", entity: "Orbital Labs", lastMessage: "Send Alex a 5-line note proposing a 30-min pilot-criteria call this week.", minutesAgo: 27 }}
            onResume={() => { /* no-op in showcase */ }}
          />
        ) : (
          turns.map((t) => {
            if (t.role === "user") return <UserBubble key={t.id} text={t.text!} createdAt={t.createdAt} />;
            if (t.thinking) return <ChatThinking key={t.id} />;
            if (t.markdown) return (
              <StreamingAnswer
                key={t.id}
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
                key={t.id}
                packet={t.packet!}
                tier={t.tier ?? "auto"}
                toolCalls={t.toolCalls}
                createdAt={t.createdAt}
                onRegenerate={(tierOverride) => regenerate(t.id, tierOverride)}
                onBranch={() => branchFromTurn(t.id)}
              />
            );
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
      <div className="rd-composer-dock" style={{ borderTop: "1px solid var(--rd-line-faint)" }}>
        <div style={{ maxWidth: 920, margin: "0 auto" }}>
          <UniversalComposer
            contextLabel={ctx}
            onContextChange={() => setCtx(ctx.startsWith("Asking") ? "Adding to: Orbital Labs report" : "Asking about: Orbital Labs")}
            onSubmit={sendMessage}
            onRunOnList={runOnList}
            batchTargets={BATCH_TARGETS}
            tier={tier}
            onTierChange={setTier}
            placeholder="Ask anything · type / for commands · @ to mention an entity"
            streaming={turns.some((t) => t.thinking || t.streaming)}
            onStop={() => {
              setTurns((prev) => prev.map((t) =>
                t.thinking || t.streaming
                  ? { ...t, thinking: false, streaming: false, markdown: t.markdown ? t.markdown + "\n\n_(stopped by user)_" : t.markdown, packet: t.packet ?? sampleAnswer }
                  : t,
              ));
            }}
          />
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
  createdAt,
  onRegenerate,
  onBranch,
}: {
  packet: typeof sampleAnswer;
  tier: RouterTier;
  toolCalls?: ToolCall[];
  createdAt?: number;
  onRegenerate?: (tierOverride?: "free" | "fast" | "deep") => void;
  onBranch?: () => void;
}) {
  const tierMeta = DEFAULT_TIERS.find((t) => t.id === tier) ?? DEFAULT_TIERS[0];
  const [hoverCite, setHoverCite] = useState<number | null>(null);

  // Wire citation interactivity: hover [N] in body → highlight matching source row in evidence list
  const handleCiteEnter = (idx: number) => setHoverCite(idx);
  const handleCiteLeave = () => setHoverCite(null);
  return (
    <div className="rd-chat-msg rd-chat-msg--assistant" data-hover-cite={hoverCite ?? undefined}>
      {/* Avatar gutter — parity-studio bot icon pattern */}
      <div className="rd-chat-msg__avatar" aria-hidden="true">✦</div>

      <article className="rd-chat-msg__body rd-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <header className="rd-chat-msg__header">
          <span className="rd-chat-msg__name">NodeBench</span>
          <span className="rd-chat-msg__sep">·</span>
          <span className="rd-chat-msg__meta">{tierMeta.label} tier · {packet.sourceCount} sources</span>
          {createdAt && <span className="rd-chat-msg__when"><LiveTime at={createdAt} /></span>}
        </header>

        {/* Status strip — quieter; structural meta moves to header above */}
        <div className="rd-row" style={{ gap: 6, flexWrap: "wrap" }}>
          <Pill tone="green"><span className="rd-dot rd-dot--live" />Using memory</Pill>
          <Pill tone="accent">Saved to Orbital Labs report</Pill>
          <Pill>{packet.paidCalls} paid calls</Pill>
        </div>

        {/* Inline tool-call cards (parity-studio pattern) — render the agent's actual reasoning */}
        {toolCalls && toolCalls.length > 0 && (
          <div className="rd-toolcall-list">
            {toolCalls.map((c, i) => <ChatToolCall key={i} call={c} />)}
          </div>
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
          {renderInlineWithCites(packet.shortAnswer, packet.evidence.length, handleCiteEnter, handleCiteLeave)}
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
              <p className="rd-body" style={{ margin: 0, fontSize: 13 }}>{e.quote}</p>
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
          <button className="rd-btn rd-btn--quiet rd-btn--sm">Open Orbital Labs</button>
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

      {/* Per-message action toolbar — Copy / Regen / Pin / Branch / Why? / 👍👎 */}
      <MessageActions
        copyText={packet.shortAnswer + "\n\n" + packet.whyItMatters}
        onRegenerate={onRegenerate}
        onPin={() => { /* future: useMutation(documentPatches.proposePatch) */ }}
        onBranch={onBranch}
        onWhy={() => { /* future: opens trace modal */ }}
        onReact={() => { /* future: agentRunFeedback */ }}
      />
      </article>
    </div>
  );
}

/**
 * Render text with [N] citation patterns turned into interactive chips.
 * Hovering a [N] in body fires the linkage handler so the evidence row highlights.
 */
function renderInlineWithCites(
  text: string,
  maxIdx: number,
  onEnter: (idx: number) => void,
  onLeave: () => void,
): ReactNode[] {
  const re = /\[(\d+)\]/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const idx = Number(m[1]);
    if (idx < 1 || idx > maxIdx) continue;
    if (m.index > last) out.push(<span key={`t${last}`}>{text.slice(last, m.index)}</span>);
    out.push(
      <a
        key={`c${m.index}`}
        href={`#cite-${idx}`}
        className="rd-cite"
        data-cite={idx}
        onMouseEnter={() => onEnter(idx)}
        onMouseLeave={onLeave}
        onClick={(e) => {
          e.preventDefault();
          const target = document.querySelector(`.rd-evidence-row[data-cite="${idx}"]`);
          target?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }}
      >{idx}</a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<span key={`tail`}>{text.slice(last)}</span>);
  return out.length > 0 ? out : [text];
}
