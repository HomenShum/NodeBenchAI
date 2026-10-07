/**
 * LivePipelineProgress — Step indicators during search with source ticker.
 *
 * Shows which pipeline stage is running, completed steps, and a source count ticker.
 * Replaces the blank loading state with visible progress.
 */

import { memo, useMemo } from "react";
import {
  Search,
  Cpu,
  Brain,
  Package,
  CheckCircle,
  Loader2,
  Circle,
  Globe,
} from "lucide-react";

export type PipelineStep = "classifying" | "searching" | "synthesizing" | "packaging" | "complete" | "error";

interface LivePipelineProgressProps {
  currentStep: PipelineStep | null;
  traceSteps?: Array<{ step: string; status: string; detail?: string }>;
  sourceCount?: number;
  entityName?: string;
  elapsedMs?: number;
}

const STEP_ORDER: PipelineStep[] = ["classifying", "searching", "synthesizing", "packaging"];

const STEP_META: Record<PipelineStep, { label: string; icon: typeof Search; description: string }> = {
  classifying: { label: "Classify", icon: Cpu, description: "Understanding your query…" },
  searching: { label: "Search", icon: Search, description: "Finding sources…" },
  synthesizing: { label: "Analyze", icon: Brain, description: "Extracting evidence…" },
  packaging: { label: "Package", icon: Package, description: "Building your packet…" },
  complete: { label: "Complete", icon: CheckCircle, description: "Done" },
  error: { label: "Error", icon: Circle, description: "Something went wrong" },
};

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export const LivePipelineProgress = memo(function LivePipelineProgress({
  currentStep,
  traceSteps,
  sourceCount,
  entityName,
  elapsedMs,
}: LivePipelineProgressProps) {
  const stepIndex = currentStep ? STEP_ORDER.indexOf(currentStep) : -1;
  const isComplete = currentStep === "complete";
  const isError = currentStep === "error";

  const completedSteps = useMemo(() => {
    if (isComplete) return STEP_ORDER;
    if (isError || stepIndex < 0) return [];
    return STEP_ORDER.slice(0, stepIndex);
  }, [isComplete, isError, stepIndex]);

  const detailText = useMemo(() => {
    if (!traceSteps?.length) return null;
    const last = traceSteps[traceSteps.length - 1];
    return last?.detail ?? null;
  }, [traceSteps]);

  return (
    <div className="space-y-4" role="status" aria-label="Search progress">
      {/* Entity + elapsed */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {entityName ? (
            <span className="text-sm font-medium text-content">{entityName}</span>
          ) : (
            <span className="text-sm text-content-muted">Searching…</span>
          )}
        </div>
        {elapsedMs != null && elapsedMs > 0 && (
          <span className="text-xs tabular-nums text-content-muted">{formatElapsed(elapsedMs)}</span>
        )}
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-1">
        {STEP_ORDER.map((step, i) => {
          const meta = STEP_META[step];
          const isCompleted = completedSteps.includes(step) || isComplete;
          const isRunning = step === currentStep && !isComplete && !isError;
          const isPending = !isCompleted && !isRunning;

          const Icon = meta.icon;

          return (
            <div key={step} className="flex items-center gap-1">
              <div
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  isCompleted
                    ? "bg-emerald-500/10 text-emerald-400"
                    : isRunning
                      ? "bg-accent-primary/10 text-accent-primary"
                      : "bg-white/[0.03] text-content-muted/50"
                }`}
                aria-current={isRunning ? "step" : undefined}
              >
                {isCompleted ? (
                  <CheckCircle className="h-3 w-3" />
                ) : isRunning ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Icon className="h-3 w-3" />
                )}
                <span className="hidden sm:inline">{meta.label}</span>
              </div>
              {i < STEP_ORDER.length - 1 && (
                <div
                  className={`h-px w-3 transition-colors ${
                    isCompleted ? "bg-emerald-500/30" : "bg-white/[0.06]"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Current step description */}
      {currentStep && !isComplete && !isError && (
        <div className="flex items-center gap-2 text-xs text-content-muted">
          <Loader2 className="h-3 w-3 animate-spin text-accent-primary" />
          <span>{STEP_META[currentStep]?.description}</span>
          {detailText && (
            <span className="text-content-muted/60">— {detailText.slice(0, 80)}</span>
          )}
        </div>
      )}

      {/* Source count ticker */}
      {sourceCount != null && sourceCount > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-content-muted">
          <Globe className="h-3 w-3" />
          <span>{sourceCount} source{sourceCount !== 1 ? "s" : ""} found</span>
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          Search failed. Try again or refine your query.
        </div>
      )}

      <span className="sr-only">
        {isComplete ? "Search complete" : isError ? "Search failed" : `Searching, currently ${currentStep ?? "starting"}`}
      </span>
    </div>
  );
});

export default LivePipelineProgress;
