#!/usr/bin/env npx tsx

/**
 * Agent Evaluation Runner
 *
 * Usage:
 *   npx tsx scripts/run-agent-eval.ts --mock     # Run with mock responses
 *   npx tsx scripts/run-agent-eval.ts --live     # Run against live agent
 *   npx tsx scripts/run-agent-eval.ts --persona JPM_STARTUP_BANKER  # Filter by persona
 *
 * Environment:
 *   CONVEX_URL - Convex deployment URL (default: http://localhost:3210)
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONVEX_URL = process.env.CONVEX_URL || "http://localhost:3210";
const PASSING_THRESHOLD = 0.75;

// Parse command line args
const args = process.argv.slice(2);
const isMock = args.includes("--mock");
const isLive = args.includes("--live");
const personaIdx = args.indexOf("--persona");
const persona = personaIdx >= 0 ? args[personaIdx + 1] : undefined;
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : undefined;

// ═══════════════════════════════════════════════════════════════════════════
// GROUND TRUTH DATA (inline for standalone execution)
// ═══════════════════════════════════════════════════════════════════════════

interface TestQuery {
  id: string;
  query: string;
  targetEntityId: string;
  targetPersona: string;
  expectedOutcome: "PASS" | "FAIL";
  requiredFactsInResponse: string[];
  forbiddenFactsInResponse: string[];
  description: string;
}

const TEST_QUERIES: TestQuery[] = [
  {
    id: "banker-disco-1",
    query: "Tell me about DISCO Pharmaceuticals for banker outreach",
    targetEntityId: "DISCO",
    targetPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["€36M", "Seed", "Cologne", "surfaceome", "Mark Manfredi"],
    forbiddenFactsInResponse: ["Series A", "San Francisco"],
    description: "Banker should get fresh seed-stage biotech with contacts",
  },
  {
    id: "banker-ambros-1",
    query: "Is Ambros Therapeutics ready for banker outreach?",
    targetEntityId: "AMBROS",
    targetPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["$125M", "Series A", "Irvine", "Phase 3", "RA Capital"],
    forbiddenFactsInResponse: ["Seed", "Boston"],
    description: "Banker should get Series A late-stage biotech",
  },
  {
    id: "banker-clearspace-fail",
    query: "Can I reach out to ClearSpace for a deal?",
    targetEntityId: "CLEARSPACE",
    targetPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "FAIL",
    requiredFactsInResponse: ["stale", "not ready"],
    forbiddenFactsInResponse: [],
    description: "Banker should FAIL on stale entity",
  },
  {
    id: "banker-oss-fail",
    query: "Evaluate OpenAutoGLM for banker targeting",
    targetEntityId: "OPEN-AUTOGLM",
    targetPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "FAIL",
    requiredFactsInResponse: ["not a company", "open source"],
    forbiddenFactsInResponse: ["ready for outreach"],
    description: "Banker should FAIL on OSS project",
  },
  {
    id: "vc-disco-1",
    query: "Evaluate DISCO Pharmaceuticals for VC thesis",
    targetEntityId: "DISCO",
    targetPersona: "EARLY_STAGE_VC",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["Seed", "surfaceome", "ADC"],
    forbiddenFactsInResponse: [],
    description: "VC should get thesis-ready seed biotech",
  },
  {
    id: "cto-quickjs-1",
    query: "Assess QuickJS vulnerability CVE-2025-62495",
    targetEntityId: "MQUICKJS",
    targetPersona: "CTO_TECH_LEAD",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["CVE-2025-62495", "2025-09-13"],
    forbiddenFactsInResponse: ["Cloudflare Workers uses QuickJS"],
    description: "CTO should get accurate CVE assessment",
  },
  {
    id: "exec-gemini-1",
    query: "What are Gemini 3 pricing economics for enterprise?",
    targetEntityId: "GEMINI_3",
    targetPersona: "ENTERPRISE_EXEC",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["context caching", "Flash", "Pro"],
    forbiddenFactsInResponse: [],
    description: "Exec should get accurate pricing model",
  },
  {
    id: "banker-neuralforge-1",
    query: "Tell me about NeuralForge AI for banker outreach",
    targetEntityId: "NEURAL_FORGE",
    targetPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["$12M", "Seed", "Greylock", "compliance"],
    forbiddenFactsInResponse: ["Series A"],
    description: "Banker should get new AI deal",
  },
  {
    id: "banker-vaultpay-1",
    query: "Is VaultPay ready for banker outreach?",
    targetEntityId: "VAULTPAY",
    targetPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["$45M", "Series A", "Index Ventures", "fintech"],
    forbiddenFactsInResponse: ["Seed"],
    description: "Banker should get fintech Series A",
  },
  {
    id: "banker-genomiq-1",
    query: "Evaluate GenomiQ Therapeutics for banking coverage",
    targetEntityId: "GENOMIQ",
    targetPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "PASS",
    requiredFactsInResponse: ["$80M", "Series B", "gene therapy", "Phase 2"],
    forbiddenFactsInResponse: ["Series A"],
    description: "Banker should get biotech Series B",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION LOGIC
// ═══════════════════════════════════════════════════════════════════════════

interface EvalResult {
  queryId: string;
  query: string;
  persona: string;
  expectedOutcome: "PASS" | "FAIL";
  actualOutcome: "PASS" | "FAIL";
  passed: boolean;
  containsRequired: boolean;
  noForbidden: boolean;
  failureReasons: string[];
  responseLength: number;
}

function evaluateResponse(response: string, query: TestQuery): EvalResult {
  const lowerResponse = response.toLowerCase();

  // Check required facts
  const missingFacts = query.requiredFactsInResponse.filter(
    (fact) => !lowerResponse.includes(fact.toLowerCase())
  );
  const containsRequired = missingFacts.length === 0;

  // Check forbidden facts
  const presentForbidden = query.forbiddenFactsInResponse.filter((fact) =>
    lowerResponse.includes(fact.toLowerCase())
  );
  const noForbidden = presentForbidden.length === 0;

  // Collect failure reasons
  const failureReasons: string[] = [];
  if (!containsRequired) {
    failureReasons.push(`Missing: ${missingFacts.join(", ")}`);
  }
  if (!noForbidden) {
    failureReasons.push(`Forbidden: ${presentForbidden.join(", ")}`);
  }

  const passed = containsRequired && noForbidden;
  const actualOutcome = passed ? "PASS" : "FAIL";

  return {
    queryId: query.id,
    query: query.query,
    persona: query.targetPersona,
    expectedOutcome: query.expectedOutcome,
    actualOutcome,
    passed,
    containsRequired,
    noForbidden,
    failureReasons,
    responseLength: response.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MOCK RESPONSE GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

function generateMockResponse(query: TestQuery): string {
  // Generate a response that should pass the evaluation
  let response = `# ${query.targetEntityId} - ${query.targetPersona} Evaluation\n\n`;

  if (query.expectedOutcome === "PASS") {
    // Include all required facts
    response += `Based on our analysis:\n`;
    for (const fact of query.requiredFactsInResponse) {
      response += `- ${fact}\n`;
    }
    response += `\n**Status:** ✓ READY\n`;
    response += `Contact: available via company website.\n`;
  } else {
    // For expected FAIL, use appropriate language
    response += `Based on our analysis:\n`;
    for (const fact of query.requiredFactsInResponse) {
      response += `- ${fact}\n`;
    }
    response += `\n**Status:** ✗ NOT READY / FAIL\n`;
  }

  return response;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║          AGENT EVALUATION SUITE - Boolean Scoring          ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  // Filter queries
  let queries = [...TEST_QUERIES];
  if (persona) {
    queries = queries.filter((q) => q.targetPersona === persona);
    console.log(`📋 Filtering to persona: ${persona}`);
  }
  if (limit) {
    queries = queries.slice(0, limit);
    console.log(`📋 Limiting to ${limit} queries`);
  }

  console.log(`📋 Running ${queries.length} evaluation queries\n`);
  console.log(`🎯 Passing threshold: ${PASSING_THRESHOLD * 100}%\n`);

  const results: EvalResult[] = [];

  if (isMock || (!isMock && !isLive)) {
    console.log("🔧 Mode: MOCK (testing evaluation framework)\n");

    for (const query of queries) {
      const response = generateMockResponse(query);
      const result = evaluateResponse(response, query);
      results.push(result);

      const icon = result.passed ? "✓" : "✗";
      console.log(`  ${icon} ${query.id}: ${result.passed ? "PASS" : "FAIL"}`);
      if (!result.passed) {
        console.log(`    Reasons: ${result.failureReasons.join("; ")}`);
      }
    }
  } else if (isLive) {
    console.log("🔴 Mode: LIVE (testing actual agent)\n");
    console.log(`   Convex URL: ${CONVEX_URL}\n`);

    // This would require the Convex client and user ID
    // For now, just show placeholder
    console.log("⚠️  Live mode requires a running Convex backend and user authentication.");
    console.log("   Use the Playwright tests for live evaluation: npx playwright test agent-eval-suite.spec.ts");
    process.exit(0);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n" + "═".repeat(60));
  console.log("                      EVALUATION SUMMARY");
  console.log("═".repeat(60) + "\n");

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  const passRate = passed / results.length;

  console.log(`  Total Queries:    ${results.length}`);
  console.log(`  Passed:           ${passed} ✓`);
  console.log(`  Failed:           ${failed} ✗`);
  console.log(`  Pass Rate:        ${(passRate * 100).toFixed(1)}%`);
  console.log(`  Threshold:        ${PASSING_THRESHOLD * 100}%`);
  console.log(`  Overall:          ${passRate >= PASSING_THRESHOLD ? "✅ PASSING" : "❌ NOT PASSING"}`);

  // By persona
  console.log("\n  By Persona:");
  const byPersona: Record<string, { passed: number; total: number }> = {};
  for (const result of results) {
    if (!byPersona[result.persona]) {
      byPersona[result.persona] = { passed: 0, total: 0 };
    }
    byPersona[result.persona].total++;
    if (result.passed) {
      byPersona[result.persona].passed++;
    }
  }
  for (const [p, stats] of Object.entries(byPersona)) {
    const rate = stats.passed / stats.total;
    const icon = rate >= PASSING_THRESHOLD ? "✓" : "✗";
    console.log(`    ${icon} ${p}: ${stats.passed}/${stats.total} (${(rate * 100).toFixed(0)}%)`);
  }

  // Common failures
  const allFailures = results.flatMap((r) => r.failureReasons);
  if (allFailures.length > 0) {
    console.log("\n  Common Failures:");
    const counts: Record<string, number> = {};
    for (const f of allFailures) {
      counts[f] = (counts[f] || 0) + 1;
    }
    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    for (const [failure, count] of sorted) {
      console.log(`    - ${failure} (${count}x)`);
    }
  }

  console.log("\n" + "═".repeat(60) + "\n");

  // Exit with appropriate code
  process.exit(passRate >= PASSING_THRESHOLD ? 0 : 1);
}

main().catch((err) => {
  console.error("Error running evaluation:", err);
  process.exit(1);
});
