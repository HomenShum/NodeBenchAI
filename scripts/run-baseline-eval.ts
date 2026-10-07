/**
 * Run Baseline Cross-Provider Search Evaluation
 *
 * Establishes baseline metrics for search consistency across providers.
 * This script runs the full benchmark suite and saves results.
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://agile-caribou-964.convex.cloud";

async function main() {
  console.log("=".repeat(60));
  console.log("CROSS-PROVIDER SEARCH EVALUATION - BASELINE");
  console.log("=".repeat(60));
  console.log(`Convex URL: ${CONVEX_URL}`);
  console.log("");

  const client = new ConvexHttpClient(CONVEX_URL);

  // Use a subset of queries for faster baseline generation
  const benchmarkQueries = [
    // Funding-focused (LinkedIn posts)
    { query: "startup funding announcements today", category: "funding" },
    { query: "Series A funding rounds 2024", category: "funding" },
    { query: "AI startup raised money this week", category: "funding" },

    // Tech news (daily digest)
    { query: "latest AI developments news", category: "tech_news" },
    { query: "OpenAI announcements today", category: "tech_news" },

    // Company research
    { query: "Stripe company valuation funding", category: "company" },
  ];

  console.log(`Running baseline with ${benchmarkQueries.length} queries...`);
  console.log("");

  try {
    // Run the baseline evaluation
    const result = await client.action(api.domains.search.fusion.crossProviderEval.runBaselineEvaluation, {
      queries: benchmarkQueries,
      delayBetweenQueriesMs: 3000, // 3 seconds between queries
    });

    console.log("");
    console.log("=".repeat(60));
    console.log("BASELINE RESULTS");
    console.log("=".repeat(60));
    console.log(`Snapshot ID: ${result.snapshotId}`);
    console.log(`Version: ${result.snapshotVersion}`);
    console.log(`Queries Evaluated: ${result.queryCount}`);
    console.log("");

    console.log("AGGREGATE METRICS:");
    console.log("-".repeat(40));
    console.log(`  URL Overlap (avg):        ${(result.aggregateMetrics.avgUrlOverlap * 100).toFixed(1)}%`);
    console.log(`  Title Overlap (avg):      ${(result.aggregateMetrics.avgTitleOverlap * 100).toFixed(1)}%`);
    console.log(`  Ranking Agreement (avg):  ${(result.aggregateMetrics.avgRankingAgreement * 100).toFixed(1)}%`);
    console.log(`  Duplicate Rate (avg):     ${(result.aggregateMetrics.avgDuplicateRate * 100).toFixed(1)}%`);
    console.log("");

    console.log("PER-PROVIDER STATS:");
    console.log("-".repeat(40));
    for (const [provider, stats] of Object.entries(result.aggregateMetrics.perProvider || {})) {
      const s = stats as any;
      console.log(`  ${provider}:`);
      console.log(`    Avg Latency:     ${s.avgLatencyMs?.toFixed(0) || 'N/A'}ms`);
      console.log(`    Avg Results:     ${s.avgResultCount?.toFixed(1) || 'N/A'}`);
      console.log(`    Error Rate:      ${((s.errorRate || 0) * 100).toFixed(1)}%`);
    }

    console.log("");
    console.log("=".repeat(60));
    console.log("BASELINE SAVED - Use this snapshot ID for comparison after refinements:");
    console.log(`  ${result.snapshotId}`);
    console.log("=".repeat(60));

    return result;
  } catch (error) {
    console.error("Baseline evaluation failed:", error);
    process.exit(1);
  }
}

main();
