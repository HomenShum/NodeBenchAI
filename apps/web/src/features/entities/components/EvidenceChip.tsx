/**
 * EvidenceChip — inline confidence + source attribution chip.
 *
 * Pattern: credibility-first rendering — every rendered fact carries a visible
 *          evidence marker + reason chain so users trust the output before
 *          any configuration is required (ChatGPT-style self-verification).
 *
 * Prior art:
 *   - ChatGPT / Perplexity — inline citation + source tiers
 *   - Anthropic Claude — response references with source attribution
 *   - Arc Max — inline trust indicators
 *
 * See: docs/architecture/DESIGN_SYSTEM.md
 *      docs/architecture/DILIGENCE_BLOCKS.md
 *      .claude/rules/grounded_eval.md
 *      .claude/rules/reference_attribution.md
 *
 * Used by:
 *  - Entity page Founders/Products/etc. section (each card shows its chip)
 *  - Reports grid cards (entity-level freshness chip reuses the same component)
 *  - Session Artifacts panel (per-artifact tier display)
 *  - Contribution log (per-fact tier display)
 */

import { cn } from "@/lib/utils";

/**
 * Confidence tier — driven by the block's verification gates + source tiers.
 * Matches `packages/mcp-local` / `server/pipeline/blocks/founder.ts`.
 * HONEST_SCORES rule — never hardcoded, always computed.
 */
export type EvidenceTier =
  | "verified"        // ≥2 tier1/tier2 sources, all required gates pass
  | "corroborated"    // multi-source agreement (mixed tiers)
  | "single-source"   // gates pass but only one source overall
  | "unverified";     // gates failed or zero sources

export type EvidenceChipProps = {
  tier: EvidenceTier;
  /** Optional source count for accessibility + tooltip. */
  sourceCount?: number;
  /** Optional short source label shown in the chip ("LinkedIn · TechCrunch"). */
  sourceLabel?: string;
  /** Optional full explanation shown in `title` tooltip. */
  reason?: string;
  /** Compact mode — smaller padding for inline use in dense lists. */
  compact?: boolean;
  /** Additional classes for positioning. */
  className?: string;
};

/**
 * Tier → color-and-weight styling.
 *
 * Accessibility:
 *  - Never color-only (tier label is always visible text)
 *  - Dark-mode contrast ≥ 4.5:1 for text on background
 *  - `aria-label` includes the reason for screen-readers
 */
function tierStyles(tier: EvidenceTier): string {
  switch (tier) {
    case "verified":
      return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300";
    case "corroborated":
      return "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-300";
    case "single-source":
      return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300";
    case "unverified":
      return "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-300";
  }
}

/**
 * Human-readable tier label. Kept short to fit inline in dense contexts.
 * These are the ONLY labels the user sees — never the raw enum values.
 */
function tierLabel(tier: EvidenceTier): string {
  switch (tier) {
    case "verified":
      return "Verified";
    case "corroborated":
      return "Corroborated";
    case "single-source":
      return "Single source";
    case "unverified":
      return "Unverified";
  }
}

/**
 * Long-form reason when `reason` prop is not supplied. Powers the default
 * tooltip so users always know why a tier was assigned.
 */
function defaultReason(tier: EvidenceTier, sourceCount?: number): string {
  const n = sourceCount ?? 0;
  switch (tier) {
    case "verified":
      return `Confirmed by ${n || "multiple"} authoritative sources. All verification gates passed.`;
    case "corroborated":
      return `Multiple sources agree (${n || "mixed tiers"}). All verification gates passed.`;
    case "single-source":
      return `Only one source found so far. Verification gates passed but needs corroboration.`;
    case "unverified":
      return `Not yet verified. Either the verification gates did not pass or no reliable source was found.`;
  }
}

export function EvidenceChip({
  tier,
  sourceCount,
  sourceLabel,
  reason,
  compact = false,
  className,
}: EvidenceChipProps) {
  const label = tierLabel(tier);
  const fullReason = reason ?? defaultReason(tier, sourceCount);
  const ariaLabel = `Evidence tier: ${label}. ${fullReason}`;

  return (
    <span
      role="status"
      aria-label={ariaLabel}
      title={fullReason}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium tabular-nums",
        compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]",
        tierStyles(tier),
        className,
      )}
    >
      {/* Dot indicator — pairs with text for color-blind safety. */}
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tier === "verified" && "bg-emerald-600 dark:bg-emerald-400",
          tier === "corroborated" && "bg-sky-600 dark:bg-sky-400",
          tier === "single-source" && "bg-amber-600 dark:bg-amber-400",
          tier === "unverified" && "bg-slate-500 dark:bg-slate-400",
        )}
      />
      <span>{label}</span>
      {sourceLabel ? (
        <>
          <span aria-hidden="true" className="opacity-50">
            ·
          </span>
          <span className="truncate max-w-[14ch]" title={sourceLabel}>
            {sourceLabel}
          </span>
        </>
      ) : null}
      {sourceCount !== undefined && sourceCount > 0 ? (
        <>
          <span aria-hidden="true" className="opacity-50">
            ·
          </span>
          <span>
            {sourceCount} {sourceCount === 1 ? "src" : "srcs"}
          </span>
        </>
      ) : null}
    </span>
  );
}

export default EvidenceChip;
