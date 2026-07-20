import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SuccessLoopsPanel } from "@/features/agents/components/successLoops/SuccessLoopsPanel";
import type { SuccessLoopsDashboardSnapshot } from "@/features/agents/components/successLoops/types";

const readySnapshot: SuccessLoopsDashboardSnapshot = {
  generatedAt: Date.now(),
  entityKey: "product:nodebench-ai",
  entityType: "product",
  summary: {
    totalLoops: 2,
    strengtheningCount: 1,
    mixedCount: 0,
    weakeningCount: 1,
    missingCount: 0,
    strongestLoop: { loopType: "activation", title: "Activation", score: 0.82 },
    weakestLoop: { loopType: "retained_value", title: "Retained Value", score: 0.28 },
  },
  loops: [
    {
      loopId: "product:nodebench-ai:activation",
      loopType: "activation",
      title: "Activation",
      goal: "Reach first value quickly.",
      owner: "Product",
      reviewCadence: "weekly",
      currentState: "Activation is strengthening through time to first value.",
      status: "strengthening",
      score: 0.82,
      leadingMetrics: [
        {
          key: "time_to_first_value",
          label: "Time to first value",
          value: 42,
          displayValue: "42m",
          score: 0.8,
          source: "observed",
          targetDirection: "lower",
        },
      ],
      laggingMetrics: [
        {
          key: "activated_accounts",
          label: "Activated accounts",
          value: 3,
          displayValue: "3",
          score: 0.84,
          source: "observed",
          targetDirection: "higher",
        },
      ],
      interventionTypes: ["onboarding"],
      nextReviewAt: Date.now() + 86_400_000,
      gaps: [],
    },
    {
      loopId: "product:nodebench-ai:retained_value",
      loopType: "retained_value",
      title: "Retained Value",
      goal: "Users return for repeatable value.",
      owner: "Product",
      reviewCadence: "weekly",
      currentState: "Retention is weak because reuse is under-instrumented.",
      status: "weakening",
      score: 0.28,
      leadingMetrics: [
        {
          key: "accepted_output_rate",
          label: "Accepted output rate",
          value: 0.42,
          displayValue: "42%",
          score: 0.42,
          source: "proxy",
          targetDirection: "higher",
        },
      ],
      laggingMetrics: [
        {
          key: "four_week_retention",
          label: "4-week retention",
          value: 0.21,
          displayValue: "21%",
          score: 0.21,
          source: "proxy",
          targetDirection: "higher",
        },
      ],
      interventionTypes: ["reuse-tracking"],
      nextReviewAt: Date.now() + 86_400_000,
      gaps: ["artifact_reuse"],
    },
  ],
  topExperiments: [
    {
      experimentKey: "exp:activation-onboarding",
      loopType: "activation",
      title: "Onboarding compression",
      status: "validated",
      owner: "Product",
      expectedEffect: "Reduce time to first value.",
      observedDelta: 0.19,
    },
  ],
  frozenDecisions: [
    {
      decisionKey: "decision:proof-led-growth",
      title: "Proof-led growth bet",
      decisionType: "gtm",
      owner: "Founder",
      confidence: 0.74,
      status: "frozen",
      createdAt: Date.now(),
      latestOutcomeVerdict: "pending",
      expectedOutcomeSummary: "Benchmarks and quality reviews should improve inbound quality.",
    },
  ],
  proofGraph: {
    nodes: [
      {
        nodeKey: "proof:benchmarks",
        label: "Benchmarks",
        kind: "benchmark",
        score: 0.72,
        value: "6 runs",
        detail: "Pass rate 72%",
      },
    ],
    edges: [],
  },
  accountValueGraph: {
    nodes: [
      {
        accountKey: "user:test",
        label: "Current workspace",
        activationState: "strengthening",
        retentionState: "weakening",
        expansionState: "mixed",
        workflowRuns30d: 12,
        timeToFirstValueMinutes: 42,
        integrationsConnected: 3,
      },
    ],
  },
  nextRecommendedAction:
    "Close the reuse loop by recording accepted outputs, exports, and repeated workflow usage at the artifact level.",
};

describe("SuccessLoopsPanel", () => {
  it("renders the loading state", () => {
    render(<SuccessLoopsPanel snapshot={null} loading />);
    expect(screen.getByText("Loading success loops...")).toBeInTheDocument();
  });

  it("renders the success loops dashboard", () => {
    render(<SuccessLoopsPanel snapshot={readySnapshot} />);
    expect(screen.getByText("Success Loops")).toBeInTheDocument();
    expect(screen.getAllByText("Activation").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Retained Value").length).toBeGreaterThan(0);
    expect(screen.getByText(/Close the reuse loop/i)).toBeInTheDocument();
    expect(screen.getByText("Proof-led growth bet")).toBeInTheDocument();
  });
});
