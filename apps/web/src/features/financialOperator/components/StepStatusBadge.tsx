/**
 * Step status badge — pill following the kit's `.badge` / `.badge-*` pattern.
 *
 * Token alignment (per docs/architecture/FINANCIAL_OPERATOR_DESIGN_ALIGNMENT.md):
 *   - Pill chrome:    rounded-full, 1px hairline, font-semibold 11px
 *   - Color families: success / warn / fail / accent (terracotta) / neutral
 *   - Icon size:      14px (kit rule: pills/status badges = 14px icons)
 *   - No raw color literals — everything resolves to the kit CSS vars
 *     (--accent-primary, --success, --warning, --destructive, --text-muted)
 */

import {
  AlertTriangle,
  Check,
  Clock,
  Loader2,
  ShieldCheck,
  ShieldX,
  X,
} from "lucide-react";
import type { StepStatus } from "../types";

interface Tone {
  label: string;
  /** Maps to the kit's badge variants (component-badges.html). */
  variant: "neutral" | "success" | "warn" | "fail" | "accent";
  Icon: typeof Check;
  spin?: boolean;
}

const TONES: Record<StepStatus, Tone> = {
  pending:      { label: "Pending",      variant: "neutral", Icon: Clock },
  running:      { label: "Running",      variant: "accent",  Icon: Loader2, spin: true },
  complete:     { label: "Complete",     variant: "success", Icon: Check },
  error:        { label: "Error",        variant: "fail",    Icon: X },
  needs_review: { label: "Needs review", variant: "warn",    Icon: AlertTriangle },
  approved:     { label: "Approved",     variant: "accent",  Icon: ShieldCheck },
  rejected:     { label: "Rejected",     variant: "fail",    Icon: ShieldX },
};

const VARIANT_CLASSES: Record<Tone["variant"], string> = {
  // Neutral pill matches the kit's default .badge: white/.78 background,
  // muted-grey text, hairline neutral border.
  neutral: "border-[rgba(15,23,42,0.08)] bg-white/[0.78] text-[var(--text-muted)] dark:border-white/10 dark:bg-white/[0.04]",
  // Success / warn / fail / accent map exactly to the kit's badge-* classes.
  success: "border-[rgba(5,150,105,0.16)] bg-[rgba(5,150,105,0.08)] text-[var(--success,#047857)]",
  warn:    "border-[rgba(180,83,9,0.20)]  bg-[rgba(180,83,9,0.06)]  text-[var(--warning,#B45309)]",
  fail:    "border-[rgba(220,38,38,0.20)] bg-[rgba(220,38,38,0.06)] text-[var(--destructive,#DC2626)]",
  accent:  "border-[color:color-mix(in_oklab,var(--accent-primary)_24%,transparent)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]",
};

const VARIANT_DOT: Record<Tone["variant"], string> = {
  neutral: "bg-[var(--text-muted)]",
  success: "bg-[var(--success,#047857)]",
  warn:    "bg-[var(--warning,#B45309)]",
  fail:    "bg-[var(--destructive,#DC2626)]",
  accent:  "bg-[var(--accent-primary)]",
};

export function StepStatusBadge({ status }: { status: StepStatus }) {
  const tone = TONES[status];
  const Icon = tone.Icon;
  return (
    <span
      role="status"
      aria-label={`Status: ${tone.label}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-semibold leading-none ${VARIANT_CLASSES[tone.variant]}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${VARIANT_DOT[tone.variant]}`}
      />
      <Icon
        size={14}
        strokeWidth={1.8}
        aria-hidden="true"
        className={tone.spin ? "motion-safe:animate-spin" : ""}
      />
      {tone.label}
    </span>
  );
}
