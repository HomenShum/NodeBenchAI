// convex/domains/narrative/tests/__tests__/workflowValidation.test.ts
// Unit tests for workflow snapshot persistence and revalidation cycle
//
// This suite tests the core validation logic WITHOUT requiring a live Convex backend.
// It mocks the database queries to verify the validation calculations work correctly.

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Workflow Validation Test Suite
 *
 * Tests the snapshot→revalidation cycle used by the DRANE Newsroom pipeline.
 * These are pure unit tests that verify:
 * 1. Snapshot structure is correctly persisted
 * 2. Validation metrics are calculated correctly
 * 3. Pass/fail logic works as expected
 * 4. Edge cases are handled (empty outputs, missing data, etc.)
 */

// ============================================================================
// MOCK DATA FACTORIES
// ============================================================================

interface MockSnapshot {
  version: number;
  kind: string;
  weekNumber: string;
  entityKeys: string[];
  configHash: string;
  codeVersion: string | null;
  toolReplayMode: string;
  published: {
    threadDocIds: string[];
    eventDocIds: string[];
    postDocIds: string[];
    stableEventIds: string[];
    searchLogIds: string[];
  };
  dedupDecisions: unknown[];
  stats: {
    newsItemsFound: number;
    claimsRetrieved: number;
    existingThreads: number;
    shiftsDetected: number;
    narrativesPublished: number;
    searchesLogged: number;
    citationsGenerated: number;
  };
  errors: string[];
  capturedAt: number;
}

interface MockEvent {
  eventId: string;
  threadId: string;
  headline: string;
  citationIds: string[];
  claimSet: Array<{
    claim: string;
    kind: "verifiable" | "interpretation" | "prediction";
    evidenceArtifactIds: string[];
  }>;
}

interface MockPost {
  postId: string;
  threadId: string;
  content: string;
  citations: string[];
}

interface MockEvidenceArtifact {
  artifactId: string;
  url: string;
  contentHash: string;
}

function createMockSnapshot(overrides: Partial<MockSnapshot> = {}): MockSnapshot {
  return {
    version: 3,
    kind: "drane_newsroom_snapshot",
    weekNumber: "2026-W04",
    entityKeys: ["entity:test_company"],
    configHash: "abc123",
    codeVersion: "test-sha",
    toolReplayMode: "live",
    published: {
      threadDocIds: ["thread_1"],
      eventDocIds: ["event_1", "event_2"],
      postDocIds: ["post_1"],
      stableEventIds: ["stable_1", "stable_2"],
      searchLogIds: ["search_1"],
    },
    dedupDecisions: [],
    stats: {
      newsItemsFound: 5,
      claimsRetrieved: 10,
      existingThreads: 0,
      shiftsDetected: 2,
      narrativesPublished: 1,
      searchesLogged: 3,
      citationsGenerated: 4,
    },
    errors: [],
    capturedAt: Date.now(),
    ...overrides,
  };
}

function createMockEvent(overrides: Partial<MockEvent> = {}): MockEvent {
  return {
    eventId: "event_1",
    threadId: "thread_1",
    headline: "Test Company Raises Series A",
    citationIds: ["citation_1"],
    claimSet: [
      {
        claim: "Test Company raised $10M",
        kind: "verifiable",
        evidenceArtifactIds: ["artifact_1"],
      },
    ],
    ...overrides,
  };
}

function createMockPost(overrides: Partial<MockPost> = {}): MockPost {
  return {
    postId: "post_1",
    threadId: "thread_1",
    content: "Summary of the funding round...",
    citations: ["citation_1"],
    ...overrides,
  };
}

function createMockEvidenceArtifact(
  overrides: Partial<MockEvidenceArtifact> = {}
): MockEvidenceArtifact {
  return {
    artifactId: "artifact_1",
    url: "https://news.example.com/funding",
    contentHash: "hash123",
    ...overrides,
  };
}

