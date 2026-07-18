/**
 * canonicalAnswer — Phase B of docs/design/ONE_CHAT_INTERFACE.md.
 *
 * FastAgentPanel adopts the canonical `ChatAssistantMessage` (the ONE
 * assistant-turn anatomy shipped in Phase A) for its OVERLAPPING turn types:
 * a COMPLETED assistant answer made of prose + plain tool calls + URL sources.
 * This module decides which panel turns overlap (`describeCanonicalAnswerFit`)
 * and maps the panel's AI-SDK part vocabulary onto the flagship answer packet
 * (`buildCanonicalAnswerProps`).
 *
 * HONESTY RULE (non-negotiable): the mapping never fabricates packet fields
 * the panel runtime did not produce.
 *   - No verification states / trust badges — panel sources carry url+title
 *     only, so evidence rows render with an empty quote and NO badge.
 *   - No trace steps — packet.trace stays empty ("How we got this answer"
 *     never shows synthetic steps); tool parts map to the `toolCalls` prop.
 *   - No fabricated durations or costs — the receipt line falls back to the
 *     component's honest "telemetry not recorded".
 *   - No router-tier claim — `receiptTierLabel` carries the actual model name
 *     (or "agent run") instead of a flagship tier the panel never routed.
 *
 * Turns that CANNOT be mapped without fabrication or rendering regression
 * stay on the legacy bubble anatomy (expand–contract: Phase C retires it).
 */

import type { UIMessage } from "@convex-dev/agent/react";
import type { ChatAnswer } from "@/features/redesign/hooks/useRedesignChatRun";
import type { ToolCall } from "@/features/redesign/components/ChatToolCall";
import type {
  ConvexUIParts,
  NormalizedToolPart,
  SourcePart,
} from "./convexToUIParts";

// ── Routing predicates (mirrors of the bubble's private route table) ─────────
// FastAgentPanel.UIMessageBubble keeps these private and imports THIS module,
// so re-importing them from the bubble would create a cycle. They are small
// string predicates; the contract tests pin that both sides agree.

function getNormalizedToolName(part: NormalizedToolPart): string {
  return part.type === "dynamic-tool"
    ? part.toolName
    : part.type.replace(/^tool-/, "");
}

function isFusionSearchToolName(toolName: string): boolean {
  return (
    toolName === "fusionSearch" ||
    toolName === "quickSearch" ||
    (toolName.includes("fusion") && toolName.includes("Search"))
  );
}

function isMemoryPlanningToolName(toolName: string): boolean {
  return ["createPlan", "updatePlanStep", "writeMemory", "logEpisodic"].some(
    (name) => toolName.includes(name),
  );
}

// ── Eligibility ──────────────────────────────────────────────────────────────

/**
 * Prose the flagship component can render faithfully is plain text with no
 * block-level Markdown, no panel token systems, and no gallery markers. The
 * flagship prose row renders plain text with [N] cite chips — Markdown would
 * render literally (a regression, not a crash), and panel citation tokens
 * ({{cite:...}}) belong to the panel's own hover system. Each pattern here is
 * a named reason so tests and the Phase C ledger can see WHY a turn stayed on
 * the legacy anatomy.
 */
