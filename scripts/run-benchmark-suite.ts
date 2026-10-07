/**
 * Benchmark Suite Runner
 *
 * Executes benchmark suites for regression testing:
 * - Banking Memo Bench: SEC retrieval, artifact creation, tool health
 * - Social Fact-Check Bench: Instagram ingestion, claim extraction
 *
 * Usage:
 *   npx tsx scripts/run-benchmark-suite.ts [suite] [--seed]
 *
 * Examples:
 *   npx tsx scripts/run-benchmark-suite.ts banking_memo --seed
 *   npx tsx scripts/run-benchmark-suite.ts all
 */

import { ConvexHttpClient } from "convex/browser";
import { api, internal } from "../backend/convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://formal-shepherd-851.convex.cloud";

const client = new ConvexHttpClient(CONVEX_URL);

// ═══════════════════════════════════════════════════════════════════════════
// BENCHMARK TASK DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const BANKING_MEMO_TASKS = [
  {
    taskId: "sec_10k_retrieval_aapl",
    suite: "banking_memo",
    name: "AAPL 10-K Retrieval",
    description: "Retrieve Apple 10-K filings from SEC EDGAR",
    taskType: "sec_retrieval" as const,
    inputPayload: {
      ticker: "AAPL",
      formType: "10-K",
      limit: 2,
    },
    expectations: {
      minArtifacts: 1,
      maxLatencyMs: 15000,
      successRequired: true,
      idempotent: true,
    },
    priority: 1,
  },
  {
    taskId: "sec_10q_retrieval_msft",
    suite: "banking_memo",
    name: "MSFT 10-Q Retrieval",
    description: "Retrieve Microsoft 10-Q filings from SEC EDGAR",
    taskType: "sec_retrieval" as const,
    inputPayload: {
      ticker: "MSFT",
      formType: "10-Q",
      limit: 3,
    },
    expectations: {
      minArtifacts: 2,
      maxLatencyMs: 15000,
      successRequired: true,
      idempotent: true,
    },
    priority: 2,
  },
  {
    taskId: "sec_8k_retrieval_googl",
    suite: "banking_memo",
    name: "GOOGL 8-K Retrieval",
    description: "Retrieve Google 8-K filings from SEC EDGAR",
    taskType: "sec_retrieval" as const,
    inputPayload: {
      ticker: "GOOGL",
      formType: "8-K",
      limit: 5,
    },
    expectations: {
      minArtifacts: 3,
      maxLatencyMs: 15000,
      successRequired: true,
      idempotent: true,
    },
    priority: 3,
  },
  {
    taskId: "tool_health_check",
    suite: "banking_memo",
    name: "Tool Health Verification",
    description: "Verify all tools have healthy circuit breakers",
    taskType: "tool_health" as const,
    inputPayload: {},
    expectations: {
      successRequired: true,
    },
    priority: 10,
  },
];

