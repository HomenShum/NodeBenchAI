#!/usr/bin/env node
/**
 * run-golden-queries.ts — Attrition-powered pipeline quality benchmark.
 *
 * Runs all golden queries against Pipeline v2, judges each result,
 * produces a pass/fail scorecard. Designed to run:
 * - After every deploy (GitHub Action)
 * - On demand (npx tsx scripts/attrition/run-golden-queries.ts)
 * - Via attrition.sh benchmark lane
 *
 * Exit code 0 = all pass, 1 = runtime blocked or query failures.
 */

import * as fs from "node:fs";
import * as path from "node:path";

let apiUrl: string;
const GOLDEN_PATH = path.join(import.meta.dirname ?? __dirname, "golden-queries.json");
const REPORT_PATH = path.join(import.meta.dirname ?? __dirname, "golden-results.json");

// The target is operator configuration, not untrusted request input. Local
// worker URLs are supported; redirects and embedded credentials are not.
function resolveApiUrl(): string {
  const url = new URL(process.env.NODEBENCH_API_URL ?? "http://localhost:3100");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("NODEBENCH_API_URL must be an HTTP(S) base URL without credentials, query or fragment");
  }
  return url.href.replace(/\/$/, "");
}

async function readJson(response: Response, maxBytes: number): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty JSON response");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeds ${maxBytes} byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function checkRuntime(): Promise<void> {
  const health = await fetch(`${apiUrl}/api/pipeline/health`, {
    redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  if (!health.ok) {
    await health.body?.cancel();
    throw new Error(`Pipeline health returned HTTP ${health.status}`);
  }
  const data = await readJson(health, 65_536);
  if (data?.status !== "ok" || data?.pipeline !== "v2") {
    throw new Error("Target does not expose the Pipeline v2 health contract");
  }
  if (data.components?.linkup !== true || data.components?.gemini !== true) {
    throw new Error("Pipeline provider configuration is incomplete (Linkup and Gemini required)");
  }

  // The real route rejects this before hooks, provider calls or retention writes.
  const empty = await fetch(`${apiUrl}/api/pipeline/search`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "" }), redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (empty.status !== 400) {
    await empty.body?.cancel();
    throw new Error(`Pipeline search contract missing (empty query returned HTTP ${empty.status})`);
  }
  const rejection = await readJson(empty, 65_536);
  if (rejection?.error !== true || rejection?.message !== "Query is required") {
    throw new Error(`Pipeline search contract missing (empty query returned HTTP ${empty.status})`);
  }
}

interface GoldenQuery {
  id: string;
  query: string;
  lens: string;
  expectedEntity: string | null;
  minConfidence: number;
  minSignals: number;
  minSources: number;
  expectDCF: boolean;
  tags: string[];
}

interface QueryResult {
  id: string;
  query: string;
  passed: boolean;
  failures: string[];
  entityName: string;
  confidence: number;
  signals: number;
  sources: number;
  hasDCF: boolean;
  durationMs: number;
  painResolutions: number;
}

