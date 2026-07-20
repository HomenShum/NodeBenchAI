/**
 * WorkspaceComposer — pinned chat composer for workspace mode.
 *
 * Built to follow the kit's canonical chat-composer shape (per
 * ui_kits/nodebench-web/ChatThread.jsx and ui_kits/nodebench-web/Composer.jsx
 * in the design packet):
 *
 *   ┌─ pins / context pills ─────────────────────────────────┐
 *   │ EVENT Ship Demo Day ×    + Add context                 │
 *   ├─ field ────────────────────────────────────────────────┤
 *   │ 📎  🔗  🎤  Ask, capture, paste, upload, or record…   ⏎│
 *   ├─ row ──────────────────────────────────────────────────┤
 *   │ MODEL claude-opus-4-7  [T][I][F][·][·][·][·][T]   ↗   │
 *   ├─ suggested ────────────────────────────────────────────┤
 *   │ Run AT&T 10-K · Run CRM cleanup · Covenant · Variance  │
 *   └────────────────────────────────────────────────────────┘
 *
 * The kit puts the model selector + capability indicators ON the composer,
 * not floating above. This component honors that.
 *
 * Functional behavior: typing + send tries to match the input against the
 * known demo workflows. If no match, it falls back to opening the existing
 * FastAgentPanel via a custom event (panel listeners can catch it). This
 * keeps the composer interactive without surgical edits to FastAgentPanel.
 */

import { useState, useRef, useEffect } from "react";
import { useAction } from "convex/react";
import { ArrowUp, FileText, Link as LinkIcon, Mic, X, Plus } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ModelCapabilityBadge } from "./ModelCapabilityBadge";
import { setActiveFinancialRun } from "./FinancialOperatorOverlay";

const ACTIVE_MODEL = "claude-opus-4-7";

type DemoId = "att" | "crm" | "covenant" | "variance";

interface DemoChip {
  id: DemoId;
  label: string;
  match: RegExp;
}

// Lightweight intent matcher — keep deterministic, never LLM-routed.
const DEMOS: DemoChip[] = [
  { id: "att",      label: "Run AT&T 10-K demo",   match: /\b(at\s*&?\s*t|att|10-?k|effective\s*tax|cost\s*of\s*debt|etr)\b/i },
  { id: "crm",      label: "Run CRM cleanup",      match: /\b(crm|prospect|dedupe|enrich|cleanup|cleanse)\b/i },
  { id: "covenant", label: "Run covenant compliance", match: /\b(covenant|leverage|credit\s*agreement|breach|debt)\b/i },
  { id: "variance", label: "Run variance analysis", match: /\b(variance|actual.*budget|cfo|monthly\s*close)\b/i },
];

interface Props {
  /** Current financial run, if any — surfaces context as a pin. */
  activeRunId?: Id<"financialOperatorRuns"> | null;
  /** Optional: notify the parent when a workflow starts. */
  onRunStarted?: (runId: Id<"financialOperatorRuns">) => void;
}