const SOCIAL_FACTCHECK_TASKS = [
  {
    taskId: "tool_health_social",
    suite: "social_factcheck",
    name: "Social Tool Health",
    description: "Verify social media tools are healthy",
    taskType: "tool_health" as const,
    inputPayload: {},
    expectations: {
      successRequired: true,
    },
    priority: 1,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// RUNNER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function seedTasks(suite: string, tasks: typeof BANKING_MEMO_TASKS) {
  console.log(`\n📦 Seeding ${tasks.length} tasks for suite: ${suite}`);

  for (const task of tasks) {
    try {
      // Use action to call internal mutation
      await (client as any).action(
        "domains/evaluation/benchmarkHarness:seedBenchmarkTask" as any,
        task
      );
      console.log(`  ✓ Seeded: ${task.taskId}`);
    } catch (e) {
      // Fallback: try direct mutation approach via a wrapper action
      console.log(`  ⚠ Could not seed ${task.taskId} directly, will seed during run`);
    }
  }
}

async function runSuite(suite: string) {
  console.log(`\n🚀 Starting benchmark run for suite: ${suite}`);

  // Get current git commit
  let gitCommit: string | undefined;
  try {
    const { execSync } = await import("child_process");
    gitCommit = execSync("git rev-parse --short HEAD").toString().trim();
    console.log(`   Git commit: ${gitCommit}`);
  } catch {
    console.log("   Git commit: unknown");
  }

  // Define tasks to run based on suite
  const tasks = suite === "banking_memo" ? BANKING_MEMO_TASKS : SOCIAL_FACTCHECK_TASKS;

  // Start the run
  const runId = `${suite}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  console.log(`   Run ID: ${runId}`);

  const startTime = Date.now();
  let passed = 0;
  let failed = 0;
  const results: Array<{ taskId: string; passed: boolean; latencyMs: number; error?: string }> = [];

  // Execute each task
  for (const task of tasks) {
    console.log(`\n   📝 Executing: ${task.name}`);

    try {
      if (task.taskType === "sec_retrieval") {
        const result = await executeSECTask(runId, task);
        results.push({ taskId: task.taskId, ...result });
        if (result.passed) {
          passed++;
          console.log(`      ✅ Passed (${result.latencyMs}ms)`);
        } else {
          failed++;
          console.log(`      ❌ Failed: ${result.error || "Unknown"}`);
        }
      } else if (task.taskType === "tool_health") {
        const result = await executeToolHealthTask(runId, task);
        results.push({ taskId: task.taskId, ...result });
        if (result.passed) {
          passed++;
          console.log(`      ✅ Passed (${result.latencyMs}ms)`);
        } else {
          failed++;
          console.log(`      ❌ Failed: ${result.error || "Unknown"}`);
        }
      }
    } catch (e) {
      failed++;
      const error = e instanceof Error ? e.message : String(e);
      results.push({ taskId: task.taskId, passed: false, latencyMs: 0, error });
      console.log(`      ❌ Error: ${error}`);
    }
  }

  // Print summary
  const totalTime = Date.now() - startTime;
  const passRate = Math.round((passed / tasks.length) * 100);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`📊 BENCHMARK SUMMARY: ${suite}`);
  console.log(`${"═".repeat(60)}`);
  console.log(`   Total Tasks:  ${tasks.length}`);
  console.log(`   Passed:       ${passed}`);
  console.log(`   Failed:       ${failed}`);
  console.log(`   Pass Rate:    ${passRate}%`);
  console.log(`   Total Time:   ${totalTime}ms`);
  console.log(`${"═".repeat(60)}`);

  // Return success/failure
  return failed === 0;
}

async function executeSECTask(
  runId: string,
  task: (typeof BANKING_MEMO_TASKS)[0]
): Promise<{ passed: boolean; latencyMs: number; error?: string }> {
  const startTime = Date.now();

  try {
    // Call SEC wrapper via public benchmark action
    const result = await client.action(
      api.domains.agents.orchestrator.secEdgarWrapper.benchmarkSearchFilings,
      {
        ticker: task.inputPayload.ticker,
        formType: task.inputPayload.formType as any,
        limit: task.inputPayload.limit,
      }
    );

    const latencyMs = Date.now() - startTime;

    // Validate expectations
    let passed = true;
    let error: string | undefined;

    if (task.expectations.successRequired && !result.success) {
      passed = false;
      error = result.error || "SEC retrieval failed";
    }

    if (task.expectations.minArtifacts !== undefined) {
      if (result.artifactIds.length < task.expectations.minArtifacts) {
        passed = false;
        error = `Expected at least ${task.expectations.minArtifacts} artifacts, got ${result.artifactIds.length}`;
      }
    }

    if (task.expectations.maxLatencyMs !== undefined) {
      if (latencyMs > task.expectations.maxLatencyMs) {
        passed = false;
        error = `Latency ${latencyMs}ms exceeds threshold ${task.expectations.maxLatencyMs}ms`;
      }
    }

    // Test idempotency if required
    if (task.expectations.idempotent && result.success) {
      const secondResult = await client.action(
        api.domains.agents.orchestrator.secEdgarWrapper.benchmarkSearchFilings,
        {
          ticker: task.inputPayload.ticker,
          formType: task.inputPayload.formType as any,
          limit: task.inputPayload.limit,
        }
      );

      const firstIds = [...result.artifactIds].sort();
      const secondIds = [...secondResult.artifactIds].sort();

      if (JSON.stringify(firstIds) !== JSON.stringify(secondIds)) {
        passed = false;
        error = "Idempotency check failed: different artifact IDs on re-run";
      }
    }

    return { passed, latencyMs, error };
  } catch (e) {
    return {
      passed: false,
      latencyMs: Date.now() - startTime,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function executeToolHealthTask(
  runId: string,
  task: (typeof BANKING_MEMO_TASKS)[0]
): Promise<{ passed: boolean; latencyMs: number; error?: string }> {
  const startTime = Date.now();

  try {
    const health = await client.query(
      api.domains.agents.orchestrator.toolHealth.getToolHealthSnapshot,
      {}
    );

    const latencyMs = Date.now() - startTime;

    // Check for open circuits
    const openCircuits = health.filter((h: any) => h.circuitOpen);

    if (openCircuits.length > 0) {
      return {
        passed: false,
        latencyMs,
        error: `${openCircuits.length} circuit(s) open: ${openCircuits.map((c: any) => c.toolName).join(", ")}`,
      };
    }

    return { passed: true, latencyMs };
  } catch (e) {
    return {
      passed: false,
      latencyMs: Date.now() - startTime,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const suite = args[0] || "banking_memo";
  const shouldSeed = args.includes("--seed");

  console.log("═".repeat(60));
  console.log("🔬 NODEBENCH BENCHMARK SUITE RUNNER");
  console.log("═".repeat(60));
  console.log(`Suite: ${suite}`);
  console.log(`Convex URL: ${CONVEX_URL}`);

  // Seed tasks if requested
  if (shouldSeed) {
    if (suite === "all" || suite === "banking_memo") {
      await seedTasks("banking_memo", BANKING_MEMO_TASKS);
    }
    if (suite === "all" || suite === "social_factcheck") {
      await seedTasks("social_factcheck", SOCIAL_FACTCHECK_TASKS);
    }
  }

  // Run suites
  let allPassed = true;

  if (suite === "all") {
    allPassed = (await runSuite("banking_memo")) && allPassed;
    allPassed = (await runSuite("social_factcheck")) && allPassed;
  } else {
    allPassed = await runSuite(suite);
  }

  // Exit with appropriate code
  console.log(`\n${allPassed ? "✅ All benchmarks passed!" : "❌ Some benchmarks failed!"}`);
  process.exit(allPassed ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
