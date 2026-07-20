/**
 * DeepTrace Runtime Research Cell — Tests
 *
 * Scenario-based tests covering:
 * - Trigger evaluation (confidence, coverage, sources, operator override)
 * - Branch planning strategies
 * - Branch result judging and ranking
 * - Result merging and deduplication
 * - Budget enforcement (branch count, round limit)
 */

import { describe, expect, it } from "vitest";

import {
  type BranchResult,
  type ResearchBranch,
  type TriggerInput,
  RESEARCH_CELL_DEFAULTS,
  judgeBranches,
  mergeBranchResults,
  planResearchBranches,
  shouldTriggerResearchCell,
} from "./researchCell";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBranchResult(overrides: Partial<BranchResult> = {}): BranchResult {
  return {
    branchId: "branch-0",
    strategy: "evidence_gap_fill",
    observedFacts: ["Fact A", "Fact B"],
    relationships: [
      {
        fromEntity: "company/acme",
        toEntity: "company/beta",
        type: "competitor",
        confidence: 0.8,
        evidence: "Market report Q1 2026",
      },
    ],
    hypothesis: "Acme is the market leader in segment X.",
    counterHypothesis: null,
    evidenceRefs: [{ label: "Q1 Market Report", href: "https://example.com/report", kind: "report" }],
    usefulness: 0.7,
    toolCallCount: 3,
    wallClockMs: 5000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Trigger evaluation
// ---------------------------------------------------------------------------

describe("shouldTriggerResearchCell", () => {
  it("skips when all metrics are healthy", () => {
    const input: TriggerInput = {
      confidence: 0.85,
      dimensionCoverage: 0.80,
      durableSourceCount: 5,
      operatorRequested: false,
    };
    const result = shouldTriggerResearchCell(input);
    expect(result.trigger).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("triggers when confidence is below threshold", () => {
    const input: TriggerInput = {
      confidence: 0.50,
      dimensionCoverage: 0.80,
      durableSourceCount: 5,
      operatorRequested: false,
    };
    const result = shouldTriggerResearchCell(input);
    expect(result.trigger).toBe(true);
    expect(result.reason).toContain("confidence");
    expect(result.reason).toContain("0.50");
  });

  it("triggers when dimension coverage is below threshold", () => {
    const input: TriggerInput = {
      confidence: 0.85,
      dimensionCoverage: 0.55,
      durableSourceCount: 5,
      operatorRequested: false,
    };
    const result = shouldTriggerResearchCell(input);
    expect(result.trigger).toBe(true);
    expect(result.reason).toContain("dimensionCoverage");
  });

  it("triggers when durable sources are too few", () => {
    const input: TriggerInput = {
      confidence: 0.85,
      dimensionCoverage: 0.80,
      durableSourceCount: 2,
      operatorRequested: false,
    };
    const result = shouldTriggerResearchCell(input);
    expect(result.trigger).toBe(true);
    expect(result.reason).toContain("durableSources");
  });

  it("triggers when operator explicitly requests", () => {
    const input: TriggerInput = {
      confidence: 0.99,
      dimensionCoverage: 0.99,
      durableSourceCount: 100,
      operatorRequested: true,
    };
    const result = shouldTriggerResearchCell(input);
    expect(result.trigger).toBe(true);
    expect(result.reason).toBe("operator_requested");
  });

  it("operator_requested takes priority over other triggers", () => {
    const input: TriggerInput = {
      confidence: 0.30,
      dimensionCoverage: 0.20,
      durableSourceCount: 0,
      operatorRequested: true,
    };
    const result = shouldTriggerResearchCell(input);
    expect(result.reason).toBe("operator_requested");
  });

  it("uses exact threshold boundaries correctly", () => {
    // At exactly the threshold — should NOT trigger
    const atThreshold: TriggerInput = {
      confidence: RESEARCH_CELL_DEFAULTS.confidenceThreshold,
      dimensionCoverage: RESEARCH_CELL_DEFAULTS.coverageThreshold,
      durableSourceCount: RESEARCH_CELL_DEFAULTS.minDurableSources,
      operatorRequested: false,
    };
    expect(shouldTriggerResearchCell(atThreshold).trigger).toBe(false);

    // Just below — should trigger
    const belowThreshold: TriggerInput = {
      confidence: RESEARCH_CELL_DEFAULTS.confidenceThreshold - 0.001,
      dimensionCoverage: RESEARCH_CELL_DEFAULTS.coverageThreshold,
      durableSourceCount: RESEARCH_CELL_DEFAULTS.minDurableSources,
      operatorRequested: false,
    };
    expect(shouldTriggerResearchCell(belowThreshold).trigger).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Branch planning
// ---------------------------------------------------------------------------

describe("planResearchBranches", () => {
  it("generates evidence_gap_fill branch for sparse sources", () => {
    const branches = planResearchBranches("durableSources 2 < 3", "company/acme", []);
    expect(branches.some((b) => b.strategy === "evidence_gap_fill")).toBe(true);
  });

  it("generates counter_hypothesis branch for low confidence", () => {
    const branches = planResearchBranches("confidence 0.50 < 0.65", "company/acme", ["fact1"]);
    expect(branches.some((b) => b.strategy === "counter_hypothesis")).toBe(true);
  });

  it("generates dimension_coverage branch for coverage gaps", () => {
    const branches = planResearchBranches("dimensionCoverage 0.55 < 0.70", "company/acme", []);
    expect(branches.some((b) => b.strategy === "dimension_coverage")).toBe(true);
  });

  it("generates all strategies for operator_requested", () => {
    const branches = planResearchBranches("operator_requested", "company/acme", ["fact1", "fact2"]);
    const strategies = branches.map((b) => b.strategy);
    expect(strategies).toContain("counter_hypothesis");
    expect(strategies).toContain("dimension_coverage");
  });

  it("respects maxBranches limit", () => {
    const branches = planResearchBranches("operator_requested", "company/acme", [], 2);
    expect(branches.length).toBeLessThanOrEqual(2);
  });

  it("sorts branches by priority (lower number = higher priority)", () => {
    const branches = planResearchBranches("operator_requested", "company/acme", []);
    for (let i = 1; i < branches.length; i++) {
      expect(branches[i].priority).toBeGreaterThanOrEqual(branches[i - 1].priority);
    }
  });

  it("includes entity key in branch queries", () => {
    const branches = planResearchBranches("confidence 0.50 < 0.65", "company/acme", []);
    expect(branches.every((b) => b.query.includes("company/acme"))).toBe(true);
  });

  it("fills remaining slots with source_diversification", () => {
    const branches = planResearchBranches("durableSources 2 < 3", "company/acme", [], 3);
    // Should have evidence_gap_fill + source_diversification at minimum
    const strategies = branches.map((b) => b.strategy);
    expect(strategies).toContain("source_diversification");
  });
});

// ---------------------------------------------------------------------------
// Branch result judging
// ---------------------------------------------------------------------------

describe("judgeBranches", () => {
  it("ranks branches by usefulness descending", () => {
    const results: BranchResult[] = [
      makeBranchResult({ branchId: "low", usefulness: 0.2 }),
      makeBranchResult({ branchId: "high", usefulness: 0.9 }),
      makeBranchResult({ branchId: "mid", usefulness: 0.5 }),
    ];
    const ranked = judgeBranches(results);
    expect(ranked[0].branchId).toBe("high");
    expect(ranked[1].branchId).toBe("mid");
    expect(ranked[2].branchId).toBe("low");
  });

  it("handles empty results", () => {
    expect(judgeBranches([])).toHaveLength(0);
  });

  it("handles single result", () => {
    const single = [makeBranchResult({ branchId: "only", usefulness: 0.6 })];
    const ranked = judgeBranches(single);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].branchId).toBe("only");
  });

  it("preserves all branch data after ranking", () => {
    const results = [
      makeBranchResult({ branchId: "a", usefulness: 0.3, hypothesis: "H1" }),
      makeBranchResult({ branchId: "b", usefulness: 0.8, hypothesis: "H2" }),
    ];
    const ranked = judgeBranches(results);
    expect(ranked[0].hypothesis).toBe("H2");
    expect(ranked[1].hypothesis).toBe("H1");
  });
});

// ---------------------------------------------------------------------------
// Result merging
// ---------------------------------------------------------------------------

describe("mergeBranchResults", () => {
  it("deduplicates facts across branches", () => {
    const results: BranchResult[] = [
      makeBranchResult({ observedFacts: ["Fact A", "Fact B"] }),
      makeBranchResult({ branchId: "branch-1", observedFacts: ["Fact B", "Fact C"] }),
    ];
    const merged = mergeBranchResults(results, "company/acme");
    expect(merged.observedFacts).toEqual(["Fact A", "Fact B", "Fact C"]);
  });

  it("deduplicates relationships by from+to+type key", () => {
    const rel = {
      fromEntity: "company/acme",
      toEntity: "company/beta",
      type: "competitor",
      confidence: 0.8,
      evidence: "Report 1",
    };
    const results: BranchResult[] = [
      makeBranchResult({ relationships: [rel] }),
      makeBranchResult({
        branchId: "branch-1",
        relationships: [{ ...rel, evidence: "Report 2" }],
      }),
    ];
    const merged = mergeBranchResults(results, "company/acme");
    // Should keep only one instance of the same relationship
    expect(merged.relationships).toHaveLength(1);
  });

  it("deduplicates evidence refs by label+href", () => {
    const ref = { label: "Report", href: "https://example.com", kind: "report" };
    const results: BranchResult[] = [
      makeBranchResult({ evidenceRefs: [ref] }),
      makeBranchResult({ branchId: "branch-1", evidenceRefs: [ref, { label: "Other", kind: "news" }] }),
    ];
    const merged = mergeBranchResults(results, "company/acme");
    expect(merged.evidenceBundle).toHaveLength(2);
  });

  it("picks strongest hypothesis from highest-ranked branch", () => {
    const results: BranchResult[] = [
      makeBranchResult({ branchId: "top", usefulness: 0.9, hypothesis: "Top hypothesis" }),
      makeBranchResult({ branchId: "low", usefulness: 0.3, hypothesis: "Low hypothesis" }),
    ];
    const merged = mergeBranchResults(results, "company/acme");
    expect(merged.strongestHypothesis).toBe("Top hypothesis");
  });

  it("generates recommendation from top branches", () => {
    const results: BranchResult[] = [
      makeBranchResult({ usefulness: 0.8, strategy: "evidence_gap_fill" }),
    ];
    const merged = mergeBranchResults(results, "company/acme");
    expect(merged.recommendation).toContain("company/acme");
    expect(merged.recommendation).toContain("evidence_gap_fill");
  });

  it("reports limitations when no facts are found", () => {
    const results: BranchResult[] = [
      makeBranchResult({ observedFacts: [], relationships: [], evidenceRefs: [], usefulness: 0.1 }),
    ];
    const merged = mergeBranchResults(results, "company/acme");
    expect(merged.limitations.some((l) => l.includes("No new facts"))).toBe(true);
    expect(merged.limitations.some((l) => l.includes("sparse"))).toBe(true);
  });

  it("reports low-usefulness branch count in limitations", () => {
    const results: BranchResult[] = [
      makeBranchResult({ branchId: "low1", usefulness: 0.1 }),
      makeBranchResult({ branchId: "low2", usefulness: 0.2 }),
      makeBranchResult({ branchId: "high", usefulness: 0.8 }),
    ];
    const merged = mergeBranchResults(results, "company/acme");
    expect(merged.limitations.some((l) => l.includes("2 branch(es)"))).toBe(true);
  });

  it("builds receipts for all branches", () => {
    const results: BranchResult[] = [
      makeBranchResult({ branchId: "a", strategy: "evidence_gap_fill", toolCallCount: 3, wallClockMs: 5000, usefulness: 0.7 }),
      makeBranchResult({ branchId: "b", strategy: "counter_hypothesis", toolCallCount: 2, wallClockMs: 3000, usefulness: 0.5 }),
    ];
    const merged = mergeBranchResults(results, "company/acme");
    expect(merged.receipts).toHaveLength(2);
    expect(merged.receipts[0].branchId).toBe("a");
    expect(merged.receipts[1].branchId).toBe("b");
  });

  it("handles empty branch results gracefully", () => {
    const merged = mergeBranchResults([], "company/acme");
    expect(merged.observedFacts).toHaveLength(0);
    expect(merged.relationships).toHaveLength(0);
    expect(merged.strongestHypothesis).toBeNull();
    expect(merged.recommendation).toBeNull();
    expect(merged.receipts).toHaveLength(0);
  });
});
