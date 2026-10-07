/**
 * TrajectoryPanel — Agent execution path visualization.
 *
 * Shows every tool call in a search query's execution as a vertical timeline.
 * Each step: tool name, latency, status (pass/fail/pending/skipped), input summary,
 * output preview. Expandable for full I/O. Color-coded status indicators.
 *
 * Starts collapsed. Expands on click. Shows aggregate stats at the top.
 */

import { memo, useCallback, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Clock,
  Hash,
  Layers,
  Zap,
} from "lucide-react";
import type { TrajectoryData, TrajectoryStep, TrajectoryStepStatus } from "./types";

/* ─── Status colors ──────────────────────────────────────────────────────── */

const STATUS_CONFIG: Record<
  TrajectoryStepStatus,
  { dot: string; bg: string; label: string }
> = {
  pass: {
    dot: "bg-emerald-400",
    bg: "border-emerald-500/20 bg-emerald-500/[0.03]",
    label: "Pass",
  },
  fail: {
    dot: "bg-rose-400",
    bg: "border-rose-500/20 bg-rose-500/[0.03]",
    label: "Fail",
  },
  pending: {
    dot: "bg-amber-400 animate-pulse",
    bg: "border-amber-500/20 bg-amber-500/[0.03]",
    label: "Pending",
  },
  skipped: {
    dot: "bg-zinc-500",
    bg: "border-zinc-500/10 bg-zinc-500/[0.02]",
    label: "Skipped",
  },
};

/* ─── Latency badge ──────────────────────────────────────────────────────── */

function LatencyBadge({ ms }: { ms: number }) {
  const color =
    ms < 200
      ? "text-emerald-400"
      : ms < 1000
        ? "text-amber-400"
        : "text-rose-400";
  const display = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  return (
    <span className={`font-mono text-[10px] tabular-nums ${color}`}>
      {display}
    </span>
  );
}

/* ─── Single step row ────────────────────────────────────────────────────── */

interface StepRowProps {
  step: TrajectoryStep;
  index: number;
  isLast: boolean;
}

