import { Calculator, Lock } from "lucide-react";
import type { CalculationPayload } from "../types";

interface Props {
  data: CalculationPayload;
}

/**
 * Calculation card.
 *
 * IMPORTANT: this card MUST display the disclosure that math ran in a
 * deterministic sandbox, not in the language model. That distinction is
 * the whole reason this surface exists — agents that can't be trusted
 * with a calculator should not pretend to do one.
 */
export function CalculationCard({ data }: Props) {
  const sandboxLabel =
    data.sandboxKind === "js_pure" ? "JS sandbox (pure)" : data.sandboxKind;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[12px] text-content-muted">
        <Calculator className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{data.formulaLabel}</span>
      </div>
      <pre className="rounded border border-edge bg-black/30 p-2 font-mono text-[11px] leading-relaxed text-content-secondary whitespace-pre-wrap">
{data.formulaText}
      </pre>

      {Object.keys(data.inputs).length > 0 && (
        <KVList label="Inputs" entries={data.inputs} />
      )}

      <KVList
        label="Outputs"
        entries={data.outputs}
        formatted={data.formattedOutputs}
        emphasised
      />

      <p
        className="flex items-start gap-2 rounded border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-1.5 text-[12px] text-emerald-100/90"
        role="note"
      >
        <Lock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-300" aria-hidden="true" />
        <span>
          Math executed in <span className="font-mono">{sandboxLabel}</span>, not by the language model. Re-running with the same inputs produces the same output.
        </span>
      </p>
    </div>
  );
}

function KVList({
  label,
  entries,
  formatted,
  emphasised,
}: {
  label: string;
  entries: Record<string, number | string>;
  formatted?: Record<string, string>;
  emphasised?: boolean;
}) {
  const items = Object.entries(entries);
  if (items.length === 0) return null;
  return (
    <dl
      className={`grid grid-cols-1 gap-1.5 sm:grid-cols-2 ${emphasised ? "" : "text-[12px]"}`}
    >
      {items.map(([k, v]) => {
        const display = formatted?.[k] ?? (typeof v === "number" ? v.toLocaleString() : String(v));
        return (
          <div
            key={k}
            className={`flex items-baseline justify-between gap-2 rounded border border-edge px-2.5 py-1.5 ${emphasised ? "bg-[var(--accent-primary)]/10" : "bg-surface/40"}`}
          >
            <dt className="font-mono text-[11px] text-content-muted">{k}</dt>
            <dd
              className={`font-mono ${emphasised ? "text-base text-[#f0c2a8]" : "text-content"}`}
            >
              {display}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
