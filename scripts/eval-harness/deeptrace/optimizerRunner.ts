/**
 * DeepTrace Autoresearch Optimizer — Evaluation Framework
 *
 * Provides the scoring, guard-checking, worktree management, and run-log
 * persistence layers for an offline DeepTrace optimization loop.
 *
 * This is an EVALUATION FRAMEWORK, not a fully autonomous optimizer.
 * Candidate mutation and metric proposals are delegated to an external
 * `proposeFn` callback. No current proposer supplies independent measurement.
 * The framework handles:
 *   - Worktree isolation (create / cleanup)
 *   - Allowlist enforcement (only DeepTrace-slice files may change)
 *   - Compile and test gating
 *   - Throughput scoring and quality guard evaluation
 *   - Unverified proposal / discard verdict (no promotion authority)
 *   - Durable run-log persistence and replay
 *
 * CLI entry points (via package.json):
 *   npm run deeptrace:autoresearch:baseline  — capture current baseline snapshot
 *   npm run deeptrace:autoresearch:optimize  — run evaluation loop with a proposeFn
 *   npm run deeptrace:autoresearch:replay    — replay a run log and print summary
 */

import { execSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { scoreCandidate, validateAllowlist } from "./optimizerScoring";
import {
  type BaselineSnapshot,
  type CandidateRun,
  type CostEntry,
  DEFAULT_OPTIMIZER_CONFIG,
  type OptimizerConfig,
  type OptimizerRunLog,
  type QualityMetrics,
  summarizeCosts,
  type ThroughputMetrics,
} from "./optimizerTypes";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CURRENT_FILE = fileURLToPath(import.meta.url);
const CURRENT_DIR = path.dirname(CURRENT_FILE);
const RUN_LOG_DIR = path.join(CURRENT_DIR, "run-logs");
const BASELINE_DIR = path.join(CURRENT_DIR, "baseline-snapshots");
const CANARY_SPEC_PATH = path.join(CURRENT_DIR, "canary-benchmark-spec.json");

// Root of the host repository (3 levels up from scripts/eval-harness/deeptrace/)
const REPO_ROOT = path.resolve(CURRENT_DIR, "..", "..", "..");
// Use the host repo's tsc binary so worktrees (which have no node_modules) can
// be type-checked without a separate npm install step.
const TSC_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "tsc");
const VITEST_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "vitest");

// ---------------------------------------------------------------------------
// Baseline capture
// ---------------------------------------------------------------------------

