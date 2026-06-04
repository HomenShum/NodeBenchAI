import { describe, expect, it } from "vitest";

import {
  classifyGoalCardMode,
  isOpenGoalStatus,
  normalizeGoalStatus,
  selectDevelopmentCandidate,
  summarizeCommandEvidence,
  summarizeCriteriaEvidence,
  summarizeDevelopmentBacklogEvidence,
  summarizeGitBranchEvidence,
  summarizeGoalQueueEvidence,
  summarizeHousekeepingReportEvidence,
  summarizeLaunchReportEvidence,
  summarizeSourceReportEvidence,
  summarizeTmpIgnoreEvidence,
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

  it("counts normalized proposed safe-local cards in goal-card selection reasons", () => {
    const candidate = selectDevelopmentCandidate(
      [
        {
          id: "goal-runtime-001",
          title: "Runtime goal",
          mode: "safe-local-development",
          surface: "runtime",
          area: "goal queue",
          priority: "P1",
        },
      ],
      {
        actionableAttention: [],
        launchRelevantBlockers: [],
        goalQueue: [
          {
            id: "runtime-001",
            status: "proposed (awaiting founder action)",
            mode: "safe-local-development",
          },
        ],
      },
    );

    expect(candidate?.selectionReason).toBe("Selected the highest-priority safe-local goal card from the queue (1 eligible).");
  });
});

describe("summarizeCommandEvidence", () => {
  it("summarizes command exits, failures, and timing", () => {
    const summary = summarizeCommandEvidence([
      { command: "fast", exitCode: 0, durationMs: 12 },
      { command: "slow", exitCode: 1, durationMs: 39, stdout: "stdout context", stderr: "stderr context" },
      { command: "invalid-duration", exitCode: 0, durationMs: "not-a-number" },
    ]);

    expect(summary).toEqual({
      commandCount: 3,
      commandSuccessCount: 2,
      commandFailureCount: 1,
      commandNames: ["fast", "slow", "invalid-duration"],
      commandExitCodes: {
        fast: 0,
        slow: 1,
        "invalid-duration": 0,
      },
      commandDurationTotalMs: 51,
      failedCommandSummaries: [
        {
          command: "slow",
          exitCode: 1,
          durationMs: 39,
          stdoutTail: "stdout context",
          stderrTail: "stderr context",
        },
      ],
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
      sourceReportPaths: [
        ".tmp/augment-upload-scope.json",
        ".tmp/local-history-map-reduce.json",
        ".tmp/workspace-housekeeping-loop.json",
      ],
      sourceReportFreshCount: 2,
      sourceReportRepoMatchCount: 2,
      sourceReportRepoMismatchPaths: [".tmp/augment-upload-scope.json"],
      sourceReportAgeSecondsByPath: {
        ".tmp/augment-upload-scope.json": 3,
        ".tmp/local-history-map-reduce.json": 8.25,
        ".tmp/workspace-housekeeping-loop.json": 2.5,
      },
      sourceReportMaxAgeSeconds: 8.25,
      staleSourceReportCount: 2,
      staleSourceReportPaths: [".tmp/augment-upload-scope.json", ".tmp/local-history-map-reduce.json"],
    });
  });
});

describe("summarizeHousekeepingReportEvidence", () => {
  it("summarizes housekeeping and Augment counts", () => {
    const summary = summarizeHousekeepingReportEvidence({
      passed: true,
      augmentReportPassed: true,
      operatorSummary: {
        notifyRecommended: false,
      },
      summary: {
        candidateFiles: 6198,
        threshold: "250000",
        finalSafe: 1,
        finalCaution: 2,
        finalKeep: 3,
        protectedPathsClean: true,
        removedSafeCount: 4,
        prunedWorktreeCount: 5,
        invalidRegistered: 6,
        stagedDiffCheckPassed: true,
        housekeepingOnlyDrift: false,
      },
    });

    expect(summary).toEqual({
      housekeepingPassed: true,
      housekeepingNotifyRecommended: false,
      augmentReportPassed: true,
      augmentCandidateFileCount: 6198,
      augmentThreshold: 250000,
      safeLocalHistoryCleanupCount: 1,
      cautionWorktreeCount: 2,
      keptWorktreeCount: 3,
      protectedPathsClean: true,
      removedSafePathCount: 4,
      prunedWorktreeCount: 5,
      invalidRegisteredWorktreeCount: 6,
      housekeepingStagedDiffCheckPassed: true,
      housekeepingOnlyDrift: false,
    });
  });
});

describe("summarizeLaunchReportEvidence", () => {
  it("summarizes launch pass flags, check counts, and failures", () => {
    const summary = summarizeLaunchReportEvidence({
      summary: {
        passed: true,
        staticPassed: true,
        livePassed: false,
        interactivePassed: true,
        staticChecks: 24,
        liveChecks: "5",
        interactiveChecks: 3,
        requiredStaticFailures: 0,
        blockers: 1,
        warnings: 2,
        liveFailures: 1,
        interactiveFailures: 0,
        remoteProbeInfra: {
          networkAccessDenied: true,
        },
      },
    });

    expect(summary).toEqual({
      launchPassed: true,
      launchStaticPassed: true,
      launchLivePassed: false,
      launchInteractivePassed: true,
      launchStaticCheckCount: 24,
      launchLiveCheckCount: 5,
      launchInteractiveCheckCount: 3,
      launchRequiredStaticFailureCount: 0,
      launchBlockerCount: 1,
      launchWarningCount: 2,
      launchLiveFailureCount: 1,
      launchInteractiveFailureCount: 0,
      launchRemoteProbeNetworkAccessDenied: true,
    });
  });
});

