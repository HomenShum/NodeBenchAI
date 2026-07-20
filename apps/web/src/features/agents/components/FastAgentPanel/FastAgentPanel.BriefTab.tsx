// Daily Brief domain memory tab for FastAgentPanel

import React from "react";
import {
  useAction,
  useConvexAuth,
  useQuery,
} from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import {
  CheckCircle2,
  Circle,
  AlertCircle,
  Loader2,
  Play,
  RefreshCcw,
  ChevronLeft,
  ChevronRight,
  Calendar,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useBriefDateSelection } from "@/lib/useBriefDateSelection";
import { formatBriefDate } from "@/lib/briefDate";
import { buttonDanger, buttonIcon, buttonSecondary } from "@/lib/buttonClasses";

type BriefStatus = "pending" | "failing" | "passing";

function statusIcon(status: BriefStatus) {
  if (status === "passing") {
    return <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />;
  }
  if (status === "failing") {
    return <AlertCircle className="w-3.5 h-3.5 text-red-600" />;
  }
  return <Circle className="w-3.5 h-3.5 text-content-muted" />;
}

function TaskCard({
  task,
  resultMarkdown,
  isPersonal,
  onRetry,
  retryDisabled,
  queuePosition,
  isNextUp,
}: {
  task: any;
  resultMarkdown?: string;
  isPersonal?: boolean;
  onRetry?: () => void;
  retryDisabled?: boolean;
  queuePosition?: number | null;
  isNextUp?: boolean;
}) {
  const friendlyNotes =
    typeof task.notes === "string" &&
    /insufficient output|no meaningful output/i.test(task.notes)
      ? "AI response was too short to validate. Try Retry."
      : task.notes;

  return (
    <div
      className={cn(
        "p-2 rounded-lg border bg-surface-secondary",
        task.status === "failing" && "border-red-300 bg-red-50",
        task.status !== "failing" && "border-edge",
        task.status === "passing" && "opacity-80",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5">{statusIcon(task.status)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-content line-clamp-2">
              {task.name}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-surface-secondary text-content">
              {task.type}
            </span>
            {isPersonal && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                Personal
              </span>
            )}
            {queuePosition && (
              <span
                className={cn(
                  "ml-auto text-xs px-1.5 py-0.5 rounded border",
                  isNextUp
                    ? "bg-[var(--accent-primary)] text-white border-[var(--accent-primary)]"
                    : "bg-surface text-content-secondary border-edge",
                )}
              >
                {isNextUp ? "Next up" : `#${queuePosition}`}
              </span>
            )}
          </div>
          <p className="text-xs text-content-secondary mt-0.5 line-clamp-2">
            {task.testCriteria}
          </p>

          {friendlyNotes && (
            <p
              className={cn(
                "text-xs mt-1",
                task.status === "failing" ? "text-red-700" : "text-content-secondary",
              )}
            >
              {task.status === "failing" ? "Issue: " : "Notes: "}
              {friendlyNotes}
            </p>
          )}

          {resultMarkdown && (
            <div className="mt-2 text-xs text-content whitespace-pre-wrap line-clamp-6">
              {resultMarkdown}
            </div>
          )}

          {task.status === "failing" && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retryDisabled}
              className={cn(
                "mt-2 gap-1 px-2 py-1 text-xs font-medium",
                retryDisabled
                  ? "bg-surface-hover text-content-muted border-edge cursor-not-allowed"
                  : buttonDanger,
              )}
            >
              <RefreshCcw className="w-3 h-3" />
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function BriefTab() {
  const { isAuthenticated } = useConvexAuth();
  const [selectedDate, setSelectedDate] = useBriefDateSelection();

  // Pull same 7-day date list as LiveDashboard for sync.
  const historicalSnapshots = useQuery(
    api.domains.research.dashboardQueries.getHistoricalSnapshots,
    { days: 7 },
  );
  const availableDates = React.useMemo(() => {
    if (!historicalSnapshots) return [];
    // Deduplicate dates using Set to avoid duplicate key errors
    const uniqueDates = [...new Set(historicalSnapshots.map((s) => s.dateString))];
    return uniqueDates.sort().reverse();
  }, [historicalSnapshots]);

  const latestMemory = useQuery(
    api.domains.research.dailyBriefMemoryQueries.getLatestMemory,
    selectedDate ? "skip" : {},
  );
  const dateMemory = useQuery(
    api.domains.research.dailyBriefMemoryQueries.getMemoryByDateString,
    selectedDate ? { dateString: selectedDate } : "skip",
  );
  const memory = selectedDate ? dateMemory : latestMemory;

  const results = useQuery(
    memory
      ? api.domains.research.dailyBriefMemoryQueries.listTaskResultsByMemory
      : "skip",
    memory ? { memoryId: memory._id } : "skip",
  );

  const overlay = useQuery(
    memory
      ? api.domains.research.dailyBriefPersonalOverlayQueries.getOverlay
      : "skip",
    memory ? { memoryId: memory._id } : "skip",
  );

  const ensureOverlay = useAction(
    api.domains.research.dailyBriefPersonalOverlay.ensurePersonalOverlay,
  );
  const runNextGlobalTask = useAction(
    api.domains.research.dailyBriefWorker.runNextTask,
  );
  const runNextPersonalTask = useAction(
    api.domains.research.dailyBriefPersonalOverlay.runNextPersonalTask,
  );

  const [isRunning, setIsRunning] = React.useState(false);
  const [runAllProgress, setRunAllProgress] = React.useState<{ current: number; total: number } | null>(null);

  // Lazily create per-user overlay when missing.
  React.useEffect(() => {
    if (!isAuthenticated || !memory) return;
    if (overlay === null) {
      ensureOverlay({ memoryId: memory._id }).catch(() => {});
    }
  }, [isAuthenticated, memory?._id, overlay, ensureOverlay]);

  const handleRunNext = React.useCallback(async () => {
    if (!memory) return;
    if (selectedDate) {
      toast.message("Viewing historical data. Switch to Latest to run tasks.");
      return;
    }
    setIsRunning(true);
    try {
      const personalPending =
        overlay?.features?.some((f: any) => f.status !== "passing") ?? false;

      const res: any = personalPending
        ? await runNextPersonalTask({ memoryId: memory._id })
        : await runNextGlobalTask({ memoryId: memory._id });

      if (res.done) {
        toast.message(res.message || "All tasks passing");
      } else if (res.status === "failing") {
        toast.error("Task failed to produce a usable result. You can Retry.");
      } else {
        toast.success(`Advanced task ${res.taskId}`);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to run brief task");
    } finally {
      setIsRunning(false);
    }
  }, [
    memory,
    overlay,
    runNextGlobalTask,
    runNextPersonalTask,
    selectedDate,
  ]);

  // Navigation helpers (shared with LiveDashboard)
  const currentDateIndex = React.useMemo(() => {
    if (!selectedDate || availableDates.length === 0) return -1;
    return availableDates.indexOf(selectedDate);
  }, [selectedDate, availableDates]);

  const canGoPrevious = currentDateIndex < availableDates.length - 1;
  const canGoNext = currentDateIndex > 0;

  const handlePreviousDay = () => {
    if (canGoPrevious) {
      setSelectedDate(availableDates[currentDateIndex + 1]);
    }
  };
  const handleNextDay = () => {
    if (canGoNext) {
      setSelectedDate(availableDates[currentDateIndex - 1]);
    }
  };
  const handleReturnToLatest = () => setSelectedDate(null);

  // "Run All" handler - runs all pending tasks sequentially
  // Note: This uses data that's only available after memory loads, but the hook must be called unconditionally
  const handleRunAll = React.useCallback(async () => {
    if (!memory || selectedDate) return;

    // Calculate pending tasks
    const personalFeatures: any[] = overlay?.features ?? [];
    const globalFeatures: any[] = memory.features ?? [];
    const pendingPersonal = personalFeatures.filter((f) => f.status === "pending");
    const pendingGlobal = globalFeatures.filter((f) => f.status === "pending");
    const queueOrder = [...pendingPersonal, ...pendingGlobal];
    const pendingTasks = queueOrder.length;

    if (pendingTasks === 0) {
      toast.message("No pending tasks to run");
      return;
    }
    setIsRunning(true);
    setRunAllProgress({ current: 0, total: pendingTasks });
    let completed = 0;
    let failed = 0;
    try {
      // Run personal tasks first
      for (const task of pendingPersonal) {
        try {
          const res: any = await runNextPersonalTask({ memoryId: memory._id, taskId: task.id });
          if (res.status === "failing") failed++;
        } catch {
          failed++;
        }
        completed++;
        setRunAllProgress({ current: completed, total: pendingTasks });
      }
      // Then run global tasks
      for (const task of pendingGlobal) {
        try {
          const res: any = await runNextGlobalTask({ memoryId: memory._id, taskId: task.id });
          if (res.status === "failing") failed++;
        } catch {
          failed++;
        }
        completed++;
        setRunAllProgress({ current: completed, total: pendingTasks });
      }
      if (failed === 0) {
        toast.success(`Completed all ${completed} tasks`);
      } else {
        toast.warning(`Completed ${completed} tasks (${failed} failed)`);
      }
    } catch (err: any) {
      toast.error(err?.message || "Run All failed");
    } finally {
      setIsRunning(false);
      setRunAllProgress(null);
    }
  }, [memory, selectedDate, overlay, runNextPersonalTask, runNextGlobalTask, setIsRunning, setRunAllProgress]);

  if (memory === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-content-secondary">
        <Loader2 className="w-4 h-4 motion-safe:animate-spin mr-2" />
        Loading daily brief...
      </div>
    );
  }

  if (!memory) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-sm text-content-secondary gap-2">
        No daily brief memory yet.
        <button
          type="button"
          onClick={() =>
            toast.message("Wait for the 6:00 AM UTC cron or trigger refresh")
          }
          className="px-3 py-1 text-xs rounded-md bg-surface-secondary border border-edge"
        >
          How to generate
        </button>
      </div>
    );
  }

  const globalFeatures: any[] = memory.features ?? [];
  const personalFeatures: any[] = overlay?.features ?? [];

  const resultsMap = new Map<string, any>();
  (results ?? []).forEach((r: any) => resultsMap.set(r.taskId, r));

  const allFeatures = [...personalFeatures, ...globalFeatures];
  const passingGlobal = globalFeatures.filter((f) => f.status === "passing")
    .length;
  const passingPersonal = personalFeatures.filter((f) => f.status === "passing")
    .length;
  const failingCount = allFeatures.filter((f) => f.status === "failing").length;
  const passingCount = passingGlobal + passingPersonal;
  const pendingCount = allFeatures.filter((f) => f.status === "pending").length;
  const totalCount = allFeatures.length || 1;
  const passingPct = (passingCount / totalCount) * 100;
  const failingPct = (failingCount / totalCount) * 100;
  const pendingPct = (pendingCount / totalCount) * 100;

  // Calculate queue positions for pending tasks (personal first, then global)
  const pendingPersonal = personalFeatures.filter((f) => f.status === "pending");
  const pendingGlobal = globalFeatures.filter((f) => f.status === "pending");
  const queueOrder = [...pendingPersonal, ...pendingGlobal];
  const queuePositionMap = new Map<string, number>();
  queueOrder.forEach((f, idx) => queuePositionMap.set(f.id, idx + 1));

  const displayDate = selectedDate || memory.dateString;
  const displayDateLabel = formatBriefDate(displayDate);
  const isViewingHistorical = selectedDate !== null;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface">
      {/* Historical viewing bar */}
      {isViewingHistorical && (
        <div className="mx-3 mt-3 px-3 py-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-3 h-3 text-amber-600" />
              <span className="text-xs text-amber-800 dark:text-amber-300 font-medium">
                Viewing historical brief: {displayDateLabel}
              </span>
            </div>
            <button
              type="button"
              onClick={handleReturnToLatest}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors"
              title="Return to latest brief"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Latest</span>
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex-shrink-0 p-3 border-b border-edge">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <RefreshCcw className="w-4 h-4 text-violet-500" />
            <span className="text-sm font-medium text-content">
              Daily Brief Memory
            </span>
          </div>
          <span className="text-xs text-content-secondary">
            {passingCount} passing / {failingCount} failed / {pendingCount} pending
          </span>
        </div>

        {/* Progress bar */}
        {allFeatures.length > 0 && (
          <div className="mb-3">
            <div className="h-1.5 w-full bg-surface-hover rounded overflow-hidden flex">
              <div
                className="h-full bg-indigo-500"
                style={{ width: `${passingPct}%` }}
              />
              <div
                className="h-full bg-red-500"
                style={{ width: `${failingPct}%` }}
              />
              <div
                className="h-full bg-content-muted"
                style={{ width: `${pendingPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Date navigation row */}
        <div className="flex items-center justify-between mb-2 px-0.5">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePreviousDay}
                disabled={!canGoPrevious}
                className={buttonIcon}
                title="Previous day"
              >
                <ChevronLeft className="w-3 h-3 text-slate-600 dark:text-slate-400" />
              </button>
              <button
                type="button"
                onClick={handleNextDay}
                disabled={!canGoNext}
                className={buttonIcon}
                title="Next day"
              >
                <ChevronRight className="w-3 h-3 text-slate-600 dark:text-slate-400" />
              </button>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              {isViewingHistorical ? (
                <span className="text-amber-600 font-medium">
                  {displayDateLabel}
                </span>
              ) : (
                <span>Latest</span>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons row */}
        <div className="flex gap-2 mt-1">
          <button
            type="button"
            onClick={handleRunNext}
            disabled={isRunning || isViewingHistorical || pendingCount === 0}
            className={cn(
              buttonSecondary,
              "flex-1 gap-2 px-3 py-2 text-xs font-medium",
              (isRunning || isViewingHistorical || pendingCount === 0) &&
                "bg-surface-hover text-content-muted border-edge cursor-not-allowed hover:bg-surface-hover",
            )}
          >
            {runAllProgress ? (
              <>
                <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" />
                {runAllProgress.current}/{runAllProgress.total}
              </>
            ) : isRunning ? (
              <>
                <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" />
                Running...
              </>
            ) : isViewingHistorical ? (
              "Historical"
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                Run Next
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleRunAll}
            disabled={isRunning || isViewingHistorical || pendingCount === 0}
            className={cn(
              buttonSecondary,
              "flex-1 gap-2 px-3 py-2 text-xs font-medium",
              (isRunning || isViewingHistorical || pendingCount === 0) &&
                "bg-surface-hover text-content-muted border-edge cursor-not-allowed hover:bg-surface-hover",
            )}
            title={`Run all ${pendingCount} pending tasks`}
          >
            {runAllProgress ? (
              <>
                <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" />
                {runAllProgress.current}/{runAllProgress.total}
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                Run All ({pendingCount})
              </>
            )}
          </button>
        </div>

        {/* Date pills */}
        {availableDates.length > 1 && (
          <div className="mt-3">
            <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">
              Historical Briefs
            </div>
            <div className="flex flex-wrap gap-1">
              {availableDates.map((date) => (
                <button
                  key={date}
                  type="button"
                  onClick={() =>
                    setSelectedDate(date === selectedDate ? null : date)
                  }
                  className={cn(
                    "px-2 py-1 text-xs rounded transition-colors border",
                    date === displayDate
                      ? "bg-[var(--accent-primary)] text-white font-medium border-[var(--accent-primary)]"
                      : "bg-surface hover:bg-slate-100 dark:hover:bg-white/[0.08] text-slate-600 dark:text-slate-400 border-slate-200",
                  )}
                  title={`View brief from ${date}`}
                >
                  {new Date(date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Task backlog */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {personalFeatures.length > 0 && (
          <div>
            <div className="text-xs text-slate-400 dark:text-slate-500 mb-2">
              Personalized Tasks
            </div>
            <div className="space-y-2">
              {personalFeatures.map((f) => {
                const queuePos = f.status === "pending" ? queuePositionMap.get(f.id) : null;
                return (
                  <TaskCard
                    key={`personal-${f.id}`}
                    task={f}
                    resultMarkdown={f.resultMarkdown}
                    isPersonal
                    queuePosition={queuePos}
                    isNextUp={queuePos === 1}
                    onRetry={
                      !isViewingHistorical && f.status === "failing"
                        ? async () => {
                            setIsRunning(true);
                            try {
                              const res: any = await runNextPersonalTask({
                                memoryId: memory._id,
                                taskId: f.id,
                              });
                              if (res.status === "failing") {
                                toast.error(
                                  "Retry failed. The AI response was still insufficient.",
                                );
                              } else {
                                toast.success(`Retried ${f.id}`);
                              }
                            } catch (err: any) {
                              toast.error(err?.message || "Retry failed");
                            } finally {
                              setIsRunning(false);
                            }
                          }
                        : undefined
                    }
                    retryDisabled={isRunning}
                  />
                );
              })}
            </div>
          </div>
        )}

        <div>
          <div className="text-xs text-slate-400 dark:text-slate-500 mb-2">
            Global Brief Tasks
          </div>
          <div className="space-y-2">
            {globalFeatures.map((f) => {
              const result = resultsMap.get(f.id);
              const queuePos = f.status === "pending" ? queuePositionMap.get(f.id) : null;
              return (
                <TaskCard
                  key={f.id}
                  task={f}
                  resultMarkdown={result?.resultMarkdown}
                  queuePosition={queuePos}
                  isNextUp={queuePos === 1}
                  onRetry={
                    !isViewingHistorical && f.status === "failing"
                      ? async () => {
                          setIsRunning(true);
                          try {
                            const res: any = await runNextGlobalTask({
                              memoryId: memory._id,
                              taskId: f.id,
                            });
                            if (res.status === "failing") {
                              toast.error(
                                "Retry failed. The AI response was still insufficient.",
                              );
                            } else {
                              toast.success(`Retried ${f.id}`);
                            }
                          } catch (err: any) {
                            toast.error(err?.message || "Retry failed");
                          } finally {
                            setIsRunning(false);
                          }
                        }
                      : undefined
                  }
                  retryDisabled={isRunning}
                />
              );
            })}

            {globalFeatures.length === 0 && (
              <div className="text-xs text-content-secondary">
                No global tasks generated.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
