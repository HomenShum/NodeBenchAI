"use node";

/**
 * Hybrid Search Test Suite
 *
 * Run via Convex CLI: npx convex run tools/meta/hybridSearchTest:runAllTests
 */

import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { HybridSearchResult } from "./hybridSearch";

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  durationMs: number;
}

export const testHybridSearch = internalAction({
  args: {},
  handler: async (ctx): Promise<TestResult> => {
    const start = Date.now();
    const testName = "Hybrid Search Functionality";
    try {
      await ctx.runMutation(internal.tools.meta.hybridSearchQueries.clearToolSearchCache, {});
      const result = await ctx.runAction(
        internal.tools.meta.hybridSearch.hybridSearchTools,
        { query: "create document", limit: 5, includeDebug: true, skipCache: true }
      );
      if (result.results.length === 0) {
        return { name: testName, passed: false, message: "No results", durationMs: Date.now() - start };
      }
      const hasDocTool = result.results.some((r: HybridSearchResult) =>
        r.toolName.toLowerCase().includes("document") || r.toolName.toLowerCase().includes("create")
      );
      if (!hasDocTool) {
        return { name: testName, passed: false, message: `Got: ${result.results.map((r: HybridSearchResult) => r.toolName).join(", ")}`, durationMs: Date.now() - start };
      }
      return {
        name: testName, passed: true,
        message: `Found ${result.results.length} tools. Top: ${result.results[0].toolName}`,
        durationMs: Date.now() - start,
      };
    } catch (error: any) {
      return { name: testName, passed: false, message: error.message, durationMs: Date.now() - start };
    }
  },
});

export const testCacheBehavior = internalAction({
  args: {},
  handler: async (ctx): Promise<TestResult> => {
    const start = Date.now();
    const testName = "Cache Hit/Miss Behavior";
    try {
      await ctx.runMutation(internal.tools.meta.hybridSearchQueries.clearToolSearchCache, {});
      const testQuery = "search files test cache";
      const firstResult = await ctx.runAction(
        internal.tools.meta.hybridSearch.hybridSearchTools,
        { query: testQuery, limit: 3, includeDebug: true }
      );
      if (firstResult.cached === true) {
        return { name: testName, passed: false, message: "First query was cached", durationMs: Date.now() - start };
      }
      const secondResult = await ctx.runAction(
        internal.tools.meta.hybridSearch.hybridSearchTools,
        { query: testQuery, limit: 3, includeDebug: true }
      );
      if (secondResult.cached !== true) {
        return { name: testName, passed: false, message: "Second query not cached", durationMs: Date.now() - start };
      }
      return {
        name: testName, passed: true,
        message: `Cache works. Age: ${secondResult.debug?.cacheAge}ms`,
        durationMs: Date.now() - start,
      };
    } catch (error: any) {
      return { name: testName, passed: false, message: error.message, durationMs: Date.now() - start };
    }
  },
});

export const testSemanticSearch = internalAction({
  args: {},
  handler: async (ctx): Promise<TestResult> => {
    const start = Date.now();
    const testName = "Semantic Search Quality";
    try {
      await ctx.runMutation(internal.tools.meta.hybridSearchQueries.clearToolSearchCache, {});
      const result = await ctx.runAction(
        internal.tools.meta.hybridSearch.hybridSearchTools,
        { query: "make a doc", limit: 5, includeDebug: true, skipCache: true }
      );
      if (result.results.length === 0) {
        return { name: testName, passed: false, message: "No results", durationMs: Date.now() - start };
      }
      const hasSemantic = result.results.some((r: HybridSearchResult) =>
        r.toolName.toLowerCase().includes("document") || r.toolName.toLowerCase().includes("create")
      );
      if (!hasSemantic) {
        return { name: testName, passed: false, message: `Got: ${result.results.map((r: HybridSearchResult) => r.toolName).join(", ")}`, durationMs: Date.now() - start };
      }
      return {
        name: testName, passed: true,
        message: `Semantic: ${result.results[0].toolName}. Count: ${result.debug?.semanticCount || 0}`,
        durationMs: Date.now() - start,
      };
    } catch (error: any) {
      return { name: testName, passed: false, message: error.message, durationMs: Date.now() - start };
    }
  },
});

export const testCacheStats = internalAction({
  args: {},
  handler: async (ctx): Promise<TestResult> => {
    const start = Date.now();
    const testName = "Cache Statistics";
    try {
      for (const q of ["search docs", "create file"]) {
        await ctx.runAction(internal.tools.meta.hybridSearch.hybridSearchTools, { query: q, limit: 3 });
      }
      const stats = await ctx.runQuery(internal.tools.meta.hybridSearchQueries.getToolSearchCacheStats, {});
      if (typeof stats.totalEntries !== "number" || typeof stats.validEntries !== "number") {
        return { name: testName, passed: false, message: "Invalid stats", durationMs: Date.now() - start };
      }
      return {
        name: testName, passed: true,
        message: `Total: ${stats.totalEntries}, Valid: ${stats.validEntries}`,
        durationMs: Date.now() - start,
      };
    } catch (error: any) {
      return { name: testName, passed: false, message: error.message, durationMs: Date.now() - start };
    }
  },
});

export const runAllTests = internalAction({
  args: {},
  handler: async (ctx): Promise<{ summary: string; passed: number; failed: number; results: TestResult[] }> => {
    const results: TestResult[] = [];
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("  HYBRID SEARCH TEST SUITE");
    console.log("═══════════════════════════════════════════════════════════════");
    const tests = [
      internal.tools.meta.hybridSearchTest.testHybridSearch,
      internal.tools.meta.hybridSearchTest.testCacheBehavior,
      internal.tools.meta.hybridSearchTest.testSemanticSearch,
      internal.tools.meta.hybridSearchTest.testCacheStats,
    ];
    for (const test of tests) {
      const result = await ctx.runAction(test, {});
      results.push(result);
      console.log(`${result.passed ? "✅" : "❌"} ${result.name}: ${result.message} (${result.durationMs}ms)`);
    }
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
    return { summary: `${passed}/${results.length} tests passed`, passed, failed, results };
  },
});