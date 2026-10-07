/**
 * modelEvalData.ts — Pure data types and benchmark constants extracted from ModelEvalDashboard.
 *
 * Separated so consumers (e.g. ModelLeaderboard) can import types + data
 * without pulling in the heavy recharts dependency tree.
 */

export interface ModelEvalResult {
  model: string;
  passRate: number;
  avgTimeSeconds: number;
  totalTests: number;
  passed: number;
  failed: number;
  costPerMillion?: { input: number; output: number };
  provider?: string;
}

export interface ScenarioResult {
  scenario: string;
  passRate: number;
  avgTimeSeconds: number;
  modelBreakdown: { model: string; passed: boolean; timeSeconds: number }[];
}

export interface EvalDashboardProps {
  modelResults: ModelEvalResult[];
  scenarioResults?: ScenarioResult[];
  runDate?: string;
  totalTime?: number;
  suiteId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// LATEST BENCHMARK DATA (Jan 8, 2026 - Full 70-eval run)
// ═══════════════════════════════════════════════════════════════════════════

export const LATEST_EVAL_DATA: ModelEvalResult[] = [
  {
    model: "gemini-3-flash-preview",
    passRate: 100,
    avgTimeSeconds: 16.4,
    totalTests: 10,
    passed: 10,
    failed: 0,
    costPerMillion: { input: 0.5, output: 3.0 },
    provider: "google",
  },
  {
    model: "gpt-5.4-mini",
    passRate: 100,
    avgTimeSeconds: 46.2,
    totalTests: 10,
    passed: 10,
    failed: 0,
    costPerMillion: { input: 0.25, output: 2.0 },
    provider: "openai",
  },
  {
    model: "deepseek-v3.2",
    passRate: 100,
    avgTimeSeconds: 80.7,
    totalTests: 10,
    passed: 10,
    failed: 0,
    costPerMillion: { input: 0.25, output: 0.38 },
    provider: "openrouter",
  },
  {
    model: "claude-haiku-4.5",
    passRate: 90,
    avgTimeSeconds: 38.9,
    totalTests: 10,
    passed: 9,
    failed: 1,
    costPerMillion: { input: 1.0, output: 5.0 },
    provider: "anthropic",
  },
  {
    model: "minimax-m2.1",
    passRate: 90,
    avgTimeSeconds: 27.3,
    totalTests: 10,
    passed: 9,
    failed: 1,
    costPerMillion: { input: 0.28, output: 1.2 },
    provider: "openrouter",
  },
  {
    model: "deepseek-r1",
    passRate: 80,
    avgTimeSeconds: 53.2,
    totalTests: 10,
    passed: 8,
    failed: 2,
    costPerMillion: { input: 0.7, output: 2.4 },
    provider: "openrouter",
  },
  {
    model: "qwen3-235b",
    passRate: 70,
    avgTimeSeconds: 33.9,
    totalTests: 10,
    passed: 7,
    failed: 3,
    costPerMillion: { input: 0.18, output: 0.54 },
    provider: "openrouter",
  },
];

export const LATEST_SCENARIO_DATA: ScenarioResult[] = [
  { scenario: "Banker vague outreach debrief", passRate: 100, avgTimeSeconds: 35.0, modelBreakdown: [] },
  { scenario: "VC wedge from OSS signal", passRate: 100, avgTimeSeconds: 41.9, modelBreakdown: [] },
  { scenario: "CTO risk exposure + patch plan", passRate: 100, avgTimeSeconds: 41.8, modelBreakdown: [] },
  { scenario: "Exec vendor evaluation", passRate: 85.7, avgTimeSeconds: 55.2, modelBreakdown: [] },
  { scenario: "Ecosystem second-order effects", passRate: 71.4, avgTimeSeconds: 37.2, modelBreakdown: [] },
  { scenario: "Founder positioning vs incumbent", passRate: 71.4, avgTimeSeconds: 59.1, modelBreakdown: [] },
  { scenario: "Academic literature anchor", passRate: 100, avgTimeSeconds: 32.6, modelBreakdown: [] },
  { scenario: "Quant signal extraction", passRate: 100, avgTimeSeconds: 45.1, modelBreakdown: [] },
  { scenario: "Product designer schema card", passRate: 85.7, avgTimeSeconds: 36.0, modelBreakdown: [] },
  { scenario: "Sales engineer one-screen summary", passRate: 85.7, avgTimeSeconds: 36.7, modelBreakdown: [] },
];
