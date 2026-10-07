"use node";

/**
 * Live Evaluation Module - Actions Only
 *
 * Runs evaluation queries against the actual agent, supporting both
 * authenticated users and anonymous users with daily free limits.
 *
 * Anonymous users get 5 free messages per day - this allows for
 * continuous testing without burning API costs for authenticated accounts.
 *
 * NOTE: Mutations and queries are in evalRunTracking.ts (no "use node")
 */

import { action } from "../../_generated/server";
import { v } from "convex/values";
import { internal, api } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  TEST_QUERIES,
  GROUND_TRUTH_ENTITIES,
  type TestQuery,
} from "./groundTruth";
import {
  evaluateResponse,
  type EvaluationResult,
} from "./booleanEvaluator";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const PASSING_THRESHOLD = 0.75;
const ANONYMOUS_DAILY_LIMIT = 5;
const EVAL_SESSION_PREFIX = "eval_session_";

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function generateEvalSessionId(): string {
  return `${EVAL_SESSION_PREFIX}${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

function getBestAssistantText(messages: any[]): string {
  let best = "";
  for (const message of messages) {
    if (!message || message.role !== "assistant") continue;
    const text = typeof message.content === "string" ? message.content.trim() : "";
    if (text.length > best.length) best = text;
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════════════
// LIVE EVALUATION ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run a single evaluation query against the live agent (anonymous mode)
 *
 * Uses the anonymous user pathway with a generated session ID.
 * Each session gets 5 free queries per day.
 */
export const runSingleEvalAnonymous = action({
  args: {
    queryId: v.string(),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    result: EvaluationResult | null;
    error?: string;
    remainingQueries: number;
  }> => {
    // Find the query
    const query = TEST_QUERIES.find(q => q.id === args.queryId);
    if (!query) {
      return { result: null, error: `Query not found: ${args.queryId}`, remainingQueries: 0 };
    }

    // Use provided session ID or generate one
    const sessionId = args.sessionId || generateEvalSessionId();

    // Check anonymous usage limits
    const existingUsage = await ctx.runQuery(api.domains.agents.fastAgentPanelStreaming.getAnonymousUsage, {
      sessionId,
    });

    if (existingUsage.used >= ANONYMOUS_DAILY_LIMIT) {
      return {
        result: null,
        error: `Daily limit reached (${ANONYMOUS_DAILY_LIMIT} messages). Try again tomorrow or sign in.`,
        remainingQueries: 0,
      };
    }

    try {
      // Create a thread for this evaluation
      const threadId = await ctx.runAction(api.domains.agents.fastAgentPanelStreaming.createThread, {
        title: `Eval: ${query.id}`,
        anonymousSessionId: sessionId,
      });

       // Send the evaluation query
       await ctx.runAction(api.domains.agents.fastAgentPanelStreaming.sendMessageStreaming, {
         threadId,
         content: query.query,
         anonymousSessionId: sessionId,
         // Evaluation queries are grounded by injected local context + ground truth anchors;
         // avoid coordinator/tool routing to reduce latency and timeout flakiness.
         useCoordinator: false,
       });

      // Wait for response to complete (poll for messages)
      let responseText = "";
      let attempts = 0;
      const maxAttempts = 90; // 90 * 2s = 180s max (allows for provider fallback backoff)
      const minResponseChars = 200;
      let bestTextSoFar = "";
      let stablePolls = 0;

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000));

        const messages = await ctx.runQuery(api.domains.agents.fastAgentPanelStreaming.getThreadMessagesForEval, {
          threadId,
          anonymousSessionId: sessionId,
        });

        const bestText = getBestAssistantText(messages);
        if (bestText && bestText !== bestTextSoFar) {
          bestTextSoFar = bestText;
          stablePolls = 0;
        } else if (bestText) {
          stablePolls++;
        }

        const lower = bestTextSoFar.toLowerCase();
        const looksInterim =
          lower.includes("let me search") ||
          lower.includes("let me look up") ||
          lower.includes("let me check") ||
          lower.includes("let me find") ||
          lower.includes("i'll search") ||
          lower.includes("i'll look up") ||
          lower.includes("i'll check") ||
          lower.includes("i'll find") ||
          lower.includes("i need to") && lower.includes("search");

        if (bestTextSoFar.length >= minResponseChars && stablePolls >= 2 && !looksInterim) {
          responseText = bestTextSoFar;
          break;
        }
        if (attempts >= maxAttempts - 1 && bestTextSoFar.length > 50) {
          responseText = bestTextSoFar;
          break;
        }

        attempts++;
      }

      if (!responseText) {
        return {
          result: null,
          error: "Agent did not respond within timeout",
          remainingQueries: ANONYMOUS_DAILY_LIMIT - existingUsage.used - 1,
        };
      }

      // Evaluate the response
      const result = evaluateResponse(query, responseText);

      return {
        result,
        remainingQueries: ANONYMOUS_DAILY_LIMIT - existingUsage.used - 1,
      };
    } catch (error: any) {
      return {
        result: null,
        error: `Error: ${error.message}`,
        remainingQueries: ANONYMOUS_DAILY_LIMIT - existingUsage.used - 1,
      };
    }
  },
});

/**
 * Run batch evaluation against the live agent (authenticated mode)
 *
 * Requires authentication. Runs multiple queries and returns aggregate results.
 */
export const runBatchEvalAuthenticated = action({
  args: {
    queryIds: v.optional(v.array(v.string())),
    persona: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    runId?: string;
    results: Array<{
      queryId: string;
      passed: boolean;
      responseLength: number;
      failureReasons: string[];
    }>;
    summary: {
      total: number;
      passed: number;
      failed: number;
      passRate: number;
      isPassing: boolean;
    };
    errors: string[];
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        results: [],
        summary: { total: 0, passed: 0, failed: 0, passRate: 0, isPassing: false },
        errors: ["Authentication required for batch evaluation"],
      };
    }

    // Filter queries
    let queries = [...TEST_QUERIES];
    if (args.queryIds?.length) {
      queries = queries.filter(q => args.queryIds!.includes(q.id));
    }
    if (args.persona) {
      queries = queries.filter(q => q.targetPersona === args.persona);
    }
    if (args.limit) {
      queries = queries.slice(0, args.limit);
    }

    const sessionId = generateEvalSessionId();
    type FullResultRecord = {
      queryId: string;
      query: string;
      persona: string;
      expectedOutcome: string;
      actualOutcome: string;
      passed: boolean;
      containsRequired: boolean;
      noForbidden: boolean;
      failureReasons: string[];
      responseLength: number;
      responseSnippet?: string;
      executedAt: number;
    };
    const results: FullResultRecord[] = [];
    const errors: string[] = [];

    // Create evaluation run record
    const runId = await ctx.runMutation(internal.domains.evaluation.evalRunTracking.createEvalRun, {
      sessionId,
      userId,
      queryIds: queries.map(q => q.id),
      mode: "authenticated",
    });

    // Run each query
    for (const testQuery of queries) {
      try {
        console.log(`[LiveEval] Running: ${testQuery.id}`);

        // Create a thread for this query
        const threadId = await ctx.runAction(api.domains.agents.fastAgentPanelStreaming.createThread, {
          title: `Eval: ${testQuery.id}`,
        });

        // Send the query
        await ctx.runAction(api.domains.agents.fastAgentPanelStreaming.sendMessageStreaming, {
          threadId,
          content: testQuery.query,
        });

        // Wait for response
        let responseText = "";
        let attempts = 0;
        const maxAttempts = 75; // 75 * 2s = 150s max (allows for provider fallback backoff)
        const minResponseChars = 200;
        let bestTextSoFar = "";
        let stablePolls = 0;

        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000));

          const messages = await ctx.runQuery(api.domains.agents.fastAgentPanelStreaming.getThreadMessagesForEval, {
          threadId,
          anonymousSessionId: sessionId,
         });

          const bestText = getBestAssistantText(messages);
          if (bestText && bestText !== bestTextSoFar) {
            bestTextSoFar = bestText;
            stablePolls = 0;
          } else if (bestText) {
            stablePolls++;
          }

          const lower = bestTextSoFar.toLowerCase();
          const looksInterim =
            lower.includes("let me search") ||
            lower.includes("let me look up") ||
            lower.includes("let me check") ||
            lower.includes("let me find") ||
            lower.includes("i'll search") ||
            lower.includes("i'll look up") ||
            lower.includes("i'll check") ||
            lower.includes("i'll find") ||
            lower.includes("i need to") && lower.includes("search");

          if (bestTextSoFar.length >= minResponseChars && stablePolls >= 2 && !looksInterim) {
            responseText = bestTextSoFar;
            break;
          }
          if (attempts >= maxAttempts - 1 && bestTextSoFar.length > 50) {
            responseText = bestTextSoFar;
            break;
          }

          attempts++;
        }

        if (!responseText) {
          const failResult: FullResultRecord = {
            queryId: testQuery.id,
            query: testQuery.query,
            persona: testQuery.targetPersona,
            expectedOutcome: testQuery.expectedOutcome,
            actualOutcome: "FAIL",
            passed: false,
            containsRequired: false,
            noForbidden: true,
            failureReasons: ["No response within timeout"],
            responseLength: 0,
            executedAt: Date.now(),
          };
          results.push(failResult);
          await ctx.runMutation(internal.domains.evaluation.evalRunTracking.updateEvalRun, {
            runId,
            result: failResult,
          });
          continue;
        }

        // Evaluate
        const evalResult = evaluateResponse(testQuery, responseText);
        const resultRecord: FullResultRecord = {
          queryId: testQuery.id,
          query: testQuery.query,
          persona: testQuery.targetPersona,
          expectedOutcome: testQuery.expectedOutcome,
          actualOutcome: evalResult.overallPass ? "PASS" : "FAIL",
          passed: evalResult.overallPass,
          containsRequired: evalResult.factors.containsRequiredFacts,
          noForbidden: evalResult.factors.noForbiddenFacts,
          failureReasons: evalResult.failureReasons,
          responseLength: responseText.length,
          responseSnippet: responseText.slice(0, 500),
          executedAt: Date.now(),
        };
        results.push(resultRecord);

        await ctx.runMutation(internal.domains.evaluation.evalRunTracking.updateEvalRun, {
          runId,
          result: resultRecord,
        });

        console.log(`[LiveEval] ${testQuery.id}: ${evalResult.overallPass ? "PASS" : "FAIL"}`);
      } catch (error: any) {
        const failResult: FullResultRecord = {
          queryId: testQuery.id,
          query: testQuery.query,
          persona: testQuery.targetPersona,
          expectedOutcome: testQuery.expectedOutcome,
          actualOutcome: "FAIL",
          passed: false,
          containsRequired: false,
          noForbidden: true,
          failureReasons: [`Error: ${error.message}`],
          responseLength: 0,
          executedAt: Date.now(),
        };
        results.push(failResult);
        errors.push(`${testQuery.id}: ${error.message}`);

        await ctx.runMutation(internal.domains.evaluation.evalRunTracking.updateEvalRun, {
          runId,
          result: failResult,
        });
      }
    }

    // Calculate summary
    const passedQueries = results.filter(r => r.passed).length;
    const passRate = results.length > 0 ? passedQueries / results.length : 0;
    const summary = {
      total: results.length,
      passed: passedQueries,
      failed: results.length - passedQueries,
      passRate,
      isPassing: passRate >= PASSING_THRESHOLD,
      threshold: PASSING_THRESHOLD,
    };

    // Complete the run
    await ctx.runMutation(internal.domains.evaluation.evalRunTracking.completeEvalRun, {
      runId,
      summary,
    });

    return {
      runId: runId.toString(),
      results: results.map(r => ({
        queryId: r.queryId,
        passed: r.passed,
        responseLength: r.responseLength,
        failureReasons: r.failureReasons,
      })),
      summary: {
        total: summary.total,
        passed: summary.passed,
        failed: summary.failed,
        passRate: summary.passRate,
        isPassing: summary.isPassing,
      },
      errors,
    };
  },
});

/**
 * Quick evaluation - runs a single query and returns immediate result
 * Useful for testing during development
 */
export const quickEval = action({
  args: {
    query: v.string(),
    entityId: v.string(),
    persona: v.string(),
    expectedOutcome: v.union(v.literal("PASS"), v.literal("FAIL")),
    requiredTerms: v.array(v.string()),
    forbiddenTerms: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{
    passed: boolean;
    responseText: string;
    missingTerms: string[];
    forbiddenFound: string[];
    error?: string;
  }> => {
    const userId = await getAuthUserId(ctx);
    const sessionId = generateEvalSessionId();

    try {
      // Create thread (anonymous or authenticated)
      const threadArgs: any = { title: "Quick Eval" };
      if (!userId) {
        threadArgs.anonymousSessionId = sessionId;
      }

      const threadId = await ctx.runAction(api.domains.agents.fastAgentPanelStreaming.createThread, threadArgs);

      // Send query
      const sendArgs: any = { threadId, content: args.query };
      if (!userId) {
        sendArgs.anonymousSessionId = sessionId;
      }

      await ctx.runAction(api.domains.agents.fastAgentPanelStreaming.sendMessageStreaming, sendArgs);

      // Wait for response
      let responseText = "";
      let attempts = 0;
      const maxAttempts = 90;
      const minResponseChars = 200;
      let bestTextSoFar = "";
      let stablePolls = 0;

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000));

        const messages = await ctx.runQuery(api.domains.agents.fastAgentPanelStreaming.getThreadMessagesForEval, {
          threadId,
          anonymousSessionId: sessionId,
        });

        const bestText = getBestAssistantText(messages);
        if (bestText && bestText !== bestTextSoFar) {
          bestTextSoFar = bestText;
          stablePolls = 0;
        } else if (bestText) {
          stablePolls++;
        }

        const lower = bestTextSoFar.toLowerCase();
        const looksInterim =
          lower.includes("let me search") ||
          lower.includes("let me look up") ||
          lower.includes("let me check") ||
          lower.includes("let me find") ||
          lower.includes("i'll search") ||
          lower.includes("i'll look up") ||
          lower.includes("i'll check") ||
          lower.includes("i'll find") ||
          lower.includes("i need to") && lower.includes("search");

        if (bestTextSoFar.length >= minResponseChars && stablePolls >= 2 && !looksInterim) {
          responseText = bestTextSoFar;
          break;
        }
        if (attempts >= maxAttempts - 1 && bestTextSoFar.length > 50) {
          responseText = bestTextSoFar;
          break;
        }

        attempts++;
      }

      if (!responseText) {
        return {
          passed: false,
          responseText: "",
          missingTerms: args.requiredTerms,
          forbiddenFound: [],
          error: "No response within timeout",
        };
      }

      // Evaluate
      const lowerResponse = responseText.toLowerCase();
      const missingTerms = args.requiredTerms.filter(
        (term: string) => !lowerResponse.includes(term.toLowerCase())
      );
      const forbiddenFound = args.forbiddenTerms.filter(
        (term: string) => lowerResponse.includes(term.toLowerCase())
      );

      const passed = missingTerms.length === 0 && forbiddenFound.length === 0;

      return {
        passed,
        responseText: responseText.slice(0, 1000),
        missingTerms,
        forbiddenFound,
      };
    } catch (error: any) {
      return {
        passed: false,
        responseText: "",
        missingTerms: args.requiredTerms,
        forbiddenFound: [],
        error: error.message,
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export { TEST_QUERIES, GROUND_TRUTH_ENTITIES, PASSING_THRESHOLD };
