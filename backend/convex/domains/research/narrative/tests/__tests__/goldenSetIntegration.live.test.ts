// convex/domains/narrative/tests/__tests__/goldenSetIntegration.live.test.ts
// Live integration tests for the DRANE Newsroom pipeline with golden sets
//
// These tests run the FULL pipeline through Convex and require:
// 1. A deployed Convex backend (dev or prod)
// 2. A test user ID in the database
//
// Run with: LIVE_TEST=1 npm run test:run -- convex/domains/narrative/tests/__tests__/goldenSetIntegration.live.test.ts
// Or run via Convex CLI: npx convex run domains/narrative/tests/qaFramework:runFullSuite

import { describe, it, expect, beforeAll } from "vitest";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../_generated/api";

/**
 * Golden Set Integration Test Suite
 *
 * This suite runs live integration tests against a real Convex backend.
 * It exercises the full workflow→snapshot→revalidation cycle.
 *
 * Test Levels:
 * 1. Smoke Test - Single golden case, basic validation
 * 2. Deterministic Replay - Same input produces same output
 * 3. Full Suite - All golden cases with comprehensive metrics
 *
 * Prerequisites:
 * - Convex deployment (dev or prod)
 * - Test fixtures seeded (or using audit cases with injected news)
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONVEX_URL = process.env.VITE_CONVEX_URL || "";
const TEST_TIMEOUT = 120_000; // 2 minutes per test

// Skip live tests by default - enable with LIVE_TEST=1
const SKIP_LIVE_TESTS = process.env.LIVE_TEST !== "1";

// ============================================================================
// TYPES
// ============================================================================

interface GoldenSetResult {
  caseId: string;
  caseName: string;
  passed: boolean;
  score: number;
  metrics: {
    threadCountMatch: boolean;
    topicCoverage: number;
    factualAccuracy: number;
    citationCoverage: number;
    claimCoverage: number;
    unsupportedClaimRate: number;
    deterministicReplayMatch: boolean;
    idempotentReplayNoNewEvents: boolean;
  };
  errors: string[];
  warnings: string[];
  duration: number;
}

interface QASuiteResult {
  suiteId: string;
  totalTests: number;
  passed: number;
  failed: number;
  passRate: number;
  goldenSetResults: GoldenSetResult[];
  aggregateMetrics: {
    avgTopicCoverage: number;
    avgFactualAccuracy: number;
    avgCitationCoverage: number;
    avgClaimCoverage: number;
    avgScore: number;
  };
  criticalIssues: string[];
  warnings: string[];
  duration: number;
}

interface WorkflowValidationResult {
  workflowId: string;
  passed: boolean;
  metrics: {
    citationCoverage: number;
    claimCoverage: number;
    unsupportedClaimRate: number;
    evidenceArtifactHitRate: number;
  };
  counts: {
    threads: number;
    events: number;
    posts: number;
    claims: number;
    verifiableClaims: number;
    evidenceArtifactsReferenced: number;
  };
  snapshot: {
    hasSnapshot: boolean;
    configHash?: string;
    codeVersion?: string | null;
    toolReplayMode?: string;
  };
  errors: string[];
  warnings: string[];
}

// ============================================================================
// TESTS
// ============================================================================

describe.skipIf(SKIP_LIVE_TESTS)("Golden Set Integration (Live)", () => {
  let client: ConvexHttpClient;
  let testUserId: string;
  let convexAvailable: boolean;

  beforeAll(async () => {
    if (!CONVEX_URL) {
      console.warn("⚠️ VITE_CONVEX_URL not set. Skipping live tests.");
      convexAvailable = false;
      return;
    }

    try {
      client = new ConvexHttpClient(CONVEX_URL);
      convexAvailable = true;
    } catch (error) {
      console.warn("⚠️ Could not create Convex client:", error);
      convexAvailable = false;
      return;
    }

    // Get a test user
    try {
      const users = await client.query(api.domains.auth.users.list, { limit: 1 });
      if (users.length > 0) {
        testUserId = users[0]._id;
        console.log(`✓ Using test user: ${testUserId}`);
      } else {
        console.warn("⚠️ No users in database. Some tests may be skipped.");
      }
    } catch (error) {
      console.warn("⚠️ Could not fetch test user:", error);
    }
  });

  describe("Smoke Tests", () => {
    it(
      "should list available golden sets",
      async () => {
        if (!convexAvailable) return;

        const goldenSets = await client.action(
          api.domains.narrative.tests.qaFramework.listGoldenSets,
          {}
        );

        expect(goldenSets).toBeInstanceOf(Array);
        expect(goldenSets.length).toBeGreaterThan(0);

        // Check structure of first golden set
        const first = goldenSets[0];
        expect(first).toHaveProperty("id");
        expect(first).toHaveProperty("name");

        console.log(`✓ Found ${goldenSets.length} golden sets`);
      },
      TEST_TIMEOUT
    );

    it(
      "should validate a workflow run returns expected structure",
      async () => {
        if (!convexAvailable) return;

        // Use a non-existent workflow ID - should return graceful error
        const result = await client.action(
          api.domains.narrative.tests.qaFramework.validateWorkflowRun,
          { workflowId: "test_nonexistent_workflow" }
        ) as WorkflowValidationResult;

        expect(result).toHaveProperty("workflowId");
        expect(result).toHaveProperty("passed");
        expect(result).toHaveProperty("metrics");
        expect(result).toHaveProperty("errors");

        // Should fail gracefully with missing snapshot error
        expect(result.passed).toBe(false);
        expect(result.snapshot.hasSnapshot).toBe(false);
        console.log("✓ Validation returns expected structure for missing workflow");
      },
      TEST_TIMEOUT
    );
  });

  describe("Single Golden Set Execution", () => {
    it(
      "should run first golden set via runFullSuite and validate outputs",
      async () => {
        if (!convexAvailable || !testUserId) {
          console.log("⏭️ Skipping: no testUserId");
          return;
        }

        // Get first golden set
        const goldenSets = await client.action(
          api.domains.narrative.tests.qaFramework.listGoldenSets,
          {}
        ) as Array<{ id: string; name: string }>;
        const firstGoldenSetId = goldenSets[0]?.id;
        expect(firstGoldenSetId).toBeTruthy();

        console.log(`\n📊 Running single golden set: ${goldenSets[0]?.name}`);

        // Run single golden set via runFullSuite (evaluateGoldenSet is internal)
        const result = await client.action(
          api.domains.narrative.tests.qaFramework.runFullSuite,
          {
            userId: testUserId as any,
            goldenSetIds: [firstGoldenSetId],
            includeGuards: false,
          }
        ) as QASuiteResult;

        // Verify result structure
        expect(result.goldenSetResults).toHaveLength(1);
        const goldenResult = result.goldenSetResults[0];

        expect(goldenResult).toHaveProperty("caseId", firstGoldenSetId);
        expect(goldenResult).toHaveProperty("passed");
        expect(goldenResult).toHaveProperty("score");
        expect(goldenResult).toHaveProperty("metrics");
        expect(goldenResult).toHaveProperty("duration");

        // Log metrics for debugging
        console.log(`   Passed: ${goldenResult.passed}`);
        console.log(`   Score: ${goldenResult.score}`);
        console.log(`   Citation Coverage: ${goldenResult.metrics.citationCoverage}`);
        console.log(`   Claim Coverage: ${goldenResult.metrics.claimCoverage}`);
        console.log(`   Duration: ${goldenResult.duration}ms`);

        if (goldenResult.errors.length > 0) {
          console.log(`   Errors: ${goldenResult.errors.join(", ")}`);
        }
      },
      TEST_TIMEOUT
    );
  });

  describe("Deterministic Replay", () => {
    it(
      "should produce comparable scores for same golden set run twice",
      async () => {
        if (!convexAvailable || !testUserId) {
          console.log("⏭️ Skipping: no testUserId");
          return;
        }

        // Run the same golden set twice and compare scores
        const goldenSets = await client.action(
          api.domains.narrative.tests.qaFramework.listGoldenSets,
          {}
        ) as Array<{ id: string }>;
        const caseId = goldenSets[0]?.id;

        console.log(`\n🔄 Running deterministic replay test for ${caseId}...`);

        const result1 = await client.action(
          api.domains.narrative.tests.qaFramework.runFullSuite,
          { userId: testUserId as any, goldenSetIds: [caseId], includeGuards: false }
        ) as QASuiteResult;

        const result2 = await client.action(
          api.domains.narrative.tests.qaFramework.runFullSuite,
          { userId: testUserId as any, goldenSetIds: [caseId], includeGuards: false }
        ) as QASuiteResult;

        const score1 = result1.goldenSetResults[0]?.score ?? 0;
        const score2 = result2.goldenSetResults[0]?.score ?? 0;

        // Both runs should have comparable scores (within tolerance for any non-deterministic elements)
        const scoreDiff = Math.abs(score1 - score2);
        console.log(`   Run 1 Score: ${score1}`);
        console.log(`   Run 2 Score: ${score2}`);
        console.log(`   Score Diff: ${scoreDiff}`);
        expect(scoreDiff).toBeLessThan(10); // Allow 10% variance for timing-related metrics
      },
      TEST_TIMEOUT * 2
    );
  });

  describe("Full Suite Execution", () => {
    it(
      "should run full QA suite and return aggregate metrics",
      async () => {
        if (!convexAvailable || !testUserId) {
          console.log("⏭️ Skipping: no testUserId");
          return;
        }

        // Run with just first 2 golden sets to keep test time reasonable
        const goldenSets = await client.action(
          api.domains.narrative.tests.qaFramework.listGoldenSets,
          {}
        ) as Array<{ id: string }>;
        const firstTwoIds = goldenSets.slice(0, 2).map((g) => g.id);

        console.log(`\n📋 Running full QA suite with ${firstTwoIds.length} golden sets...`);

        const result = await client.action(
          api.domains.narrative.tests.qaFramework.runFullSuite,
          {
            userId: testUserId as any,
            goldenSetIds: firstTwoIds,
            includeGuards: false, // Skip guard tests for speed
          }
        ) as QASuiteResult;

        // Verify suite structure
        expect(result).toHaveProperty("suiteId");
        expect(result).toHaveProperty("totalTests");
        expect(result).toHaveProperty("passed");
        expect(result).toHaveProperty("failed");
        expect(result).toHaveProperty("passRate");
        expect(result).toHaveProperty("aggregateMetrics");
        expect(result).toHaveProperty("goldenSetResults");

        // Log aggregate metrics
        console.log(`\nQA Suite Results: ${result.suiteId}`);
        console.log(`  Total Tests: ${result.totalTests}`);
        console.log(`  Passed: ${result.passed} (${(result.passRate * 100).toFixed(1)}%)`);
        console.log(`  Failed: ${result.failed}`);
        console.log(`  Avg Score: ${result.aggregateMetrics.avgScore.toFixed(1)}`);
        console.log(
          `  Avg Citation Coverage: ${result.aggregateMetrics.avgCitationCoverage.toFixed(3)}`
        );
        console.log(
          `  Avg Claim Coverage: ${result.aggregateMetrics.avgClaimCoverage.toFixed(3)}`
        );
        console.log(`  Duration: ${result.duration}ms`);

        if (result.criticalIssues.length > 0) {
          console.log(`  Critical Issues: ${result.criticalIssues.join("; ")}`);
        }

        // Basic assertions
        expect(result.totalTests).toBeGreaterThan(0);
        expect(result.goldenSetResults.length).toBe(firstTwoIds.length);
      },
      TEST_TIMEOUT * 3
    );
  });

  describe("Snapshot Revalidation", () => {
    it(
      "should be able to revalidate a completed workflow",
      async () => {
        if (!convexAvailable || !testUserId) {
          console.log("⏭️ Skipping: no testUserId");
          return;
        }

        // First, run a golden set to create a workflow via runFullSuite
        const goldenSets = await client.action(
          api.domains.narrative.tests.qaFramework.listGoldenSets,
          {}
        ) as Array<{ id: string }>;
        const caseId = goldenSets[0]?.id;

        console.log(`\n🔍 Running golden set ${caseId} to create workflow snapshot...`);

        await client.action(
          api.domains.narrative.tests.qaFramework.runFullSuite,
          { userId: testUserId as any, goldenSetIds: [caseId], includeGuards: false }
        );

        // Now revalidate using the workflow ID pattern from golden sets
        // The workflowId format is: qa_{suiteId}_{caseId}_{weekNumber}_run1
        const workflowId = `qa_drane_audit_v1_${caseId}_2026-W04_run1`;

        console.log(`   Revalidating workflow: ${workflowId}`);

        const validation = await client.action(
          api.domains.narrative.tests.qaFramework.validateWorkflowRun,
          { workflowId }
        ) as WorkflowValidationResult;

        console.log(`\n📊 Revalidation Results:`);
        console.log(`   Has Snapshot: ${validation.snapshot.hasSnapshot}`);
        console.log(`   Passed: ${validation.passed}`);
        console.log(`   Config Hash: ${validation.snapshot.configHash}`);
        console.log(`   Citation Coverage: ${validation.metrics.citationCoverage}`);
        console.log(`   Claim Coverage: ${validation.metrics.claimCoverage}`);
        console.log(`   Events: ${validation.counts.events}`);
        console.log(`   Posts: ${validation.counts.posts}`);

        // The snapshot should exist from the previous golden set run
        expect(validation.snapshot.hasSnapshot).toBe(true);
        expect(validation.snapshot.configHash).toBeTruthy();
      },
      TEST_TIMEOUT * 2
    );
  });
});

// ============================================================================
// MANUAL TEST HELPERS
// ============================================================================

/**
 * Export test helpers for manual CLI testing
 *
 * Usage:
 *   npx convex run domains/narrative/tests/qaFramework:listGoldenSets
 *   npx convex run domains/narrative/tests/qaFramework:validateWorkflowRun --args '{"workflowId":"<id>"}'
 *   npx convex run domains/narrative/tests/qaFramework:runFullSuite --args '{"userId":"<user_id>"}'
 */
export const CLI_COMMANDS = {
  listGoldenSets: 'npx convex run domains/narrative/tests/qaFramework:listGoldenSets',
  validateWorkflow:
    'npx convex run domains/narrative/tests/qaFramework:validateWorkflowRun --args \'{"workflowId":"<workflow_id>"}\'',
  runSuite:
    'npx convex run domains/narrative/tests/qaFramework:runFullSuite --args \'{"userId":"<user_id>"}\'',
  runSingleGoldenSet:
    'npx convex run domains/narrative/tests/qaFramework:evaluateGoldenSet --args \'{"caseId":"audit_new_entity_000","userId":"<user_id>"}\'',
};
