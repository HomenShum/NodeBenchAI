// convex/tools/evaluation/evaluator.ts
"use node";

import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { internal, api } from "../../_generated/api";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { allTestCases, TestCase } from "./testCases";
import { getLlmModel } from "../../../shared/llm/modelCatalog";

const openai = new OpenAI();

export interface EvaluationResult {
  testId: string;
  category: string;
  scenario: string;
  userQuery: string;
  passed: boolean;
  toolsCalled: string[];
  expectedTools: string[];
  response: string;
  reasoning: string;
  correctToolCalled: boolean;
  correctArguments: boolean;
  responseHelpful: boolean;
  responseAccurate: boolean;
  allCriteriaMet: boolean;
  latencyMs: number;
  timestamp: number;
  errors?: string[];
}

export interface EvaluationSummary {
  totalTests: number;
  passed: number;
  failed: number;
  passRate: number;
  averageLatency: number;
  categoryResults: Record<string, {
    total: number;
    passed: number;
    passRate: number;
  }>;
  failedTests: Array<{
    testId: string;
    scenario: string;
    reason: string;
    correctToolCalled: boolean;
    correctArguments: boolean;
    responseHelpful: boolean;
    responseAccurate: boolean;
  }>;
}

/**
 * Execute a single test case through the agent stack (no judge).
 * This is useful for running scenarios in parallel while judging sequentially to reduce flakiness.
 */
export const runSingleTestRaw = internalAction({
  args: {
    testId: v.string(),
    threadId: v.optional(v.id("threads")),
    userId: v.optional(v.id("users")),
  },
  returns: v.object({
    testId: v.string(),
    category: v.string(),
    scenario: v.string(),
    userQuery: v.string(),
    toolsCalled: v.array(v.string()),
    toolCalls: v.array(v.any()),
    toolResults: v.array(v.any()),
    response: v.string(),
    latencyMs: v.number(),
    timestamp: v.number(),
    errors: v.optional(v.array(v.string())),
  }),
  handler: async (ctx, args) => {
    const testCase = allTestCases.find((t) => t.id === args.testId);
    if (!testCase) {
      throw new Error(`Test case ${args.testId} not found`);
    }

    console.log(`\n🧪 Running RAW test: ${testCase.id} - ${testCase.scenario}`);

    const startTime = Date.now();
    let response = "";
    let toolsCalled: string[] = [];
    let toolCalls: any[] = [];
    let toolResults: any[] = [];
    const errors: string[] = [];

    try {
      const result = await ctx.runAction(internal.domains.agents.fastAgentPanelStreaming.sendMessageInternal, {
        threadId: args.threadId,
        message: testCase.userQuery,
        userId: args.userId,
      });

      response = result.response || "";
      toolsCalled = result.toolsCalled || [];
      toolCalls = result.toolCalls || [];
      toolResults = result.toolResults || [];
    } catch (error: any) {
      errors.push(error?.message ?? String(error));
      console.error(`❌ Error running RAW test: ${error?.message ?? String(error)}`);
    }

    const latencyMs = Date.now() - startTime;

    return {
      testId: testCase.id,
      category: testCase.category,
      scenario: testCase.scenario,
      userQuery: testCase.userQuery,
      response,
      toolsCalled,
      toolCalls,
      toolResults,
      latencyMs,
      timestamp: Date.now(),
      errors: errors.length > 0 ? errors : undefined,
    };
  },
});

/**
 * Judge a completed test result (no agent execution).
 * This can be run sequentially to avoid judge rate-limit / concurrency flakiness.
 */
export const judgeSingleTest = internalAction({
  args: {
    testId: v.string(),
    response: v.string(),
    toolsCalled: v.array(v.string()),
    toolCalls: v.array(v.any()),
    toolResults: v.array(v.any()),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const testCase = allTestCases.find((t) => t.id === args.testId);
    if (!testCase) {
      throw new Error(`Test case ${args.testId} not found`);
    }
    return await evaluateWithJudge(testCase, args.response, args.toolsCalled, args.toolCalls, args.toolResults);
  },
});

