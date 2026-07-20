#!/usr/bin/env npx tsx

/**
 * Live Evaluation Runner
 *
 * Runs evaluation queries against the live agent using anonymous sessions.
 *
 * Usage:
 *   npx tsx scripts/run-live-eval.ts                    # Run all queries (anonymous)
 *   npx tsx scripts/run-live-eval.ts --query banker-disco-1  # Run specific query
 *   npx tsx scripts/run-live-eval.ts --persona JPM_STARTUP_BANKER  # Filter by persona
 *   npx tsx scripts/run-live-eval.ts --limit 3          # Limit number of queries
 *
 * Environment:
 *   CONVEX_URL - Convex deployment URL (default: http://localhost:3210)
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const PASSING_THRESHOLD = 0.75;

// Parse command line args
const args = process.argv.slice(2);
const queryIdx = args.indexOf("--query");
const queryId = queryIdx >= 0 ? args[queryIdx + 1] : undefined;
const personaIdx = args.indexOf("--persona");
const persona = personaIdx >= 0 ? args[personaIdx + 1] : undefined;
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : undefined;
const urlIdx = args.indexOf("--url");
const urlArg = urlIdx >= 0 ? args[urlIdx + 1] : undefined;
const isVerbose = args.includes("--verbose") || args.includes("-v");

const CONVEX_URL = urlArg || process.env.CONVEX_URL || "http://127.0.0.1:3210";

// ═══════════════════════════════════════════════════════════════════════════
// TEST QUERIES (subset for quick testing)
// ═══════════════════════════════════════════════════════════════════════════

interface TestQuery {
  id: string;
  query: string;
  targetPersona: string;
  expectedOutcome: "PASS" | "FAIL";
  requiredTerms: string[];
  forbiddenTerms: string[];
  description: string;
}

const TEST_QUERIES: TestQuery[] = [
  {
    id: "banker-disco-1",
    query: "Tell me about DISCO Pharmaceuticals for banker outreach",
    targetPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "PASS",
    requiredTerms: ["€36M", "Seed", "Cologne", "Mark Manfredi"],
    forbiddenTerms: ["Series A", "San Francisco"],
    description: "Banker should get fresh seed-stage biotech with contacts",
  },
  {
    id: "banker-ambros-1",
    query: "Is Ambros Therapeutics ready for banker outreach?",
    targetPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "PASS",
    requiredTerms: ["$125M", "Series A", "Phase 3"],
    forbiddenTerms: ["Seed", "Boston"],
    description: "Banker should get Series A late-stage biotech",
  },
  {
    id: "banker-clearspace-fail",
    query: "Can I reach out to ClearSpace for a deal?",
    targetPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "FAIL",
    requiredTerms: ["stale", "not ready"],
    forbiddenTerms: [],
    description: "Banker should FAIL on stale entity",
  },
  {
    id: "banker-neuralforge-1",
    query: "Tell me about NeuralForge AI for banker outreach",
    targetPersona: "JPM_STARTUP_BANKER",
    expectedOutcome: "PASS",
    requiredTerms: ["$12M", "Seed", "compliance"],
    forbiddenTerms: ["Series A"],
    description: "Banker should get new AI deal",
  },
  {
    id: "vc-disco-1",
    query: "Evaluate DISCO Pharmaceuticals for VC thesis",
    targetPersona: "EARLY_STAGE_VC",
    expectedOutcome: "PASS",
    requiredTerms: ["Seed", "surfaceome"],
    forbiddenTerms: [],
    description: "VC should get thesis-ready seed biotech",
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION LOGIC
// ═══════════════════════════════════════════════════════════════════════════

function evaluateResponse(
  response: string,
  query: TestQuery
): { passed: boolean; missingTerms: string[]; forbiddenFound: string[] } {
  const lowerResponse = response.toLowerCase();

  const missingTerms = query.requiredTerms.filter(
    (term) => !lowerResponse.includes(term.toLowerCase())
  );

  // Smart forbidden term check - ignore if preceded by negation
  const forbiddenFound = query.forbiddenTerms.filter((term) => {
    const lowerTerm = term.toLowerCase();
    if (!lowerResponse.includes(lowerTerm)) {
      return false; // Term not found at all
    }

    // Check if the term appears in a negation context
    // e.g., "not Series A", "isn't Series A", "rather than Series A"
    const negationPatterns = [
      `not ${lowerTerm}`,
      `isn't ${lowerTerm}`,
      `not a ${lowerTerm}`,
      `rather than ${lowerTerm}`,
      `instead of ${lowerTerm}`,
      `unlike ${lowerTerm}`,
      `(not ${lowerTerm})`,
      `must not include.*${lowerTerm}`,
      `forbidden.*${lowerTerm}`,
      `wrong.*${lowerTerm}`,
    ];

    // If ALL occurrences are in negation context, it's OK
    const termRegex = new RegExp(lowerTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = lowerResponse.match(termRegex);
    if (!matches) return false;

    // Check if any occurrence is NOT in a negation context
    let hasNonNegatedOccurrence = false;
    let searchStart = 0;

    for (const _match of matches) {
      const idx = lowerResponse.indexOf(lowerTerm, searchStart);
      if (idx === -1) break;

      // Get context around the match (50 chars before)
      const contextStart = Math.max(0, idx - 50);
      const context = lowerResponse.slice(contextStart, idx + lowerTerm.length);

      // Check if this occurrence is negated
      const isNegated = negationPatterns.some(pattern => {
        const regex = new RegExp(pattern, 'i');
        return regex.test(context);
      });

      if (!isNegated) {
        hasNonNegatedOccurrence = true;
        break;
      }

      searchStart = idx + 1;
    }

    return hasNonNegatedOccurrence;
  });

  return {
    passed: missingTerms.length === 0 && forbiddenFound.length === 0,
    missingTerms,
    forbiddenFound,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║         LIVE AGENT EVALUATION - Anonymous Mode             ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  const client = new ConvexHttpClient(CONVEX_URL);

  // Generate a unique session ID for this evaluation run
  const sessionId = `eval_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  console.log(`📋 Session ID: ${sessionId}`);
  console.log(`🔗 Convex URL: ${CONVEX_URL}\n`);

  // Filter queries
  let queries = [...TEST_QUERIES];
  if (queryId) {
    queries = queries.filter((q) => q.id === queryId);
    console.log(`📋 Running specific query: ${queryId}`);
  }
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

  const results: Array<{
    queryId: string;
    passed: boolean;
    responseLength: number;
    missingTerms: string[];
    forbiddenFound: string[];
    error?: string;
  }> = [];

  for (const testQuery of queries) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`📝 Query: ${testQuery.id}`);
    console.log(`   ${testQuery.query}`);
    console.log(`   Persona: ${testQuery.targetPersona}`);
    console.log(`   Expected: ${testQuery.expectedOutcome}`);

    try {
      // Create a thread for this query
      console.log(`   ⏳ Creating thread...`);
      const threadId = await client.action(
        api.domains.agents.fastAgentPanelStreaming.createThread,
        {
          title: `Eval: ${testQuery.id}`,
          anonymousSessionId: sessionId,
        }
      );

      // Send the query using initiateAsyncStreaming (mutation, not action)
      console.log(`   ⏳ Sending query...`);
      await client.mutation(
        api.domains.agents.fastAgentPanelStreaming.initiateAsyncStreaming,
        {
          threadId,
          prompt: testQuery.query,
          anonymousSessionId: sessionId,
        }
      );

      // Wait for response
      console.log(`   ⏳ Waiting for response...`);
      let responseText = "";
      let attempts = 0;
      const maxAttempts = 60; // 60 * 2s = 120s max
      let lastContentLength = 0;
      let stableCount = 0;

      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Use the anonymous-safe query for retrieving messages
        try {
          const messages = await client.query(
            api.domains.agents.fastAgentPanelStreaming.getAnonymousThreadMessages,
            {
              threadId,
              sessionId,
            }
          );

          const assistantMessages = messages.filter((m: any) => m.role === "assistant");

          // Debug: log all messages
          if (isVerbose && attempts % 10 === 0) {
            console.log(`   📨 All messages (${messages.length}):`, messages.map((m: any) => ({
              role: m.role,
              contentLen: m.content?.length ?? 0,
              contentPreview: m.content?.slice(0, 50),
            })));
          }

          if (assistantMessages.length > 0) {
            // Combine all assistant messages (in case of multi-step responses)
            const allContent = assistantMessages
              .map((m: any) => m.content || "")
              .filter((c: string) => c.length > 0)
              .join("\n\n");

            // Skip if response looks like a planning message (too short or just "I'll...")
            const isPlanning = allContent.length < 100 &&
              (allContent.includes("I'll research") ||
               allContent.includes("I'll check") ||
               allContent.includes("I'll evaluate") ||
               allContent.includes("Let me start"));

            if (!isPlanning && allContent.length > 50) {
              // Check if content has stabilized (not still streaming)
              if (allContent.length === lastContentLength) {
                stableCount++;
                if (stableCount >= 2) {
                  // Content stable for 4 seconds, consider it complete
                  responseText = allContent;
                  break;
                }
              } else {
                lastContentLength = allContent.length;
                stableCount = 0;
              }
            }
          }
        } catch (queryErr: any) {
          console.log(`   ⚠️  Query error: ${queryErr.message?.substring(0, 80)}`);
        }

        attempts++;
        if (attempts % 10 === 0) {
          const msgCount = await client.query(
            api.domains.agents.fastAgentPanelStreaming.getAnonymousThreadMessages,
            { threadId, sessionId }
          ).then(m => m.filter((x: any) => x.role === "assistant").length).catch(() => 0);
          console.log(`   ⏱️  ${attempts * 2}s elapsed... (${msgCount} assistant msgs, ${lastContentLength} chars)`);
        }
      }

      if (!responseText) {
        console.log(`   ❌ No response within timeout`);
        results.push({
          queryId: testQuery.id,
          passed: false,
          responseLength: 0,
          missingTerms: testQuery.requiredTerms,
          forbiddenFound: [],
          error: "No response within timeout",
        });
        continue;
      }

      // Evaluate the response
      const evalResult = evaluateResponse(responseText, testQuery);
      results.push({
        queryId: testQuery.id,
        passed: evalResult.passed,
        responseLength: responseText.length,
        missingTerms: evalResult.missingTerms,
        forbiddenFound: evalResult.forbiddenFound,
      });

      const icon = evalResult.passed ? "✓" : "✗";
      console.log(`   ${icon} ${evalResult.passed ? "PASS" : "FAIL"}`);
      console.log(`   Response length: ${responseText.length} chars`);

      if (!evalResult.passed) {
        if (evalResult.missingTerms.length > 0) {
          console.log(`   Missing: ${evalResult.missingTerms.join(", ")}`);
        }
        if (evalResult.forbiddenFound.length > 0) {
          console.log(`   Forbidden: ${evalResult.forbiddenFound.join(", ")}`);
        }
      }

      if (isVerbose) {
        console.log(`\n   Response snippet:\n   ${responseText.slice(0, 300)}...`);
      }

      // Show full response if --full flag is set
      if (args.includes("--full")) {
        console.log(`\n   Full response:\n   ${responseText}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
      results.push({
        queryId: testQuery.id,
        passed: false,
        responseLength: 0,
        missingTerms: testQuery.requiredTerms,
        forbiddenFound: [],
        error: error.message,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n" + "═".repeat(60));
  console.log("                      EVALUATION SUMMARY");
  console.log("═".repeat(60) + "\n");

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  const passRate = results.length > 0 ? passed / results.length : 0;

  console.log(`  Total Queries:    ${results.length}`);
  console.log(`  Passed:           ${passed} ✓`);
  console.log(`  Failed:           ${failed} ✗`);
  console.log(`  Pass Rate:        ${(passRate * 100).toFixed(1)}%`);
  console.log(`  Threshold:        ${PASSING_THRESHOLD * 100}%`);
  console.log(`  Overall:          ${passRate >= PASSING_THRESHOLD ? "✅ PASSING" : "❌ NOT PASSING"}`);

  // By persona
  console.log("\n  By Persona:");
  const byPersona: Record<string, { passed: number; total: number }> = {};
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const testPersona = queries.find((q) => q.id === result.queryId)?.targetPersona || "Unknown";
    if (!byPersona[testPersona]) {
      byPersona[testPersona] = { passed: 0, total: 0 };
    }
    byPersona[testPersona].total++;
    if (result.passed) {
      byPersona[testPersona].passed++;
    }
  }
  for (const [p, stats] of Object.entries(byPersona)) {
    const rate = stats.passed / stats.total;
    const icon = rate >= PASSING_THRESHOLD ? "✓" : "✗";
    console.log(`    ${icon} ${p}: ${stats.passed}/${stats.total} (${(rate * 100).toFixed(0)}%)`);
  }

  // Failed queries
  const failedQueries = results.filter((r) => !r.passed);
  if (failedQueries.length > 0) {
    console.log("\n  Failed Queries:");
    for (const r of failedQueries) {
      console.log(`    - ${r.queryId}`);
      if (r.error) {
        console.log(`      Error: ${r.error}`);
      }
      if (r.missingTerms.length > 0) {
        console.log(`      Missing: ${r.missingTerms.join(", ")}`);
      }
      if (r.forbiddenFound.length > 0) {
        console.log(`      Forbidden: ${r.forbiddenFound.join(", ")}`);
      }
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
