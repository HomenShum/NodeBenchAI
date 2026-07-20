import { Sparkles } from "lucide-react";
import type { ResultPayload } from "../types";

interface Props {
  data: ResultPayload;
}

export function ResultCard({ data }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded border border-emerald-500/25 bg-emerald-500/5 p-3">
        <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-300" aria-hidden="true" />
        <p className="text-sm font-medium text-emerald-50">{data.headline}</p>
      </div>

      <p className="text-[13px] text-content-secondary">{data.prose}</p>

      {data.metrics && Object.keys(data.metrics).length > 0 && (
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Object.entries(data.metrics).map(([k, v]) => (
            <div
              key={k}
              className="rounded border border-edge bg-surface/40 px-2.5 py-1.5"
            >
              <dt className="text-[10px] uppercase tracking-[0.18em] text-content-muted">
                {k}
              </dt>
              <dd className="font-mono text-base text-content">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {data.openIssues && data.openIssues.length > 0 && (
        <div className="rounded border border-amber-500/25 bg-amber-500/5 p-2.5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-amber-200/90">
            Open issues
          </div>
          <ul className="mt-1 space-y-0.5">
            {data.openIssues.map((issue, i) => (
              <li
                key={i}
                className="text-[13px] text-amber-100/90 before:mr-1 before:content-['•']"
              >
                {issue}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {data.nextActions.map((a) => (
          <button
            key={a.id}
            type="button"
            className="rounded border border-edge bg-surface/50 px-2.5 py-1 text-[12px] text-content hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/50 focus-visible:outline-none"
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
