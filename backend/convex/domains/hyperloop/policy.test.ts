import { describe, expect, it } from "vitest";
import {
  computeHyperLoopScore,
  decideHyperLoopPromotion,
  type HyperLoopGate,
  type HyperLoopMetrics,
} from "./policy";

const passingMetrics: HyperLoopMetrics = {
  qualityScore: 0.88,
  baselineQualityScore: 0.78,
  artifactQualityScore: 0.86,
  evidenceCoverage: 0.92,
  contradictionCatchRate: 0.84,
  packetReuseRate: 0.76,
  costReductionPct: 18,
  latencyReductionPct: 12,
  workflowCallReductionPct: 20,
  humanEditDistancePct: 0.08,
};

const passingGates: HyperLoopGate[] = [
  { key: "evidence_coverage", passed: true, critical: true },
  { key: "schema_stability", passed: true, critical: true },
  { key: "permission_safety", passed: true, critical: true },
  { key: "artifact_quality", passed: true },
];

describe("HyperLoop policy", () => {
  it("computes a bounded score for archive variants", () => {
    const score = computeHyperLoopScore(passingMetrics);

    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("marks strong variants as candidates but does not promote without human approval", () => {
    const decision = decideHyperLoopPromotion({
      metrics: passingMetrics,
      gates: passingGates,
    });

    expect(decision.action).toBe("candidate");
    expect(decision.requiresHumanApproval).toBe(true);
    expect(decision.improvementDelta).toBeCloseTo(0.1, 4);
  });

  it("blocks explicit promotion without a reviewer id", () => {
    const decision = decideHyperLoopPromotion({
      metrics: passingMetrics,
      gates: passingGates,
      requestedAction: "promote",
    });

    expect(decision.action).toBe("requires_human_approval");
    expect(decision.requiresHumanApproval).toBe(true);
  });

  it("allows explicit promotion when gates pass and a reviewer is present", () => {
    const decision = decideHyperLoopPromotion({
      metrics: passingMetrics,
      gates: passingGates,
      requestedAction: "promote",
      reviewerId: "human:operator",
    });

    expect(decision.action).toBe("promote");
    expect(decision.failedGateReasons).toEqual([]);
  });

  it("archives variants with critical gate failures even when metrics look strong", () => {
    const decision = decideHyperLoopPromotion({
      metrics: passingMetrics,
      gates: [
        ...passingGates,
        { key: "permission_safety", passed: false, critical: true, reason: "would mutate auth policy" },
      ],
      requestedAction: "promote",
      reviewerId: "human:operator",
    });

    expect(decision.action).toBe("archive_only");
    expect(decision.failedGateReasons).toContain("permission_safety: would mutate auth policy");
  });

  it("rejects variants that fail to beat the baseline meaningfully", () => {
    const decision = decideHyperLoopPromotion({
      metrics: {
        ...passingMetrics,
        qualityScore: 0.79,
        baselineQualityScore: 0.78,
      },
      gates: passingGates,
      requestedAction: "promote",
      reviewerId: "human:operator",
    });

    expect(decision.action).toBe("archive_only");
    expect(decision.explanation).toContain("minimum score and improvement threshold");
  });

  it("treats reviewer-backed rollback as an approved governance action", () => {
    const decision = decideHyperLoopPromotion({
      metrics: passingMetrics,
      gates: passingGates,
      requestedAction: "rollback",
      reviewerId: "human:operator",
    });

    expect(decision.action).toBe("rollback");
    expect(decision.requiresHumanApproval).toBe(false);
  });
});
