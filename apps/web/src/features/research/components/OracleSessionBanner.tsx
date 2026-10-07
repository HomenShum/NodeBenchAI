/**
 * OracleSessionBanner — Persistent cross-check status bar
 *
 * Renders below the top chrome in every view when an Oracle session
 * is active. Shows: session title, cross-check status badge, elapsed
 * time, tools used count, and quick actions (complete/fail).
 *
 * Uses semantic design tokens (text-content, bg-surface, border-edge)
 * to work in both light and dark modes.
 */

import { memo, useEffect, useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Clock,
  Wrench,
  X,
  Waypoints,
} from "lucide-react";
import type { OracleSessionState, OracleCrossCheckStatus } from "@/hooks/useOracleSession";

interface OracleSessionBannerProps {
  state: OracleSessionState;
  onComplete?: () => void;
  onCancel?: () => void;
}

const STATUS_CONFIG: Record<
  OracleCrossCheckStatus,
  { icon: typeof CheckCircle2; label: string; color: string; bg: string; border: string }
> = {
  aligned: {
    icon: CheckCircle2,
    label: "Aligned",
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
  drifting: {
    icon: AlertTriangle,
    label: "Drifting",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  violated: {
    icon: ShieldAlert,
    label: "Violated",
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
  },
};

function formatElapsed(startedAt: number | null): string {
  if (!startedAt) return "0s";
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export const OracleSessionBanner = memo(function OracleSessionBanner({
  state,
  onComplete,
  onCancel,
}: OracleSessionBannerProps) {
  const [elapsed, setElapsed] = useState("0s");

  // Update elapsed time every second
  useEffect(() => {
    if (!state.isActive || !state.startedAt) return;
    const tick = () => setElapsed(formatElapsed(state.startedAt));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [state.isActive, state.startedAt]);

  if (!state.isActive || !state.sessionId) return null;

  const status = state.crossCheckStatus ?? "aligned";
  const config = STATUS_CONFIG[status];
  const StatusIcon = config.icon;

  return (
    <div
      className={`
        flex items-center justify-between gap-3 px-4 py-2
        border-b ${config.border} ${config.bg}
        text-sm
      `}
      role="status"
      aria-live="polite"
      aria-label={`Oracle session active: ${config.label}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {/* Oracle icon */}
        <Waypoints className="h-3.5 w-3.5 text-content-muted shrink-0" />

        {/* Cross-check badge */}
        <span className={`inline-flex items-center gap-1 ${config.color} font-medium`}>
          <StatusIcon className="h-3.5 w-3.5" />
          {config.label}
        </span>

        {/* Delta from vision */}
        {state.deltaFromVision && (
          <span className="text-xs text-content-secondary truncate max-w-xs hidden sm:inline">
            {state.deltaFromVision}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {/* Elapsed time */}
        <span className="inline-flex items-center gap-1 text-xs text-content-muted">
          <Clock className="h-3 w-3" />
          {elapsed}
        </span>

        {/* Tools used */}
        {state.toolsUsed.length > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-content-muted">
            <Wrench className="h-3 w-3" />
            {state.toolsUsed.length}
          </span>
        )}

        {/* Actions */}
        {onComplete && (
          <button
            type="button"
            onClick={onComplete}
            className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface px-2 py-1 text-xs text-content-secondary hover:text-content hover:bg-surface-hover transition-colors"
          >
            <CheckCircle2 className="h-3 w-3" />
            Complete
          </button>
        )}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface px-1.5 py-1 text-xs text-content-muted hover:text-content hover:bg-surface-hover transition-colors"
            aria-label="Cancel session"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
});

export default OracleSessionBanner;
