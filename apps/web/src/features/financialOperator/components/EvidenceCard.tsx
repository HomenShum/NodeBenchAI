import { ExternalLink, Quote } from "lucide-react";
import type { EvidencePayload } from "../types";

interface Props {
  data: EvidencePayload;
}

export function EvidenceCard({ data }: Props) {
  return (
    <div className="space-y-2.5">
      <p className="text-[12px] text-content-muted">
        {data.totalSources} source{data.totalSources === 1 ? "" : "s"} cited
      </p>
      <ul className="space-y-2">
        {data.anchors.map((a, i) => (
          <li
            key={i}
            className="rounded border border-edge bg-surface/40 p-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-content">{a.label}</span>
              <span className="font-mono text-[11px] text-content-muted">
                {a.sourceRef}
              </span>
            </div>
            {a.excerpt && (
              <blockquote className="mt-2 flex items-start gap-2 border-l-2 border-edge pl-2 text-[13px] text-content-secondary">
                <Quote className="mt-0.5 h-3 w-3 flex-shrink-0 text-content-muted" aria-hidden="true" />
                <span>{a.excerpt}</span>
              </blockquote>
            )}
            {a.url && (
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-[var(--accent-primary)] hover:underline focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/50 focus-visible:outline-none"
              >
                Open source <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
