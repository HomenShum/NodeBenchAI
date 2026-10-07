import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentResponseFlywheelPanel } from "@/features/agents/components/AgentResponseFlywheelPanel";

const snapshot = {
  summary: {
    totalReviews: 6,
    passCount: 3,
    watchCount: 2,
    failCount: 1,
    passRate: 0.5,
    averageOverallScore: 0.68,
    weakestDimension: {
      key: "evidenceGrounding",
      label: "Evidence Grounding",
      averageScore: 0.51,
    },
    strongestDimension: {
      key: "routingFit",
      label: "Routing Fit",
      averageScore: 0.84,
    },
    hottestQuestionCategory: {
      key: "trajectory_compounding",
      label: "Trajectory Compounding",
      count: 4,
    },
    latestReviewedAt: Date.now(),
  },
  dimensions: [
    { key: "outputQuality", label: "Output Quality", averageScore: 0.74, status: "watch" as const },
    { key: "evidenceGrounding", label: "Evidence Grounding", averageScore: 0.51, status: "weak" as const },
    { key: "actionability", label: "Actionability", averageScore: 0.81, status: "strong" as const },
    { key: "temporalAwareness", label: "Temporal Awareness", averageScore: 0.66, status: "watch" as const },
  ],
  categories: [
    {
      key: "trajectory_compounding",
      label: "Trajectory Compounding",
      count: 4,
      outputVariables: ["spanQuality", "trustAdjustedCompounding"],
    },
    {
      key: "judgment_layer",
      label: "Judgment Layer",
      count: 2,
      outputVariables: ["preExecutionGate", "consistencyIndex"],
    },
  ],
  recentFindings: [
    {
      reviewKey: "review-1",
      messageId: "m1",
      promptSummary: "Look up the latest release and verify it.",
      status: "watch" as const,
      overallScore: 0.62,
      matchedCategoryKeys: ["trajectory_compounding"],
      weaknesses: ["The response does not ground enough claims with links or dates."],
      recommendations: ["Add source links and absolute dates."],
      reviewedAt: Date.now(),
    },
  ],
};

describe("AgentResponseFlywheelPanel", () => {
  it("renders the response flywheel snapshot", () => {
    render(<AgentResponseFlywheelPanel snapshot={snapshot} />);

    expect(screen.getByText("Agent response flywheel")).toBeInTheDocument();
    expect(screen.getAllByText("Evidence Grounding").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Trajectory Compounding").length).toBeGreaterThan(0);
    expect(screen.getByText(/Add source links and absolute dates/i)).toBeInTheDocument();
  });
});
