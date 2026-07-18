/**
 * ChatAssistantMessage — the ONE assistant-turn anatomy.
 *
 * Phase A of docs/design/ONE_CHAT_INTERFACE.md. Both the live ChatSurface and
 * the reproducible replay page (ReproducibleChatPage) render this component so
 * the two renderers structurally cannot drift. Prose leads; Reasoning / Tool /
 * Sources collapse into the message, closed by default.
 *
 * Anatomy (assistant turn):
 *   <Message from="assistant"><MessageContent>
 *     Row 1  — compact mono receipt line (tier · N sources · latency · cost)
 *     Row 2  — PROSE: shortAnswer + whyItMatters as one flowing body
 *              (renderInlineWithCites keeps the [N] hover↔evidence binding +
 *               probe handler; json/table keep the .rd-answer-structured block)
 *     Row 3  — risks as one quiet callout; nextAction as one sentence + buttons
 *     Row 4  — collapsed-by-default primitives, in order:
 *              <Reasoning> research stages (run-thread) + "how we got this
 *                          answer" trace + RuntimeBoard
 *              <Tool>      one per tool call (ChatToolCall re-housed, boundaried)
 *              <Sources>   evidence rows w/ verification badges + [N] binding
 *   </MessageContent><MessageActions> follow-ups / promote / export / share /
 *                                      probe </Message>
 *
 * The ai-elements primitives are restyled via [data-redesign]-scoped CSS in
 * agent-workspace.css so they carry the terracotta / Manrope DNA.
 */

import React, { useMemo, useState, useEffect, type ReactNode } from "react";
import {
  Message,
  MessageContent,
  MessageActions,
  MessageAction,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Reasoning, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Tool } from "@/components/ai-elements/tool";
import { Sources, SourcesTrigger, SourcesContent } from "@/components/ai-elements/sources";
import {
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ai-ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ai-ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ai-ui/context-menu";
import { DEFAULT_TIERS, type RouterTier } from "./UniversalComposer";
import { ChatToolCall, type ToolCall } from "./ChatToolCall";
import {
  LiveResearchChecklist,
  type ResearchStage,
  type ResearchStageId,
} from "../../research/LiveResearchChecklist";
import { isStructuredAnswer } from "../../../../shared/redesign/answerFormat";
import type { ChatAnswer } from "../hooks/useRedesignChatRun";
import { showToast } from "./Toast";

export type { ChatAnswer };

// ── Action-bar glyphs ─────────────────────────────────────────────────────────
// Stroke SVGs, not emoji: color-emoji glyphs ignore the [data-redesign] theme
// tokens and clash with every other icon on the surface (repo icon rule; the
// same fix the starter chips got). currentColor lets MessageAction theme them.
function ActionGlyph({
  kind,
}: {
  kind: "promote" | "compare" | "share" | "readAloud" | "delete";
}) {
  const paths: Record<typeof kind, ReactNode> = {
    // shield + check — "promote strongest claim"
    promote: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    // two opposed arrows — "A/B compare"
    compare: (
      <>
        <path d="M8 3 4 7l4 4" />
        <path d="M4 7h16" />
        <path d="m16 21 4-4-4-4" />
        <path d="M20 17H4" />
      </>
    ),
    // arrow to upper-right — "share reproducible link"
    share: (
      <>
        <path d="M7 17 17 7" />
        <path d="M8 7h9v9" />
      </>
    ),
    // speaker + sound wave — "read aloud" (ported from the legacy panel bubble)
    readAloud: (
      <>
        <path d="M11 5 6 9H2v6h4l5 4z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      </>
    ),
    // trash can — "delete message" (ported from the legacy panel bubble)
    delete: (
      <>
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="m19 6-1 14H6L5 6" />
        <path d="M10 11v5" />
        <path d="M14 11v5" />
      </>
    ),
  };
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind]}
    </svg>
  );
}

// ── Shared pure helpers ──────────────────────────────────────────────────────

export function sourceUrlFromText(source: string): string | null {
  const match = source.match(/https?:\/\/[^\s)>\]]+/i);
  if (!match) return null;
  return match[0].replace(/[.,;:]+$/, "");
}

