/**
 * SectionLabel — Shared section header with optional icon.
 * Eliminates 15+ copies of the identical tracking/uppercase class string.
 */

import { memo, type ElementType, type ReactNode } from "react";

interface SectionLabelProps {
  icon?: ElementType;
  children: ReactNode;
}

export const SectionLabel = memo(function SectionLabel({ icon: Icon, children }: SectionLabelProps) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </div>
  );
});
