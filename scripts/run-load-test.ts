/**
 * Load/Concurrency Test for Gate 6
 *
 * Runs 10-20 concurrent requests against the SEC EDGAR wrapper
 * to verify the system handles concurrent load without degradation.
 *
 * Usage:
 *   npx tsx scripts/run-load-test.ts [concurrency]
 *
 * Examples:
 *   npx tsx scripts/run-load-test.ts 10
 *   npx tsx scripts/run-load-test.ts 20
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://formal-shepherd-851.convex.cloud";
const client = new ConvexHttpClient(CONVEX_URL);

interface TestResult {
  ticker: string;
  success: boolean;
  latencyMs: number;
  artifactCount: number;
  error?: string;
}

const TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "META", "NVDA", "JPM", "V", "JNJ"];
const FORM_TYPES = ["10-K", "10-Q", "8-K"] as const;

async function runSingleRequest(ticker: string, formType: string): Promise<TestResult> {
  const startTime = Date.now();

  try {
    const result = await client.action(
      api.domains.agents.orchestrator.secEdgarWrapper.benchmarkSearchFilings,
      {
        ticker,
        formType: formType as any,
        limit: 2,
      }
    );

    return {
      ticker,
      success: result.success,
      latencyMs: Date.now() - startTime,
      artifactCount: result.artifactIds.length,
      error: result.error,
    };
  } catch (e) {
    return {
      ticker,
      success: false,
      latencyMs: Date.now() - startTime,
      artifactCount: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function runLoadTest(concurrency: number): Promise<void> {
  console.log("═".repeat(60));
  console.log("🔥 LOAD/CONCURRENCY TEST");
  console.log("═".repeat(60));
  console.log(`Concurrency: ${concurrency} simultaneous requests`);
  console.log(`Target: SEC EDGAR benchmark action`);
  console.log(`Convex URL: ${CONVEX_URL}`);
  console.log("");

  // Create test tasks
  const tasks: Array<{ ticker: string; formType: string }> = [];
  for (let i = 0; i < concurrency; i++) {
    tasks.push({
      ticker: TICKERS[i % TICKERS.length],
      formType: FORM_TYPES[i % FORM_TYPES.length],
    });
  }

  console.log(`📋 Test Matrix:`);
  const tickerCounts: Record<string, number> = {};
  tasks.forEach((t) => {
    tickerCounts[t.ticker] = (tickerCounts[t.ticker] || 0) + 1;
  });
  Object.entries(tickerCounts).forEach(([ticker, count]) => {
    console.log(`   ${ticker}: ${count} request(s)`);
  });
  console.log("");

  // Run all requests concurrently
  console.log(`🚀 Launching ${concurrency} concurrent requests...`);
  const startTime = Date.now();

  const results = await Promise.all(
    tasks.map((task) => runSingleRequest(task.ticker, task.formType))
  );

  const totalTime = Date.now() - startTime;

  // Analyze results
  const passed = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const latencies = results.map((r) => r.latencyMs);
  const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);
  const p50 = latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)];
  const p95 = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];
  const totalArtifacts = results.reduce((sum, r) => sum + r.artifactCount, 0);

  // Print results
  console.log("");
  console.log("═".repeat(60));
  console.log("📊 LOAD TEST RESULTS");
  console.log("═".repeat(60));
  console.log(`   Total Requests:   ${concurrency}`);
  console.log(`   Passed:           ${passed.length}`);
  console.log(`   Failed:           ${failed.length}`);
  console.log(`   Success Rate:     ${Math.round((passed.length / concurrency) * 100)}%`);
  console.log(`   Total Time:       ${totalTime}ms`);
  console.log(`   Throughput:       ${Math.round((concurrency / totalTime) * 1000)} req/s`);
  console.log("");
  console.log("   Latency Metrics:");
  console.log(`     Min:            ${minLatency}ms`);
  console.log(`     Max:            ${maxLatency}ms`);
  console.log(`     Average:        ${avgLatency}ms`);
  console.log(`     P50:            ${p50}ms`);
  console.log(`     P95:            ${p95}ms`);
  console.log("");
  console.log(`   Artifacts Created: ${totalArtifacts}`);
  console.log("═".repeat(60));

  // Print individual results
  console.log("\n📝 Individual Results:");
  console.log("─".repeat(60));
  console.log("| Ticker | Status | Latency | Artifacts |");
  console.log("─".repeat(60));
  for (const result of results) {
    const status = result.success ? "✅" : "❌";
    console.log(
      `| ${result.ticker.padEnd(6)} | ${status}     | ${String(result.latencyMs).padStart(7)}ms | ${String(result.artifactCount).padStart(9)} |`
    );
  }
  console.log("─".repeat(60));

  // Print errors if any
  if (failed.length > 0) {
    console.log("\n⚠️ Errors:");
    for (const result of failed) {
      console.log(`   ${result.ticker}: ${result.error}`);
    }
  }

  // Verify idempotency by checking tool health
  console.log("\n🔍 Checking tool health after load test...");
  try {
    const health = await client.query(
      api.domains.agents.orchestrator.toolHealth.getToolHealthSnapshot,
      {}
    );

    const openCircuits = health.filter((h: any) => h.circuitOpen);
    if (openCircuits.length === 0) {
      console.log("   ✅ All circuit breakers healthy");
    } else {
      console.log(`   ⚠️ ${openCircuits.length} circuit(s) open:`);
      for (const circuit of openCircuits) {
        console.log(`      - ${circuit.toolName}: ${circuit.consecutiveFailures} failures`);
      }
    }
  } catch (e) {
    console.log(`   ⚠️ Could not check tool health: ${e}`);
  }

  // Determine pass/fail
  const passRate = passed.length / concurrency;
  const isPass = passRate >= 0.9 && maxLatency < 30000;

  console.log("");
  console.log("═".repeat(60));
  if (isPass) {
    console.log("✅ LOAD TEST PASSED");
    console.log(`   Success rate: ${Math.round(passRate * 100)}% (threshold: 90%)`);
    console.log(`   Max latency: ${maxLatency}ms (threshold: 30000ms)`);
  } else {
    console.log("❌ LOAD TEST FAILED");
    if (passRate < 0.9) {
      console.log(`   Success rate: ${Math.round(passRate * 100)}% (threshold: 90%)`);
    }
    if (maxLatency >= 30000) {
      console.log(`   Max latency: ${maxLatency}ms (threshold: 30000ms)`);
    }
  }
  console.log("═".repeat(60));

  process.exit(isPass ? 0 : 1);
}

// Main
const concurrency = parseInt(process.argv[2] || "10", 10);
if (concurrency < 1 || concurrency > 50) {
  console.error("Concurrency must be between 1 and 50");
  process.exit(1);
}

runLoadTest(concurrency).catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
