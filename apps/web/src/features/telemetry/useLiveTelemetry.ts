/**
 * useLiveTelemetry — Hooks to fetch real eval + trace data from the NodeBench server.
 *
 * Replaces demo data factories with live data from:
 * - GET /search/eval-history → eval run history + per-scenario breakdowns
 * - GET /search/recent → recent search traces for tool breakdown
 *
 * Falls back to demo data when server is unreachable (guest/demo mode).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  EvalScorecardData,
  EvalRunResult,
  ContextBundle,
  TrajectoryData,
  TrajectoryStep,
} from "./types";

/* ─── Config ───────────────────────────────────────────────────────────────── */

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5191";
const POLL_INTERVAL_MS = 30_000; // refresh every 30s

/* ─── Eval Scorecard Hook ──────────────────────────────────────────────────── */

export interface LiveEvalState {
  data: EvalScorecardData | null;
  isLoading: boolean;
  error: string | null;
  isLive: boolean;
  lastFetched: string | null;
  refresh: () => void;
}

export function useLiveEvalScorecard(): LiveEvalState {
  const [data, setData] = useState<EvalScorecardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(null);

  const fetchEvals = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`${API_BASE}/search/eval-history`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();

      if (json.success && json.totalRuns > 0) {
        const runs: EvalRunResult[] = json.runs.map((r: Record<string, unknown>) => ({
          runId: r.runId as string,
          timestamp: r.timestamp as string,
          passRate: (r.passRate as number) ?? 0,
          criteriaRate: (r.geminiPassRate as number) ?? (r.passRate as number) ?? 0,
          totalQueries: (r.totalQueries as number) ?? 0,
          byScenario: parseScenarioBreakdown(r),
        }));

        // Sort by timestamp descending
        runs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        const latest = runs[0];
        const history = runs.slice(0, 10);

        setData({ latest, history });
        setError(null);
        setLastFetched(new Date().toISOString());
      } else {
        setError("No eval runs found");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvals();
    const interval = setInterval(fetchEvals, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchEvals]);

  return {
    data,
    isLoading,
    error,
    isLive: data !== null && error === null,
    lastFetched,
    refresh: fetchEvals,
  };
}

function parseScenarioBreakdown(run: Record<string, unknown>): EvalRunResult["byScenario"] {
  // Try to extract from results_json if available
  try {
    const resultsJson = run.resultsJson as string | undefined;
    if (!resultsJson) return [];
    const results = JSON.parse(resultsJson);
    if (!Array.isArray(results)) return [];

    // Group by category
    const byCategory = new Map<string, { pass: number; total: number }>();
    for (const r of results) {
      const cat = (r.category ?? r.scenario ?? "unknown") as string;
      const entry = byCategory.get(cat) ?? { pass: 0, total: 0 };
      entry.total++;
      if (r.passed || r.structuralPass) entry.pass++;
      byCategory.set(cat, entry);
    }

    return Array.from(byCategory.entries()).map(([scenario, { pass, total }]) => ({
      scenario,
      passCount: pass,
      totalCount: total,
      passRate: total > 0 ? pass / total : 0,
    }));
  } catch {
    return [];
  }
}

/* ─── Search Trace Accumulator Hook ────────────────────────────────────────── */

export interface ToolAggregate {
  toolName: string;
  category: string;
  calls: number;
  avgMs: number;
  totalCostUsd: number;
  errors: number;
  successRate: number;
}

export interface ActionEntry {
  id: string;
  timestamp: string;
  toolName: string;
  entity: string;
  latencyMs: number;
  status: "success" | "slow" | "error";
  inputSummary: string;
  outputSummary: string;
}

export interface ErrorEntry {
  id: string;
  timestamp: string;
  toolName: string;
  message: string;
  severity: "warning" | "error" | "fatal";
}

export interface LiveTraceState {
  tools: ToolAggregate[];
  actions: ActionEntry[];
  errors: ErrorEntry[];
  totalActions: number;
  totalCost: number;
  avgLatency: number;
  totalErrors: number;
  sessionDuration: string;
  isLive: boolean;
  lastFetched: string | null;
}

