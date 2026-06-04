import { describe, expect, it } from "vitest";

import {
  classifyGoalCardMode,
  selectDevelopmentCandidate,
  summarizeCommandEvidence,
  summarizeSourceReportEvidence,
} from "./runLaunchGoalLoop.mjs";

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

describe("summarizeCommandEvidence", () => {
  it("summarizes command exits, failures, and timing", () => {
    const summary = summarizeCommandEvidence([
      { command: "fast", exitCode: 0, durationMs: 12 },
      { command: "slow", exitCode: 1, durationMs: 39 },
      { command: "invalid-duration", exitCode: 0, durationMs: "not-a-number" },
    ]);

    expect(summary).toEqual({
      commandFailureCount: 1,
      commandExitCodes: {
        fast: 0,
        slow: 1,
        "invalid-duration": 0,
      },
      commandDurationTotalMs: 51,
      slowestCommand: {
        command: "slow",
        exitCode: 1,
        durationMs: 39,
      },
    });
  });
});

describe("summarizeSourceReportEvidence", () => {
  it("summarizes source report freshness and stale paths", () => {
    const summary = summarizeSourceReportEvidence({
      sourceReports: {
        loop: { path: ".tmp/workspace-housekeeping-loop.json", ageSeconds: 2.5, fresh: true, repoMatches: true },
        history: { path: ".tmp/local-history-map-reduce.json", ageSeconds: "8.25", fresh: false, repoMatches: true },
        augment: { path: ".tmp/augment-upload-scope.json", ageSeconds: 3, fresh: true, repoMatches: false },
      },
    });

    expect(summary).toEqual({
      sourceReportCount: 3,
      sourceReportMaxAgeSeconds: 8.25,
      staleSourceReportCount: 2,
      staleSourceReportPaths: [".tmp/augment-upload-scope.json", ".tmp/local-history-map-reduce.json"],
    });
  });
});
