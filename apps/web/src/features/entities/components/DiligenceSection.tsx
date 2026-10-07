/**
 * DiligenceSection renders one diligence block's output on a company entity
 * page. Each block supplies its own candidate renderer while this shell keeps
 * evidence status, collapse behavior, and empty-state handling consistent.
 */

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { EvidenceChip, type EvidenceTier } from "./EvidenceChip";

export type DiligenceSectionProps<TCandidate> = {
  block: string;
  title: string;
  description?: string;
  overallTier: EvidenceTier;
  candidates: TCandidate[];
  sourceCount?: number;
  updatedLabel?: string;
  renderer: (candidate: TCandidate, index: number) => ReactNode;
  actions?: ReactNode;
  emptyLabel?: string;
  defaultCollapsed?: boolean;
  className?: string;
};

export function DiligenceSection<TCandidate>({
  block,
  title,
  description,
  overallTier,
  candidates,
  sourceCount,
  updatedLabel,
  renderer,
  actions,
  emptyLabel = "Unable to identify - try uploading a deck or bio.",
  defaultCollapsed = false,
  className,
}: DiligenceSectionProps<TCandidate>) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const headerId = `diligence-${block}-heading`;
  const toggleId = `diligence-${block}-toggle`;
  const panelId = `diligence-${block}-panel`;

  return (
    <section
      className={cn(
        "rounded-lg border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-white/[0.02]",
        className,
      )}
      aria-labelledby={headerId}
    >
      <div className="flex items-center justify-between gap-3 rounded-t-lg px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.04]">
        <h2 id={headerId} className="sr-only">
          {title}
        </h2>
        <button
          id={toggleId}
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-labelledby={headerId}
          aria-expanded={!collapsed}
          aria-controls={panelId}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          )}
          <span
            className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100"
            aria-hidden="true"
          >
            {title}
          </span>
          <EvidenceChip
            tier={overallTier}
            sourceCount={sourceCount}
            compact
            className="shrink-0"
          />
          {updatedLabel ? (
            <span className="truncate text-xs text-gray-500 dark:text-gray-400">
              - updated {updatedLabel}
            </span>
          ) : null}
        </button>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>

      {!collapsed ? (
        <div id={panelId} className="border-t border-gray-100 px-4 py-3 dark:border-white/[0.06]">
          {description ? (
            <p className="mb-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
              {description}
            </p>
          ) : null}

          {candidates.length === 0 ? (
            <div
              className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-600 dark:border-white/[0.08] dark:bg-white/[0.01] dark:text-gray-400"
              role="status"
            >
              {emptyLabel}
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {candidates.map((candidate, index) => (
                <li key={index}>{renderer(candidate, index)}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

export default DiligenceSection;
