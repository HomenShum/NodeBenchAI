import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type SourceChipTone = "default" | "accent";
export type SourceChipSize = "sm" | "md";

export interface SourceChipProps {
  label: string;
  href?: string;
  prefix?: ReactNode;
  badge?: ReactNode;
  tone?: SourceChipTone;
  size?: SourceChipSize;
  truncate?: boolean;
  className?: string;
}

const sizeStyles: Record<SourceChipSize, string> = {
  sm: "min-h-[28px] gap-2 rounded-full px-2.5 py-1 text-[11px]",
  md: "min-h-[34px] gap-2.5 rounded-xl px-3 py-1.5 text-xs",
};

const toneStyles: Record<SourceChipTone, string> = {
  default:
    "border-edge bg-surface-secondary/50 text-content-secondary hover:border-edge hover:bg-surface-hover",
  accent:
    "border-[var(--accent-primary)]/20 bg-[var(--accent-primary)]/8 text-content hover:border-[var(--accent-primary)]/30 hover:bg-[var(--accent-primary)]/12",
};

const badgeToneStyles: Record<SourceChipTone, string> = {
  default: "bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]",
  accent: "bg-[var(--accent-primary)]/18 text-[var(--accent-primary)]",
};

function SourceChipBody({
  label,
  prefix,
  badge,
  tone,
  size,
  truncate,
}: Pick<SourceChipProps, "label" | "prefix" | "badge" | "tone" | "size" | "truncate">) {
  return (
    <>
      {prefix ? (
        <span className="flex shrink-0 items-center justify-center text-content-muted">{prefix}</span>
      ) : null}
      <span className={cn("leading-none", truncate && "max-w-[10rem] truncate")}>{label}</span>
      {badge ? (
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold",
            size === "md" ? "min-w-[20px]" : "min-w-[18px]",
            badgeToneStyles[tone ?? "default"],
          )}
        >
          {badge}
        </span>
      ) : null}
    </>
  );
}

export function SourceChip({
  label,
  href,
  prefix,
  badge,
  tone = "default",
  size = "sm",
  truncate = false,
  className,
}: SourceChipProps) {
  const chipClassName = cn(
    "inline-flex items-center border transition-colors",
    sizeStyles[size],
    toneStyles[tone],
    className,
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={chipClassName}>
        <SourceChipBody
          label={label}
          prefix={prefix}
          badge={badge}
          tone={tone}
          size={size}
          truncate={truncate}
        />
      </a>
    );
  }

  return (
    <span className={chipClassName}>
      <SourceChipBody
        label={label}
        prefix={prefix}
        badge={badge}
        tone={tone}
        size={size}
        truncate={truncate}
      />
    </span>
  );
}

export default SourceChip;