export function WorkspaceComposer({ activeRunId, onRunStarted }: Props) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pins, setPins] = useState<{ kind: string; label: string }[]>(
    activeRunId
      ? [{ kind: "RUN", label: "Active financial run" }]
      : [{ kind: "EVENT", label: "Ship Demo Day" }],
  );
  const taRef = useRef<HTMLTextAreaElement>(null);

  const runAtt = useAction(
    api.domains.financialOperator.orchestrator.runAttCostOfDebtDemo,
  );
  const runCrm = useAction(
    api.domains.financialOperator.orchestratorExamples.runCrmCleanupDemo,
  );
  const runCovenant = useAction(
    api.domains.financialOperator.orchestratorExamples.runCovenantComplianceDemo,
  );
  const runVariance = useAction(
    api.domains.financialOperator.orchestratorExamples.runVarianceAnalysisDemo,
  );

  // Autosize textarea up to 120px
  useEffect(() => {
    if (!taRef.current) return;
    taRef.current.style.height = "auto";
    taRef.current.style.height = Math.min(taRef.current.scrollHeight, 120) + "px";
  }, [value]);

  function classify(text: string): DemoId | null {
    for (const d of DEMOS) {
      if (d.match.test(text)) return d.id;
    }
    return null;
  }

  async function handleSend() {
    const text = value.trim();
    if (!text || pending) return;
    setError(null);
    const demoId = classify(text);
    if (demoId) {
      setPending(true);
      try {
        let result: { runId: Id<"financialOperatorRuns"> };
        switch (demoId) {
          case "att":      result = await runAtt({}); break;
          case "crm":      result = await runCrm({}); break;
          case "covenant": result = await runCovenant({}); break;
          case "variance": result = await runVariance({}); break;
        }
        setActiveFinancialRun(result.runId);
        onRunStarted?.(result.runId);
        setValue("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to start run");
      } finally {
        setPending(false);
      }
    } else {
      // No matching demo — surface a hint and dispatch an event so other
      // chat panels can pick it up if they're listening.
      setError(
        "I can route a workflow from your prompt. Try: AT&T 10-K · CRM cleanup · covenant compliance · variance analysis.",
      );
      window.dispatchEvent(
        new CustomEvent("nb:workspace:compose", { detail: { text } }),
      );
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function startDemo(id: DemoId) {
    setValue(DEMOS.find((d) => d.id === id)?.label ?? "");
    setTimeout(() => handleSend(), 0);
  }

  return (
    <div
      className="border-t border-[var(--border-color)] px-4 pt-3 pb-3 sm:px-6"
      style={{ backgroundColor: "var(--bg-primary)" }}
    >
      {/* Pins */}
      {pins.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {pins.map((p, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2.5 py-[3px] text-[11px] font-medium text-[var(--text-secondary)]"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                {p.kind}
              </span>
              {p.label}
              <button
                type="button"
                onClick={() => setPins((prev) => prev.filter((_, idx) => idx !== i))}
                className="ml-1 rounded-full p-0.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/40"
                aria-label={`Remove ${p.label}`}
              >
                <X size={10} strokeWidth={2} aria-hidden="true" />
              </button>
            </span>
          ))}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border-color)] bg-transparent px-2.5 py-[3px] text-[11px] font-medium text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/40"
            aria-label="Add context"
          >
            <Plus size={10} strokeWidth={2} aria-hidden="true" />
            Add context
          </button>
        </div>
      )}

      {/* Field row */}
      <div
        className="flex items-end gap-2 rounded-[12px] border border-[var(--border-color)] px-3 py-2"
        style={{ backgroundColor: "var(--bg-secondary)" }}
      >
        <div className="flex items-center gap-1 pb-1 text-[var(--text-muted)]">
          <button
            type="button"
            className="rounded p-1 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/40"
            title="Attach file"
            aria-label="Attach file"
          >
            <FileText size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="rounded p-1 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/40"
            title="Add URL"
            aria-label="Add URL"
          >
            <LinkIcon size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="rounded p-1 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/40"
            title="Voice note"
            aria-label="Voice note"
          >
            <Mic size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask, capture, paste, upload, or record…"
          rows={1}
          className="min-h-[40px] flex-1 resize-none border-0 bg-transparent text-[14px] leading-[1.5] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!value.trim() || pending}
          aria-label="Send"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40"
          style={{
            backgroundColor: "var(--accent-primary)",
          }}
        >
          <ArrowUp size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {/* Model + capabilities row + meta */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <ModelCapabilityBadge model={ACTIVE_MODEL} showUnsupported />
        <span
          className="font-mono text-[11px] text-[var(--text-tertiary)]"
          aria-label="Memory mode"
        >
          Memory-first · 0 paid calls
        </span>
      </div>

      {/* Suggested chips — kit pattern from Composer.jsx */}
      <div className="mt-2 flex flex-wrap gap-2">
        {DEMOS.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => startDemo(d.id)}
            disabled={pending}
            className="rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {d.label}
          </button>
        ))}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-2 text-[12px] text-[var(--text-muted)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
