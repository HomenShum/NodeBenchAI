"use client";

import React, { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  LineChart,
  Line,
  Cell,
} from "recharts";
import {
  Activity,
  Clock,
  DollarSign,
  CheckCircle2,
  XCircle,
  Zap,
  TrendingUp,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS (re-exported from lightweight data module to avoid
// forcing consumers to pull in the recharts dependency tree)
// ═══════════════════════════════════════════════════════════════════════════

export type { ModelEvalResult, ScenarioResult, EvalDashboardProps } from "./modelEvalData";
import type { ModelEvalResult, ScenarioResult, EvalDashboardProps } from "./modelEvalData";

type GaiaEvalSnapshot = {
  suiteId: string;
  lane: string;
  generatedAtIso: string;
  config: string;
  split: string;
  taskCount: number;
  concurrency: number;
  baseline: { model: string; correct: number; passRatePct: number; avgMs: number };
  tools: {
    model: string;
    mode: string;
    correct: number;
    passRatePct: number;
    avgMs: number;
    avgToolCalls: number;
  };
  improved: number;
  regressions: number;
  notes?: string;
};

// Re-export data from lightweight module (avoids pulling recharts into consumers)
export { LATEST_EVAL_DATA, LATEST_SCENARIO_DATA } from "./modelEvalData";
import { LATEST_EVAL_DATA, LATEST_SCENARIO_DATA } from "./modelEvalData";

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

const getPassRateColor = (rate: number): string => {
  if (rate >= 90) return "#10b981"; // indigo-500
  if (rate >= 70) return "#f59e0b"; // amber-500
  if (rate >= 50) return "#f97316"; // orange-500
  return "#ef4444"; // red-500
};

const getProviderColor = (provider?: string): string => {
  switch (provider) {
    case "google":
      return "#4285f4";
    case "openai":
      return "#10a37f";
    case "anthropic":
      return "#d97706";
    case "openrouter":
      return "#8b5cf6";
    default:
      return "#6b7280";
  }
};

/** Human-readable model display name */
function formatModelName(slug: string): string {
  const MAP: Record<string, string> = {
    "gemini-3.1-pro-preview": "Gemini 3.1 Pro",
    "gemini-3-flash-preview": "Gemini 3 Flash",
    "gpt-5.4-mini": "GPT-5.4 Mini",
    "deepseek-v3.2": "DeepSeek V3.2",
    "claude-haiku-4.5": "Claude Haiku 4.5",
    "minimax-m2.1": "MiniMax M2.1",
    "deepseek-r1": "DeepSeek R1",
    "qwen3-235b": "Qwen 3 235B",
  };
  return MAP[slug] ?? slug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export const ModelEvalDashboard: React.FC<EvalDashboardProps> = ({
  modelResults = LATEST_EVAL_DATA,
  scenarioResults = LATEST_SCENARIO_DATA,
  runDate = "2026-01-08",
  totalTime = 192.6,
  suiteId = "core",
}) => {
  const [activeTab, setActiveTab] = useState<"overview" | "scenarios" | "cost">("overview");
  const [gaiaWeb, setGaiaWeb] = useState<GaiaEvalSnapshot | null>(null);
  const [gaiaFiles, setGaiaFiles] = useState<GaiaEvalSnapshot | null>(null);
  const [gaiaMedia, setGaiaMedia] = useState<GaiaEvalSnapshot | null>(null);
  const [gaiaAudio, setGaiaAudio] = useState<GaiaEvalSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async (url: string, setter: (v: GaiaEvalSnapshot) => void) => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as GaiaEvalSnapshot;
        if (!cancelled) setter(json);
      } catch {
        // ignore
      }
    };

    load("/evals/gaia_capability_latest.json", (v) => setGaiaWeb(v));
    load("/evals/gaia_capability_files_latest.json", (v) => setGaiaFiles(v));
    load("/evals/gaia_capability_media_latest.json", (v) => setGaiaMedia(v));
    load("/evals/gaia_capability_audio_latest.json", (v) => setGaiaAudio(v));

    return () => {
      cancelled = true;
    };
  }, []);

  // Sort by pass rate for display
  const sortedModels = [...modelResults].sort((a, b) => b.passRate - a.passRate);

  // Calculate summary stats
  const avgPassRate = modelResults.reduce((sum, m) => sum + m.passRate, 0) / modelResults.length;
  const totalPassed = modelResults.reduce((sum, m) => sum + m.passed, 0);
  const totalTests = modelResults.reduce((sum, m) => sum + m.totalTests, 0);
  const fastestModel = [...modelResults].sort((a, b) => a.avgTimeSeconds - b.avgTimeSeconds)[0];
  const bestModel = sortedModels[0];

  // Prepare radar chart data
  const radarData = sortedModels
    .filter((m) => m.passRate > 0)
    .map((m) => ({
      model: formatModelName(m.model),
      passRate: m.passRate,
      speed: Math.max(0, 100 - m.avgTimeSeconds), // Inverse speed score
      costEfficiency: m.costPerMillion
        ? Math.max(0, 100 - (m.costPerMillion.input + m.costPerMillion.output) * 10)
        : 50,
    }));

  return (
    <div className="space-y-6 p-4 bg-surface rounded-lg border border-edge">
      {/* v0.1.0 Announcement Banner */}
      <div className="bg-gradient-to-r from-indigo-500/10 to-indigo-500/10 border border-indigo-500/30 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <Zap className="w-5 h-5 text-indigo-600" />
          <div>
            <h3 className="text-content-secondary font-semibold text-sm">v0.1.0 — Gemini 3 Flash is Now Default</h3>
            <p className="text-xs text-content-secondary mt-0.5">
              100% pass rate • 16.1s avg latency • $0.10/million input tokens •
              <span className="text-indigo-600 ml-1">3× faster than Claude Haiku</span>
            </p>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-content flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-600" />
            AI Model Evaluation
          </h2>
          <p className="text-xs text-content-secondary mt-1">
            Suite: <span className="font-mono text-content-secondary">{suiteId}</span> | Run: {runDate} | Total Time: {totalTime.toFixed(1)}s
          </p>
        </div>
        <div className="flex gap-2">
          {["overview", "scenarios", "cost"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as typeof activeTab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                activeTab === tab
                  ? "bg-indigo-100 text-content border border-indigo-300"
                  : "bg-surface-secondary text-content-secondary hover:bg-surface-secondary"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-950/40 dark:to-indigo-900/30 rounded-lg p-4 border border-indigo-200 dark:border-indigo-800/50">
          <div className="text-xs font-bold tracking-wide text-indigo-600 dark:text-indigo-400">Best Model</div>
          <div className="text-lg font-bold text-content mt-1">{formatModelName(bestModel.model)}</div>
          <div className="text-xs text-content-secondary flex items-center gap-1 mt-1">
            <CheckCircle2 className="w-3 h-3" />
            {bestModel.passRate}% pass rate
          </div>
        </div>

        <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/30 rounded-lg p-4 border border-blue-200 dark:border-blue-800/50">
          <div className="text-xs font-bold tracking-wide text-blue-600 dark:text-blue-400">Fastest Model</div>
          <div className="text-lg font-bold text-blue-900 dark:text-blue-100 mt-1">{formatModelName(fastestModel.model)}</div>
          <div className="text-xs text-blue-700 dark:text-blue-300 flex items-center gap-1 mt-1">
            <Zap className="w-3 h-3" />
            {fastestModel.avgTimeSeconds.toFixed(1)}s avg
          </div>
        </div>

        <div className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950/40 dark:to-amber-900/30 rounded-lg p-4 border border-amber-200 dark:border-amber-800/50">
          <div className="text-xs font-bold tracking-wide text-amber-600 dark:text-amber-400">Avg Pass Rate</div>
          <div className="text-lg font-bold text-amber-900 dark:text-amber-100 mt-1">{avgPassRate.toFixed(1)}%</div>
          <div className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1 mt-1">
            <TrendingUp className="w-3 h-3" />
            {totalPassed}/{totalTests} tests
          </div>
        </div>

        <div className="bg-gradient-to-br from-violet-50 to-violet-100 dark:from-violet-950/40 dark:to-violet-900/30 rounded-lg p-4 border border-violet-200 dark:border-violet-800/50">
          <div className="text-xs font-bold tracking-wide text-violet-600 dark:text-violet-400">Models Tested</div>
          <div className="text-lg font-bold text-violet-900 dark:text-violet-100 mt-1">{modelResults.length}</div>
          <div className="text-xs text-violet-700 dark:text-violet-300 flex items-center gap-1 mt-1">
            <Clock className="w-3 h-3" />
            {scenarioResults?.length || 10} scenarios
          </div>
        </div>
      </div>

      {activeTab === "overview" && (
        <div className="bg-surface-secondary rounded-lg p-4 border border-edge">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-content">Capability Lift</h3>
              <p className="text-xs text-content-secondary mt-1">
                Automated capability snapshots from evaluation tests. View detailed traces in the Activity Log.
              </p>
            </div>
            <div className="text-xs text-content-muted">
              Scores only — no prompts stored
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            {([
              { label: "Web Lane", snap: gaiaWeb },
              { label: "File Lane", snap: gaiaFiles },
              { label: "Media Lane", snap: gaiaMedia },
              { label: "Audio Lane", snap: gaiaAudio },
            ] as const).map(({ label, snap }) => {
              const delta = snap ? snap.tools.passRatePct - snap.baseline.passRatePct : 0;
              return (
                <div key={label} className="bg-surface rounded-lg border border-edge p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-bold tracking-wide text-content-secondary">
                      {label}
                    </div>
                    {snap ? (
                      <div className="text-xs text-content-secondary font-mono tabular-nums">
                        {snap.generatedAtIso.slice(0, 19).replace("T", " ")}
                      </div>
                    ) : null}
                  </div>

                  {!snap ? (
                    <div className="mt-2 text-sm text-content-secondary">
                      No snapshot yet. Run capability evaluation tests to generate data.
                    </div>
                  ) : (
                    <div className="mt-2 space-y-1">
                      <div className="text-sm text-content">
                        Tools{" "}
                        <span className="font-semibold tabular-nums">
                          {snap.tools.passRatePct.toFixed(1)}%
                        </span>{" "}
                        vs Baseline{" "}
                        <span className="font-semibold tabular-nums">
                          {snap.baseline.passRatePct.toFixed(1)}%
                        </span>{" "}
                        <span
                          className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                            delta >= 0 ? "bg-indigo-100 text-content" : "bg-red-100 text-red-900"
                          }`}
                        >
                          Δ {delta >= 0 ? "+" : ""}
                          {delta.toFixed(1)}%
                        </span>
                      </div>
                      <div className="text-xs text-content-secondary">
                        <span className="font-mono tabular-nums">{snap.taskCount}</span> tasks •{" "}
                        <span className="font-mono tabular-nums">
                          {snap.tools.avgToolCalls.toFixed(1)}
                        </span> avg tool calls
                      </div>
                      <div className="text-xs text-content-secondary">
                        <span className="font-mono tabular-nums">{snap.improved}</span> improved •{" "}
                        <span className="font-mono tabular-nums">{snap.regressions}</span> {snap.regressions === 1 ? 'regression' : 'regressions'}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Content based on activeTab */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Pass Rate Bar Chart */}
          <div className="bg-surface-secondary rounded-lg p-4 border border-edge">
            <h3 className="text-sm font-semibold text-content mb-4">Pass Rate by Model</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={sortedModels} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="model" width={100} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={((value: number) => [`${value}%`, "Pass Rate"]) as any}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="passRate" radius={[0, 4, 4, 0]}>
                  {sortedModels.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={getPassRateColor(entry.passRate)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Performance Radar */}
          <div className="bg-surface-secondary rounded-lg p-4 border border-edge">
            <h3 className="text-sm font-semibold text-content mb-4">Multi-Dimensional Performance</h3>
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="#d1d5db" />
                <PolarAngleAxis dataKey="model" tick={{ fontSize: 9 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9 }} />
                <Radar name="Pass Rate" dataKey="passRate" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
                <Radar name="Speed" dataKey="speed" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
                <Radar name="Cost Efficiency" dataKey="costEfficiency" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.3} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Response Time Comparison */}
          <div className="col-span-2 bg-surface-secondary rounded-lg p-4 border border-edge">
            <h3 className="text-sm font-semibold text-content mb-4">Average Response Time (seconds)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={sortedModels}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="model" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={(v) => `${v}s`} tick={{ fontSize: 10 }} />
                <Tooltip formatter={((value: number) => [`${value.toFixed(1)}s`, "Avg Time"]) as any} />
                <Bar dataKey="avgTimeSeconds" fill="#6366f1" radius={[4, 4, 0, 0]}>
                  {sortedModels.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={getProviderColor(entry.provider)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeTab === "scenarios" && scenarioResults && (
        <div className="space-y-4">
          <div className="bg-surface-secondary rounded-lg p-4 border border-edge">
            <h3 className="text-sm font-semibold text-content mb-4">Scenario Pass Rates</h3>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={scenarioResults} layout="vertical" margin={{ left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="scenario" width={200} tick={{ fontSize: 10 }} />
                <Tooltip
                  formatter={((value: number) => [`${value.toFixed(1)}%`, "Pass Rate"]) as any}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="passRate" radius={[0, 4, 4, 0]}>
                  {scenarioResults.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={getPassRateColor(entry.passRate)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeTab === "cost" && (
        <div className="space-y-4">
          <div className="bg-surface-secondary rounded-lg p-4 border border-edge">
            <h3 className="text-sm font-semibold text-content mb-4">Cost per Million Tokens</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={sortedModels.filter((m) => m.costPerMillion)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="model" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={(v) => `$${v}`} tick={{ fontSize: 10 }} />
                <Tooltip formatter={((value: number) => [`$${value.toFixed(2)}`, ""]) as any} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="costPerMillion.input" name="Input $/1M" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="costPerMillion.output" name="Output $/1M" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Cost vs Performance scatter-like view */}
          <div className="bg-surface-secondary rounded-lg p-4 border border-edge">
            <h3 className="text-sm font-semibold text-content mb-4">Value Analysis: Pass Rate vs Total Cost</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="text-xs uppercase tracking-wider text-content-muted border-b border-edge">
                  <tr>
                    <th className="py-2 pr-4">Model</th>
                    <th className="py-2 pr-4">Provider</th>
                    <th className="py-2 pr-4">Pass Rate</th>
                    <th className="py-2 pr-4">Input $/1M</th>
                    <th className="py-2 pr-4">Output $/1M</th>
                    <th className="py-2 pr-4">Total $/1M</th>
                    <th className="py-2">Value Score</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedModels
                    .filter((m) => m.costPerMillion)
                    .map((m) => {
                      const totalCost = (m.costPerMillion?.input || 0) + (m.costPerMillion?.output || 0);
                      const valueScore = m.passRate / (totalCost || 1);
                      return (
                        <tr key={m.model} className="border-b border-edge hover:bg-surface-hover/50">
                          <td className="py-2 pr-4 font-semibold text-content">{formatModelName(m.model)}</td>
                          <td className="py-2 pr-4">
                            <span
                              className="inline-block px-2 py-0.5 rounded text-xs font-medium text-white"
                              style={{ backgroundColor: getProviderColor(m.provider) }}
                            >
                              {m.provider}
                            </span>
                          </td>
                          <td className="py-2 pr-4">
                            <span
                              className="inline-flex items-center gap-1"
                              style={{ color: getPassRateColor(m.passRate) }}
                            >
                              {m.passRate >= 90 ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                              {m.passRate}%
                            </span>
                          </td>
                          <td className="py-2 pr-4">${m.costPerMillion?.input.toFixed(2)}</td>
                          <td className="py-2 pr-4">${m.costPerMillion?.output.toFixed(2)}</td>
                          <td className="py-2 pr-4 font-semibold">${totalCost.toFixed(2)}</td>
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-16 rounded-full bg-surface-secondary overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-indigo-500 to-indigo-400"
                                  style={{ width: `${Math.min(100, valueScore * 2)}%` }}
                                />
                              </div>
                              <span className="text-content-secondary">{valueScore.toFixed(1)}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Detailed Results Table */}
      <div className="bg-surface-secondary rounded-lg p-4 border border-edge">
        <h3 className="text-sm font-semibold text-content mb-4">Detailed Results</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="text-xs uppercase tracking-wider text-content-muted border-b border-edge">
              <tr>
                <th className="py-2 pr-4">Model</th>
                <th className="py-2 pr-4">Provider</th>
                <th className="py-2 pr-4 text-center">Passed</th>
                <th className="py-2 pr-4 text-center">Failed</th>
                <th className="py-2 pr-4">Pass Rate</th>
                <th className="py-2 pr-4">Avg Time</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedModels.map((m) => (
                <tr key={m.model} className="border-b border-edge hover:bg-surface-hover/50">
                  <td className="py-2.5 pr-4 font-semibold text-content">{formatModelName(m.model)}</td>
                  <td className="py-2.5 pr-4">
                    <span
                      className="inline-block px-2 py-0.5 rounded text-xs font-medium text-white"
                      style={{ backgroundColor: getProviderColor(m.provider) }}
                    >
                      {m.provider}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-center text-indigo-600 font-semibold">{m.passed}</td>
                  <td className="py-2.5 pr-4 text-center text-rose-600 font-semibold">{m.failed}</td>
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-20 rounded-full bg-surface-secondary overflow-hidden">
                        <div
                          className="h-full transition-all"
                          style={{
                            width: `${m.passRate}%`,
                            backgroundColor: getPassRateColor(m.passRate),
                          }}
                        />
                      </div>
                      <span className="font-semibold" style={{ color: getPassRateColor(m.passRate) }}>
                        {m.passRate}%
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 text-content-secondary">{m.avgTimeSeconds.toFixed(1)}s</td>
                  <td className="py-2.5">
                    {m.passRate === 100 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 text-content text-xs font-bold">
                        <CheckCircle2 className="w-3 h-3" /> PERFECT
                      </span>
                    ) : m.passRate >= 80 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                        <TrendingUp className="w-3 h-3" /> GOOD
                      </span>
                    ) : m.passRate >= 50 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 text-xs font-bold">
                        PARTIAL
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-xs font-bold">
                        <XCircle className="w-3 h-3" /> FAIL
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer */}
      <div className="text-xs text-content-muted text-center border-t border-edge pt-4">
        AI Evaluation Framework | {modelResults.length} models | {totalTests} total tests | Generated {runDate}
      </div>
    </div>
  );
};

export default ModelEvalDashboard;
