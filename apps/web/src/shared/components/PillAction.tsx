/**
 * PillAction — Shared pill-shaped action button.
 * Eliminates 8+ copies of the identical rounded-full button style.
 */

import { memo, type ElementType, type ReactNode } from "react";

interface PillActionProps {
  icon?: ElementType;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}

export const PillAction = memo(function PillAction({ icon: Icon, children, onClick, disabled }: PillActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-content transition hover:bg-white/[0.08] disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
});
