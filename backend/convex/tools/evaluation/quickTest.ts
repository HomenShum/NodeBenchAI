// convex/tools/evaluation/quickTest.ts
"use node";

import { action } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { allTestCases } from "./testCases";

/**
 * Quick test runner - runs a small set of key scenarios to verify end-to-end behavior.
 *
 * Important: Keep runtime comfortably below Convex action timeouts.
 */
export const runQuickTest = action({
  args: {},
  returns: v.object({
    totalTests: v.number(),
    passed: v.number(),
    failed: v.number(),
    results: v.array(v.any()),
  }),
  handler: async (ctx) => {
    console.log("\n[quickTest] Running quick test suite…\n");

    const testUserId = await ctx.runQuery(internal.tools.evaluation.helpers.getTestUser, {});
    if (!testUserId) {
      throw new Error("No test user found. Please create a user account first.");
    }
    console.log(`[quickTest] Using test user: ${testUserId}\n`);

    const quickTests = [
      "doc-001",
      "doc-002",
      "media-001",
      "task-001",
      "cal-001",
      "web-001",
      "sec-001",
      "agent-001",
      "agent-002",
      "agent-003",
    ];

    const remaining = [...quickTests];
    const rawResults: any[] = [];
    const CONCURRENCY = 2;
    const isSecSensitiveTest = (testId: string) =>
      testId.startsWith("sec-") || testId === "agent-003";

    // In-process mutex to avoid hitting SEC / EDGAR endpoints concurrently (reduces flakiness).
    let secLock: Promise<void> = Promise.resolve();
    const withSecLock = async <T,>(fn: () => Promise<T>): Promise<T> => {
      const prev = secLock;
      let release!: () => void;
      secLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prev;
      try {
        return await fn();
      } finally {
        release();
      }
    };

    const worker = async () => {
      while (remaining.length > 0) {
        const testId = remaining.shift();
        if (!testId) return;

        const testCase = allTestCases.find(t => t.id === testId);
        if (!testCase) {
          console.log(`[quickTest] Missing testCase: ${testId} (skipping)`);
          continue;
        }

        console.log(`[quickTest] Test ${testCase.id}: ${testCase.scenario}`);
        try {
          const run = () => ctx.runAction(internal.tools.evaluation.evaluator.runSingleTestRaw, {
            testId,
            userId: testUserId,
          });
          const result = isSecSensitiveTest(testId) ? await withSecLock(run) : await run();
          rawResults.push(result);
          console.log(`[quickTest] -> DONE (${result.latencyMs}ms)`);
        } catch (err: any) {
          rawResults.push({
            testId,
            scenario: testCase.scenario,
            error: err?.message ?? String(err),
          });
          console.log(`[quickTest] -> ERROR (${err?.message ?? String(err)})`);
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    rawResults.sort((a, b) => String(a?.testId ?? "").localeCompare(String(b?.testId ?? "")));

    const results: any[] = [];
    for (const raw of rawResults) {
      const testCase = allTestCases.find(t => t.id === raw.testId);
      if (!testCase) {
        results.push({
          testId: raw.testId,
          scenario: raw.scenario ?? "Unknown",
          passed: false,
          error: "Missing testCase metadata for judging",
        });
        continue;
      }

      try {
        const evaluation = await ctx.runAction(internal.tools.evaluation.evaluator.judgeSingleTest, {
          testId: raw.testId,
          response: raw.response ?? "",
          toolsCalled: raw.toolsCalled ?? [],
          toolCalls: raw.toolCalls ?? [],
          toolResults: raw.toolResults ?? [],
        });

        const result = {
          testId: raw.testId,
          category: raw.category ?? testCase.category,
          scenario: raw.scenario ?? testCase.scenario,
          userQuery: raw.userQuery ?? testCase.userQuery,
          passed: evaluation.passed,
          toolsCalled: raw.toolsCalled ?? [],
          expectedTools: testCase.expectedTool.split(",").map(t => t.trim()),
          response: raw.response ?? "",
          reasoning: evaluation.reasoning,
          correctToolCalled: evaluation.correctToolCalled,
          correctArguments: evaluation.correctArguments,
          responseHelpful: evaluation.responseHelpful,
          responseAccurate: evaluation.responseAccurate,
          allCriteriaMet: evaluation.allCriteriaMet,
          latencyMs: raw.latencyMs ?? 0,
          timestamp: Date.now(),
          errors: raw.errors,
        };
        results.push(result);
        console.log(`[quickTest] Judge ${raw.testId}: ${result.passed ? "PASS" : "FAIL"}`);
        if (!result.passed) {
          const reason = String(result.reasoning ?? "").slice(0, 800);
          console.log(`[quickTest] Judge ${raw.testId} reasoning (trunc): ${reason}`);
        }
      } catch (err: any) {
        results.push({
          testId: raw.testId,
          scenario: testCase.scenario,
          passed: false,
          error: err?.message ?? String(err),
        });
        console.log(`[quickTest] Judge ${raw.testId}: ERROR (${err?.message ?? String(err)})`);
      }
    }

    results.sort((a, b) => String(a?.testId ?? "").localeCompare(String(b?.testId ?? "")));
    const passed = results.filter(r => r?.passed).length;
    const failed = results.length - passed;

    console.log("\n[quickTest] Summary");
    console.log(`- total:  ${results.length}`);
    console.log(`- passed: ${passed}`);
    console.log(`- failed: ${failed}\n`);
    if (failed > 0) {
      const failedIds = results.filter(r => !r?.passed).map(r => r?.testId ?? "(unknown)");
      console.log(`[quickTest] Failed testIds: ${failedIds.join(", ")}`);
    }

    return {
      totalTests: results.length,
      passed,
      failed,
      results,
    };
  },
});

/**
 * Test a single query through the agent stack and return tool calls.
 */
export const testTool = action({
  args: {
    toolName: v.string(),
    userQuery: v.string(),
    useCoordinator: v.optional(v.boolean()),
  },
  returns: v.object({
    response: v.string(),
    toolsCalled: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    console.log(`\n[testTool] toolName=${args.toolName} coordinator=${args.useCoordinator !== false}`);
    console.log(`[testTool] query="${args.userQuery}"\n`);

    const result = await ctx.runAction(internal.domains.agents.fastAgentPanelStreaming.sendMessageInternal, {
      message: args.userQuery,
      useCoordinator: args.useCoordinator,
    });

    return {
      response: result.response,
      toolsCalled: result.toolsCalled,
    };
  },
});

/**
 * Test document tools specifically.
 */
export const testDocumentTools = action({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const tests = [
      { query: "Find documents about revenue", expectedTool: "findDocument" },
      { query: "Create a new document called 'Test Document'", expectedTool: "createDocument" },
      { query: "What is this document about?", expectedTool: "analyzeDocument" },
    ];

    const results: any[] = [];
    for (const test of tests) {
      const result = await ctx.runAction(internal.domains.agents.fastAgentPanelStreaming.sendMessageInternal, {
        message: test.query,
      });
      const toolUsed = result.toolsCalled[0] || "none";
      results.push({
        query: test.query,
        expectedTool: test.expectedTool,
        actualTool: toolUsed,
        correct: toolUsed === test.expectedTool,
        toolsCalled: result.toolsCalled,
      });
    }

    return results;
  },
});

/**
 * Test web search quickly (expects linkupSearch).
 */
export const testWebSearch = action({
  args: {},
  returns: v.object({
    response: v.string(),
    toolsCalled: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const query = "Search the web for latest AI developments";
    const result = await ctx.runAction(internal.domains.agents.fastAgentPanelStreaming.sendMessageInternal, {
      message: query,
      useCoordinator: true,
    });
    return { response: result.response, toolsCalled: result.toolsCalled };
  },
});

/**
 * Basic coordinator sanity: check delegation tools are invoked.
 */
export const testCoordinator = action({
  args: {},
  returns: v.object({
    totalTests: v.number(),
    passed: v.number(),
    failed: v.number(),
    results: v.array(v.any()),
  }),
  handler: async (ctx) => {
    const tests = [
      {
        name: "Docs+Videos",
        query: "Find me documents and videos about Google",
        expectedDelegations: ["delegateToDocumentAgent", "delegateToMediaAgent"],
      },
    ];

    const results: any[] = [];
    for (const t of tests) {
      const r = await ctx.runAction(internal.domains.agents.fastAgentPanelStreaming.sendMessageInternal, {
        message: t.query,
        useCoordinator: true,
      });
      const ok = t.expectedDelegations.every(d => r.toolsCalled.includes(d));
      results.push({
        test: t.name,
        query: t.query,
        expectedDelegations: t.expectedDelegations,
        toolsCalled: r.toolsCalled,
        passed: ok,
      });
    }

    const passed = results.filter(r => r.passed).length;
    return {
      totalTests: results.length,
      passed,
      failed: results.length - passed,
      results,
    };
  },
});

/**
 * Test a simple multi-step workflow.
 */
export const testWorkflow = action({
  args: {},
  returns: v.object({
    workflow: v.string(),
    toolsCalled: v.optional(v.array(v.string())),
    success: v.boolean(),
    response: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx) => {
    const workflow = "Find my revenue report, open it, and tell me what it's about";
    try {
      const result = await ctx.runAction(internal.domains.agents.fastAgentPanelStreaming.sendMessageInternal, {
        message: workflow,
        useCoordinator: true,
      });

      const hasFind = result.toolsCalled.includes("findDocument");
      const hasGet = result.toolsCalled.includes("getDocumentContent");
      const hasAnalyze = result.toolsCalled.includes("analyzeDocument");

      return {
        workflow,
        toolsCalled: result.toolsCalled,
        success: hasFind && hasGet && hasAnalyze,
        response: result.response,
      };
    } catch (err: any) {
      return {
        workflow,
        success: false,
        error: err?.message ?? String(err),
      };
    }
  },
});
