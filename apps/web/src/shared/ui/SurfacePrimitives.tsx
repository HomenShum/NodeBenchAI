/**
 * SurfacePrimitives — The ONE design language for all cockpit surfaces.
 *
 * RULE: Every surface must use ONLY these components for cards, sections,
 * badges, tabs, stats, and chips. No custom styles. No exceptions.
 *
 * Reference: DecisionMemoView.tsx (the cleanest surface).
 * Inspiration: Linear, Vercel, Notion — one card, one badge, one tab, one accent.
 */

import { memo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ai-ui/tabs";

// ═══════════════════════════════════════════════════════════════════════
// Cards
// ═══════════════════════════════════════════════════════════════════════

interface SurfaceCardProps {
  children: ReactNode;
  className?: string;
  /** Interactive cards get hover state */
  interactive?: boolean;
  /** Compact cards have less padding */
  compact?: boolean;
  onClick?: () => void;
  "data-agent-id"?: string;
  "data-agent-action"?: string;
}

export const SurfaceCard = memo(function SurfaceCard({
  children,
  className,
  interactive,
  compact,
  onClick,
  ...rest
}: SurfaceCardProps) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "rounded-xl border border-edge",
        compact ? "px-4 py-3" : "p-5",
        interactive || onClick
          ? "bg-surface/50 transition-colors duration-150 hover:border-[rgba(99,102,241,0.2)] hover:bg-surface-hover text-left"
          : "bg-surface/50",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// Section Headers
// ═══════════════════════════════════════════════════════════════════════

interface SurfaceSectionProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
  "data-agent-id"?: string;
}

export const SurfaceSection = memo(function SurfaceSection({
  title,
  subtitle,
  children,
  className,
  action,
  ...rest
}: SurfaceSectionProps) {
  return (
    <section className={cn("mb-6", className)} {...rest}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
          {title}
        </h3>
        {action}
      </div>
      {subtitle && (
        <p className="mb-3 text-sm leading-relaxed text-content-secondary">{subtitle}</p>
      )}
      {children}
    </section>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// Badges — 5 states only: positive, info, warning, danger, neutral
// ═══════════════════════════════════════════════════════════════════════

type BadgeTone = "positive" | "info" | "warning" | "danger" | "neutral";

const BADGE_STYLES: Record<BadgeTone, string> = {
  positive: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  info: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  danger: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  neutral: "bg-white/5 text-content-muted border-edge",
};

interface SurfaceBadgeProps {
  tone: BadgeTone;
  children: ReactNode;
  className?: string;
}

export const SurfaceBadge = memo(function SurfaceBadge({
  tone,
  children,
  className,
}: SurfaceBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        BADGE_STYLES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
});

/** Helper: map a 0-1 score to a badge tone */
export function scoreToBadgeTone(score: number): BadgeTone {
  if (score >= 0.7) return "positive";
  if (score >= 0.5) return "info";
  if (score >= 0.3) return "warning";
  return "danger";
}

/** Helper: map a label string to a badge tone */
export function labelToBadgeTone(label: string): BadgeTone {
  switch (label) {
    case "compounding":
    case "pass":
    case "allowed":
    case "approved":
      return "positive";
    case "improving":
    case "partial":
    case "pending":
      return "info";
    case "flat":
    case "watch":
    case "escalated":
      return "warning";
    case "drifting":
    case "fail":
    case "denied":
    case "blocked":
      return "danger";
    default:
      return "neutral";
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Tabs — underline style only
// ═══════════════════════════════════════════════════════════════════════

interface SurfaceTabsProps<T extends string> {
  tabs: Array<{ id: T; label: string; icon?: LucideIcon }>;
  activeTab: T;
  onTabChange: (tab: T) => void;
  className?: string;
}

export function SurfaceTabs<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  className,
}: SurfaceTabsProps<T>) {
  return (
    <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as T)}>
      <TabsList className={cn("h-auto justify-start gap-1 rounded-none border-b border-edge bg-transparent p-0", className)}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="gap-1.5 rounded-none border-b-2 border-transparent px-3 py-2 text-sm font-medium text-content-muted shadow-none data-[state=active]:border-[var(--accent-primary)] data-[state=active]:bg-transparent data-[state=active]:text-content data-[state=active]:shadow-none"
            >
              {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
              {tab.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Stat Card — for KPI grids
// ═══════════════════════════════════════════════════════════════════════

interface SurfaceStatProps {
  value: string | number;
  label: string;
  sublabel?: string;
  tone?: BadgeTone;
  className?: string;
}

export const SurfaceStat = memo(function SurfaceStat({
  value,
  label,
  sublabel,
  tone,
  className,
}: SurfaceStatProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span
        className={cn(
          "text-2xl font-semibold tracking-tight",
          tone ? `text-${tone === "positive" ? "emerald" : tone === "info" ? "cyan" : tone === "warning" ? "amber" : tone === "danger" ? "rose" : "content"}-400` : "text-content",
        )}
      >
        {value}
      </span>
      <span className="text-[11px] uppercase tracking-wider text-content-muted">{label}</span>
      {sublabel && (
        <span className="text-[10px] text-content-muted">{sublabel}</span>
      )}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// Chip — for filters, topics, tags
// ═══════════════════════════════════════════════════════════════════════

interface SurfaceChipProps {
  children: ReactNode;
  icon?: LucideIcon;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}

export const SurfaceChip = memo(function SurfaceChip({
  children,
  icon: Icon,
  active,
  onClick,
  className,
}: SurfaceChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]"
          : "border-edge bg-surface/50 text-content-secondary hover:bg-surface-hover",
        className,
      )}
    >
      {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
      {children}
    </button>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// Buttons — primary and ghost only
// ═══════════════════════════════════════════════════════════════════════

interface SurfaceButtonProps {
  children: ReactNode;
  variant?: "primary" | "ghost";
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  onClick?: () => void;
  href?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

export const SurfaceButton = memo(function SurfaceButton({
  children,
  variant = "ghost",
  icon: IconLeft,
  iconRight: IconRight,
  onClick,
  href,
  className,
  disabled,
  ...rest
}: SurfaceButtonProps) {
  const classes = cn(
    "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
    variant === "primary"
      ? "bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary-hover)]"
      : "border border-edge text-content-secondary hover:bg-surface-hover hover:text-content",
    disabled && "opacity-50 pointer-events-none",
    className,
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={classes} {...rest}>
        {IconLeft && <IconLeft className="h-4 w-4" aria-hidden="true" />}
        {children}
        {IconRight && <IconRight className="h-4 w-4" aria-hidden="true" />}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={classes} {...rest}>
      {IconLeft && <IconLeft className="h-4 w-4" aria-hidden="true" />}
      {children}
      {IconRight && <IconRight className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// Page Header — one consistent header per surface
// ═══════════════════════════════════════════════════════════════════════

interface SurfacePageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export const SurfacePageHeader = memo(function SurfacePageHeader({
  title,
  subtitle,
  badge,
  actions,
  className,
}: SurfacePageHeaderProps) {
  return (
    <div className={cn("mb-6", className)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-content">{title}</h1>
            {badge}
          </div>
          {subtitle && (
            <p className="mt-1 text-sm leading-relaxed text-content-muted">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// Surface Scroll Container — consistent padding + scroll
// ═══════════════════════════════════════════════════════════════════════

interface SurfaceScrollProps {
  children: ReactNode;
  className?: string;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "full";
}

const MAX_WIDTH_MAP = {
  sm: "max-w-2xl",
  md: "max-w-4xl",
  lg: "max-w-5xl",
  xl: "max-w-6xl",
  full: "",
};

export const SurfaceScroll = memo(function SurfaceScroll({
  children,
  className,
  maxWidth = "xl",
}: SurfaceScrollProps) {
  return (
    <div className={cn("h-full overflow-y-auto scroll-smooth", className)}>
      <div className={cn("mx-auto px-6 pb-24 pt-6", MAX_WIDTH_MAP[maxWidth])}>
        {children}
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// Grid layouts
// ═══════════════════════════════════════════════════════════════════════

interface SurfaceGridProps {
  children: ReactNode;
  cols?: 2 | 3 | 4;
  className?: string;
}

const GRID_COLS = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

export const SurfaceGrid = memo(function SurfaceGrid({
  children,
  cols = 3,
  className,
}: SurfaceGridProps) {
  return (
    <div className={cn("grid gap-4", GRID_COLS[cols], className)}>
      {children}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// Divider
// ═══════════════════════════════════════════════════════════════════════

export function SurfaceDivider({ className }: { className?: string }) {
  return <hr className={cn("border-edge my-6", className)} />;
}
