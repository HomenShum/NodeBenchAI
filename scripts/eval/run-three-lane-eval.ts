#!/usr/bin/env tsx
/**
 * Three-Lane Eval Runner
 *
 * Orchestrates Lane A (UX walkthrough), Lane B (concurrency + cache),
 * and Lane C (answer quality deterministic-gates subset) against a live
 * or preview server. Emits one unified scorecard JSON.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:4173 \
 *   NODEBENCH_API_KEY=<optional> \
 *   npx tsx scripts/eval/run-three-lane-eval.ts [--lane=a|b|c|all]
 *
 * Outputs:
 *   .tmp/three-lane-scorecard-{ts}.json
 *
 * Each lane runs independently — a failure in one lane does not abort the
 * other lanes. The final exit code reflects whether ALL lanes passed.
 *
 * Lane C note: runs only DETERMINISTIC gates (latency_within_budget,
 * tool_ordering_correct via max_external_calls / max_llm_calls,
 * artifact_decision_correct via expected_artifact_state). The LLM-judged
 * gates (entity_correct / grounded_to_sources / factually_accurate /
 * no_hallucinations / actionable / memory_first) are recorded as
 * NEEDS_REVIEW for human scoring. This is honest: deterministic what we
 * can measure, manual what we can't.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:4173";
const API_KEY = process.env.NODEBENCH_API_KEY ?? "";
const OUT_DIR = resolve(process.cwd(), ".tmp");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const LANE_FLAG = (process.argv.find((a) => a.startsWith("--lane="))?.split("=")[1] ?? "all").toLowerCase();
const RUN_A = LANE_FLAG === "all" || LANE_FLAG === "a";
const RUN_B = LANE_FLAG === "all" || LANE_FLAG === "b";
const RUN_C = LANE_FLAG === "all" || LANE_FLAG === "c";

// ────────────────────────────────────────────────────────────────────────
// Lane A — UX walkthrough via Playwright
// ────────────────────────────────────────────────────────────────────────

interface LaneAReport {
  status: "pass" | "fail" | "skipped";
  passCount: number;
  failCount: number;
  totalConsoleErrors: number;
  softGatesMissing: number;
  reportFile: string | null;
  error?: string;
}

async function runLaneA(): Promise<LaneAReport> {
  console.log("\n[lane A] running demo-walkthrough Playwright smoke…");
  const child = spawnSync(
    "npx",
    [
      "playwright",
      "test",
      "evals/e2e/demo-walkthrough.spec.ts",
      "--project=chromium",
      "--reporter=list",
    ],
    {
      env: { ...process.env, BASE_URL },
      stdio: "inherit",
      shell: true,
    },
  );

  const reportFile = resolve(OUT_DIR, "demo-walkthrough", "report.json");
  if (!existsSync(reportFile)) {
    return {
      status: "fail",
      passCount: 0,
      failCount: 0,
      totalConsoleErrors: 0,
      softGatesMissing: 0,
      reportFile: null,
      error: "Playwright did not emit report.json",
    };
  }
  const report = JSON.parse(readFileSync(reportFile, "utf8")) as {
    totalCases: number;
    passCount: number;
    failCount: number;
    totalConsoleErrors: number;
    softGateTotals: { found: number; missing: number };
  };
  return {
    status: child.status === 0 && report.failCount === 0 ? "pass" : "fail",
    passCount: report.passCount,
    failCount: report.failCount,
    totalConsoleErrors: report.totalConsoleErrors,
    softGatesMissing: report.softGateTotals.missing,
    reportFile,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Lane B — Concurrency + cache simulator
// ────────────────────────────────────────────────────────────────────────

interface LaneBReport {
  status: "pass" | "fail" | "skipped";
  profile: string;
  userCount: number;
  entityCount: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  errorCount: number;
  rateLimitCount: number;
  avgLatencyMs: number;
  totalDurationMs: number;
  duplicateSuppressionEstimate: number; // 0..1 — rough estimate based on p95 trend
  notes: string[];
}

async function runLaneB(): Promise<LaneBReport> {
  console.log("\n[lane B] running concurrent hot-burst simulator…");
  const entities = [
    "Stripe",
    "Anthropic",
    "OpenAI",
    "Perplexity",
    "Cursor",
    "Ramp",
    "Figma",
    "Mistral",
    "Cohere",
    "Linear",
  ];
  const USERS_PER_ENTITY = 10; // 10 × 10 = 100 users
  const latencies: number[] = [];
  let errorCount = 0;
  let rateLimitCount = 0;
  const notes: string[] = [];

  const startAll = Date.now();
  const tasks = entities.flatMap((entity, entityIdx) =>
    Array.from({ length: USERS_PER_ENTITY }, (_, userIdx) => async () => {
      const ownerKey = `load-user-${entityIdx}-${userIdx}`;
      const start = Date.now();
      try {
        const resp = await fetch(`${BASE_URL}/search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: API_KEY ? `Bearer ${API_KEY}` : "",
            "x-owner-key": ownerKey,
          },
          body: JSON.stringify({
            query: `Tell me about ${entity}.`,
            lens: "founder",
            ownerKey,
            contextHint: "lane-b-load",
          }),
        });
        const latency = Date.now() - start;
        latencies.push(latency);
        if (resp.status === 429) rateLimitCount += 1;
        else if (!resp.ok) errorCount += 1;
      } catch {
        errorCount += 1;
        latencies.push(Date.now() - start);
      }
    }),
  );

  // Fire all 100 requests concurrently
  await Promise.all(tasks.map((t) => t()));

  const totalDurationMs = Date.now() - startAll;
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const avg = sorted.reduce((s, n) => s + n, 0) / Math.max(1, sorted.length);

  // Rough duplicate-suppression estimate: if singleflight is working, later
  // requests (last half) should be materially faster than first half.
  const firstHalf = sorted.slice(0, Math.floor(sorted.length / 2));
  const lastHalf = sorted.slice(Math.floor(sorted.length / 2));
  const firstAvg = firstHalf.reduce((s, n) => s + n, 0) / Math.max(1, firstHalf.length);
  const lastAvg = lastHalf.reduce((s, n) => s + n, 0) / Math.max(1, lastHalf.length);
  const duplicateSuppressionEstimate = firstAvg > 0 ? Math.max(0, 1 - lastAvg / firstAvg) : 0;

  if (duplicateSuppressionEstimate > 0.2) {
    notes.push(`singleflight appears active — last-half avg ${Math.round(lastAvg)}ms vs first-half ${Math.round(firstAvg)}ms`);
  } else {
    notes.push("no singleflight advantage detected in this run; may be all-cold");
  }
  if (rateLimitCount > 0) {
    notes.push(`rate-limiter returned 429 ${rateLimitCount} times — confirm this matches expected caps`);
  }

  const status: LaneBReport["status"] =
    errorCount === 0 && p95 < 9_000 ? "pass" : "fail";
  return {
    status,
    profile: "P1_conference_hot_burst_small",
    userCount: entities.length * USERS_PER_ENTITY,
    entityCount: entities.length,
    p95LatencyMs: p95,
    maxLatencyMs: max,
    errorCount,
    rateLimitCount,
    avgLatencyMs: Math.round(avg),
    totalDurationMs,
    duplicateSuppressionEstimate: Math.round(duplicateSuppressionEstimate * 100) / 100,
    notes,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Lane C — Per-query deterministic gates
// ────────────────────────────────────────────────────────────────────────

interface LaneCCaseResult {
  caseId: string;
  mode: string;
  primaryCategory: string;
  deterministic: {
    latency_within_budget: { pass: boolean; rationale: string };
    tool_ordering_correct: { pass: boolean; rationale: string };
    artifact_decision_correct: { pass: boolean; rationale: string };
  };
  needs_review: string[];
  overall_p0_deterministic_pass: boolean;
}

interface LaneCReport {
  status: "pass" | "fail" | "skipped";
  totalCases: number;
  passCount: number;
  failCount: number;
  results: LaneCCaseResult[];
}

function parseCsv(text: string): Array<Record<string, string>> {
  // Simple CSV parser for our schema (no embedded newlines beyond quoted strings).
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]!);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

async function runLaneC(): Promise<LaneCReport> {
  console.log("\n[lane C] running deterministic-gate subset on v2 eval CSV…");
  const csvPath = resolve(
    process.cwd(),
    "docs",
    "architecture",
    "fast-slow-eval-cases-v2.csv",
  );
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  // Demo subset — the rows closest to the on-stage script
  const DEMO_SUBSET_IDS = new Set([
    "F01",
    "F02",
    "F03",
    "F04",
    "F22",
    "F25",
    "F26",
    "F27",
    "F28",
    "F30",
  ]);
  const subset = rows.filter((r) => DEMO_SUBSET_IDS.has(r.case_id));

  const results: LaneCCaseResult[] = [];
  for (const row of subset) {
    const start = Date.now();
    let httpStatus = 0;
    let responseOk = false;
    let responseJson: Record<string, unknown> = {};
    try {
      const resp = await fetch(`${BASE_URL}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: API_KEY ? `Bearer ${API_KEY}` : "",
          "x-owner-key": `lane-c-${row.case_id}`,
        },
        body: JSON.stringify({
          query: row.example_prompt,
          lens: "founder",
          ownerKey: `lane-c-${row.case_id}`,
          contextHint: `lane-c-${row.primary_category}`,
        }),
      });
      httpStatus = resp.status;
      responseOk = resp.ok;
      responseJson = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    } catch (err) {
      responseOk = false;
    }
    const latencyMs = Date.now() - start;

    const mode = row.mode;
    const latencyBudget = mode === "fast" ? 8_000 : 30_000;
    const latencyOk = latencyMs <= latencyBudget && responseOk;

    const maxExternal = Number.parseInt(row.max_external_calls, 10);
    const maxLlm = Number.parseInt(row.max_llm_calls, 10);
    const trace = Array.isArray(responseJson.trace) ? (responseJson.trace as Array<{ tool?: string }>) : [];
    const externalCalls = trace.filter((t) =>
      /linkup|web_search|fusion|fetch/i.test(t.tool ?? ""),
    ).length;
    const llmCalls = trace.filter((t) => /classify|generate|synth|llm|gemini|openai|anthropic/i.test(t.tool ?? "")).length;
    const toolOrderingOk =
      !Number.isFinite(maxExternal) ||
      (externalCalls <= maxExternal && llmCalls <= maxLlm);

    // Artifact decision correct — we check that the response did NOT
    // contain a signal of unsolicited save when expected_artifact_state
    // is "none" or "none|draft".
    const expected = (row.expected_artifact_state ?? "").split("|").map((s) => s.trim());
    const responseSaved = Boolean(
      (responseJson as { runId?: string }).runId ||
        (responseJson as { resultPacket?: { status?: string } }).resultPacket?.status === "saved",
    );
    const artifactOk =
      expected.includes("saved") || expected.includes("published")
        ? true
        : !responseSaved;

    const deterministicOverallPass = latencyOk && toolOrderingOk && artifactOk;

    results.push({
      caseId: row.case_id,
      mode,
      primaryCategory: row.primary_category,
      deterministic: {
        latency_within_budget: {
          pass: latencyOk,
          rationale: `${latencyMs}ms against budget ${latencyBudget}ms; http=${httpStatus}`,
        },
        tool_ordering_correct: {
          pass: toolOrderingOk,
          rationale: `external=${externalCalls}≤${maxExternal}; llm=${llmCalls}≤${maxLlm}`,
        },
        artifact_decision_correct: {
          pass: artifactOk,
          rationale: `expected=${row.expected_artifact_state}; responseSaved=${responseSaved}`,
        },
      },
      needs_review: [
        "entity_correct",
        "grounded_to_sources",
        "factually_accurate",
        "no_hallucinations",
        "actionable",
        "memory_first",
      ],
      overall_p0_deterministic_pass: deterministicOverallPass,
    });
  }

  const passCount = results.filter((r) => r.overall_p0_deterministic_pass).length;
  return {
    status: passCount === results.length ? "pass" : "fail",
    totalCases: results.length,
    passCount,
    failCount: results.length - passCount,
    results,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Orchestrator
// ────────────────────────────────────────────────────────────────────────

async function main() {
  const laneA: LaneAReport | { status: "skipped" } = RUN_A
    ? await runLaneA().catch((err) => ({
        status: "fail" as const,
        passCount: 0,
        failCount: 0,
        totalConsoleErrors: 0,
        softGatesMissing: 0,
        reportFile: null,
        error: String(err),
      }))
    : { status: "skipped" };

  const laneB: LaneBReport | { status: "skipped" } = RUN_B
    ? await runLaneB().catch((err) => ({
        status: "fail" as const,
        profile: "error",
        userCount: 0,
        entityCount: 0,
        p95LatencyMs: 0,
        maxLatencyMs: 0,
        errorCount: 1,
        rateLimitCount: 0,
        avgLatencyMs: 0,
        totalDurationMs: 0,
        duplicateSuppressionEstimate: 0,
        notes: [String(err)],
      }))
    : { status: "skipped" };

  const laneC: LaneCReport | { status: "skipped" } = RUN_C
    ? await runLaneC().catch((err) => ({
        status: "fail" as const,
        totalCases: 0,
        passCount: 0,
        failCount: 0,
        results: [],
      }))
    : { status: "skipped" };

  const allRun = [laneA, laneB, laneC].filter((l) => l.status !== "skipped") as Array<
    { status: "pass" | "fail" }
  >;
  const demoReady =
    allRun.length > 0 && allRun.every((l) => l.status === "pass");

  const summary = {
    baseUrl: BASE_URL,
    completedAt: new Date().toISOString(),
    demoReady,
    laneA,
    laneB,
    laneC,
  };

  const outFile = resolve(OUT_DIR, `three-lane-scorecard-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(summary, null, 2));

  /* eslint-disable no-console */
  console.log("\n==================== THREE-LANE EVAL ====================");
  console.log(`base url     : ${BASE_URL}`);
  console.log(`lane A (UX)  : ${laneA.status}${"passCount" in laneA ? ` (${laneA.passCount} pass / ${laneA.failCount} fail, ${laneA.totalConsoleErrors} console errors)` : ""}`);
  console.log(`lane B (load): ${laneB.status}${"p95LatencyMs" in laneB ? ` (p95 ${laneB.p95LatencyMs}ms, ${laneB.errorCount} errors, ${laneB.rateLimitCount} 429s, dup-suppr ~${laneB.duplicateSuppressionEstimate})` : ""}`);
  console.log(`lane C (qual): ${laneC.status}${"totalCases" in laneC ? ` (${laneC.passCount}/${laneC.totalCases} deterministic-pass)` : ""}`);
  console.log(`demo_ready   : ${demoReady}`);
  console.log(`scorecard    : ${outFile}`);
  console.log("=========================================================");
  /* eslint-enable no-console */

  process.exit(demoReady ? 0 : 1);
}

void main();
