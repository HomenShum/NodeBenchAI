import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import type { ToolCallPayload } from "../types";

interface Props {
  data: ToolCallPayload;
}

/**
 * Generic tool invocation card.
 * Shows toolName + 1-line input/output summaries.
 * Raw args/result are tucked behind an "Inspect" toggle (progressive disclosure).
 */
export function ToolCallCard({ data }: Props) {
  const [open, setOpen] = useState(false);
  const hasRaw = data.rawArgs !== undefined || data.rawResult !== undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <Wrench className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-content-muted" aria-hidden="true" />
        <div className="font-mono text-[12px] text-content">{data.toolName}</div>
      </div>
      <dl className="space-y-1 text-[13px]">
        <div className="flex flex-wrap gap-1.5">
          <dt className="min-w-[64px] text-content-muted">Input:</dt>
          <dd className="text-content-secondary">{data.inputSummary}</dd>
        </div>
        {data.outputSummary && (
          <div className="flex flex-wrap gap-1.5">
            <dt className="min-w-[64px] text-content-muted">Output:</dt>
            <dd className="text-content-secondary">{data.outputSummary}</dd>
          </div>
        )}
      </dl>
      {hasRaw && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded border border-edge bg-surface/50 px-2 py-0.5 text-[11px] text-content-muted hover:bg-surface-hover hover:text-content focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/50 focus-visible:outline-none"
            aria-expanded={open}
            aria-controls={`tool-raw-${data.toolName}`}
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {open ? "Hide raw I/O" : "Inspect raw I/O"}
          </button>
          {open && (
            <pre
              id={`tool-raw-${data.toolName}`}
              className="mt-2 max-h-64 overflow-auto rounded border border-edge bg-black/30 p-2 font-mono text-[11px] leading-relaxed text-content-secondary"
            >
{JSON.stringify({ args: data.rawArgs ?? null, result: data.rawResult ?? null }, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
