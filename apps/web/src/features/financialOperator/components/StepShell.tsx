/**
 * StepShell — common chrome around every typed step card.
 *
 * Built on the kit's `.nb-panel` + type utility classes (per
 * docs/architecture/FINANCIAL_OPERATOR_DESIGN_ALIGNMENT.md):
 *
 *   - Outer container: `.nb-panel` (12px radius, 1px hairline, panel bg)
 *   - Sequence number + kind label: `.type-kicker` (kit canonical kicker)
 *   - Title:                        `.type-card-title`
 *   - Footer meta:                  `.type-caption`
 *   - Left accent stripe per kind keeps cards visually distinguishable
 *     without inventing new card chrome
 */

import type { ReactNode } from "react";
import type { StepKind, StepStatus } from "../types";
import { StepStatusBadge } from "./StepStatusBadge";

const KIND_LABEL: Record<StepKind, string> = {
  run_brief: "Plan",
  tool_call: "Tool",
  extraction: "Extraction",
  validation: "Validation",
  calculation: "Calculation",
  evidence: "Evidence",
  artifact: "Artifact",
  approval_request: "Approval",
  result: "Result",
};

/**
 * Left accent stripe per kind. Resolves through CSS vars + color-mix so
 * the stripe is on-brand in both light and dark themes.
 */
const KIND_STRIPE: Record<StepKind, string> = {
  run_brief:        "before:bg-[color:color-mix(in_oklab,var(--brand-indigo,#5E6AD2)_55%,transparent)]",
  tool_call:        "before:bg-[color:var(--text-muted)]",
  extraction:       "before:bg-[color:color-mix(in_oklab,var(--accent-primary)_45%,var(--brand-indigo,#5E6AD2)_25%)]",
  validation:       "before:bg-[color:color-mix(in_oklab,var(--brand-indigo,#5E6AD2)_50%,transparent)]",
  calculation:      "before:bg-[color:var(--success,#047857)]",
  evidence:         "before:bg-[color:color-mix(in_oklab,var(--brand-indigo,#5E6AD2)_55%,transparent)]",
  artifact:         "before:bg-[color:var(--warning,#B45309)]",
  approval_request: "before:bg-[color:var(--accent-primary)]",
  result:           "before:bg-[color:var(--success,#047857)]",
};

interface StepShellProps {
  kind: StepKind;
  status: StepStatus;
  title: string;
  seq: number;
  durationMs?: number;
  errorMessage?: string;
  children: ReactNode;
}

export function StepShell({
  kind,
  status,
  title,
  seq,
  durationMs,
  errorMessage,
  children,
}: StepShellProps) {
  return (
    <article
      aria-label={`Step ${seq + 1}: ${KIND_LABEL[kind]} — ${title}`}
      className={[
        "nb-panel",
        // Left accent stripe via ::before (avoids extra DOM, stays inside the
        // .nb-panel border).
        "relative overflow-hidden",
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']",
        KIND_STRIPE[kind],
        // Override the panel's default 16px padding to add a touch of left
        // breathing room past the stripe.
        "!pl-5",
      ].join(" ")}
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
          #{(seq + 1).toString().padStart(2, "0")}
        </span>
        <span className="type-label !tracking-[0.18em]">{KIND_LABEL[kind]}</span>
        <h3 className="type-card-title text-[var(--text-primary)]">{title}</h3>
        <span className="ml-auto">
          <StepStatusBadge status={status} />
        </span>
      </header>
      <div className="text-[13px] leading-[1.5] text-[var(--text-secondary)]">{children}</div>
      {(durationMs !== undefined || errorMessage) && (
        <footer className="type-caption mt-3 flex flex-wrap items-center gap-3 border-t border-[var(--border-color)] pt-2">
          {durationMs !== undefined && <span>{durationMs}ms</span>}
          {errorMessage && (
            <span className="text-[var(--destructive,#DC2626)]">
              Error: {errorMessage}
            </span>
          )}
        </footer>
      )}
    </article>
  );
}