// ============================================================================
// VALIDATION LOGIC (extracted for testing)
// ============================================================================

interface ValidationInput {
  snapshot: MockSnapshot | null;
  events: MockEvent[];
  posts: MockPost[];
  evidenceArtifacts: MockEvidenceArtifact[];
  minCitationCoverage?: number;
  minClaimCoverage?: number;
  maxUnsupportedClaimRate?: number;
}

interface ValidationResult {
  passed: boolean;
  metrics: {
    citationCoverage: number;
    claimCoverage: number;
    unsupportedClaimRate: number;
    evidenceArtifactHitRate: number;
  };
  counts: {
    events: number;
    posts: number;
    verifiableClaims: number;
    evidenceArtifactsReferenced: number;
  };
  errors: string[];
  warnings: string[];
}

/**
 * Pure validation function that mirrors qaFramework.validateWorkflowRun logic
 * but can be tested without Convex context.
 */
function validateWorkflowSnapshot(input: ValidationInput): ValidationResult {
  const {
    snapshot,
    events,
    posts,
    evidenceArtifacts,
    minCitationCoverage = 0.8,
    minClaimCoverage = 0.85,
    maxUnsupportedClaimRate = 0.15,
  } = input;

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!snapshot) {
    return {
      passed: false,
      metrics: {
        citationCoverage: 0,
        claimCoverage: 0,
        unsupportedClaimRate: 1,
        evidenceArtifactHitRate: 0,
      },
      counts: { events: 0, posts: 0, verifiableClaims: 0, evidenceArtifactsReferenced: 0 },
      errors: ["Missing workflow snapshot"],
      warnings: [],
    };
  }

  // Calculate citation coverage
  const totalNarrativeObjects = events.length + posts.length;
  const citedEvents = events.filter(
    (e) => Array.isArray(e.citationIds) && e.citationIds.length > 0
  ).length;
  const citedPosts = posts.filter(
    (p) => Array.isArray(p.citations) && p.citations.length > 0
  ).length;
  const citationCoverage =
    totalNarrativeObjects > 0 ? (citedEvents + citedPosts) / totalNarrativeObjects : 1;

  // Calculate claim coverage
  const verifiableClaims: Array<{
    claim: string;
    evidenceArtifactIds: string[];
  }> = [];
  const allEvidenceIds = new Set<string>();

  for (const e of events) {
    const claimSet = Array.isArray(e.claimSet) ? e.claimSet : [];
    for (const c of claimSet) {
      if (c.kind === "interpretation" || c.kind === "prediction") continue;
      verifiableClaims.push({
        claim: c.claim,
        evidenceArtifactIds: c.evidenceArtifactIds ?? [],
      });
      for (const id of c.evidenceArtifactIds ?? []) {
        allEvidenceIds.add(id);
      }
    }
  }

  const foundEvidence = new Set(evidenceArtifacts.map((a) => a.artifactId));
  let claimsWithEvidence = 0;
  let claimsWithoutEvidence = 0;
  let evidenceRefs = 0;
  let evidenceHits = 0;

  for (const c of verifiableClaims) {
    if (c.evidenceArtifactIds.length === 0) {
      claimsWithoutEvidence++;
      continue;
    }
    evidenceRefs += c.evidenceArtifactIds.length;
    const hits = c.evidenceArtifactIds.filter((id) => foundEvidence.has(id)).length;
    evidenceHits += hits;
    if (hits > 0) claimsWithEvidence++;
    else claimsWithoutEvidence++;
  }

  const totalVerifiableClaims = verifiableClaims.length;
  const claimCoverage =
    totalVerifiableClaims > 0 ? claimsWithEvidence / totalVerifiableClaims : 1;
  const unsupportedClaimRate =
    totalVerifiableClaims > 0 ? claimsWithoutEvidence / totalVerifiableClaims : 0;
  const evidenceArtifactHitRate = evidenceRefs > 0 ? evidenceHits / evidenceRefs : 1;

  // Check thresholds
  if (citationCoverage < minCitationCoverage) {
    errors.push(
      `Citation coverage ${citationCoverage.toFixed(3)} < ${minCitationCoverage}`
    );
  }
  if (claimCoverage < minClaimCoverage) {
    errors.push(`Claim coverage ${claimCoverage.toFixed(3)} < ${minClaimCoverage}`);
  }
  if (unsupportedClaimRate > maxUnsupportedClaimRate) {
    errors.push(
      `Unsupported claim rate ${unsupportedClaimRate.toFixed(3)} > ${maxUnsupportedClaimRate}`
    );
  }
  if (events.length === 0 && posts.length === 0) {
    warnings.push("No events or posts were found for this workflow snapshot.");
  }

  return {
    passed: errors.length === 0,
    metrics: {
      citationCoverage,
      claimCoverage,
      unsupportedClaimRate,
      evidenceArtifactHitRate,
    },
    counts: {
      events: events.length,
      posts: posts.length,
      verifiableClaims: totalVerifiableClaims,
      evidenceArtifactsReferenced: allEvidenceIds.size,
    },
    errors,
    warnings,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe("Workflow Validation", () => {
  describe("Snapshot Structure", () => {
    it("should create valid snapshot with all required fields", () => {
      const snapshot = createMockSnapshot();

      expect(snapshot.version).toBe(3);
      expect(snapshot.kind).toBe("drane_newsroom_snapshot");
      expect(snapshot.weekNumber).toMatch(/^\d{4}-W\d{2}$/);
      expect(snapshot.entityKeys).toBeInstanceOf(Array);
      expect(snapshot.configHash).toBeTruthy();
      expect(snapshot.published.threadDocIds).toBeInstanceOf(Array);
      expect(snapshot.published.eventDocIds).toBeInstanceOf(Array);
      expect(snapshot.published.stableEventIds).toBeInstanceOf(Array);
    });

    it("should track errors in snapshot when pipeline fails", () => {
      const snapshot = createMockSnapshot({
        errors: ["Pipeline stage 3 failed: timeout"],
      });

      expect(snapshot.errors).toHaveLength(1);
      expect(snapshot.errors[0]).toContain("timeout");
    });

    it("should include dedup decisions for audit trail", () => {
      const snapshot = createMockSnapshot({
        dedupDecisions: [
          { newsItemUrl: "https://example.com/1", action: "merged", reason: "duplicate" },
        ],
      });

      expect(snapshot.dedupDecisions).toHaveLength(1);
    });
  });

  describe("Citation Coverage Calculation", () => {
    it("should calculate 100% coverage when all events have citations", () => {
      const result = validateWorkflowSnapshot({
        snapshot: createMockSnapshot(),
        events: [
          createMockEvent({ citationIds: ["c1"] }),
          createMockEvent({ eventId: "event_2", citationIds: ["c2"] }),
        ],
        posts: [createMockPost({ citations: ["c3"] })],
        evidenceArtifacts: [createMockEvidenceArtifact()],
      });

      expect(result.metrics.citationCoverage).toBe(1);
    });

    it("should calculate partial coverage when some events lack citations", () => {
      const result = validateWorkflowSnapshot({
        snapshot: createMockSnapshot(),
        events: [
          createMockEvent({ citationIds: ["c1"] }),
          createMockEvent({ eventId: "event_2", citationIds: [] }),
        ],
        posts: [],
        evidenceArtifacts: [createMockEvidenceArtifact()],
      });

      expect(result.metrics.citationCoverage).toBe(0.5);
    });

    it("should handle empty events gracefully", () => {
      const result = validateWorkflowSnapshot({
        snapshot: createMockSnapshot(),
        events: [],
        posts: [],
        evidenceArtifacts: [],
      });

      expect(result.metrics.citationCoverage).toBe(1); // No items = 100% by convention
      expect(result.warnings).toContain(
        "No events or posts were found for this workflow snapshot."
      );
    });
  });

  describe("Claim Coverage Calculation", () => {
    it("should calculate 100% coverage when all verifiable claims have evidence", () => {
      const result = validateWorkflowSnapshot({
        snapshot: createMockSnapshot(),
        events: [
          createMockEvent({
            claimSet: [
              { claim: "Claim 1", kind: "verifiable", evidenceArtifactIds: ["artifact_1"] },
            ],
          }),
        ],
        posts: [],
        evidenceArtifacts: [createMockEvidenceArtifact({ artifactId: "artifact_1" })],
      });

      expect(result.metrics.claimCoverage).toBe(1);
      expect(result.metrics.evidenceArtifactHitRate).toBe(1);
    });

    it("should exclude interpretation and prediction claims from coverage", () => {
      const result = validateWorkflowSnapshot({
        snapshot: createMockSnapshot(),
        events: [
          createMockEvent({
            claimSet: [
              { claim: "Fact", kind: "verifiable", evidenceArtifactIds: ["artifact_1"] },
              { claim: "Opinion", kind: "interpretation", evidenceArtifactIds: [] },
              { claim: "Forecast", kind: "prediction", evidenceArtifactIds: [] },
            ],
          }),
        ],
        posts: [],
        evidenceArtifacts: [createMockEvidenceArtifact({ artifactId: "artifact_1" })],
      });

      expect(result.counts.verifiableClaims).toBe(1); // Only the verifiable claim
      expect(result.metrics.claimCoverage).toBe(1);
    });

    it("should detect missing evidence artifacts", () => {
      const result = validateWorkflowSnapshot({
        snapshot: createMockSnapshot(),
        events: [
          createMockEvent({
            claimSet: [
              {
                claim: "Claim 1",
                kind: "verifiable",
                evidenceArtifactIds: ["artifact_missing"],
              },
            ],
          }),
        ],
        posts: [],
        evidenceArtifacts: [], // No evidence artifacts exist
      });

      expect(result.metrics.claimCoverage).toBe(0);
      expect(result.metrics.evidenceArtifactHitRate).toBe(0);
    });
  });

  describe("Pass/Fail Thresholds", () => {
    it("should pass when all metrics meet thresholds", () => {
      const result = validateWorkflowSnapshot({
        snapshot: createMockSnapshot(),
        events: [
          createMockEvent({
            citationIds: ["c1"],
            claimSet: [
              { claim: "Claim", kind: "verifiable", evidenceArtifactIds: ["artifact_1"] },
            ],
          }),
        ],
        posts: [],
        evidenceArtifacts: [createMockEvidenceArtifact()],
        minCitationCoverage: 0.8,
        minClaimCoverage: 0.85,
        maxUnsupportedClaimRate: 0.15,
      });

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should fail when citation coverage below threshold", () => {
      const result = validateWorkflowSnapshot({
        snapshot: createMockSnapshot(),
        events: [
          createMockEvent({ citationIds: [] }),
          createMockEvent({ eventId: "event_2", citationIds: [] }),
        ],
        posts: [],
        evidenceArtifacts: [],
        minCitationCoverage: 0.8,
      });

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes("Citation coverage"))).toBe(true);
    });

    it("should fail when unsupported claim rate exceeds threshold", () => {
      const result = validateWorkflowSnapshot({
        snapshot: createMockSnapshot(),
        events: [
          createMockEvent({
            citationIds: ["c1"],
            claimSet: [
              { claim: "Claim 1", kind: "verifiable", evidenceArtifactIds: [] }, // No evidence
              { claim: "Claim 2", kind: "verifiable", evidenceArtifactIds: [] },
              { claim: "Claim 3", kind: "verifiable", evidenceArtifactIds: [] },
            ],
          }),
        ],
        posts: [],
        evidenceArtifacts: [],
        maxUnsupportedClaimRate: 0.15,
      });

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes("Unsupported claim rate"))).toBe(true);
    });

    it("should use custom thresholds when provided", () => {
      const result = validateWorkflowSnapshot({
        snapshot: createMockSnapshot(),
        events: [createMockEvent({ citationIds: ["c1"] })],
        posts: [],
        evidenceArtifacts: [createMockEvidenceArtifact()],
        minCitationCoverage: 0.5, // Lower threshold
        minClaimCoverage: 0.5,
        maxUnsupportedClaimRate: 0.5,
      });

      expect(result.passed).toBe(true);
    });
  });

  describe("Missing Snapshot Handling", () => {
    it("should fail gracefully when snapshot is missing", () => {
      const result = validateWorkflowSnapshot({
        snapshot: null,
        events: [],
        posts: [],
        evidenceArtifacts: [],
      });

      expect(result.passed).toBe(false);
      expect(result.errors).toContain("Missing workflow snapshot");
      expect(result.metrics.citationCoverage).toBe(0);
      expect(result.metrics.claimCoverage).toBe(0);
      expect(result.metrics.unsupportedClaimRate).toBe(1);
    });
  });

  describe("Revalidation Consistency", () => {
    it("should produce identical results when validating same snapshot twice", () => {
      const snapshot = createMockSnapshot();
      const events = [createMockEvent()];
      const posts = [createMockPost()];
      const evidenceArtifacts = [createMockEvidenceArtifact()];

      const result1 = validateWorkflowSnapshot({
        snapshot,
        events,
        posts,
        evidenceArtifacts,
      });
      const result2 = validateWorkflowSnapshot({
        snapshot,
        events,
        posts,
        evidenceArtifacts,
      });

      expect(result1.passed).toBe(result2.passed);
      expect(result1.metrics).toEqual(result2.metrics);
      expect(result1.counts).toEqual(result2.counts);
    });
  });
});

