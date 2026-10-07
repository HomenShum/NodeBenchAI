"use client";

/**
 * TraceBreadcrumb Component
 *
 * Renders a visual trace of tool execution steps in either compact
 * (horizontal flow with icons) or expanded (vertical list with badges)
 * mode. Used to show agent reasoning trails in research views.
 */

import React from "react";
import { Search, Wrench, FileOutput, Flag, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

type ChoiceType = "gather_info" | "execute_data_op" | "execute_output" | "finalize";

interface TraceStep {
  toolName: string;
  choiceType: ChoiceType;
  durationMs?: number;
  success: boolean;
}

interface TraceBreadcrumbProps {
  steps: TraceStep[];
  totalDurationMs?: number;
  compact?: boolean;
  onExpand?: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const CHOICE_ICON: Record<ChoiceType, React.ComponentType<{ className?: string }>> = {
  gather_info: Search,
  execute_data_op: Wrench,
  execute_output: FileOutput,
  finalize: Flag,
};

const CHOICE_BADGE_STYLES: Record<ChoiceType, string> = {
  gather_info: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  execute_data_op: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  execute_output: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  finalize: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};

const CHOICE_LABELS: Record<ChoiceType, string> = {
  gather_info: "Gather",
  execute_data_op: "Data Op",
  execute_output: "Output",
  finalize: "Finalize",
};

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPACT VIEW
// ═══════════════════════════════════════════════════════════════════════════

function CompactView({ steps, totalDurationMs, onExpand }: Omit<TraceBreadcrumbProps, "compact">) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className={cn(
        "flex items-center gap-1 py-1 px-2 rounded-md",
        "hover:bg-surface-hover dark:hover:bg-gray-800/50 transition-colors",
        onExpand && "cursor-pointer"
      )}
      disabled={!onExpand}
      aria-label="Expand trace breadcrumb"
    >
      {steps.map((step, idx) => {
        const Icon = CHOICE_ICON[step.choiceType];
        const isLast = idx === steps.length - 1;

        return (
          <React.Fragment key={`${step.toolName}-${idx}`}>
            {/* Step: icon + label */}
            <div className="flex flex-col items-center gap-0.5">
              <Icon
                className={cn(
                  "w-4 h-4",
                  step.success
                    ? "text-content-secondary"
                    : "text-red-500 dark:text-red-400"
                )}
              />
              <span
                className={cn(
                  "text-xs leading-none max-w-[60px] truncate",
                  step.success
                    ? "text-content-secondary"
                    : "text-red-500 dark:text-red-400"
                )}
                title={step.toolName}
              >
                {step.toolName}
              </span>
            </div>

            {/* Arrow between steps */}
            {!isLast && (
              <ChevronRight className="w-3 h-3 text-gray-300 dark:text-content-secondary flex-shrink-0" />
            )}
          </React.Fragment>
        );
      })}

      {/* Total duration badge */}
      {totalDurationMs !== undefined && (
        <span className="ml-2 text-xs font-mono text-content-muted flex-shrink-0">
          {formatDuration(totalDurationMs)}
        </span>
      )}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPANDED VIEW
// ═══════════════════════════════════════════════════════════════════════════

function ExpandedView({ steps, totalDurationMs }: Omit<TraceBreadcrumbProps, "compact" | "onExpand">) {
  return (
    <div className="space-y-2">
      {steps.map((step, idx) => {
        const Icon = CHOICE_ICON[step.choiceType];

        return (
          <div
            key={`${step.toolName}-${idx}`}
            className={cn(
              "flex items-center gap-3 py-2 px-3 rounded-lg",
              "bg-surface-secondary dark:bg-gray-800/30",
              !step.success && "border border-red-200 dark:border-red-800/50"
            )}
          >
            {/* Step number */}
            <span className="text-xs font-mono text-content-muted w-4 text-right flex-shrink-0">
              {idx + 1}
            </span>

            {/* Icon */}
            <Icon
              className={cn(
                "w-4 h-4 flex-shrink-0",
                step.success
                  ? "text-content-secondary"
                  : "text-red-500 dark:text-red-400"
              )}
            />

            {/* Tool name */}
            <span
              className={cn(
                "text-sm flex-1 min-w-0 truncate",
                step.success
                  ? "text-content"
                  : "text-red-600 dark:text-red-400"
              )}
              title={step.toolName}
            >
              {step.toolName}
            </span>

            {/* Choice type badge */}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0",
                CHOICE_BADGE_STYLES[step.choiceType]
              )}
            >
              {CHOICE_LABELS[step.choiceType]}
            </span>

            {/* Duration */}
            {step.durationMs !== undefined && (
              <span className="text-xs font-mono text-content-muted flex-shrink-0 min-w-[40px] text-right">
                {formatDuration(step.durationMs)}
              </span>
            )}

            {/* Status indicator */}
            {!step.success && (
              <span className="text-xs text-red-500 dark:text-red-400 font-medium flex-shrink-0">
                FAIL
              </span>
            )}
          </div>
        );
      })}

      {/* Total duration footer */}
      {totalDurationMs !== undefined && (
        <div className="flex justify-end pt-1 border-t border-edge dark:border-edge">
          <span className="text-xs font-mono text-content-muted">
            Total: {formatDuration(totalDurationMs)}
          </span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TRACE BREADCRUMB
// ═══════════════════════════════════════════════════════════════════════════

export function TraceBreadcrumb({
  steps,
  totalDurationMs,
  compact = true,
  onExpand,
}: TraceBreadcrumbProps) {
  if (!steps || steps.length === 0) {
    return null;
  }

  if (compact) {
    return <CompactView steps={steps} totalDurationMs={totalDurationMs} onExpand={onExpand} />;
  }

  return <ExpandedView steps={steps} totalDurationMs={totalDurationMs} />;
}

export default TraceBreadcrumb;
