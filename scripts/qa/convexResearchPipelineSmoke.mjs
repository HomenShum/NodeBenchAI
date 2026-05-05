/**
 * Convex-hosted research pipeline smoke for the multiple-me backend loop.
 *
 * Starts the public pipeline workflow through Convex CLI, then polls
 * pipelineRuns for the ownerKey. The payload is synthetic and does not send
 * repository/user evidence to the model.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const cliPath = "node_modules/convex/dist/cli.bundle.cjs";

function extractJson(raw) {
  const trimmed = raw.trim();
  const starts = [trimmed.indexOf("{"), trimmed.indexOf("[")].filter((n) => n >= 0);
  if (starts.length === 0) {
    throw new Error(`No JSON found in Convex output: ${trimmed.slice(0, 500)}`);
  }
  const start = Math.min(...starts);
  const opener = trimmed[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === opener) depth += 1;
    if (ch === closer) depth -= 1;
    if (depth === 0) {
      return JSON.parse(trimmed.slice(start, i + 1));
    }
  }
  throw new Error(`Unclosed JSON in Convex output: ${trimmed.slice(0, 500)}`);
}

function convexRun(functionName, args) {
  const res = spawnSync(
    process.execPath,
    [cliPath, "run", functionName, JSON.stringify(args)],
    { encoding: "utf8" },
  );
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(
      `convex run ${functionName} failed (${res.status})\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`,
    );
  }
  return { json: extractJson(res.stdout), stdout: res.stdout, stderr: res.stderr };
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ownerKey = `qa:multiple-me-convex:${Date.now()}`;
  const outDir = resolve(".tmp/convex-research-pipeline-smoke", stamp);
  mkdirSync(outDir, { recursive: true });

  console.log(`Starting Convex research pipeline smoke ownerKey=${ownerKey}`);
  const start = convexRun("domains/pipelines/pipelineWorkflow:startPipelineRun", {
    pipelineKind: "research",
    spec:
      "Synthetic QA: explain in two sentences why NodeBench should run 3 sample memos before a full 100-company batch. Return evidence-aware wording and no fabricated citations.",
    title: "Synthetic multiple-me backend QA",
    modelId: "gemini-3.1-flash-lite-preview",
    ownerKey,
    forceFresh: true,
    linkupDepth: "standard",
  });

  console.log(`Workflow started: ${JSON.stringify(start.json)}`);

  let latest = null;
  for (let attempt = 1; attempt <= 24; attempt += 1) {
    const listed = convexRun("domains/pipelines/pipelineRunsQueries:listRecentRuns", {
      ownerKey,
      limit: 3,
    }).json;
    latest = Array.isArray(listed) ? listed[0] : null;
    const status = latest?.status ?? "missing";
    const verdict = latest?.verdict ?? "none";
    console.log(`poll ${attempt}: status=${status} verdict=${verdict} steps=${latest?.stepCount ?? 0}`);
    if (["succeeded", "failed", "cancelled"].includes(status)) break;
    await sleep(5000);
  }

  if (!latest?.runId) {
    throw new Error("No pipeline run was found for ownerKey");
  }

  const detail = convexRun("domains/pipelines/pipelineRunsQueries:getRunDetail", {
    runId: latest.runId,
  }).json;

  const ok =
    detail?.run?.status === "succeeded" &&
    ["verified", "provisionally_verified", "needs_review"].includes(detail?.run?.verdict) &&
    Array.isArray(detail?.steps) &&
    detail.steps.some((s) => s.name === "research.scope" && s.status === "ok") &&
    detail.steps.some((s) => s.name === "research.synthesize" && s.status === "ok") &&
    detail.steps.some((s) => s.name === "research.verify" && s.status === "ok");

  const report = {
    generatedAt: new Date().toISOString(),
    ok,
    ownerKey,
    workflow: start.json,
    latest,
    detail,
  };

  const jsonPath = join(outDir, "results.json");
  const mdPath = join(outDir, "findings.md");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  writeFileSync(
    mdPath,
    [
      "# Convex Research Pipeline Smoke",
      "",
      `Generated: ${report.generatedAt}`,
      `Result: ${ok ? "PASS" : "FAIL"}`,
      `Owner key: ${ownerKey}`,
      `Run id: ${detail?.run?.runId ?? "missing"}`,
      `Status: ${detail?.run?.status ?? "missing"}`,
      `Verdict: ${detail?.run?.verdict ?? "missing"}`,
      `Steps: ${Array.isArray(detail?.steps) ? detail.steps.map((s) => `${s.name}:${s.status}`).join(", ") : "missing"}`,
      "",
      `JSON: ${jsonPath}`,
    ].join("\n"),
    "utf8",
  );

  console.log(`Report: ${mdPath}`);
  console.log(`JSON:   ${jsonPath}`);
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
