// convex/domains/eval/runBatch.ts
// Batch evaluation runner with persistent storage
//
// This module provides:
// - eval.runBatch({suiteId, caseIds[], model}) - Run batch of tests
// - Stores raw output + artifacts
// - Runs LLM-as-judge to label pass/fail + rubric notes
// - Writes evalSummary for automated patching
//
// Uses Convex scheduled actions for non-blocking batch progression

"use node";

import { v } from "convex/values";
import { action, internalAction } from "../../../_generated/server";
import { api, internal } from "../../../_generated/api";
import OpenAI from "openai";
import { productionTestCases } from "./productionTestCases";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getLlmModel } from "../../../../shared/llm/modelCatalog";
import { Id } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION TEST USER
// ═══════════════════════════════════════════════════════════════════════════
// Use a real user ID from the database for evaluation tests.
// This allows the agent to have proper user context for tool execution.
// The agent's tools require a userId to access user-specific data.
const EVAL_TEST_USER_ID = "k17638grr3agn8cvdxa7fanbt57vrhzw" as Id<"users">;

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface TestCaseInput {
  id: string;
  userQuery: string;
  expectedTool: string;
  expectedArgs?: Record<string, any>;
  successCriteria: string[];
  evaluationPrompt?: string;
  acceptableAlternativeTools?: string[];
}