/**
 * Run a single test case and evaluate with LLM-as-a-judge
 */
export const runSingleTest = internalAction({
  args: {
    testId: v.string(),
    threadId: v.optional(v.id("threads")),
    userId: v.optional(v.id("users")), // Optional userId for evaluation tests
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<EvaluationResult> => {
    const testCase = allTestCases.find(t => t.id === args.testId);
    if (!testCase) {
      throw new Error(`Test case ${args.testId} not found`);
    }

    console.log(`\n🧪 Running test: ${testCase.id} - ${testCase.scenario}`);

    const startTime = Date.now();
    let response = "";
    let toolsCalled: string[] = [];
    let toolCalls: any[] = [];
    let toolResults: any[] = [];
    const errors: string[] = [];

    try {
      // Use OpenAI function-calling implementation directly
      const result = await ctx.runAction(internal.domains.agents.fastAgentPanelStreaming.sendMessageInternal, {
        threadId: args.threadId,
        message: testCase.userQuery,
        userId: args.userId, // Pass userId to agent
      });

      response = result.response || "";
      toolsCalled = result.toolsCalled || [];
      toolCalls = result.toolCalls || [];
      toolResults = result.toolResults || [];

    } catch (error: any) {
      errors.push(error.message);
      console.error(`❌ Error running test: ${error.message}`);
    }

    const latencyMs = Date.now() - startTime;

    // Evaluate with LLM-as-a-judge
    const evaluation = await evaluateWithJudge(testCase, response, toolsCalled, toolCalls, toolResults);

    const result: EvaluationResult = {
      testId: testCase.id,
      category: testCase.category,
      scenario: testCase.scenario,
      userQuery: testCase.userQuery,
      passed: evaluation.passed,
      toolsCalled,
      expectedTools: testCase.expectedTool.split(',').map(t => t.trim()),
      response,
      reasoning: evaluation.reasoning,
      correctToolCalled: evaluation.correctToolCalled,
      correctArguments: evaluation.correctArguments,
      responseHelpful: evaluation.responseHelpful,
      responseAccurate: evaluation.responseAccurate,
      allCriteriaMet: evaluation.allCriteriaMet,
      latencyMs,
      timestamp: Date.now(),
      errors: errors.length > 0 ? errors : undefined,
    };

    // Log result
    if (result.passed) {
      console.log(`✅ PASSED - ${testCase.id}`);
      console.log(`   ✓ Tool: ${result.correctToolCalled}, Args: ${result.correctArguments}, Helpful: ${result.responseHelpful}, Accurate: ${result.responseAccurate}`);
    } else {
      console.log(`❌ FAILED - ${testCase.id}`);
      console.log(`   ✗ Tool: ${result.correctToolCalled}, Args: ${result.correctArguments}, Helpful: ${result.responseHelpful}, Accurate: ${result.responseAccurate}`);
      console.log(`   Reason: ${evaluation.reasoning}`);
    }

    return result;
  },
});

// Define the structured output schema using Zod - Simple pass/fail evaluation
const JudgeEvaluationSchema = z.object({
  passed: z.boolean().describe("Whether the test passed - all criteria must be met"),
  reasoning: z.string().describe("Detailed explanation of why the test passed or failed"),
  correctToolCalled: z.boolean().describe("Whether the correct tool was called"),
  correctArguments: z.boolean().describe("Whether the tool arguments were correct and appropriate"),
  responseHelpful: z.boolean().describe("Whether the response is helpful and answers the user's query"),
  responseAccurate: z.boolean().describe("Whether the response is factually accurate based on the tool output"),
  allCriteriaMet: z.boolean().describe("Whether ALL success criteria were met"),
});

type JudgeEvaluation = z.infer<typeof JudgeEvaluationSchema>;

/**
 * Evaluate a test result using GPT-5 as a judge with structured outputs
 */
async function evaluateWithJudge(
  testCase: TestCase,
  response: string,
  toolsCalled: string[],
  toolCalls: any[],
  toolResults: any[]
): Promise<{
  passed: boolean;
  reasoning: string;
  correctToolCalled: boolean;
  correctArguments: boolean;
  responseHelpful: boolean;
  responseAccurate: boolean;
  allCriteriaMet: boolean;
}> {
  const toolCallsCompact = (Array.isArray(toolCalls) ? toolCalls : [])
    .slice(0, 20)
    .map((c) => ({ toolName: c?.toolName, args: c?.args }))
    .filter((c) => typeof c.toolName === "string");

  const toolResultsCompact = (Array.isArray(toolResults) ? toolResults : [])
    .slice(0, 8)
    .map((r) => {
      const toolName = r?.toolName ?? r?.tool ?? r?.name;
      const out = r?.output ?? r?.result ?? r?.text ?? r?.content ?? r;
      let preview = "";
      try {
        preview = typeof out === "string" ? out : JSON.stringify(out);
      } catch {
        preview = String(out);
      }
      if (preview.length > 1600) preview = `${preview.slice(0, 1600)}…`;
      return { toolName, preview };
    })
    .filter((r) => typeof r.toolName === "string");

  const judgePrompt = `You are an expert evaluator for AI agent tool usage. Evaluate the following test case based on the SUCCESS CRITERIA provided.

**Test Scenario:** ${testCase.scenario}
**User Query:** "${testCase.userQuery}"
**Expected Tool(s):** ${testCase.expectedTool}
**Expected Args:** ${JSON.stringify(testCase.expectedArgs, null, 2)}

**Actual Tools Called:** ${toolsCalled.join(', ') || 'None'}
**Actual Tool Calls (with args):** ${toolCallsCompact.length > 0 ? JSON.stringify(toolCallsCompact, null, 2) : 'None'}
**Tool Result Snippets:** ${toolResultsCompact.length > 0 ? JSON.stringify(toolResultsCompact, null, 2) : 'None'}
**Agent Response:**
${response}

**Success Criteria (ALL must be met to pass):**
${testCase.successCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

**Evaluation Instructions:**
${testCase.evaluationPrompt}

IMPORTANT EVALUATION RULES:
1. Follow the SUCCESS CRITERIA exactly as written - they define what "correct" means for this test
2. If the criteria say "may also call X" or "includes Y", then calling additional tools is ACCEPTABLE
3. If the criteria say "or", then either option is valid
4. Focus on whether the user's request was fulfilled, not on exact tool matching
5. Empty responses should fail unless the criteria explicitly allow them
6. The test PASSES if ALL success criteria are met according to their written definitions
7. Do NOT fail solely because "Expected Args" differ from the actual tool args unless the SUCCESS CRITERIA explicitly require exact args

Evaluate each aspect based on the success criteria:
1. correctToolCalled: Does the tool usage match what the success criteria allow?
2. correctArguments: Are the arguments appropriate per the success criteria?
3. responseHelpful: Is the response helpful and answers the user's query?
4. responseAccurate: Is the response factually accurate based on what the tools would return?
5. allCriteriaMet: Are ALL success criteria met as written?`;

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        model: getLlmModel("analysis", "openai"),
        messages: [
          {
            role: "system",
            content:
              "You are an expert AI agent evaluator. Provide objective pass/fail evaluations based on the success criteria as written. Interpret criteria flexibly when they include words like 'may', 'includes', 'or'. A test passes if ALL criteria are met according to their written definitions.",
          },
          {
            role: "user",
            content: judgePrompt,
          },
        ],
        temperature: 0,
        response_format: zodResponseFormat(JudgeEvaluationSchema, "evaluation"),
      });

      const messageContent = completion.choices[0].message.content;
      if (!messageContent) {
        throw new Error("No content in response");
      }

      const result: JudgeEvaluation = JSON.parse(messageContent);

      return {
        passed: result.passed,
        reasoning: result.reasoning,
        correctToolCalled: result.correctToolCalled,
        correctArguments: result.correctArguments,
        responseHelpful: result.responseHelpful,
        responseAccurate: result.responseAccurate,
        allCriteriaMet: result.allCriteriaMet,
      };
    } catch (error: any) {
      const msg = error?.message ?? String(error);
      console.error(`Error in LLM judge (attempt ${attempt}/${maxAttempts}):`, msg);
      if (attempt < maxAttempts) {
        const backoffMs = 400 * attempt;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      return {
        passed: false,
        reasoning: `Judge evaluation failed: ${msg}`,
        correctToolCalled: false,
        correctArguments: false,
        responseHelpful: false,
        responseAccurate: false,
        allCriteriaMet: false,
      };
    }
  }

  // Unreachable, but keeps TypeScript happy.
  return {
    passed: false,
    reasoning: "Judge evaluation failed: unknown error",
    correctToolCalled: false,
    correctArguments: false,
    responseHelpful: false,
    responseAccurate: false,
    allCriteriaMet: false,
  };
}

