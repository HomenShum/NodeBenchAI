#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const shouldPrintJson = args.has("--json");
const outPath = resolve(repoRoot, ".tmp/scratchnode-launch-goal-loop.json");
const reportSchemaVersion = "scratchnode-launch-goal-loop/v1";
const defaultCommandTimeoutMs = Math.max(
  1_000,
  Number.parseInt(process.env.SCRATCHNODE_GOAL_COMMAND_TIMEOUT_MS ?? "", 10) || 240_000,
);

const reportPaths = {
  housekeeping: ".tmp/workspace-housekeeping-verification.json",
  launch: ".tmp/scratchnode-launch-scan.json",
  augment: ".tmp/augment-upload-scope.json",
  housekeepingLoop: ".tmp/workspace-housekeeping-loop.json",
  localHistory: ".tmp/local-history-map-reduce.json",
  goalLoop: ".tmp/scratchnode-launch-goal-loop.json",
};

export const goalLoopEvidenceFieldNames = [
  "schemaVersion",
  "reportSchemaVersion",
  "reportGeneratedAt",
  "reportPath",
  "goalId",
  "goalSourceRefCount",
  "goalSourceRefs",
  "gitBranchStatus",
  "gitBranchName",
  "gitUpstreamName",
  "gitAheadCount",
  "gitBehindCount",
  "gitDetachedHead",
  "gitDetachedHeadDetail",
  "gitBranchBehindUpstream",
  "gitBranchSyncDetail",
  "gitHeadSummary",
  "gitHeadShortSha",
  "gitHeadSubject",
  "notifyRecommendationReason",
  "criterionCount",
  "passedCriterionCount",
  "passedCriterionNames",
  "failedCriterionCount",
  "failedCriterionDetails",
  "requiredReportCount",
  "requiredReportNames",
  "requiredReportLoadedCount",
  "requiredReportMissingNames",
  "requiredReportParseErrors",
  "requiredReportLoadFailures",
  "requiredReportStructureCount",
  "requiredReportStructureReadyCount",
  "requiredReportStructureNames",
  "requiredReportStructureFailures",
  "developmentBacklogCount",
  "developmentBacklogModeCounts",
  "developmentBacklogPriorityCounts",
  "developmentBacklogIds",
  "goalQueueCount",
  "goalQueueStatusCounts",
  "goalQueueModeCounts",
  "goalQueuePriorityCounts",
  "knownCautionPaths",
  "knownCautionPathReasons",
  "invalidRegisteredWorktreePaths",
  "explicitPruneCautionWorktreePaths",
  "explicitPruneCautionWorktreePathReasons",
  "knownCautionSuppressesHousekeepingNotify",
  "knownCautionSuppressedAttentionCount",
  "knownCautionSuppressedAttentionItems",
  "proposedGoalQueueIds",
  "queuedGoalQueueIds",
  "shippingGoalQueueIds",
  "shippedGoalQueueIds",
  "doneGoalQueueIds",
  "openGoalQueueCount",
  "openGoalQueueIds",
  "commandCount",
  "commandSuccessCount",
  "commandFailureCount",
  "commandNames",
  "commandExitCodes",
  "commandDurationMsByName",
  "commandDurationTotalMs",
  "commandTimeoutMs",
  "timedOutCommandCount",
  "timedOutCommandNames",
  "slowCommandWarningThresholdMs",
  "slowCommandCount",
  "slowCommandNames",
  "slowCommandSummaries",
  "failedCommandSummaries",
  "slowestCommand",
  "sourceReportCount",
  "sourceReportPaths",
  "sourceReportFreshCount",
  "sourceReportRepoMatchCount",
  "sourceReportRepoMismatchPaths",
  "sourceReportAgeSecondsByPath",
  "sourceReportMaxAgeSeconds",
  "sourceReportFreshnessThresholdSeconds",
  "sourceReportFutureSkewThresholdSeconds",
  "staleSourceReportCount",
  "housekeepingPassed",
  "housekeepingOperatorStatus",
  "housekeepingOperatorMessage",
  "housekeepingNotifyRecommended",
  "housekeepingFailureCount",
  "housekeepingFailures",
  "housekeepingWarningCount",
  "housekeepingWarnings",
  "augmentReportPassed",
  "augmentCandidateFileCount",
  "augmentThreshold",
  "housekeepingCriticalIgnoreProbesPassed",
  "housekeepingUntrackedIncludedCount",
  "safeLocalHistoryCleanupCount",
  "cautionWorktreeCount",
  "keptWorktreeCount",
  "protectedPathsClean",
  "protectedPathCount",
  "dirtyProtectedPathCount",
  "removedSafePathCount",
  "prunedWorktreeCount",
  "invalidRegisteredWorktreeCount",
  "housekeepingStagedDiffCheckPassed",
  "housekeepingOnlyDrift",
  "housekeepingDriftStagedCount",
  "housekeepingDriftUnstagedCount",
  "housekeepingDriftUntrackedCount",
  "housekeepingDriftHousekeepingOnly",
  "housekeepingNonHousekeepingDriftPaths",
  "launchPassed",
  "launchStaticPassed",
  "launchLivePassed",
  "launchInteractivePassed",
  "launchStaticCheckCount",
  "launchLiveCheckCount",
  "launchInteractiveCheckCount",
  "launchRequiredStaticFailureCount",
  "launchBlockerCount",
  "launchWarningCount",
  "launchLiveFailureCount",
  "launchInteractiveFailureCount",
  "launchRemoteProbeNetworkAccessDenied",
  "launchStaticCheckNames",
  "launchLiveCheckNames",
  "launchInteractiveCheckNames",
  "launchFailedCheckNames",
  "launchFailedCheckDetails",
  "launchRawFailedCheckCount",
  "launchRawFailedCheckNames",
  "launchRawFailedCheckDetails",
  "launchSuppressedRemoteProbeFailureCount",
  "launchSuppressedRemoteProbeFailureNames",
  "tmpIgnoreProbePassed",
  "tmpIgnoreProbeExpectedCount",
  "tmpIgnoreProbeCount",
  "tmpIgnoreProbeMissingPaths",
  "tmpIgnoredReportPaths",
  "tmpIgnoreRuleSources",
  "nextDevelopmentCandidate",
  "developmentCandidate",
  "safeLocalGoalCount",
  "safeLocalGoalIds",
  "humanGatedGoalCount",
  "humanGatedGoalIds",
  "workflowIssueQueueModel",
  "workflowSpecialistPassCount",
  "workflowSpecialistPasses",
  "workflowDevelopmentCadence",
  "workflowRepeatedFailureRule",
  "workflowSafetyBoundary",
  "gitStatus",
  "gitStatusEntryCount",
  "nextDevelopmentCandidateTitle",
  "nextDevelopmentCandidateMode",
  "nextDevelopmentCandidatePriority",
  "nextDevelopmentCandidateSurface",
  "nextDevelopmentCandidateArea",
  "nextDevelopmentCandidateSourcePath",
  "nextDevelopmentCandidateSuggestedVerification",
  "nextDevelopmentCandidateHasSuggestedVerification",
  "nextDevelopmentCandidateVerificationCommandCount",
  "nextDevelopmentCandidateVerificationScriptCount",
  "nextDevelopmentCandidateVerificationScriptRefs",
  "nextDevelopmentCandidateVerificationEntryPointsValid",
  "nextDevelopmentCandidateVerificationMissingScripts",
  "nextDevelopmentCandidateVerificationUnsupportedCommands",
  "nextDevelopmentCandidateWhy",
  "nextDevelopmentCandidateMaxSlice",
  "nextDevelopmentCandidateSelectionType",
  "nextDevelopmentCandidateEligibleSafeLocalGoalCount",
  "nextDevelopmentCandidateOpenGoalQueueCount",
  "nextDevelopmentCandidateReason",
  "nextDevelopmentCandidateActionability",
  "nextDevelopmentCandidateActionRequired",
  "nextDevelopmentCandidateQuietPassEligible",
  "nextDevelopmentCandidateActionabilityReason",
];

function tail(text, maxLength = 16_000) {
  if (text.length <= maxLength) return text;
  return `...[truncated ${text.length - maxLength} chars]\n${text.slice(-maxLength)}`;
}

function readJson(relativePath) {
  const absolutePath = resolve(repoRoot, relativePath);
  if (!existsSync(absolutePath)) return null;
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    return { parseError: error instanceof Error ? error.message : String(error) };
  }
}

