/**
 * TaskSessionCard - Card component for displaying task session summary
 * 
 * Features:
 * - Status indicator with icon and color
 * - Task type badge
 * - Duration and token metrics
 * - Click to select for detail view
 */

import React from 'react';
import {
  Clock,
  Zap,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskSession, TaskSessionStatus, TaskSessionType } from './types';
import { fmtCompact } from '@/lib/formatNumber';
import {
  formatDurationCompact,
  formatGoalReference,
  formatUsd,
  getCrossCheckPresentation,
} from '../oracleControlTowerUtils';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// STATUS CONFIGURATION
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const statusConfig: Record<TaskSessionStatus, { dotColor: string; label: string }> = {
  pending: {
    dotColor: 'bg-content-muted',
    label: 'Pending'
  },
  running: { 
    dotColor: 'bg-indigo-600',
    label: 'Running' 
  },
  completed: {
    dotColor: 'bg-emerald-500',
    label: 'Completed'
  },
  failed: {
    dotColor: 'bg-red-500',
    label: 'Failed'
  },
  cancelled: {
    dotColor: 'bg-content-secondary',
    label: 'Cancelled'
  },
};

const typeConfig: Record<TaskSessionType, { dotColor: string; label: string }> = {
  manual: {
    dotColor: 'bg-content-secondary',
    label: 'User'
  },
  cron: {
    dotColor: 'bg-content-secondary',
    label: 'Cron'
  },
  scheduled: {
    dotColor: 'bg-content-secondary',
    label: 'Scheduled'
  },
  agent: {
    dotColor: 'bg-indigo-600',
    label: 'Agent'
  },
  swarm: {
    dotColor: 'bg-indigo-600',
    label: 'Swarm'
  },
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// UTILITIES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  return fmtCompact(tokens).toUpperCase();
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// COMPONENT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

interface TaskSessionCardProps {
  session: TaskSession;
  isSelected?: boolean;
  onClick?: () => void;
}

export function TaskSessionCard({ session, isSelected, onClick }: TaskSessionCardProps) {
  const statusCfg = statusConfig[session.status];
  const typeCfg = typeConfig[session.type];
  const crossCheck = getCrossCheckPresentation(session.crossCheckStatus);
  
  return (
    <div 
      className={cn(
        "p-3 rounded-lg border cursor-pointer transition-all",
        "hover:bg-surface-secondary hover:border-indigo-500/30",
        isSelected 
          ? "bg-surface-secondary border-indigo-500/30 ring-1 ring-ring" 
          : "bg-surface border-edge"
      )}
      onClick={onClick}
    >
      {/* Header: Title + Status */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-content truncate">
              {session.title.replace(/^Cron:\s*/i, 'Scheduled: ')}
            </h3>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                crossCheck.className,
              )}
            >
              {crossCheck.questLabel}
            </span>
          </div>
          {session.description && (
            <p className="text-[13px] leading-snug text-content-secondary line-clamp-2 mt-1">
              {session.description}
            </p>
          )}
          {session.deltaFromVision && (
            <p className="mt-1 text-[11px] leading-snug text-content-muted line-clamp-2">
              {session.deltaFromVision}
            </p>
          )}
        </div>
        <div className="inline-flex items-center gap-1.5 text-[10px] text-content-muted" title={statusCfg.label}>
          <span
            className={cn(
              "w-2 h-2 rounded-full shrink-0",
              statusCfg.dotColor,
              session.status === 'running' && "motion-safe:animate-pulse"
            )}
          />
          <span className="hidden sm:inline">{statusCfg.label}</span>
        </div>
      </div>

      {/* Type badge + Meta */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface-secondary px-2 py-1 text-[10px] font-medium text-content-secondary">
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", typeCfg.dotColor)} />
          <span>{typeCfg.label}</span>
        </span>

        <span className="inline-flex items-center gap-1 rounded-full border border-edge bg-surface px-2 py-1 text-[11px] text-content-muted">
          <Clock className="w-3 h-3" />
          {formatDate(session.startedAt)}
        </span>

        {session.totalDurationMs && (
          <span className="inline-flex items-center rounded-full border border-edge bg-surface px-2 py-1 text-[11px] text-content-muted">
            {formatDurationCompact(session.totalDurationMs)}
          </span>
        )}

        {session.totalTokens && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-edge bg-surface px-2 py-1 text-[11px] text-content-muted"
            title={`${formatTokens(session.totalTokens)} tokens`}
          >
            <Zap className="w-3 h-3" />
            {formatTokens(session.totalTokens)} tokens
          </span>
        )}

        {session.estimatedCostUsd !== undefined && (
          <span className="inline-flex items-center rounded-full border border-edge bg-surface px-2 py-1 text-[11px] text-content-muted">
            {formatUsd(session.estimatedCostUsd)}
          </span>
        )}

        {session.toolsUsed && session.toolsUsed.length > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-edge bg-surface px-2 py-1 text-[11px] text-content-muted"
            title={`${session.toolsUsed.length} ${session.toolsUsed.length === 1 ? 'tool' : 'tools'} used`}
          >
            <Wrench className="w-3 h-3" />
            {session.toolsUsed.length} {session.toolsUsed.length === 1 ? "tool" : "tools"}
          </span>
        )}

        {session.goalId && (
          <span className="inline-flex items-center rounded-full border border-edge bg-surface px-2 py-1 text-[11px] text-content-muted">
            {formatGoalReference(session.goalId)}
          </span>
        )}
      </div>

      {/* Error message if failed */}
      {session.status === 'failed' && session.errorMessage && (
        <div className="mt-2 p-2 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <p className="text-xs text-red-600 dark:text-red-400 line-clamp-2">
            {session.errorMessage}
          </p>
        </div>
      )}
    </div>
  );
}

export default TaskSessionCard;