/**
 * Run all test cases in parallel and generate summary
 */
export const runAllTestsParallel = action({
  args: {
    categories: v.optional(v.array(v.string())),
    userId: v.optional(v.id("users")), // Optional userId for evaluation tests
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<EvaluationSummary> => {
    console.log("\n🚀 Starting comprehensive tool evaluation (PARALLEL MODE)...\n");

    // Get test user if not provided
    let userId = args.userId;
    if (!userId) {
      // Get the test user from golden dataset
      const testUser = await ctx.runQuery(api.domains.utilities.seedGoldenDataset.getTestUser, {});
      if (testUser) {
        userId = testUser._id;
        console.log(`Using test user: ${userId}\n`);
      }
    }

    // Filter test cases by category if specified
    let testCases = allTestCases;
    if (args.categories && args.categories.length > 0) {
      testCases = allTestCases.filter(t => args.categories!.includes(t.category));
    }

    console.log(`📊 Running ${testCases.length} test cases in parallel...\n`);

    // Run ALL tests in parallel
    const testPromises = testCases.map(async (testCase) => {
      try {
        const result = await ctx.runAction(internal.tools.evaluation.evaluator.runSingleTest, {
          testId: testCase.id,
          userId, // Pass userId to each test
        });
        return result;
      } catch (error: any) {
        console.error(`Failed to run test ${testCase.id}:`, error.message);
        return {
          testId: testCase.id,
          category: testCase.category,
          scenario: testCase.scenario,
          userQuery: testCase.userQuery,
          passed: false,
          toolsCalled: [],
          expectedTools: testCase.expectedTool.split(',').map(t => t.trim()),
          response: "",
          reasoning: `Test execution failed: ${error.message}`,
          correctToolCalled: false,
          correctArguments: false,
          responseHelpful: false,
          responseAccurate: false,
          allCriteriaMet: false,
          latencyMs: 0,
          timestamp: Date.now(),
          errors: [error.message],
        } as EvaluationResult;
      }
    });

    // Wait for all tests to complete
    const results = await Promise.all(testPromises);

    // Generate summary
    const summary = generateSummary(results);

    // Print summary
    printSummary(summary);

    return summary;
  },
});

/**
 * Run all test cases sequentially (legacy - use runAllTestsParallel instead)
 */
export const runAllTests = action({
  args: {
    categories: v.optional(v.array(v.string())),
    createNewThread: v.optional(v.boolean()),
    userId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<EvaluationSummary> => {
    // Just call the parallel version - it's faster and better
    return await ctx.runAction(api.tools.evaluation.evaluator.runAllTestsParallel, {
      categories: args.categories,
      userId: args.userId,
    });
  },
});

/**
 * Run a bounded batch of tests and return the raw results.
 *
 * This exists because a full run can exceed Convex action time limits depending on tool latency
 * and judge rate limits. The CLI (`scripts/runEvaluation.ts`) will call this in a loop.
 */
export const runTestBatch = action({
  args: {
    categories: v.optional(v.array(v.string())),
    startIndex: v.optional(v.number()),
    limit: v.optional(v.number()),
    userId: v.optional(v.id("users")),
  },
  returns: v.object({
    results: v.array(v.any()),
    nextIndex: v.optional(v.number()),
    total: v.number(),
  }),
  handler: async (ctx, args) => {
    const startIndex = Math.max(0, args.startIndex ?? 0);
    const limit = Math.max(1, Math.min(10, args.limit ?? 6));

    let userId = args.userId;
    if (!userId) {
      const testUser = await ctx.runQuery(api.domains.utilities.seedGoldenDataset.getTestUser, {});
      if (testUser) {
        userId = testUser._id;
      }
    }

    let testCases = allTestCases;
    if (args.categories && args.categories.length > 0) {
      testCases = allTestCases.filter((t) => args.categories!.includes(t.category));
    }

    const total = testCases.length;
    const batch = testCases.slice(startIndex, startIndex + limit);

    const results: EvaluationResult[] = [];
    for (const testCase of batch) {
      const result = await ctx.runAction(internal.tools.evaluation.evaluator.runSingleTest, {
        testId: testCase.id,
        userId,
      });
      results.push(result as EvaluationResult);
    }

    const nextIndex = startIndex + batch.length < total ? startIndex + batch.length : undefined;
    return {
      results,
      nextIndex,
      total,
    };
  },
});

function generateSummary(results: EvaluationResult[]): EvaluationSummary {
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  const passRate = results.length > 0 ? (passed / results.length) * 100 : 0;
  const averageLatency = results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length;

  // Category breakdown
  const categoryResults: Record<string, { total: number; passed: number; passRate: number }> = {};

  for (const result of results) {
    if (!categoryResults[result.category]) {
      categoryResults[result.category] = { total: 0, passed: 0, passRate: 0 };
    }
    categoryResults[result.category].total++;
    if (result.passed) categoryResults[result.category].passed++;
  }

  // Calculate pass rates
  for (const category in categoryResults) {
    const cat = categoryResults[category];
    cat.passRate = cat.total > 0 ? (cat.passed / cat.total) * 100 : 0;
  }

  // Failed tests
  const failedTests = results
    .filter(r => !r.passed)
    .map(r => ({
      testId: r.testId,
      scenario: r.scenario,
      reason: r.reasoning,
      correctToolCalled: r.correctToolCalled,
      correctArguments: r.correctArguments,
      responseHelpful: r.responseHelpful,
      responseAccurate: r.responseAccurate,
    }));

  return {
    totalTests: results.length,
    passed,
    failed,
    passRate,
    averageLatency,
    categoryResults,
    failedTests,
  };
}

function printSummary(summary: EvaluationSummary) {
  console.log("\n" + "=".repeat(80));
  console.log("📊 EVALUATION SUMMARY");
  console.log("=".repeat(80));
  console.log(`\nTotal Tests: ${summary.totalTests}`);
  console.log(`✅ Passed: ${summary.passed} (${summary.passRate.toFixed(1)}%)`);
  console.log(`❌ Failed: ${summary.failed} (${(100 - summary.passRate).toFixed(1)}%)`);
  console.log(`⚡ Average Latency: ${summary.averageLatency.toFixed(0)}ms`);

  console.log("\n" + "-".repeat(80));
  console.log("📂 CATEGORY BREAKDOWN");
  console.log("-".repeat(80));

  for (const [category, stats] of Object.entries(summary.categoryResults)) {
    console.log(`\n${category}:`);
    console.log(`  Tests: ${stats.passed}/${stats.total} passed (${stats.passRate.toFixed(1)}%)`);
  }

  if (summary.failedTests.length > 0) {
    console.log("\n" + "-".repeat(80));
    console.log("❌ FAILED TESTS");
    console.log("-".repeat(80));

    for (const failed of summary.failedTests) {
      console.log(`\n${failed.testId}: ${failed.scenario}`);
      console.log(`  Tool: ${failed.correctToolCalled ? '✓' : '✗'}, Args: ${failed.correctArguments ? '✓' : '✗'}, Helpful: ${failed.responseHelpful ? '✓' : '✗'}, Accurate: ${failed.responseAccurate ? '✓' : '✗'}`);
      console.log(`  Reason: ${failed.reason}`);
    }
  }

  console.log("\n" + "=".repeat(80) + "\n");
}
