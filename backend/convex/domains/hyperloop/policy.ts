export type HyperLoopTargetKind =
  | "packet_template"
  | "workflow_template"
  | "routing_policy"
  | "export_adapter"
  | "readiness_rubric"
  | "watchlist_threshold";

export type HyperLoopVariantStatus =
  | "draft"
  | "evaluating"
  | "archived"
  | "candidate"
  | "promoted"
  | "rejected"
  | "rolled_back";

export type HyperLoopGateKey =
  | "evidence_coverage"
  | "artifact_quality"
  | "cost_regression"
  | "latency_regression"
  | "schema_stability"
  | "permission_safety"
  | "human_review";

export type HyperLoopPromotionAction =
  | "archive_only"
  | "candidate"
  | "requires_human_approval"
  | "promote"
  | "reject"
  | "rollback";

export interface HyperLoopMetrics {
  qualityScore: number;
  baselineQualityScore?: number;
  artifactQualityScore?: number;
  evidenceCoverage: number;
  contradictionCatchRate?: number;
  packetReuseRate?: number;
  costReductionPct?: number;
  latencyReductionPct?: number;
  workflowCallReductionPct?: number;
  humanEditDistancePct?: number;
}

export interface HyperLoopGate {
  key: HyperLoopGateKey | string;
  passed: boolean;
  critical?: boolean;
  reason?: string;
}

export interface HyperLoopPromotionInput {
  metrics: HyperLoopMetrics;
  gates: HyperLoopGate[];
  reviewerId?: string | null;
  requestedAction?: "promote" | "reject" | "rollback";
}

export interface HyperLoopPolicyDecision {
  action: HyperLoopPromotionAction;
  score: number;
  improvementDelta: number;
  failedGateReasons: string[];
  requiresHumanApproval: boolean;
  explanation: string;
}

function finiteOrZero(value: number | undefined): number {
  return Number.isFinite(value) ? value! : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function computeHyperLoopScore(metrics: HyperLoopMetrics): number {
  const quality = clamp01(metrics.qualityScore);
  const evidence = clamp01(metrics.evidenceCoverage);
  const artifactQuality = clamp01(metrics.artifactQualityScore ?? metrics.qualityScore);
  const contradiction = clamp01(metrics.contradictionCatchRate ?? 0.5);
  const reuse = clamp01(metrics.packetReuseRate ?? 0.5);
  const costReduction = clamp01((finiteOrZero(metrics.costReductionPct) + 25) / 50);
  const latencyReduction = clamp01((finiteOrZero(metrics.latencyReductionPct) + 25) / 50);
  const callReduction = clamp01((finiteOrZero(metrics.workflowCallReductionPct) + 25) / 50);
  const editBurden = 1 - clamp01(metrics.humanEditDistancePct ?? 0.5);

  const weighted =
    quality * 0.24 +
    evidence * 0.18 +
    artifactQuality * 0.16 +
    contradiction * 0.1 +
    reuse * 0.08 +
    costReduction * 0.08 +
    latencyReduction * 0.06 +
    callReduction * 0.06 +
    editBurden * 0.04;

  return Number(weighted.toFixed(4));
}

export function computeImprovementDelta(metrics: HyperLoopMetrics): number {
  const baseline = metrics.baselineQualityScore;
  if (!Number.isFinite(baseline)) return 0;
  return Number((metrics.qualityScore - baseline!).toFixed(4));
}

export function listFailedGateReasons(gates: HyperLoopGate[]): string[] {
  return gates
    .filter((gate) => !gate.passed)
    .map((gate) => `${gate.key}: ${gate.reason ?? "gate failed"}`);
}

export function hasCriticalGateFailure(gates: HyperLoopGate[]): boolean {
  return gates.some((gate) => gate.critical === true && !gate.passed);
}

export function decideHyperLoopPromotion(input: HyperLoopPromotionInput): HyperLoopPolicyDecision {
  const score = computeHyperLoopScore(input.metrics);
  const improvementDelta = computeImprovementDelta(input.metrics);
  const failedGateReasons = listFailedGateReasons(input.gates);
  const criticalFailure = hasCriticalGateFailure(input.gates);
  const reviewerId = input.reviewerId?.trim();

  if (input.requestedAction === "rollback") {
    return {
      action: "rollback",
      score,
      improvementDelta,
      failedGateReasons,
      requiresHumanApproval: !reviewerId,
      explanation: reviewerId
        ? "Human reviewer requested rollback; mark the variant rolled back and preserve audit trail."
        : "Rollback requires a human reviewer id before mutating promoted state.",
    };
  }

  if (input.requestedAction === "reject") {
    return {
      action: "reject",
      score,
      improvementDelta,
      failedGateReasons,
      requiresHumanApproval: false,
      explanation: "Variant was explicitly rejected; keep it in the archive for analysis but do not route production traffic.",
    };
  }

  if (criticalFailure) {
    return {
      action: "archive_only",
      score,
      improvementDelta,
      failedGateReasons,
      requiresHumanApproval: false,
      explanation: "Critical gates failed; archive the result for learning, but do not mark it promotable.",
    };
  }

  if (score < 0.68 || improvementDelta < 0.02) {
    return {
      action: "archive_only",
      score,
      improvementDelta,
      failedGateReasons,
      requiresHumanApproval: false,
      explanation: "Variant does not clear the minimum score and improvement threshold for promotion candidacy.",
    };
  }

  if (!reviewerId) {
    return {
      action: input.requestedAction === "promote" ? "requires_human_approval" : "candidate",
      score,
      improvementDelta,
      failedGateReasons,
      requiresHumanApproval: true,
      explanation: "Variant is a promotion candidate, but production promotion requires a human reviewer id.",
    };
  }

  return {
    action: input.requestedAction === "promote" ? "promote" : "candidate",
    score,
    improvementDelta,
    failedGateReasons,
    requiresHumanApproval: input.requestedAction !== "promote",
    explanation: input.requestedAction === "promote"
      ? "Human-reviewed gates passed; promote the variant and preserve the evaluation record."
      : "Human-reviewed gates passed; keep the variant as a candidate until an explicit promote action.",
  };
}
