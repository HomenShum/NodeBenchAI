/**
 * SidebarButton - Navigation button with micro-interactions
 *
 * Features:
 * - Subtle press feedback (scale)
 * - Monochrome active state (Linear-style)
 * - Icon + label layout
 */

import React from 'react';
import { cn } from '../../lib/utils';

interface SidebarButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  isActive?: boolean;
  activeColor?: 'emerald' | 'blue' | 'purple' | 'indigo' | 'amber' | 'rose';
  badge?: number;
  subtitle?: string;
  className?: string;
  /** Agent traversability: stable ID for this button */
  "data-agent-id"?: string;
  "data-agent-action"?: string;
  "data-agent-label"?: string;
  "data-agent-target"?: string;
}

export function SidebarButton({
  icon,
  label,
  onClick,
  isActive = false,
  activeColor: _activeColor = 'emerald',
  badge,
  subtitle,
  className,
  "data-agent-id": agentId,
  "data-agent-action": agentAction,
  "data-agent-label": agentLabel,
  "data-agent-target": agentTarget,
}: SidebarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-agent-id={agentId}
      data-agent-action={agentAction}
      data-agent-label={agentLabel}
      data-agent-target={agentTarget}
      className={cn(
        'group flex items-center gap-2.5 px-2 py-1.5 text-[13px] font-medium rounded-md transition-colors duration-150 w-[calc(100%-0.5rem)] mx-1 text-left border-l-2',
        isActive
          ? 'border-l-[var(--accent-primary)] bg-[var(--accent-primary-bg)] text-content'
          : 'border-l-transparent text-content-secondary hover:bg-surface-hover hover:text-content',
        className
      )}
    >
      <span className={cn(
        'w-4 h-4 flex-shrink-0 [&>svg]:w-full [&>svg]:h-full transition-opacity',
        isActive ? 'text-[var(--accent-primary)] opacity-100' : 'text-content-muted opacity-40 group-hover:opacity-100'
      )}>
        {icon}
      </span>
      <div className="flex flex-col items-start min-w-0">
        <span className="truncate">{label}</span>
        {isActive && subtitle && (
          <span className="text-xs text-content-secondary font-medium truncate">{subtitle}</span>
        )}
      </div>
      {badge !== undefined && badge > 0 && (
        <span className="ml-auto px-1.5 py-0.5 text-xs font-semibold rounded-full bg-surface-secondary text-content-secondary">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

export default SidebarButton;
