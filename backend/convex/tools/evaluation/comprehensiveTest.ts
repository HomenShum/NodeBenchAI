// convex/tools/evaluation/comprehensiveTest.ts
"use node";

import { action } from "../../_generated/server";
import { v } from "convex/values";
import { internal, api } from "../../_generated/api";
import { allTestCases } from "./testCases";

/**
 * Comprehensive test runner - runs ALL 33 tests in parallel
 * Uses the same evaluation logic as quick tests
 */
export const runComprehensiveTest = action({
  args: {
    categories: v.optional(v.array(v.string())),
  },
  returns: v.object({
    totalTests: v.number(),
    passed: v.number(),
    failed: v.number(),
    results: v.array(v.any()),
  }),
  handler: async (ctx, args): Promise<{
    totalTests: number;
    passed: number;
    failed: number;
    results: any[];
  }> => {
    console.log("\n🚀 Running Comprehensive Test Suite (33 tests in parallel)\n");

    // Get test user ID
    const testUser = await ctx.runQuery(api.domains.utilities.seedGoldenDataset.getTestUser, {});
    if (!testUser) {
      throw new Error("No test user found. Please run seedGoldenDataset:seedAll first.");
    }
    const testUserId = testUser._id;
    console.log(`Using test user: ${testUserId}\n`);

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
          userId: testUserId,
        });
        return result;
      } catch (error: any) {
        console.error(`❌ Test ${testCase.id} failed:`, error.message);
        return {
          testId: testCase.id,
          category: testCase.category,
          scenario: testCase.scenario,
          userQuery: testCase.userQuery,
          passed: false,
          toolsCalled: [],
          expectedTools: [testCase.expectedTool],
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
        };
      }
    });

    // Wait for all tests to complete
    const results = await Promise.all(testPromises);

    // Calculate summary
    let passed = 0;
    let failed = 0;

    for (const result of results) {
      if (result.passed) {
        passed++;
      } else {
        failed++;
      }
    }

    // Print summary
    console.log(`\n${"=".repeat(80)}`);
    console.log("📊 COMPREHENSIVE TEST SUMMARY");
    console.log("=".repeat(80));
    console.log(`Total Tests: ${testCases.length}`);
    console.log(`✅ Passed: ${passed} (${((passed / testCases.length) * 100).toFixed(1)}%)`);
    console.log(`❌ Failed: ${failed} (${((failed / testCases.length) * 100).toFixed(1)}%)`);
    
    // Calculate average latency
    const totalLatency = results.reduce((sum: number, r: any) => sum + r.latencyMs, 0);
    const avgLatency = totalLatency / results.length;
    console.log(`⚡ Average Latency: ${Math.round(avgLatency)}ms`);

    // Group by category
    const categoryStats: Record<string, { total: number; passed: number }> = {};
    for (const result of results) {
      if (!categoryStats[result.category]) {
        categoryStats[result.category] = { total: 0, passed: 0 };
      }
      categoryStats[result.category].total++;
      if (result.passed) {
        categoryStats[result.category].passed++;
      }
    }

    console.log(`\n${"=".repeat(80)}`);
    console.log("📂 CATEGORY BREAKDOWN");
    console.log("=".repeat(80));
    for (const [category, stats] of Object.entries(categoryStats)) {
      const passRate = ((stats.passed / stats.total) * 100).toFixed(1);
      const status = stats.passed === stats.total ? "✅" : stats.passed > 0 ? "⚠️" : "❌";
      console.log(`${status} ${category}: ${stats.passed}/${stats.total} (${passRate}%)`);
    }

    // Show failed tests
    const failedTests = results.filter((r: any) => !r.passed);
    if (failedTests.length > 0) {
      console.log(`\n${"=".repeat(80)}`);
      console.log("❌ FAILED TESTS");
      console.log("=".repeat(80));
      for (const test of failedTests) {
        console.log(`\n${test.testId}: ${test.scenario}`);
        console.log(`  Tool: ${test.correctToolCalled ? "✓" : "✗"}, Args: ${test.correctArguments ? "✓" : "✗"}, Helpful: ${test.responseHelpful ? "✓" : "✗"}, Accurate: ${test.responseAccurate ? "✓" : "✗"}`);
        console.log(`  Reason: ${test.reasoning}`);
      }
    }

    console.log(`\n${"=".repeat(80)}\n`);

    return {
      totalTests: testCases.length,
      passed,
      failed,
      results,
    };
  },
});

/**
 * Run tests for a specific category
 */
export const runCategoryTest = action({
  args: {
    category: v.string(),
  },
  returns: v.object({
    totalTests: v.number(),
    passed: v.number(),
    failed: v.number(),
    results: v.array(v.any()),
  }),
  handler: async (ctx, args): Promise<{
    totalTests: number;
    passed: number;
    failed: number;
    results: any[];
  }> => {
    return await ctx.runAction(api.tools.evaluation.comprehensiveTest.runComprehensiveTest, {
      categories: [args.category],
    });
  },
});

/**
 * List all available test categories
 */
export const listCategories = action({
  args: {},
  returns: v.array(v.string()),
  handler: async () => {
    const categories = new Set(allTestCases.map(t => t.category));
    return Array.from(categories).sort();
  },
});

/**
 * Get test statistics
 */
export const getTestStats = action({
  args: {},
  returns: v.object({
    totalTests: v.number(),
    categories: v.array(v.object({
      name: v.string(),
      count: v.number(),
    })),
  }),
  handler: async () => {
    const categoryCount: Record<string, number> = {};
    
    for (const test of allTestCases) {
      categoryCount[test.category] = (categoryCount[test.category] || 0) + 1;
    }

    const categories = Object.entries(categoryCount)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      totalTests: allTestCases.length,
      categories,
    };
  },
});

