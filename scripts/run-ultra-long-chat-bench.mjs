/**
 * Run ultra-long multi-angle chat benchmark
 */
import { ConvexHttpClient } from "convex/browser";
import { readFileSync } from "fs";

const envContent = readFileSync(".env.local", "utf8");
const match = envContent.match(/(?:VITE_)?CONVEX_URL=(.+)/);
if (!match) {
  console.error("No CONVEX_URL");
  process.exit(1);
}
const url = match[1].trim().replace(/^["']|["']$/g, "");
const client = new ConvexHttpClient(url);

const ownerKey = process.argv[2] || "bench-owner";
const userId = process.argv[3] || "bench-user";

console.log("═══════════════════════════════════════════════════════════════════");
console.log("  ULTRA-LONG MULTI-ANGLE CHAT BENCHMARK");
console.log("  Compaction FIRST → JIT Retrieval SECOND → Model Overflow THIRD");
console.log("  Advisor: Kimi K2.6 | Executors: Gemini 3.x lanes");
console.log("═══════════════════════════════════════════════════════════════════\n");

try {
  const { internal } = await import("../backend/convex/_generated/api.js");
  const result = await client.action(
    internal.domains.research.researchSessionBenchmark.runUltraLongChatBenchmark,
    { ownerKey, userId }
  );

  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log("  SUITE SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`Timestamp: ${new Date(result.timestamp).toISOString()}`);
  console.log(`Overall verdict: ${result.summary.overallVerdict}`);
  console.log(`Scenarios: ${result.summary.scenariosPassed}/${result.summary.totalScenarios} passed`);
  console.log(`Total turns executed: ${result.summary.totalTurns}`);
  console.log(`Avg angle accuracy: ${(result.summary.avgAngleAccuracy * 100).toFixed(1)}%`);
  console.log(`Avg max working set tokens: ${result.summary.avgMaxWorkingSetTokens}`);
  console.log(`Total compression triggers: ${result.summary.totalCompressionTriggers}`);
  console.log(`Total priorities missed: ${result.summary.totalPrioritiesMissed}`);

  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log("  PER-SCENARIO BREAKDOWN");
  console.log("═══════════════════════════════════════════════════════════════════");
  for (const s of result.scenarios) {
    const status = s.verdict.overallPass ? "✅ PASS" : "❌ FAIL";
    console.log(`\n[${status}] ${s.scenarioId} (${s.persona}, ${s.turnsExecuted} turns)`);
    console.log(`  Session ID: ${s.sessionId}`);
    console.log(`  Verdicts:`);
    console.log(`    angle_accuracy:   ${s.verdict.angleAccuracyPass ? "PASS" : "FAIL"} (${(s.measurements.angleClassificationAccuracy * 100).toFixed(1)}%)`);
    console.log(`    context_budget:   ${s.verdict.contextBudgetPass ? "PASS" : "FAIL"} (max: ${s.measurements.maxWorkingSetTokens} tokens)`);
    console.log(`    retention:        ${s.verdict.retentionPass ? "PASS" : "FAIL"} (preserved: ${s.measurements.prioritiesPreserved}, missed: ${s.measurements.prioritiesMissed})`);
    console.log(`    compression:      ${s.verdict.compressionPass ? "PASS" : "FAIL"} (triggers: ${s.measurements.compressionTriggers}, final level: ${s.measurements.finalCompressionLevel})`);
    console.log(`  Checkpoints saved: ${s.measurements.checkpointsSaved}`);
    if (s.failures.length > 0) {
      console.log(`  Failures:`);
      for (const f of s.failures) console.log(`    - ${f}`);
    }
  }
  console.log("\n═══════════════════════════════════════════════════════════════════\n");
} catch (error) {
  console.error("Benchmark failed:", error.message);
  if (error.data) console.error("Data:", error.data);
  process.exit(1);
}