function run(command, commandArgs, options = {}) {
  const started = performance.now();
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || defaultCommandTimeoutMs);
  return new Promise((resolveRun) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      env: process.env,
      shell: process.platform === "win32",
      windowsHide: true,
      ...Object.fromEntries(Object.entries(options).filter(([key]) => key !== "timeoutMs")),
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolveRun(result);
    };
    const timeoutId = setTimeout(() => {
      timedOut = true;
      stderr = tail(`${stderr}\nTimed out after ${timeoutMs}ms`.trim());
      child.kill();
      const hardKillTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 5_000);
      if (typeof hardKillTimer.unref === "function") hardKillTimer.unref();
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish({
        command: [command, ...commandArgs].join(" "),
        exitCode: 1,
        durationMs: Math.round(performance.now() - started),
        stdout: tail(stdout),
        stderr: tail(`${stderr}\n${error.message}`.trim()),
        timedOut,
        timeoutMs,
      });
    });
    child.on("close", (exitCode, signal) => {
      finish({
        command: [command, ...commandArgs].join(" "),
        exitCode: timedOut ? 124 : exitCode ?? 1,
        durationMs: Math.round(performance.now() - started),
        stdout: tail(stdout),
        stderr: tail(stderr),
        timedOut,
        timeoutMs,
        signal: signal ?? null,
      });
    });
  });
}

function buildCriterion(name, ok, detail = "") {
  return { name, ok: !!ok, detail };
}

export function knownCautionEntries(housekeepingReport, localHistoryReport = null) {
  const entries = (housekeepingReport?.cautionEntries ?? []).filter((entry) =>
    /clean registered worktree; explicit prune only/i.test(entry.reason ?? ""),
  );
  const invalidKeepEntries = Array.isArray(localHistoryReport?.buckets?.keep)
    ? localHistoryReport.buckets.keep.filter((entry) =>
        /invalid registered worktree/i.test(entry.reason ?? ""),
      )
    : [];
  for (const entry of invalidKeepEntries) {
    entries.push({
      path: entry.path ?? entry.absolutePath ?? "git worktree metadata",
      reason: entry.reason ?? "invalid registered worktree",
      branch: entry.branch ?? null,
      dirty: entry.dirty ?? null,
      locked: entry.locked ?? null,
      exists: entry.exists ?? null,
      gitUsable: entry.gitUsable ?? null,
    });
  }
  const invalidRegistered = Number(housekeepingReport?.summary?.invalidRegistered ?? 0);
  if (invalidRegistered > invalidKeepEntries.length) {
    entries.push({
      path: "git worktree metadata",
      reason: `invalid registered worktrees present: ${invalidRegistered}; explicit keep-entry details unavailable from local-history map/reduce`,
    });
  }
  return entries;
}

function actionableAttentionItems(housekeepingReport) {
  const attentionItems = housekeepingReport?.operatorSummary?.attentionItems ?? [];
  const knownCleanWorktreeCautionCount = (housekeepingReport?.cautionEntries ?? []).filter((entry) =>
    /clean registered worktree; explicit prune only/i.test(entry.reason ?? ""),
  ).length;
  const invalidRegistered = Number(housekeepingReport?.summary?.invalidRegistered ?? 0);
  return attentionItems.filter((item) => {
    const cautionMatch = item.match(/^caution worktrees present: (\d+)$/i);
    if (cautionMatch) return Number(cautionMatch[1]) !== knownCleanWorktreeCautionCount;
    const invalidMatch = item.match(/^invalid registered worktrees present: (\d+)$/i);
    if (invalidMatch) return Number(invalidMatch[1]) !== invalidRegistered;
    return true;
  });
}

function formatLaunchSummaryDetail(launchReport) {
  const summary = launchReport?.summary;
  if (!summary) return "missing launch report";
  const detail = [
    `blockers=${summary.blockers}`,
    `warnings=${summary.warnings}`,
    `liveFailures=${summary.liveFailures}`,
    `interactiveFailures=${summary.interactiveFailures}`,
  ];
  if (summary.remoteProbeInfra?.networkAccessDenied) {
    detail.push(`remoteProbeInfra=${summary.remoteProbeInfra.reason}`);
  }
  return detail.join(", ");
}

function walkMarkdownFiles(relativeDir) {
  const root = resolve(repoRoot, relativeDir);
  if (!existsSync(root)) return [];
  const files = [];
  const walk = (absoluteDir) => {
    for (const item of readdirSync(absoluteDir)) {
      const absolutePath = resolve(absoluteDir, item);
      const stat = statSync(absolutePath);
      if (stat.isDirectory()) {
        walk(absolutePath);
      } else if (/\.md$/i.test(item)) {
        files.push(absolutePath);
      }
    }
  };
  walk(root);
  return files.sort();
}

export function classifyGoalCardMode(text) {
  const autoSafeLine = text.match(/^- \*\*auto-safe:\*\*\s*([^\r\n]+)/im)?.[1]?.trim() ?? "";
  const isHardGate = /HARD GATE|approval REQUIRED|human approves the merge|founder approval REQUIRED/i.test(text);
  const isTestsOnly = /tests-only/i.test(autoSafeLine) || /tests-only/i.test(text);

  if (isHardGate && isTestsOnly) {
    return {
      mode: "human-gated",
      eligibilityReason: "Auto-safe guidance is present, but hard-gate approval language still requires human review.",
    };
  }

  if (isHardGate) {
    return {
      mode: "human-gated",
      eligibilityReason: "Hard-gate approval language requires a human-reviewed slice.",
    };
  }

  if (isTestsOnly) {
    return {
      mode: "safe-local-development",
      eligibilityReason: "Explicit auto-safe/tests-only guidance allows a narrow local slice.",
    };
  }

  return {
    mode: "human-gated",
    eligibilityReason: "No auto-safe marker found; defaulting this goal card to human-gated.",
  };
}

