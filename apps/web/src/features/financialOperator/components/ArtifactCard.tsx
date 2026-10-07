import { FileText, FileSpreadsheet, GitPullRequest, ScrollText, Notebook } from "lucide-react";
import type { ArtifactPayload, ArtifactKind } from "../types";

interface Props {
  data: ArtifactPayload;
}

const KIND_ICON: Record<ArtifactKind, typeof FileText> = {
  notebook: Notebook,
  csv: FileSpreadsheet,
  pr_draft: GitPullRequest,
  memo: ScrollText,
  report: FileText,
};

const KIND_LABEL: Record<ArtifactKind, string> = {
  notebook: "Notebook",
  csv: "CSV export",
  pr_draft: "PR draft",
  memo: "Memo",
  report: "Report",
};

export function ArtifactCard({ data }: Props) {
  const Icon = KIND_ICON[data.kind] ?? FileText;
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" aria-hidden="true" />
        <div>
          <div className="text-sm font-medium text-content">{data.label}</div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-content-muted">
            {KIND_LABEL[data.kind]}
          </div>
        </div>
      </div>
      {data.description && (
        <p className="text-[13px] text-content-secondary">{data.description}</p>
      )}
      {data.diffSummary && data.diffSummary.length > 0 && (
        <ul className="space-y-1 text-[13px] text-content-secondary">
          {data.diffSummary.map((d, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-amber-300" aria-hidden="true" />
              <span>{d}</span>
            </li>
          ))}
        </ul>
      )}
      {data.url && (
        <a
          href={data.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 rounded border border-edge bg-surface/50 px-2.5 py-1 text-[12px] text-content hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/50 focus-visible:outline-none"
        >
          Open artifact
        </a>
      )}
    </div>
  );
}
