/**
 * WorkbenchView — /benchmarks route
 *
 * NodeBench Workbench: realistic cross-model benchmark on frozen app substrates.
 * Compares GPT/Claude/Gemini/Open-source on 4 benchmark scenarios that
 * mirror real engineering work: UI transformation, agent integration, long-run
 * reliability, and architect mode.
 *
 * Layout zones:
 *   1. Header — title, subtitle, CTA buttons (Configure App / Run)
 *   2. Model Leaderboard — horizontal score strip
 *   3. Scenario Catalog — 4 scenario rows (Linear issue-list style)
 *   4. Runs Table — recent runs with score, grade, duration, status
 *   5. Capability Deep Dive — existing ModelEvalDashboard charts (expandable)
 *
 * NOTE for Codex: When Phase 2 execution engine lands:
 *   a. Wire leaderboard to useQuery(api.domains.evaluation.workbenchQueries.getWorkbenchLeaderboard)
 *   b. Wire scenario stats to useQuery(api.domains.evaluation.workbenchQueries.getScenarioStats)
 *   c. Wire runs table to useQuery(api.domains.evaluation.workbenchQueries.listWorkbenchRuns, { limit: 25 })
 *   d. Enable "Configure App" drawer (workbench app catalog)
 *   e. Enable "Run" button (trigger workbench run action)
 */

import React, { useEffect, useState, lazy, Suspense } from "react";
import { useQuery } from "convex/react";
import { ChevronDown, ChevronUp, Settings, Play, CheckCircle2, AlertTriangle, Activity } from "lucide-react";
import { SignatureOrb } from "@/shared/ui/SignatureOrb";
import { api } from "../../../../convex/_generated/api";
import type { TrajectorySummaryData, TrajectoryTimelineItem } from "@/features/trajectory/types";

// Lazy-load sub-panels — these are below the fold or behind expandable sections
const ModelLeaderboard = lazy(() =>
  import("../components/ModelLeaderboard").then((mod) => ({ default: mod.ModelLeaderboard }))
);
const ScenarioCatalog = lazy(() =>
  import("../components/ScenarioCatalog").then((mod) => ({ default: mod.ScenarioCatalog }))
);
const WorkbenchRunsTable = lazy(() =>
  import("../components/WorkbenchRunsTable").then((mod) => ({ default: mod.WorkbenchRunsTable }))
);
const TelemetryInspector = lazy(() =>
  import("../components/TelemetryInspector").then((mod) => ({ default: mod.TelemetryInspector }))
);
const TrajectorySummaryBand = lazy(() =>
  import("@/features/trajectory/components/TrajectorySummaryBand").then((mod) => ({ default: mod.TrajectorySummaryBand }))
);
const TrajectoryTimelinePanel = lazy(() =>
  import("@/features/trajectory/components/TrajectoryTimelinePanel").then((mod) => ({ default: mod.TrajectoryTimelinePanel }))
);

// Workbench live data is opt-in until the backing Convex functions are deployed
// in the current environment. This avoids noisy runtime errors in QA/dev sessions
// where the UI lands before backend rollout.
const WORKBENCH_LIVE_DATA_ENABLED = import.meta.env.VITE_ENABLE_WORKBENCH_LIVE_DATA === "1";

// Lazy-load the existing eval charts (heavy recharts bundle — split it out)
const ModelEvalDashboard = lazy(() =>
  import("@/features/research/components/ModelEvalDashboard").then((mod) => ({
    default: mod.ModelEvalDashboard,
  }))
);

const STREAM_PREVIEW_LIMIT = 320;

// ─── Header ───────────────────────────────────────────────────────────────────

