import { describe, expect, it } from "vitest";

import { classifyGoalCardMode, selectDevelopmentCandidate } from "./runLaunchGoalLoop.mjs";

describe("classifyGoalCardMode", () => {
  it("marks tests-only cards as safe local when no hard gate is present", () => {
    const result = classifyGoalCardMode(`
- **status:** proposed
- **auto-safe:** tests-only, no product code change.
`);

    expect(result).toEqual({
      mode: "safe-local-development",
      eligibilityReason: "Explicit auto-safe/tests-only guidance allows a narrow local slice.",
    });
  });

  it("keeps hard-gate cards human-gated even if tests-only text appears", () => {
    const result = classifyGoalCardMode(`
- **status:** proposed
- **auto-safe:** tests-only, no product code change.
- HARD GATE: founder approval REQUIRED before merge.
`);

    expect(result).toEqual({
      mode: "human-gated",
      eligibilityReason: "Auto-safe guidance is present, but hard-gate approval language still requires human review.",
    });
  });

  it("defaults to human-gated when no auto-safe marker exists", () => {
    const result = classifyGoalCardMode(`
- **status:** proposed
- **surface:** scratchnode
`);

    expect(result).toEqual({
      mode: "human-gated",
      eligibilityReason: "No auto-safe marker found; defaulting this goal card to human-gated.",
    });
  });
});

describe("selectDevelopmentCandidate", () => {
  it("explains the automation fallback when no safe-local goal card is eligible", () => {
    const candidate = selectDevelopmentCandidate(
      [
        {
          id: "dev-goal-loop-instrumentation",
          title: "Improve loop instrumentation and evidence quality",
          mode: "safe-local-development",
          surface: "automation",
          area: "self-improvement loop",
          priority: "P1",
        },
      ],
      {
        actionableAttention: [],
        launchRelevantBlockers: [],
        goalQueue: [
          {
            id: "runtime-001-public-private-boundary",
            status: "proposed",
            mode: "human-gated",
          },
        ],
      },
    );

    expect(candidate?.selectionReason).toBe(
      "All gates are green and no safe-local goal cards are eligible, so the loop defaults to automation instrumentation.",
    );
  });
});