function parseGoalCard(absolutePath) {
  const text = readFileSync(absolutePath, "utf8").replace(/^\uFEFF/, "");
  const heading = text.match(/^#\s+Goal:\s*(.+)$/m)?.[1]?.trim() ?? text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (!heading || /README|TEMPLATE|GOVERNANCE|HARD_GATES|AGENT_LOOP/i.test(heading)) return null;
  const relativePath = absolutePath.slice(repoRoot.length + 1).replace(/\\/g, "/");
  const id = relativePath.replace(/^goals\//, "").replace(/\.md$/i, "").replace(/\//g, "-");
  const status = text.match(/^- \*\*status:\*\*\s*([^\r\n]+)/im)?.[1]?.trim().toLowerCase() ?? "queued";
  const surface = text.match(/^- \*\*surface:\*\*\s*([^\r\n]+)/im)?.[1]?.trim() ?? "unknown";
  const severity = text.match(/^- \*\*(?:severity|priority):\*\*\s*([Pp]\d)/im)?.[1]?.toUpperCase() ?? "P2";
  const { mode, eligibilityReason } = classifyGoalCardMode(text);
  return {
    id,
    title: heading,
    surface,
    priority: severity,
    status,
    mode,
    eligibilityReason,
    path: relativePath,
  };
}

function readGoalQueue() {
  return walkMarkdownFiles("goals")
    .filter((absolutePath) => {
      const relativePath = absolutePath.slice(repoRoot.length + 1).replace(/\\/g, "/");
      return /^goals\/(scratchnode|nodebench|runtime)\//.test(relativePath);
    })
    .map(parseGoalCard)
    .filter(Boolean)
    .filter((goal) => goal.status !== "done");
}

function priorityRank(priority) {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[priority] ?? 4;
}

function goalCardsToBacklog(goalCards) {
  return goalCards
    .filter((goal) => isOpenGoalStatus(goal.status) && goal.mode === "safe-local-development")
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.path.localeCompare(b.path))
    .map((goal) => ({
      id: `goal-${goal.id}`,
      surface: goal.surface,
      area: "goal queue",
      priority: goal.priority,
      mode: goal.mode,
      title: goal.title,
      why: `Queued goal card: ${goal.path}`,
      maxSlice: "Take one narrow, locally verifiable slice from this goal card; do not expand scope.",
      suggestedVerification: ["npm run scratchnode:launch:goal"],
      sourcePath: goal.path,
    }));
}

function buildDevelopmentBacklog({ actionableAttention, launchRelevantBlockers, goalCards, gitStatus, gitBranchEvidence, launchReport }) {
  const backlog = [];

  for (const blocker of launchRelevantBlockers) {
    backlog.push({
      id: `blocker-${backlog.length + 1}`,
      surface: "repo",
      area: "release blocker",
      priority: "P0",
      mode: "fix-first",
      title: blocker,
      why: "Launch-relevant blockers outrank new product work.",
      maxSlice: "Root-cause and fix only this blocker, then rerun the goal loop.",
      suggestedVerification: ["npm run scratchnode:launch:goal", "git diff --check"],
    });
  }

  for (const item of actionableAttention) {
    backlog.push({
      id: `attention-${backlog.length + 1}`,
      surface: "repo",
      area: "housekeeping",
      priority: "P1",
      mode: "fix-first",
      title: item,
      why: "Actionable workspace drift makes future autonomous development less reliable.",
      maxSlice: "Fix the smallest housekeeping cause without pruning caution worktrees.",
      suggestedVerification: ["npm run repo:housekeeping:check", "npm run scratchnode:launch:goal"],
    });
  }

  if (gitBranchEvidence?.gitDetachedHead === true) {
    backlog.push({
      id: `head-${backlog.length + 1}`,
      surface: "repo",
      area: "branch attachment",
      priority: "P1",
      mode: "human-gated",
      title: "Detached HEAD must be attached to a branch before new autonomous development",
      why: "Autonomous commits from a detached HEAD are hard to recover and do not safely advance the tracked branch.",
      maxSlice: "Attach HEAD to the intended branch in a coordinated step, then rerun the goal loop.",
      suggestedVerification: ["git status --short --branch", "npm run scratchnode:launch:goal"],
    });
  }

  if (gitStatus) {
    backlog.push({
      id: `drift-${backlog.length + 1}`,
      surface: "repo",
      area: "git drift",
      priority: "P1",
      mode: "human-gated",
      title: "Existing git drift must be classified before new autonomous development",
      why: "The loop cannot safely improve product code while unclassified changes are present.",
      maxSlice: "Inspect drift, preserve user changes, and either commit verified agent work or report non-agent drift.",
      suggestedVerification: ["git status --short", "git diff --check"],
    });
  }

  if ((gitBranchEvidence?.gitBehindCount ?? 0) > 0) {
    const behindCount = gitBranchEvidence.gitBehindCount;
    const upstreamName = gitBranchEvidence.gitUpstreamName ?? "tracked upstream";
    backlog.push({
      id: `sync-${backlog.length + 1}`,
      surface: "repo",
      area: "branch sync",
      priority: "P1",
      mode: "fix-first",
      title: `Local branch is behind ${upstreamName} by ${behindCount} commit${behindCount === 1 ? "" : "s"}`,
      why: "Autonomous development should not continue from a stale tracked branch because the next slice may target outdated code.",
      maxSlice: "Inspect upstream drift, rebase or merge in a coordinated human-reviewed step, then rerun the goal loop.",
      suggestedVerification: ["git status --short --branch", "npm run scratchnode:launch:goal"],
    });
  }

  if (backlog.length > 0) return backlog;

  const queuedGoalBacklog = goalCardsToBacklog(goalCards);
  if (queuedGoalBacklog.length > 0) return queuedGoalBacklog;

  return [
    {
      id: "dev-goal-loop-instrumentation",
      surface: "automation",
      area: "self-improvement loop",
      priority: "P1",
      mode: "safe-local-development",
      title: "Improve loop instrumentation and evidence quality",
      why: "The loop should keep proving its own entrypoints, report freshness, and candidate ranking against the repo as it exists now.",
      maxSlice: "Restore or tighten one detector, script entrypoint, or report field that makes future autonomous work safer.",
      suggestedVerification: ["npm run scratchnode:launch:goal", "npm run repo:augment:check", "git diff --check"],
      sourcePath: launchReport?.summary?.passed ? "automation" : "automation-blocker",
    },
  ];
}

export function selectDevelopmentCandidate(developmentBacklog, context = {}) {
  const candidate = developmentBacklog[0] ?? null;
  if (!candidate) return null;

  const launchRelevantBlockerCount = context.launchRelevantBlockers?.length ?? 0;
  const actionableAttentionCount = context.actionableAttention?.length ?? 0;
  const openGoalQueueCount = context.goalQueue?.filter((goal) => isOpenGoalStatus(goal.status)).length ?? 0;
  const safeLocalGoalCount = context.goalQueue?.filter(
    (goal) => isOpenGoalStatus(goal.status) && goal.mode === "safe-local-development",
  ).length ?? 0;

  let selectionReason = "Selected the first ranked backlog item.";
  let selectionType = "backlog-default";
  let actionability = "safe-local-slice";
  let actionabilityReason = "Selected backlog item should be implemented as one locally verified slice.";
  if (candidate.id.startsWith("blocker-")) {
    selectionType = "launch-blocker";
    selectionReason = `Launch blockers present (${launchRelevantBlockerCount}); fix-first work outranks new development slices.`;
    actionability = "local-fix-required";
    actionabilityReason = "A launch blocker is present; the next pass should fix the blocker before new development.";
  } else if (candidate.id.startsWith("attention-")) {
    selectionType = "actionable-attention";
    selectionReason = `Actionable housekeeping items present (${actionableAttentionCount}); reliability cleanup outranks new development slices.`;
    actionability = "local-fix-required";
    actionabilityReason = "Actionable housekeeping attention is present; the next pass should clear that local reliability issue.";
  } else if (candidate.id.startsWith("drift-")) {
    selectionType = "git-drift";
    selectionReason = "Git drift is present; classify existing changes before starting a new autonomous slice.";
    actionability = "local-fix-required";
    actionabilityReason = "Git drift is present; classify or resolve it before starting new work.";
  } else if (candidate.id.startsWith("head-")) {
    selectionType = "detached-head";
    selectionReason = "HEAD is detached; attach to a branch before starting a new autonomous slice.";
    actionability = "human-coordinated-branch-attach";
    actionabilityReason = "Detached HEAD is present; attach to the intended branch before local slices continue.";
  } else if (candidate.id.startsWith("sync-")) {
    selectionType = "tracked-upstream-sync";
    selectionReason = "Tracked upstream is ahead of the local branch; sync before starting a new autonomous slice.";
    actionability = "human-coordinated-sync";
    actionabilityReason = "The tracked branch is behind upstream; sync requires a coordinated branch update before local slices continue.";
  } else if (candidate.id.startsWith("goal-")) {
    selectionType = "safe-local-goal";
    selectionReason = `Selected the highest-priority safe-local goal card from the queue (${safeLocalGoalCount} eligible).`;
    actionability = "safe-local-slice";
    actionabilityReason = "A safe-local goal card is eligible; implement one narrow verified slice.";
  } else if (candidate.id === "dev-goal-loop-instrumentation") {
    selectionType = "automation-fallback";
    selectionReason = "All gates are green and no safe-local goal cards are eligible, so the loop defaults to automation instrumentation.";
    actionability = "opportunistic-automation";
    actionabilityReason =
      "Only the automation fallback is available; commit a slice only when a bounded instrumentation gap is found.";
  }

  const quietPassEligible =
    selectionType === "automation-fallback" &&
    safeLocalGoalCount === 0 &&
    actionableAttentionCount === 0 &&
    launchRelevantBlockerCount === 0;

  return {
    id: candidate.id,
    title: candidate.title,
    mode: candidate.mode,
    surface: candidate.surface,
    area: candidate.area,
    priority: candidate.priority,
    sourcePath: candidate.sourcePath ?? null,
    suggestedVerification: candidate.suggestedVerification ?? [],
    why: candidate.why,
    maxSlice: candidate.maxSlice,
    selectionType,
    eligibleSafeLocalGoalCount: safeLocalGoalCount,
    openGoalQueueCount,
    selectionReason,
    actionability,
    actionRequired: !quietPassEligible,
    quietPassEligible,
    actionabilityReason,
  };
}

export function summarizeCommandEvidence(commands, options = {}) {
  const slowCommandWarningThresholdMs = Math.max(
    0,
    Number(options.slowCommandWarningThresholdMs) || 90_000,
  );
  const commandTimeoutMs = Math.max(
    1_000,
    Number(options.commandTimeoutMs) || defaultCommandTimeoutMs,
  );
  const commandDurations = commands.map((command) => ({
    command: command.command,
    exitCode: command.exitCode,
    durationMs: Math.max(0, Number(command.durationMs) || 0),
    stdout: String(command.stdout ?? ""),
    stderr: String(command.stderr ?? ""),
    timedOut: command.timedOut === true,
    timeoutMs: Math.max(1_000, Number(command.timeoutMs) || commandTimeoutMs),
    signal: command.signal ?? null,
  }));
  const commandTimings = commandDurations.map(({ command, exitCode, durationMs }) => ({ command, exitCode, durationMs }));
  const slowestCommand = commandTimings.reduce((slowest, command) => {
    if (!slowest || command.durationMs > slowest.durationMs) return command;
    return slowest;
  }, null);
  const slowCommandSummaries = commandTimings.filter(
    (command) => command.durationMs >= slowCommandWarningThresholdMs,
  );
  const tailText = (value, maxLength = 600) => {
    const text = String(value ?? "").trim();
    return text.length > maxLength ? text.slice(-maxLength) : text;
  };

  return {
    commandCount: commands.length,
    commandSuccessCount: commandDurations.filter((command) => command.exitCode === 0).length,
    commandFailureCount: commandDurations.filter((command) => command.exitCode !== 0).length,
    commandNames: commands.map((command) => command.command),
    commandExitCodes: Object.fromEntries(commands.map((command) => [command.command, command.exitCode])),
    commandDurationMsByName: Object.fromEntries(commandTimings.map((command) => [command.command, command.durationMs])),
    commandDurationTotalMs: commandTimings.reduce((total, command) => total + command.durationMs, 0),
    commandTimeoutMs,
    timedOutCommandCount: commandDurations.filter((command) => command.timedOut).length,
    timedOutCommandNames: commandDurations.filter((command) => command.timedOut).map((command) => command.command),
    slowCommandWarningThresholdMs,
    slowCommandCount: slowCommandSummaries.length,
    slowCommandNames: slowCommandSummaries.map((command) => command.command),
    slowCommandSummaries,
    failedCommandSummaries: commandDurations
      .filter((command) => command.exitCode !== 0)
      .map((command) => ({
        command: command.command,
        exitCode: command.exitCode,
        durationMs: command.durationMs,
        timedOut: command.timedOut,
        timeoutMs: command.timeoutMs,
        signal: command.signal,
        stdoutTail: tailText(command.stdout),
        stderrTail: tailText(command.stderr),
      })),
    slowestCommand,
  };
}

export function summarizeSourceReportEvidence(housekeepingReport) {
  const sourceReports = Object.values(housekeepingReport?.sourceReports ?? {}).filter(Boolean);
  const summary = housekeepingReport?.summary ?? {};
  const sourceReportEntries = sourceReports
    .map((report) => ({
      path: report.path ?? "unknown",
      ageSeconds: evidenceNumber(report.ageSeconds),
      fresh: report.fresh === true,
      repoMatches: report.repoMatches === true,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const staleSourceReportPaths = sourceReportEntries
    .filter((report) => report.fresh === false || report.repoMatches === false)
    .map((report) => report.path)
    .sort();
  const sourceReportRepoMismatchPaths = sourceReportEntries
    .filter((report) => !report.repoMatches)
    .map((report) => report.path)
    .sort();

  return {
    sourceReportCount: sourceReports.length,
    sourceReportPaths: sourceReportEntries.map((report) => report.path),
    sourceReportFreshCount: sourceReportEntries.filter((report) => report.fresh).length,
    sourceReportRepoMatchCount: sourceReportEntries.filter((report) => report.repoMatches).length,
    sourceReportRepoMismatchPaths,
    sourceReportAgeSecondsByPath: Object.fromEntries(
      sourceReportEntries.map((report) => [report.path, report.ageSeconds]),
    ),
    sourceReportMaxAgeSeconds: sourceReportEntries.reduce(
      (maxAge, report) => (report.ageSeconds > maxAge ? report.ageSeconds : maxAge),
      0,
    ),
    sourceReportFreshnessThresholdSeconds: evidenceNumber(summary.maxSourceReportAgeSeconds),
    sourceReportFutureSkewThresholdSeconds: evidenceNumber(summary.maxFutureReportSkewSeconds),
    staleSourceReportCount: staleSourceReportPaths.length,
    staleSourceReportPaths,
  };
}

export function summarizeRequiredReportLoadEvidence(requiredReports) {
  const reportEntries = Object.entries(requiredReports ?? {})
    .map(([name, report]) => ({
      name,
      loaded: !!report && typeof report === "object" && !Array.isArray(report),
      parseError:
        report && typeof report === "object" && !Array.isArray(report) && typeof report.parseError === "string"
          ? report.parseError
          : null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const failedEntries = reportEntries.filter((entry) => !entry.loaded || entry.parseError);

  return {
    requiredReportCount: reportEntries.length,
    requiredReportNames: reportEntries.map((entry) => entry.name),
    requiredReportLoadedCount: reportEntries.filter((entry) => entry.loaded && !entry.parseError).length,
    requiredReportMissingNames: reportEntries.filter((entry) => !entry.loaded).map((entry) => entry.name),
    requiredReportParseErrors: failedEntries
      .filter((entry) => entry.parseError)
      .map((entry) => ({
        name: entry.name,
        parseError: entry.parseError,
      })),
    requiredReportLoadFailures: failedEntries.map((entry) =>
      entry.parseError ? `${entry.name}: ${entry.parseError}` : `${entry.name}: missing`,
    ),
  };
}

export function summarizeRequiredReportStructureEvidence({ housekeepingReport, launchReport }) {
  const checks = [
    {
      name: "housekeeping.operatorSummary",
      ok: !!housekeepingReport?.operatorSummary && typeof housekeepingReport.operatorSummary === "object",
    },
    {
      name: "housekeeping.summary",
      ok: !!housekeepingReport?.summary && typeof housekeepingReport.summary === "object",
    },
    {
      name: "launch.summary",
      ok: !!launchReport?.summary && typeof launchReport.summary === "object",
    },
  ];
  const failedChecks = checks.filter((check) => !check.ok);

  return {
    requiredReportStructureCount: checks.length,
    requiredReportStructureReadyCount: checks.filter((check) => check.ok).length,
    requiredReportStructureNames: checks.map((check) => check.name),
    requiredReportStructureFailures: failedChecks.map((check) => `${check.name}: missing`),
  };
}

function evidenceNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

export function summarizeHousekeepingReportEvidence(housekeepingReport) {
  const summary = housekeepingReport?.summary ?? {};
  const drift = housekeepingReport?.drift ?? {};
  const failures = Array.isArray(housekeepingReport?.failures) ? housekeepingReport.failures.filter(Boolean) : [];
  const warnings = Array.isArray(housekeepingReport?.warnings) ? housekeepingReport.warnings.filter(Boolean) : [];
  const nonHousekeepingDriftPaths = [
    ...(Array.isArray(drift.nonHousekeepingStagedPaths) ? drift.nonHousekeepingStagedPaths : []),
    ...(Array.isArray(drift.nonHousekeepingUnstagedPaths) ? drift.nonHousekeepingUnstagedPaths : []),
    ...(Array.isArray(drift.nonHousekeepingUntrackedPaths) ? drift.nonHousekeepingUntrackedPaths : []),
  ]
    .filter((entry) => typeof entry === "string" && entry.length > 0)
    .sort();

  return {
    housekeepingPassed: housekeepingReport?.passed === true,
    housekeepingOperatorStatus: housekeepingReport?.operatorSummary?.status ?? "UNKNOWN",
    housekeepingOperatorMessage: housekeepingReport?.operatorSummary?.message ?? "",
    housekeepingNotifyRecommended: housekeepingReport?.operatorSummary?.notifyRecommended === true,
    housekeepingFailureCount: failures.length,
    housekeepingFailures: failures,
    housekeepingWarningCount: warnings.length,
    housekeepingWarnings: warnings,
    augmentReportPassed: housekeepingReport?.augmentReportPassed === true,
    augmentCandidateFileCount: evidenceNumber(summary.candidateFiles),
    augmentThreshold: evidenceNumber(summary.threshold),
    housekeepingCriticalIgnoreProbesPassed: summary.criticalIgnoreProbesPassed === true,
    housekeepingUntrackedIncludedCount: evidenceNumber(summary.untrackedIncluded),
    safeLocalHistoryCleanupCount: evidenceNumber(summary.finalSafe),
    cautionWorktreeCount: evidenceNumber(summary.finalCaution),
    keptWorktreeCount: evidenceNumber(summary.finalKeep),
    protectedPathsClean: summary.protectedPathsClean === true,
    protectedPathCount: evidenceNumber(summary.protectedPathCount),
    dirtyProtectedPathCount: evidenceNumber(summary.dirtyProtectedPathCount),
    removedSafePathCount: evidenceNumber(summary.removedSafeCount),
    prunedWorktreeCount: evidenceNumber(summary.prunedWorktreeCount),
    invalidRegisteredWorktreeCount: evidenceNumber(summary.invalidRegistered),
    housekeepingStagedDiffCheckPassed: summary.stagedDiffCheckPassed === true,
    housekeepingOnlyDrift: summary.housekeepingOnlyDrift === true,
    housekeepingDriftStagedCount: evidenceNumber(drift.stagedCount),
    housekeepingDriftUnstagedCount: evidenceNumber(drift.unstagedCount),
    housekeepingDriftUntrackedCount: evidenceNumber(drift.untrackedCount),
    housekeepingDriftHousekeepingOnly: drift.housekeepingOnly === true,
    housekeepingNonHousekeepingDriftPaths: nonHousekeepingDriftPaths,
  };
}

export function summarizeLaunchReportEvidence(launchReport) {
  const summary = launchReport?.summary ?? {};
  const staticChecks = Array.isArray(launchReport?.staticChecks) ? launchReport.staticChecks : [];
  const liveChecks = Array.isArray(launchReport?.liveChecks) ? launchReport.liveChecks : [];
  const interactiveChecks = Array.isArray(launchReport?.interactiveChecks) ? launchReport.interactiveChecks : [];
  const failedStaticChecks = staticChecks.filter((check) => check?.ok !== true && check?.optional !== true);
  const failedLiveChecks = liveChecks.filter((check) => check?.ok !== true && check?.optional !== true);
  const failedInteractiveChecks = interactiveChecks.filter((check) => check?.ok !== true && check?.optional !== true);
  const rawFailedChecks = [...failedStaticChecks, ...failedLiveChecks, ...failedInteractiveChecks];
  const remoteProbeSuppressed = summary.remoteProbeInfra?.networkAccessDenied === true;
  const effectiveFailedChecks = remoteProbeSuppressed
    ? [...failedStaticChecks]
    : [...failedStaticChecks, ...failedLiveChecks, ...failedInteractiveChecks];
  const suppressedRemoteProbeFailures = remoteProbeSuppressed
    ? [...failedLiveChecks, ...failedInteractiveChecks]
    : [];
  const checkNames = (checks) => checks.map((check) => check?.name).filter(Boolean);
  const checkDetails = (checks) =>
    checks.map((check) => ({
      name: check?.name ?? "",
      url: check?.url ?? null,
      detail: check?.detail ?? "",
      durationMs: typeof check?.durationMs === "number" ? check.durationMs : null,
    }));

  return {
    launchPassed: summary.passed === true,
    launchStaticPassed: summary.staticPassed === true,
    launchLivePassed: summary.livePassed === true,
    launchInteractivePassed: summary.interactivePassed === true,
    launchStaticCheckCount: evidenceNumber(summary.staticChecks),
    launchLiveCheckCount: evidenceNumber(summary.liveChecks),
    launchInteractiveCheckCount: evidenceNumber(summary.interactiveChecks),
    launchRequiredStaticFailureCount: evidenceNumber(summary.requiredStaticFailures),
    launchBlockerCount: evidenceNumber(summary.blockers),
    launchWarningCount: evidenceNumber(summary.warnings),
    launchLiveFailureCount: evidenceNumber(summary.liveFailures),
    launchInteractiveFailureCount: evidenceNumber(summary.interactiveFailures),
    launchRemoteProbeNetworkAccessDenied: remoteProbeSuppressed,
    launchStaticCheckNames: checkNames(staticChecks),
    launchLiveCheckNames: checkNames(liveChecks),
    launchInteractiveCheckNames: checkNames(interactiveChecks),
    launchFailedCheckNames: checkNames(effectiveFailedChecks),
    launchFailedCheckDetails: checkDetails(effectiveFailedChecks),
    launchRawFailedCheckCount: rawFailedChecks.length,
    launchRawFailedCheckNames: checkNames(rawFailedChecks),
    launchRawFailedCheckDetails: checkDetails(rawFailedChecks),
    launchSuppressedRemoteProbeFailureCount: suppressedRemoteProbeFailures.length,
    launchSuppressedRemoteProbeFailureNames: checkNames(suppressedRemoteProbeFailures),
  };
}

function normalizeEvidencePath(value) {
  return String(value ?? "").replaceAll("\\", "/").trim();
}

export function summarizeTmpIgnoreEvidence(ignoreCheck, expectedPaths = []) {
  const lines = String(ignoreCheck?.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const entries = lines.map((line) => {
    const tabIndex = line.lastIndexOf("\t");
    if (tabIndex >= 0) {
      return {
        ruleSource: line.slice(0, tabIndex).trim(),
        path: line.slice(tabIndex + 1).trim(),
      };
    }

    const parts = line.split(/\s+/);
    return {
      ruleSource: "",
      path: parts.at(-1) ?? "",
    };
  });
  const ignoredPaths = entries.map((entry) => entry.path).filter(Boolean).sort();
  const normalizedIgnoredPaths = new Set(ignoredPaths.map(normalizeEvidencePath));
  const expectedReportPaths = expectedPaths.map((path) => String(path ?? "").trim()).filter(Boolean);

  return {
    tmpIgnoreProbePassed: ignoreCheck?.exitCode === 0,
    tmpIgnoreProbeExpectedCount: expectedReportPaths.length,
    tmpIgnoreProbeCount: ignoredPaths.length,
    tmpIgnoreProbeMissingPaths: expectedReportPaths
      .filter((path) => !normalizedIgnoredPaths.has(normalizeEvidencePath(path)))
      .sort(),
    tmpIgnoredReportPaths: ignoredPaths,
    tmpIgnoreRuleSources: [...new Set(entries.map((entry) => entry.ruleSource).filter(Boolean))].sort(),
  };
}

export function summarizeGitBranchEvidence(gitBranchStatus) {
  const firstLine = String(gitBranchStatus ?? "").split(/\r?\n/)[0]?.trim() ?? "";
  const match = firstLine.match(/^##\s+([^\s\[]+)(?:\s+\[([^\]]+)\])?/);
  const branchAndUpstream = match?.[1] ?? "";
  const [branchName = null, upstreamName = null] = branchAndUpstream.split("...");
  const trackingSummary = match?.[2] ?? "";
  const gitBehindCount = Number(trackingSummary.match(/behind\s+(\d+)/)?.[1] ?? 0);
  const gitAheadCount = Number(trackingSummary.match(/ahead\s+(\d+)/)?.[1] ?? 0);
  const detachedMatch = firstLine.match(/^##\s+HEAD\s+\(([^)]+)\)/i);
  const gitDetachedHead = Boolean(detachedMatch) || /^##\s+HEAD\b/i.test(firstLine);
  const gitDetachedHeadDetail = gitDetachedHead ? detachedMatch?.[1]?.trim() ?? "HEAD is detached" : null;

  return {
    gitBranchName: branchName || null,
    gitUpstreamName: upstreamName || null,
    gitTrackingKnown: Boolean(upstreamName),
    gitAheadCount,
    gitBehindCount,
    gitDetachedHead,
    gitDetachedHeadDetail,
    gitBranchBehindUpstream: Boolean(upstreamName) && gitBehindCount > 0,
    gitBranchSyncDetail: gitDetachedHead
      ? `Detached HEAD: ${gitDetachedHeadDetail}.`
      : !upstreamName
        ? "No tracked upstream configured."
        : gitBehindCount > 0
          ? `Behind ${upstreamName} by ${gitBehindCount} commit${gitBehindCount === 1 ? "" : "s"}.`
          : `Not behind ${upstreamName}.`,
  };
}

export function summarizeGitHeadEvidence(gitHeadSummary) {
  const firstLine = String(gitHeadSummary ?? "").split(/\r?\n/)[0]?.trim() ?? "";
  const match = firstLine.match(/^([0-9a-f]+)\s+(.+)$/i);
  return {
    gitHeadSummary: firstLine || null,
    gitHeadShortSha: match?.[1] ?? null,
    gitHeadSubject: match?.[2] ?? null,
  };
}

export function summarizeGitStatusEvidence(gitStatus) {
  const lines = String(gitStatus ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    gitStatus: lines.join("\n"),
    gitStatusEntryCount: lines.length,
  };
}

export function summarizeCriteriaEvidence(criteria) {
  const passedCriterionNames = criteria.filter((criterion) => criterion.ok).map((criterion) => criterion.name);
  const failedCriterionDetails = criteria
    .filter((criterion) => !criterion.ok)
    .map((criterion) => ({
      name: criterion.name,
      detail: criterion.detail ?? "",
    }));

  return {
    criterionCount: criteria.length,
    passedCriterionCount: passedCriterionNames.length,
    passedCriterionNames,
    failedCriterionCount: failedCriterionDetails.length,
    failedCriterionDetails,
  };
}

export function summarizeNotificationEvidence(criteria) {
  const failures = criteria.filter((criterion) => !criterion.ok).map((criterion) => criterion.name);
  return {
    notifyRecommended: failures.length > 0,
    notifyRecommendationReason:
      failures.length > 0
        ? `Launch goal failures (${failures.length}): ${failures.join("; ")}`
        : "All launch goal criteria passed; no notification needed.",
  };
}

export function summarizeReportSchemaEvidence(schemaVersion) {
  const normalized = String(schemaVersion ?? "").trim();
  return {
    reportSchemaVersion: normalized || null,
  };
}

export function summarizeReportMetadataEvidence({ generatedAt, reportPath }) {
  return {
    reportGeneratedAt: String(generatedAt ?? "").trim() || null,
    reportPath: String(reportPath ?? "").trim() || null,
  };
}

export function summarizeGoalEvidence(goal) {
  const sourceRefs = Array.isArray(goal?.sourceRefs) ? goal.sourceRefs.filter(Boolean) : [];
  return {
    goalId: goal?.id ?? null,
    goalSourceRefCount: sourceRefs.length,
    goalSourceRefs: sourceRefs,
  };
}

function countBy(items, getKey) {
  const counts = new Map();
  for (const item of items) {
    const key = getKey(item) || "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

export function summarizeDevelopmentBacklogEvidence(developmentBacklog) {
  return {
    developmentBacklogCount: developmentBacklog.length,
    developmentBacklogModeCounts: countBy(developmentBacklog, (item) => item.mode),
    developmentBacklogPriorityCounts: countBy(developmentBacklog, (item) => item.priority),
    developmentBacklogIds: developmentBacklog.map((item) => item.id).filter(Boolean),
  };
}

export function summarizeDevelopmentCandidateEvidence(developmentCandidate) {
  return {
    nextDevelopmentCandidate: developmentCandidate?.id ?? null,
    nextDevelopmentCandidateTitle: developmentCandidate?.title ?? null,
    nextDevelopmentCandidateMode: developmentCandidate?.mode ?? null,
    nextDevelopmentCandidatePriority: developmentCandidate?.priority ?? null,
    nextDevelopmentCandidateSurface: developmentCandidate?.surface ?? null,
    nextDevelopmentCandidateArea: developmentCandidate?.area ?? null,
    nextDevelopmentCandidateSourcePath: developmentCandidate?.sourcePath ?? null,
    nextDevelopmentCandidateSuggestedVerification: developmentCandidate?.suggestedVerification ?? [],
    nextDevelopmentCandidateWhy: developmentCandidate?.why ?? null,
    nextDevelopmentCandidateMaxSlice: developmentCandidate?.maxSlice ?? null,
    nextDevelopmentCandidateSelectionType: developmentCandidate?.selectionType ?? null,
    nextDevelopmentCandidateEligibleSafeLocalGoalCount: evidenceNumber(
      developmentCandidate?.eligibleSafeLocalGoalCount,
    ),
    nextDevelopmentCandidateOpenGoalQueueCount: evidenceNumber(developmentCandidate?.openGoalQueueCount),
    nextDevelopmentCandidateReason: developmentCandidate?.selectionReason ?? null,
    nextDevelopmentCandidateActionability: developmentCandidate?.actionability ?? null,
    nextDevelopmentCandidateActionRequired: developmentCandidate?.actionRequired === true,
    nextDevelopmentCandidateQuietPassEligible: developmentCandidate?.quietPassEligible === true,
    nextDevelopmentCandidateActionabilityReason: developmentCandidate?.actionabilityReason ?? null,
  };
}

export function summarizeKnownCautionEvidence(knownCautions) {
  const cautionEntries = Array.isArray(knownCautions) ? knownCautions.filter(Boolean) : [];
  const cautionPathReasons = cautionEntries.map((entry) => ({
    path: entry?.path ?? "unknown",
    reason: entry?.reason ?? "",
  }));
  const entriesMatchingReason = (pattern) => cautionPathReasons.filter((entry) => pattern.test(entry.reason));
  const pathsMatchingReason = (pattern) =>
    entriesMatchingReason(pattern)
      .map((entry) => entry.path)
      .filter(Boolean)
      .sort();

  return {
    knownCautionPaths: cautionPathReasons.map((entry) => entry.path).filter(Boolean).sort(),
    knownCautionPathReasons: cautionPathReasons,
    invalidRegisteredWorktreePaths: pathsMatchingReason(/invalid registered worktree/i),
    explicitPruneCautionWorktreePaths: pathsMatchingReason(/explicit prune only/i),
    explicitPruneCautionWorktreePathReasons: entriesMatchingReason(/explicit prune only/i),
  };
}

export function summarizeKnownCautionSuppressionEvidence({ housekeepingReport, knownCautions, actionableAttention }) {
  const attentionItems = Array.isArray(housekeepingReport?.operatorSummary?.attentionItems)
    ? housekeepingReport.operatorSummary.attentionItems.filter(Boolean)
    : [];
  const knownCautionCount = Array.isArray(knownCautions) ? knownCautions.filter(Boolean).length : 0;
  const actionableAttentionItems = Array.isArray(actionableAttention) ? actionableAttention.filter(Boolean) : [];
  const actionableAttentionCount = actionableAttentionItems.length;
  const actionableAttentionSet = new Set(actionableAttentionItems);
  const suppressedAttentionItems = attentionItems.filter((item) => !actionableAttentionSet.has(item));
  const suppressedAttentionCount = suppressedAttentionItems.length;

  return {
    knownCautionSuppressesHousekeepingNotify:
      housekeepingReport?.operatorSummary?.notifyRecommended === true &&
      knownCautionCount > 0 &&
      actionableAttentionCount === 0 &&
      suppressedAttentionCount > 0,
    knownCautionSuppressedAttentionCount: suppressedAttentionCount,
    knownCautionSuppressedAttentionItems: suppressedAttentionItems,
  };
}

function isSafeGitVerificationCommand(command) {
  const normalized = String(command ?? "").trim().toLowerCase();
  if (!normalized.startsWith("git ")) return false;
  const mutatingPatterns = [
    /^git\s+push\b/,
    /^git\s+pull\b/,
    /^git\s+fetch\b/,
    /^git\s+commit\b/,
    /^git\s+merge\b/,
    /^git\s+rebase\b/,
    /^git\s+reset\b/,
    /^git\s+restore\b/,
    /^git\s+checkout\b/,
    /^git\s+switch\b/,
    /^git\s+clean\b/,
    /^git\s+stash\b/,
    /^git\s+cherry-pick\b/,
    /^git\s+revert\b/,
    /^git\s+apply\b/,
    /^git\s+am\b/,
    /^git\s+rm\b/,
    /^git\s+mv\b/,
  ];
  return !mutatingPatterns.some((pattern) => pattern.test(normalized));
}

function hasInlineShellEvaluation(command) {
  const normalized = String(command ?? "").trim().toLowerCase();
  if (!normalized) return true;
  if (/(^|[\s])(&&|\|\||;)([\s]|$)/.test(normalized)) return true;
  if (/^node\b/.test(normalized)) {
    return /(^|\s)(-e|--eval|-p|--print)(\s|$)/.test(normalized);
  }
  if (/^(powershell|pwsh)\b/.test(normalized)) {
    return /(^|\s)(-command|-c|-encodedcommand|-ec)(\s|$)/.test(normalized);
  }
  return false;
}

export function summarizeVerificationEntryPointEvidence(verificationCommands, packageJson) {
  const commands = Array.isArray(verificationCommands)
    ? verificationCommands.map((command) => String(command ?? "").trim()).filter(Boolean)
    : [];
  const packageScripts =
    packageJson && typeof packageJson === "object" && packageJson.scripts && typeof packageJson.scripts === "object"
      ? packageJson.scripts
      : {};
  const referencedScripts = [];
  const missingScripts = [];
  const unsupportedCommands = [];

  for (const command of commands) {
    const npmRunMatch = command.match(/^npm run ([^\s&|;]+)/i);
    if (npmRunMatch) {
      const scriptName = npmRunMatch[1];
      referencedScripts.push(scriptName);
      if (!Object.prototype.hasOwnProperty.call(packageScripts, scriptName)) {
        missingScripts.push(scriptName);
      }
      continue;
    }

    if (/^git\b/i.test(command)) {
      if (isSafeGitVerificationCommand(command)) continue;
      unsupportedCommands.push(command);
      continue;
    }

    if (/^(node|npx|powershell|pwsh)\b/i.test(command)) {
      if (hasInlineShellEvaluation(command)) {
        unsupportedCommands.push(command);
        continue;
      }
      continue;
    }
    unsupportedCommands.push(command);
  }

  return {
    nextDevelopmentCandidateHasSuggestedVerification: commands.length > 0,
    nextDevelopmentCandidateVerificationCommandCount: commands.length,
    nextDevelopmentCandidateVerificationScriptCount: referencedScripts.length,
    nextDevelopmentCandidateVerificationScriptRefs: referencedScripts,
    nextDevelopmentCandidateVerificationEntryPointsValid:
      commands.length > 0 && missingScripts.length === 0 && unsupportedCommands.length === 0,
    nextDevelopmentCandidateVerificationMissingScripts: missingScripts,
    nextDevelopmentCandidateVerificationUnsupportedCommands: unsupportedCommands,
  };
}

export function normalizeGoalStatus(status) {
  const value = String(status ?? "").trim().toLowerCase();
  if (!value) return "unknown";
  if (value.startsWith("shipping")) return "shipping";
  if (value.startsWith("shipped")) return "shipped";
  if (value.startsWith("proposed")) return "proposed";
  if (value.startsWith("queued")) return "queued";
  if (value.startsWith("active")) return "active";
  if (value.startsWith("done") || value.startsWith("complete")) return "done";
  return "other";
}

export function isOpenGoalStatus(status) {
  return ["active", "proposed", "queued"].includes(normalizeGoalStatus(status));
}

export function summarizeGoalQueueEvidence(goalQueue) {
  const openGoals = goalQueue.filter((goal) => isOpenGoalStatus(goal.status));
  const eligibleSafeLocalGoals = openGoals.filter((goal) => goal.mode === "safe-local-development");
  const openHumanGatedGoals = openGoals.filter((goal) => goal.mode === "human-gated");
  const idsByStatus = (status) =>
    goalQueue
      .filter((goal) => normalizeGoalStatus(goal.status) === status)
      .map((goal) => goal.id)
      .filter(Boolean);

  return {
    goalQueueCount: goalQueue.length,
    goalQueueStatusCounts: countBy(goalQueue, (goal) => normalizeGoalStatus(goal.status)),
    goalQueueModeCounts: countBy(goalQueue, (goal) => goal.mode),
    goalQueuePriorityCounts: countBy(goalQueue, (goal) => goal.priority),
    proposedGoalQueueIds: idsByStatus("proposed"),
    queuedGoalQueueIds: idsByStatus("queued"),
    shippingGoalQueueIds: idsByStatus("shipping"),
    shippedGoalQueueIds: idsByStatus("shipped"),
    doneGoalQueueIds: idsByStatus("done"),
    openGoalQueueCount: openGoals.length,
    openGoalQueueIds: openGoals.map((goal) => goal.id).filter(Boolean),
    safeLocalGoalCount: eligibleSafeLocalGoals.length,
    safeLocalGoalIds: eligibleSafeLocalGoals.map((goal) => goal.id).filter(Boolean),
    humanGatedGoalCount: openHumanGatedGoals.length,
    humanGatedGoalIds: openHumanGatedGoals.map((goal) => goal.id).filter(Boolean),
  };
}

export function summarizeWorkflowModelEvidence(workflowModel) {
  const specialistPasses = Array.isArray(workflowModel?.specialistPasses)
    ? workflowModel.specialistPasses.filter(Boolean)
    : [];

  return {
    workflowIssueQueueModel: workflowModel?.issueQueue ?? null,
    workflowSpecialistPassCount: specialistPasses.length,
    workflowSpecialistPasses: specialistPasses,
    workflowDevelopmentCadence: workflowModel?.developmentCadence ?? null,
    workflowRepeatedFailureRule: workflowModel?.repeatedFailureRule ?? null,
    workflowSafetyBoundary: workflowModel?.safetyBoundary ?? null,
  };
}

async function main() {
  const commands = [];
  commands.push(await run("npm", ["run", "repo:housekeeping:check"]));
  commands.push(await run("npm", ["run", "scratchnode:launch:interactive"]));
  commands.push(await run("git", ["status", "--short"]));
  commands.push(await run("git", ["status", "--short", "--branch"]));
  commands.push(await run("git", ["show", "-s", "--oneline", "HEAD"]));
  commands.push(
    await run("git", [
      "check-ignore",
      "-v",
      reportPaths.housekeeping,
      reportPaths.launch,
      reportPaths.augment,
      reportPaths.housekeepingLoop,
      reportPaths.localHistory,
      reportPaths.goalLoop,
    ]),
  );

  const housekeepingReport = readJson(reportPaths.housekeeping);
  const launchReport = readJson(reportPaths.launch);
  const localHistoryReport = readJson(reportPaths.localHistory);
  const packageJson = readJson("package.json");
  const gitStatus = commands.find((command) => command.command === "git status --short")?.stdout.trim() ?? "";
  const gitBranchStatus = commands.find((command) => command.command === "git status --short --branch")?.stdout.trim() ?? "";
  const gitHeadSummary = commands.find((command) => command.command === "git show -s --oneline HEAD")?.stdout.trim() ?? "";
  const ignoreCheck = commands.find((command) => command.command.startsWith("git check-ignore"));
  const tmpIgnoreEvidence = summarizeTmpIgnoreEvidence(ignoreCheck, Object.values(reportPaths));
  const gitBranchEvidence = summarizeGitBranchEvidence(gitBranchStatus);
  const actionableAttention = actionableAttentionItems(housekeepingReport);
  const launchRelevantBlockers = housekeepingReport?.operatorSummary?.launchRelevantBlockers ?? [];
  const knownCautions = knownCautionEntries(housekeepingReport, localHistoryReport);
  const goalQueue = readGoalQueue();
  const developmentBacklog = buildDevelopmentBacklog({
    actionableAttention,
    launchRelevantBlockers,
    goalCards: goalQueue,
    gitStatus,
    gitBranchEvidence,
    launchReport,
  });
  const developmentCandidate = selectDevelopmentCandidate(developmentBacklog, {
    actionableAttention,
    launchRelevantBlockers,
    goalQueue,
  });
  const candidateVerificationEvidence = summarizeVerificationEntryPointEvidence(
    developmentCandidate?.suggestedVerification,
    packageJson,
  );
  const requiredReportLoadEvidence = summarizeRequiredReportLoadEvidence({
    housekeeping: housekeepingReport,
    launch: launchReport,
    localHistory: localHistoryReport,
    packageJson,
  });
  const requiredReportStructureEvidence = summarizeRequiredReportStructureEvidence({
    housekeepingReport,
    launchReport,
  });

  const criteria = [
    buildCriterion(
      "required source reports load cleanly",
      requiredReportLoadEvidence.requiredReportLoadFailures.length === 0,
      requiredReportLoadEvidence.requiredReportLoadFailures.join("; "),
    ),
    buildCriterion(
      "required report structures stay available",
      requiredReportStructureEvidence.requiredReportStructureFailures.length === 0,
      requiredReportStructureEvidence.requiredReportStructureFailures.join("; "),
    ),
    buildCriterion(
      "housekeeping command passes",
      commands[0]?.exitCode === 0 && housekeepingReport?.passed === true,
      housekeepingReport?.operatorSummary?.message,
    ),
    buildCriterion(
      "ScratchNode static/live/interactive launch scan passes",
      commands[1]?.exitCode === 0 && launchReport?.summary?.passed === true,
      formatLaunchSummaryDetail(launchReport),
    ),
    buildCriterion(
      "Augment upload scope stays under threshold",
      housekeepingReport?.summary?.candidateFiles < housekeepingReport?.summary?.threshold,
      `${housekeepingReport?.summary?.candidateFiles ?? "?"}/${housekeepingReport?.summary?.threshold ?? "?"}`,
    ),
    buildCriterion("safe local-history cleanup queue is empty", housekeepingReport?.summary?.finalSafe === 0),
    buildCriterion("protected product/runtime paths are clean", housekeepingReport?.summary?.protectedPathsClean === true),
    buildCriterion(
      "source reports match repo and are fresh",
      housekeepingReport?.summary?.sourceReportsMatch === true && housekeepingReport?.summary?.sourceReportsFresh === true,
    ),
    buildCriterion("git drift is clean after the loop", gitStatus.length === 0, gitStatus),
    buildCriterion(
      "git branch is attached and not behind upstream",
      gitBranchEvidence.gitDetachedHead !== true && gitBranchEvidence.gitBranchBehindUpstream !== true,
      gitBranchEvidence.gitBranchSyncDetail,
    ),
    buildCriterion(
      ".tmp loop reports are ignored",
      tmpIgnoreEvidence.tmpIgnoreProbePassed && tmpIgnoreEvidence.tmpIgnoreProbeMissingPaths.length === 0,
      ignoreCheck?.stdout.trim(),
    ),
    buildCriterion("no launch-relevant blockers remain", launchRelevantBlockers.length === 0, launchRelevantBlockers.join("; ")),
    buildCriterion("no actionable attention items remain", actionableAttention.length === 0, actionableAttention.join("; ")),
    buildCriterion(
      "development candidate verification entrypoints stay valid",
      developmentCandidate == null || candidateVerificationEvidence.nextDevelopmentCandidateVerificationEntryPointsValid === true,
      developmentCandidate == null
        ? ""
        : candidateVerificationEvidence.nextDevelopmentCandidateVerificationEntryPointsValid
          ? `commands=${candidateVerificationEvidence.nextDevelopmentCandidateVerificationCommandCount}`
          : [
              candidateVerificationEvidence.nextDevelopmentCandidateHasSuggestedVerification
                ? null
                : "missing suggested verification",
              candidateVerificationEvidence.nextDevelopmentCandidateVerificationMissingScripts.length > 0
                ? `missing scripts=${candidateVerificationEvidence.nextDevelopmentCandidateVerificationMissingScripts.join(",")}`
                : null,
              candidateVerificationEvidence.nextDevelopmentCandidateVerificationUnsupportedCommands.length > 0
                ? `unsupported commands=${candidateVerificationEvidence.nextDevelopmentCandidateVerificationUnsupportedCommands.join(",")}`
                : null,
            ]
              .filter(Boolean)
              .join("; "),
    ),
  ];

  const passed = criteria.every((criterion) => criterion.ok);
  const commandEvidence = summarizeCommandEvidence(commands, {
    commandTimeoutMs: defaultCommandTimeoutMs,
  });
  const sourceReportEvidence = summarizeSourceReportEvidence(housekeepingReport);
  const housekeepingEvidence = summarizeHousekeepingReportEvidence(housekeepingReport);
  const launchReportEvidence = summarizeLaunchReportEvidence(launchReport);
  const gitStatusEvidence = summarizeGitStatusEvidence(gitStatus);
  const gitHeadEvidence = summarizeGitHeadEvidence(gitHeadSummary);
  const criteriaEvidence = summarizeCriteriaEvidence(criteria);
  const notificationEvidence = summarizeNotificationEvidence(criteria);
  const reportSchemaEvidence = summarizeReportSchemaEvidence(reportSchemaVersion);
  const backlogEvidence = summarizeDevelopmentBacklogEvidence(developmentBacklog);
  const candidateEvidence = summarizeDevelopmentCandidateEvidence(developmentCandidate);
  const knownCautionEvidence = summarizeKnownCautionEvidence(knownCautions);
  const knownCautionSuppressionEvidence = summarizeKnownCautionSuppressionEvidence({
    housekeepingReport,
    knownCautions,
    actionableAttention,
  });
  const goalQueueEvidence = summarizeGoalQueueEvidence(goalQueue);
  const workflowModel = {
    issueQueue:
      "Batch findings into blockers, attention items, known-safe cautions, and one focused development candidate per loop.",
    specialistPasses: [
      "housekeeping",
      "ScratchNode product workflow",
      "NodeBench handoff and workspace direction",
      "privacy and agent reliability",
      "performance/accessibility",
      "public repo positioning",
    ],
    developmentCadence:
      "If gates are red, fix the smallest blocker first. If gates are green, pick one safe-local-development backlog item, make a narrow improvement, verify it, and commit or report the residual risk.",
    repeatedFailureRule:
      "After three repeated failures on the same gate, change strategy by instrumenting, isolating, rolling back the risky slice, or reducing scope.",
    safetyBoundary:
      "The loop may edit local source, tests, scripts, and docs, but is read-only against production: it navigates, opens modals, copies safe controls, and inspects reports without sending chat, creating events, publishing wikis, deploying, pushing, or mutating live user data.",
  };
  const workflowEvidence = summarizeWorkflowModelEvidence(workflowModel);
  const goal = {
    id: "scratchnode-nodebench-development-goal-cron",
    objective: "Keep ScratchNode and NodeBench continuously improving in small verified slices while preserving production safety.",
    stopCondition:
      "The loop is clean when housekeeping, Augment scope, ScratchNode static/live/interactive checks, NodeBench handoff checks, tmp-ignore probes, and git drift all pass with no launch-relevant blockers; a development slice is done only when it is locally verified and either committed or explicitly reported.",
    sourceRefs: [
      "docs/runbooks/GOAL_MODE_RELEASE_AUTOPILOT.md",
      "docs/runbooks/SCRATCHNODE_LAUNCH_DAY.md",
      "docs/runbooks/WORKSPACE_HOUSEKEEPING.md",
    ],
    successCriteria: criteria,
  };
  const goalEvidence = summarizeGoalEvidence(goal);
  const generatedAt = new Date().toISOString();
  const reportMetadataEvidence = summarizeReportMetadataEvidence({
    generatedAt,
    reportPath: outPath,
  });
  const report = {
    schemaVersion: reportSchemaVersion,
    generatedAt,
    repo: repoRoot,
    goal,
    workflowModel,
    summary: {
      passed,
      ...notificationEvidence,
      failures: criteria.filter((criterion) => !criterion.ok).map((criterion) => criterion.name),
      ...criteriaEvidence,
      ...backlogEvidence,
      ...goalQueueEvidence,
      knownCautionCount: knownCautions.length,
      ...knownCautionEvidence,
      ...knownCautionSuppressionEvidence,
      actionableAttentionCount: actionableAttention.length,
      launchRelevantBlockerCount: launchRelevantBlockers.length,
      queuedGoalCount: goalQueue.filter((goal) => isOpenGoalStatus(goal.status)).length,
      gitDriftClean: gitStatus.length === 0,
      ...gitStatusEvidence,
      gitBranchStatus,
      ...gitBranchEvidence,
      ...gitHeadEvidence,
      ...reportSchemaEvidence,
      ...reportMetadataEvidence,
      ...goalEvidence,
      ...requiredReportLoadEvidence,
      ...requiredReportStructureEvidence,
      ...commandEvidence,
      ...sourceReportEvidence,
      ...housekeepingEvidence,
      ...launchReportEvidence,
      ...tmpIgnoreEvidence,
      ...candidateEvidence,
      ...candidateVerificationEvidence,
      ...workflowEvidence,
    },
    commands,
    reports: {
      housekeeping: housekeepingReport,
      launch: launchReport,
    },
    developmentCandidate,
    knownCautionEntries: knownCautions,
    actionableAttentionItems: actionableAttention,
    launchRelevantBlockers,
    goalQueue,
    developmentBacklog,
    gitStatus,
    gitBranchStatus,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  if (shouldPrintJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `ScratchNode launch goal loop: ${passed ? "PASS" : "FAIL"} ` +
        `(failures=${report.summary.failures.length}, knownCautions=${knownCautions.length})`,
    );
    console.log(`Report: ${outPath}`);
    for (const failure of report.summary.failures) {
      console.log(`- ${failure}`);
    }
  }

  if (!passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
