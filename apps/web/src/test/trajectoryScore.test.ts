import { describe, expect, it } from "vitest";
import { computeTrajectoryScores } from "../../convex/domains/trajectory/lib";

describe("computeTrajectoryScores", () => {
  it("marks repeated evidence-backed improvement as compounding", () => {
    const scores = computeTrajectoryScores({
      spanCount: 12,
      completedSpanRatio: 0.92,
      errorSpanRatio: 0.05,
      averageVerdictConfidence: 0.88,
      verdictPassRatio: 0.9,
      evidenceBundleCount: 10,
      sourceRefCount: 32,
      checklistPassRatio: 0.9,
      feedbackPositiveRatio: 0.86,
      benchmarkImprovementRatio: 0.8,
      interventionCount: 3,
      interventionSuccessRatio: 0.8,
      averageInterventionUplift: 0.72,
      trustAmplification: 0.18,
      driftPressure: 0.16,
    });

    expect(scores.trustAdjustedCompounding.label).toBe("compounding");
    expect(scores.trustAdjustedCompounding.score).toBeGreaterThan(0.74);
    expect(scores.drift.label).not.toBe("drifting");
  });

  it("discounts externally amplified wins", () => {
    const lowTrust = computeTrajectoryScores({
      spanCount: 8,
      completedSpanRatio: 0.8,
      errorSpanRatio: 0.1,
      averageVerdictConfidence: 0.82,
      verdictPassRatio: 0.78,
      evidenceBundleCount: 6,
      sourceRefCount: 20,
      checklistPassRatio: 0.75,
      feedbackPositiveRatio: 0.8,
      benchmarkImprovementRatio: 0.72,
      interventionCount: 2,
      interventionSuccessRatio: 0.75,
      averageInterventionUplift: 0.62,
      trustAmplification: 0.1,
      driftPressure: 0.2,
    });
    const highTrust = computeTrajectoryScores({
      spanCount: 8,
      completedSpanRatio: 0.8,
      errorSpanRatio: 0.1,
      averageVerdictConfidence: 0.82,
      verdictPassRatio: 0.78,
      evidenceBundleCount: 6,
      sourceRefCount: 20,
      checklistPassRatio: 0.75,
      feedbackPositiveRatio: 0.8,
      benchmarkImprovementRatio: 0.72,
      interventionCount: 2,
      interventionSuccessRatio: 0.75,
      averageInterventionUplift: 0.62,
      trustAmplification: 0.78,
      driftPressure: 0.2,
    });

    expect(highTrust.rawCompounding.score).toBe(lowTrust.rawCompounding.score);
    expect(highTrust.trustAdjustedCompounding.score).toBeLessThan(lowTrust.trustAdjustedCompounding.score);
  });

  it("flags drift even when spans still complete", () => {
    const scores = computeTrajectoryScores({
      spanCount: 10,
      completedSpanRatio: 0.7,
      errorSpanRatio: 0.2,
      averageVerdictConfidence: 0.45,
      verdictPassRatio: 0.4,
      evidenceBundleCount: 3,
      sourceRefCount: 6,
      checklistPassRatio: 0.35,
      feedbackPositiveRatio: 0.2,
      benchmarkImprovementRatio: 0.2,
      interventionCount: 1,
      interventionSuccessRatio: 0.1,
      averageInterventionUplift: 0.1,
      trustAmplification: 0.15,
      driftPressure: 0.82,
    });

    expect(scores.drift.label).toBe("drifting");
    expect(scores.trustAdjustedCompounding.label).toBe("drifting");
  });
});
