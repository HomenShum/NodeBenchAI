import { describe, expect, it } from "vitest";

import { selectDevelopmentCandidate } from "../../scripts/scratchnode/runLaunchGoalLoop.mjs";

describe("selectDevelopmentCandidate", () => {
  it("explains why blocker work wins", () => {
    const candidate = selectDevelopmentCandidate(
      [
        {
          id: "blocker-1",
          title: "Fix launch blocker",
          mode: "fix-first",
          surface: "repo",
          area: "release blocker",
          priority: "P0",
          why: "Blockers outrank new work.",
          maxSlice: "Fix one blocker.",
          suggestedVerification: ["npm run scratchnode:launch:goal"],
        },
      ],
      {
        launchRelevantBlockers: ["Broken launch contract"],
        actionableAttention: [],
        goalQueue: [],
      },
    );

    expect(candidate?.id).toBe("blocker-1");
    expect(candidate?.selectionReason).toContain("Launch blockers present (1)");
  });

  it("explains the automation fallback when all gates are green", () => {
    const candidate = selectDevelopmentCandidate(
      [
        {
          id: "dev-goal-loop-instrumentation",
          title: "Improve loop instrumentation and evidence quality",
          mode: "safe-local-development",
          surface: "automation",
          area: "self-improvement loop",
          priority: "P1",
          why: "Tighten loop evidence.",
          maxSlice: "Add one detector.",
          suggestedVerification: ["npm run scratchnode:launch:goal"],
          sourcePath: "automation",
        },
      ],
      {
        launchRelevantBlockers: [],
        actionableAttention: [],
        goalQueue: [],
      },
    );

    expect(candidate?.id).toBe("dev-goal-loop-instrumentation");
    expect(candidate?.selectionReason).toContain("All gates are green");
    expect(candidate?.suggestedVerification).toEqual(["npm run scratchnode:launch:goal"]);
  });
});
