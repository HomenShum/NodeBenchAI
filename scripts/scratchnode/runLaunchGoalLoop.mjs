#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

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
    return {
      parseError: error instanceof Error ? error.message : String(error),
    };
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

function unique(items) {
  return [...new Set(items.filter(Boolean))];
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

function buildCriterion(name, ok, detail) {
  return {
    name,
    ok: !!ok,
    detail: detail ?? "",
  };
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return {};
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    data[field[1]] = field[2].trim();
  }
  return data;
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

function readGoalQueue() {
  return walkMarkdownFiles("goals")
    .map((absolutePath) => {
      const text = readFileSync(absolutePath, "utf8").replace(/^\uFEFF/, "");
      const frontmatter = parseFrontmatter(text);
      if (!frontmatter.id || !frontmatter.status || !frontmatter.mode) return null;
      const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
      const goalSentence = text.match(/^#\s+Goal\s*\r?\n+\s*([^\r\n]+)/im)?.[1]?.trim() ?? "";
      const title = frontmatter.title ?? (heading && heading !== "Goal" ? heading : goalSentence) ?? frontmatter.id ?? absolutePath;
      const relativePath = absolutePath.slice(repoRoot.length + 1).replace(/\\/g, "/");
      return {
        id: frontmatter.id ?? relativePath.replace(/\.md$/i, "").replace(/\//g, "-"),
        title,
        surface: frontmatter.surface ?? "unknown",
        priority: frontmatter.priority ?? "P3",
        status: frontmatter.status ?? "queued",
        mode: frontmatter.mode ?? "safe-local-development",
        path: relativePath,
      };
    })
    .filter(Boolean)
    .filter((goal) => goal.status !== "done");
}

function priorityRank(priority) {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[priority] ?? 4;
}

function goalCardsToBacklog(goalCards) {
  return goalCards
    .filter((goal) => (goal.status === "queued" || goal.status === "active") && goal.mode === "safe-local-development")
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
      suggestedVerification:
        goal.surface === "NodeBench Runtime"
          ? ["npm run scratchnode:launch:goal", "npx vitest run convex/__tests__/scratchnode.events.test.ts"]
          : ["npm run scratchnode:launch:goal"],
      sourcePath: goal.path,
    }));
}

function buildDevelopmentBacklog({ housekeepingReport, launchReport, gitStatus, actionableAttention, launchRelevantBlockers, goalCards }) {
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
      why: "The loop cannot safely improve product code while unclassified user or agent changes are present.",
      maxSlice: "Inspect drift, preserve user changes, and either commit verified agent work or report non-agent drift.",
      suggestedVerification: ["git status --short", "git diff --check"],
    });
  }

  if (backlog.length > 0) return backlog;

  const queuedGoalBacklog = goalCardsToBacklog(goalCards);
  if (queuedGoalBacklog.length > 0) return queuedGoalBacklog;

  const launchChecks = launchReport?.staticChecks ?? [];
  const hasGoalAutomationChecks = launchChecks.some((check) => check.plane === "goal-automation");
  const hasNodeBenchLiveChecks = (launchReport?.liveChecks ?? []).some((check) => /nodebench/i.test(check.name));
  const hasNodeBenchInteractiveChecks = (launchReport?.interactiveChecks ?? []).some((check) => /nodebench/i.test(check.name));

  return [
    {
      id: "dev-scratchnode-flow-depth",
      surface: "scratchnode.live",
      area: "product workflow",
      priority: "P1",
      mode: "safe-local-development",
      title: "Deepen the safe ScratchNode workflow probe",
      why: "The current probe opens core modals and toggles private mode; the next quality lift is proving more of the Join -> Chat -> /ask -> private note -> FAQ -> Wiki loop without mutating production.",
      maxSlice: "Add one read-only/browser-safe assertion or one local fixture-backed Playwright scenario.",
      suggestedVerification: [
        "npm run scratchnode:launch:goal",
        "npx playwright test tests/e2e/scratchnode-demo-route-gate.spec.ts tests/e2e/scratchnode-live-route-honesty.spec.ts --project=chromium --workers=1 --reporter=list",
      ],
    },
    {
      id: "dev-nodebench-handoff-depth",
      surface: "nodebenchai.com",
      area: "ScratchNode handoff",
      priority: hasNodeBenchLiveChecks && hasNodeBenchInteractiveChecks ? "P2" : "P1",
      mode: "safe-local-development",
      title: "Strengthen NodeBench handoff verification",
      why: "NodeBench is the private workspace direction; the public launch loop should keep proving that ScratchNode handoff CTAs and /scratchnode-events remain coherent.",
      maxSlice: "Add one route assertion, copy/link invariant, or docs-backed detector for NodeBench handoff behavior.",
      suggestedVerification: ["npm run scratchnode:launch:goal"],
    },
    {
      id: "dev-privacy-eval-depth",
      surface: "convex/events.ts",
      area: "privacy and agent reliability",
      priority: "P1",
      mode: "safe-local-development",
      title: "Add or strengthen a privacy-boundary regression test",
      why: "The public/private boundary is ScratchNode's highest-trust invariant and should keep gaining executable coverage.",
      maxSlice: "Add one targeted test around /ask excluding private notes, parent /ask trace visibility, or normal-chat not invoking the agent.",
      suggestedVerification: ["npx vitest run convex/__tests__/scratchnode.events.test.ts", "npm run scratchnode:launch:goal"],
    },
    {
      id: "dev-public-repo-polish",
      surface: "public repo",
      area: "launch positioning",
      priority: "P2",
      mode: "safe-local-development",
      title: "Improve public repo clarity or export safety",
      why: "The public repo should stay positioned as high-fidelity prototype plus serious architecture, not an unstructured monorepo dump.",
      maxSlice: "Improve one README/runbook/export-script invariant or one public asset/check.",
      suggestedVerification: ["npm run scratchnode:launch:scan", "npm run scratchnode:launch:goal"],
    },
    {
      id: "dev-performance-a11y-polish",
      surface: "ScratchNode and NodeBench",
      area: "performance/accessibility",
      priority: "P2",
      mode: "safe-local-development",
      title: "Tighten one performance, mobile, or accessibility detector",
      why: "Small detector gains compound across the continuous loop and prevent cosmetic regressions from silently shipping.",
      maxSlice: "Add one static or browser assertion; avoid speculative visual redesign without screenshot evidence.",
      suggestedVerification: ["npm run scratchnode:launch:interactive"],
    },
    {
      id: "dev-goal-loop-instrumentation",
      surface: "automation",
      area: "self-improvement loop",
      priority: hasGoalAutomationChecks ? "P3" : "P1",
      mode: "safe-local-development",
      title: "Improve loop instrumentation and evidence quality",
      why: "The loop should become easier to judge over time: clearer reports, better candidate ranking, and less noisy notifications.",
      maxSlice: "Add one report field, detector, or runbook invariant that makes future autonomous work safer.",
      suggestedVerification: ["npm run scratchnode:launch:scan", "npm run scratchnode:launch:goal"],
    },
  ];
}