function WorkbenchHeader() {
  return (
    <div className="relative z-[1] bg-surface border-b border-edge">
      <div className="nb-page-frame px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        {/* Left: icon + title + subtitle */}
        <div className="flex items-start gap-3">
          <div className="flex-none mt-0.5 rounded-lg bg-surface-secondary border border-edge p-1">
            <SignatureOrb variant="signature" size="xs" />
          </div>
          <div>
            <h1 className="type-page-title text-content leading-tight">
              Workbench
            </h1>
            <p className="type-caption mt-0.5 max-w-md">
              Benchmark models on frozen baseline apps and realistic scenarios.
              Compare UI craft, tool use, reliability, and engineering rigor across providers.
            </p>
          </div>
        </div>

        {/* Right: CTA buttons (both disabled — Phase 2) */}
        <div className="shrink-0 self-start sm:self-auto">
          <div className="flex flex-wrap items-center gap-2">
          <a
            href="#telemetry-inspector"
            className="btn-outline-sm inline-flex min-h-11 sm:min-h-8 items-center gap-1.5 whitespace-nowrap"
          >
            <Activity className="w-3.5 h-3.5" />
            <span className="sm:hidden">Inspector</span>
            <span className="hidden sm:inline">Open Inspector</span>
          </a>
          <button
            disabled
            title="Configure a workbench app — coming in Phase 2"
            className="btn-outline-sm inline-flex min-h-11 sm:min-h-8 items-center gap-1.5 opacity-60 cursor-not-allowed whitespace-nowrap disabled:pointer-events-auto disabled:hover:opacity-90"
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="sm:hidden">Configure</span>
            <span className="hidden sm:inline">Configure App</span>
          </button>
          <button
            disabled
            title="Run a benchmark — coming in Phase 2"
            className="btn-primary-sm inline-flex min-h-11 sm:min-h-8 items-center gap-1.5 opacity-55 cursor-not-allowed whitespace-nowrap disabled:pointer-events-auto disabled:hover:opacity-75"
          >
            <Play className="w-3.5 h-3.5" />
            <span className="sm:hidden">Run</span>
            <span className="hidden sm:inline">Run Benchmark</span>
          </button>
          </div>
          <p className="mt-2 max-w-xs text-[11px] leading-relaxed text-content-muted">
            Execution unlocks after you connect a benchmark app. The live eval and guard panels below show the current benchmark bar until then.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Capability Deep Dive (collapsible) ───────────────────────────────────────

function CapabilityDeepDive() {
  const [open, setOpen] = useState(false);

  return (
    <section>
      <button
        onClick={() => setOpen((v) => !v)}
        className="
          nb-surface-card w-full flex items-center justify-between px-4 py-3
          hover:bg-surface transition-colors text-left
        "
        aria-expanded={open}
      >
        <div>
          <span className="type-label">
            Open detailed evaluation charts
          </span>
          <p className="text-xs text-content-muted mt-0.5">
            Expand pass rates, latency, and cost charts across benchmark scenarios
          </p>
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-content-muted shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-content-muted shrink-0" />
        )}
      </button>

      {open && (
        <div className="nb-surface-card mt-4 overflow-hidden">
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-16 text-xs text-content-muted">
                Loading charts…
              </div>
            }
          >
            <ModelEvalDashboard {...({} as any)} />
          </Suspense>
        </div>
      )}
    </section>
  );
}

interface LiveGuardArtifact {
  generatedAt: string;
  checks: {
    fastSearch: {
      averageMs: number;
      p95Ms: number;
      passesBudget: boolean;
      resultCount: number;
      citationCount: number;
    };
    enterpriseInvestigation: {
      averageMs: number;
      p95Ms: number;
      passesBudget: boolean;
      causalChainLength: number;
      snapshotHashCount: number;
      replayUrl?: string | null;
    };
  };
  failures: string[];
}

interface EnterpriseEvalArtifact {
  generatedAt: string;
  summary: {
    totalCases: number;
    passedCases: number;
    deterministicAverage: number;
    llmJudgeAverage: number;
    totalEstimatedTokens: number;
  };
  cases: Array<{
    caseId: string;
    title: string;
    dataset: string;
    deterministic: {
      overall: number;
      passed: boolean;
    };
    llmJudge: {
      score: number;
      passed: boolean;
      model: string;
      estimatedTotalTokens: number;
    };
    telemetry: {
      totalDurationMs: number;
      anomalyCount: number;
      causalChainLength: number;
      sourceHashCount: number;
      proposedAction: string;
    };
  }>;
  stream: {
    object: string;
    events: Array<{
      at: string;
      type: string;
      lane?: number;
      caseId?: string;
      detail: string;
      request?: string;
      response?: string;
      telemetry?: Record<string, string | number | boolean | null>;
    }>;
    finalVerdict: string;
    telemetry: {
      totalEstimatedTokens: number;
      averageJudgeScore: number;
      averageDeterministicScore: number;
      totalWallClockMs?: number;
      estimatedJudgeCostUsd?: number | null;
    };
    video?: {
      status: string;
      url: string | null;
      note?: string;
    };
  };
  failures: string[];
}

function formatLatency(ms?: number) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    return "n/a";
  }
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
}

