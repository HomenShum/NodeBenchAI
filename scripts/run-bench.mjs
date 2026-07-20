/**
 * Run production benchmark via Convex HTTP client
 */
import { ConvexHttpClient } from "convex/browser";
import { readFileSync } from "fs";

// Read Convex URL from env file
const envContent = readFileSync(".env.local", "utf8");
const convexUrlMatch = envContent.match(/VITE_CONVEX_URL=(.+)/) || envContent.match(/CONVEX_URL=(.+)/);
if (!convexUrlMatch) {
  console.error("No CONVEX_URL in .env.local");
  process.exit(1);
}

const url = convexUrlMatch[1].trim().replace(/^["']|["']$/g, "");
const client = new ConvexHttpClient(url);

const ownerKey = process.argv[2] || "eval-prod-user";
const runsPerScenario = parseInt(process.argv[3]) || 3;

console.log("═══════════════════════════════════════════════════════════");
console.log("  PRODUCTION WIKI DREAMING BENCHMARK");
console.log("═══════════════════════════════════════════════════════════");
console.log(`Owner: ${ownerKey}`);
console.log(`Runs per scenario: ${runsPerScenario}`);
console.log("Evaluating: Continuity, Relevance, Understanding, Actionability");
console.log("Personas: Daily Driver, Continuation Seeker, Drifter, New User");
console.log("═══════════════════════════════════════════════════════════\n");

try {
  const { internal } = await import("../backend/convex/_generated/api.js");
  const result = await client.action(
    internal.domains.product.wikiDreamingEvalProduction.runFullBenchmark,
    { ownerKey, runsPerScenario }
  );
  
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  BENCHMARK RESULTS");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Run ID: ${result.runId}`);
  console.log(`Timestamp: ${new Date(result.timestamp).toISOString()}`);
  console.log("\n--- SUMMARY ---");
  console.log(`Total Scenarios: ${result.summary.totalScenarios}`);
  console.log(`Total Runs: ${result.summary.totalRuns}`);
  console.log(`Overall Retention Risk: ${result.summary.overallRetentionRisk}`);
  console.log(`Critical Failure Rate: ${(result.summary.criticalFailureRate * 100).toFixed(1)}%`);
  
  console.log("\n--- SCENARIO BREAKDOWN ---");
  result.scenarios.forEach((s, i) => {
    console.log(`\n[${i+1}] ${s.scenarioId}`);
    console.log(`    Persona: ${s.persona}`);
    console.log(`    Gap: ${s.gapDuration}`);
    console.log(`    Runs: ${s.runs.length}`);
    console.log(`    Continuity: ${JSON.stringify(s.statistics.continuityDistribution)}`);
    console.log(`    Relevance: ${JSON.stringify(s.statistics.relevanceDistribution)}`);
    console.log(`    Understanding: ${JSON.stringify(s.statistics.understandingDistribution)}`);
    console.log(`    Actionability: ${JSON.stringify(s.statistics.actionabilityDistribution)}`);
    console.log(`    Retention: ${JSON.stringify(s.statistics.retentionRiskDistribution)}`);
    console.log(`    Confidence: ${s.statistics.meanConfidence.toFixed(3)} ± ${s.statistics.stdDev.toFixed(3)}`);
  });
  
  console.log("\n═══════════════════════════════════════════════════════════\n");
} catch (error) {
  console.error("Benchmark failed:", error.message);
  process.exit(1);
}
