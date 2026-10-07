/**
 * EditProgressCard - Displays Deep Agent document edit progress and status
 *
 * Shows pending, applied, and failed edits with retry/cancel controls.
 * Follows the DocumentActionCard pattern for consistent UI.
 */

import React from 'react';
import {
  Edit3,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  X,
  AlertTriangle,
  FileText
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PendingEdit } from '@/features/editor/hooks/usePendingEdits';

interface EditProgressCardProps {
  edit: PendingEdit;
  onRetry?: (editId: string) => void;
  onCancel?: (editId: string) => void;
  className?: string;
}

/**
 * Single edit progress card showing status and controls
 */
export function EditProgressCard({ edit, onRetry, onCancel, className }: EditProgressCardProps) {
  const statusConfig = {
    pending: {
      icon: Loader2,
      color: 'text-violet-500',
      bgColor: 'bg-violet-50',
      borderColor: 'border-violet-200',
      label: 'Applying...',
      animate: true,
    },
    applied: {
      icon: CheckCircle2,
      color: 'text-green-500',
      bgColor: 'bg-green-50',
      borderColor: 'border-green-200',
      label: 'Applied',
      animate: false,
    },
    failed: {
      icon: XCircle,
      color: 'text-red-500',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-200',
      label: 'Failed',
      animate: false,
    },
    cancelled: {
      icon: X,
      color: 'text-content-muted',
      bgColor: 'bg-surface-secondary',
      borderColor: 'border-edge',
      label: 'Cancelled',
      animate: false,
    },
    stale: {
      icon: AlertTriangle,
      color: 'text-amber-500',
      bgColor: 'bg-amber-50',
      borderColor: 'border-amber-200',
      label: 'Stale',
      animate: false,
    },
  };

  const config = statusConfig[edit.status];
  const StatusIcon = config.icon;

  // Truncate anchor for display
  const displayAnchor = edit.operation.anchor.length > 40
    ? `${edit.operation.anchor.slice(0, 40)}...`
    : edit.operation.anchor;

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 rounded-lg border transition-all",
        config.bgColor,
        config.borderColor,
        className
      )}
    >
      {/* Status Icon */}
      <div className={cn(
        "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center",
        config.bgColor
      )}>
        <StatusIcon
          className={cn(
            "h-4 w-4",
            config.color,
            config.animate && "motion-safe:animate-spin"
          )}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Edit3 className="h-3.5 w-3.5 text-content-secondary flex-shrink-0" />
          <span className={cn("text-xs font-medium", config.color)}>
            {config.label}
          </span>
          {edit.operation.sectionHint && (
            <span className="text-xs text-content-secondary">
              • {edit.operation.sectionHint}
            </span>
          )}
        </div>

        {/* Anchor preview */}
        <p className="text-xs text-content-secondary font-mono truncate mb-1">
          "{displayAnchor}"
        </p>

        {/* Error message */}
        {edit.errorMessage && (
          <p className="text-xs text-red-600 mt-1">
            {edit.errorMessage}
          </p>
        )}

        {/* Retry count */}
        {edit.retryCount > 0 && (
          <span className="text-xs text-content-muted">
            Retry #{edit.retryCount}
          </span>
        )}
      </div>

      {/* Actions */}
      {edit.status === 'failed' && (
        <div className="flex-shrink-0 flex items-center gap-1">
          {onRetry && (
            <button
              type="button"
              onClick={() => onRetry(edit._id)}
              className="p-1.5 rounded hover:bg-red-100 transition-colors"
              title="Retry edit"
            >
              <RefreshCw className="h-3.5 w-3.5 text-red-500" />
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={() => onCancel(edit._id)}
              className="p-1.5 rounded hover:bg-surface-hover transition-colors"
              title="Cancel edit"
            >
              <X className="h-3.5 w-3.5 text-content-muted" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface EditProgressPanelProps {
  edits: PendingEdit[];
  onRetry?: (editId: string) => void;
  onCancelAll?: (threadId: string) => void;
  className?: string;
}

/**
 * EditProgressPanel - Summary panel showing all edit progress
 */
export function EditProgressPanel({ edits, onRetry, onCancelAll, className }: EditProgressPanelProps) {
  if (edits.length === 0) return null;

  const pending = edits.filter(e => e.status === 'pending');
  const applied = edits.filter(e => e.status === 'applied');
  const failed = edits.filter(e => e.status === 'failed');
  const threadId = edits[0]?.agentThreadId;

  return (
    <div className={cn("space-y-3 p-3 rounded-lg border border-edge bg-surface", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-content-secondary" />
          <h3 className="text-sm font-semibold text-content">
            Document Edits
          </h3>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-2 text-xs">
          {pending.length > 0 && (
            <span className="flex items-center gap-1 text-blue-600">
              <Loader2 className="h-3 w-3 motion-safe:animate-spin" />
              {pending.length}
            </span>
          )}
          {applied.length > 0 && (
            <span className="flex items-center gap-1 text-green-600">
              <CheckCircle2 className="h-3 w-3" />
              {applied.length}
            </span>
          )}
          {failed.length > 0 && (
            <span className="flex items-center gap-1 text-red-600">
              <XCircle className="h-3 w-3" />
              {failed.length}
            </span>
          )}
        </div>
      </div>

      {/* Failed edits (show first for attention) */}
      {failed.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-red-600">
              Failed ({failed.length})
            </span>
            {onCancelAll && threadId && (
              <button
                type="button"
                onClick={() => onCancelAll(threadId)}
                className="text-xs text-content-secondary hover:text-content"
              >
                Cancel all
              </button>
            )}
          </div>
          {failed.map(edit => (
            <EditProgressCard
              key={edit._id}
              edit={edit}
              onRetry={onRetry}
            />
          ))}
        </div>
      )}

      {/* Pending edits */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-blue-600">
            In Progress ({pending.length})
          </span>
          {pending.map(edit => (
            <EditProgressCard key={edit._id} edit={edit} />
          ))}
        </div>
      )}

      {/* Applied edits (collapsed by default) */}
      {applied.length > 0 && (
        <details className="group">
          <summary className="text-xs font-medium text-green-600 cursor-pointer list-none flex items-center gap-1">
            <span>Applied ({applied.length})</span>
            <span className="text-content-muted group-open:rotate-90 transition-transform">▶</span>
          </summary>
          <div className="mt-2 space-y-2">
            {applied.map(edit => (
              <EditProgressCard key={edit._id} edit={edit} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