const StepRow = memo(function StepRow({ step, index, isLast }: StepRowProps) {
  const [expanded, setExpanded] = useState(false);
  const config = STATUS_CONFIG[step.status];

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  return (
    <div className="relative flex gap-3">
      {/* Timeline spine */}
      <div className="flex flex-col items-center w-5 shrink-0">
        <div className={`h-2.5 w-2.5 rounded-full ${config.dot} ring-2 ring-white/[0.06] shrink-0 mt-1.5`} />
        {!isLast && <div className="flex-1 w-px bg-white/[0.06] mt-1" />}
      </div>

      {/* Step card */}
      <div className={`flex-1 min-w-0 mb-2 rounded-lg border ${config.bg} transition-all`}>
        <button
          type="button"
          onClick={toggle}
          className="flex w-full items-center gap-2 px-3 py-2 text-left"
          aria-expanded={expanded}
        >
          <span className="text-[10px] font-mono tabular-nums text-white/30 w-4 shrink-0">
            {index + 1}
          </span>
          <span className="font-mono text-xs text-[#d97757] truncate font-medium">
            {step.toolName}
          </span>
          {step.domain && (
            <span className="text-[9px] rounded bg-white/[0.05] px-1.5 py-0.5 text-white/30 uppercase tracking-wider shrink-0">
              {step.domain}
            </span>
          )}
          <span className="flex-1" />
          <LatencyBadge ms={step.latencyMs} />
          <span className="text-white/20 transition-transform" aria-hidden>
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </span>
        </button>

        {/* Summary line (always visible) */}
        <div className="px-3 pb-2 -mt-0.5">
          <p className="text-[11px] text-white/50 truncate">{step.inputSummary}</p>
          {step.outputPreview && (
            <p className="text-[11px] text-white/35 truncate mt-0.5">
              &rarr; {step.outputPreview}
            </p>
          )}
        </div>

        {/* Expanded detail */}
        {expanded && (
          <div className="border-t border-white/[0.04] px-3 py-2.5 space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
            {step.tokenEstimate != null && (
              <div className="text-[10px] text-white/30">
                ~{step.tokenEstimate.toLocaleString()} tokens
              </div>
            )}
            <div>
              <div className="text-[10px] uppercase tracking-[0.15em] text-white/25 mb-1">
                Input
              </div>
              <pre className="font-mono text-[10px] text-white/60 bg-black/20 rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap">
                {step.inputFull
                  ? JSON.stringify(step.inputFull, null, 2)
                  : step.inputSummary}
              </pre>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.15em] text-white/25 mb-1">
                Output
              </div>
              <pre className="font-mono text-[10px] text-white/60 bg-black/20 rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap">
                {step.outputFull
                  ? JSON.stringify(step.outputFull, null, 2)
                  : step.outputPreview}
              </pre>
            </div>
            <div className="text-[10px] text-white/20">
              {new Date(step.timestamp).toLocaleTimeString()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

/* ─── Aggregate stat pill ────────────────────────────────────────────────── */

function StatPill({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
      <Icon className="h-3 w-3 text-white/30" />
      <span className="text-[10px] text-white/40">{label}</span>
      <span className="font-mono text-xs font-semibold text-white/80 tabular-nums">
        {value}
      </span>
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */

export interface TrajectoryPanelProps {
  data: TrajectoryData;
  /** Start collapsed (default: true) */
  defaultCollapsed?: boolean;
  className?: string;
}

export const TrajectoryPanel = memo(function TrajectoryPanel({
  data,
  defaultCollapsed = true,
  className = "",
}: TrajectoryPanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const passCount = data.steps.filter((s) => s.status === "pass").length;
  const failCount = data.steps.filter((s) => s.status === "fail").length;
  const latencyDisplay =
    data.totalLatencyMs < 1000
      ? `${data.totalLatencyMs}ms`
      : `${(data.totalLatencyMs / 1000).toFixed(1)}s`;
  const tokenDisplay =
    data.totalTokenEstimate > 1000
      ? `${(data.totalTokenEstimate / 1000).toFixed(1)}K`
      : `${data.totalTokenEstimate}`;

  return (
    <div
      className={`rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden ${className}`}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2.5 px-5 py-4 text-left transition-colors hover:bg-white/[0.02]"
        aria-expanded={!collapsed}
      >
        <Activity className="h-4 w-4 shrink-0 text-[#d97757]" aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40 flex-1">
          Agent Trajectory
        </span>
        {/* Inline success/fail indicator */}
        <span className="flex items-center gap-1.5 text-[10px]">
          <span className="text-emerald-400">{passCount} pass</span>
          {failCount > 0 && (
            <span className="text-rose-400">{failCount} fail</span>
          )}
        </span>
        <span
          className={`text-white/30 transition-transform text-xs ${collapsed ? "" : "rotate-180"}`}
          aria-hidden
        >
          &#9662;
        </span>
      </button>

      {!collapsed && (
        <div className="border-t border-white/[0.06] px-5 py-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Aggregate stats row */}
          <div className="flex flex-wrap gap-2">
            <StatPill icon={Clock} label="Latency" value={latencyDisplay} />
            <StatPill icon={Hash} label="Tools" value={String(data.toolCount)} />
            <StatPill icon={Layers} label="Steps" value={String(data.steps.length)} />
            <StatPill icon={Zap} label="Tokens" value={tokenDisplay} />
          </div>

          {/* Timeline */}
          <div>
            {data.steps.map((step, i) => (
              <StepRow
                key={step.id}
                step={step}
                index={i}
                isLast={i === data.steps.length - 1}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between text-[10px] text-white/20 pt-1 border-t border-white/[0.04]">
            <span>
              Started {new Date(data.startedAt).toLocaleTimeString()}
            </span>
            {data.completedAt && (
              <span>
                Completed {new Date(data.completedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default TrajectoryPanel;