const BLOCKED_TEXT_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/```/, "code fence"],
  [/^\s{0,3}#{1,6}\s/m, "markdown heading"],
  [/^\s*\|.*\|\s*$/m, "markdown table"],
  [/^\s*(?:[-*+]|\d+[.)])\s+/m, "markdown list"],
  [/\]\(/, "markdown link or image"],
  [/<think>/, "inline think tag"],
  [/\{\{(?:cite|entity|arbitrage|fact):/, "panel citation/entity token"],
  [/<!--\s*[A-Z_]+_DATA/, "gallery/selection marker"],
  // A bare [3] in panel prose is a model-authored reference with no evidence
  // binding. Mapping sources to idx 1..n would FABRICATE a citation binding
  // the runtime never made, so such turns are not adopted.
  [/\[\d+\]/, "unbound numeric citation"],
];

export interface CanonicalAnswerFit {
  adoptable: boolean;
  /** Human-readable reasons the turn stayed on the legacy anatomy. */
  reasons: string[];
}

const COMPLETED_STATUSES = new Set(["success", "complete"]);

/**
 * A panel turn overlaps the flagship answer anatomy when it is a completed
 * assistant answer whose parts are only: prose text, reasoning, URL/document
 * sources, and plain tool calls. Everything else — streaming, agent
 * hierarchy, fused search, goal cards, memory pills, convex transparency,
 * media galleries, document actions, arbitrage reports, files, domain data
 * parts — is genuinely FastAgentPanel-specific and stays on the legacy path.
 */
export function describeCanonicalAnswerFit(
  uiParts: ConvexUIParts,
  message: UIMessage,
): CanonicalAnswerFit {
  const reasons: string[] = [];

  if (uiParts.from !== "assistant") reasons.push("not an assistant turn");
  if (uiParts.isStreaming) reasons.push("streaming turn (live progress is panel-specific)");
  const status = String(message.status ?? "");
  if (!uiParts.isStreaming && !COMPLETED_STATUSES.has(status)) {
    reasons.push(`non-completed status "${status}"`);
  }
  if (!uiParts.text.trim()) reasons.push("no prose answer");
  if (uiParts.fileParts.length > 0) reasons.push("file attachment part");
  if (uiParts.domainParts.all.length > 0) {
    reasons.push("domain/data part (panel-specific renderer)");
  }

  for (const [pattern, label] of BLOCKED_TEXT_PATTERNS) {
    if (pattern.test(uiParts.text)) {
      reasons.push(`prose contains ${label}`);
    }
  }

  for (const entry of uiParts.renderParts) {
    if (entry.kind === "domain" || entry.kind === "domain-tool") {
      reasons.push(`${entry.kind} render part (panel-specific renderer)`);
      continue;
    }
    if (entry.kind !== "tool") continue;
    const toolName = getNormalizedToolName(entry.part);
    if (toolName.startsWith("delegateTo")) {
      reasons.push("agent delegation (goal-card hierarchy is panel-specific)");
    } else if (toolName.startsWith("convex_")) {
      reasons.push("convex transparency tool (panel-specific renderer)");
    } else if (isFusionSearchToolName(toolName)) {
      reasons.push("fusion search tool (panel-specific renderer)");
    } else if (isMemoryPlanningToolName(toolName)) {
      reasons.push("memory/planning tool (panel-specific memory pill)");
    }
  }

  return { adoptable: reasons.length === 0, reasons: [...new Set(reasons)] };
}

// ── Mapping ──────────────────────────────────────────────────────────────────

export interface CanonicalAnswerProps {
  packet: ChatAnswer;
  toolCalls: ToolCall[];
  /** Panel reasoning text, re-housed in the Reasoning collapsible. */
  workingNotesMarkdown?: string;
  createdAt?: number;
  /** Honest receipt label: the actual model, never a fabricated router tier. */
  receiptTierLabel: string;
}

function toolCallStatus(part: NormalizedToolPart): ToolCall["status"] {
  if (part.state === "output-available") return "ok";
  if (part.state === "output-error") return "error";
  return "running";
}

function toolResultPreview(part: NormalizedToolPart): string | undefined {
  if (part.state !== "output-available" || part.output === undefined) {
    return undefined;
  }
  const text =
    typeof part.output === "string"
      ? part.output
      : JSON.stringify(part.output, null, 2);
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 600 ? `${trimmed.slice(0, 600)}…` : trimmed;
}

function sourceToEvidenceRow(
  entry: SourcePart,
  idx: number,
): ChatAnswer["evidence"][number] {
  const label =
    entry.type === "source-url"
      ? [entry.title, entry.url].filter(Boolean).join(" ") || entry.url
      : entry.title ?? entry.filename ?? "Document source";
  return {
    idx,
    // The panel runtime captures no quote for its sources; an empty quote is
    // honest, a synthesized one is not. NO verification fields are set, so
    // the evidence row renders without a trust badge.
    quote: "",
    source: label,
  };
}

export function buildCanonicalAnswerProps(
  uiParts: ConvexUIParts,
  message: UIMessage,
): CanonicalAnswerProps {
  const evidence = uiParts.sources.map((source, index) =>
    sourceToEvidenceRow(source, index + 1),
  );

  const toolCalls: ToolCall[] = uiParts.renderParts.flatMap((entry) => {
    if (entry.kind !== "tool") return [];
    const part = entry.part;
    const toolName = getNormalizedToolName(part);
    const call: ToolCall = {
      step: toolName,
      status: toolCallStatus(part),
      tool: toolName,
      // durationMs deliberately absent — the panel does not record per-tool
      // latency, and the component renders honestly without it.
    };
    if (part.state === "output-error" && part.errorText) {
      call.detail = String(part.errorText).slice(0, 200);
    }
    const preview = toolResultPreview(part);
    if (preview) call.resultPreview = preview;
    return [call];
  });

  const model =
    typeof (message as { model?: unknown }).model === "string"
      ? ((message as { model?: string }).model as string)
      : undefined;

  const createdAt =
    typeof message._creationTime === "number" &&
    Number.isFinite(message._creationTime)
      ? message._creationTime
      : undefined;

  const packet: ChatAnswer = {
    shortAnswer: uiParts.text.trim(),
    // The panel has no structured memo fields. Empty is honest — the
    // component's compact detector collapses the missing rows naturally.
    whyItMatters: "",
    risks: [],
    nextAction: "",
    evidence,
    sourceCount: evidence.length,
    // No fabricated trace: the "How we got this answer" list stays absent.
    trace: [],
  };

  const reasoning = uiParts.reasoning.trim();

  return {
    packet,
    toolCalls,
    ...(reasoning ? { workingNotesMarkdown: reasoning } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    receiptTierLabel: model ?? "agent run",
  };
}
