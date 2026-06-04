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

const reportPaths = {
  housekeeping: ".tmp/workspace-housekeeping-verification.json",
  launch: ".tmp/scratchnode-launch-scan.json",
  augment: ".tmp/augment-upload-scope.json",
  housekeepingLoop: ".tmp/workspace-housekeeping-loop.json",
  localHistory: ".tmp/local-history-map-reduce.json",
  goalLoop: ".tmp/scratchnode-launch-goal-loop.json",
};

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
  return new Promise((resolveRun) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      env: process.env,
      shell: process.platform === "win32",
      windowsHide: true,
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolveRun({
        command: [command, ...commandArgs].join(" "),
        exitCode: 1,
        durationMs: Math.round(performance.now() - started),
        stdout: tail(stdout),
        stderr: tail(`${stderr}\n${error.message}`.trim()),
      });
    });
    child.on("close", (exitCode) => {
      resolveRun({
        command: [command, ...commandArgs].join(" "),
        exitCode: exitCode ?? 1,
        durationMs: Math.round(performance.now() - started),
        stdout: tail(stdout),
        stderr: tail(stderr),
      });
    });
  });
}

function buildCriterion(name, ok, detail = "") {
  return { name, ok: !!ok, detail };
}

function knownCautionEntries(housekeepingReport) {
  const entries = (housekeepingReport?.cautionEntries ?? []).filter((entry) =>
    /clean registered worktree; explicit prune only/i.test(entry.reason ?? ""),
  );
  const invalidRegistered = Number(housekeepingReport?.summary?.invalidRegistered ?? 0);
  if (invalidRegistered > 0) {
    entries.push({
      path: "git worktree metadata",
      reason: `invalid registered worktrees present: ${invalidRegistered}; keep-classified by local-history map/reduce`,
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
    .filter((goal) => (goal.status === "queued" || goal.status === "proposed" || goal.status === "active") && goal.mode === "safe-local-development")
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

function buildDevelopmentBacklog({ actionableAttention, launchRelevantBlockers, goalCards, gitStatus, launchReport }) {
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
  const safeLocalGoalCount = context.goalQueue?.filter(
    (goal) => (goal.status === "queued" || goal.status === "proposed" || goal.status === "active") && goal.mode === "safe-local-development",
  ).length ?? 0;

  let selectionReason = "Selected the first ranked backlog item.";
  if (candidate.id.startsWith("blocker-")) {
    selectionReason = `Launch blockers present (${launchRelevantBlockerCount}); fix-first work outranks new development slices.`;
  } else if (candidate.id.startsWith("attention-")) {
    selectionReason = `Actionable housekeeping items present (${actionableAttentionCount}); reliability cleanup outranks new development slices.`;
  } else if (candidate.id.startsWith("drift-")) {
    selectionReason = "Git drift is present; classify existing changes before starting a new autonomous slice.";
  } else if (candidate.id.startsWith("goal-")) {
    selectionReason = `Selected the highest-priority safe-local goal card from the queue (${safeLocalGoalCount} eligible).`;
  } else if (candidate.id === "dev-goal-loop-instrumentation") {
    selectionReason = "All gates are green and no safe-local goal cards are eligible, so the loop defaults to automation instrumentation.";
  }

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
    selectionReason,
  };
}

export function summarizeCommandEvidence(commands) {
  const commandDurations = commands.map((command) => ({
    command: command.command,
    exitCode: command.exitCode,
    durationMs: Math.max(0, Number(command.durationMs) || 0),
  }));
  const slowestCommand = commandDurations.reduce((slowest, command) => {
    if (!slowest || command.durationMs > slowest.durationMs) return command;
    return slowest;
  }, null);

  return {
    commandFailureCount: commands.filter((command) => command.exitCode !== 0).length,
    commandExitCodes: Object.fromEntries(commands.map((command) => [command.command, command.exitCode])),
    commandDurationTotalMs: commandDurations.reduce((total, command) => total + command.durationMs, 0),
    slowestCommand,
  };
}

export function summarizeSourceReportEvidence(housekeepingReport) {
  const sourceReports = Object.values(housekeepingReport?.sourceReports ?? {}).filter(Boolean);
  const staleSourceReportPaths = sourceReports
    .filter((report) => report.fresh === false || report.repoMatches === false)
    .map((report) => report.path ?? "unknown")
    .sort();

  return {
    sourceReportCount: sourceReports.length,
    sourceReportMaxAgeSeconds: sourceReports.reduce((maxAge, report) => {
      const ageSeconds = Number(report.ageSeconds);
      return Number.isFinite(ageSeconds) && ageSeconds > maxAge ? ageSeconds : maxAge;
    }, 0),
    staleSourceReportCount: staleSourceReportPaths.length,
    staleSourceReportPaths,
  };
}

export function summarizeGitBranchEvidence(gitBranchStatus) {
  const firstLine = String(gitBranchStatus ?? "").split(/\r?\n/)[0]?.trim() ?? "";
  const match = firstLine.match(/^##\s+([^\s\[]+)(?:\s+\[([^\]]+)\])?/);
  const branchAndUpstream = match?.[1] ?? "";
  const [branchName = null, upstreamName = null] = branchAndUpstream.split("...");
  const trackingSummary = match?.[2] ?? "";

  return {
    gitBranchName: branchName || null,
    gitUpstreamName: upstreamName || null,
    gitTrackingKnown: Boolean(upstreamName),
    gitAheadCount: Number(trackingSummary.match(/ahead\s+(\d+)/)?.[1] ?? 0),
    gitBehindCount: Number(trackingSummary.match(/behind\s+(\d+)/)?.[1] ?? 0),
  };
}

export function summarizeCriteriaEvidence(criteria) {
  const failedCriterionDetails = criteria
    .filter((criterion) => !criterion.ok)
    .map((criterion) => ({
      name: criterion.name,
      detail: criterion.detail ?? "",
    }));

  return {
    criterionCount: criteria.length,
    failedCriterionCount: failedCriterionDetails.length,
    failedCriterionDetails,
  };
}

async function main() {
  const commands = [];
  commands.push(await run("npm", ["run", "repo:housekeeping:check"]));
  commands.push(await run("npm", ["run", "scratchnode:launch:interactive"]));
  commands.push(await run("git", ["status", "--short"]));
  commands.push(await run("git", ["status", "--short", "--branch"]));
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
  const gitStatus = commands.find((command) => command.command === "git status --short")?.stdout.trim() ?? "";
  const gitBranchStatus = commands.find((command) => command.command === "git status --short --branch")?.stdout.trim() ?? "";
  const ignoreCheck = commands.find((command) => command.command.startsWith("git check-ignore"));
  const actionableAttention = actionableAttentionItems(housekeepingReport);
  const launchRelevantBlockers = housekeepingReport?.operatorSummary?.launchRelevantBlockers ?? [];
  const knownCautions = knownCautionEntries(housekeepingReport);
  const goalQueue = readGoalQueue();
  const developmentBacklog = buildDevelopmentBacklog({
    actionableAttention,
    launchRelevantBlockers,
    goalCards: goalQueue,
    gitStatus,
    launchReport,
  });
  const developmentCandidate = selectDevelopmentCandidate(developmentBacklog, {
    actionableAttention,
    launchRelevantBlockers,
    goalQueue,
  });

  const criteria = [
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
    buildCriterion(".tmp loop reports are ignored", ignoreCheck?.exitCode === 0, ignoreCheck?.stdout.trim()),
    buildCriterion("no launch-relevant blockers remain", launchRelevantBlockers.length === 0, launchRelevantBlockers.join("; ")),
    buildCriterion("no actionable attention items remain", actionableAttention.length === 0, actionableAttention.join("; ")),
  ];

  const passed = criteria.every((criterion) => criterion.ok);
  const safeLocalGoalCount = goalQueue.filter((goal) => goal.mode === "safe-local-development").length;
  const humanGatedGoalCount = goalQueue.filter((goal) => goal.mode === "human-gated").length;
  const commandEvidence = summarizeCommandEvidence(commands);
  const sourceReportEvidence = summarizeSourceReportEvidence(housekeepingReport);
  const gitBranchEvidence = summarizeGitBranchEvidence(gitBranchStatus);
  const criteriaEvidence = summarizeCriteriaEvidence(criteria);
  const report = {
    generatedAt: new Date().toISOString(),
    repo: repoRoot,
    goal: {
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
    },
    workflowModel: {
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
    },
    summary: {
      passed,
      notifyRecommended: !passed,
      failures: criteria.filter((criterion) => !criterion.ok).map((criterion) => criterion.name),
      ...criteriaEvidence,
      knownCautionCount: knownCautions.length,
      actionableAttentionCount: actionableAttention.length,
      launchRelevantBlockerCount: launchRelevantBlockers.length,
      queuedGoalCount: goalQueue.filter((goal) => goal.status === "queued" || goal.status === "proposed").length,
      safeLocalGoalCount,
      humanGatedGoalCount,
      gitDriftClean: gitStatus.length === 0,
      gitBranchStatus,
      ...gitBranchEvidence,
      ...commandEvidence,
      ...sourceReportEvidence,
      nextDevelopmentCandidate: developmentCandidate?.id ?? null,
      nextDevelopmentCandidateReason: developmentCandidate?.selectionReason ?? null,
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
