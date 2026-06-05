import { describe, expect, it } from "vitest";

import {
  classifyGoalCardMode,
  isOpenGoalStatus,
  knownCautionEntries,
  normalizeGoalStatus,
  selectDevelopmentCandidate,
  summarizeCommandEvidence,
  summarizeCriteriaEvidence,
  summarizeDevelopmentBacklogEvidence,
  summarizeDevelopmentCandidateEvidence,
  summarizeDevelopmentCandidateSourcePathEvidence,
  summarizeGitBranchEvidence,
  summarizeGitHeadEvidence,
  summarizeGitStatusEvidence,
  summarizeGoalEvidence,
  summarizeGoalQueueEvidence,
  summarizeHousekeepingReportEvidence,
  summarizeKnownCautionEvidence,
  summarizeKnownCautionSuppressionEvidence,
  summarizeLaunchReportEvidence,
  summarizeNotificationEvidence,
  summarizePreviousGoalLoopEvidence,
  summarizeRequiredReportLoadEvidence,
  summarizeRequiredReportStructureEvidence,
  summarizeReportMetadataEvidence,
  summarizeReportSchemaEvidence,
  summarizeSourceReportEvidence,
  summarizeVerificationEntryPointEvidence,
  summarizeTmpIgnoreEvidence,
  summarizeWorkflowModelEvidence,
  goalLoopEvidenceFieldNames,
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
    expect(candidate?.selectionType).toBe("automation-fallback");
    expect(candidate?.eligibleSafeLocalGoalCount).toBe(0);
    expect(candidate?.openGoalQueueCount).toBe(1);
    expect(candidate?.actionability).toBe("opportunistic-automation");
    expect(candidate?.actionRequired).toBe(false);
    expect(candidate?.quietPassEligible).toBe(true);
    expect(candidate?.actionabilityReason).toBe(
      "Only the automation fallback is available; commit a slice only when a bounded instrumentation gap is found.",
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
    expect(candidate?.selectionType).toBe("safe-local-goal");
    expect(candidate?.eligibleSafeLocalGoalCount).toBe(1);
    expect(candidate?.openGoalQueueCount).toBe(1);
    expect(candidate?.actionability).toBe("safe-local-slice");
    expect(candidate?.actionRequired).toBe(true);
    expect(candidate?.quietPassEligible).toBe(false);
    expect(candidate?.actionabilityReason).toBe("A safe-local goal card is eligible; implement one narrow verified slice.");
  });

  it("prioritizes tracked-upstream sync ahead of new development slices", () => {
    const candidate = selectDevelopmentCandidate(
      [
        {
          id: "sync-1",
          title: "Local branch is behind origin/main by 2 commits",
          mode: "fix-first",
          surface: "repo",
          area: "branch sync",
          priority: "P1",
        },
      ],
      {
        actionableAttention: [],
        launchRelevantBlockers: [],
        goalQueue: [],
      },
    );

    expect(candidate?.selectionReason).toBe(
      "Tracked upstream is ahead of the local branch; sync before starting a new autonomous slice.",
    );
    expect(candidate?.selectionType).toBe("tracked-upstream-sync");
    expect(candidate?.eligibleSafeLocalGoalCount).toBe(0);
    expect(candidate?.openGoalQueueCount).toBe(0);
    expect(candidate?.actionability).toBe("human-coordinated-sync");
    expect(candidate?.actionRequired).toBe(true);
    expect(candidate?.quietPassEligible).toBe(false);
    expect(candidate?.actionabilityReason).toBe(
      "The tracked branch is behind upstream; sync requires a coordinated branch update before local slices continue.",
    );
  });

  it("blocks autonomous slices when HEAD is detached", () => {
    const candidate = selectDevelopmentCandidate(
      [
        {
          id: "head-1",
          title: "Detached HEAD must be attached to a branch before new autonomous development",
          mode: "human-gated",
          surface: "repo",
          area: "branch attachment",
          priority: "P1",
        },
      ],
      {
        actionableAttention: [],
        launchRelevantBlockers: [],
        goalQueue: [],
      },
    );

    expect(candidate?.selectionReason).toBe(
      "HEAD is detached; attach to a branch before starting a new autonomous slice.",
    );
    expect(candidate?.selectionType).toBe("detached-head");
    expect(candidate?.eligibleSafeLocalGoalCount).toBe(0);
    expect(candidate?.openGoalQueueCount).toBe(0);
    expect(candidate?.actionability).toBe("human-coordinated-branch-attach");
    expect(candidate?.actionRequired).toBe(true);
    expect(candidate?.quietPassEligible).toBe(false);
    expect(candidate?.actionabilityReason).toBe(
      "Detached HEAD is present; attach to the intended branch before local slices continue.",
    );
  });
});

describe("knownCautionEntries", () => {
  it("surfaces explicit invalid worktree keep entries from local-history output", () => {
    const cautions = knownCautionEntries(
      {
        cautionEntries: [],
        summary: {
          invalidRegistered: 1,
        },
      },
      {
        buckets: {
          keep: [
            {
              path: ".worktrees/p0-row-delta",
              reason: "invalid registered worktree; inspect git metadata first",
              branch: "refs/heads/fix/spreadsheet-operation-validate",
              dirty: false,
              locked: false,
              exists: true,
              gitUsable: false,
            },
          ],
        },
      },
    );

    expect(cautions).toEqual([
      {
        path: ".worktrees/p0-row-delta",
        reason: "invalid registered worktree; inspect git metadata first",
        branch: "refs/heads/fix/spreadsheet-operation-validate",
        dirty: false,
        locked: false,
        exists: true,
        gitUsable: false,
      },
    ]);
  });

  it("keeps the generic fallback when local-history details are unavailable", () => {
    const cautions = knownCautionEntries({
      cautionEntries: [],
      summary: {
        invalidRegistered: 2,
      },
    });

    expect(cautions).toEqual([
      {
        path: "git worktree metadata",
        reason: "invalid registered worktrees present: 2; explicit keep-entry details unavailable from local-history map/reduce",
      },
    ]);
  });
});

