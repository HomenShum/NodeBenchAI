/**
 * ChatToolCall — inline tool-call card (parity-studio ToolCallCard pattern).
 *
 * Each step of the agent's reasoning renders as its own card with icon + tool name +
 * args + result preview. Click expands the result. Replaces the old hidden trace
 * `<details>` for the headline trust surface.
 *
 * Reads:
 *   - parity-studio ChatPanel.tsx:578-624 (ToolCallCard reference)
 *   - server/routes/search.ts (NodeBench's actual trace step shape)
 */

import { useState, type ReactNode } from "react";

export interface ToolCall {
  step: string;
  detail?: string;
  status: "ok" | "warn" | "running" | "error";
  durationMs?: number;
  /** Optional — name of the tool the agent called (web_search, get_entity, etc.) */
  tool?: string;
  /** Optional — tiny preview of the tool result */
  resultPreview?: string;
}

interface ChatToolCallProps {
  call: ToolCall;
}

const STATUS_GLYPH: Record<ToolCall["status"], { icon: string; tone: string; label: string }> = {
  ok:      { icon: "✓", tone: "green",  label: "done" },
  running: { icon: "●", tone: "accent", label: "running" },
  warn:    { icon: "⚠", tone: "amber",  label: "warning" },
  error:   { icon: "✕", tone: "amber",  label: "error" },
};

export function ChatToolCall({ call }: ChatToolCallProps) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_GLYPH[call.status];
  const hasExpand = Boolean(call.resultPreview);

  return (
    <div className={`rd-toolcall rd-toolcall--${meta.tone}`} data-status={call.status}>
      <button
        type="button"
        className="rd-toolcall__head"
        onClick={() => hasExpand && setOpen((v) => !v)}
        aria-expanded={hasExpand ? open : undefined}
        aria-disabled={!hasExpand}
      >
        <span className={`rd-toolcall__icon rd-toolcall__icon--${meta.tone}`} aria-label={meta.label}>
          {call.status === "running" ? <Spinner /> : meta.icon}
        </span>
        <span className="rd-toolcall__step">
          {call.tool ? <ToolNamePill name={call.tool} /> : null}
          <strong>{call.step}</strong>
          {call.detail && <span className="rd-toolcall__detail"> · {call.detail}</span>}
        </span>
        {typeof call.durationMs === "number" && (
          <span className="rd-toolcall__duration">{formatMs(call.durationMs)}</span>
        )}
        {hasExpand && (
          <span className="rd-toolcall__chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
        )}
      </button>
      {open && call.resultPreview && (
        <div className="rd-toolcall__body">
          <pre className="rd-toolcall__result">{call.resultPreview}</pre>
        </div>
      )}
    </div>
  );
}

function ToolNamePill({ name }: { name: string }): ReactNode {
  return <span className="rd-toolcall__tool">{name}</span>;
}

function Spinner() {
  return (
    <svg className="rd-toolcall__spinner" width={12} height={12} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="40 20" strokeLinecap="round" />
    </svg>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