async function runQuery(gq: GoldenQuery): Promise<QueryResult> {
  const start = Date.now();
  try {
    const resp = await fetch(`${apiUrl}/api/pipeline/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: gq.query, lens: gq.lens }),
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });

    if (!resp.ok) {
      await resp.body?.cancel();
      return {
        id: gq.id, query: gq.query, passed: false,
        failures: [`HTTP ${resp.status}`],
        entityName: "", confidence: 0, signals: 0, sources: 0,
        hasDCF: false, durationMs: Date.now() - start, painResolutions: 0,
      };
    }

    const data = await readJson(resp, 1_048_576);
    const failures: string[] = [];

    const entityName = data.entityName ?? "";
    const confidence = data.confidence ?? 0;
    const signals = data.variables?.length ?? 0;
    const sources = data.sourceRefs?.length ?? 0;
    const hasDCF = !!data.dcf;
    const painResolutions = data.painResolutions?.length ?? 0;

    // Judge against golden criteria
    if (gq.expectedEntity && !entityName.toLowerCase().includes(gq.expectedEntity.toLowerCase())) {
      failures.push(`Entity mismatch: got "${entityName}", expected "${gq.expectedEntity}"`);
    }
    if (confidence < gq.minConfidence) {
      failures.push(`Confidence ${confidence}% < min ${gq.minConfidence}%`);
    }
    if (signals < gq.minSignals) {
      failures.push(`Signals ${signals} < min ${gq.minSignals}`);
    }
    if (sources < gq.minSources) {
      failures.push(`Sources ${sources} < min ${gq.minSources}`);
    }
    if (gq.expectDCF && !hasDCF) {
      failures.push(`Expected DCF valuation but none produced`);
    }

    return {
      id: gq.id, query: gq.query, passed: failures.length === 0,
      failures, entityName, confidence, signals, sources,
      hasDCF, durationMs: Date.now() - start, painResolutions,
    };
  } catch (err: any) {
    return {
      id: gq.id, query: gq.query, passed: false,
      failures: [err.message ?? "Unknown error"],
      entityName: "", confidence: 0, signals: 0, sources: 0,
      hasDCF: false, durationMs: Date.now() - start, painResolutions: 0,
    };
  }
}

async function main() {
  const golden: { queries: GoldenQuery[] } = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf-8"));
  try {
    apiUrl = resolveApiUrl();
    console.log(`\n  🔍 NodeBench Golden Queries Benchmark\n  API: ${apiUrl}\n`);
    await checkRuntime();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Runtime preflight failed";
    fs.writeFileSync(REPORT_PATH, JSON.stringify({
      timestamp: new Date().toISOString(), apiUrl: apiUrl ?? null,
      status: "blocked", failureKind: "runtime_contract", message,
      plannedTotal: golden.queries.length, notRun: golden.queries.length,
      passRate: null, passed: 0, total: 0, avgConfidence: null, avgLatency: null, results: [],
    }, null, 2));
    console.error(`  BLOCKED: ${message}\n  No golden queries evaluated. Results: ${REPORT_PATH}`);
    process.exitCode = 1;
    return;
  }
  const results: QueryResult[] = [];

  for (const gq of golden.queries) {
    process.stdout.write(`  ${gq.id.padEnd(25)}`);
    const result = await runQuery(gq);
    results.push(result);

    if (result.passed) {
      console.log(`\x1b[32m✓ PASS\x1b[0m  ${result.confidence}% conf  ${result.signals} sig  ${result.sources} src  ${result.durationMs}ms${result.hasDCF ? "  DCF" : ""}`);
    } else {
      console.log(`\x1b[31m✗ FAIL\x1b[0m  ${result.failures.join(" | ")}`);
    }
  }

  // Scorecard
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const passRate = Math.round((passed / total) * 100);
  const avgConfidence = Math.round(results.reduce((s, r) => s + r.confidence, 0) / total);
  const avgLatency = Math.round(results.reduce((s, r) => s + r.durationMs, 0) / total);
  const dcfCount = results.filter(r => r.hasDCF).length;

  console.log(`\n  ─── SCORECARD ───`);
  console.log(`  Pass rate:      ${passed}/${total} (${passRate}%)`);
  console.log(`  Avg confidence: ${avgConfidence}%`);
  console.log(`  Avg latency:    ${avgLatency}ms`);
  console.log(`  DCF produced:   ${dcfCount}/${results.filter(r => golden.queries.find(q => q.id === r.id)?.expectDCF).length} expected`);
  console.log(`  Pain resolved:  ${results.reduce((s, r) => s + r.painResolutions, 0)} total\n`);

  // Write results to file for attrition ingestion
  fs.writeFileSync(REPORT_PATH, JSON.stringify({
    timestamp: new Date().toISOString(),
    apiUrl,
    status: "completed",
    plannedTotal: golden.queries.length,
    notRun: 0,
    passRate,
    passed,
    total,
    avgConfidence,
    avgLatency,
    results,
  }, null, 2));
  console.log(`  Results: ${REPORT_PATH}\n`);

  process.exit(passed === total ? 0 : 1);
}

main();
