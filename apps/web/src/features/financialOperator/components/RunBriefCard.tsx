import type { RunBriefPayload } from "../types";

interface Props {
  data: RunBriefPayload;
}

export function RunBriefCard({ data }: Props) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-content">
        <span className="font-medium">Goal: </span>
        {data.goal}
      </p>
      <ol className="space-y-1.5">
        {data.numberedSteps.map((step, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-sm text-content-secondary"
          >
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-edge bg-surface/50 font-mono text-[10px] text-content-muted"
            >
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-content-muted">
        <span>Output: {data.outputFormat}</span>
        {data.estimatedDurationMs !== undefined && (
          <span>Estimated duration: ~{Math.round(data.estimatedDurationMs / 1000)}s</span>
        )}
      </div>
    </div>
  );
}
