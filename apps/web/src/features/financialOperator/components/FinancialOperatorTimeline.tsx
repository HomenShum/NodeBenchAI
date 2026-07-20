import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { StepCard, type StepRecord } from "./StepCard";

interface Props {
  runId: Id<"financialOperatorRuns">;
}

const RUN_STATUS_LABELS: Record<string, string> = {
  created: "Created",
  planning: "Planning",
  running: "Running",
  awaiting_approval: "Awaiting approval",
  completed: "Completed",
  rejected: "Rejected",
  error: "Error",
};

/**
 * Live timeline: subscribes to listSteps + getRun, renders steps in
 * sequence as they land. The Convex live query auto-updates as the
 * orchestrator emits each step, so the UI streams.
 */
export function FinancialOperatorTimeline({ runId }: Props) {
  const run = useQuery(api.domains.financialOperator.runOps.getRun, { runId });
  const steps = useQuery(api.domains.financialOperator.runOps.listSteps, { runId });

  if (run === undefined || steps === undefined) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded border border-edge bg-surface/40 px-3 py-2 text-[13px] text-content-muted"
      >
        Loading run…
      </div>
    );
  }
  if (run === null) {
    return (
      <div
        role="alert"
        className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-200"
      >
        Run not found.
      </div>
    );
  }

  const sortedSteps = [...steps].sort((a, b) => a.seq - b.seq);
  const totalSteps = run.totalSteps ?? sortedSteps.length;
  const isRunning = run.status === "running" || run.status === "planning";

  return (
    <section
      aria-label="Financial workflow run timeline"
      className="space-y-3"
    >
      <header className="flex flex-wrap items-center gap-3 rounded border border-edge bg-surface/40 px-3 py-2">
        <span className="text-[11px] uppercase tracking-[0.2em] text-content-muted">
          Run
        </span>
        <span className="text-sm font-medium text-content">{run.goal}</span>
        <span className="ml-auto inline-flex items-center gap-3">
          <span className="font-mono text-[11px] text-content-muted">
            {sortedSteps.length}
            {totalSteps ? `/${totalSteps}` : ""} steps
          </span>
          <span
            className="rounded-full border border-edge bg-surface/50 px-2 py-0.5 text-[11px] text-content-secondary"
            role="status"
            aria-live="polite"
          >
            {RUN_STATUS_LABELS[run.status] ?? run.status}
          </span>
        </span>
      </header>

      {run.finalSummary && (
        <p className="rounded border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-[13px] text-emerald-50">
          {run.finalSummary}
        </p>
      )}

      <ol className="space-y-3" aria-busy={isRunning}>
        {sortedSteps.map((s) => (
          <li key={s._id}>
            <StepCard step={s as unknown as StepRecord} />
          </li>
        ))}
        {sortedSteps.length === 0 && (
          <li
            className="rounded border border-dashed border-edge bg-surface/30 px-3 py-4 text-[13px] text-content-muted"
            role="status"
          >
            Run created. Waiting for first step…
          </li>
        )}
      </ol>

      {run.errorMessage && (
        <p
          role="alert"
          className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-200"
        >
          Run error: {run.errorMessage}
        </p>
      )}
    </section>
  );
}
