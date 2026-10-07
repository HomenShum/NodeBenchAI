import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrajectorySummaryBand } from "@/features/trajectory/components/TrajectorySummaryBand";
import type { TrajectorySummaryData } from "@/features/trajectory/types";

const readySummary: TrajectorySummaryData = {
  entityKey: "product:nodebench-ai",
  entityType: "product",
  windowDays: 90,
  summary: "NodeBench AI is compounding across the current builder window.",
  narrative: "Compounding is driven by proof-backed execution and repeatable benchmark lift.",
  nextReviewAt: Date.now() + 3 * 24 * 60 * 60 * 1000,
  spanCount: 12,
  evidenceBundleCount: 8,
  verdictCount: 6,
  feedbackCount: 4,
  interventionCount: 2,
  benchmarkCount: 3,
  trustNodeCount: 2,
  trustEdgeCount: 3,
  topInterventions: [
    {
      title: "Trajectory summary band rollout",
      observedScoreDelta: 0.22,
      status: "validated",
    },
  ],
  scoreBreakdown: {
    spanQuality: { score: 0.84, label: "compounding", explanation: "Strong spans." },
    evidenceCompleteness: { score: 0.78, label: "compounding", explanation: "Evidence is complete." },
    adaptationVelocity: { score: 0.71, label: "improving", explanation: "Adaptation is healthy." },
    trustLeverage: { score: 0.22, label: "drifting", explanation: "Low amplification." },
    interventionEffect: { score: 0.68, label: "improving", explanation: "Interventions are landing." },
    drift: { score: 0.2, label: "drifting", explanation: "Low drift pressure." },
    rawCompounding: { score: 0.8, label: "compounding", explanation: "Raw score." },
    trustAdjustedCompounding: { score: 0.76, label: "compounding", explanation: "Adjusted score." },
  },
};

describe("TrajectorySummaryBand", () => {
  it("renders the loading state", () => {
    render(<TrajectorySummaryBand loading />);
    expect(screen.getByText("Loading trajectory intelligence...")).toBeInTheDocument();
  });

  it("renders the empty state", () => {
    render(<TrajectorySummaryBand summary={null} emptyLabel="No trajectory rows yet." />);
    expect(screen.getByText("No trajectory rows yet.")).toBeInTheDocument();
  });

  it("renders the ready state", () => {
    render(<TrajectorySummaryBand summary={readySummary} />);
    expect(screen.getByText("Trajectory Intelligence")).toBeInTheDocument();
    expect(screen.getByText("NodeBench AI is compounding across the current builder window.")).toBeInTheDocument();
    expect(screen.getAllByText("compounding").length).toBeGreaterThan(0);
    expect(screen.getByText("Trajectory summary band rollout")).toBeInTheDocument();
  });

  it("renders a drifting label when drift dominates", () => {
    const driftingSummary: TrajectorySummaryData = {
      ...readySummary,
      summary: "NodeBench AI is drifting in the current window.",
      scoreBreakdown: {
        ...readySummary.scoreBreakdown,
        drift: { score: 0.82, label: "drifting", explanation: "Drift is high." },
        trustAdjustedCompounding: { score: 0.34, label: "drifting", explanation: "Adjusted score is slipping." },
      },
    };

    render(<TrajectorySummaryBand summary={driftingSummary} />);
    expect(screen.getByText("NodeBench AI is drifting in the current window.")).toBeInTheDocument();
    expect(screen.getAllByText("drifting").length).toBeGreaterThan(0);
  });
});
