/**
 * PipelineSchedulesPanel
 *
 * Lists saved automatic refreshes. These rows are backed by scheduled
 * pipeline runs, but the UI describes the user-facing refresh workflow.
 */

import React from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useWindowedList } from "@/lib/performance/useWindowedList";
import {
  Calendar,
  Pause,
  Play,
  Trash2,
} from "lucide-react";

interface ScheduleRow {
  _id: Id<"scheduledPipelineRuns">;
  pipelineKind: string;
  spec: string;
  title?: string;
  modelId: string;
  cadence: string;
  enabled: boolean;
  nextRunAt: number;
  lastRunAt?: number;
  lastRunId?: string;
  lastStatus?: string;
  options?: any;
  createdAt: number;
}

function formatRelative(ms: number): string {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60_000);
  if (m < 1) return diff > 0 ? "in <1 min" : "<1 min ago";
  if (m < 60) return diff > 0 ? `in ${m} min` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return diff > 0 ? `in ${h}h` : `${h}h ago`;
  const d = Math.round(h / 24);
  return diff > 0 ? `in ${d}d` : `${d}d ago`;
}

function formatKind(kind: string): string {
  if (kind === "research") return "research";
  if (kind === "code_gen") return "code starter";
  if (kind === "design_gen") return "design brief";
  return kind.replaceAll("_", " ");
}

type PipelineSchedulesPanelProps = {
  queryLimit?: number;
  initialVisibleCount?: number;
  windowStep?: number;
};

export const PipelineSchedulesPanel: React.FC<PipelineSchedulesPanelProps> = ({
  queryLimit = 25,
  initialVisibleCount = 6,
  windowStep = 6,
}) => {
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const schedules = useQuery(
    api.domains.pipelines.pipelineSchedule.listSchedules,
    isAuthenticated ? { limit: queryLimit } : "skip",
  ) as ScheduleRow[] | undefined;
  const setEnabled = useMutation(
    api.domains.pipelines.pipelineSchedule.setScheduleEnabled,
  );
  const deleteSchedule = useMutation(
    api.domains.pipelines.pipelineSchedule.deleteSchedule,
  );
  const safeSchedules = schedules ?? [];
  const { visibleItems: visibleSchedules, remainingCount, hasMore, showMore } = useWindowedList({
    items: safeSchedules,
    initialCount: initialVisibleCount,
    step: windowStep,
  });

  if (isAuthLoading || !isAuthenticated) return null;

  if (schedules === undefined) {
    return (
      <section
        data-testid="pipeline-schedules-panel"
        className="nb-surface-card p-4 text-xs text-content-muted"
      >
        Loading automatic refreshes...
      </section>
    );
  }

  if (schedules.length === 0) {
    return (
      <section
        data-testid="pipeline-schedules-empty"
        className="nb-surface-card p-4 space-y-2"
      >
        <header className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-blue-500/15 flex items-center justify-center">
            <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-content">Automatic refreshes</h3>
            <p className="text-[11px] text-content-muted">
              Saved refreshes appear here. None are scheduled yet.
            </p>
          </div>
        </header>
        <p className="text-xs text-content-muted">
          Create one from Advanced controls when you want NodeBench to re-check a topic.
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="pipeline-schedules-panel"
      aria-label="Automatic refreshes"
      className="nb-surface-card p-4 space-y-3"
    >
      <header className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-md bg-blue-500/15 flex items-center justify-center">
          <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-300" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-content">Automatic refreshes</h3>
          <p className="text-[11px] text-content-muted">
            Scheduler polls hourly; each refresh follows its cadence - {schedules.filter((s) => s.enabled).length} active -{" "}
            showing {visibleSchedules.length} / {schedules.length}
          </p>
        </div>
      </header>
      <ul data-testid="pipeline-schedule-list" className="space-y-2">
        {visibleSchedules.map((row) => (
          <li
            key={row._id}
            data-testid="pipeline-schedule-row"
            data-enabled={row.enabled ? "1" : "0"}
            className="rounded-md border border-edge/60 px-3 py-2 text-xs space-y-1"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-content font-medium truncate max-w-[55%]">
                {row.title ?? row.spec.slice(0, 60)}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-content-muted">
                {formatKind(row.pipelineKind)} - {row.cadence}
                {row.enabled ? (
                  <span className="text-emerald-700 dark:text-emerald-300">active</span>
                ) : (
                  <span className="text-content-muted">paused</span>
                )}
              </span>
            </div>
            <div className="text-[11px] text-content-muted">
              Next run {formatRelative(row.nextRunAt)}
              {row.lastRunAt
                ? ` - last started ${formatRelative(row.lastRunAt)}`
                : " - not started yet"}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                data-testid="pipeline-schedule-toggle"
                onClick={() =>
                  setEnabled({
                    scheduleId: row._id,
                    enabled: !row.enabled,
                  })
                }
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] ${
                  row.enabled
                    ? "border-edge text-content-muted hover:bg-surface-hover"
                    : "border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
                }`}
              >
                {row.enabled ? (
                  <>
                    <Pause className="w-3 h-3" /> Pause
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3" /> Resume
                  </>
                )}
              </button>
              <button
                type="button"
                data-testid="pipeline-schedule-delete"
                onClick={() => {
                  if (
                    typeof window !== "undefined" &&
                    !window.confirm(
                      `Delete automatic refresh "${row.title ?? row.spec.slice(0, 40)}"? This cannot be undone.`,
                    )
                  ) {
                    return;
                  }
                  deleteSchedule({ scheduleId: row._id });
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-edge text-[11px] text-red-700 dark:text-red-300 hover:bg-red-500/10"
              >
                <Trash2 className="w-3 h-3" /> Delete
              </button>
              {row.lastStatus === "kicked" ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-300">
                  <Play className="w-3 h-3" /> run started
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {hasMore ? (
        <button
          type="button"
          data-testid="pipeline-schedule-show-more"
          onClick={showMore}
          className="inline-flex items-center justify-center rounded-md border border-edge px-3 py-1.5 text-[11px] font-medium text-content-muted hover:bg-surface-hover"
        >
          Show {Math.min(windowStep, remainingCount)} more refresh
          {remainingCount === 1 ? "" : "es"}
        </button>
      ) : null}
    </section>
  );
};

export default PipelineSchedulesPanel;