async function main() {
  const commands = [];
  commands.push(await run("npm", ["run", "repo:housekeeping:check"]));
  commands.push(await run("npm", ["run", "scratchnode:launch:interactive"]));
  commands.push(await run("git", ["status", "--short"]));
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
  const ignoreCheck = commands.find((command) => command.command.startsWith("git check-ignore"));
  const actionableAttention = actionableAttentionItems(housekeepingReport);
  const launchRelevantBlockers = housekeepingReport?.operatorSummary?.launchRelevantBlockers ?? [];
  const knownCautions = knownCautionEntries(housekeepingReport);
  const goalQueue = readGoalQueue();
  const developmentBacklog = buildDevelopmentBacklog({
    housekeepingReport,
    launchReport,
    gitStatus,
    actionableAttention,
    launchRelevantBlockers,
    goalCards: goalQueue,
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
      launchReport?.summary
        ? `blockers=${launchReport.summary.blockers}, warnings=${launchReport.summary.warnings}, liveFailures=${launchReport.summary.liveFailures}, interactiveFailures=${launchReport.summary.interactiveFailures}`
        : "missing launch report",
    ),
    buildCriterion(
      "Augment upload scope stays under threshold",
      housekeepingReport?.summary?.candidateFiles < housekeepingReport?.summary?.threshold,
      `${housekeepingReport?.summary?.candidateFiles ?? "?"}/${housekeepingReport?.summary?.threshold ?? "?"}`,
    ),
    buildCriterion("safe local-history cleanup queue is empty", housekeepingReport?.summary?.finalSafe === 0),
    buildCriterion("protected product/runtime paths are clean", housekeepingReport?.summary?.protectedPathsClean === true),
    buildCriterion("source reports match repo and are fresh", housekeepingReport?.summary?.sourceReportsMatch === true && housekeepingReport?.summary?.sourceReportsFresh === true),
    buildCriterion("git drift is clean after the loop", gitStatus.length === 0, gitStatus),
    buildCriterion(".tmp loop reports are ignored", ignoreCheck?.exitCode === 0, ignoreCheck?.stdout.trim()),
    buildCriterion("no launch-relevant blockers remain", launchRelevantBlockers.length === 0, launchRelevantBlockers.join("; ")),
    buildCriterion("no actionable attention items remain", actionableAttention.length === 0, actionableAttention.join("; ")),
  ];

  const passed = criteria.every((criterion) => criterion.ok);
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
      repeatedFailureRule: "After three repeated failures on the same gate, change strategy by instrumenting, isolating, rolling back the risky slice, or reducing scope.",
      safetyBoundary:
        "The loop may edit local source, tests, scripts, and docs, but is read-only against production: it navigates, opens modals, copies safe controls, and inspects reports without sending chat, creating events, publishing wikis, deploying, pushing, or mutating live user data.",
    },
    summary: {
      passed,
      notifyRecommended: !passed,
      failures: criteria.filter((criterion) => !criterion.ok).map((criterion) => criterion.name),
      knownCautionCount: knownCautions.length,
      actionableAttentionCount: actionableAttention.length,
      launchRelevantBlockerCount: launchRelevantBlockers.length,
      queuedGoalCount: goalQueue.filter((goal) => goal.status === "queued").length,
      gitDriftClean: gitStatus.length === 0,
      nextDevelopmentCandidate: developmentBacklog[0]?.id ?? null,
    },
    commands,
    reports: {
      housekeeping: housekeepingReport,
      launch: launchReport,
    },
    knownCautionEntries: knownCautions,
    actionableAttentionItems: actionableAttention,
    launchRelevantBlockers,
    goalQueue,
    developmentBacklog,
    gitStatus,
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

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
