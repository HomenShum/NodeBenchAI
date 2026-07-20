import { useMemo } from "react";
import { LATEST_EVAL_DATA } from "@/features/research/components/modelEvalData";
import type { ModelEvalResult } from "@/features/research/components/modelEvalData";
import { WORKBENCH_SCENARIOS } from "./workbenchScenarios";

export const BENCHMARK_MODELS: Array<{
  id: string;
  displayName: string;
  provider: "anthropic" | "openai" | "google" | "open-source";
  providerLabel: string;
  evalSlug?: string;
}> = [
  { id: "claude-sonnet-4-6", displayName: "Claude 4.6", provider: "anthropic", providerLabel: "Anthropic", evalSlug: undefined },
  { id: "claude-haiku-4.5", displayName: "Haiku 4.5", provider: "anthropic", providerLabel: "Anthropic", evalSlug: "claude-haiku-4.5" },
  { id: "gemini-3-flash-preview", displayName: "Gemini 3 Flash", provider: "google", providerLabel: "Google", evalSlug: "gemini-3-flash-preview" },
  { id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini", provider: "openai", providerLabel: "OpenAI", evalSlug: "gpt-5.4-mini" },
  { id: "deepseek-v3.2", displayName: "DeepSeek V3", provider: "open-source", providerLabel: "DeepSeek", evalSlug: "deepseek-v3.2" },
  { id: "qwen3-235b", displayName: "Qwen 3 235B", provider: "open-source", providerLabel: "Alibaba", evalSlug: "qwen3-235b" },
];

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  openai: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  google: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  "open-source": "bg-purple-500/10 text-purple-600 dark:text-purple-400",
};

interface LeaderboardEntry {
  modelId: string;
  displayName: string;
  provider: "anthropic" | "openai" | "google" | "open-source";
  providerLabel: string;
  score: number | null;
  grade: string | null;
  sourceLabel: string;
  lastRunAt: number | null;
  lastScenarioId: string | null;
}

function scoreColor(score: number | null): string {
  if (score === null) return "text-content-muted";
  if (score >= 80) return "text-emerald-500 dark:text-emerald-400";
  if (score >= 60) return "text-amber-500 dark:text-amber-400";
  return "text-red-500 dark:text-red-400";
}

function scoreBarColor(score: number | null): string {
  if (score === null) return "bg-surface-secondary";
  if (score >= 80) return "bg-emerald-500/70";
  if (score >= 60) return "bg-amber-500/70";
  return "bg-red-500/70";
}

function scoreBarWidth(score: number | null): string {
  if (score === null) return "0%";
  return `${Math.min(100, Math.max(6, score))}%`;
}

function gradeDotColor(score: number | null): string {
  if (score === null) return "bg-surface-secondary";
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-amber-500";
  return "bg-red-500";
}

function scoreToGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function ModelLeaderboard({
  liveScores,
}: {
  liveScores?: Array<{
    model: string;
    provider?: string;
    bestScore: number;
    bestGrade?: string;
    lastScenarioId?: string;
    lastRunAt?: number;
    runCount?: number;
  }>;
}) {
  const evalBySlug = useMemo(() => {
    const results = new Map<string, ModelEvalResult>();
    for (const entry of LATEST_EVAL_DATA) {
      results.set(entry.model, entry);
    }
    return results;
  }, []);

  const liveByModel = useMemo(() => {
    const results = new Map<
      string,
      {
        bestScore: number;
        bestGrade?: string;
        lastScenarioId?: string;
        lastRunAt?: number;
      }
    >();
    for (const entry of liveScores ?? []) {
      results.set(entry.model, entry);
    }
    return results;
  }, [liveScores]);

  const entries: LeaderboardEntry[] = useMemo(
    () =>
      BENCHMARK_MODELS.map((benchmarkModel) => {
        const live = liveByModel.get(benchmarkModel.id);
        if (live) {
          return {
            modelId: benchmarkModel.id,
            displayName: benchmarkModel.displayName,
            provider: benchmarkModel.provider,
            providerLabel: benchmarkModel.providerLabel,
            score: live.bestScore,
            grade: live.bestGrade ?? scoreToGrade(live.bestScore),
            sourceLabel: "Workbench run",
            lastRunAt: live.lastRunAt ?? null,
            lastScenarioId: live.lastScenarioId ?? null,
          };
        }

        if (benchmarkModel.evalSlug) {
          const evalEntry = evalBySlug.get(benchmarkModel.evalSlug);
          if (evalEntry) {
            const score = evalEntry.passRate;
            return {
              modelId: benchmarkModel.id,
              displayName: benchmarkModel.displayName,
              provider: benchmarkModel.provider,
              providerLabel: benchmarkModel.providerLabel,
              score,
              grade: scoreToGrade(score),
              sourceLabel: "Tool-use evaluation",
              lastRunAt: null,
              lastScenarioId: null,
            };
          }
        }

        return {
          modelId: benchmarkModel.id,
          displayName: benchmarkModel.displayName,
          provider: benchmarkModel.provider,
          providerLabel: benchmarkModel.providerLabel,
          score: null,
          grade: null,
          sourceLabel: "Not yet run",
          lastRunAt: null,
          lastScenarioId: null,
        };
      }),
    [evalBySlug, liveByModel],
  );

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-content-muted">Leaderboard</h2>
        <span className="text-xs text-content-muted">Score (0-100) · all time</span>
      </div>

      <div className="lg:hidden scrollbar-none -mx-1 flex gap-3 sm:gap-4 overflow-x-auto overflow-y-visible px-1 pr-6 sm:pr-4 pb-2 snap-x snap-mandatory">
        {entries.map((entry) => (
          <ModelCard key={entry.modelId} entry={entry} compact />
        ))}
      </div>
      <div className="hidden lg:grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(10.75rem,1fr))]">
        {entries.map((entry) => (
          <ModelCard key={entry.modelId} entry={entry} />
        ))}
      </div>
    </section>
  );
}

