#!/usr/bin/env npx tsx
/**
 * Eval Harness Runner — Executes tasks in bare vs MCP modes and generates comparison reports.
 *
 * Usage:
 *   npx tsx scripts/eval-harness/runner.ts --task t1_add_validator_returns --mode bare
 *   npx tsx scripts/eval-harness/runner.ts --task t1_add_validator_returns --mode mcp_core
 *   npx tsx scripts/eval-harness/runner.ts --tier tier1 --seeds 3
 *   npx tsx scripts/eval-harness/runner.ts --compare t1_add_validator_returns
 *
 * The backend comes from EVAL_BACKEND (default "stub", $0). A real backend
 * requires EVAL_MODEL, so every run names its candidate:
 *   EVAL_BACKEND=anthropic EVAL_MODEL=<candidate> npx tsx scripts/eval-harness/runner.ts --tier tier1 --seeds 3
 *
 * Outputs: scripts/eval-harness/results/<taskId>_<mode>_s<seed>.json
 */

import { writeFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { EVAL_DATASET, getTaskById } from "./dataset.js";
import { detectBackend, invokeAgent } from "./agentInvoker.js";
import type {
  RunConfig,
  RunTelemetry,
  Scorecard,
  ComparisonReport,
  AgentMode,
  EvalTask,
} from "./types.js";

const RESULTS_DIR = join(import.meta.dirname || __dirname, "results");

function ensureResultsDir(resultsDir: string) {
  mkdirSync(resultsDir, { recursive: true });
}

// ── Scorecard Computation ───────────────────────────────────────────

function computeCompositeScore(scorecard: Scorecard): number {
  const weights = {
    correctness: 0.40,
    safety: 0.20,
    efficiency: 0.25,
    compounding: 0.15,
  };

  const correctnessScore =
    scorecard.correctness.taskSuccessRate * 0.7 +
    (1 - scorecard.correctness.regressionRate) * 0.3;

  const safetyScore =
    scorecard.safety.highRiskActionsGated * 0.6 +
    Math.min(scorecard.safety.issuesCaughtPreMerge / 5, 1) * 0.4;

  // Efficiency: normalize — lower is better for wall clock, tool calls, tokens
  const efficiencyScore =
    (1 - scorecard.efficiency.retryThrashRate) * 0.4 +
    Math.min(1, 60000 / Math.max(scorecard.efficiency.wallClockMs, 1)) * 0.3 +
    Math.min(1, 20 / Math.max(scorecard.efficiency.toolCallCount, 1)) * 0.3;

  const compoundingScore =
    scorecard.compounding.knowledgeReuseRate * 0.5 +
    Math.min(scorecard.compounding.evalCasesBanked / 3, 1) * 0.5;

  return (
    correctnessScore * weights.correctness +
    safetyScore * weights.safety +
    efficiencyScore * weights.efficiency +
    compoundingScore * weights.compounding
  );
}

// ── Comparison Engine ───────────────────────────────────────────────

function loadResults(taskId: string, resultsDir: string): RunTelemetry[] {
  ensureResultsDir(resultsDir);
  const files = readdirSync(resultsDir).filter(
    (f) => f.startsWith(taskId) && f.endsWith(".json")
  );
  return files.map((f) => {
    const content = readFileSync(join(resultsDir, f), "utf-8");
    return JSON.parse(content) as RunTelemetry;
  });
}

function generateComparison(taskId: string, resultsDir: string): ComparisonReport | null {
  const task = getTaskById(taskId);
  if (!task) return null;

  const allResults = loadResults(taskId, resultsDir);
  if (allResults.length === 0) return null;

  const modes = [...new Set(allResults.map((r) => r.config.agentMode))];
  const results: ComparisonReport["results"] = {} as any;

  for (const mode of modes) {
    const modeResults = allResults.filter((r) => r.config.agentMode === mode);
    const scores = modeResults.map((r) => computeCompositeScore(r.scorecard));

    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance =
      scores.reduce((acc, s) => acc + (s - mean) ** 2, 0) / scores.length;
    const sorted = [...scores].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? sorted[0];

    results[mode] = {
      meanScore: mean,
      variance,
      p10Score: p10,
      meanWallClockMs:
        modeResults.reduce((a, r) => a + r.scorecard.efficiency.wallClockMs, 0) / modeResults.length,
      meanToolCalls:
        modeResults.reduce((a, r) => a + r.scorecard.efficiency.toolCallCount, 0) / modeResults.length,
      meanTokens:
        modeResults.reduce((a, r) => a + r.scorecard.efficiency.tokenCount, 0) / modeResults.length,
      successRate:
        modeResults.reduce((a, r) => a + r.scorecard.correctness.taskSuccessRate, 0) / modeResults.length,
      regressionRate:
        modeResults.reduce((a, r) => a + r.scorecard.correctness.regressionRate, 0) / modeResults.length,
    };
  }

  // Determine recommendation
  const bareScore = results["bare"]?.meanScore ?? 0;
  const mcpScores = modes
    .filter((m) => m !== "bare")
    .map((m) => ({ mode: m, score: results[m]?.meanScore ?? 0 }));
  const bestMcp = mcpScores.sort((a, b) => b.score - a.score)[0];

  let recommendation: ComparisonReport["recommendation"] = "inconclusive";
  let rationale = "";

  if (bestMcp && bareScore > 0) {
    const delta = bestMcp.score - bareScore;
    if (delta > 0.05) {
      recommendation = "mcp_wins";
      rationale = `MCP (${bestMcp.mode}) outperforms bare by ${(delta * 100).toFixed(1)}% composite score.`;
    } else if (delta < -0.05) {
      recommendation = "bare_wins";
      rationale = `Bare agent outperforms best MCP mode (${bestMcp.mode}) by ${(Math.abs(delta) * 100).toFixed(1)}%.`;
    } else {
      recommendation = "inconclusive";
      rationale = `Difference is within 5% margin (delta=${(delta * 100).toFixed(1)}%). Need more trials.`;
    }
  }

  return {
    taskId,
    taskName: task.name,
    configs: modes,
    trialsPerConfig: Math.min(...modes.map((m) => allResults.filter((r) => r.config.agentMode === m).length)),
    results,
    recommendation,
    rationale,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────

async function runOne(
  task: EvalTask,
  mode: AgentMode,
  seed: number,
  model: string,
  resultsDir: string,
): Promise<void> {
  const config: RunConfig = {
    taskId: task.id,
    agentMode: mode,
    model,
    seed,
    timeout: 300_000,
  };

  console.log(`Running: ${task.name} (${mode}, seed=${seed}, model=${model})`);
  const telemetry = await invokeAgent(config, task);

  const outPath = join(resultsDir, `${task.id}_${mode}_s${seed}.json`);
  writeFileSync(outPath, JSON.stringify(telemetry, null, 2));
  console.log(`Result written to: ${outPath}`);
  console.log(`Composite score: ${computeCompositeScore(telemetry.scorecard).toFixed(3)}`);
}

/** Returns the process exit code. `resultsDir` is a parameter so tests can use a temp dir. */
export async function main(args: string[], resultsDir: string = RESULTS_DIR): Promise<number> {
  ensureResultsDir(resultsDir);

  if (args.includes("--list")) {
    console.log("Available eval tasks:");
    for (const task of EVAL_DATASET.tasks) {
      console.log(`  ${task.id} [${task.tier}] ${task.name}`);
    }
    return 0;
  }

  if (args.includes("--compare")) {
    const taskIdIdx = args.indexOf("--compare") + 1;
    const taskId = args[taskIdIdx];
    if (!taskId) {
      console.error("Usage: --compare <taskId>");
      return 1;
    }
    const report = generateComparison(taskId, resultsDir);
    if (!report) {
      console.error(`No results found for task ${taskId}`);
      return 1;
    }
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  const taskIdx = args.indexOf("--task");
  const tierIdx = args.indexOf("--tier");
  const modeIdx = args.indexOf("--mode");
  const seedIdx = args.indexOf("--seed");
  const seedsIdx = args.indexOf("--seeds");

  if (taskIdx === -1 && tierIdx === -1) {
    console.log("Usage:");
    console.log("  --list                          List all tasks");
    console.log("  --task <id> --mode <mode>        Run a single task");
    console.log("  --tier <prefix> --seeds <N>      Run every task whose tier starts with <prefix>, seeds 1..N");
    console.log("  --compare <id>                  Compare results for a task");
    console.log("");
    console.log("Modes: bare, mcp_lite, mcp_core, mcp_full");
    console.log("Backend: EVAL_BACKEND=stub|anthropic|openai (default stub); EVAL_MODEL is required for a real backend");
    return 0;
  }

  // The candidate id comes from the environment, never from this file, so a
  // receipt can only name the model that was actually requested.
  const backend = detectBackend();
  if (backend.backend !== "stub" && !process.env.EVAL_MODEL) {
    console.error(`EVAL_MODEL is required when EVAL_BACKEND=${backend.backend}`);
    return 1;
  }
  const model = backend.model ?? "stub-model";
  const mode = (modeIdx !== -1 ? args[modeIdx + 1] : "bare") as AgentMode;

  let tasks: EvalTask[];
  if (tierIdx !== -1) {
    const prefix = args[tierIdx + 1];
    if (!prefix) {
      console.error("Usage: --tier <prefix>");
      return 1;
    }
    tasks = EVAL_DATASET.tasks.filter((t) => t.tier.startsWith(prefix));
    if (tasks.length === 0) {
      console.error(`No tasks with a tier starting with "${prefix}"`);
      return 1;
    }
  } else {
    const task = getTaskById(args[taskIdx + 1]);
    if (!task) {
      console.error(`Unknown task: ${args[taskIdx + 1]}`);
      return 1;
    }
    tasks = [task];
  }

  let seeds: number[];
  if (seedsIdx !== -1) {
    const count = parseInt(args[seedsIdx + 1], 10);
    if (!Number.isInteger(count) || count < 1) {
      console.error("Usage: --seeds <N> with N >= 1");
      return 1;
    }
    seeds = Array.from({ length: count }, (_, i) => i + 1);
  } else {
    seeds = [seedIdx !== -1 ? parseInt(args[seedIdx + 1], 10) : 1];
  }

  for (const task of tasks) {
    for (const seed of seeds) {
      await runOne(task, mode, seed, model, resultsDir);
    }
  }
  return 0;
}

// Run only as a script, so tests can import `main` with their own results directory.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
