/**
 * types.ts — Shared types for the telemetry & agent trajectory visualization feature.
 *
 * Used by TrajectoryPanel, ContextInspector, and EvalScorecard.
 */

/* ─── Trajectory Types ───────────────────────────────────────────────────── */

export type TrajectoryStepStatus = "pass" | "fail" | "pending" | "skipped";

export interface TrajectoryStep {
  /** Unique step ID */
  id: string;
  /** MCP tool name that was called */
  toolName: string;
  /** Tool domain/category */
  domain?: string;
  /** Execution latency in ms */
  latencyMs: number;
  /** Step status */
  status: TrajectoryStepStatus;
  /** Compact summary of the input args */
  inputSummary: string;
  /** Compact summary of the output */
  outputPreview: string;
  /** Full input JSON (shown on expand) */
  inputFull?: Record<string, unknown>;
  /** Full output JSON (shown on expand) */
  outputFull?: Record<string, unknown>;
  /** Timestamp ISO */
  timestamp: string;
  /** Estimated token usage for this step */
  tokenEstimate?: number;
}

export interface TrajectoryData {
  /** The user's original query */
  query: string;
  /** All execution steps in order */
  steps: TrajectoryStep[];
  /** Total wall-clock latency ms */
  totalLatencyMs: number;
  /** Total tool invocations */
  toolCount: number;
  /** Estimated total tokens across all steps */
  totalTokenEstimate: number;
  /** Timestamp when the trajectory started */
  startedAt: string;
  /** Timestamp when the trajectory completed */
  completedAt?: string;
}

/* ─── Context Inspector Types ────────────────────────────────────────────── */

export interface PinnedContextView {
  canonicalMission: string;
  wedge: string;
  companyState: string;
  identityConfidence: number;
  lastPacketSummary: string | null;
  contradictionsCount: number;
  sessionActionsCount: number;
  estimatedTokens: number;
}

export interface InjectedContextView {
  weeklyResetSummary: string | null;
  recentMilestones: Array<{ title: string; timestamp: string }>;
  entitySignals: string[];
  dogfoodVerdict: string | null;
  estimatedTokens: number;
}

export interface ArchivalPointerView {
  totalActions: number;
  totalMilestones: number;
  totalStateDiffs: number;
  oldestActionDate: string | null;
  retrievalTools: string[];
}

export interface ContextBundle {
  pinned: PinnedContextView;
  injected: InjectedContextView;
  archival: ArchivalPointerView;
  totalTokenBudget: number;
  tokenBudgetUsed: number;
  fetchedAt: string;
}

/* ─── Eval Scorecard Types ───────────────────────────────────────────────── */

export interface EvalScenarioResult {
  scenario: string;
  passCount: number;
  totalCount: number;
  passRate: number;
}

export interface EvalRunResult {
  /** Run identifier */
  runId: string;
  /** ISO timestamp */
  timestamp: string;
  /** Overall pass rate 0-1 */
  passRate: number;
  /** Criteria-level pass rate 0-1 */
  criteriaRate: number;
  /** Total queries evaluated */
  totalQueries: number;
  /** Per-scenario breakdown */
  byScenario: EvalScenarioResult[];
}

export interface EvalScorecardData {
  /** Latest eval run */
  latest: EvalRunResult;
  /** Last 5 runs for trend */
  history: EvalRunResult[];
}
