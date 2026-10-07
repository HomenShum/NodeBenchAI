/**
 * EvidenceChecklistStrip — renders a 6-bool evidenceChecklist as a
 * DotGrid plus a "[grounded]/[mixed]/[speculative]" caption derived
 * deterministically via `deriveEvidenceLevel`.
 *
 * Per .claude/rules/agentic_reliability.md (HONEST_SCORES) the
 * checklist passed in is the *real* one — never a fabricated
 * `passed:true`.  When the upstream substrate has no checklist yet,
 * the caller should pass null and we render a hyphen.
 */

import type { EvidenceChecklist } from "@convex/domains/research/narrative/validators";
import { DotGrid } from "./DotGrid";

const LEVEL_LABEL: Record<"grounded" | "mixed" | "speculative", string> = {
  grounded: "[grounded]",
  mixed: "[mixed]",
  speculative: "[speculative]",
};

interface Props {
  checklist: EvidenceChecklist | null;
  passing: number;
  total: number;
  level: "grounded" | "mixed" | "speculative";
}

export function EvidenceChecklistStrip({ checklist, passing, total, level }: Props) {
  const ariaLabel = checklist
    ? `${passing} of ${total} evidence checks pass — ${level}`
    : "Evidence checklist not yet computed";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <DotGrid
        filled={passing}
        total={total}
        caption={`${passing}/${total}`}
        ariaLabel={ariaLabel}
      />
      <span className="rd-dot-grid__caption" aria-hidden="true">
        {LEVEL_LABEL[level]}
      </span>
    </span>
  );
}