/** Accumulates trace data from recent searches into tool breakdown + action feed */
export function useLiveTraceAggregates(): LiveTraceState {
  const [traces, setTraces] = useState<Array<{
    timestamp: string;
    classification: string;
    entity: string | null;
    latencyMs: number;
    trace: Array<{ step: string; tool?: string; durationMs: number; status: string; detail?: string }>;
    judge?: { verdict: string; score: number; failingCriteria?: string[] };
  }>>([]);
  const [isLive, setIsLive] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);

  const fetchRecent = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/search/recent`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success && Array.isArray(json.searches)) {
        setTraces(json.searches);
        setIsLive(true);
        setLastFetched(new Date().toISOString());
      }
    } catch {
      // Server unreachable — stay in demo mode
    }
  }, []);

  useEffect(() => {
    fetchRecent();
    const interval = setInterval(fetchRecent, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchRecent]);

  // Aggregate traces into tool breakdown
  const { tools, actions, errors } = useMemo(() => {
    const toolMap = new Map<string, { calls: number; totalMs: number; errors: number; category: string }>();
    const actionList: ActionEntry[] = [];
    const errorList: ErrorEntry[] = [];
    let actionId = 0;
    let errorId = 0;

    for (const search of traces) {
      for (const step of (search.trace ?? [])) {
        const toolName = step.tool ?? step.step;
        const category = inferCategory(toolName);
        const existing = toolMap.get(toolName) ?? { calls: 0, totalMs: 0, errors: 0, category };
        existing.calls++;
        existing.totalMs += step.durationMs ?? 0;
        if (step.status === "error") existing.errors++;
        toolMap.set(toolName, existing);

        // Action entry
        const isError = step.status === "error";
        const isSlow = !isError && (step.durationMs ?? 0) > 5000;
        actionList.push({
          id: `trace-${actionId++}`,
          timestamp: search.timestamp,
          toolName,
          entity: search.entity ?? search.classification ?? "general",
          latencyMs: step.durationMs ?? 0,
          status: isError ? "error" : isSlow ? "slow" : "success",
          inputSummary: step.detail ?? `${step.step} step`,
          outputSummary: isError
            ? `Error: ${step.detail ?? "unknown"}`
            : `${step.status} in ${step.durationMs}ms`,
        });

        if (isError) {
          errorList.push({
            id: `err-${errorId++}`,
            timestamp: search.timestamp,
            toolName,
            message: step.detail ?? "Step failed",
            severity: (step.durationMs ?? 0) > 30000 ? "fatal" : "error",
          });
        }
      }

      // Judge failures as warnings
      if (search.judge?.verdict === "fail") {
        errorList.push({
          id: `err-${errorId++}`,
          timestamp: search.timestamp,
          toolName: "judge",
          message: `Judge failed: ${(search.judge.failingCriteria ?? []).join(", ")}`,
          severity: "warning",
        });
      }
    }

    const toolList: ToolAggregate[] = Array.from(toolMap.entries()).map(([name, data]) => ({
      toolName: name,
      category: data.category,
      calls: data.calls,
      avgMs: data.calls > 0 ? Math.round(data.totalMs / data.calls) : 0,
      totalCostUsd: estimateCost(name, data.calls, data.totalMs),
      errors: data.errors,
      successRate: data.calls > 0 ? Math.round(((data.calls - data.errors) / data.calls) * 1000) / 10 : 100,
    }));

    toolList.sort((a, b) => b.calls - a.calls);

    return { tools: toolList, actions: actionList, errors: errorList };
  }, [traces]);

  const totalActions = tools.reduce((s, t) => s + t.calls, 0);
  const totalCost = tools.reduce((s, t) => s + t.totalCostUsd, 0);
  const totalErrors = tools.reduce((s, t) => s + t.errors, 0);
  const avgLatency = totalActions > 0
    ? Math.round(tools.reduce((s, t) => s + t.avgMs * t.calls, 0) / totalActions)
    : 0;

  // Compute session duration from first to last trace
  const timestamps = traces.map(t => new Date(t.timestamp).getTime()).filter(Boolean);
  const sessionMs = timestamps.length >= 2
    ? Math.max(...timestamps) - Math.min(...timestamps)
    : 0;
  const sessionDuration = sessionMs > 0
    ? `${Math.floor(sessionMs / 3600000)}h ${Math.floor((sessionMs % 3600000) / 60000)}m`
    : "0m";

  return {
    tools,
    actions,
    errors,
    totalActions,
    totalCost,
    avgLatency,
    totalErrors,
    sessionDuration,
    isLive,
    lastFetched,
  };
}

/* ─── Context Bundle Hook ──────────────────────────────────────────────────── */

export interface LiveContextState {
  data: ContextBundle | null;
  isLive: boolean;
  isRefreshing: boolean;
  refresh: () => void;
}

/** Fetches real context bundle from the last search response */
export function useLiveContextBundle(): LiveContextState {
  const [data, setData] = useState<ContextBundle | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Trigger a lightweight search to get fresh context bundle
      const res = await fetch(`${API_BASE}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "system status", lens: "operator" }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();

      if (json.context) {
        const ctx = json.context;
        setData({
          pinned: {
            canonicalMission: ctx.pinned?.mission ?? "",
            wedge: ctx.pinned?.wedge ?? "",
            companyState: ctx.pinned?.state ?? "Unknown",
            identityConfidence: ctx.pinned?.confidence ?? 0,
            lastPacketSummary: ctx.pinned?.lastPacket ?? null,
            contradictionsCount: ctx.pinned?.contradictions ?? 0,
            sessionActionsCount: ctx.pinned?.sessionActions ?? 0,
            estimatedTokens: ctx.tokenBudget ?? 0,
          },
          injected: {
            weeklyResetSummary: ctx.injected?.weeklyReset ?? null,
            recentMilestones: (ctx.injected?.milestones ?? []).map((m: string) => ({
              title: m,
              timestamp: new Date().toISOString(),
            })),
            entitySignals: ctx.injected?.entitySignals ?? [],
            dogfoodVerdict: ctx.injected?.dogfood ?? null,
            estimatedTokens: Math.round((ctx.tokenBudget ?? 0) * 0.4),
          },
          archival: {
            totalActions: ctx.archival?.totalActions ?? 0,
            totalMilestones: ctx.archival?.totalMilestones ?? 0,
            totalStateDiffs: 0,
            oldestActionDate: null,
            retrievalTools: ["search_actions", "get_milestones", "get_state_history"],
          },
          totalTokenBudget: ctx.tokenBudget ?? 500,
          tokenBudgetUsed: Math.round((ctx.tokenBudget ?? 500) * 0.78),
          fetchedAt: new Date().toISOString(),
        });
      }
    } catch {
      // Server unreachable — keep current state
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    data,
    isLive: data !== null,
    isRefreshing,
    refresh,
  };
}