function ModelCard({ entry, compact = false }: { entry: LeaderboardEntry; compact?: boolean }) {
  const providerBadgeClass = PROVIDER_COLORS[entry.provider] ?? "bg-surface-secondary text-content-muted";
  const sizingClass = compact ? "flex-none w-[12.5rem] sm:w-52 snap-start" : "min-w-0";

  const runMeta = (() => {
    if (!entry.lastRunAt) return null;
    const scenarioName = entry.lastScenarioId
      ? (WORKBENCH_SCENARIOS.find((scenario) => scenario.id === entry.lastScenarioId)?.name ?? entry.lastScenarioId)
      : null;
    return { scenarioName, when: timeAgo(entry.lastRunAt) };
  })();
  return (
    <div className={`nb-surface-card ${sizingClass} bg-surface p-4 sm:p-4 flex flex-col gap-2 hover:border-content-muted/30 transition-colors`}>
      <div className="flex items-start justify-between gap-1">
        <span className="text-sm font-semibold leading-tight text-content">{entry.displayName}</span>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${providerBadgeClass}`}>
          {entry.providerLabel}
        </span>
      </div>

      <div className="h-1 rounded-full bg-surface overflow-hidden">
        {entry.score !== null ? (
          <div
            className={`h-full rounded-full transition-all duration-500 ${scoreBarColor(entry.score)}`}
            style={{ width: scoreBarWidth(entry.score) }}
          />
        ) : (
          <div className="h-full w-2/5 rounded-full bg-content-muted/20" />
        )}
      </div>

      <div className="flex items-end justify-between">
        {entry.score !== null ? (
          <span className={`text-xl font-bold tabular-nums tracking-tight ${scoreColor(entry.score)}`}>
            <span className="inline-flex items-baseline">
              <span>{entry.score}</span>
              <span className="text-xs font-medium text-content-muted">/100</span>
            </span>
          </span>
        ) : (
          <span className="inline-block h-5 w-14 rounded bg-content-muted/20" aria-label="Not yet run" />
        )}

        {entry.grade && (
          <span
            className="inline-flex items-center justify-center"
            title={`Grade ${entry.grade}`}
            aria-label={`Grade ${entry.grade}`}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${gradeDotColor(entry.score)}`} />
          </span>
        )}
      </div>

      {runMeta ? (
        <div className="text-[10px] leading-none text-content-muted flex items-center justify-between gap-2">
          <span className="truncate">{runMeta.scenarioName ?? "Last run"}</span>
          <span className="shrink-0">{runMeta.when}</span>
        </div>
      ) : (
        <div className="text-[10px] leading-none text-content-muted flex items-center justify-between gap-2">
          {entry.score === null ? (
            <div className="min-w-0">
              <span
                className="inline-flex items-center gap-1.5 text-content-secondary"
                title="Connect a benchmark app to unlock this lane."
              >
                <span className="h-1.5 w-1.5 rounded-full bg-content-muted/70" />
                <span className="font-medium">Awaiting first run</span>
              </span>
              <div className="mt-1 text-[10px] leading-relaxed text-content-muted">
                Connect a benchmark app to unlock this lane.
              </div>
            </div>
          ) : (
            <span>{entry.sourceLabel}</span>
          )}
        </div>
      )}
    </div>
  );
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