describe("summarizeCommandEvidence", () => {
  it("summarizes command exits, failures, and timing", () => {
    const summary = summarizeCommandEvidence(
      [
        { command: "fast", exitCode: 0, durationMs: 12 },
        { command: "slow", exitCode: 1, durationMs: 39, stdout: "stdout context", stderr: "stderr context" },
        { command: "invalid-duration", exitCode: 0, durationMs: "not-a-number" },
      ],
      { slowCommandWarningThresholdMs: 30 },
    );

    expect(summary).toEqual({
      commandCount: 3,
      commandSuccessCount: 2,
      commandFailureCount: 1,
      commandNames: ["fast", "slow", "invalid-duration"],
      commandOccurrenceCounts: {
        fast: 1,
        "invalid-duration": 1,
        slow: 1,
      },
      duplicateCommandNames: [],
      commandExitCodes: {
        fast: 0,
        slow: 1,
        "invalid-duration": 0,
      },
      commandExitCodeHistory: {
        fast: [0],
        "invalid-duration": [0],
        slow: [1],
      },
      commandDurationMsByName: {
        fast: 12,
        slow: 39,
        "invalid-duration": 0,
      },
      commandDurationTotalMs: 51,
      commandTimeoutMs: 240000,
      timedOutCommandCount: 0,
      timedOutCommandNames: [],
      slowCommandWarningThresholdMs: 30,
      slowCommandCount: 1,
      slowCommandNames: ["slow"],
      slowCommandSummaries: [
        {
          command: "slow",
          exitCode: 1,
          durationMs: 39,
        },
      ],
      failedCommandSummaries: [
        {
          command: "slow",
          exitCode: 1,
          durationMs: 39,
          timedOut: false,
          timeoutMs: 240000,
          signal: null,
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

  it("reports timed-out commands explicitly", () => {
    const summary = summarizeCommandEvidence(
      [
        {
          command: "hung-check",
          exitCode: 124,
          durationMs: 240001,
          timedOut: true,
          timeoutMs: 240000,
          signal: "SIGTERM",
          stderr: "Timed out after 240000ms",
        },
      ],
      { commandTimeoutMs: 240000 },
    );

    expect(summary).toEqual({
      commandCount: 1,
      commandSuccessCount: 0,
      commandFailureCount: 1,
      commandNames: ["hung-check"],
      commandOccurrenceCounts: {
        "hung-check": 1,
      },
      duplicateCommandNames: [],
      commandExitCodes: {
        "hung-check": 124,
      },
      commandExitCodeHistory: {
        "hung-check": [124],
      },
      commandDurationMsByName: {
        "hung-check": 240001,
      },
      commandDurationTotalMs: 240001,
      commandTimeoutMs: 240000,
      timedOutCommandCount: 1,
      timedOutCommandNames: ["hung-check"],
      slowCommandWarningThresholdMs: 90000,
      slowCommandCount: 1,
      slowCommandNames: ["hung-check"],
      slowCommandSummaries: [
        {
          command: "hung-check",
          exitCode: 124,
          durationMs: 240001,
        },
      ],
      failedCommandSummaries: [
        {
          command: "hung-check",
          exitCode: 124,
          durationMs: 240001,
          timedOut: true,
          timeoutMs: 240000,
          signal: "SIGTERM",
          stdoutTail: "",
          stderrTail: "Timed out after 240000ms",
        },
      ],
      slowestCommand: {
        command: "hung-check",
        exitCode: 124,
        durationMs: 240001,
      },
    });
  });

  it("flags duplicate command invocations so keyed evidence stays auditable", () => {
    const summary = summarizeCommandEvidence([
      { command: "npm run scratchnode:launch:goal", exitCode: 0, durationMs: 10 },
      { command: "npm run scratchnode:launch:goal", exitCode: 1, durationMs: 15 },
      { command: "git diff --check", exitCode: 0, durationMs: 5 },
    ]);

    expect(summary.commandOccurrenceCounts).toEqual({
      "git diff --check": 1,
      "npm run scratchnode:launch:goal": 2,
    });
    expect(summary.duplicateCommandNames).toEqual(["npm run scratchnode:launch:goal"]);
    expect(summary.commandExitCodes).toEqual({
      "npm run scratchnode:launch:goal": 1,
      "git diff --check": 0,
    });
    expect(summary.commandExitCodeHistory).toEqual({
      "git diff --check": [0],
      "npm run scratchnode:launch:goal": [0, 1],
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
      summary: {
        maxSourceReportAgeSeconds: 600,
        maxFutureReportSkewSeconds: 30,
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
      sourceReportFreshnessThresholdSeconds: 600,
      sourceReportFutureSkewThresholdSeconds: 30,
      staleSourceReportCount: 2,
      staleSourceReportPaths: [".tmp/augment-upload-scope.json", ".tmp/local-history-map-reduce.json"],
    });
  });
});

describe("summarizeRequiredReportLoadEvidence", () => {
  it("surfaces missing and malformed required reports explicitly", () => {
    const summary = summarizeRequiredReportLoadEvidence({
      housekeeping: { passed: true },
      launch: { parseError: "Unexpected token } in JSON at position 12" },
      localHistory: null,
      packageJson: { scripts: {} },
    });

    expect(summary).toEqual({
      requiredReportCount: 4,
      requiredReportNames: ["housekeeping", "launch", "localHistory", "packageJson"],
      requiredReportLoadedCount: 2,
      requiredReportMissingNames: ["localHistory"],
      requiredReportParseErrors: [
        {
          name: "launch",
          parseError: "Unexpected token } in JSON at position 12",
        },
      ],
      requiredReportLoadFailures: [
        "launch: Unexpected token } in JSON at position 12",
        "localHistory: missing",
      ],
    });
  });
});

describe("summarizeHousekeepingReportEvidence", () => {
  it("summarizes housekeeping and Augment counts", () => {
    const summary = summarizeHousekeepingReportEvidence({
      passed: true,
      augmentReportPassed: true,
      operatorSummary: {
        status: "WARN",
        message: "Housekeeping verified with attention items: 1 warning(s).",
        notifyRecommended: false,
      },
      failures: ["protectedPathsClean must be true"],
      warnings: ["caution worktree preserved"],
      drift: {
        stagedCount: "1",
        unstagedCount: 2,
        untrackedCount: 3,
        housekeepingOnly: false,
        nonHousekeepingStagedPaths: ["scripts/edit-a.mjs"],
        nonHousekeepingUnstagedPaths: ["src/edit-b.ts"],
        nonHousekeepingUntrackedPaths: ["notes/edit-c.md"],
      },
      summary: {
        candidateFiles: 6198,
        threshold: "250000",
        criticalIgnoreProbesPassed: true,
        untrackedIncluded: "7",
        finalSafe: 1,
        finalCaution: 2,
        finalKeep: 3,
        protectedPathsClean: true,
        protectedPathCount: "8",
        dirtyProtectedPathCount: 0,
        removedSafeCount: 4,
        prunedWorktreeCount: 5,
        invalidRegistered: 6,
        stagedDiffCheckPassed: true,
        housekeepingOnlyDrift: false,
      },
    });

    expect(summary).toEqual({
      housekeepingPassed: true,
      housekeepingOperatorStatus: "WARN",
      housekeepingOperatorMessage: "Housekeeping verified with attention items: 1 warning(s).",
      housekeepingNotifyRecommended: false,
      housekeepingFailureCount: 1,
      housekeepingFailures: ["protectedPathsClean must be true"],
      housekeepingWarningCount: 1,
      housekeepingWarnings: ["caution worktree preserved"],
      augmentReportPassed: true,
      augmentCandidateFileCount: 6198,
      augmentThreshold: 250000,
      housekeepingCriticalIgnoreProbesPassed: true,
      housekeepingUntrackedIncludedCount: 7,
      safeLocalHistoryCleanupCount: 1,
      cautionWorktreeCount: 2,
      keptWorktreeCount: 3,
      protectedPathsClean: true,
      protectedPathCount: 8,
      dirtyProtectedPathCount: 0,
      removedSafePathCount: 4,
      prunedWorktreeCount: 5,
      invalidRegisteredWorktreeCount: 6,
      housekeepingStagedDiffCheckPassed: true,
      housekeepingOnlyDrift: false,
      housekeepingDriftStagedCount: 1,
      housekeepingDriftUnstagedCount: 2,
      housekeepingDriftUntrackedCount: 3,
      housekeepingDriftHousekeepingOnly: false,
      housekeepingNonHousekeepingDriftPaths: ["notes/edit-c.md", "scripts/edit-a.mjs", "src/edit-b.ts"],
    });
  });
});

describe("summarizeLaunchReportEvidence", () => {
  it("summarizes launch pass flags, check counts, and actionable vs raw failures", () => {
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
      staticChecks: [
        { ok: true, name: "home-v5 contains share modal" },
        { ok: false, name: "goal loop reports branch and command evidence", detail: "field missing" },
      ],
      liveChecks: [
        { ok: false, name: "scratchnode.live apex raw HTML", url: "https://scratchnode.live", durationMs: 1234 },
        { ok: false, optional: true, name: "optional remote probe" },
      ],
      interactiveChecks: [{ ok: true, name: "scratchnode apex interactive landing" }],
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
      launchStaticCheckNames: ["home-v5 contains share modal", "goal loop reports branch and command evidence"],
      launchLiveCheckNames: ["scratchnode.live apex raw HTML", "optional remote probe"],
      launchInteractiveCheckNames: ["scratchnode apex interactive landing"],
      launchFailedCheckNames: ["goal loop reports branch and command evidence"],
      launchFailedCheckDetails: [
        {
          name: "goal loop reports branch and command evidence",
          url: null,
          detail: "field missing",
          durationMs: null,
        },
      ],
      launchRawFailedCheckCount: 2,
      launchRawFailedCheckNames: ["goal loop reports branch and command evidence", "scratchnode.live apex raw HTML"],
      launchRawFailedCheckDetails: [
        {
          name: "goal loop reports branch and command evidence",
          url: null,
          detail: "field missing",
          durationMs: null,
        },
        {
          name: "scratchnode.live apex raw HTML",
          url: "https://scratchnode.live",
          detail: "",
          durationMs: 1234,
        },
      ],
      launchSuppressedRemoteProbeFailureCount: 1,
      launchSuppressedRemoteProbeFailureNames: ["scratchnode.live apex raw HTML"],
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
      gitDetachedHead: false,
      gitDetachedHeadDetail: null,
      gitBranchBehindUpstream: true,
      gitBranchSyncDetail: "Behind origin/main by 2 commits.",
    });
  });

  it("handles branches without upstream tracking", () => {
    expect(summarizeGitBranchEvidence("## codex/local-work\n")).toEqual({
      gitBranchName: "codex/local-work",
      gitUpstreamName: null,
      gitTrackingKnown: false,
      gitAheadCount: 0,
      gitBehindCount: 0,
      gitDetachedHead: false,
      gitDetachedHeadDetail: null,
      gitBranchBehindUpstream: false,
      gitBranchSyncDetail: "No tracked upstream configured.",
    });
  });

  it("marks tracked branches that are not behind as in sync", () => {
    expect(summarizeGitBranchEvidence("## main...origin/main [ahead 3]\n")).toEqual({
      gitBranchName: "main",
      gitUpstreamName: "origin/main",
      gitTrackingKnown: true,
      gitAheadCount: 3,
      gitBehindCount: 0,
      gitDetachedHead: false,
      gitDetachedHeadDetail: null,
      gitBranchBehindUpstream: false,
      gitBranchSyncDetail: "Not behind origin/main.",
    });
  });

  it("surfaces detached HEAD state explicitly", () => {
    expect(summarizeGitBranchEvidence("## HEAD (detached at c4c9d969)\n")).toEqual({
      gitBranchName: "HEAD",
      gitUpstreamName: null,
      gitTrackingKnown: false,
      gitAheadCount: 0,
      gitBehindCount: 0,
      gitDetachedHead: true,
      gitDetachedHeadDetail: "detached at c4c9d969",
      gitBranchBehindUpstream: false,
      gitBranchSyncDetail: "Detached HEAD: detached at c4c9d969.",
    });
  });
});

describe("summarizeGitHeadEvidence", () => {
  it("parses the current HEAD summary into sha and subject fields", () => {
    expect(summarizeGitHeadEvidence("01fc7a01 summarize launch notification evidence\n")).toEqual({
      gitHeadSummary: "01fc7a01 summarize launch notification evidence",
      gitHeadShortSha: "01fc7a01",
      gitHeadSubject: "summarize launch notification evidence",
    });
  });

  it("keeps empty git output explicit", () => {
    expect(summarizeGitHeadEvidence("")).toEqual({
      gitHeadSummary: null,
      gitHeadShortSha: null,
      gitHeadSubject: null,
    });
  });
});

describe("summarizeGitStatusEvidence", () => {
  it("keeps drift entries normalized in summary form", () => {
    expect(summarizeGitStatusEvidence(" M scripts/example.js \n?? notes/todo.md\n\n")).toEqual({
      gitStatus: "M scripts/example.js\n?? notes/todo.md",
      gitStatusEntryCount: 2,
    });
  });

  it("keeps clean worktrees explicit", () => {
    expect(summarizeGitStatusEvidence("")).toEqual({
      gitStatus: "",
      gitStatusEntryCount: 0,
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

describe("summarizeNotificationEvidence", () => {
  it("explains why notification is or is not recommended", () => {
    expect(
      summarizeNotificationEvidence([
        { name: "housekeeping command passes", ok: true },
        { name: "git drift is clean after the loop", ok: true },
      ]),
    ).toEqual({
      notifyRecommended: false,
      notifyRecommendationReason: "All launch goal criteria passed; no notification needed.",
    });

    expect(
      summarizeNotificationEvidence([
        { name: "housekeeping command passes", ok: false },
        { name: "git drift is clean after the loop", ok: false },
      ]),
    ).toEqual({
      notifyRecommended: true,
      notifyRecommendationReason: "Launch goal failures (2): housekeeping command passes; git drift is clean after the loop",
    });
  });
});

describe("summarizeReportSchemaEvidence", () => {
  it("keeps the report schema version explicit and normalized", () => {
    expect(summarizeReportSchemaEvidence(" scratchnode-launch-goal-loop/v1 ")).toEqual({
      reportSchemaVersion: "scratchnode-launch-goal-loop/v1",
    });
    expect(summarizeReportSchemaEvidence("")).toEqual({
      reportSchemaVersion: null,
    });
  });
});

describe("summarizeReportMetadataEvidence", () => {
  it("keeps report timestamp and path explicit", () => {
    expect(
      summarizeReportMetadataEvidence({
        generatedAt: " 2026-06-04T03:08:00.000Z ",
        reportPath: " .tmp/scratchnode-launch-goal-loop.json ",
      }),
    ).toEqual({
      reportGeneratedAt: "2026-06-04T03:08:00.000Z",
      reportPath: ".tmp/scratchnode-launch-goal-loop.json",
    });
  });
});

describe("summarizeRequiredReportStructureEvidence", () => {
  it("proves the nested housekeeping and launch summary structures are present", () => {
    expect(
      summarizeRequiredReportStructureEvidence({
        housekeepingReport: {
          operatorSummary: { status: "OK" },
          summary: { candidateFiles: 10 },
        },
        launchReport: {
          summary: { passed: true },
        },
      }),
    ).toEqual({
      requiredReportStructureCount: 3,
      requiredReportStructureReadyCount: 3,
      requiredReportStructureNames: ["housekeeping.operatorSummary", "housekeeping.summary", "launch.summary"],
      requiredReportStructureFailures: [],
    });
  });

  it("fails closed when a required nested report structure is missing", () => {
    expect(
      summarizeRequiredReportStructureEvidence({
        housekeepingReport: {
          summary: { candidateFiles: 10 },
        },
        launchReport: null,
      }),
    ).toEqual({
      requiredReportStructureCount: 3,
      requiredReportStructureReadyCount: 1,
      requiredReportStructureNames: ["housekeeping.operatorSummary", "housekeeping.summary", "launch.summary"],
      requiredReportStructureFailures: ["housekeeping.operatorSummary: missing", "launch.summary: missing"],
    });
  });
});

describe("summarizeGoalEvidence", () => {
  it("summarizes goal id and source refs", () => {
    expect(
      summarizeGoalEvidence({
        id: "scratchnode-nodebench-development-goal-cron",
        sourceRefs: ["docs/runbooks/SCRATCHNODE_LAUNCH_DAY.md", "", null],
      }),
    ).toEqual({
      goalId: "scratchnode-nodebench-development-goal-cron",
      goalSourceRefCount: 1,
      goalSourceRefs: ["docs/runbooks/SCRATCHNODE_LAUNCH_DAY.md"],
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

describe("summarizeDevelopmentCandidateEvidence", () => {
  it("summarizes the selected development candidate", () => {
    const summary = summarizeDevelopmentCandidateEvidence({
      id: "dev-goal-loop-instrumentation",
      title: "Improve loop instrumentation and evidence quality",
      mode: "safe-local-development",
      priority: "P1",
      surface: "automation",
      area: "self-improvement loop",
      sourcePath: "scripts/scratchnode/runLaunchGoalLoop.mjs",
      suggestedVerification: ["npm run scratchnode:launch:goal", "git diff --check"],
      why: "Keep future loops honest.",
      maxSlice: "Tighten one detector.",
      selectionType: "automation-fallback",
      eligibleSafeLocalGoalCount: 0,
      openGoalQueueCount: 4,
      selectionReason: "All gates are green.",
      actionability: "opportunistic-automation",
      actionRequired: false,
      quietPassEligible: true,
      actionabilityReason: "Only the automation fallback is available.",
    });

    expect(summary).toEqual({
      nextDevelopmentCandidate: "dev-goal-loop-instrumentation",
      nextDevelopmentCandidateTitle: "Improve loop instrumentation and evidence quality",
      nextDevelopmentCandidateMode: "safe-local-development",
      nextDevelopmentCandidatePriority: "P1",
      nextDevelopmentCandidateSurface: "automation",
      nextDevelopmentCandidateArea: "self-improvement loop",
      nextDevelopmentCandidateSourcePath: "scripts/scratchnode/runLaunchGoalLoop.mjs",
      nextDevelopmentCandidateSuggestedVerification: ["npm run scratchnode:launch:goal", "git diff --check"],
      nextDevelopmentCandidateWhy: "Keep future loops honest.",
      nextDevelopmentCandidateMaxSlice: "Tighten one detector.",
      nextDevelopmentCandidateSelectionType: "automation-fallback",
      nextDevelopmentCandidateEligibleSafeLocalGoalCount: 0,
      nextDevelopmentCandidateOpenGoalQueueCount: 4,
      nextDevelopmentCandidateReason: "All gates are green.",
      nextDevelopmentCandidateActionability: "opportunistic-automation",
      nextDevelopmentCandidateActionRequired: false,
      nextDevelopmentCandidateQuietPassEligible: true,
      nextDevelopmentCandidateActionabilityReason: "Only the automation fallback is available.",
    });
  });
});

describe("summarizeKnownCautionEvidence", () => {
  it("surfaces caution paths and reasons for invalid worktree reporting", () => {
    const summary = summarizeKnownCautionEvidence([
      {
        path: ".worktrees/p0-row-delta",
        reason: "invalid registered worktree; inspect git metadata first",
        dirty: true,
        gitUsable: false,
      },
      {
        path: ".worktrees/keep-clean",
        reason: "clean registered worktree; explicit prune only",
        locked: true,
        exists: false,
      },
    ]);

    expect(summary).toEqual({
      knownCautionPaths: [".worktrees/keep-clean", ".worktrees/p0-row-delta"],
      knownCautionPathReasons: [
        {
          path: ".worktrees/p0-row-delta",
          reason: "invalid registered worktree; inspect git metadata first",
        },
        {
          path: ".worktrees/keep-clean",
          reason: "clean registered worktree; explicit prune only",
        },
      ],
      knownCautionDirtyPaths: [".worktrees/p0-row-delta"],
      knownCautionLockedPaths: [".worktrees/keep-clean"],
      knownCautionMissingPaths: [".worktrees/keep-clean"],
      knownCautionGitInaccessiblePaths: [".worktrees/p0-row-delta"],
      invalidRegisteredWorktreePaths: [".worktrees/p0-row-delta"],
      explicitPruneCautionWorktreePaths: [".worktrees/keep-clean"],
      explicitPruneCautionWorktreePathReasons: [
        {
          path: ".worktrees/keep-clean",
          reason: "clean registered worktree; explicit prune only",
        },
      ],
    });
  });
});

describe("summarizeKnownCautionSuppressionEvidence", () => {
  it("explains when a housekeeping notification is suppressed by known cautions", () => {
    expect(
      summarizeKnownCautionSuppressionEvidence({
        housekeepingReport: {
          operatorSummary: {
            notifyRecommended: true,
            attentionItems: ["caution worktrees present: 1"],
          },
        },
        knownCautions: [{ path: ".worktrees/keep-clean" }],
        actionableAttention: [],
      }),
    ).toEqual({
      knownCautionSuppressesHousekeepingNotify: true,
      knownCautionSuppressedAttentionCount: 1,
      knownCautionSuppressedAttentionItems: ["caution worktrees present: 1"],
    });

    expect(
      summarizeKnownCautionSuppressionEvidence({
        housekeepingReport: {
          operatorSummary: {
            notifyRecommended: true,
            attentionItems: ["caution worktrees present: 1", "non-housekeeping drift is present"],
          },
        },
        knownCautions: [{ path: ".worktrees/keep-clean" }],
        actionableAttention: ["non-housekeeping drift is present"],
      }),
    ).toEqual({
      knownCautionSuppressesHousekeepingNotify: false,
      knownCautionSuppressedAttentionCount: 1,
      knownCautionSuppressedAttentionItems: ["caution worktrees present: 1"],
    });
  });
});

describe("summarizeVerificationEntryPointEvidence", () => {
  it("validates npm-run verification scripts against package.json", () => {
    const summary = summarizeVerificationEntryPointEvidence(
      ["npm run scratchnode:launch:goal", "npm run repo:augment:check", "git diff --check"],
      {
        scripts: {
          "scratchnode:launch:goal": "node scripts/scratchnode/runLaunchGoalLoop.mjs",
          "repo:augment:check": "powershell -File scripts/repo/checkAugmentUploadScope.ps1",
        },
      },
    );

    expect(summary).toEqual({
      nextDevelopmentCandidateHasSuggestedVerification: true,
      nextDevelopmentCandidateVerificationCommandCount: 3,
      nextDevelopmentCandidateVerificationCommandOccurrenceCounts: {
        "git diff --check": 1,
        "npm run repo:augment:check": 1,
        "npm run scratchnode:launch:goal": 1,
      },
      nextDevelopmentCandidateVerificationDuplicateCommands: [],
      nextDevelopmentCandidateVerificationScriptCount: 2,
      nextDevelopmentCandidateVerificationScriptRefs: ["scratchnode:launch:goal", "repo:augment:check"],
      nextDevelopmentCandidateVerificationResolvedScriptCount: 2,
      nextDevelopmentCandidateVerificationResolvedScriptRefs: ["scratchnode:launch:goal", "repo:augment:check"],
      nextDevelopmentCandidateVerificationTargetPathCount: 2,
      nextDevelopmentCandidateVerificationTargetPaths: [
        "scripts/scratchnode/runLaunchGoalLoop.mjs",
        "scripts/repo/checkAugmentUploadScope.ps1",
      ],
      nextDevelopmentCandidateVerificationEntryPointsValid: true,
      nextDevelopmentCandidateVerificationMissingScripts: [],
      nextDevelopmentCandidateVerificationMissingTargetPaths: [],
      nextDevelopmentCandidateVerificationUnsupportedCommands: [],
    });
  });

  it("flags missing npm-run scripts and unsupported command formats", () => {
    const summary = summarizeVerificationEntryPointEvidence(
      ["npm run missing:script", "echo custom verifier"],
      {
        scripts: {
          "scratchnode:launch:goal": "node scripts/scratchnode/runLaunchGoalLoop.mjs",
        },
      },
    );

    expect(summary).toEqual({
      nextDevelopmentCandidateHasSuggestedVerification: true,
      nextDevelopmentCandidateVerificationCommandCount: 2,
      nextDevelopmentCandidateVerificationCommandOccurrenceCounts: {
        "echo custom verifier": 1,
        "npm run missing:script": 1,
      },
      nextDevelopmentCandidateVerificationDuplicateCommands: [],
      nextDevelopmentCandidateVerificationScriptCount: 1,
      nextDevelopmentCandidateVerificationScriptRefs: ["missing:script"],
      nextDevelopmentCandidateVerificationResolvedScriptCount: 1,
      nextDevelopmentCandidateVerificationResolvedScriptRefs: ["missing:script"],
      nextDevelopmentCandidateVerificationTargetPathCount: 0,
      nextDevelopmentCandidateVerificationTargetPaths: [],
      nextDevelopmentCandidateVerificationEntryPointsValid: false,
      nextDevelopmentCandidateVerificationMissingScripts: ["missing:script"],
      nextDevelopmentCandidateVerificationMissingTargetPaths: [],
      nextDevelopmentCandidateVerificationUnsupportedCommands: ["echo custom verifier"],
    });
  });

  it("fails closed when an npm-run verification script points at a missing local file target", () => {
    const summary = summarizeVerificationEntryPointEvidence(["npm run scratchnode:launch:goal"], {
      scripts: {
        "scratchnode:launch:goal": "node scripts/scratchnode/does-not-exist.mjs",
      },
    });

    expect(summary).toEqual({
      nextDevelopmentCandidateHasSuggestedVerification: true,
      nextDevelopmentCandidateVerificationCommandCount: 1,
      nextDevelopmentCandidateVerificationCommandOccurrenceCounts: {
        "npm run scratchnode:launch:goal": 1,
      },
      nextDevelopmentCandidateVerificationDuplicateCommands: [],
      nextDevelopmentCandidateVerificationScriptCount: 1,
      nextDevelopmentCandidateVerificationScriptRefs: ["scratchnode:launch:goal"],
      nextDevelopmentCandidateVerificationResolvedScriptCount: 1,
      nextDevelopmentCandidateVerificationResolvedScriptRefs: ["scratchnode:launch:goal"],
      nextDevelopmentCandidateVerificationTargetPathCount: 1,
      nextDevelopmentCandidateVerificationTargetPaths: ["scripts/scratchnode/does-not-exist.mjs"],
      nextDevelopmentCandidateVerificationEntryPointsValid: false,
      nextDevelopmentCandidateVerificationMissingScripts: [],
      nextDevelopmentCandidateVerificationMissingTargetPaths: ["scripts/scratchnode/does-not-exist.mjs"],
      nextDevelopmentCandidateVerificationUnsupportedCommands: [],
    });
  });

  it("fails closed when a direct verifier command points at a missing local file target", () => {
    const summary = summarizeVerificationEntryPointEvidence(
      ["powershell -File scripts/repo/does-not-exist.ps1", "node scripts/scratchnode/runLaunchGoalLoop.mjs"],
      {
        scripts: {
          "scratchnode:launch:goal": "node scripts/scratchnode/runLaunchGoalLoop.mjs",
        },
      },
    );

    expect(summary).toEqual({
      nextDevelopmentCandidateHasSuggestedVerification: true,
      nextDevelopmentCandidateVerificationCommandCount: 2,
      nextDevelopmentCandidateVerificationCommandOccurrenceCounts: {
        "node scripts/scratchnode/runLaunchGoalLoop.mjs": 1,
        "powershell -File scripts/repo/does-not-exist.ps1": 1,
      },
      nextDevelopmentCandidateVerificationDuplicateCommands: [],
      nextDevelopmentCandidateVerificationScriptCount: 0,
      nextDevelopmentCandidateVerificationScriptRefs: [],
      nextDevelopmentCandidateVerificationResolvedScriptCount: 0,
      nextDevelopmentCandidateVerificationResolvedScriptRefs: [],
      nextDevelopmentCandidateVerificationTargetPathCount: 2,
      nextDevelopmentCandidateVerificationTargetPaths: [
        "scripts/repo/does-not-exist.ps1",
        "scripts/scratchnode/runLaunchGoalLoop.mjs",
      ],
      nextDevelopmentCandidateVerificationEntryPointsValid: false,
      nextDevelopmentCandidateVerificationMissingScripts: [],
      nextDevelopmentCandidateVerificationMissingTargetPaths: ["scripts/repo/does-not-exist.ps1"],
      nextDevelopmentCandidateVerificationUnsupportedCommands: [],
    });
  });

  it("fails closed on inline shell evaluation and chained verification commands", () => {
    const summary = summarizeVerificationEntryPointEvidence(
      [
        'node --eval "console.log(1)"',
        'powershell -Command "Write-Host hi"',
        "npx vitest run && git diff --check",
        "pwsh -c Get-Date",
      ],
      {
        scripts: {
          "scratchnode:launch:goal": "node scripts/scratchnode/runLaunchGoalLoop.mjs",
        },
      },
    );

    expect(summary).toEqual({
      nextDevelopmentCandidateHasSuggestedVerification: true,
      nextDevelopmentCandidateVerificationCommandCount: 4,
      nextDevelopmentCandidateVerificationCommandOccurrenceCounts: {
        'node --eval "console.log(1)"': 1,
        "npx vitest run && git diff --check": 1,
        'powershell -Command "Write-Host hi"': 1,
        "pwsh -c Get-Date": 1,
      },
      nextDevelopmentCandidateVerificationDuplicateCommands: [],
      nextDevelopmentCandidateVerificationScriptCount: 0,
      nextDevelopmentCandidateVerificationScriptRefs: [],
      nextDevelopmentCandidateVerificationResolvedScriptCount: 0,
      nextDevelopmentCandidateVerificationResolvedScriptRefs: [],
      nextDevelopmentCandidateVerificationTargetPathCount: 0,
      nextDevelopmentCandidateVerificationTargetPaths: [],
      nextDevelopmentCandidateVerificationEntryPointsValid: false,
      nextDevelopmentCandidateVerificationMissingScripts: [],
      nextDevelopmentCandidateVerificationMissingTargetPaths: [],
      nextDevelopmentCandidateVerificationUnsupportedCommands: [
        'node --eval "console.log(1)"',
        'powershell -Command "Write-Host hi"',
        "npx vitest run && git diff --check",
        "pwsh -c Get-Date",
      ],
    });
  });

  it("fails closed on mutating git verification commands", () => {
    const summary = summarizeVerificationEntryPointEvidence(
      ["git status --short", "git push origin main"],
      {
        scripts: {
          "scratchnode:launch:goal": "node scripts/scratchnode/runLaunchGoalLoop.mjs",
        },
      },
    );

    expect(summary).toEqual({
      nextDevelopmentCandidateHasSuggestedVerification: true,
      nextDevelopmentCandidateVerificationCommandCount: 2,
      nextDevelopmentCandidateVerificationCommandOccurrenceCounts: {
        "git push origin main": 1,
        "git status --short": 1,
      },
      nextDevelopmentCandidateVerificationDuplicateCommands: [],
      nextDevelopmentCandidateVerificationScriptCount: 0,
      nextDevelopmentCandidateVerificationScriptRefs: [],
      nextDevelopmentCandidateVerificationResolvedScriptCount: 0,
      nextDevelopmentCandidateVerificationResolvedScriptRefs: [],
      nextDevelopmentCandidateVerificationTargetPathCount: 0,
      nextDevelopmentCandidateVerificationTargetPaths: [],
      nextDevelopmentCandidateVerificationEntryPointsValid: false,
      nextDevelopmentCandidateVerificationMissingScripts: [],
      nextDevelopmentCandidateVerificationMissingTargetPaths: [],
      nextDevelopmentCandidateVerificationUnsupportedCommands: ["git push origin main"],
    });
  });

  it("fails closed when a development candidate has no verification commands", () => {
    const summary = summarizeVerificationEntryPointEvidence([], {
      scripts: {
        "scratchnode:launch:goal": "node scripts/scratchnode/runLaunchGoalLoop.mjs",
      },
    });

    expect(summary).toEqual({
      nextDevelopmentCandidateHasSuggestedVerification: false,
      nextDevelopmentCandidateVerificationCommandCount: 0,
      nextDevelopmentCandidateVerificationCommandOccurrenceCounts: {},
      nextDevelopmentCandidateVerificationDuplicateCommands: [],
      nextDevelopmentCandidateVerificationScriptCount: 0,
      nextDevelopmentCandidateVerificationScriptRefs: [],
      nextDevelopmentCandidateVerificationResolvedScriptCount: 0,
      nextDevelopmentCandidateVerificationResolvedScriptRefs: [],
      nextDevelopmentCandidateVerificationTargetPathCount: 0,
      nextDevelopmentCandidateVerificationTargetPaths: [],
      nextDevelopmentCandidateVerificationEntryPointsValid: false,
      nextDevelopmentCandidateVerificationMissingScripts: [],
      nextDevelopmentCandidateVerificationMissingTargetPaths: [],
      nextDevelopmentCandidateVerificationUnsupportedCommands: [],
    });
  });

  it("resolves nested npm-run verification scripts and their file targets", () => {
    const summary = summarizeVerificationEntryPointEvidence(["npm run repo:housekeeping:check"], {
      scripts: {
        "repo:housekeeping:check":
          "npm run repo:augment:check && npm run repo:housekeeping:verify && git diff --cached --check",
        "repo:augment:check": "powershell -File scripts/repo/checkAugmentUploadScope.ps1",
        "repo:housekeeping:verify": "powershell -File scripts/repo/verifyWorkspaceHousekeeping.ps1",
      },
    });

    expect(summary).toEqual({
      nextDevelopmentCandidateHasSuggestedVerification: true,
      nextDevelopmentCandidateVerificationCommandCount: 1,
      nextDevelopmentCandidateVerificationCommandOccurrenceCounts: {
        "npm run repo:housekeeping:check": 1,
      },
      nextDevelopmentCandidateVerificationDuplicateCommands: [],
      nextDevelopmentCandidateVerificationScriptCount: 1,
      nextDevelopmentCandidateVerificationScriptRefs: ["repo:housekeeping:check"],
      nextDevelopmentCandidateVerificationResolvedScriptCount: 3,
      nextDevelopmentCandidateVerificationResolvedScriptRefs: [
        "repo:housekeeping:check",
        "repo:augment:check",
        "repo:housekeeping:verify",
      ],
      nextDevelopmentCandidateVerificationTargetPathCount: 2,
      nextDevelopmentCandidateVerificationTargetPaths: [
        "scripts/repo/checkAugmentUploadScope.ps1",
        "scripts/repo/verifyWorkspaceHousekeeping.ps1",
      ],
      nextDevelopmentCandidateVerificationEntryPointsValid: true,
      nextDevelopmentCandidateVerificationMissingScripts: [],
      nextDevelopmentCandidateVerificationMissingTargetPaths: [],
      nextDevelopmentCandidateVerificationUnsupportedCommands: [],
    });
  });

  it("fails closed when a nested npm-run verifier is missing", () => {
    const summary = summarizeVerificationEntryPointEvidence(["npm run repo:housekeeping:check"], {
      scripts: {
        "repo:housekeeping:check": "npm run repo:augment:check && npm run repo:housekeeping:verify",
        "repo:augment:check": "powershell -File scripts/repo/checkAugmentUploadScope.ps1",
      },
    });

    expect(summary).toEqual({
      nextDevelopmentCandidateHasSuggestedVerification: true,
      nextDevelopmentCandidateVerificationCommandCount: 1,
      nextDevelopmentCandidateVerificationCommandOccurrenceCounts: {
        "npm run repo:housekeeping:check": 1,
      },
      nextDevelopmentCandidateVerificationDuplicateCommands: [],
      nextDevelopmentCandidateVerificationScriptCount: 1,
      nextDevelopmentCandidateVerificationScriptRefs: ["repo:housekeeping:check"],
      nextDevelopmentCandidateVerificationResolvedScriptCount: 3,
      nextDevelopmentCandidateVerificationResolvedScriptRefs: [
        "repo:housekeeping:check",
        "repo:augment:check",
        "repo:housekeeping:verify",
      ],
      nextDevelopmentCandidateVerificationTargetPathCount: 1,
      nextDevelopmentCandidateVerificationTargetPaths: ["scripts/repo/checkAugmentUploadScope.ps1"],
      nextDevelopmentCandidateVerificationEntryPointsValid: false,
      nextDevelopmentCandidateVerificationMissingScripts: ["repo:housekeeping:verify"],
      nextDevelopmentCandidateVerificationMissingTargetPaths: [],
      nextDevelopmentCandidateVerificationUnsupportedCommands: [],
    });
  });

  it("fails closed when suggested verification repeats the same command", () => {
    const summary = summarizeVerificationEntryPointEvidence(
      ["npm run scratchnode:launch:goal", "npm run scratchnode:launch:goal", "git diff --check"],
      {
        scripts: {
          "scratchnode:launch:goal": "node scripts/scratchnode/runLaunchGoalLoop.mjs",
        },
      },
    );

    expect(summary).toEqual({
      nextDevelopmentCandidateHasSuggestedVerification: true,
      nextDevelopmentCandidateVerificationCommandCount: 3,
      nextDevelopmentCandidateVerificationCommandOccurrenceCounts: {
        "git diff --check": 1,
        "npm run scratchnode:launch:goal": 2,
      },
      nextDevelopmentCandidateVerificationDuplicateCommands: ["npm run scratchnode:launch:goal"],
      nextDevelopmentCandidateVerificationScriptCount: 2,
      nextDevelopmentCandidateVerificationScriptRefs: ["scratchnode:launch:goal"],
      nextDevelopmentCandidateVerificationResolvedScriptCount: 1,
      nextDevelopmentCandidateVerificationResolvedScriptRefs: ["scratchnode:launch:goal"],
      nextDevelopmentCandidateVerificationTargetPathCount: 1,
      nextDevelopmentCandidateVerificationTargetPaths: ["scripts/scratchnode/runLaunchGoalLoop.mjs"],
      nextDevelopmentCandidateVerificationEntryPointsValid: false,
      nextDevelopmentCandidateVerificationMissingScripts: [],
      nextDevelopmentCandidateVerificationMissingTargetPaths: [],
      nextDevelopmentCandidateVerificationUnsupportedCommands: [],
    });
  });
});

describe("summarizeDevelopmentCandidateSourcePathEvidence", () => {
  it("resolves an existing candidate source path inside the repo", () => {
    const summary = summarizeDevelopmentCandidateSourcePathEvidence({
      sourcePath: "scripts/scratchnode/runLaunchGoalLoop.mjs",
    });

    expect(summary.nextDevelopmentCandidateHasSourcePath).toBe(true);
    expect(summary.nextDevelopmentCandidateSourcePathExists).toBe(true);
    expect(summary.nextDevelopmentCandidateSourcePathResolved).toMatch(/scripts[\\/]+scratchnode[\\/]+runLaunchGoalLoop\.mjs$/);
  });

  it("fails closed when the candidate source path is missing", () => {
    expect(
      summarizeDevelopmentCandidateSourcePathEvidence({
        sourcePath: "scripts/scratchnode/does-not-exist.mjs",
      }),
    ).toEqual({
      nextDevelopmentCandidateHasSourcePath: true,
      nextDevelopmentCandidateSourcePathExists: false,
      nextDevelopmentCandidateSourcePathResolved: expect.stringMatching(
        /scripts[\\/]+scratchnode[\\/]+does-not-exist\.mjs$/,
      ),
    });
  });

  it("fails closed when the candidate does not declare a source path", () => {
    expect(summarizeDevelopmentCandidateSourcePathEvidence({})).toEqual({
      nextDevelopmentCandidateHasSourcePath: false,
      nextDevelopmentCandidateSourcePathExists: true,
      nextDevelopmentCandidateSourcePathResolved: null,
    });
  });
});

describe("summarizeGoalQueueEvidence", () => {
  it("summarizes goal queue count, statuses, modes, priorities, and open eligible ids", () => {
    const summary = summarizeGoalQueueEvidence([
      { id: "goal-1", status: "queued", mode: "human-gated", priority: "P1" },
      { id: "goal-2", status: "proposed", mode: "safe-local-development", priority: "P2" },
      { id: "goal-3", status: "done after local verification", mode: "human-gated", priority: "P1" },
      { id: "goal-4", status: "shipping", mode: "human-gated", priority: "P2" },
      { id: "goal-5", status: "shipped", mode: "human-gated", priority: "P2" },
      { id: "goal-6" },
    ]);

    expect(summary).toEqual({
      goalQueueCount: 6,
      goalQueueStatusCounts: {
        done: 1,
        proposed: 1,
        queued: 1,
        shipped: 1,
        shipping: 1,
        unknown: 1,
      },
      goalQueueModeCounts: {
        "human-gated": 4,
        "safe-local-development": 1,
        unknown: 1,
      },
      goalQueuePriorityCounts: {
        P1: 2,
        P2: 3,
        unknown: 1,
      },
      openGoalQueueCount: 2,
      openGoalQueueIds: ["goal-1", "goal-2"],
      proposedGoalQueueIds: ["goal-2"],
      queuedGoalQueueIds: ["goal-1"],
      shippingGoalQueueIds: ["goal-4"],
      shippedGoalQueueIds: ["goal-5"],
      doneGoalQueueIds: ["goal-3"],
      safeLocalGoalCount: 1,
      safeLocalGoalIds: ["goal-2"],
      humanGatedGoalCount: 1,
      humanGatedGoalIds: ["goal-1"],
    });
  });
});

describe("goalLoopEvidenceFieldNames", () => {
  it("keeps the launch-scan evidence contract centralized", () => {
    expect(goalLoopEvidenceFieldNames).toContain("nextDevelopmentCandidate");
    expect(goalLoopEvidenceFieldNames).toContain("nextDevelopmentCandidateActionabilityReason");
    expect(goalLoopEvidenceFieldNames).toContain("nextDevelopmentCandidateHasSourcePath");
    expect(goalLoopEvidenceFieldNames).toContain("nextDevelopmentCandidateSourcePathExists");
    expect(goalLoopEvidenceFieldNames).toContain("nextDevelopmentCandidateVerificationCommandOccurrenceCounts");
    expect(goalLoopEvidenceFieldNames).toContain("nextDevelopmentCandidateVerificationDuplicateCommands");
    expect(goalLoopEvidenceFieldNames).toContain("nextDevelopmentCandidateVerificationResolvedScriptRefs");
    expect(goalLoopEvidenceFieldNames).toContain("nextDevelopmentCandidateVerificationTargetPaths");
    expect(goalLoopEvidenceFieldNames).toContain("nextDevelopmentCandidateVerificationMissingTargetPaths");
    expect(goalLoopEvidenceFieldNames).toContain("commandOccurrenceCounts");
    expect(goalLoopEvidenceFieldNames).toContain("duplicateCommandNames");
    expect(goalLoopEvidenceFieldNames).toContain("commandExitCodes");
    expect(goalLoopEvidenceFieldNames).toContain("commandExitCodeHistory");
    expect(goalLoopEvidenceFieldNames).toContain("knownCautionDirtyPaths");
    expect(goalLoopEvidenceFieldNames).toContain("knownCautionLockedPaths");
    expect(goalLoopEvidenceFieldNames).toContain("knownCautionMissingPaths");
    expect(goalLoopEvidenceFieldNames).toContain("knownCautionGitInaccessiblePaths");
    expect(goalLoopEvidenceFieldNames).toContain("previousGoalLoopHeadShortSha");
    expect(goalLoopEvidenceFieldNames).toContain("previousGoalLoopHeadChanged");
    expect(goalLoopEvidenceFieldNames).toContain("previousGoalLoopRepeatedFailureNames");
    expect(goalLoopEvidenceFieldNames).toContain("previousGoalLoopSameCandidate");
  });
});

describe("summarizeWorkflowModelEvidence", () => {
  it("summarizes workflow cadence and safety model details", () => {
    const summary = summarizeWorkflowModelEvidence({
      issueQueue: "Batch findings into one focused development candidate.",
      specialistPasses: ["housekeeping", "privacy", "", null],
      developmentCadence: "Fix red gates first; otherwise ship one safe-local slice.",
      repeatedFailureRule: "Change strategy after three repeated failures.",
      safetyBoundary: "Local source edits only; no deploys.",
    });

    expect(summary).toEqual({
      workflowIssueQueueModel: "Batch findings into one focused development candidate.",
      workflowSpecialistPassCount: 2,
      workflowSpecialistPasses: ["housekeeping", "privacy"],
      workflowDevelopmentCadence: "Fix red gates first; otherwise ship one safe-local slice.",
      workflowRepeatedFailureRule: "Change strategy after three repeated failures.",
      workflowSafetyBoundary: "Local source edits only; no deploys.",
    });
  });
});

describe("summarizePreviousGoalLoopEvidence", () => {
  it("summarizes prior report failures and repeated candidate context", () => {
    const summary = summarizePreviousGoalLoopEvidence(
      {
        generatedAt: "2026-06-05T15:00:00.000Z",
        summary: {
          passed: false,
          notifyRecommended: true,
          failures: ["git drift is clean after the loop", "no actionable attention items remain"],
          nextDevelopmentCandidate: "attention-1",
          gitHeadShortSha: "abc12345",
        },
      },
      {
        currentFailures: ["git drift is clean after the loop"],
        currentCandidateId: "attention-1",
        currentCandidateMode: "fix-first",
        currentHeadShortSha: "def67890",
      },
    );

    expect(summary).toEqual({
      previousGoalLoopReportLoaded: true,
      previousGoalLoopGeneratedAt: "2026-06-05T15:00:00.000Z",
      previousGoalLoopPassed: false,
      previousGoalLoopNotifyRecommended: true,
      previousGoalLoopFailureCount: 2,
      previousGoalLoopFailureNames: ["git drift is clean after the loop", "no actionable attention items remain"],
      previousGoalLoopNextDevelopmentCandidate: "attention-1",
      previousGoalLoopHeadShortSha: "abc12345",
      previousGoalLoopHeadChanged: true,
      previousGoalLoopRepeatedFailureCount: 1,
      previousGoalLoopRepeatedFailureNames: ["git drift is clean after the loop"],
      previousGoalLoopSameCandidate: true,
      previousGoalLoopSameCandidateMode: "fix-first",
    });
  });

  it("returns stable empty evidence when no prior report exists", () => {
    expect(summarizePreviousGoalLoopEvidence(null)).toEqual({
      previousGoalLoopReportLoaded: false,
      previousGoalLoopGeneratedAt: null,
      previousGoalLoopPassed: false,
      previousGoalLoopNotifyRecommended: false,
      previousGoalLoopFailureCount: 0,
      previousGoalLoopFailureNames: [],
      previousGoalLoopNextDevelopmentCandidate: null,
      previousGoalLoopHeadShortSha: null,
      previousGoalLoopHeadChanged: false,
      previousGoalLoopRepeatedFailureCount: 0,
      previousGoalLoopRepeatedFailureNames: [],
      previousGoalLoopSameCandidate: false,
      previousGoalLoopSameCandidateMode: null,
    });
  });
});

describe("summarizeNotificationEvidence", () => {
  it("recommends notification when failures are present", () => {
    expect(summarizeNotificationEvidence([{ name: "git drift", ok: false }])).toEqual({
      notifyRecommended: true,
      notifyRecommendationReason: "Launch goal failures (1): git drift",
    });
  });

  it("recommends notification on a clean pass when HEAD changed since the previous report", () => {
    expect(
      summarizeNotificationEvidence(
        [{ name: "git drift", ok: true }],
        {
          previousHeadShortSha: "abc12345",
          currentHeadShortSha: "def67890",
          currentHeadChanged: true,
        },
      ),
    ).toEqual({
      notifyRecommended: true,
      notifyRecommendationReason:
        "Goal loop passed and HEAD changed since the previous report (abc12345 -> def67890); report the verified local slice.",
    });
  });

  it("stays quiet on a clean pass when HEAD is unchanged", () => {
    expect(
      summarizeNotificationEvidence(
        [{ name: "git drift", ok: true }],
        {
          previousHeadShortSha: "abc12345",
          currentHeadShortSha: "abc12345",
          currentHeadChanged: false,
        },
      ),
    ).toEqual({
      notifyRecommended: false,
      notifyRecommendationReason: "All launch goal criteria passed; no notification needed.",
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