/* ─── Trajectory from Search Trace ─────────────────────────────────────────── */

/** Convert a search response trace into TrajectoryData for TrajectoryPanel */
export function traceToTrajectory(
  query: string,
  trace: Array<{ step: string; tool?: string; durationMs: number; status: string; detail?: string }>,
  totalLatencyMs: number,
): TrajectoryData {
  const steps: TrajectoryStep[] = trace.map((t, i) => ({
    id: `step-${i}`,
    toolName: t.tool ?? t.step,
    domain: inferCategory(t.tool ?? t.step),
    latencyMs: t.durationMs,
    status: t.status === "ok" ? "pass" : t.status === "error" ? "fail" : t.status === "skip" ? "skipped" : "pending",
    inputSummary: t.detail ?? `${t.step} execution`,
    outputPreview: `${t.status} in ${t.durationMs}ms`,
    timestamp: new Date().toISOString(),
    tokenEstimate: Math.round(t.durationMs * 0.1), // rough estimate
  }));

  return {
    query,
    steps,
    totalLatencyMs,
    toolCount: steps.length,
    totalTokenEstimate: steps.reduce((s, st) => s + (st.tokenEstimate ?? 0), 0),
    startedAt: new Date(Date.now() - totalLatencyMs).toISOString(),
    completedAt: new Date().toISOString(),
  };
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

function inferCategory(toolName: string): string {
  if (/classify|context|assemble/.test(toolName)) return "pipeline";
  if (/web_search|linkup|fetch|recon/.test(toolName)) return "research";
  if (/founder|weekly|reset|delegation/.test(toolName)) return "founder";
  if (/judge|eval|verify/.test(toolName)) return "verification";
  if (/deep_sim|scenario|claim|intervention/.test(toolName)) return "deep-sim";
  if (/trajectory|trust|compounding/.test(toolName)) return "trajectory";
  if (/discover|quick_ref|workflow/.test(toolName)) return "mcp";
  if (/session|memory|note/.test(toolName)) return "session";
  if (/git|pr|diff/.test(toolName)) return "git";
  return "general";
}

function estimateCost(toolName: string, calls: number, totalMs: number): number {
  // Rough cost model: LLM-heavy tools cost more
  const isLlm = /extract|judge|sim|brief|memo|scenario/.test(toolName);
  const costPerCall = isLlm ? 0.005 : 0.0002;
  return Math.round(calls * costPerCall * 100) / 100;
}
