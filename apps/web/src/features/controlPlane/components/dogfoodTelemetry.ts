/**
 * dogfoodTelemetry.ts — Telemetry schema for dogfood runs.
 *
 * Used by both AI App and MCP dogfood scenarios.
 * Matches the canonical schema from DOGFOOD_RUNBOOK_V1.md.
 */

/* ─── Dogfood Run Schema ─────────────────────────────────────────────────── */

export interface DogfoodRun {
  runId: string;
  timestampStart: string;
  timestampEnd: string;
  surface: "ai_app" | "mcp" | "engine_api";
  scenarioId: string;
  userRole: DogfoodRole;
  primaryPrompt: string;
  attachedInputs: string[];
  inferredLens: string;
  packetType: string;
  stateBeforeHash: string;
  stateAfterHash: string;
  importantChangesDetected: number;
  contradictionsDetected: number;
  actionsRanked: number;
  artifactsProduced: string[];
  toolsInvoked: string[];
  toolCallCount: number;
  writeOpsCount: number;
  readOpsCount: number;
  webEnrichmentCount: number;
  providerBusMessagesSent: number;
  providerBusMessagesReceived: number;
  inputTokensEst: number;
  outputTokensEst: number;
  totalTokensEst: number;
  totalLatencyMs: number;
  estCostBandUsd: number;
  humanScore_1to5: number;
  judgeScore_1to5: number;
  repeatedQuestionPrevented: boolean;
  followupNeeded: boolean;
}

export type DogfoodRole = "founder" | "banker" | "ceo" | "operator" | "researcher" | "student";

/* ─── Canonical Event Names ──────────────────────────────────────────────── */

export const DOGFOOD_EVENTS = [
  "search.query.received",
  "lens.inferred",
  "entity.canonicalized",
  "change.detected",
  "contradiction.detected",
  "important_change.flagged",
  "packet.generated",
  "packet.validated",
  "memo.rendered",
  "artifact.exported",
  "packet.handed_to_agent",
  "path.step.recorded",
  "state.before.captured",
  "state.after.captured",
  "trajectory.rollup.generated",
  "provider.bus.message.sent",
  "provider.bus.message.received",
] as const;

export type DogfoodEventName = (typeof DOGFOOD_EVENTS)[number];

/* ─── Pass/Fail Criteria ─────────────────────────────────────────────────── */

export interface DogfoodJudgment {
  /** Did NodeBench remove repeated cognition? */
  removedRepeatedCognition: boolean;
  /** Did it return a usable packet without restating context? */
  usablePacketWithoutRestatement: boolean;
  /** Did it surface the right contradiction? */
  surfacedRightContradiction: boolean;
  /** Did it suppress noise? */
  suppressedNoise: boolean;
  /** Did it produce the right downstream artifact? */
  producedRightArtifact: boolean;
  /** Did it update causal memory correctly? */
  updatedCausalMemory: boolean;
  /** Would the user trust and reuse the output? */
  userWouldTrustAndReuse: boolean;
}

export interface DogfoodGlobalMetrics {
  repeatQuestionRate: number;
  packetReuseRate: number;
  importantChangePrecision: number;
  delegationWithoutRestatementRate: number;
}

/* ─── Cost Model Bands ───────────────────────────────────────────────────── */

export type CostBand = "local" | "light" | "medium" | "heavy";

export const COST_BANDS: Record<CostBand, { tokenRange: [number, number]; usdRange: [number, number] }> = {
  local: { tokenRange: [0, 0], usdRange: [0, 0] },
  light: { tokenRange: [1_000, 8_000], usdRange: [0.01, 0.08] },
  medium: { tokenRange: [8_000, 25_000], usdRange: [0.05, 0.40] },
  heavy: { tokenRange: [20_000, 80_000], usdRange: [0.20, 2.00] },
};

/* ─── Helpers ────────────────────────────────────────────────────────────── */

export function createDogfoodRunId(): string {
  return `df_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function scoreDogfoodRun(judgment: DogfoodJudgment): number {
  const fields = Object.values(judgment);
  const passed = fields.filter(Boolean).length;
  return Math.round((passed / fields.length) * 5 * 10) / 10; // 0-5 scale
}