export function sourceLabel(source: string): string {
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

export function isBlockingClaimCheck(check: {
  status?: string;
  verified?: boolean;
  blocking?: boolean;
  verificationState?: string;
}): boolean {
  return (
    check.blocking === true ||
    check.verificationState === "unsupported" ||
    check.status === "source_validation_failed"
  );
}

function compactRunId(runId?: string): string | undefined {
  if (!runId) return undefined;
  if (runId.length <= 16) return runId;
  return `${runId.slice(0, 6)}...${runId.slice(-6)}`;
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

export function buildResearchStages(trace: ResearchTraceLike[] = [], running = false): ResearchStage[] {
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

/**
 * Compact-response detector — named so guards can pin that compact shapes
 * (empty whyItMatters + risks + nextAction) never re-inflate memo furniture.
 * Row 3 and every collapsible below render only when their content is present,
 * so a compact answer collapses to receipt + prose naturally.
 */
export function computeIsCompactResponse(packet: ChatAnswer): boolean {
  return (
    !packet.whyItMatters.trim() &&
    packet.risks.length === 0 &&
    !packet.nextAction.trim()
  );
}

// ── Reusable subcomponents ───────────────────────────────────────────────────

/** Live-updating relative timestamp ("just now" → "1m ago" → "5m ago"). */
export function LiveTime({ at }: { at: number }) {
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

export function FeedbackButton({ copyText }: { copyText: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* sandbox may block */
    }
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

export function FeedbackThumb({
  kind,
  onRegenerate,
  onReact,
}: {
  kind: "up" | "down";
  onRegenerate?: (tier?: "free" | "fast" | "deep") => void;
  onReact?: (kind: "up" | "down") => void;
}) {
  const [active, setActive] = useState(false);
  return (
    <button
      type="button"
      className="rd-fb-btn"
      data-active={active || undefined}
      onClick={() => {
        setActive((v) => !v);
        onReact?.(kind);
        if (kind === "down" && onRegenerate) onRegenerate();
      }}
      title={kind === "up" ? "Helpful" : "Not helpful"}
      aria-label={kind === "up" ? "Thumbs up" : "Thumbs down"}
      aria-pressed={active}
    >{kind === "up" ? "△" : "▽"}</button>
  );
}

/**
 * Per-tool-card error boundary so a single ChatToolCall render failure (bad
 * tool name, malformed payload, etc.) doesn't crash the whole message. Renders
 * a quiet inline pill in the failed slot.
 */
export class ToolCallBoundary extends React.Component<
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

/**
 * Counterfactual probe banner shown when a source is masked. The full feature
 * re-runs the model with that source filtered out and diffs the answers; the
 * banner surfaces the affordance + an honest awaiting-result note.
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
          Re-running without this source. Awaiting a verified result from the active runtime.
        </span>
      </div>
      <button type="button" className="rd-btn rd-btn--quiet rd-btn--sm" onClick={onRestore}>
        Restore
      </button>
    </div>
  );
}

/** Collapsible "Working notes" preview of the agent's runtime scratchpad. */
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

function RuntimeMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="rd-runtime-metric">
      <span className="rd-runtime-metric__label">{label}</span>
      <span className="rd-runtime-metric__value">{value}</span>
    </span>
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

export function RuntimeBoard({ runtime }: { runtime?: ChatAnswer["runtime"] }) {
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

/**
 * Render text with [N] citation patterns turned into interactive chips.
 *
 * Hover uses the shared Radix tooltip and right-click uses the shared Radix
 * context menu, keeping positioning, dismissal, and keyboard focus
 * primitive-owned. Hovering a [N] fires the linkage handler so the evidence
 * row highlights; clicking reveals + scrolls to the evidence row (opening the
 * Sources collapsible via onReveal).
 */
export function renderInlineWithCites(
  text: string,
  evidence: ChatAnswer["evidence"],
  onEnter: (idx: number) => void,
  onLeave: () => void,
  onProbe?: (idx: number) => void,
  maskedIdx?: number | null,
  onReveal?: () => void,
): ReactNode[] {
  const jumpToRow = (idx: number) => {
    onReveal?.();
    window.setTimeout(() => {
      const target = document.querySelector(`.rd-evidence-row[data-cite="${idx}"]`);
      target?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 60);
  };
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
                  jumpToRow(idx);
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
            onSelect={() => jumpToRow(idx)}
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

const TOOL_STATUS_LABEL: Record<ToolCall["status"], string> = {
  ok: "done",
  running: "running",
  warn: "warning",
  error: "error",
};

// ── The one assistant-turn anatomy ───────────────────────────────────────────

export interface ChatAssistantMessageProps {
  packet: ChatAnswer;
  tier: RouterTier;
  /** Inline tool calls executed during the turn. */
  toolCalls?: ToolCall[];
  /** Live working-notes scratchpad text from the agent (runtime-derived). */
  workingNotesMarkdown?: string;
  /** Created-at timestamp for the live relative timestamp. */
  createdAt?: number;
  /** Attached report/context title (surfaces in badges + nextAction button). */
  reportTitle?: string;
  /** Receipt override — when provided, the receipt latency uses this value
   *  instead of deriving from packet.runtime.metrics (immutable receipt page). */
  receiptLatencyMs?: number | null;
  /** Receipt override — cost, same semantics as receiptLatencyMs. */
  receiptCostUsd?: number | null;
  /**
   * "receipt" suppresses the interactive actions toolbar (immutable replay).
   * "panel" is the FastAgentPanel adoption variant (Phase B of
   * ONE_CHAT_INTERFACE): identical to "live" except the Sources collapsible
   * renders even for compact packets — panel answers have no memo fields
   * (whyItMatters / risks / nextAction) but their sources are the core trust
   * surface, so hiding them there would drop honest data, not memo furniture.
   */
  variant?: "live" | "receipt" | "panel";
  /**
   * Optional override for the tier label on the receipt line. The panel never
   * routes through the flagship router tiers, so it passes the actual model /
   * runtime label here instead of claiming a tier it never used. Flagship
   * callers omit this and keep the DEFAULT_TIERS label.
   */
  receiptTierLabel?: string;
  /**
   * How the shortAnswer prose renders (Phase C of ONE_CHAT_INTERFACE).
   * "plain" (default — flagship/receipt callers unchanged) renders pre-wrap
   * text with interactive [N] cite chips. "markdown" renders through the
   * shared ai-elements streamdown renderer for markdown-rich adopted panel
   * turns. Markdown prose carries NO [N] cite interactivity: panel markdown
   * never had bound cites, and the adapter refuses bare-[N] turns outright.
   */
  proseFormat?: "plain" | "markdown";
  onRegenerate?: (tierOverride?: "free" | "fast" | "deep") => void;
  onPin?: () => void;
  onAddFollowUp?: () => void;
  onOpenReport?: () => void;
  onCompare?: () => void;
  onShare?: () => void;
  /** When set, 👍/👎 persist via recordReaction. */
  onReact?: (kind: "up" | "down") => void;
  /** When set, a delete action renders in the toolbar (panel port). */
  onDelete?: () => void;
  /** When set, a read-aloud action renders in the toolbar (panel port). */
  onReadAloud?: () => void;
  /** When set, "Probe without [N]" re-runs the model with that source masked. */
  onProbeRunWithoutSource?: (maskedSourceIdx: number) => void;
}

export function ChatAssistantMessage({
  packet,
  tier,
  toolCalls,
  workingNotesMarkdown,
  createdAt,
  reportTitle,
  receiptLatencyMs,
  receiptCostUsd,
  variant = "live",
  receiptTierLabel,
  proseFormat = "plain",
  onRegenerate,
  onPin,
  onAddFollowUp,
  onOpenReport,
  onCompare,
  onShare,
  onReact,
  onDelete,
  onReadAloud,
  onProbeRunWithoutSource,
}: ChatAssistantMessageProps) {
  const tierMeta = DEFAULT_TIERS.find((t) => t.id === tier) ?? DEFAULT_TIERS[0];
  const [hoverCite, setHoverCite] = useState<number | null>(null);
  const [maskedIdx, setMaskedIdx] = useState<number | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const researchStages = buildResearchStages(toolCalls ?? packet.trace);
  // Honest step count for the Reasoning trigger (Phase C "0 steps" fix): the
  // count must reflect what the section actually renders. The trace list
  // inside the section renders packet.trace rows, so trace-backed turns keep
  // that count (buildResearchStages template-matches and can ground FEWER
  // stages than trace rows — pure stages-length would change flagship
  // output). Trace-less turns fall back to the checklist stage count. Zero
  // renders no count at all — never "0 steps".
  const reasoningStepCount =
    packet.trace.length > 0 ? packet.trace.length : researchStages.length;
  // The "panel" variant never suppresses Sources: panel packets are always
  // compact-shaped (no memo fields) yet their evidence rows are the core
  // trust surface, not memo furniture.
  const isCompactResponse = computeIsCompactResponse(packet) && variant !== "panel";

  const handleCiteEnter = (idx: number) => setHoverCite(idx);
  const handleCiteLeave = () => setHoverCite(null);
  const revealSources = () => setSourcesOpen(true);

  const probeWithoutSource = (idx: number) => {
    if (onProbeRunWithoutSource) {
      setMaskedIdx(idx);
      showToast({ tone: "info", message: `Re-running model without source [${idx}]…` });
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

  // Receipt line — tier · N sources · latency · cost. Immutable receipt page
  // passes explicit latency/cost overrides; live turns derive from runtime.
  const telemetry =
    receiptLatencyMs !== undefined || receiptCostUsd !== undefined
      ? `${formatMs(receiptLatencyMs ?? null)} · ${formatUsd(receiptCostUsd ?? undefined)}`
      : formatTraceTelemetry(packet);
  const receiptLine = `${receiptTierLabel ?? tierMeta.label} · ${packet.sourceCount} source${packet.sourceCount === 1 ? "" : "s"} · ${telemetry}`;

  const hasReasoning =
    researchStages.length > 0 ||
    packet.trace.length > 0 ||
    Boolean(workingNotesMarkdown) ||
    Boolean(packet.runtime);

  const showActions =
    variant !== "receipt" &&
    Boolean(
      onReact ||
        onRegenerate ||
        onPin ||
        onCompare ||
        onShare ||
        onDelete ||
        onReadAloud,
    );

  return (
    <Message
      from="assistant"
      className="rd-chat-msg rd-chat-msg--assistant rd-chat-assistant"
      data-hover-cite={hoverCite ?? undefined}
    >
      <MessageContent className="rd-chat-msg__body rd-answer-arrive rd-chat-assistant__content">
        {/* Row 1 — receipt line */}
        <div className="rd-answer-receipt">
          <span className="rd-mono rd-answer-receipt__line">{receiptLine}</span>
          {createdAt && (
            <span className="rd-mono rd-answer-receipt__when"><LiveTime at={createdAt} /></span>
          )}
        </div>
        {(reportTitle ||
          typeof packet.runtime?.metrics?.memoryHitRate === "number" ||
          typeof packet.paidCalls === "number") && (
          <div className="rd-tool-badges rd-answer-badges">
            {reportTitle && <span className="rd-tool-badge">{reportTitle}</span>}
            {typeof packet.runtime?.metrics?.memoryHitRate === "number" && (
              <span className="rd-tool-badge">{Math.round(packet.runtime.metrics.memoryHitRate * 100)}% memory hit</span>
            )}
            {typeof packet.paidCalls === "number" && (
              <span className="rd-tool-badge">{packet.paidCalls} external refresh{packet.paidCalls === 1 ? "" : "es"}</span>
            )}
          </div>
        )}

        {/* Row 2 — PROSE leads. shortAnswer + whyItMatters as one flowing body.
            json/table shapes keep the .rd-answer-structured mono block. */}
        <div className="rd-answer-prose">
          {proseFormat === "markdown" ? (
            /* Markdown-rich adopted turns (Phase C) render through the shared
               ai-elements streamdown renderer (MessageResponse lazy-loads
               streamdown-renderer.tsx with a plain-text Suspense fallback).
               Checked BEFORE isStructuredAnswer: a markdown table would trip
               the plain-packet pipe-table heuristic and re-inflate the raw
               mono block. No [N] cite interactivity here by design. */
            <div className="rd-answer-copy rd-answer-copy--markdown">
              <MessageResponse>{packet.shortAnswer}</MessageResponse>
            </div>
          ) : isStructuredAnswer(packet.shortAnswer) ? (
            <pre className="rd-answer-structured">{packet.shortAnswer}</pre>
          ) : (
            <TooltipProvider delayDuration={180}>
              <p className="rd-answer-copy">
                {renderInlineWithCites(
                  packet.shortAnswer,
                  packet.evidence,
                  handleCiteEnter,
                  handleCiteLeave,
                  onProbeRunWithoutSource ? probeWithoutSource : undefined,
                  maskedIdx,
                  revealSources,
                )}
              </p>
            </TooltipProvider>
          )}
          {packet.whyItMatters.trim() && (
            <p className="rd-answer-copy rd-answer-copy--secondary">{packet.whyItMatters}</p>
          )}
        </div>

        {/* Counterfactual probe banner (visible when a source is masked) */}
        {maskedIdx !== null && <ProbeBanner idx={maskedIdx} onRestore={restoreProbe} />}

        {/* Row 3 — risks as a quiet callout; nextAction as one sentence + buttons. */}
        {packet.risks.length > 0 && (
          <div className="rd-answer-risks" role="note" aria-label="Risks and unknowns">
            <span className="rd-answer-risks__label rd-eyebrow">Risks &amp; unknowns</span>
            <ul className="rd-stack rd-answer-risks__list">
              {packet.risks.map((r, i) => (
                <li key={i} className="rd-answer-risks__item">
                  <span className="rd-dot rd-dot--review" aria-hidden="true" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {packet.nextAction.trim() && (
          <div className="rd-answer-next">
            <p className="rd-answer-next__text">
              <span className="rd-answer-next__label rd-eyebrow">Next</span>{" "}
              {packet.nextAction}
            </p>
            {(onAddFollowUp || onOpenReport || onShare) && (
              <div className="rd-action-chips">
                {onAddFollowUp && (
                  <button type="button" className="rd-action-chip rd-action-chip--primary" onClick={onAddFollowUp}>Add to follow-ups</button>
                )}
                {onOpenReport && (
                  <button type="button" className="rd-action-chip" onClick={onOpenReport}>Open {reportTitle ?? "report"}</button>
                )}
                {onShare && (
                  <button type="button" className="rd-action-chip" onClick={onShare}>Export memo</button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Row 4 — collapsed-by-default primitives, in order. */}
        {hasReasoning && (
          <Reasoning defaultOpen={false} className="rd-answer-disclosure rd-answer-reasoning">
            <ReasoningTrigger className="rd-answer-disclose">
              <span className="rd-eyebrow rd-answer-disclose__label">Reasoning</span>
              {reasoningStepCount > 0 && (
                <span className="rd-mono rd-answer-disclose__meta">
                  {reasoningStepCount} step{reasoningStepCount === 1 ? "" : "s"}
                </span>
              )}
            </ReasoningTrigger>
            <CollapsibleContent className="rd-answer-disclosure__body rd-stack" style={{ gap: 10 }}>
              {researchStages.length > 0 && (
                <LiveResearchChecklist compact title="Research run" stages={researchStages} />
              )}
              <RuntimeBoard runtime={packet.runtime} />
              {workingNotesMarkdown && <WorkingNotes markdown={workingNotesMarkdown} />}
              {packet.trace.length > 0 && (
                <div className="rd-answer-trace">
                  <div className="rd-eyebrow rd-answer-trace__label">How we got this answer</div>
                  <ol className="rd-stack rd-answer-trace__list">
                    {packet.trace.map((step, i) => (
                      <li key={i} className="rd-row rd-answer-trace__row">
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
                </div>
              )}
            </CollapsibleContent>
          </Reasoning>
        )}

        {toolCalls && toolCalls.length > 0 && (
          <div className="rd-answer-tools">
            {toolCalls.map((call, i) => (
              <Tool key={i} defaultOpen={false} className="rd-answer-disclosure rd-answer-tool">
                <CollapsibleTrigger className="rd-answer-disclose">
                  <span className="rd-eyebrow rd-answer-disclose__label">
                    Tool{call.tool ? ` · ${call.tool}` : ""}
                  </span>
                  <span className="rd-mono rd-answer-disclose__meta">
                    {call.step}
                    {typeof call.durationMs === "number" ? ` · ${formatMs(call.durationMs)}` : ""} · {TOOL_STATUS_LABEL[call.status]}
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent className="rd-answer-disclosure__body">
                  <ToolCallBoundary>
                    <ChatToolCall call={call} />
                  </ToolCallBoundary>
                </CollapsibleContent>
              </Tool>
            ))}
          </div>
        )}

        {!isCompactResponse && packet.evidence.length > 0 && (
          <Sources
            open={sourcesOpen}
            onOpenChange={setSourcesOpen}
            className="rd-answer-disclosure rd-answer-sources"
          >
            <SourcesTrigger count={packet.evidence.length} className="rd-answer-disclose">
              <span className="rd-eyebrow rd-answer-disclose__label">Sources</span>
              <span className="rd-mono rd-answer-disclose__meta">
                {packet.evidence.length} evidence row{packet.evidence.length === 1 ? "" : "s"}
              </span>
            </SourcesTrigger>
            <SourcesContent className="rd-answer-disclosure__body">
              <ol className="rd-evidence-list">
                {packet.evidence.map((e) => {
                  const trustBadge = sourceTrustBadge(e);
                  return (
                    <li
                      key={e.idx}
                      className="rd-evidence-row rd-card rd-card__pad-tight"
                      data-cite={e.idx}
                      data-active={hoverCite === e.idx || undefined}
                      data-masked={maskedIdx === e.idx || undefined}
                      onMouseEnter={() => handleCiteEnter(e.idx)}
                      onMouseLeave={handleCiteLeave}
                    >
                      <span className="rd-cite rd-cite--block" data-cite={e.idx}>[{e.idx}]</span>
                      {/* Panel evidence rows can honestly carry no quote —
                          gate on content so the empty paragraph doesn't shove
                          the source label across a void (polish pass). */}
                      <div className="rd-evidence-row__main">
                        {e.quote?.trim() && (
                          <p className="rd-body rd-evidence-row__quote">{e.quote}</p>
                        )}
                        {trustBadge && (
                          <span
                            className="rd-mono rd-evidence-row__badge"
                            title={trustBadge.title}
                            style={{ color: trustBadge.color }}
                          >
                            {e.verified === true ? "ok" : e.blocking ? "blocked" : "warn"} - {trustBadge.label}
                          </span>
                        )}
                      </div>
                      {sourceUrlFromText(e.source) ? (
                        <a
                          className="rd-mono rd-evidence-row__link"
                          href={sourceUrlFromText(e.source) ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {sourceLabel(e.source)}
                        </a>
                      ) : (
                        <span className="rd-mono rd-evidence-row__src">{e.source}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </SourcesContent>
          </Sources>
        )}
      </MessageContent>

      {showActions && (
        <MessageActions className="rd-answer-actions" role="toolbar" aria-label="Answer actions">
          <FeedbackButton copyText={`${packet.shortAnswer}\n\n${packet.whyItMatters}`.trim()} />
          <FeedbackThumb kind="up" onReact={onReact} />
          <FeedbackThumb kind="down" onReact={onReact} onRegenerate={onRegenerate} />
          {onReadAloud && (
            <MessageAction tooltip="Read aloud" label="Read message aloud" className="rd-answer-action" onClick={onReadAloud}>
              <ActionGlyph kind="readAloud" />
            </MessageAction>
          )}
          {onPin && (
            <MessageAction tooltip="Promote strongest claim" label="Promote claim" className="rd-answer-action" onClick={onPin}>
              <ActionGlyph kind="promote" />
            </MessageAction>
          )}
          {onCompare && (
            <MessageAction tooltip="A/B compare this answer" label="A/B compare" className="rd-answer-action" onClick={onCompare}>
              <ActionGlyph kind="compare" />
            </MessageAction>
          )}
          {onShare && (
            <MessageAction tooltip="Copy reproducible share link" label="Share reproducible link" className="rd-answer-action" onClick={onShare}>
              <ActionGlyph kind="share" />
            </MessageAction>
          )}
          {onDelete && (
            <MessageAction tooltip="Delete message" label="Delete message" className="rd-answer-action" onClick={onDelete}>
              <ActionGlyph kind="delete" />
            </MessageAction>
          )}
        </MessageActions>
      )}
    </Message>
  );
}

export default ChatAssistantMessage;
