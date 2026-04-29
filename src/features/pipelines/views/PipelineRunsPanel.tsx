/**
 * Pipeline Runs Panel
 *
 * Surfaces the most recent pi-ai pipeline runs on the Reports surface.
 * Each row shows status, verdict, model, tokens + estimated USD, and a
 * step count. Mirrors the look of EntityFindingsPanel — both are
 * cheap-retrieval substrates over Convex queries.
 */

import React, { useMemo } from "react";
import { api } from "../../../../convex/_generated/api";
import { useStableQuery } from "@/hooks/useStableQuery";
import { Cpu, AlertCircle, CheckCircle2, Loader2, FileText } from "lucide-react";

const statusBadge: Record<string, { label: string; className: string; Icon: any }> = {
  queued: {
    label: "Queued",
    className: "text-content-muted bg-surface border border-edge",
    Icon: Loader2,
  },
  running: {
    label: "Running",
    className: "text-blue-700 dark:text-blue-300 bg-blue-500/10 border border-blue-500/30",
    Icon: Loader2,
  },
  succeeded: {
    label: "Succeeded",
    className: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30",
    Icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    className: "text-red-700 dark:text-red-300 bg-red-500/10 border border-red-500/30",
    Icon: AlertCircle,
  },
  cancelled: {
    label: "Cancelled",
    className: "text-content-muted bg-surface border border-edge",
    Icon: AlertCircle,
  },
};

const verdictBadge: Record<string, string> = {
  verified: "text-emerald-700 dark:text-emerald-300",
  provisionally_verified: "text-amber-700 dark:text-amber-300",
  needs_review: "text-amber-700 dark:text-amber-300",
  failed: "text-red-700 dark:text-red-300",
  in_progress: "text-blue-700 dark:text-blue-300",
};

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function formatUsd(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return "—";
  if (n < 0.01) return `<$0.01`;
  return `$${n.toFixed(2)}`;
}

function formatDuration(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const PipelineRunsPanel: React.FC = () => {
  const runs = useStableQuery(
    api.domains.pipelines.pipelineRunsQueries.listRecentRuns,
    { limit: 8 },
  );
  const stats = useStableQuery(
    api.domains.pipelines.pipelineRunsQueries.getRunSummaryStats,
    {},
  );

  const safeRuns = useMemo(() => runs ?? [], [runs]);

  if (runs === undefined) {
    return (
      <section
        data-testid="pipeline-runs-panel"
        className="nb-surface-card p-4 text-xs text-content-muted"
      >
        Loading pipeline runs…
      </section>
    );
  }

  if (safeRuns.length === 0) {
    return (
      <section
        data-testid="pipeline-runs-empty"
        className="nb-surface-card p-4 space-y-2"
      >
        <header className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-amber-500/15 flex items-center justify-center">
            <Cpu className="w-4 h-4 text-amber-600 dark:text-amber-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-content">Pipeline runs</h3>
            <p className="text-[11px] text-content-muted">
              Pi-AI code-gen / design-gen / research runs land here.
            </p>
          </div>
        </header>
        <p className="text-xs text-content-muted">
          No runs yet. Trigger one via{" "}
          <code className="text-[11px]">
            npx convex run domains/pipelines/codeGenPipeline:runCodeGenPipeline
            '{"{\"spec\": \"...\"}"}'
          </code>
          .
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="pipeline-runs-panel"
      aria-label="Pi-AI pipeline runs"
      className="nb-surface-card p-4 space-y-3"
    >
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-amber-500/15 flex items-center justify-center">
            <Cpu className="w-4 h-4 text-amber-600 dark:text-amber-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-content">Pipeline runs</h3>
            <p className="text-[11px] text-content-muted">
              Pi-AI orchestrated runs · cost + verdict tracked
            </p>
          </div>
        </div>
        {stats ? (
          <div className="flex items-center gap-3 text-[11px] text-content-muted">
            <span data-testid="pipeline-stat-succeeded">
              <span className="text-emerald-700 dark:text-emerald-300 font-medium">
                {stats.succeeded}
              </span>{" "}
              succeeded
            </span>
            <span data-testid="pipeline-stat-failed">
              <span className="text-red-700 dark:text-red-300 font-medium">{stats.failed}</span>{" "}
              failed
            </span>
            <span data-testid="pipeline-stat-cost">
              {formatUsd(stats.totalEstimatedUsd)} spent
            </span>
          </div>
        ) : null}
      </header>

      <ul data-testid="pipeline-run-list" className="space-y-2">
        {safeRuns.map((run) => {
          const badge = statusBadge[run.status] ?? statusBadge.queued;
          const Icon = badge.Icon;
          return (
            <li
              key={run._id}
              data-testid="pipeline-run-row"
              data-pipeline-status={run.status}
              data-pipeline-verdict={run.verdict ?? "unknown"}
              className="rounded-md border border-edge/60 px-3 py-2 text-xs space-y-1"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="inline-flex items-center gap-2 font-medium text-content truncate max-w-[55%]">
                  <FileText className="w-3.5 h-3.5 text-content-muted" />
                  <span className="truncate">{run.title}</span>
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${badge.className}`}
                >
                  <Icon
                    className={`w-3 h-3 ${run.status === "running" ? "animate-spin" : ""}`}
                  />
                  {badge.label}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-content-muted flex-wrap">
                <span>{run.pipelineKind.replace("_", " ")}</span>
                <span>·</span>
                <span>{run.modelId}</span>
                <span>·</span>
                <span>{run.stepCount} steps</span>
                <span>·</span>
                <span>{formatDuration(run.durationMs)}</span>
                <span>·</span>
                <span>{formatUsd(run.estimatedUsd)}</span>
                <span>·</span>
                <span>{formatRelative(run.createdAt)}</span>
                {run.verdict ? (
                  <>
                    <span>·</span>
                    <span className={verdictBadge[run.verdict] ?? ""}>{run.verdict}</span>
                  </>
                ) : null}
              </div>
              {run.errorMessage ? (
                <p
                  data-testid="pipeline-run-error"
                  className="text-[11px] text-red-600 dark:text-red-300 line-clamp-2"
                >
                  {run.errorMessage}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default PipelineRunsPanel;