describe("Snapshot Persistence", () => {
  describe("Config Hash", () => {
    it("should generate consistent hash for same config", () => {
      // FNV-1a hash implementation (matches workflowTrace.ts)
      function fnv1a32Hex(str: string): string {
        let hash = 2166136261;
        for (let i = 0; i < str.length; i++) {
          hash ^= str.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, "0");
      }

      const config1 = { scout: { maxItems: 10 }, analyst: { useHeuristic: true } };
      const config2 = { scout: { maxItems: 10 }, analyst: { useHeuristic: true } };

      const hash1 = fnv1a32Hex(JSON.stringify(config1));
      const hash2 = fnv1a32Hex(JSON.stringify(config2));

      expect(hash1).toBe(hash2);
    });

    it("should generate different hash for different config", () => {
      function fnv1a32Hex(str: string): string {
        let hash = 2166136261;
        for (let i = 0; i < str.length; i++) {
          hash ^= str.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, "0");
      }

      const config1 = { scout: { maxItems: 10 } };
      const config2 = { scout: { maxItems: 20 } };

      const hash1 = fnv1a32Hex(JSON.stringify(config1));
      const hash2 = fnv1a32Hex(JSON.stringify(config2));

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("Week Number Format", () => {
    it("should generate ISO week number correctly", () => {
      function getIsoWeekNumber(timestamp: number): string {
        const date = new Date(timestamp);
        const d = new Date(
          Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
        );
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil(
          ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
        );
        return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, "0")}`;
      }

      // Test specific dates
      const jan1_2026 = new Date("2026-01-01T00:00:00Z").getTime();
      expect(getIsoWeekNumber(jan1_2026)).toBe("2026-W01");

      const jan27_2026 = new Date("2026-01-27T00:00:00Z").getTime();
      expect(getIsoWeekNumber(jan27_2026)).toBe("2026-W05");
    });
  });
});
