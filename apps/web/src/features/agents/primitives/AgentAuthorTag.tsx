/**
 * AgentAuthorTag — inline author pill for agent-written content.
 *
 * Pulled directly from the `nodebench_v4_notionLike_reactFlow` +
 * `nodebench_v3_authorTagging` prototypes. The premise: when the
 * notebook is co-authored by humans AND agents, every paragraph
 * that an agent produced should carry a tiny colored pill next to
 * it saying who wrote it. That attribution is what makes the page
 * read as a living document instead of a tooling surface.
 *
 * Color system (from v4):
 *   - blue     (#529cca)  joaquin  "planner"
 *   - purple   (#9065b0)  spencer  "researcher"
 *   - green    (#4dab9a)  maya     "analyst"
 *   - orange   (#d9730d)  alex     "synthesizer"
 * Plus a neutral `system` gray and a fallback hash-derived color.
 *
 * Accessibility:
 *   - Semantic role: the pill is just visual attribution; we expose
 *     the agent name to screen readers via `aria-label`.
 *   - Reduced-motion: the fade-in animation is suppressed via the
 *     `@media (prefers-reduced-motion)` rule in index.css.
 */

import { memo } from "react";
import { PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";

/** Canonical agent color variants. Extend via `hashFor()` if unknown. */
export type AgentColor = "blue" | "purple" | "green" | "orange" | "system";

export interface AgentAuthorTagProps {
  /** Display name (case-as-provided; we don't modify). */
  agentName: string;
  /** Stable id for deterministic color when `color` is omitted. */
  agentId?: string;
  /** Explicit color override. Highest precedence. */
  color?: AgentColor;
  /** When true, renders without the pencil icon (inline paragraph use). */
  compact?: boolean;
  className?: string;
}

const COLOR_STYLES: Record<AgentColor, { bg: string; text: string }> = {
  blue: { bg: "rgba(82, 156, 202, 0.18)", text: "#6fb1d9" },
  purple: { bg: "rgba(144, 101, 176, 0.18)", text: "#a781c2" },
  green: { bg: "rgba(77, 171, 154, 0.18)", text: "#6bc3b1" },
  orange: { bg: "rgba(217, 115, 13, 0.18)", text: "#e08a3c" },
  system: { bg: "rgba(255, 255, 255, 0.06)", text: "rgba(255,255,255,0.6)" },
};

const DETERMINISTIC_COLORS: AgentColor[] = ["blue", "purple", "green", "orange"];

function hashFor(id: string): AgentColor {
  // Tiny deterministic hash → color bucket. Not cryptographic; we just
  // want the same agent to always get the same color across renders.
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return DETERMINISTIC_COLORS[Math.abs(h) % DETERMINISTIC_COLORS.length];
}

export const AgentAuthorTag = memo(function AgentAuthorTag({
  agentName,
  agentId,
  color,
  compact = false,
  className,
}: AgentAuthorTagProps) {
  const resolvedColor: AgentColor =
    color ?? (agentId ? hashFor(agentId) : "system");
  const style = COLOR_STYLES[resolvedColor];
  return (
    <span
      className={cn(
        "nb-agent-tag inline-flex items-baseline gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums leading-none align-baseline",
        className,
      )}
      style={{ backgroundColor: style.bg, color: style.text }}
      role="note"
      aria-label={`Authored by agent ${agentName}`}
      data-agent-id={agentId}
      data-agent-color={resolvedColor}
    >
      {!compact ? (
        <PencilLine className="h-2.5 w-2.5 translate-y-[0.5px]" aria-hidden="true" />
      ) : null}
      <span>{agentName}</span>
    </span>
  );
});

AgentAuthorTag.displayName = "AgentAuthorTag";
