/**
 * Eval Harness Types — Bare vs MCP Agent Comparison
 *
 * Defines the scorecard, telemetry, and dataset schemas for
 * measuring whether MCP agents perform "as good or better" than bare agents.
 */

// ── Scorecard ───────────────────────────────────────────────────────

export interface Scorecard {
  correctness: {
    taskSuccessRate: number;       // 0-1: passes acceptance criteria + tests
    regressionRate: number;        // 0-1: new failures introduced
  };
  safety: {
    highRiskActionsGated: number;  // 0-1: agent requested confirmation when needed
    issuesCaughtPreMerge: number;  // count, severity-weighted
  };
  efficiency: {
    wallClockMs: number;           // time to green
    toolCallCount: number;
    tokenCount: number;
    retryThrashRate: number;       // 0-1: loops, backtracks, duplicate edits
  };
  compounding: {
    knowledgeReuseRate: number;    // 0-1: % tasks where agent retrieved prior learnings
    evalCasesBanked: number;       // new eval cases created per fix
  };
}

// ── Task Dataset ────────────────────────────────────────────────────

export type TaskTier = "tier1_deterministic" | "tier2_tool_discovery" | "tier3_production";

export interface EvalTask {
  id: string;
  name: string;
  tier: TaskTier;
  description: string;
  /** Git ref to reset to before running */
  baseRef: string;
  /** Acceptance criteria — each must pass for task success */
  acceptanceCriteria: AcceptanceCriterion[];
  /** Optional fixture files for reproducibility */
  fixtures?: string[];
  /** Risk tier for safety scoring */
  riskTier: "low" | "medium" | "high";
  /** Tags for filtering */
  tags: string[];
}

export interface AcceptanceCriterion {
  id: string;
  type: "lint" | "typecheck" | "unit_test" | "integration_test" | "output_match" | "llm_judge";
  command?: string;       // for lint/typecheck/unit_test/integration_test
  expectedPattern?: string; // regex for output_match
  rubric?: string;        // for llm_judge
  weight: number;         // 0-1, relative importance
}

// ── Run Configuration ───────────────────────────────────────────────

export type AgentMode = "bare" | "mcp_lite" | "mcp_core" | "mcp_full";

export interface RunConfig {
  taskId: string;
  agentMode: AgentMode;
  model: string;          // candidate id: EVAL_MODEL (detectBackend().model), never hard-coded
  seed: number;           // trial seed (run 3-5 per config)
  toolsetPreset?: string; // lite/core/full for MCP modes
  timeout: number;        // max ms per run
}

// ── Telemetry ───────────────────────────────────────────────────────

export interface RunTelemetry {
  runId: string;
  config: RunConfig;
  startedAt: string;
  completedAt: string;
  scorecard: Scorecard;
  /** Tools that actually ran and returned a result. This harness runs none, so it stays empty. */
  toolCalls: ToolCallRecord[];
  /** Tools the model asked for (tool_use blocks). A request is not an execution and earns no score. */
  requestedTools?: ToolRequestRecord[];
  verificationCycles: VerificationCycleRecord[];
  /** Raw agent output for audit */
  outputHash: string;
  /** The `model` string the provider returned (not the one requested) - SPEC-v9 A.0.3. */
  echoedModel?: string;
  /** Error if run failed */
  error?: string;
}

export interface ToolRequestRecord {
  toolName: string;
  inputHash: string;
}

export interface ToolCallRecord {
  toolName: string;
  durationMs: number;
  success: boolean;
  inputHash: string;
  outputHash: string;
  /** Did the agent follow the quickRef nextAction suggestion? */
  followedQuickRef: boolean | null;
  timestamp: string;
}

export interface VerificationCycleRecord {
  cycleId: string;
  gapsCreated: Array<{ severity: string; status: string; timeToCloseMs?: number }>;
  testsExecuted: Array<{ layer: string; passed: boolean }>;
  evalCasesCreated: number;
  qualityGateChecks: Array<{ gate: string; passed: boolean; violations: string[] }>;
}

// ── Comparison Report ───────────────────────────────────────────────

export interface ComparisonReport {
  taskId: string;
  taskName: string;
  configs: AgentMode[];
  trialsPerConfig: number;
  results: Record<AgentMode, {
    meanScore: number;
    variance: number;
    p10Score: number;    // worst-case (10th percentile)
    meanWallClockMs: number;
    meanToolCalls: number;
    meanTokens: number;
    successRate: number;
    regressionRate: number;
  }>;
  recommendation: "bare_wins" | "mcp_wins" | "inconclusive";
  rationale: string;
}

// ── Dataset ─────────────────────────────────────────────────────────

export interface EvalDataset {
  version: string;
  createdAt: string;
  tasks: EvalTask[];
}
