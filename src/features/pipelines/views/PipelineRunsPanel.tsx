/**
 * Pipeline Runs Panel
 *
 * Shows recent server-side research work on the Reports surface. Copy stays
 * product-facing; implementation details remain in the backend and tests.
 */

import React, { useMemo, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { useStableQuery } from "@/hooks/useStableQuery";
import { useWindowedList } from "@/lib/performance/useWindowedList";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import {
  Cpu,
  AlertCircle,
  CheckCircle2,
  Loader2,
  FileText,
  Download,
  Image as ImageIcon,
  ChevronDown,
  ChevronRight,
  Radio,
} from "lucide-react";

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
    label: "Completed",
    className: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30",
    Icon: CheckCircle2,
  },
  failed: {
    label: "Needs attention",
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
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return "-";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

function formatDuration(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatKind(kind: string): string {
  if (kind === "research") return "research bundle";
  if (kind === "code_gen") return "code starter";
  if (kind === "design_gen") return "design brief";
  if (kind === "custom") return "custom run";
  return kind.replaceAll("_", " ");
}

function formatVerdict(verdict: string): string {
  if (verdict === "provisionally_verified") return "partly verified";
  if (verdict === "needs_review") return "needs review";
  if (verdict === "in_progress") return "in progress";
  return verdict.replaceAll("_", " ");
}

function formatRunTitle(title: string): string {
  const cleaned = title
    .replace(/^original\s+spec:\s*/i, "")
    .replace(/^spec:\s*/i, "")
    .trim();
  return cleaned || "Research run";
}

const PipelineRunStreamPreview: React.FC<{
  runId: string;
  anonymousSessionId: string;
  runStatus: string;
}> = ({ runId, anonymousSessionId, runStatus }) => {
  const stream = useStableQuery(
    api.domains.pipelines.pipelineStreamMutations.getPipelineStream,
    { runId, anonymousSessionId },
  );
  if (stream === undefined) {
    return (
      <div
        data-testid="pipeline-run-stream-loading"
        className="text-[11px] text-content-muted"
      >
        Loading live output...
      </div>
    );
  }
  if (stream === null) {
    return (
      <div
        data-testid="pipeline-run-stream-empty"
        className="text-[11px] text-content-muted"
      >
        {runStatus === "running" ? "Waiting for streamed output." : "No streamed output was recorded."}
      </div>
    );
  }
  const isLive = stream.status === "streaming";
  return (
    <div
      data-testid="pipeline-run-stream"
      data-pipeline-stream-status={stream.status}
      className="rounded-md bg-surface/60 border border-edge/40 px-3 py-2 space-y-1.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-content-muted">
          <Radio
            className={`w-3 h-3 ${
              isLive ? "text-emerald-500 animate-pulse" : "text-content-muted"
            }`}
          />
          {stream.stepName} - {stream.status}
          {stream.errorMessage ? ` - ${stream.errorMessage}` : ""}
        </span>
        <span className="text-[10px] text-content-muted">
          {stream.partialText.length.toLocaleString()} chars
        </span>
      </div>
      <pre
        data-testid="pipeline-run-stream-text"
        className="whitespace-pre-wrap break-words text-[11px] text-content max-h-64 overflow-y-auto font-mono leading-snug"
      >
        {stream.partialText.length > 0
          ? stream.partialText.slice(0, 4000) +
            (stream.partialText.length > 4000 ? "\n\n[truncated]" : "")
          : "(waiting for first update)"}
      </pre>
    </div>
  );
};

type PipelineRunsPanelProps = {
  queryLimit?: number;
  initialVisibleCount?: number;
  windowStep?: number;
};

export const PipelineRunsPanel: React.FC<PipelineRunsPanelProps> = ({
  queryLimit = 24,
  initialVisibleCount = 8,
  windowStep = 8,
}) => {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const anonymousSessionId = useMemo(() => getAnonymousProductSessionId(), []);
  const runs = useStableQuery(
    api.domains.pipelines.pipelineRunsQueries.listRecentRuns,
    { limit: queryLimit, ownerKey: `session:${anonymousSessionId}` },
  );
  const stats = useStableQuery(
    api.domains.pipelines.pipelineRunsQueries.getRunSummaryStats,
    {},
  );

  const safeRuns = useMemo(() => runs ?? [], [runs]);
  const { visibleItems: visibleRuns, remainingCount, hasMore, showMore } = useWindowedList({
    items: safeRuns,
    initialCount: initialVisibleCount,
    step: windowStep,
  });

  if (runs === undefined) {
    return (
      <section
        data-testid="pipeline-runs-panel"
        className="nb-surface-card p-4 text-xs text-content-muted"
      >
        Loading research runs...
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
            <h3 className="text-sm font-semibold text-content">Background runs &amp; exports</h3>
            <p className="text-[11px] text-content-muted">
              Runtime progress and downloadable output stay together here.
            </p>
          </div>
        </header>
        <p className="text-xs text-content-muted">
          No runs yet. Start one above; it will keep running if you leave this page.
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="pipeline-runs-panel"
      aria-label="Background runs and exports"
      className="nb-surface-card p-4 space-y-3"
    >
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-amber-500/15 flex items-center justify-center">
            <Cpu className="w-4 h-4 text-amber-600 dark:text-amber-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-content">Background runs &amp; exports</h3>
            <p className="text-[11px] text-content-muted">
              Runtime progress, review status, and available exports.
            </p>
          </div>
        </div>
        {stats ? (
          <div className="flex items-center gap-3 text-[11px] text-content-muted">
            <span data-testid="pipeline-stat-succeeded">
              <span className="text-emerald-700 dark:text-emerald-300 font-medium">
                {stats.succeeded}
              </span>{" "}
              completed
            </span>
            <span data-testid="pipeline-stat-failed">
              <span className="text-red-700 dark:text-red-300 font-medium">{stats.failed}</span>{" "}
              failed
            </span>
            <span data-testid="pipeline-stat-cost">
              {formatUsd(stats.totalEstimatedUsd)} estimated
            </span>
            <span data-testid="pipeline-stat-window">
              showing {visibleRuns.length} / {safeRuns.length}
            </span>
          </div>
        ) : null}
      </header>

      <ul data-testid="pipeline-run-list" className="space-y-2">
        {visibleRuns.map((run) => {
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
                  <span className="truncate">{formatRunTitle(run.title)}</span>
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
                <span>{formatKind(run.pipelineKind)}</span>
                <span>-</span>
                <span>{run.stepCount} steps</span>
                <span>-</span>
                <span>{formatDuration(run.durationMs)}</span>
                <span>-</span>
                <span>{formatUsd(run.estimatedUsd)}</span>
                <span>-</span>
                <span>{formatRelative(run.createdAt)}</span>
                {run.verdict ? (
                  <>
                    <span>-</span>
                    <span className={verdictBadge[run.verdict] ?? ""}>{formatVerdict(run.verdict)}</span>
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
              {expandedRunId === run.runId ? (
                <PipelineRunStreamPreview
                  runId={run.runId}
                  anonymousSessionId={anonymousSessionId}
                  runStatus={run.status}
                />
              ) : null}
              {run.hasStream || run.status === "running" ? <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  data-testid="pipeline-run-toggle"
                  onClick={() =>
                    setExpandedRunId((prev) => (prev === run.runId ? null : run.runId))
                  }
                  className="inline-flex items-center gap-1 text-[11px] text-content-muted hover:text-content"
                >
                  {expandedRunId === run.runId ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  {expandedRunId === run.runId
                    ? "Hide streamed output"
                    : run.status === "running"
                      ? "Follow live output"
                      : "Show streamed output"}
                </button>
              </div> : null}
              {run.bundleUrl || run.imageUrl ? (
                <div className="flex items-center gap-3 pt-1">
                  {run.imageUrl ? (
                    <a
                      data-testid="pipeline-run-image"
                      href={run.imageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-300 hover:underline"
                    >
                      <ImageIcon className="w-3 h-3" />
                      View image
                    </a>
                  ) : null}
                  {run.bundleUrl ? (
                    <a
                      data-testid="pipeline-run-bundle"
                      href={run.bundleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      download={`pipeline-${run.runId}.json`}
                      className="inline-flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-300 hover:underline"
                    >
                      <Download className="w-3 h-3" />
                      Download bundle
                    </a>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {hasMore ? (
        <button
          type="button"
          data-testid="pipeline-run-show-more"
          onClick={showMore}
          className="inline-flex items-center justify-center rounded-md border border-edge px-3 py-1.5 text-[11px] font-medium text-content-muted hover:bg-surface-hover"
        >
          Show {Math.min(windowStep, remainingCount)} more run{remainingCount === 1 ? "" : "s"}
        </button>
      ) : null}
    </section>
  );
};

export default PipelineRunsPanel;
