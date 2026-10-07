#!/usr/bin/env npx tsx

/**
 * Parallel Persona Episode Evaluation Runner
 *
 * Runs evaluations across multiple models in parallel for faster results.
 *
 * Usage:
 *   set CONVEX_URL=...; set MCP_SECRET=...
 *   npx tsx scripts/run-parallel-eval.ts --models kimi-k2.6,claude-haiku-4.5,gemini-3-flash-preview --limit 5
 *   npx tsx scripts/run-parallel-eval.ts --all --limit 3
 */

import dotenv from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

dotenv.config({ path: ".env.local" });
dotenv.config();

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function tryReadConvexEnvVar(name: string): string | null {
  const local = process.env[name];
  if (local && local.trim()) return local.trim();

  const cli = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "convex.cmd" : "convex");
  const res =
    process.platform === "win32"
      ? spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `& '${cli}' env get ${name}`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        })
      : spawnSync(cli, ["env", "get", name], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
  if (res.status !== 0) return null;
  const value = String(res.stdout ?? "").trim();
  return value.length ? value : null;
}

async function runEvaluation(
  client: ConvexHttpClient,
  secret: string,
  model: string,
  suite: string,
  offset: number,
  limit: number,
  domain?: string
): Promise<any> {
  console.log(`[${model}] Starting evaluation: suite=${suite} offset=${offset} limit=${limit}`);

  const startTime = Date.now();

  try {
    const result = await client.action(api.domains.evaluation.personaEpisodeEval.runPersonaEpisodeEval, {
      secret,
      model,
      suite: suite as any,
      offset,
      limit,
      domain,
    });

    const elapsed = Date.now() - startTime;
    const summary = result?.summary ?? {};

    console.log(
      `[${model}] ✓ Completed in ${(elapsed / 1000).toFixed(1)}s: ` +
        `total=${summary.total ?? "?"} passed=${summary.passed ?? "?"} failed=${summary.failed ?? "?"}`
    );

    return { model, result, elapsed };
  } catch (err) {
    const elapsed = Date.now() - startTime;
    const msg = err instanceof Error ? err.message : String(err);

    console.error(`[${model}] ✗ Failed after ${(elapsed / 1000).toFixed(1)}s: ${msg}`);

    return { model, error: msg, elapsed };
  }
}

async function main() {
  const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
  if (!convexUrl) throw new Error("Missing CONVEX_URL (or VITE_CONVEX_URL).");

  const secret = tryReadConvexEnvVar("MCP_SECRET");
  if (!secret) throw new Error("Missing MCP_SECRET.");

  // Parse arguments
  const modelsArg = getArg("--models");
  const allModels = hasFlag("--all");
  const suite = getArg("--suite") || "pack";
  const limit = parsePositiveInt(getArg("--limit")) ?? 3;
  const offset = parsePositiveInt(getArg("--offset")) ?? 0;
  const domain = getArg("--domain");

  // Determine which models to test
  const availableModels = ["kimi-k2.6", "gpt-5.4-mini", "claude-haiku-4.5", "gemini-3-flash-preview"];
  let modelsToTest: string[];

  if (allModels) {
    modelsToTest = availableModels;
  } else if (modelsArg) {
    modelsToTest = modelsArg.split(",").map((m) => m.trim());
  } else {
    modelsToTest = ["kimi-k2.6", "gpt-5.4-mini", "claude-haiku-4.5", "gemini-3-flash-preview"];
  }

  console.log(`\n🚀 Starting parallel evaluation:`);
  console.log(`   Models: ${modelsToTest.join(", ")}`);
  console.log(`   Suite: ${suite}`);
  console.log(`   Limit: ${limit} scenarios per model`);
  console.log(`   Offset: ${offset}`);
  if (domain) console.log(`   Domain: ${domain}`);
  console.log("");

  const client = new ConvexHttpClient(convexUrl);
  const authToken = process.env.CONVEX_AUTH_TOKEN;
  if (authToken) client.setAuth(authToken);

  const startTime = Date.now();

  // Run all evaluations in parallel
  const results = await Promise.all(
    modelsToTest.map((model) => runEvaluation(client, secret, model, suite, offset, limit, domain))
  );

  const totalElapsed = Date.now() - startTime;

  console.log(`\n📊 All evaluations completed in ${(totalElapsed / 1000).toFixed(1)}s\n`);

  // Generate summary report
  const summaryLines: string[] = [];
  summaryLines.push(`# Parallel Evaluation Results`);
  summaryLines.push(``);
  summaryLines.push(`Generated: ${new Date().toISOString()}`);
  summaryLines.push(`Total Time: ${(totalElapsed / 1000).toFixed(1)}s`);
  summaryLines.push(`Suite: ${suite}`);
  summaryLines.push(`Scenarios per model: ${limit}`);
  summaryLines.push(``);
  summaryLines.push(`## Results by Model`);
  summaryLines.push(``);
  summaryLines.push(`| Model | Status | Total | Passed | Failed | Time (s) |`);
  summaryLines.push(`|-------|--------|-------|--------|--------|----------|`);

  for (const r of results) {
    const status = r.error ? "❌ ERROR" : "✅ DONE";
    const summary = r.result?.summary ?? {};
    const total = summary.total ?? "-";
    const passed = summary.passed ?? "-";
    const failed = summary.failed ?? "-";
    const time = (r.elapsed / 1000).toFixed(1);

    summaryLines.push(`| ${r.model} | ${status} | ${total} | ${passed} | ${failed} | ${time} |`);
  }

  summaryLines.push(``);

  // Add detailed results for each model
  summaryLines.push(`## Detailed Results`);
  summaryLines.push(``);

  for (const r of results) {
    summaryLines.push(`### ${r.model}`);
    summaryLines.push(``);

    if (r.error) {
      summaryLines.push(`**Error:** ${r.error}`);
      summaryLines.push(``);
      continue;
    }

    const runs = r.result?.runs ?? [];
    if (runs.length === 0) {
      summaryLines.push(`No runs found.`);
      summaryLines.push(``);
      continue;
    }

    summaryLines.push(`| Scenario | Status | Failures |`);
    summaryLines.push(`|----------|--------|----------|`);

    for (const run of runs) {
      const status = run.ok ? "✅ PASS" : "❌ FAIL";
      const failures = Array.isArray(run.failureReasons) && run.failureReasons.length > 0 ? run.failureReasons[0].slice(0, 80) : "-";
      summaryLines.push(`| ${run.name || run.id} | ${status} | ${failures} |`);
    }

    summaryLines.push(``);
  }

  // Write results to file
  const outDir = join(process.cwd(), "docs", "architecture", "benchmarks");
  mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const mdPath = join(outDir, `parallel-eval-${timestamp}.md`);
  const jsonPath = join(outDir, `parallel-eval-${timestamp}.json`);

  writeFileSync(mdPath, summaryLines.join("\n"), "utf8");
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalElapsed,
        modelsToTest,
        suite,
        limit,
        offset,
        results,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(`\n📄 Results written to:`);
  console.log(`   ${mdPath}`);
  console.log(`   ${jsonPath}`);
}

main().catch((err) => {
  const msg = err instanceof Error ? (err.stack || err.message || String(err)) : String(err);
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
});