export function captureBaseline(
  throughputMetrics: ThroughputMetrics,
  qualityMetrics: QualityMetrics,
): BaselineSnapshot {
  const commitHash = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  return {
    baselineId: `baseline-${commitHash.slice(0, 8)}-${Date.now()}`,
    commitHash,
    throughputMetrics: readThroughputMetrics(throughputMetrics, "baseline.throughputMetrics"),
    qualityMetrics: readQualityMetrics(qualityMetrics, "baseline.qualityMetrics"),
    evidenceStatus: "unverified",
    capturedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Worktree management
// ---------------------------------------------------------------------------

export function createWorktree(candidateId: string): string {
  const worktreePath = path.join(
    process.env.TEMP ?? "/tmp",
    `deeptrace-optimizer-${candidateId}`,
  );
  execSync(`git worktree add "${worktreePath}" HEAD --detach`, {
    encoding: "utf-8",
    stdio: "pipe",
  });
  // Hard-reset the fresh worktree to HEAD so that CRLF-normalization artefacts
  // introduced during `git worktree add` on Windows do not appear as mutations
  // when the allowlist checker later runs `git diff --name-only HEAD`.
  try {
    execSync(`git -C "${worktreePath}" reset --hard HEAD`, {
      encoding: "utf-8",
      stdio: "pipe",
    });
  } catch {
    // Best-effort: proceed even if the reset fails
  }
  return worktreePath;
}

export function removeWorktree(worktreePath: string): void {
  try {
    execSync(`git worktree remove "${worktreePath}" --force`, {
      encoding: "utf-8",
      stdio: "pipe",
    });
  } catch {
    // Best-effort cleanup — worktree may already be gone
  }
}

// ---------------------------------------------------------------------------
// Compile & test verification
// ---------------------------------------------------------------------------

// Environment overlay that makes the host repo's node_modules resolvable from
// any worktree path (worktrees have no node_modules of their own).
const WORKTREE_ENV = {
  ...process.env,
  NODE_PATH: path.join(REPO_ROOT, "node_modules"),
};

export function runCompileCheck(cwd: string): boolean {
  try {
    // Use the host repo's tsc binary + NODE_PATH so that worktrees can be
    // type-checked without a separate npm install step.
    execSync(`"${TSC_BIN}" --noEmit`, {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 120_000,
      env: WORKTREE_ENV,
    });
    return true;
  } catch {
    return false;
  }
}

/** Last test-check failure detail, exposed for diagnostics / logging. */
export let lastTestCheckError: string | null = null;

export function runTestCheck(cwd: string): boolean {
  lastTestCheckError = null;
  try {
    // Run vitest from the HOST repo root (where node_modules lives) but tell
    // it to resolve test files relative to the worktree via --root.
    // This avoids vitest failing at startup because the worktree has no
    // node_modules, no vitest.config, and no installed dependencies.
    //
    // We scope the run to DeepTrace-slice tests only — the optimizer should
    // not gate on unrelated test failures elsewhere in the monorepo.
    const vitestConfigPath = path.join(REPO_ROOT, "vitest.config.ts");
    const configFlag = fs.existsSync(vitestConfigPath)
      ? `--config "${vitestConfigPath}"`
      : "";

    // Scope test run to DeepTrace-slice files only. Vitest CLI positional
    // args are treated as **name/path filters** that match against resolved
    // test file paths, so we pass directory prefixes rather than shell globs.
    const testFilters = [
      "convex/domains/deepTrace",
      "scripts/eval-harness/deeptrace",
    ].join(" ");

    execSync(
      `"${VITEST_BIN}" run ${configFlag} --reporter=json ${testFilters}`,
      {
        // Run from the worktree so that source imports resolve to the
        // candidate's mutated files, not the host repo's originals.
        cwd,
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 300_000,
        env: {
          ...WORKTREE_ENV,
          // Ensure vitest can find its own dependencies
          VITEST_POOL_WORKERS_MAX: "2",
        },
      },
    );
    return true;
  } catch (err: unknown) {
    // Capture the actual error for diagnostics
    if (err && typeof err === "object") {
      const execErr = err as { stderr?: string; stdout?: string; message?: string };
      const parts: string[] = [];
      if (execErr.stderr) parts.push(`stderr: ${execErr.stderr.slice(0, 2000)}`);
      if (execErr.stdout) parts.push(`stdout: ${execErr.stdout.slice(0, 2000)}`);
      if (parts.length === 0 && execErr.message) parts.push(execErr.message.slice(0, 2000));
      lastTestCheckError = parts.join("\n---\n") || "Unknown vitest failure";
    } else {
      lastTestCheckError = String(err).slice(0, 2000);
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Changed-file detection in worktree
// ---------------------------------------------------------------------------

export function getChangedFiles(cwd: string): string[] {
  try {
    // --ignore-cr-at-eol suppresses false positives caused by CRLF normalisation
    // on Windows when git worktree add re-checks-out files with different line
    // endings than the stored objects.  Real content mutations still show up.
    const output = execSync("git diff --name-only --ignore-cr-at-eol HEAD", {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
    });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Run log persistence
// ---------------------------------------------------------------------------

function ensureRunLogDir(): void {
  if (!fs.existsSync(RUN_LOG_DIR)) {
    fs.mkdirSync(RUN_LOG_DIR, { recursive: true });
  }
}

function ensureBaselineDir(): void {
  if (!fs.existsSync(BASELINE_DIR)) {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
  }
}

export function persistRunLog(log: OptimizerRunLog): string {
  ensureRunLogDir();
  const filePath = path.join(RUN_LOG_DIR, `${log.sessionId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(log, null, 2));
  return filePath;
}

export function persistBaselineSnapshot(snapshot: BaselineSnapshot, filePath?: string): string {
  ensureBaselineDir();
  const resolvedPath = filePath ?? path.join(BASELINE_DIR, `${snapshot.baselineId}.json`);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, JSON.stringify(snapshot, null, 2));
  return resolvedPath;
}

export function loadRunLog(sessionId: string): OptimizerRunLog | null {
  const filePath = path.join(RUN_LOG_DIR, `${sessionId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as OptimizerRunLog;
}

export function loadBaselineSnapshot(filePath: string): BaselineSnapshot {
  return readBaselineSnapshot(readJsonFile(filePath));
}

function readBaselineSnapshot(raw: unknown): BaselineSnapshot {
  if (!isRecord(raw)) {
    throw new Error("Baseline snapshot must be a JSON object.");
  }
  return {
    baselineId: readStringField(raw, "baselineId", "baseline"),
    commitHash: readStringField(raw, "commitHash", "baseline"),
    throughputMetrics: readThroughputMetrics(raw.throughputMetrics, "baseline.throughputMetrics"),
    qualityMetrics: readQualityMetrics(raw.qualityMetrics, "baseline.qualityMetrics"),
    evidenceStatus: "unverified",
    capturedAt: readStringField(raw, "capturedAt", "baseline"),
  };
}

export function listRunLogs(): string[] {
  ensureRunLogDir();
  return fs
    .readdirSync(RUN_LOG_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}

// ---------------------------------------------------------------------------
// Single optimizer iteration
// ---------------------------------------------------------------------------

export interface IterationResult {
  candidate: CandidateRun;
  worktreePath: string;
}

export interface OptimizerProposal {
  candidateId: string;
  throughput: ThroughputMetrics;
  quality: QualityMetrics;
  /** LLM reasoning trace — what was proposed and why */
  rationale?: string;
  /** Cost entries from LLM calls made during proposal generation */
  costEntries?: CostEntry[];
}

export type OptimizerProposeFn = (
  worktreePath: string,
  baseline: BaselineSnapshot,
  iteration: number,
) => Promise<OptimizerProposal | null>;

/**
 * Run a single optimizer iteration.
 *
 * The caller is responsible for:
 *   1. Applying a candidate change in the worktree (between createWorktree and this call)
 *   2. Providing proposed throughput/quality metrics for the candidate
 *
 * This function handles validation → allowlist → compile → test → diagnostics.
 * Supplied metrics cannot certify themselves, regardless of caller provenance.
 */
export function evaluateCandidate(
  candidateId: string,
  baselineSnapshot: BaselineSnapshot,
  worktreePath: string,
  candidateThroughput: ThroughputMetrics,
  candidateQuality: QualityMetrics,
  benchmarkCaseIds: string[],
  allowlist?: readonly string[],
  preExistingDirtyFiles?: ReadonlySet<string>,
): CandidateRun {
  const startMs = Date.now();
  baselineSnapshot = readBaselineSnapshot(baselineSnapshot);
  candidateThroughput = readThroughputMetrics(candidateThroughput, "candidate.throughput");
  candidateQuality = readQualityMetrics(candidateQuality, "candidate.quality");
  const allChangedFiles = getChangedFiles(worktreePath);
  // Subtract files that were already dirty before the proposer ran (e.g. due
  // to CRLF normalisation on Windows worktree checkout).  Only count files the
  // proposer actually mutated.
  const changedFiles = preExistingDirtyFiles
    ? allChangedFiles.filter((f) => !preExistingDirtyFiles.has(f))
    : allChangedFiles;

  // 1. Allowlist enforcement
  const violations = validateAllowlist(changedFiles, allowlist);
  if (violations.length > 0) {
    return buildDiscardedRun(candidateId, baselineSnapshot.baselineId, benchmarkCaseIds, changedFiles, startMs, {
      throughputScore: 0,
      qualityMetrics: candidateQuality,
      guardsPass: false,
      guardFailures: [`Allowlist violation: ${violations.join(", ")}`],
    }, `Candidate mutated disallowed files: ${violations.join(", ")}`);
  }

  // 2. Compile & test checks — only needed when the proposer actually mutated
  //    files. A metrics-only proposer (changedFiles.length === 0) produces no
  //    code changes, so these checks are skipped rather than reported as passes.
  let compileSuccess: boolean | null = null;
  let testSuccess: boolean | null = null;

  if (changedFiles.length > 0) {
    // 2a. Compile check
    compileSuccess = runCompileCheck(worktreePath);
    if (!compileSuccess) {
      return buildDiscardedRun(candidateId, baselineSnapshot.baselineId, benchmarkCaseIds, changedFiles, startMs, {
        throughputScore: 0,
        qualityMetrics: candidateQuality,
        guardsPass: false,
        guardFailures: ["Compile failed"],
      }, "TypeScript compilation failed", false, null);
    }

    // 2b. Test check
    testSuccess = runTestCheck(worktreePath);
    if (!testSuccess) {
      return buildDiscardedRun(candidateId, baselineSnapshot.baselineId, benchmarkCaseIds, changedFiles, startMs, {
        throughputScore: 0,
        qualityMetrics: candidateQuality,
        guardsPass: false,
        guardFailures: ["Tests failed"],
      }, `Vitest test suite failed${lastTestCheckError ? `: ${lastTestCheckError.slice(0, 500)}` : ""}`, true, false);
    }
  }

  // Scoring is diagnostic. No current proposal source is independent evidence.
  const score = scoreCandidate(candidateThroughput, candidateQuality, baselineSnapshot);

  return {
    candidateId,
    baselineId: baselineSnapshot.baselineId,
    benchmarkCaseIds,
    changedFiles,
    compileSuccess,
    testSuccess,
    evidenceStatus: "unverified",
    releaseEligible: false,
    score,
    verdict: "proposal-only",
    rejectionReason: "Proposer metrics are unverified; independent measurement is required for promotion.",
    timestamp: new Date().toISOString(),
    iterationMs: Date.now() - startMs,
  };
}

// ---------------------------------------------------------------------------
// Full optimizer session
// ---------------------------------------------------------------------------

/**
 * Run the complete optimizer loop.
 *
 * `proposeFn` is an async callback that:
 *   1. Receives the worktree path and an isolated copy of the accepted baseline
 *   2. Applies a candidate mutation to the worktree
 *   3. Returns proposed throughput + quality metrics
 *
 * Proposals remain unverified; this loop does not advance the accepted baseline.
 */
export async function runOptimizerSession(
  baseline: BaselineSnapshot,
  config: OptimizerConfig = DEFAULT_OPTIMIZER_CONFIG,
  proposeFn: OptimizerProposeFn,
): Promise<OptimizerRunLog> {
  // Snapshot before the first await; callbacks must never retain an alias to it.
  baseline = structuredClone(readBaselineSnapshot(baseline));
  const sessionId = `opt-${crypto.randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const candidates: CandidateRun[] = [];
  const allCostEntries: CostEntry[] = [];
  const sessionDeadline = Date.now() + config.maxSessionSeconds * 1000;

  for (let i = 0; i < config.maxIterations; i++) {
    if (Date.now() > sessionDeadline) break;

    const candidateId = `${sessionId}-iter${i}`;
    const worktreePath = createWorktree(candidateId);

    // Snapshot files that are already dirty right after worktree creation
    // (e.g. CRLF normalisation artefacts on Windows).  These must not be
    // counted as proposer mutations during the allowlist check.
    const preExistingDirtyFiles = new Set(getChangedFiles(worktreePath));

    try {
      const proposal = await proposeFn(worktreePath, structuredClone(baseline), i);
      if (!proposal) {
        // proposeFn signals no more candidates to try
        break;
      }

      const run = evaluateCandidate(
        proposal.candidateId,
        baseline,
        worktreePath,
        proposal.throughput,
        proposal.quality,
        config.benchmarkFamilies,
        config.allowlist,
        preExistingDirtyFiles,
      );

      // Attach cost entries and rationale from the proposer
      if (proposal.costEntries) {
        run.costEntries = proposal.costEntries;
        allCostEntries.push(...proposal.costEntries);
      }
      if (proposal.rationale) {
        run.proposerRationale = proposal.rationale;
      }

      candidates.push(run);

    } finally {
      removeWorktree(worktreePath);
    }
  }

  const log: OptimizerRunLog = {
    sessionId,
    config,
    baseline,
    candidates,
    promotedCandidateId: null,
    costEntries: allCostEntries,
    costSummary: summarizeCosts(allCostEntries),
    startedAt,
    completedAt: new Date().toISOString(),
  };

  persistRunLog(log);
  return log;
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export function replayRunLog(sessionId: string): {
  log: OptimizerRunLog;
  summary: string;
} | null {
  const log = loadRunLog(sessionId);
  if (!log) return null;

  const promoted = log.candidates.filter((c) => c.verdict === "promoted");
  const discarded = log.candidates.filter((c) => c.verdict === "discarded");

  const costInfo = log.costSummary
    ? [
        "",
        "--- Cost Summary ---",
        `Total LLM calls: ${log.costSummary.callCount}`,
        `Total tokens: ${log.costSummary.totalInputTokens.toLocaleString()} in / ${log.costSummary.totalOutputTokens.toLocaleString()} out`,
        `Total cost: $${log.costSummary.totalCostUsd.toFixed(4)}`,
        ...Object.entries(log.costSummary.costByModel).map(
          ([model, cost]) => `  ${model}: $${cost.toFixed(4)}`,
        ),
        ...Object.entries(log.costSummary.costByPhase).map(
          ([phase, cost]) => `  ${phase}: $${cost.toFixed(4)}`,
        ),
      ]
    : [];

  const summary = [
    `Session: ${log.sessionId}`,
    `Started: ${log.startedAt}`,
    `Completed: ${log.completedAt}`,
    `Total candidates: ${log.candidates.length}`,
    "Evidence: supplied baseline and proposal metrics are unverified; release eligible: false",
    "Verified promotions: 0",
    `Recorded promotions (legacy, unverified): ${promoted.length}`,
    `Proposal-only: ${log.candidates.filter((c) => c.verdict === "proposal-only").length}`,
    `Discarded: ${discarded.length}`,
    `Recorded final promoted ID (unverified): ${log.promotedCandidateId ?? "none"}`,
    "",
    ...log.candidates.map((c, i) => {
      const status = c.verdict === "promoted" ? "RECORDED PROMOTION (legacy, unverified)"
        : c.verdict === "proposal-only" ? "PROPOSAL ONLY (unverified)" : "DISCARDED (unverified metrics)";
      const costTag = c.costEntries?.length
        ? ` [$${c.costEntries.reduce((s, e) => s + e.costUsd, 0).toFixed(4)}]`
        : "";
      const rationale = c.proposerRationale
        ? `\n      rationale: ${c.proposerRationale.slice(0, 120)}${c.proposerRationale.length > 120 ? "..." : ""}`
        : "";
      return `  [${i}] ${c.candidateId} — ${status} (diagnostic throughput=${c.score.throughputScore.toFixed(3)}, diagnostic guards=${c.score.guardsPass ? "PASS" : "FAIL"})${costTag}${c.rejectionReason ? ` — ${c.rejectionReason}` : ""}${rationale}`;
    }),
    ...costInfo,
  ].join("\n");

  return { log, summary };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDiscardedRun(
  candidateId: string,
  baselineId: string,
  benchmarkCaseIds: string[],
  changedFiles: string[],
  startMs: number,
  score: CandidateRun["score"],
  rejectionReason: string,
  compileSuccess: boolean | null = null,
  testSuccess: boolean | null = null,
): CandidateRun {
  return {
    candidateId,
    baselineId,
    benchmarkCaseIds,
    changedFiles,
    compileSuccess,
    testSuccess,
    evidenceStatus: "unverified",
    releaseEligible: false,
    score,
    verdict: "discarded",
    rejectionReason,
    timestamp: new Date().toISOString(),
    iterationMs: Date.now() - startMs,
  };
}

// ---------------------------------------------------------------------------
// CLI dispatch — invoked via package.json scripts
// ---------------------------------------------------------------------------

const CLI_COMMANDS = ["baseline", "optimize", "replay"] as const;

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePathForCompare(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function resolveCliPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function readNumberField(record: Record<string, unknown>, key: string, label: string, min = 0, max = Infinity): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected ${label}.${key} to be a finite number.`);
  }
  if (value < min || value > max) {
    throw new Error(`Expected ${label}.${key} to be between ${min} and ${max}.`);
  }
  return value;
}

function readStringField(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected ${label}.${key} to be a non-empty string.`);
  }
  return value;
}

function readThroughputMetrics(value: unknown, label: string): ThroughputMetrics {
  if (!isRecord(value)) {
    throw new Error(`Expected ${label} to be an object.`);
  }
  return {
    taskCompletionRate: readNumberField(value, "taskCompletionRate", label, 0, 1),
    timeToFirstDraftMs: readNumberField(value, "timeToFirstDraftMs", label),
    humanEditDistance: readNumberField(value, "humanEditDistance", label),
    wallClockMs: readNumberField(value, "wallClockMs", label),
    toolCallCount: readNumberField(value, "toolCallCount", label),
  };
}

function readQualityMetrics(value: unknown, label: string): QualityMetrics {
  if (!isRecord(value)) {
    throw new Error(`Expected ${label} to be an object.`);
  }
  return {
    factualPrecision: readNumberField(value, "factualPrecision", label, 0, 1),
    relationshipPrecision: readNumberField(value, "relationshipPrecision", label, 0, 1),
    evidenceLinkage: readNumberField(value, "evidenceLinkage", label, 0, 1),
    receiptCompleteness: readNumberField(value, "receiptCompleteness", label, 0, 1),
    falseConfidenceRate: readNumberField(value, "falseConfidenceRate", label, 0, 1),
    canaryRelativeUplift: readNumberField(value, "canaryRelativeUplift", label, -Infinity),
  };
}

function extractMetricsDocument(value: unknown): {
  throughput: ThroughputMetrics;
  quality: QualityMetrics;
} {
  if (!isRecord(value)) {
    throw new Error("Metrics document must be a JSON object.");
  }

  const throughputSource = isRecord(value.throughputMetrics)
    ? value.throughputMetrics
    : isRecord(value.throughput)
      ? value.throughput
      : value;
  const qualitySource = isRecord(value.qualityMetrics)
    ? value.qualityMetrics
    : isRecord(value.quality)
      ? value.quality
      : value;

  return {
    throughput: readThroughputMetrics(throughputSource, "metrics.throughput"),
    quality: readQualityMetrics(qualitySource, "metrics.quality"),
  };
}

function loadOptimizerConfig(filePath: string): OptimizerConfig {
  const raw = readJsonFile(filePath);
  if (!isRecord(raw)) {
    throw new Error("Optimizer config must be a JSON object.");
  }

  return {
    maxIterations:
      typeof raw.maxIterations === "number" && Number.isFinite(raw.maxIterations)
        ? raw.maxIterations
        : DEFAULT_OPTIMIZER_CONFIG.maxIterations,
    maxSessionSeconds:
      typeof raw.maxSessionSeconds === "number" && Number.isFinite(raw.maxSessionSeconds)
        ? raw.maxSessionSeconds
        : DEFAULT_OPTIMIZER_CONFIG.maxSessionSeconds,
    benchmarkFamilies: Array.isArray(raw.benchmarkFamilies)
      ? raw.benchmarkFamilies.map((value) => String(value))
      : DEFAULT_OPTIMIZER_CONFIG.benchmarkFamilies,
    allowlist: Array.isArray(raw.allowlist)
      ? raw.allowlist.map((value) => String(value))
      : DEFAULT_OPTIMIZER_CONFIG.allowlist,
  };
}

async function loadProposeFn(modulePath: string): Promise<OptimizerProposeFn> {
  const moduleUrl = pathToFileURL(resolveCliPath(modulePath)).href;
  const loaded = (await import(moduleUrl)) as Record<string, unknown>;
  const proposeFn = loaded.default ?? loaded.propose ?? loaded.proposeCandidate;
  if (typeof proposeFn !== "function") {
    throw new Error(
      "Proposer module must export a function as default, `propose`, or `proposeCandidate`.",
    );
  }
  return proposeFn as OptimizerProposeFn;
}

function isExecutedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return normalizePathForCompare(entry) === normalizePathForCompare(CURRENT_FILE);
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  tsx optimizerRunner.ts baseline --metrics <metrics.json> [--out <baseline.json>]");
  console.log("  tsx optimizerRunner.ts optimize --baseline <baseline.json> --proposer <module.ts> [--config <config.json>]");
  console.log("  tsx optimizerRunner.ts replay <sessionId>");
  console.log("");
  console.log(`Canary spec: ${CANARY_SPEC_PATH}`);
  console.log(`Baseline snapshots: ${BASELINE_DIR}`);
  console.log(`Run logs: ${RUN_LOG_DIR}`);
  console.log(`Available run logs: ${listRunLogs().join(", ") || "(none)"}`);
}

async function main() {
  const command = process.argv[2] as (typeof CLI_COMMANDS)[number] | undefined;

  if (!command || !CLI_COMMANDS.includes(command)) {
    printUsage();
    process.exit(1);
  }

  switch (command) {
    case "baseline": {
      const metricsPath = getArg("--metrics");
      if (!metricsPath) {
        console.error("Missing required flag: --metrics <metrics.json>");
        printUsage();
        process.exit(1);
      }

      const outPath = getArg("--out");
      const metrics = extractMetricsDocument(readJsonFile(resolveCliPath(metricsPath)));
      const snapshot = captureBaseline(metrics.throughput, metrics.quality);
      const outputPath = persistBaselineSnapshot(
        snapshot,
        outPath ? resolveCliPath(outPath) : undefined,
      );

      console.log(`Captured supplied baseline ${snapshot.baselineId} (unverified metrics)`);
      console.log(`Commit: ${snapshot.commitHash}`);
      console.log(`Saved baseline snapshot: ${outputPath}`);
      console.log(JSON.stringify(snapshot, null, 2));
      break;
    }

    case "optimize": {
      const baselinePath = getArg("--baseline");
      const proposerPath = getArg("--proposer");
      if (!baselinePath || !proposerPath) {
        console.error("Missing required flags: --baseline <baseline.json> and --proposer <module.ts>");
        printUsage();
        process.exit(1);
      }

      const configPath = getArg("--config");
      const baseline = loadBaselineSnapshot(resolveCliPath(baselinePath));
      const config = configPath
        ? loadOptimizerConfig(resolveCliPath(configPath))
        : DEFAULT_OPTIMIZER_CONFIG;
      const proposeFn = await loadProposeFn(proposerPath);
      const log = await runOptimizerSession(baseline, config, proposeFn);
      const replay = replayRunLog(log.sessionId);

      console.log(`Optimizer session complete: ${log.sessionId}`);
      console.log(`Persisted run log: ${path.join(RUN_LOG_DIR, `${log.sessionId}.json`)}`);
      console.log("Accepted baseline unchanged; proposer metrics are unverified.");
      if (replay) {
        console.log("");
        console.log(replay.summary);
      }
      break;
    }

    case "replay": {
      const sessionId = process.argv[3] ?? getArg("--session");
      if (!sessionId) {
        printUsage();
        process.exit(1);
      }
      const result = replayRunLog(sessionId);
      if (!result) {
        console.error(`Run log not found: ${sessionId}`);
        process.exit(1);
      }
      console.log(result.summary);
      break;
    }
  }
}

// Only run CLI when executed directly (not imported)
if (isExecutedDirectly()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
