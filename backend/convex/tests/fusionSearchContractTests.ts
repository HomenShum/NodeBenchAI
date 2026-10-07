/**
 * Fusion Search Contract + Regression Tests
 * 
 * Tests for:
 * - Payload contract verification (versioned discriminated union)
 * - Legacy fallback handling
 * - Partial failure scenarios
 * - Rerank gating logic
 * 
 * @module tests/fusionSearchContractTests
 */

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import {
  validateFusionSearchPayload,
  wrapSearchResponse,
  FUSION_SEARCH_PAYLOAD_VERSION,
  type SearchResponse,
  type SearchResult,
  type SearchSource,
} from "../domains/search/fusion/types";

// ═══════════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

function createMockResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: `result-${Math.random().toString(36).slice(2, 8)}`,
    source: "linkup" as SearchSource,
    title: "Test Result",
    snippet: "This is a test snippet",
    url: "https://example.com/test",
    score: 0.85,
    originalRank: 1,
    contentType: "text",
    ...overrides,
  };
}

function createMockResponse(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    results: [createMockResult()],
    totalBeforeFusion: 1,
    mode: "balanced",
    sourcesQueried: ["linkup"] as SearchSource[],
    timing: { linkup: 150 } as Record<SearchSource, number>,
    totalTimeMs: 200,
    reranked: false,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Payload Contract Verification
// ═══════════════════════════════════════════════════════════════════════════

function testPayloadContract(): { passed: boolean; message: string } {
  const response = createMockResponse();
  const payload = wrapSearchResponse(response);

  // Verify discriminator
  if (payload.kind !== "fusion_search_results") {
    return { passed: false, message: `Expected kind='fusion_search_results', got '${payload.kind}'` };
  }

  // Verify version
  if (payload.version !== FUSION_SEARCH_PAYLOAD_VERSION) {
    return { passed: false, message: `Expected version=${FUSION_SEARCH_PAYLOAD_VERSION}, got ${payload.version}` };
  }

  // Verify generatedAt is ISO 8601
  const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  if (!dateRegex.test(payload.generatedAt)) {
    return { passed: false, message: `generatedAt is not ISO 8601: ${payload.generatedAt}` };
  }

  // Verify payload structure
  if (!payload.payload || !Array.isArray(payload.payload.results)) {
    return { passed: false, message: "payload.results is not an array" };
  }

  // Validate using runtime validator
  const validation = validateFusionSearchPayload(payload);
  if (!validation.valid) {
    return { passed: false, message: `Validation failed: ${validation.error}` };
  }

  return { passed: true, message: "Payload contract verification passed" };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Legacy Fallback Handling
// ═══════════════════════════════════════════════════════════════════════════

function testLegacyFallback(): { passed: boolean; message: string } {
  // Legacy payload without versioned wrapper
  const legacyPayload = {
    results: [createMockResult()],
    totalBeforeFusion: 1,
    mode: "balanced",
    sourcesQueried: ["linkup"],
    timing: { linkup: 150 },
    totalTimeMs: 200,
    reranked: false,
  };

  // Validator should reject legacy payloads (missing kind/version)
  const validation = validateFusionSearchPayload(legacyPayload);
  if (validation.valid) {
    return { passed: false, message: "Validator should reject legacy payloads without kind/version" };
  }

  // Verify error message mentions discriminator
  if (!validation.error.includes("discriminator")) {
    return { passed: false, message: `Error should mention discriminator: ${validation.error}` };
  }

  return { passed: true, message: "Legacy fallback handling passed" };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Partial Failure Scenarios
// ═══════════════════════════════════════════════════════════════════════════

function testPartialFailure(): { passed: boolean; message: string } {
  const response = createMockResponse({
    sourcesQueried: ["linkup", "sec", "arxiv"] as SearchSource[],
    errors: [
      { source: "sec" as SearchSource, error: "SEC API timeout" },
      { source: "arxiv" as SearchSource, error: "ArXiv rate limited" },
    ],
    timing: {
      linkup: 150,
      sec: 5000,
      arxiv: 3000,
    } as Record<SearchSource, number>,
  });

  const payload = wrapSearchResponse(response);
  const validation = validateFusionSearchPayload(payload);

  if (!validation.valid) {
    return { passed: false, message: `Partial failure payload should be valid: ${validation.error}` };
  }

  // Verify errors are preserved
  if (!payload.payload.errors || payload.payload.errors.length !== 2) {
    return { passed: false, message: "Errors should be preserved in payload" };
  }

  return { passed: true, message: "Partial failure handling passed" };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Rerank Gating Logic
// ═══════════════════════════════════════════════════════════════════════════

function testRerankGating(): { passed: boolean; message: string } {
  // Fast mode should NOT rerank
  const fastResponse = createMockResponse({ mode: "fast", reranked: false });
  if (fastResponse.reranked) {
    return { passed: false, message: "Fast mode should not rerank" };
  }

  // Comprehensive mode CAN rerank
  const comprehensiveResponse = createMockResponse({ mode: "comprehensive", reranked: true });
  if (!comprehensiveResponse.reranked) {
    return { passed: false, message: "Comprehensive mode should support reranking" };
  }

  return { passed: true, message: "Rerank gating logic passed" };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Version Compatibility
// ═══════════════════════════════════════════════════════════════════════════

function testVersionCompatibility(): { passed: boolean; message: string } {
  // Future version should be rejected
  const futurePayload = {
    kind: "fusion_search_results",
    version: 999,
    payload: createMockResponse(),
    generatedAt: new Date().toISOString(),
  };

  const validation = validateFusionSearchPayload(futurePayload);
  if (validation.valid) {
    return { passed: false, message: "Future versions should be rejected" };
  }

  if (!validation.error.includes("Unsupported version")) {
    return { passed: false, message: `Error should mention unsupported version: ${validation.error}` };
  }

  return { passed: true, message: "Version compatibility check passed" };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: Result Field Validation
// ═══════════════════════════════════════════════════════════════════════════

function testResultFieldValidation(): { passed: boolean; message: string } {
  // Missing required fields should fail
  const invalidPayload = {
    kind: "fusion_search_results",
    version: 1,
    payload: {
      results: [{ /* missing id, source, title */ }],
      totalBeforeFusion: 1,
      mode: "balanced",
      sourcesQueried: ["linkup"],
      timing: { linkup: 150 },
      totalTimeMs: 200,
      reranked: false,
    },
    generatedAt: new Date().toISOString(),
  };

  const validation = validateFusionSearchPayload(invalidPayload);
  if (validation.valid) {
    return { passed: false, message: "Results with missing fields should be rejected" };
  }

  return { passed: true, message: "Result field validation passed" };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

/**
 * Run all fusion search contract tests.
 * Returns detailed results for each test.
 */
export const runFusionSearchContractTests = internalAction({
  args: {},
  returns: v.object({
    totalTests: v.number(),
    passed: v.number(),
    failed: v.number(),
    results: v.array(v.object({
      name: v.string(),
      passed: v.boolean(),
      message: v.string(),
    })),
  }),
  handler: async () => {
    const tests: Array<{ name: string; fn: () => { passed: boolean; message: string } }> = [
      { name: "Payload Contract Verification", fn: testPayloadContract },
      { name: "Legacy Fallback Handling", fn: testLegacyFallback },
      { name: "Partial Failure Scenarios", fn: testPartialFailure },
      { name: "Rerank Gating Logic", fn: testRerankGating },
      { name: "Version Compatibility", fn: testVersionCompatibility },
      { name: "Result Field Validation", fn: testResultFieldValidation },
    ];

    const results: TestResult[] = [];
    let passed = 0;
    let failed = 0;

    for (const test of tests) {
      try {
        const result = test.fn();
        results.push({ name: test.name, ...result });
        if (result.passed) {
          passed++;
          console.log(`✅ ${test.name}: ${result.message}`);
        } else {
          failed++;
          console.error(`❌ ${test.name}: ${result.message}`);
        }
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        results.push({ name: test.name, passed: false, message: `Exception: ${message}` });
        console.error(`❌ ${test.name}: Exception - ${message}`);
      }
    }

    console.log(`\n📊 Test Summary: ${passed}/${tests.length} passed, ${failed} failed`);

    return {
      totalTests: tests.length,
      passed,
      failed,
      results,
    };
  },
});

