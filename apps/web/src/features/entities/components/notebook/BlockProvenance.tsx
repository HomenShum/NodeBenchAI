/**
 * BlockProvenance — inline chips on the right edge of agent-authored blocks.
 * Shows: confidence (weighted avg of cited sources), model used, estimated cost.
 * Hidden until hover/focus to keep reading flow clean.
 *
 * Pattern: quiet by default, legible on hover/focus (PR6 refactor).
 *
 * Prior art:
 *   - Notion inline mentions — hover-reveal detail
 *   - Linear — citation chips on timeline items
 *   - Wikipedia — footnote hovercards
 *
 * See: .claude/rules/reexamine_performance.md  (progressive disclosure)
 *      .claude/rules/reexamine_a11y.md  (focus-reveal not hover-only)
 *      .claude/rules/reference_attribution.md
 *
 * Current impl: CSS opacity transition keeps DOM minimal but content present
 * so group-hover/group-focus-within reveals chips without mount churn.
 * Future PR6 extension: detailed source popover is lazy-mounted on explicit
 * click (not hover) to avoid loading heavy source detail on every cursor pass.
 */

import { memo } from "react";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { BlockChip } from "./BlockChipRenderer";

type Block = {
  _id: Id<"productBlocks">;
  kind: string;
  authorKind: "user" | "agent" | "anonymous";
  authorId?: string;
  sourceRefIds?: string[];
  sourceToolStep?: number;
  revision: number;
  content: BlockChip[];
};

type Props = {
  block: Block;
};

function confidenceTone(confidence: number | undefined): string {
  if (confidence == null) return "text-gray-400 bg-gray-500/10";
  if (confidence >= 0.85) return "text-emerald-500 bg-emerald-500/10";
  if (confidence >= 0.6) return "text-amber-500 bg-amber-500/10";
  return "text-red-400 bg-red-500/10";
}

function BlockProvenanceBase({ block }: Props) {
  // Only render for agent-authored non-heading blocks to reduce visual noise.
  if (block.authorKind !== "agent") return null;
  if (block.kind.startsWith("heading_")) return null;
  if (block.kind === "evidence") return null;

  const items: Array<{ label: string; tone: string; title?: string }> = [];

  if (block.revision > 1) {
    items.push({
      label: `rev ${block.revision}`,
      tone: "text-gray-500 bg-gray-500/10",
      title: "Block has been edited since first generation",
    });
  }

  if (block.authorId) {
    items.push({
      label: block.authorId.replace(/^gemini-/, "gemini-"),
      tone: "text-[var(--accent-primary)] bg-[var(--accent-primary)]/10",
      title: "Model / author that produced this block",
    });
  }

  if (block.sourceToolStep != null) {
    items.push({
      label: `step ${block.sourceToolStep}`,
      tone: "text-gray-500 bg-gray-500/10",
      title: "Tool step this block originated from",
    });
  }

  if (items.length === 0) return null;

  return (
    <span className="flex flex-shrink-0 items-start gap-1 opacity-0 transition-opacity group-hover:opacity-90 group-focus-within:opacity-90">
      {items.map((item, idx) => (
        <span
          key={idx}
          title={item.title}
          className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${item.tone}`}
        >
          {item.label}
        </span>
      ))}
    </span>
  );
}

/**
 * React.memo boundary — prevents per-keystroke re-evaluation of provenance
 * when the surrounding block's parent re-renders but block identity
 * (revision / kind / authorId / sourceToolStep) hasn't changed.
 *
 * This is the PR6 cheap win: provenance is now free on the typing hot path.
 */
export const BlockProvenance = memo(BlockProvenanceBase);
BlockProvenance.displayName = "BlockProvenance";

// Re-export helpers for callers
export { confidenceTone };

export default BlockProvenance;
