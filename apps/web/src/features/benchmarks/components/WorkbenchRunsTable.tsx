import { Clock, Settings, Play } from "lucide-react";
import { SignatureOrb } from "@/shared/ui/SignatureOrb";
import { WORKBENCH_SCENARIOS } from "./workbenchScenarios";

export interface WorkbenchRunRow {
  _id: string;
  model: string;
  provider: string;
  scenarioId: string;
  status: "running" | "completed" | "failed";
  compositeScore?: number;
  grade?: string;
  runDurationMs?: number;
  startedAt: number;
  completedAt?: number;
}

function formatModel(slug: string): string {
  const modelMap: Record<string, string> = {
    "claude-sonnet-4-6": "Claude 4.6 Sonnet",
    "claude-opus-4-7": "Claude 4.7 Opus",
    "claude-haiku-4.5": "Haiku 4.5",
    "gemini-3-flash-preview": "Gemini 3 Flash",
    "gemini-3.1-pro-preview": "Gemini 3.1 Pro",
    "gpt-4o": "GPT-4o",
    "gpt-5.4-mini": "GPT-5.4 Mini",
    "deepseek-v3.2": "DeepSeek V3.2",
    "qwen3-235b": "Qwen 3 235B",
    "minimax-m2.1": "MiniMax M2.1",
    "deepseek-r1": "DeepSeek R1",
  };
  return modelMap[slug] ?? slug;
}

function formatScenario(id: string): string {
  return WORKBENCH_SCENARIOS.find((scenario) => scenario.id === id)?.name ?? id;
}

function formatDuration(ms?: number): string {
  if (!ms) return "-";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return remainingMin > 0 ? `${hours}h ${remainingMin}m` : `${hours}h`;
}

function timeAgo(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function scoreColor(score?: number): string {
  if (score === undefined) return "text-content-muted";
  if (score >= 80) return "text-emerald-500 dark:text-emerald-400";
  if (score >= 60) return "text-amber-500 dark:text-amber-400";
  return "text-red-500 dark:text-red-400";
}

function gradeDotColor(score?: number): string {
  if (score === undefined) return "bg-surface-secondary";
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-amber-500";
  return "bg-red-500";
}

function StatusIndicator({ status }: { status: WorkbenchRunRow["status"] }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-blue-500">
        <span className="relative inline-flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-70 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
        </span>
        Running
      </span>
    );
  }

  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-500">
        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        Passed
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-red-500">
      <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
      Failed
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <SignatureOrb variant="empty" className="mb-2 py-0" />
      <span className="rounded-full border border-edge bg-surface-secondary px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-content-muted">
        Awaiting first run
      </span>
      <p className="text-sm font-semibold text-content">No benchmark runs yet</p>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-content-muted">
        Runs appear here after you configure a workbench app and trigger a benchmark.
        Phase 2 will enable execution and automated scoring.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <button
          disabled
          title="Configure a benchmark app in Phase 2"
          className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface px-3 py-1.5 text-xs font-medium text-content-muted opacity-60 cursor-not-allowed"
        >
          <Settings className="h-3.5 w-3.5" />
          Configure app
        </button>
        <button
          disabled
          title="Run benchmark is coming in Phase 2"
          className="inline-flex items-center gap-1.5 rounded-md bg-content px-3 py-1.5 text-xs font-medium text-surface opacity-35 cursor-not-allowed"
        >
          <Play className="h-3.5 w-3.5" />
          Run benchmark
        </button>
      </div>
      <p className="mt-3 max-w-sm text-[11px] leading-relaxed text-content-muted">
        The empty state is intentional. Live evals above already show how the product scores and streams proof before self-serve execution opens up.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="animate-pulse p-4">
      <div className="mb-3 h-8 rounded-md bg-surface-secondary" />
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-10 rounded-md bg-surface-secondary" />
        ))}
      </div>
    </div>
  );
}

function RunRow({ run }: { run: WorkbenchRunRow }) {
  const displayTime = run.completedAt ?? run.startedAt;

  return (
    <tr className="border-t border-edge transition-colors hover:bg-surface-secondary/50">
      <td className="px-4 py-3">
        <span className="text-sm font-medium text-content">{formatModel(run.model)}</span>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-content-secondary">{formatScenario(run.scenarioId)}</span>
      </td>
      <td className="px-4 py-3 tabular-nums">
        {run.compositeScore !== undefined ? (
          <span className={`text-sm font-semibold ${scoreColor(run.compositeScore)}`}>
            {run.compositeScore}
          </span>
        ) : (
          <span className="text-sm text-content-muted">-</span>
        )}
      </td>
      <td className="px-4 py-3">
        {run.grade ? (
          <span
            className="inline-flex items-center justify-center"
            aria-label={`Grade ${run.grade}`}
            title={`Grade ${run.grade}`}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${gradeDotColor(run.compositeScore)}`} />
          </span>
        ) : (
          <span className="text-sm text-content-muted">-</span>
        )}
      </td>
      <td className="px-4 py-3 tabular-nums">
        <span className="inline-flex items-center gap-1 text-xs text-content-muted">
          <Clock className="h-3 w-3" />
          {formatDuration(run.runDurationMs)}
        </span>
      </td>
      <td className="px-4 py-3">
        <StatusIndicator status={run.status} />
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-content-muted">{timeAgo(displayTime)}</span>
      </td>
    </tr>
  );
}

export function WorkbenchRunsTable({ runs }: { runs?: WorkbenchRunRow[] }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-content-muted">Runs</h2>
        {(runs?.length ?? 0) > 0 && <span className="text-xs text-content-muted">Last 30 days</span>}
      </div>

      <div className="overflow-hidden rounded-lg border border-edge bg-surface">
        {runs === undefined ? (
          <LoadingState />
        ) : runs.length === 0 ? (
          <EmptyState />
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="bg-surface-secondary">
                {["Model", "Scenario", "Score", "Grade", "Duration", "Status", "When"].map((column) => (
                  <th
                    key={column}
                    className="px-4 py-2.5 text-[10px] font-semibold text-content-muted"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <RunRow key={run._id} run={run} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
