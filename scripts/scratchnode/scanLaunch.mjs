#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { goalLoopEvidenceFieldNames } from "./runLaunchGoalLoop.mjs";

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const shouldRunLive = args.has("--live") || args.has("--interactive");
const shouldRunInteractive = args.has("--interactive");
const shouldPrintJson = args.has("--json");
const outPath = resolve(repoRoot, ".tmp/scratchnode-launch-scan.json");
const DEFAULT_INTERACTIVE_GOTO_TIMEOUT_MS = 20_000;
const SLOW_ROUTE_INTERACTIVE_GOTO_TIMEOUT_MS = 35_000;
const slowInteractiveRoutePatterns = [/^https:\/\/nodebenchai\.com\/scratchnode-events\/?$/i];
const commitReadyInteractiveRoutePatterns = [/^https:\/\/nodebenchai\.com\/scratchnode-events\/?$/i];

export const launchContractFiles = Object.freeze({
  homeV5: "public/proto/home-v5.html",
  vercel: "vercel.json",
  configEndpoint: "api/scratchnode-config.js",
  exportScript: "scripts/repo/export-scratchnode-live-public.mjs",
  goalLoop: "scripts/scratchnode/runLaunchGoalLoop.mjs",
  goalRunbook: "docs/runbooks/GOAL_MODE_RELEASE_AUTOPILOT.md",
  launchRunbook: "docs/runbooks/SCRATCHNODE_LAUNCH_DAY.md",
  housekeepingRunbook: "docs/runbooks/WORKSPACE_HOUSEKEEPING.md",
  routeHonestySpec: "evals/e2e/scratchnode-live-route-honesty.spec.ts",
  wikiBridgeSpec: "apps/web/src/features/events/views/ScratchnodeWikiBridge.test.tsx",
  eventHandoffGoal: "adw/goals/nodebench/001-event-handoff.md",
  boundaryGoal: "adw/goals/scratchnode/003-privacy-boundary-honesty-gates.md",
});

const staticChecks = [];
const findings = [];
const liveChecks = [];
const interactiveChecks = [];
const requiredBoundaryGateIds = [
  "SN-LIVE-006",
  "SN-LIVE-007",
  "SN-LIVE-008",
  "SN-LIVE-009",
  "SN-LIVE-010",
  "SN-LIVE-012",
];
const requiredBoundaryEvidence = [
  { label: "mock state", pattern: /__snMockState/ },
  { label: "private note mutation", pattern: /notes:createNote/ },
  { label: "public message mutation", pattern: /events:sendMessage/ },
  { label: "FAQ suggestion mutation", pattern: /events:suggestAnswerForFaq/ },
  { label: "FAQ promotion mutation", pattern: /events:promoteAnswerToFaq/ },
  { label: "published wiki body assertion", pattern: /_sn_published_wiki_body/ },
];
const expectedAutomationScripts = {
  "repo:augment:check": "scripts/repo/checkAugmentUploadScope.ps1",
  "repo:housekeeping:verify": "scripts/repo/verifyWorkspaceHousekeeping.ps1",
  "repo:housekeeping:check": "npm run repo:augment:check && npm run repo:housekeeping:verify && git diff --cached --check",
  "scratchnode:launch:scan": "scripts/scratchnode/scanLaunch.mjs",
  "scratchnode:launch:interactive": "scripts/scratchnode/scanLaunch.mjs --live --interactive",
  "scratchnode:launch:goal": "scripts/scratchnode/runLaunchGoalLoop.mjs",
  "ui:aesthetic:review": "scripts/ui-aesthetic-review.mjs",
};

function readText(relativePath) {
  const absolutePath = resolve(repoRoot, relativePath);
  if (!existsSync(absolutePath)) return "";
  return readFileSync(absolutePath, "utf8");
}

