/**
 * DeepTrace Autoresearch Optimizer — Type definitions
 *
 * Defines the scoring model, candidate lifecycle, and promotion rules
 * for the offline optimizer loop. See plans/DeepTrace_Autoresearch_Integration_PLAN.md.
 */

// ---------------------------------------------------------------------------
// Throughput score weights (must sum to 1.0)
// ---------------------------------------------------------------------------

export const THROUGHPUT_WEIGHTS = {
  taskCompletionRate: 0.30,
  inverseTimeToFirstDraft: 0.25,
  inverseHumanEditDistance: 0.20,
  inverseWallClockTime: 0.15,
  inverseToolCallCount: 0.10,
} as const;

// ---------------------------------------------------------------------------
// Hard quality guard thresholds
// ---------------------------------------------------------------------------

export const QUALITY_GUARDS = {
  /** Max allowed drop in factual precision (pp) */
  maxFactualPrecisionDrop: 0.01,
  /** Max allowed drop in relationship precision (pp) */
  maxRelationshipPrecisionDrop: 0.01,
  /** Evidence linkage floor */
  minEvidenceLinkage: 0.75,
  /** Receipt completeness floor */
  minReceiptCompleteness: 0.80,
  /** False-confidence ceiling */
  maxFalseConfidenceRate: 0.10,
  /** Canary relative uplift floor vs baseline */
  minCanaryRelativeUplift: 0.03,
} as const;

/** Minimum throughput improvement to accept a candidate */
export const MIN_THROUGHPUT_IMPROVEMENT = 0.05;

// ---------------------------------------------------------------------------
// Mutation allowlist — only these path prefixes may be changed by optimizer
// ---------------------------------------------------------------------------

export const MUTATION_ALLOWLIST: readonly string[] = [
  "convex/domains/deepTrace/",
  "convex/workflows/deepTrace.ts",
  "packages/mcp-local/src/tools/dimensionTools.ts",
  "scripts/eval-harness/deeptrace/",
  "convex/domains/mcp/mcpGatewayDispatcher.ts",
] as const;

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export interface ThroughputMetrics {
  taskCompletionRate: number;
  timeToFirstDraftMs: number;
  humanEditDistance: number;
  wallClockMs: number;
  toolCallCount: number;
}

export interface QualityMetrics {
  factualPrecision: number;
  relationshipPrecision: number;
  evidenceLinkage: number;
  receiptCompleteness: number;
  falseConfidenceRate: number;
  canaryRelativeUplift: number;
}

export interface CandidateScore {
  throughputScore: number;
  qualityMetrics: QualityMetrics;
  guardsPass: boolean;
  guardFailures: string[];
}

/** `promoted` is retained only for reading historical, unverified logs. */
export type CandidateVerdict = "proposal-only" | "promoted" | "discarded";

export interface CandidateRun {
  candidateId: string;
  baselineId: string;
  benchmarkCaseIds: string[];
  changedFiles: string[];
  /** null means the check was skipped, not passed. */
  compileSuccess: boolean | null;
  testSuccess: boolean | null;
  evidenceStatus: "unverified";
  releaseEligible: false;
  /** Arithmetic diagnostics over supplied metrics, not measured improvement. */
  score: CandidateScore;
  verdict: CandidateVerdict;
  rejectionReason?: string;
  /** LLM reasoning trace — what the proposer intended */
  proposerRationale?: string;
  /** Per-call cost entries for this iteration */
  costEntries?: CostEntry[];
  /** ISO timestamp */
  timestamp: string;
  /** Wall-clock time for the full optimizer iteration */
  iterationMs: number;
}

export interface BaselineSnapshot {
  baselineId: string;
  commitHash: string;
  throughputMetrics: ThroughputMetrics;
  qualityMetrics: QualityMetrics;
  /** Absent in historical snapshots; supplied metrics are always unverified. */
  evidenceStatus?: "unverified";
  /** ISO timestamp */
  capturedAt: string;
}

export interface OptimizerConfig {
  /** Max optimizer iterations before stopping */
  maxIterations: number;
  /** Max wall-clock seconds for entire optimizer session */
  maxSessionSeconds: number;
  /** Benchmark family IDs to evaluate */
  benchmarkFamilies: string[];
  /** Paths that may be mutated (defaults to MUTATION_ALLOWLIST) */
  allowlist?: string[];
}

export const DEFAULT_OPTIMIZER_CONFIG: OptimizerConfig = {
  maxIterations: 10,
  maxSessionSeconds: 600,
  benchmarkFamilies: [
    "company_direction",
    "relationship_mapping",
    "repo_intelligence",
    "world_to_company",
    "trace_backed_draft",
  ],
};

// ---------------------------------------------------------------------------
// Run log — durable artifact for each optimizer session
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cost tracking
// ---------------------------------------------------------------------------

export interface CostEntry {
  /** Which step produced this cost (e.g. "propose", "judge", "benchmark") */
  phase: string;
  /** Model used (e.g. "claude-sonnet-4-6") */
  model: string;
  /** Tokens consumed */
  inputTokens: number;
  outputTokens: number;
  /** USD cost for this call */
  costUsd: number;
  /** ISO timestamp */
  timestamp: string;
}

export interface SessionCostSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  costByPhase: Record<string, number>;
  costByModel: Record<string, number>;
  callCount: number;
}

/** Per-model pricing (USD per 1M tokens) — updated 2026-03 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.0 },
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
};

export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["claude-sonnet-4-6"];
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export function summarizeCosts(entries: CostEntry[]): SessionCostSummary {
  const summary: SessionCostSummary = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    costByPhase: {},
    costByModel: {},
    callCount: entries.length,
  };
  for (const e of entries) {
    summary.totalInputTokens += e.inputTokens;
    summary.totalOutputTokens += e.outputTokens;
    summary.totalCostUsd += e.costUsd;
    summary.costByPhase[e.phase] = (summary.costByPhase[e.phase] ?? 0) + e.costUsd;
    summary.costByModel[e.model] = (summary.costByModel[e.model] ?? 0) + e.costUsd;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Run log — durable artifact for each optimizer session
// ---------------------------------------------------------------------------

export interface OptimizerRunLog {
  sessionId: string;
  config: OptimizerConfig;
  baseline: BaselineSnapshot;
  candidates: CandidateRun[];
  promotedCandidateId: string | null;
  /** Per-call cost entries across all iterations */
  costEntries: CostEntry[];
  /** Aggregated cost summary */
  costSummary: SessionCostSummary;
  /** ISO timestamp */
  startedAt: string;
  /** ISO timestamp */
  completedAt: string;
}
