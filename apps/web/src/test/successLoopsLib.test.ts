import { describe, expect, it } from "vitest";
import {
  buildMetricValue,
  computeLoopHealth,
  defaultNextRecommendedAction,
  type SuccessLoopsDashboardSnapshot,
} from "../../convex/domains/successLoops/lib";

describe("successLoops lib", () => {
  it("marks a well-instrumented loop as strengthening", () => {
    const health = computeLoopHealth({
      leadingMetrics: [
        buildMetricValue({
          key: "activation",
          label: "Activation",
          value: 0.82,
          displayValue: "82%",
          score: 0.82,
          targetDirection: "higher",
        }),
      ],
      laggingMetrics: [
        buildMetricValue({
          key: "retention",
          label: "Retention",
          value: 0.74,
          displayValue: "74%",
          score: 0.74,
          targetDirection: "higher",
        }),
      ],
      gaps: [],
    });

    expect(health.status).toBe("strengthening");
    expect(health.score).toBeGreaterThan(0.7);
  });

  it("recommends the retained-value loop fix when retention is weakest", () => {
    const snapshot: Pick<SuccessLoopsDashboardSnapshot, "loops" | "summary"> = {
      summary: {
        totalLoops: 2,
        strengtheningCount: 1,
        mixedCount: 0,
        weakeningCount: 1,
        missingCount: 0,
        strongestLoop: { loopType: "activation", title: "Activation", score: 0.8 },
        weakestLoop: { loopType: "retained_value", title: "Retained Value", score: 0.2 },
      },
      loops: [
        {
          loopId: "product:nodebench-ai:activation",
          loopType: "activation",
          title: "Activation",
          goal: "Reach first value quickly.",
          owner: "Product",
          reviewCadence: "weekly",
          currentState: "Activation is fine.",
          status: "strengthening",
          score: 0.8,
          leadingMetrics: [],
          laggingMetrics: [],
          interventionTypes: [],
          nextReviewAt: Date.now(),
          gaps: [],
        },
        {
          loopId: "product:nodebench-ai:retained_value",
          loopType: "retained_value",
          title: "Retained Value",
          goal: "Users come back for proof-backed value.",
          owner: "Product",
          reviewCadence: "weekly",
          currentState: "Retention is weak.",
          status: "weakening",
          score: 0.2,
          leadingMetrics: [],
          laggingMetrics: [],
          interventionTypes: [],
          nextReviewAt: Date.now(),
          gaps: ["artifact_reuse"],
        },
      ],
    };

    expect(defaultNextRecommendedAction(snapshot)).toContain("accepted outputs");
  });
});