describe("summarizeTmpIgnoreEvidence", () => {
  it("summarizes ignored report paths and missing expected probes", () => {
    const summary = summarizeTmpIgnoreEvidence(
      {
        exitCode: 0,
        stdout:
          ".gitignore:186:*.tmp\t.tmp/workspace-housekeeping-verification.json\n" +
          ".gitignore:186:*.tmp\t.tmp/scratchnode-launch-scan.json\n",
      },
      [
        ".tmp/workspace-housekeeping-verification.json",
        ".tmp/scratchnode-launch-scan.json",
        ".tmp/scratchnode-launch-goal-loop.json",
      ],
    );

    expect(summary).toEqual({
      tmpIgnoreProbePassed: true,
      tmpIgnoreProbeExpectedCount: 3,
      tmpIgnoreProbeCount: 2,
      tmpIgnoreProbeMissingPaths: [".tmp/scratchnode-launch-goal-loop.json"],
      tmpIgnoredReportPaths: [".tmp/scratchnode-launch-scan.json", ".tmp/workspace-housekeeping-verification.json"],
      tmpIgnoreRuleSources: [".gitignore:186:*.tmp"],
    });
  });
});

describe("summarizeGitBranchEvidence", () => {
  it("parses branch tracking counts from git status", () => {
    expect(summarizeGitBranchEvidence("## main...origin/main [ahead 9, behind 2]\n")).toEqual({
      gitBranchName: "main",
      gitUpstreamName: "origin/main",
      gitTrackingKnown: true,
      gitAheadCount: 9,
      gitBehindCount: 2,
    });
  });

  it("handles branches without upstream tracking", () => {
    expect(summarizeGitBranchEvidence("## codex/local-work\n")).toEqual({
      gitBranchName: "codex/local-work",
      gitUpstreamName: null,
      gitTrackingKnown: false,
      gitAheadCount: 0,
      gitBehindCount: 0,
    });
  });
});

describe("summarizeCriteriaEvidence", () => {
  it("keeps failed criterion names and details in summary form", () => {
    const summary = summarizeCriteriaEvidence([
      { name: "housekeeping command passes", ok: true, detail: "ok" },
      { name: "git drift is clean after the loop", ok: false, detail: "M scripts/example.js" },
      { name: "no actionable attention items remain", ok: false },
    ]);

    expect(summary).toEqual({
      criterionCount: 3,
      passedCriterionCount: 1,
      passedCriterionNames: ["housekeeping command passes"],
      failedCriterionCount: 2,
      failedCriterionDetails: [
        { name: "git drift is clean after the loop", detail: "M scripts/example.js" },
        { name: "no actionable attention items remain", detail: "" },
      ],
    });
  });
});

describe("summarizeDevelopmentBacklogEvidence", () => {
  it("summarizes backlog count, modes, priorities, and ids", () => {
    const summary = summarizeDevelopmentBacklogEvidence([
      { id: "blocker-1", mode: "fix-first", priority: "P0" },
      { id: "attention-2", mode: "fix-first", priority: "P1" },
      { id: "goal-3", mode: "safe-local-development", priority: "P1" },
      { id: "drift-4" },
    ]);

    expect(summary).toEqual({
      developmentBacklogCount: 4,
      developmentBacklogModeCounts: {
        "fix-first": 2,
        "safe-local-development": 1,
        unknown: 1,
      },
      developmentBacklogPriorityCounts: {
        P0: 1,
        P1: 2,
        unknown: 1,
      },
      developmentBacklogIds: ["blocker-1", "attention-2", "goal-3", "drift-4"],
    });
  });
});

describe("summarizeGoalQueueEvidence", () => {
  it("summarizes goal queue count, statuses, modes, priorities, and open eligible ids", () => {
    const summary = summarizeGoalQueueEvidence([
      { id: "goal-1", status: "queued", mode: "human-gated", priority: "P1" },
      { id: "goal-2", status: "queued", mode: "safe-local-development", priority: "P2" },
      { id: "goal-3", status: "done after local verification", mode: "human-gated", priority: "P1" },
      { id: "goal-4" },
    ]);

    expect(summary).toEqual({
      goalQueueCount: 4,
      goalQueueStatusCounts: {
        done: 1,
        queued: 2,
        unknown: 1,
      },
      goalQueueModeCounts: {
        "human-gated": 2,
        "safe-local-development": 1,
        unknown: 1,
      },
      goalQueuePriorityCounts: {
        P1: 2,
        P2: 1,
        unknown: 1,
      },
      openGoalQueueCount: 2,
      openGoalQueueIds: ["goal-1", "goal-2"],
      safeLocalGoalCount: 1,
      safeLocalGoalIds: ["goal-2"],
      humanGatedGoalCount: 1,
      humanGatedGoalIds: ["goal-1"],
    });
  });
});

describe("normalizeGoalStatus", () => {
  it("collapses long status text into stable buckets", () => {
    expect(normalizeGoalStatus("proposed (awaiting founder action)")).toBe("proposed");
    expect(normalizeGoalStatus("shipping - PR #500 after founder approval")).toBe("shipping");
    expect(normalizeGoalStatus("shipped (verified locally; deploy deferred)")).toBe("shipped");
    expect(normalizeGoalStatus("needs triage")).toBe("other");
  });
});

describe("isOpenGoalStatus", () => {
  it("treats proposed, queued, and active buckets as open", () => {
    expect(isOpenGoalStatus("proposed (awaiting founder action)")).toBe(true);
    expect(isOpenGoalStatus("queued")).toBe(true);
    expect(isOpenGoalStatus("active: in progress")).toBe(true);
    expect(isOpenGoalStatus("shipping - PR open")).toBe(false);
    expect(isOpenGoalStatus("shipped after merge")).toBe(false);
  });
});