function StreamPayloadBlock({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const normalized = value.trim();
  const isLong = normalized.length > STREAM_PREVIEW_LIMIT || normalized.split("\n").length > 6;
  const displayValue =
    expanded || !isLong ? normalized : `${normalized.slice(0, STREAM_PREVIEW_LIMIT).trimEnd()}…`;

  return (
    <div className="mt-2 rounded-md border border-edge bg-surface p-2 text-[11px] text-content-muted">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-content">{label}</div>
        {isLong ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="text-[10px] font-medium text-primary hover:opacity-80"
          >
            {expanded ? "Collapse" : "Show full"}
          </button>
        ) : null}
      </div>
      <div className="mt-1 whitespace-pre-wrap break-words">{displayValue}</div>
    </div>
  );
}

type StreamEvent = EnterpriseEvalArtifact["stream"]["events"][number];

function TelemetryEventCard({ event }: { event: StreamEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hasPayloads = !!(event.request || event.response || event.telemetry);

  return (
    <div className="rounded-lg border border-edge bg-surface-secondary">
      <button
        type="button"
        onClick={() => hasPayloads && setExpanded((v) => !v)}
        aria-expanded={hasPayloads ? expanded : undefined}
        className={`w-full text-left p-2 ${hasPayloads ? "cursor-pointer" : "cursor-default"}`}
      >
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-content">{event.type}</span>
          <div className="flex items-center gap-1.5">
            <span className="text-content-muted">{new Date(event.at).toLocaleTimeString("en-US")}</span>
            {hasPayloads ? (
              expanded ? (
                <ChevronUp className="w-3 h-3 text-content-muted shrink-0" />
              ) : (
                <ChevronDown className="w-3 h-3 text-content-muted shrink-0" />
              )
            ) : null}
          </div>
        </div>
        <div className="text-xs text-content mt-1">{event.detail}</div>
        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-content-muted">
          {event.caseId ? <span>{event.caseId}</span> : null}
          {typeof event.lane === "number" ? <span>lane {event.lane}</span> : null}
        </div>
      </button>

      {expanded && (
        <div className="px-2 pb-2">
          {event.request ? <StreamPayloadBlock label="Input" value={event.request} /> : null}
          {event.response ? <StreamPayloadBlock label="Output" value={event.response} /> : null}
          {event.telemetry ? (
            <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-content-muted">
              {Object.entries(event.telemetry).map(([key, value]) => (
                <div key={key}>
                  {key}: {String(value)}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function LiveGuardPanel() {
  const [artifact, setArtifact] = useState<LiveGuardArtifact | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadArtifact() {
      try {
        const response = await fetch("/benchmarks/api-headless-live-guard-latest.json", {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const json = (await response.json()) as LiveGuardArtifact;
        if (!cancelled) {
          setArtifact(json);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load live guard artifact");
        }
      }
    }

    void loadArtifact();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!artifact && !error) {
    return (
      <section className="nb-surface-card p-4 sm:p-5">
        <div className="flex items-center gap-2 text-content">
          <Activity className="w-4 h-4 text-blue-500" />
          <span className="type-label">Live API Guard</span>
        </div>
        <p className="text-xs text-content-muted mt-2">Loading the latest production benchmark artifact…</p>
      </section>
    );
  }

  if (error || !artifact) {
    return (
      <section className="nb-surface-card p-4 sm:p-5">
        <div className="flex items-center gap-2 text-content">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <span className="type-label">Live API Guard</span>
        </div>
        <p className="text-xs text-content-muted mt-2">
          Latest production benchmark artifact is unavailable.
          {error ? ` ${error}` : ""}
        </p>
      </section>
    );
  }

  const overallPass = artifact.failures.length === 0;

  return (
    <section className="nb-surface-card p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-content">
            {overallPass ? (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-500" />
            )}
            <span className="type-label">Live API Guard</span>
          </div>
          <p className="text-xs text-content-muted mt-1">
            Real deployment benchmark for public search and enterprise investigation.
          </p>
        </div>
        <div className="text-xs text-content-muted">
          {new Date(artifact.generatedAt).toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
        <div className="rounded-xl border border-edge bg-surface-secondary p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-content">Fast Search</span>
            <span className={artifact.checks.fastSearch.passesBudget ? "text-green-600 text-xs" : "text-amber-600 text-xs"}>
              {artifact.checks.fastSearch.passesBudget ? "Within budget" : "Over budget"}
            </span>
          </div>
          <div className="mt-2 space-y-1 text-xs text-content-muted">
            <div>P95 latency (time): {formatLatency(artifact.checks.fastSearch.p95Ms)}</div>
            <div>Average latency (time): {formatLatency(artifact.checks.fastSearch.averageMs)}</div>
            <div>Results: {artifact.checks.fastSearch.resultCount}</div>
            <div>Citations: {artifact.checks.fastSearch.citationCount}</div>
          </div>
        </div>

        <div className="rounded-xl border border-edge bg-surface-secondary p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-content">Enterprise Investigation</span>
            <span
              className={
                artifact.checks.enterpriseInvestigation.passesBudget
                  ? "text-green-600 text-xs"
                  : "text-amber-600 text-xs"
              }
            >
              {artifact.checks.enterpriseInvestigation.passesBudget ? "Within budget" : "Over budget"}
            </span>
          </div>
          <div className="mt-2 space-y-1 text-xs text-content-muted">
            <div>P95 latency (time): {formatLatency(artifact.checks.enterpriseInvestigation.p95Ms)}</div>
            <div>Average latency (time): {formatLatency(artifact.checks.enterpriseInvestigation.averageMs)}</div>
            <div>Causal chain events: {artifact.checks.enterpriseInvestigation.causalChainLength}</div>
            <div>Source hashes: {artifact.checks.enterpriseInvestigation.snapshotHashCount}</div>
          </div>
        </div>
      </div>

      {artifact.failures.length > 0 ? (
        <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-content">
          <div className="font-medium mb-1">Current failures</div>
          <ul className="space-y-1 text-content-muted">
            {artifact.failures.map((failure) => (
              <li key={failure}>- {failure}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-green-500/20 bg-green-500/5 p-3 text-xs text-content">
          Production live guard is passing. The public API lanes are within budget and the enterprise payload still carries evidence and replay metadata.
        </div>
      )}
    </section>
  );
}

function EnterpriseEvalPanel() {
  const [artifact, setArtifact] = useState<EnterpriseEvalArtifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visibleEventCount, setVisibleEventCount] = useState(0);
  const replayMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("streamReplay") === "1";

  useEffect(() => {
    let cancelled = false;

    async function loadArtifact() {
      try {
        const response = await fetch("/benchmarks/enterprise-investigation-eval-latest.json", {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const json = (await response.json()) as EnterpriseEvalArtifact;
        if (!cancelled) {
          setArtifact(json);
          setError(null);
          setVisibleEventCount(0);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load enterprise investigation eval artifact",
          );
        }
      }
    }

    void loadArtifact();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!artifact) return;
    const stepMs = replayMode ? 550 : 900;
    setVisibleEventCount(0);
    const interval = window.setInterval(() => {
      setVisibleEventCount((current) => {
        if (current >= artifact.stream.events.length) {
          window.clearInterval(interval);
          return current;
        }
        return current + 1;
      });
    }, stepMs);
    return () => window.clearInterval(interval);
  }, [artifact, replayMode]);

  if (!artifact && !error) {
    return (
      <section className="nb-surface-card p-4 sm:p-5">
        <div className="flex items-center gap-2 text-content">
          <Activity className="w-4 h-4 text-blue-500" />
          <span className="type-label">Enterprise Investigation Eval</span>
        </div>
        <p className="text-xs text-content-muted mt-2">Loading full-force temporal eval artifact…</p>
      </section>
    );
  }

  if (error || !artifact) {
    return (
      <section className="nb-surface-card p-4 sm:p-5">
        <div className="flex items-center gap-2 text-content">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <span className="type-label">Enterprise Investigation Eval</span>
        </div>
        <p className="text-xs text-content-muted mt-2">
          Latest enterprise eval artifact is unavailable.
          {error ? ` ${error}` : ""}
        </p>
      </section>
    );
  }

  const overallPass = artifact.failures.length === 0;
  const visibleEvents = artifact.stream.events.slice(0, Math.max(1, visibleEventCount));

  return (
    <section className="nb-surface-card p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-content">
            {overallPass ? (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-500" />
            )}
            <span className="type-label">Enterprise Investigation Eval</span>
          </div>
          <p className="text-xs text-content-muted mt-1">
            Public fixture suite with required LLM judging, deterministic traceability checks, and streamed run telemetry.
          </p>
        </div>
        <div className="text-xs text-content-muted">
          {new Date(artifact.generatedAt).toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
        <div className="rounded-xl border border-edge bg-surface-secondary p-3">
          <div className="text-sm font-medium text-content">Cases passed</div>
          <div className="mt-2 text-2xl font-semibold text-content">
            {artifact.summary.passedCases}/{artifact.summary.totalCases}
          </div>
        </div>
        <div className="rounded-xl border border-edge bg-surface-secondary p-3">
          <div className="text-sm font-medium text-content">Deterministic avg</div>
          <div className="mt-2 text-2xl font-semibold text-content">{artifact.summary.deterministicAverage}</div>
        </div>
        <div className="rounded-xl border border-edge bg-surface-secondary p-3">
          <div className="text-sm font-medium text-content">LLM judge avg</div>
          <div className="mt-2 text-2xl font-semibold text-content">{artifact.summary.llmJudgeAverage}</div>
        </div>
        <div className="rounded-xl border border-edge bg-surface-secondary p-3">
          <div className="text-sm font-medium text-content">Estimated judge tokens</div>
          <div className="mt-2 text-2xl font-semibold text-content">{artifact.summary.totalEstimatedTokens.toLocaleString()}</div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-edge bg-surface-secondary p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-content">Parallel run stream</div>
            <div className="text-xs text-content-muted mt-1">
              {visibleEvents.length}/{artifact.stream.events.length} telemetry events visible in the latest eval replay.
            </div>
          </div>
          {artifact.stream.video?.url ? (
            <a
              href={artifact.stream.video.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-edge bg-surface px-3 py-1.5 text-xs font-medium text-content hover:border-primary/30 hover:text-primary"
            >
              <Play className="w-3.5 h-3.5" />
              {artifact.stream.video?.status === "ready" ? "Open published video" : "Open capture"}
            </a>
          ) : (
            <div className="text-xs text-content-muted flex items-center gap-2">
              <Play className="w-3.5 h-3.5" />
              {artifact.stream.video?.note ?? "Video capture pending"}
            </div>
          )}
        </div>
        {artifact.stream.video?.url ? (
          <video
            className="mt-3 w-full rounded-xl border border-edge bg-black"
            controls
            preload="metadata"
            src={artifact.stream.video.url}
          />
        ) : null}
        <div className="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
          <div className="rounded-xl border border-edge bg-surface p-3 max-h-72 overflow-auto">
            <div className="text-xs font-medium text-content mb-2">Streamed steps</div>
            <div className="space-y-2">
              {visibleEvents.map((event, index) => (
                <TelemetryEventCard key={`${event.at}-${index}`} event={event} />
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-edge bg-surface p-3">
            <div className="text-xs font-medium text-content mb-2">Final stream activity summary</div>
            <div className="space-y-1 text-xs text-content-muted">
              <div>Verdict: {artifact.stream.finalVerdict}</div>
              <div>Events captured: {artifact.stream.events.length}</div>
              <div>Average deterministic score: {artifact.stream.telemetry.averageDeterministicScore}</div>
              <div>Average judge score: {artifact.stream.telemetry.averageJudgeScore}</div>
              <div>Estimated judge tokens: {artifact.stream.telemetry.totalEstimatedTokens.toLocaleString()}</div>
              {typeof artifact.stream.telemetry.totalWallClockMs === "number" ? (
                <div>Total wall clock: {formatLatency(artifact.stream.telemetry.totalWallClockMs)}</div>
              ) : null}
              {typeof artifact.stream.telemetry.estimatedJudgeCostUsd === "number" ? (
                <div>Estimated judge spend: ${artifact.stream.telemetry.estimatedJudgeCostUsd.toFixed(4)}</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-4">
        {artifact.cases.map((item) => (
          <div key={item.caseId} className="rounded-xl border border-edge bg-surface-secondary p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-content">{item.title}</div>
                <div className="text-xs text-content-muted mt-1">{item.dataset}</div>
              </div>
              <div className="text-right text-xs text-content-muted">
                <div>Deterministic {item.deterministic.overall}</div>
                <div>LLM judge {item.llmJudge.score}</div>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-xs text-content-muted">
              <div>Duration: {formatLatency(item.telemetry.totalDurationMs)}</div>
              <div>Causal chain events: {item.telemetry.causalChainLength}</div>
              <div>Source hashes: {item.telemetry.sourceHashCount}</div>
              <div>Judge tokens: {item.llmJudge.estimatedTotalTokens.toLocaleString()}</div>
              <div className="text-content">Action: {item.telemetry.proposedAction}</div>
            </div>
          </div>
        ))}
      </div>

      {artifact.failures.length > 0 ? (
        <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-content">
          <div className="font-medium mb-1">Current failures</div>
          <ul className="space-y-1 text-content-muted">
            {artifact.failures.map((failure) => (
              <li key={failure}>- {failure}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-green-500/20 bg-green-500/5 p-3 text-xs text-content">
          The enterprise eval lane is passing with required LLM judging. This is the current proof that the product can reconstruct multi-actor temporal failures better than point benchmarks.
        </div>
      )}
    </section>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function WorkbenchView() {
  const trajectorySummary = useQuery(api.domains.trajectory.queries.getTrajectorySummary, {
    entityKey: "product:nodebench-ai",
    entityType: "product",
    windowDays: 90,
  }) as TrajectorySummaryData | undefined;
  const benchmarkTimeline = useQuery(api.domains.trajectory.queries.getTrajectoryTimeline, {
    entityKey: "product:nodebench-ai",
    entityType: "product",
    windowDays: 90,
  }) as { items: TrajectoryTimelineItem[] } | undefined;

  return (
    <div className="nb-page-shell flex flex-col">
      <WorkbenchHeader />

      <div className="nb-page-inner pb-28 sm:pb-24">
        <div className="nb-page-frame space-y-8">
          <Suspense fallback={<div className="h-[60px]" />}>
            <TrajectorySummaryBand
              summary={trajectorySummary ?? null}
              loading={trajectorySummary === undefined}
              emptyLabel="No product-level trajectory summary is available for benchmarks yet."
            />
          </Suspense>
          <Suspense fallback={<div className="h-[100px]" />}>
            <TrajectoryTimelinePanel
              items={(benchmarkTimeline?.items ?? []).filter((item) => item.kind === "benchmark" || item.kind === "intervention")}
              emptyLabel="No benchmark or intervention timeline has been projected yet."
            />
          </Suspense>
          <LiveGuardPanel />
          <EnterpriseEvalPanel />
          <Suspense fallback={<div className="h-[200px]" />}>
            <TelemetryInspector />
          </Suspense>

          {/* NOTE(coworker): Keep Workbench resilient if the Convex backend isn't updated yet.
              If `useQuery` throws (missing function/schema), fall back to static empty states
              instead of a hard error page. */}
          <WorkbenchDataBoundary>
            <WorkbenchData />
          </WorkbenchDataBoundary>

          {/* 4. Existing eval charts — collapsible deep dive */}
          <CapabilityDeepDive />
        </div>
      </div>
    </div>
  );
}

function WorkbenchData() {
  // NOTE(coworker): Phase 1 UI is read-only. Phase 2 will add actions to start runs.
  // Keep these subscriptions skipped by default so missing backend deployments do not
  // throw runtime errors in the frontend.
  const leaderboard = useQuery(
    api.domains.evaluation.workbenchQueries.getWorkbenchLeaderboard,
    WORKBENCH_LIVE_DATA_ENABLED ? {} : "skip",
  );
  const scenarioStats = useQuery(
    api.domains.evaluation.workbenchQueries.getScenarioStats,
    WORKBENCH_LIVE_DATA_ENABLED ? {} : "skip",
  );
  const runs = useQuery(
    api.domains.evaluation.workbenchQueries.listWorkbenchRuns,
    WORKBENCH_LIVE_DATA_ENABLED ? { limit: 25 } : "skip",
  );

  return (
    <Suspense fallback={<div className="h-[300px]" />}>
      {/* 1. Model leaderboard — score strip */}
      <ModelLeaderboard liveScores={WORKBENCH_LIVE_DATA_ENABLED ? (leaderboard ?? undefined) : undefined} />

      {/* 2. Scenario catalog — 4 scenarios */}
      <ScenarioCatalog scenarioStats={WORKBENCH_LIVE_DATA_ENABLED ? (scenarioStats ?? undefined) : undefined} />

      {/* 3. Runs table — empty state in Phase 1 */}
      <WorkbenchRunsTable runs={WORKBENCH_LIVE_DATA_ENABLED ? runs : []} />
    </Suspense>
  );
}

class WorkbenchDataBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(err: unknown) {
    // Most common cause: Convex functions not deployed yet for this build.
    // eslint-disable-next-line no-console
    console.warn("[Workbench] Data unavailable; rendering static Workbench UI.", err);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Suspense fallback={<div className="h-[300px]" />}>
          <ModelLeaderboard />
          <ScenarioCatalog />
          <WorkbenchRunsTable runs={[]} />
        </Suspense>
      );
    }
    return this.props.children;
  }
}