interface EvalResultOutput {
  testId: string;
  passed: boolean;
  latencyMs: number;
  toolsCalled: string[];
  response: string;
  reasoning: string;
  failureCategory?: string | null;
  suggestedFix?: string | null;
  artifacts?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// JUDGE SCHEMA - Extended with failure analysis
// ═══════════════════════════════════════════════════════════════════════════

const ExtendedJudgeSchema = z.object({
  passed: z.boolean().describe("Whether ALL success criteria were met"),
  correctToolCalled: z.boolean().describe("Whether the correct tool was called"),
  correctArguments: z.boolean().describe("Whether the tool arguments were appropriate"),
  responseHelpful: z.boolean().describe("Whether the response answered the user's query"),
  responseAccurate: z.boolean().describe("Whether the response is factually accurate"),
  allCriteriaMet: z.boolean().describe("Whether ALL success criteria were met"),
  reasoning: z.string().describe("1-2 sentence explanation of the verdict"),
  // OpenAI structured outputs requires .nullable() instead of .optional()
  failureCategory: z.string().nullable().describe("Category of failure if failed: wrong_tool_selection, missing_tool_call, incorrect_arguments, incomplete_response, factual_error, format_error, latency_exceeded, context_lost. Use null if passed."),
  suggestedFix: z.string().nullable().describe("Brief suggestion for fixing this failure if it failed. Use null if passed."),
});

type ExtendedJudgeEvaluation = z.infer<typeof ExtendedJudgeSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// NOTE: Mutations and queries are in evalStorage.ts (V8 runtime)
// This file uses "use node" so can only contain actions
// ═══════════════════════════════════════════════════════════════════════════

// Helper to get test cases from productionTestCases
function getTestCasesFromIds(caseIds: string[]): TestCaseInput[] {
  const testCaseMap = new Map(productionTestCases.map(tc => [tc.id, tc]));
  return caseIds
    .filter(id => testCaseMap.has(id))
    .map(id => {
      const tc = testCaseMap.get(id)!;
      return {
        id: tc.id,
        userQuery: tc.userQuery,
        expectedTool: tc.expectedTool,
        expectedArgs: tc.expectedArgs,
        successCriteria: tc.successCriteria,
        evaluationPrompt: tc.evaluationPrompt,
      };
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION: Run batch evaluation
// ═══════════════════════════════════════════════════════════════════════════

export const runBatch = action({
  args: {
    suiteId: v.string(),
    caseIds: v.array(v.string()),
    model: v.optional(v.string()),
    parallelism: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<any> => {
    const startTime = Date.now();
    const model = args.model || getLlmModel("analysis", "openai");
    const parallelism = args.parallelism ?? 4;

    console.log(`[runBatch] Starting eval run`, {
      suiteId: args.suiteId,
      caseCount: args.caseIds.length,
      model,
      parallelism,
    });

    // Create eval run record (using evalStorage module in V8 runtime)
    const runId = await ctx.runMutation(internal.domains.eval.evalStorage.createEvalRun, {
      suiteId: args.suiteId,
      model,
      totalCases: args.caseIds.length,
    });

    // Get test cases from the test suite (using local helper)
    const testCases = getTestCasesFromIds(args.caseIds);

    if (!testCases || testCases.length === 0) {
      console.warn("[runBatch] No test cases found");
      await ctx.runMutation(internal.domains.eval.evalStorage.updateEvalRun, {
        runId,
        status: "failed",
        errorMessage: "No test cases found",
      });
      return { success: false, error: "No test cases found" };
    }

    // Run tests in batches for controlled parallelism
    const results: EvalResultOutput[] = [];
    const batchSize = parallelism;

    for (let i = 0; i < testCases.length; i += batchSize) {
      const batch = testCases.slice(i, i + batchSize);

      console.log(`[runBatch] Running batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(testCases.length / batchSize)}`);

      const batchResults = await Promise.all(
        batch.map(testCase => runSingleTestCase(ctx, testCase, model))
      );

      results.push(...batchResults);

      // Store results as we go (partial progress)
      for (const result of batchResults) {
        await ctx.runMutation(internal.domains.eval.evalStorage.storeEvalResult, {
          runId,
          result,
        });
      }
    }

    // Calculate summary
    const passedCount = results.filter(r => r.passed).length;
    const failedCount = results.length - passedCount;
    const passRate = results.length > 0 ? passedCount / results.length : 0;
    const avgLatency = results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length;

    // Update run with final stats
    await ctx.runMutation(internal.domains.eval.evalStorage.updateEvalRun, {
      runId,
      status: "completed",
      passedCases: passedCount,
      failedCases: failedCount,
      passRate,
      avgLatencyMs: avgLatency,
    });

    const totalTime = Date.now() - startTime;

    console.log(`[runBatch] Completed`, {
      runId,
      passRate: `${(passRate * 100).toFixed(1)}%`,
      avgLatencyMs: avgLatency.toFixed(0),
      totalTimeMs: totalTime,
    });

    return {
      success: true,
      runId,
      summary: {
        totalTests: results.length,
        passed: passedCount,
        failed: failedCount,
        passRate,
        avgLatencyMs: avgLatency,
        totalTimeMs: totalTime,
      },
      failedTests: results.filter(r => !r.passed).map(r => ({
        testId: r.testId,
        reasoning: r.reasoning,
        failureCategory: r.failureCategory,
        suggestedFix: r.suggestedFix,
      })),
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Run single test case
// ═══════════════════════════════════════════════════════════════════════════

async function runSingleTestCase(
  ctx: any,
  testCase: TestCaseInput,
  model: string
): Promise<EvalResultOutput> {
  const startTime = Date.now();

  let response = "";
  let toolsCalled: string[] = [];
  let artifacts: string[] = [];

  try {
    // Run the test query through the agent with a test user context
    // The userId is required for the agent to have proper context for tool execution
    const result = await ctx.runAction(internal.domains.agents.fastAgentPanelStreaming.sendMessageInternal, {
      message: testCase.userQuery,
      userId: EVAL_TEST_USER_ID, // Provide user context for evaluation tests
    });

    response = result.response || "";
    toolsCalled = result.toolsCalled || [];
    artifacts = result.artifactIds || [];

    // Check if parallelDelegate was used - if so, wait for delegations and extract tools
    if (toolsCalled.includes("parallelDelegate")) {
      console.log(`[runSingleTestCase] parallelDelegate detected, waiting for delegations...`);

      // Extract runId from response (the agent should have logged it)
      // The parallelDelegate tool returns a JSON with runId
      // We need to find it in the tool results or response
      // For now, we'll use the threadId as runId (they're the same in the current implementation)
      const threadId = result.threadId;

      if (threadId) {
        const { waitForDelegationsAndExtractTools } = await import("./evalHelpers");
        const delegationTools = await waitForDelegationsAndExtractTools(
          ctx,
          threadId, // runId is the same as threadId in current implementation
          EVAL_TEST_USER_ID,
          60000, // 60 seconds max wait
          500 // 500ms poll interval
        );

        // Add delegation tools to toolsCalled
        for (const tool of delegationTools) {
          if (!toolsCalled.includes(tool)) {
            toolsCalled.push(tool);
            console.log(`[runSingleTestCase] ✅ Added delegation tool: ${tool}`);
          }
        }
      }
    }

  } catch (error: any) {
    console.error(`[runSingleTestCase] Error running ${testCase.id}:`, error.message);
    response = `Error: ${error.message}`;
  }

  const latencyMs = Date.now() - startTime;

  // Evaluate with LLM judge
  const evaluation = await evaluateWithExtendedJudge(testCase, response, toolsCalled);

  return {
    testId: testCase.id,
    passed: evaluation.passed,
    latencyMs,
    toolsCalled,
    response: response.slice(0, 5000), // Truncate for storage
    reasoning: evaluation.reasoning,
    failureCategory: evaluation.failureCategory,
    suggestedFix: evaluation.suggestedFix,
    artifacts,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Extended LLM judge with failure analysis
// ═══════════════════════════════════════════════════════════════════════════

async function evaluateWithExtendedJudge(
  testCase: TestCaseInput,
  response: string,
  toolsCalled: string[]
): Promise<ExtendedJudgeEvaluation> {
  const openai = new OpenAI();

  // Check if acceptable alternative tools were used
  const acceptableTools = [testCase.expectedTool, ...(testCase.acceptableAlternativeTools || [])];
  const toolMatch = toolsCalled.some(tool =>
    acceptableTools.some(expected =>
      expected.split(",").map(t => t.trim()).includes(tool)
    )
  );

  const judgePrompt = `You are an expert evaluator for AI agent tool usage. Evaluate this test case based on the SUCCESS CRITERIA.

**Test ID:** ${testCase.id}
**User Query:** "${testCase.userQuery}"
**Expected Tool:** ${testCase.expectedTool}
${testCase.acceptableAlternativeTools ? `**Acceptable Alternative Tools:** ${testCase.acceptableAlternativeTools.join(", ")}` : ""}
${testCase.expectedArgs ? `**Expected Args:** ${JSON.stringify(testCase.expectedArgs)}` : ""}

**Actual Tools Called:** ${toolsCalled.join(", ") || "None"}
**Tool Match:** ${toolMatch ? "✅ Expected or acceptable tool was called" : "❌ No expected tool was called"}
**Agent Response:**
${response.slice(0, 3000)}

**Success Criteria:**
${testCase.successCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}

${testCase.evaluationPrompt ? `**Evaluation Instructions:** ${testCase.evaluationPrompt}` : ""}

EVALUATION RULES:
1. A test PASSES only if ALL success criteria are met
2. Interpret criteria flexibly when they use "may", "includes", "or"
3. Don't penalize for additional helpful information
4. Empty responses should fail unless criteria explicitly allow them
5. IMPORTANT: If acceptable alternative tools are listed, calling ANY of them satisfies the tool requirement
6. Focus on the OUTCOME (response quality, citations, artifacts) not just which specific tool was called

If the test FAILS, provide:
- failureCategory: One of (wrong_tool_selection, missing_tool_call, incorrect_arguments, incomplete_response, factual_error, format_error, latency_exceeded, context_lost)
- suggestedFix: Brief, actionable suggestion to fix the failure`;

  try {
    const completion = await openai.chat.completions.create({
      model: getLlmModel("analysis", "openai"),
      messages: [
        {
          role: "system",
          content: "You are an expert AI agent evaluator. Provide objective pass/fail evaluations based on success criteria. When a test fails, diagnose the failure category and suggest a fix."
        },
        {
          role: "user",
          content: judgePrompt
        }
      ],
      response_format: zodResponseFormat(ExtendedJudgeSchema, "evaluation"),
    });

    const content = completion.choices[0].message.content;
    if (!content) {
      throw new Error("No content in response");
    }

    return JSON.parse(content) as ExtendedJudgeEvaluation;
  } catch (error: any) {
    console.error("[evaluateWithExtendedJudge] Error:", error.message);
    return {
      passed: false,
      correctToolCalled: false,
      correctArguments: false,
      responseHelpful: false,
      responseAccurate: false,
      allCriteriaMet: false,
      reasoning: `Judge evaluation failed: ${error.message}`,
      failureCategory: "format_error",
      suggestedFix: "Check judge prompt and model availability",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION: Get eval run summary
// ═══════════════════════════════════════════════════════════════════════════

export const getEvalSummary = action({
  args: {
    runId: v.id("evalRuns"),
  },
  handler: async (ctx, args): Promise<any> => {
    const run = await ctx.runQuery(internal.domains.eval.evalStorage.getEvalRun, {
      runId: args.runId,
    });

    if (!run) {
      return { error: "Eval run not found" };
    }

    const results = await ctx.runQuery(internal.domains.eval.evalStorage.getEvalResults, {
      runId: args.runId,
    });

    // Group failures by category
    const failuresByCategory: Record<string, number> = {};
    const suggestedFixes: Array<{ testId: string; fix: string }> = [];

    for (const result of results) {
      if (!result.passed) {
        const category = result.failureCategory || "unknown";
        failuresByCategory[category] = (failuresByCategory[category] || 0) + 1;
        if (result.suggestedFix) {
          suggestedFixes.push({ testId: result.testId, fix: result.suggestedFix });
        }
      }
    }

    return {
      run,
      results,
      analysis: {
        failuresByCategory,
        suggestedFixes,
        topFailureCategory: Object.entries(failuresByCategory)
          .sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      },
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION: Run predefined test suite
// ═══════════════════════════════════════════════════════════════════════════

export const runProductionSuite = action({
  args: {
    model: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<any> => {
    // Run the 10 core production test cases
    const coreTestIds = [
      "prod-001-web-research",
      "prod-002-cache-reuse",
      "prod-003-calendar-update",
      "prod-004-calendar-notify",
      "prod-005-multidoc-10",
      "prod-006-multidoc-100",
      "prod-007-spreadsheet-formula",
      "prod-008-spreadsheet-fix",
      "prod-009-morning-brief",
      "prod-010-safety-hallucination",
    ];

    return await ctx.runAction(api.domains.eval.runBatch.runBatch, {
      suiteId: "production-core",
      caseIds: coreTestIds,
      model: args.model,
      parallelism: 4,
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SEND EVAL REPORT EMAIL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send evaluation results via email - fetches results from database
 */
export const sendEvalReport = action({
  args: {
    runId: v.string(),
    recipientEmail: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean; emailId?: string; error?: string }> => {
    // Fetch run and results from database
    // First, get the run ID from the string runId
    const runDoc = await ctx.runQuery(internal.domains.eval.evalStorage.getEvalRun, {
      runId: args.runId, // Cast to Id<"evalRuns">
    });

    if (!runDoc) {
      return { success: false, error: "Run not found" };
    }

    const results = await ctx.runQuery(internal.domains.eval.evalStorage.getEvalResults, {
      runId: runDoc._id,
    });

    // Build summary from run document
    const summary = {
      totalTests: runDoc.totalCases,
      passed: runDoc.passedCases,
      failed: runDoc.failedCases,
      passRate: runDoc.passRate,
      avgLatencyMs: runDoc.avgLatencyMs,
      totalTimeMs: runDoc.completedAt ? runDoc.completedAt - runDoc.startedAt : 0,
    };

    // Call internal email action
    return await ctx.runAction(internal.domains.eval.runBatch.sendEvalReportEmail, {
      to: args.recipientEmail,
      runId: args.runId,
      summary,
      results: results.map((r: any) => ({
        testId: r.testId,
        passed: r.passed,
        latencyMs: r.latencyMs,
        toolsCalled: r.toolsCalled,
        response: r.response,
        reasoning: r.reasoning,
        failureCategory: r.failureCategory,
        suggestedFix: r.suggestedFix,
      })),
    });
  },
});

/**
 * Send evaluation results via email using Resend API
 * This is an internal action that doesn't require authentication
 */
export const sendEvalReportEmail = internalAction({
  args: {
    to: v.string(),
    runId: v.string(),
    summary: v.object({
      totalTests: v.number(),
      passed: v.number(),
      failed: v.number(),
      passRate: v.number(),
      avgLatencyMs: v.number(),
      totalTimeMs: v.number(),
    }),
    results: v.array(v.object({
      testId: v.string(),
      passed: v.boolean(),
      latencyMs: v.number(),
      toolsCalled: v.array(v.string()),
      response: v.string(),
      reasoning: v.string(),
      failureCategory: v.optional(v.union(v.string(), v.null())),
      suggestedFix: v.optional(v.union(v.string(), v.null())),
    })),
  },
  handler: async (ctx, args): Promise<{ success: boolean; emailId?: string; error?: string }> => {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM ?? "NodeBench <no-reply@nodebench.ai>";

    if (!apiKey) {
      console.error("[sendEvalReportEmail] Missing RESEND_API_KEY");
      return { success: false, error: "Email service not configured" };
    }

    // Build HTML email
    const passedTests = args.results.filter((r: any) => r.passed);
    const failedTests = args.results.filter((r: any) => !r.passed);
    const passRatePercent = (args.summary.passRate * 100).toFixed(1);
    const avgLatencySec = (args.summary.avgLatencyMs / 1000).toFixed(2);

    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #1a1a2e; border-bottom: 2px solid #4a90d9; padding-bottom: 10px; }
    h2 { color: #2d3748; margin-top: 30px; }
    .summary { background: #f7fafc; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
    .stat { text-align: center; }
    .stat-value { font-size: 28px; font-weight: bold; }
    .stat-label { font-size: 12px; color: #718096; text-transform: uppercase; }
    .pass { color: #38a169; }
    .fail { color: #e53e3e; }
    .test-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin: 10px 0; }
    .test-card.passed { border-left: 4px solid #38a169; }
    .test-card.failed { border-left: 4px solid #e53e3e; }
    .test-id { font-weight: bold; font-family: monospace; }
    .tools { font-size: 12px; color: #718096; }
    .reasoning { font-style: italic; color: #4a5568; margin-top: 8px; }
    .fix { background: #fffbeb; border-radius: 4px; padding: 8px; margin-top: 8px; font-size: 13px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #718096; }
  </style>
</head>
<body>
  <h1>🧪 NodeBench AI Evaluation Report</h1>

  <div class="summary">
    <div class="summary-grid">
      <div class="stat">
        <div class="stat-value ${args.summary.passRate >= 0.8 ? 'pass' : 'fail'}">${passRatePercent}%</div>
        <div class="stat-label">Pass Rate</div>
      </div>
      <div class="stat">
        <div class="stat-value">${args.summary.passed}/${args.summary.totalTests}</div>
        <div class="stat-label">Tests Passed</div>
      </div>
      <div class="stat">
        <div class="stat-value">${avgLatencySec}s</div>
        <div class="stat-label">Avg Latency</div>
      </div>
    </div>
  </div>

  <p><strong>Run ID:</strong> <code>${args.runId}</code></p>
  <p><strong>Total Duration:</strong> ${(args.summary.totalTimeMs / 1000).toFixed(1)}s</p>

  ${failedTests.length > 0 ? `
  <h2>❌ Failed Tests (${failedTests.length})</h2>
  ${failedTests.map((t: any) => `
    <div class="test-card failed">
      <div class="test-id">${t.testId}</div>
      <div class="tools">Tools called: ${t.toolsCalled.length > 0 ? t.toolsCalled.join(', ') : 'none'}</div>
      <div class="reasoning">${t.reasoning}</div>
      ${t.failureCategory ? `<div><strong>Category:</strong> ${t.failureCategory}</div>` : ''}
      ${t.suggestedFix ? `<div class="fix">💡 <strong>Suggested Fix:</strong> ${t.suggestedFix}</div>` : ''}
    </div>
  `).join('')}
  ` : ''}

  ${passedTests.length > 0 ? `
  <h2>✅ Passed Tests (${passedTests.length})</h2>
  ${passedTests.map((t: any) => `
    <div class="test-card passed">
      <div class="test-id">${t.testId}</div>
      <div class="tools">Tools called: ${t.toolsCalled.length > 0 ? t.toolsCalled.join(', ') : 'none'}</div>
      <div class="reasoning">${t.reasoning}</div>
    </div>
  `).join('')}
  ` : ''}

  <div class="footer">
    <p>Generated by NodeBench AI Evaluation System</p>
    <p>Timestamp: ${new Date().toISOString()}</p>
  </div>
</body>
</html>
    `.trim();

    try {
      const { Resend } = await import("resend");
      const resend = new Resend(apiKey);

      const { data, error } = await resend.emails.send({
        from,
        to: args.to,
        subject: `[NodeBench Eval] ${passRatePercent}% Pass Rate - ${args.summary.passed}/${args.summary.totalTests} Tests Passed`,
        html,
      });

      if (error) {
        console.error("[sendEvalReportEmail] Resend error:", error);
        return { success: false, error: error.message };
      }

      console.log("[sendEvalReportEmail] Email sent successfully:", data?.id);
      return { success: true, emailId: data?.id };
    } catch (err: any) {
      console.error("[sendEvalReportEmail] Exception:", err);
      return { success: false, error: err?.message || "Failed to send email" };
    }
  },
});