function normalizeWhitespace(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

export function summarizePackageScriptContractEvidence(packageJsonText, expectedScripts = expectedAutomationScripts) {
  let packageJson = null;
  try {
    packageJson = JSON.parse(String(packageJsonText ?? "").replace(/^\uFEFF/, ""));
  } catch {
    packageJson = null;
  }

  const scripts =
    packageJson && typeof packageJson === "object" && packageJson.scripts && typeof packageJson.scripts === "object"
      ? packageJson.scripts
      : {};

  return Object.entries(expectedScripts).map(([scriptName, expectedTarget]) => {
    const actualCommand = typeof scripts[scriptName] === "string" ? scripts[scriptName] : null;
    const expectedNormalized = normalizeWhitespace(expectedTarget);
    const actualNormalized = normalizeWhitespace(actualCommand);
    const ok = !!actualCommand && actualNormalized.includes(expectedNormalized);
    return {
      scriptName,
      ok,
      detail: ok
        ? expectedTarget
        : actualCommand
          ? `expected target=${expectedTarget}; actual=${actualCommand}`
          : `missing script; expected target=${expectedTarget}`,
    };
  });
}

export function resolveInteractiveGotoTimeoutMs(url, options = {}) {
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_INTERACTIVE_GOTO_TIMEOUT_MS;
  const slowRouteTimeoutMs = options.slowRouteTimeoutMs ?? SLOW_ROUTE_INTERACTIVE_GOTO_TIMEOUT_MS;
  const patterns = options.slowRoutePatterns ?? slowInteractiveRoutePatterns;
  return patterns.some((pattern) => pattern.test(String(url ?? ""))) ? slowRouteTimeoutMs : defaultTimeoutMs;
}

export function resolveInteractiveWaitUntil(url, options = {}) {
  const defaultWaitUntil = options.defaultWaitUntil ?? "domcontentloaded";
  const commitReadyWaitUntil = options.commitReadyWaitUntil ?? "commit";
  const patterns = options.commitReadyRoutePatterns ?? commitReadyInteractiveRoutePatterns;
  return patterns.some((pattern) => pattern.test(String(url ?? ""))) ? commitReadyWaitUntil : defaultWaitUntil;
}

function addStaticCheck({ ok, name, plane = "static", detail = "", optional = false }) {
  staticChecks.push({ ok: !!ok, name, plane, detail, optional });
}

function addFinding({ severity = "warn", safety = "human-gated", plane = "static", title, path, detail = "", recommendation = "" }) {
  findings.push({
    id: `SN-${String(findings.length + 1).padStart(3, "0")}`,
    severity,
    safety,
    plane,
    title,
    path,
    detail,
    recommendation,
  });
}

function addLiveCheck(check) {
  liveChecks.push({
    ok: !!check.ok,
    name: check.name,
    url: check.url,
    status: check.status ?? null,
    durationMs: Math.round(check.durationMs ?? 0),
    detail: check.detail ?? "",
    optional: !!check.optional,
  });
}

function addInteractiveCheck(check) {
  interactiveChecks.push({
    ok: !!check.ok,
    name: check.name,
    url: check.url,
    durationMs: Math.round(check.durationMs ?? 0),
    detail: check.detail ?? "",
    optional: !!check.optional,
  });
}

function checkFile(relativePath, name = relativePath) {
  const ok = existsSync(resolve(repoRoot, relativePath));
  addStaticCheck({ ok, name: `required file: ${name}`, detail: relativePath });
  if (!ok) {
    addFinding({
      severity: "blocker",
      safety: "manual",
      title: `Missing required launch file: ${name}`,
      path: relativePath,
      recommendation: "Restore the missing file before treating the launch loop as green.",
    });
  }
}

function scanStaticContracts() {
  for (const [label, path] of Object.entries(launchContractFiles)) {
    checkFile(path, label);
  }

  const packageJson = readText("package.json");
  for (const scriptEvidence of summarizePackageScriptContractEvidence(packageJson)) {
    const { scriptName, ok, detail } = scriptEvidence;
    addStaticCheck({
      ok,
      name: `package exposes ${scriptName}`,
      plane: "goal-automation",
      detail,
    });
    if (!ok) {
      addFinding({
        severity: "blocker",
        safety: "auto",
        plane: "goal-automation",
        title: `package.json automation contract is missing or repointed for ${scriptName}`,
        path: "package.json",
        detail,
        recommendation: "Restore the automation script entry so it points at the expected local verification target.",
      });
    }
  }

  const homeV5 = readText(launchContractFiles.homeV5);
  const hasScratchNodeBrand = /ScratchNode/i.test(homeV5);
  addStaticCheck({
    ok: hasScratchNodeBrand,
    name: "home-v5 references ScratchNode branding",
    plane: "product-workflow",
    detail: hasScratchNodeBrand ? "ScratchNode found" : "ScratchNode missing",
  });

  const hasNodeBenchHandoff = /nodebenchai\.com\/scratchnode-events|Continue in NodeBench|buildNodeBenchEventPrivateUrl/i.test(homeV5);
  addStaticCheck({
    ok: hasNodeBenchHandoff,
    name: "home-v5 includes NodeBench handoff contract",
    plane: "nodebench-handoff",
    detail: hasNodeBenchHandoff ? "handoff strings present" : "handoff strings missing",
  });

  const hasPublicPrivateSignals = /private note|public wiki|Suggest for FAQ|Promote to FAQ/i.test(homeV5);
  addStaticCheck({
    ok: hasPublicPrivateSignals,
    name: "home-v5 surfaces public/private workflow cues",
    plane: "privacy",
    detail: hasPublicPrivateSignals ? "public/private cues present" : "workflow cues missing",
  });

  const boundaryGoal = readText(launchContractFiles.boundaryGoal);
  addStaticCheck({
    ok: /tests-only|boundary/i.test(boundaryGoal),
    name: "privacy boundary goal card is present for follow-up work",
    plane: "goal-automation",
    detail: launchContractFiles.boundaryGoal,
  });

  const goalLoop = readText(launchContractFiles.goalLoop);
  const missingGoalLoopEvidenceFields = goalLoopEvidenceFieldNames.filter((field) => !goalLoop.includes(field));
  const goalLoopEvidenceOk = missingGoalLoopEvidenceFields.length === 0;
  addStaticCheck({
    ok: goalLoopEvidenceOk,
    name: "goal loop reports branch and command evidence",
    plane: "goal-automation",
    detail: goalLoopEvidenceOk
      ? goalLoopEvidenceFieldNames.join(",")
      : `missing fields=${missingGoalLoopEvidenceFields.join(",")}`,
  });
  if (!goalLoopEvidenceOk) {
    addFinding({
      severity: "blocker",
      safety: "auto",
      plane: "goal-automation",
      title: "Goal loop report evidence is incomplete",
      path: launchContractFiles.goalLoop,
      detail: `missing fields=${missingGoalLoopEvidenceFields.join(",")}`,
      recommendation:
        "Restore branch-status, command-exit, and goal-card eligibility summary fields so clean-worktree reports keep actionable evidence.",
    });
  }

  const housekeepingRunbook = readText(launchContractFiles.housekeepingRunbook);
  const timeoutRunbookEvidence = [
    { label: "scratchnode:launch:goal", pattern: /scratchnode:launch:goal/ },
    { label: "240 second timeout", pattern: /240 second/i },
    { label: "slow command summaries", pattern: /slowCommandSummaries/ },
    { label: "housekeeping check isolation", pattern: /repo:housekeeping:check/ },
  ];
  const missingTimeoutRunbookEvidence = timeoutRunbookEvidence
    .filter((item) => !item.pattern.test(housekeepingRunbook))
    .map((item) => item.label);
  const timeoutRunbookOk = missingTimeoutRunbookEvidence.length === 0;
  addStaticCheck({
    ok: timeoutRunbookOk,
    name: "housekeeping runbook documents goal-loop timeout budget",
    plane: "goal-automation",
    detail: timeoutRunbookOk
      ? timeoutRunbookEvidence.map((item) => item.label).join(",")
      : `missing evidence=${missingTimeoutRunbookEvidence.join(",")}`,
  });
  if (!timeoutRunbookOk) {
    addFinding({
      severity: "blocker",
      safety: "auto",
      plane: "goal-automation",
      title: "Housekeeping runbook is missing goal-loop timeout guidance",
      path: launchContractFiles.housekeepingRunbook,
      detail: `missing evidence=${missingTimeoutRunbookEvidence.join(",")}`,
      recommendation:
        "Restore the operator note that healthy launch-goal runs can exceed short shell timeouts and should use the slow-command report fields for diagnosis.",
    });
  }

  const routeHonestySpec = readText(launchContractFiles.routeHonestySpec);
  const missingBoundaryGateIds = requiredBoundaryGateIds.filter((gateId) => !routeHonestySpec.includes(gateId));
  const missingBoundaryEvidence = requiredBoundaryEvidence
    .filter((item) => !item.pattern.test(routeHonestySpec))
    .map((item) => item.label);
  const boundaryGateCoverageOk = missingBoundaryGateIds.length === 0 && missingBoundaryEvidence.length === 0;
  addStaticCheck({
    ok: boundaryGateCoverageOk,
    name: "route honesty spec covers privacy boundary gates",
    plane: "privacy",
    detail: boundaryGateCoverageOk
      ? `gates=${requiredBoundaryGateIds.join(",")}`
      : `missing gates=${missingBoundaryGateIds.join(",") || "none"}; missing evidence=${missingBoundaryEvidence.join(",") || "none"}`,
  });
  if (!boundaryGateCoverageOk) {
    addFinding({
      severity: "blocker",
      safety: "auto",
      plane: "privacy",
      title: "Privacy boundary gate coverage is incomplete",
      path: launchContractFiles.routeHonestySpec,
      detail: `missing gates=${missingBoundaryGateIds.join(",") || "none"}; missing evidence=${missingBoundaryEvidence.join(",") || "none"}`,
      recommendation: "Restore the SN-LIVE-006..010 and SN-LIVE-012 route honesty gates before treating the public/private boundary as covered.",
    });
  }
}

async function runFetchCheck(name, url, validate) {
  const started = performance.now();
  try {
    const response = await fetch(url, { redirect: "follow" });
    const text = await response.text();
    const detail = validate(response, text);
    addLiveCheck({
      ok: response.ok && detail.ok,
      name,
      url,
      status: response.status,
      durationMs: performance.now() - started,
      detail: detail.detail,
    });
  } catch (error) {
    addLiveCheck({
      ok: false,
      name,
      url,
      durationMs: performance.now() - started,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runLiveChecks() {
  await runFetchCheck("scratchnode.live apex raw HTML", "https://scratchnode.live/", (response, text) => ({
    ok: /ScratchNode/i.test(text) && response.url.startsWith("https://scratchnode.live/"),
    detail: `finalUrl=${response.url}, bytes=${text.length}`,
  }));

  await runFetchCheck("scratchnode.live event route shell", "https://scratchnode.live/e/ai-infra-summit-2026", (response, text) => ({
    ok: /ScratchNode/i.test(text),
    detail: `finalUrl=${response.url}, bytes=${text.length}`,
  }));

  await runFetchCheck("scratchnode public config endpoint", "https://scratchnode.live/api/scratchnode-config", (response, text) => {
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const keys = parsed ? Object.keys(parsed).join(",") : "parse-failed";
    return {
      ok: !!parsed && keys.includes("convexUrl"),
      detail: `keys=${keys}`,
    };
  });

  await runFetchCheck("nodebenchai.com apex", "https://nodebenchai.com/", (response, text) => ({
    ok: /NodeBench/i.test(text),
    detail: `finalUrl=${response.url}, bytes=${text.length}`,
  }));

  await runFetchCheck("nodebenchai.com scratchnode-events route", "https://nodebenchai.com/scratchnode-events", (response, text) => ({
    ok: /NodeBench|ScratchNode/i.test(text),
    detail: `finalUrl=${response.url}, bytes=${text.length}`,
  }));
}

async function runInteractiveChecks() {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch (error) {
    addInteractiveCheck({
      ok: false,
      name: "playwright availability",
      url: "",
      detail: error instanceof Error ? error.message : String(error),
      optional: true,
    });
    return;
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();

  async function pageCheck(name, url, probe) {
    const started = performance.now();
    const page = await context.newPage();
    const gotoTimeoutMs = resolveInteractiveGotoTimeoutMs(url);
    const waitUntil = resolveInteractiveWaitUntil(url);
    try {
      await page.goto(url, { waitUntil, timeout: gotoTimeoutMs });
      const detail = await probe(page);
      addInteractiveCheck({
        ok: !!detail.ok,
        name,
        url,
        durationMs: performance.now() - started,
        detail: `${detail.detail}; waitUntil=${waitUntil}; gotoTimeoutMs=${gotoTimeoutMs}`,
      });
    } catch (error) {
      addInteractiveCheck({
        ok: false,
        name,
        url,
        durationMs: performance.now() - started,
        detail: `${error instanceof Error ? error.message : String(error)}; waitUntil=${waitUntil}; gotoTimeoutMs=${gotoTimeoutMs}`,
      });
    } finally {
      await page.close();
    }
  }

  await pageCheck("scratchnode apex interactive landing", "https://scratchnode.live/", async (page) => {
    await page.waitForSelector("body", { timeout: 15_000 });
    const data = await page.evaluate(() => ({
      title: document.title,
      pageMode: document.body.getAttribute("data-page-mode"),
      buttonCount: document.querySelectorAll("button").length,
    }));
    return {
      ok: /ScratchNode/i.test(data.title) && data.buttonCount > 0,
      detail: `title=${JSON.stringify(data.title)}, pageMode=${data.pageMode}, buttons=${data.buttonCount}`,
    };
  });

  await pageCheck("scratchnode event route interactive", "https://scratchnode.live/e/ai-infra-summit-2026", async (page) => {
    await page.waitForSelector("body", { timeout: 15_000 });
    const data = await page.evaluate(() => ({
      title: document.title,
      pageMode: document.body.getAttribute("data-page-mode"),
      hasAskHint: /\/ask/i.test(document.body.textContent ?? ""),
    }));
    return {
      ok: /ScratchNode/i.test(data.title) && data.hasAskHint,
      detail: JSON.stringify(data),
    };
  });

  await pageCheck("nodebench scratchnode-events interactive", "https://nodebenchai.com/scratchnode-events", async (page) => {
    await page.waitForSelector("body", { state: "attached", timeout: 15_000 });
    const data = await page.evaluate(() => ({
      title: document.title,
      hasRoot: !!document.querySelector("#root"),
      text: (document.body.textContent ?? "").slice(0, 400),
    }));
    return {
      ok: /NodeBench/i.test(data.title) && data.hasRoot,
      detail: `title=${JSON.stringify(data.title)}, hasRoot=${data.hasRoot}, text=${JSON.stringify(data.text)}`,
    };
  });

  await browser.close();
}

function summarizeRemoteProbeInfra() {
  const failedChecks = [...liveChecks, ...interactiveChecks].filter((check) => !check.ok);
  if (failedChecks.length === 0) return { networkAccessDenied: false };
  const denied = failedChecks.every((check) => /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ERR_NAME_NOT_RESOLVED|fetch failed|net::/i.test(check.detail));
  if (!denied) return { networkAccessDenied: false };
  return {
    networkAccessDenied: true,
    reason: "remote probes unavailable from this environment",
  };
}

function summarize() {
  const requiredStaticFailures = staticChecks.filter((check) => !check.ok && !check.optional);
  const blockerFindings = findings.filter((finding) => finding.severity === "blocker");
  const warnFindings = findings.filter((finding) => finding.severity === "warn");
  const remoteProbeInfra = summarizeRemoteProbeInfra();
  const liveFailures = remoteProbeInfra.networkAccessDenied ? [] : liveChecks.filter((check) => !check.ok && !check.optional);
  const interactiveFailures = remoteProbeInfra.networkAccessDenied ? [] : interactiveChecks.filter((check) => !check.ok && !check.optional);
  return {
    passed:
      requiredStaticFailures.length === 0 &&
      blockerFindings.length === 0 &&
      liveFailures.length === 0 &&
      interactiveFailures.length === 0,
    staticPassed: requiredStaticFailures.length === 0 && blockerFindings.length === 0,
    livePassed: liveFailures.length === 0,
    interactivePassed: interactiveFailures.length === 0,
    requiredStaticFailures: requiredStaticFailures.length,
    blockers: blockerFindings.length,
    warnings: warnFindings.length,
    liveFailures: liveFailures.length,
    interactiveFailures: interactiveFailures.length,
    rawLiveFailures: liveChecks.filter((check) => !check.ok && !check.optional).length,
    rawInteractiveFailures: interactiveChecks.filter((check) => !check.ok && !check.optional).length,
    remoteProbeInfra,
    staticChecks: staticChecks.length,
    liveChecks: liveChecks.length,
    interactiveChecks: interactiveChecks.length,
  };
}

async function main() {
  scanStaticContracts();
  if (shouldRunLive) await runLiveChecks();
  if (shouldRunInteractive) await runInteractiveChecks();

  const report = {
    generatedAt: new Date().toISOString(),
    repo: repoRoot,
    modes: {
      static: true,
      live: shouldRunLive,
      interactive: shouldRunInteractive,
    },
    summary: summarize(),
    findings,
    staticChecks,
    liveChecks,
    interactiveChecks,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  if (shouldPrintJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `ScratchNode launch scan: ${report.summary.passed ? "PASS" : "FAIL"} ` +
        `(blockers=${report.summary.blockers}, warnings=${report.summary.warnings}, ` +
        `liveFailures=${report.summary.liveFailures}, interactiveFailures=${report.summary.interactiveFailures})`,
    );
    console.log(`Report: ${outPath}`);
    if (report.summary.remoteProbeInfra?.networkAccessDenied) {
      console.log(`- [info/auto] remote probes suppressed: ${report.summary.remoteProbeInfra.reason}`);
    }
  }

  if (!report.summary.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
