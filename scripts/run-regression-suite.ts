/**
 * Unified Regression Suite Runner
 *
 * Runs all production hardening tests in sequence:
 * 1. Benchmark suite (Banking Memo, Social Fact-Check)
 * 2. Load/concurrency test
 * 3. Tool health verification
 * 4. Artifact integrity checks
 *
 * Usage:
 *   npx tsx scripts/run-regression-suite.ts [--quick]
 *
 * Options:
 *   --quick   Run abbreviated tests (fewer concurrent requests)
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://formal-shepherd-851.convex.cloud";
const client = new ConvexHttpClient(CONVEX_URL);

interface StageResult {
  stage: string;
  passed: boolean;
  duration: number;
  details: string;
}

const results: StageResult[] = [];

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 1: Benchmark Suite
// ═══════════════════════════════════════════════════════════════════════════

async function runBenchmarkStage(): Promise<StageResult> {
  console.log("\n┌─────────────────────────────────────────────────────────────┐");
  console.log("│  STAGE 1: BENCHMARK SUITE                                   │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  const startTime = Date.now();
  const tasks = [
    { ticker: "AAPL", formType: "10-K" as const },
    { ticker: "MSFT", formType: "10-Q" as const },
    { ticker: "GOOGL", formType: "8-K" as const },
  ];

  let passed = 0;
  let failed = 0;

  for (const task of tasks) {
    try {
      const result = await client.action(
        api.domains.agents.orchestrator.secEdgarWrapper.benchmarkSearchFilings,
        {
          ticker: task.ticker,
          formType: task.formType,
          limit: 2,
        }
      );

      if (result.success && result.artifactIds.length > 0) {
        passed++;
        console.log(`   ✅ ${task.ticker} ${task.formType}: ${result.artifactIds.length} artifacts`);
      } else {
        failed++;
        console.log(`   ❌ ${task.ticker} ${task.formType}: ${result.error || "No artifacts"}`);
      }
    } catch (e) {
      failed++;
      console.log(`   ❌ ${task.ticker} ${task.formType}: ${e}`);
    }
  }

  const duration = Date.now() - startTime;
  const stagePassed = failed === 0;

  return {
    stage: "Benchmark Suite",
    passed: stagePassed,
    duration,
    details: `${passed}/${tasks.length} tasks passed`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 2: Idempotency Verification
// ═══════════════════════════════════════════════════════════════════════════

async function runIdempotencyStage(): Promise<StageResult> {
  console.log("\n┌─────────────────────────────────────────────────────────────┐");
  console.log("│  STAGE 2: IDEMPOTENCY VERIFICATION                          │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  const startTime = Date.now();

  try {
    // Run first request
    const result1 = await client.action(
      api.domains.agents.orchestrator.secEdgarWrapper.benchmarkSearchFilings,
      { ticker: "AAPL", formType: "10-K", limit: 3 }
    );

    // Run second request (should return same artifacts)
    const result2 = await client.action(
      api.domains.agents.orchestrator.secEdgarWrapper.benchmarkSearchFilings,
      { ticker: "AAPL", formType: "10-K", limit: 3 }
    );

    const ids1 = [...result1.artifactIds].sort().join(",");
    const ids2 = [...result2.artifactIds].sort().join(",");

    const duration = Date.now() - startTime;

    if (ids1 === ids2 && result1.artifactIds.length > 0) {
      console.log(`   ✅ Idempotent: Same ${result1.artifactIds.length} artifact IDs on re-run`);
      return {
        stage: "Idempotency",
        passed: true,
        duration,
        details: `${result1.artifactIds.length} artifacts verified`,
      };
    } else {
      console.log(`   ❌ Non-idempotent: Different artifact IDs`);
      console.log(`      Run 1: ${ids1}`);
      console.log(`      Run 2: ${ids2}`);
      return {
        stage: "Idempotency",
        passed: false,
        duration,
        details: "Artifact IDs differ between runs",
      };
    }
  } catch (e) {
    return {
      stage: "Idempotency",
      passed: false,
      duration: Date.now() - startTime,
      details: String(e),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 3: Load Test
// ═══════════════════════════════════════════════════════════════════════════

async function runLoadStage(concurrency: number): Promise<StageResult> {
  console.log("\n┌─────────────────────────────────────────────────────────────┐");
  console.log(`│  STAGE 3: LOAD TEST (${concurrency} concurrent)                           │`);
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  const startTime = Date.now();
  const tickers = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "META", "NVDA", "JPM", "V", "JNJ"];

  const promises = Array.from({ length: concurrency }, (_, i) =>
    client.action(
      api.domains.agents.orchestrator.secEdgarWrapper.benchmarkSearchFilings,
      {
        ticker: tickers[i % tickers.length],
        formType: "10-Q",
        limit: 2,
      }
    )
  );

  const results = await Promise.allSettled(promises);
  const duration = Date.now() - startTime;

  const succeeded = results.filter(
    (r) => r.status === "fulfilled" && r.value.success
  ).length;

  const successRate = Math.round((succeeded / concurrency) * 100);

  if (successRate >= 90) {
    console.log(`   ✅ Load test passed: ${successRate}% success rate`);
    console.log(`      Duration: ${duration}ms for ${concurrency} requests`);
    return {
      stage: "Load Test",
      passed: true,
      duration,
      details: `${successRate}% success rate, ${duration}ms total`,
    };
  } else {
    console.log(`   ❌ Load test failed: ${successRate}% success rate`);
    return {
      stage: "Load Test",
      passed: false,
      duration,
      details: `Only ${successRate}% success rate`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 4: Tool Health Verification
// ═══════════════════════════════════════════════════════════════════════════

async function runToolHealthStage(): Promise<StageResult> {
  console.log("\n┌─────────────────────────────────────────────────────────────┐");
  console.log("│  STAGE 4: TOOL HEALTH VERIFICATION                          │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  const startTime = Date.now();

  try {
    const health = await client.query(
      api.domains.agents.orchestrator.toolHealth.getToolHealthSnapshot,
      {}
    );

    const duration = Date.now() - startTime;
    const openCircuits = health.filter((h: any) => h.circuitOpen);
    const highFailure = health.filter((h: any) => h.failureRate > 0.1);

    if (openCircuits.length === 0 && highFailure.length === 0) {
      console.log(`   ✅ All ${health.length} tools healthy`);
      for (const h of health) {
        console.log(
          `      ${h.toolName}: ${h.successCount} successes, ${h.failureRate * 100}% failure rate`
        );
      }
      return {
        stage: "Tool Health",
        passed: true,
        duration,
        details: `${health.length} tools, all healthy`,
      };
    } else {
      console.log(`   ⚠️ Tool health issues detected`);
      for (const h of [...openCircuits, ...highFailure]) {
        console.log(
          `      ${h.toolName}: circuit=${h.circuitOpen}, failures=${h.failureRate * 100}%`
        );
      }
      return {
        stage: "Tool Health",
        passed: false,
        duration,
        details: `${openCircuits.length} open circuits, ${highFailure.length} high failure tools`,
      };
    }
  } catch (e) {
    return {
      stage: "Tool Health",
      passed: false,
      duration: Date.now() - startTime,
      details: String(e),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 5: Artifact Integrity
// ═══════════════════════════════════════════════════════════════════════════

async function runArtifactIntegrityStage(): Promise<StageResult> {
  console.log("\n┌─────────────────────────────────────────────────────────────┐");
  console.log("│  STAGE 5: ARTIFACT INTEGRITY CHECK                          │");
  console.log("└─────────────────────────────────────────────────────────────┘\n");

  const startTime = Date.now();

  try {
    // Create a new artifact via SEC retrieval
    const result = await client.action(
      api.domains.agents.orchestrator.secEdgarWrapper.benchmarkSearchFilings,
      { ticker: "NVDA", formType: "10-K", limit: 1 }
    );

    if (!result.success || result.artifactIds.length === 0) {
      return {
        stage: "Artifact Integrity",
        passed: false,
        duration: Date.now() - startTime,
        details: "Failed to create test artifact",
      };
    }

    // Verify artifact has proper structure (via the filings data)
    const filing = result.filings[0];
    const hasAccession = !!filing.accessionNumber;
    const hasType = !!filing.filingType;
    const hasDate = !!filing.filedAt;
    const hasUrl = !!filing.documentUrl;

    const duration = Date.now() - startTime;

    if (hasAccession && hasType && hasDate && hasUrl) {
      console.log(`   ✅ Artifact integrity verified`);
      console.log(`      Accession: ${filing.accessionNumber}`);
      console.log(`      Type: ${filing.filingType}`);
      console.log(`      Filed: ${filing.filedAt}`);
      console.log(`      URL: ${filing.documentUrl.substring(0, 60)}...`);
      return {
        stage: "Artifact Integrity",
        passed: true,
        duration,
        details: `Artifact ${result.artifactIds[0]} verified`,
      };
    } else {
      console.log(`   ❌ Missing required fields`);
      return {
        stage: "Artifact Integrity",
        passed: false,
        duration,
        details: "Artifact missing required fields",
      };
    }
  } catch (e) {
    return {
      stage: "Artifact Integrity",
      passed: false,
      duration: Date.now() - startTime,
      details: String(e),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const isQuick = process.argv.includes("--quick");
  const concurrency = isQuick ? 5 : 15;

  console.log("═".repeat(65));
  console.log("   🔬 NODEBENCH UNIFIED REGRESSION SUITE");
  console.log("═".repeat(65));
  console.log(`   Mode: ${isQuick ? "Quick" : "Full"}`);
  console.log(`   Convex URL: ${CONVEX_URL}`);
  console.log(`   Started: ${new Date().toISOString()}`);

  // Run all stages
  results.push(await runBenchmarkStage());
  results.push(await runIdempotencyStage());
  results.push(await runLoadStage(concurrency));
  results.push(await runToolHealthStage());
  results.push(await runArtifactIntegrityStage());

  // Print summary
  console.log("\n═".repeat(65));
  console.log("   📊 REGRESSION SUITE SUMMARY");
  console.log("═".repeat(65));
  console.log("");
  console.log("   ┌───────────────────────────┬────────┬──────────┬──────────────────────────┐");
  console.log("   │ Stage                     │ Status │ Duration │ Details                  │");
  console.log("   ├───────────────────────────┼────────┼──────────┼──────────────────────────┤");

  for (const r of results) {
    const status = r.passed ? "✅ PASS" : "❌ FAIL";
    const stage = r.stage.padEnd(25);
    const duration = `${r.duration}ms`.padStart(7);
    const details = r.details.substring(0, 24).padEnd(24);
    console.log(`   │ ${stage} │ ${status} │ ${duration} │ ${details} │`);
  }

  console.log("   └───────────────────────────┴────────┴──────────┴──────────────────────────┘");

  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const passedStages = results.filter((r) => r.passed).length;
  const failedStages = results.filter((r) => !r.passed).length;

  console.log("");
  console.log(`   Total Duration: ${totalDuration}ms`);
  console.log(`   Stages Passed:  ${passedStages}/${results.length}`);
  console.log(`   Completed:      ${new Date().toISOString()}`);
  console.log("");

  if (failedStages === 0) {
    console.log("   ✅ ALL STAGES PASSED - READY FOR PRODUCTION");
    console.log("═".repeat(65));
    process.exit(0);
  } else {
    console.log(`   ❌ ${failedStages} STAGE(S) FAILED - NOT READY FOR PRODUCTION`);
    console.log("═".repeat(65));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
