/**
 * Evidence Scoring — scenario-based tests.
 *
 * Scenarios model real-world signal patterns:
 *   - SEC filing signal (high confidence, multiple government sources)
 *   - Blog-sourced rumor (low confidence, single source, no hard numbers)
 *   - Multi-source press release (medium confidence, corroborated but no primary gov source)
 *   - Edge cases: empty checklist, missing fields, all-true, all-false
 *
 * See: .claude/rules/scenario_testing.md
 */

import { describe, it, expect } from "vitest";
import {
  deriveConfidence,
  countPassingChecks,
  computeEvidenceChecklist,
  significanceRank,
  CONFIDENCE_COLORS,
} from "./evidenceScoring";
import type { EvidenceChecklist, BriefSignal } from "./briefTypes";

// ─── Scenario: SEC Filing Signal (High Confidence) ─────────────────────

describe("SEC Filing Signal scenario", () => {
  const checklist: EvidenceChecklist = {
    hasPrimarySource: true,      // sec.gov
    hasCorroboration: true,      // sec.gov + reuters.com
    hasFalsifiableClaim: true,   // "revenue will exceed $10B"
    hasQuantitativeData: true,   // "$10B"
    hasNamedAttribution: true,   // "John Smith, CFO"
    isReproducible: true,        // https://sec.gov/...
  };

  it("counts 6/6 passing checks", () => {
    expect(countPassingChecks(checklist)).toBe(6);
  });

  it("derives 'verified' confidence", () => {
    expect(deriveConfidence({ evidenceChecklist: checklist })).toBe("verified");
  });

  it("color lookup returns green", () => {
    const conf = deriveConfidence({ evidenceChecklist: checklist });
    expect(CONFIDENCE_COLORS[conf].text).toBe("#4ade80");
    expect(CONFIDENCE_COLORS[conf].label).toBe("Verified");
  });
});

// ─── Scenario: Blog Rumor Signal (Low Confidence) ──────────────────────

describe("Blog Rumor Signal scenario", () => {
  const checklist: EvidenceChecklist = {
    hasPrimarySource: false,     // random blog
    hasCorroboration: false,     // single source
    hasFalsifiableClaim: false,  // vague speculation
    hasQuantitativeData: false,  // no numbers
    hasNamedAttribution: false,  // "sources say"
    isReproducible: true,        // blog URL works
  };

  it("counts 1/6 passing checks", () => {
    expect(countPassingChecks(checklist)).toBe(1);
  });

  it("derives 'speculative' confidence", () => {
    expect(deriveConfidence({ evidenceChecklist: checklist })).toBe("speculative");
  });

  it("color lookup returns red", () => {
    const conf = deriveConfidence({ evidenceChecklist: checklist });
    expect(CONFIDENCE_COLORS[conf].text).toBe("#f87171");
  });
});

// ─── Scenario: Multi-Source Press Release (Medium Confidence) ──────────

describe("Multi-Source Press Release scenario", () => {
  const checklist: EvidenceChecklist = {
    hasPrimarySource: false,     // techcrunch → actually tier 2, should be true
    hasCorroboration: true,      // techcrunch + bloomberg
    hasFalsifiableClaim: true,   // "shipping in Q3 2026"
    hasQuantitativeData: true,   // "$42M raised"
    hasNamedAttribution: true,   // "CEO Jane Doe"
    isReproducible: false,       // paywalled
  };

  it("counts 4/6 passing checks", () => {
    expect(countPassingChecks(checklist)).toBe(4);
  });

  it("derives 'estimated' confidence", () => {
    expect(deriveConfidence({ evidenceChecklist: checklist })).toBe("estimated");
  });
});

// ─── Scenario: Boundary Conditions ─────────────────────────────────────

describe("Confidence boundary conditions", () => {
  it("returns 'speculative' when no checklist provided", () => {
    expect(deriveConfidence({ evidenceChecklist: undefined })).toBe("speculative");
  });

  it("returns 'speculative' for 0/6 checks", () => {
    const empty: EvidenceChecklist = {
      hasPrimarySource: false,
      hasCorroboration: false,
      hasFalsifiableClaim: false,
      hasQuantitativeData: false,
      hasNamedAttribution: false,
      isReproducible: false,
    };
    expect(deriveConfidence({ evidenceChecklist: empty })).toBe("speculative");
    expect(countPassingChecks(empty)).toBe(0);
  });

  it("returns 'speculative' for exactly 2/6 checks", () => {
    const two: EvidenceChecklist = {
      hasPrimarySource: true,
      hasCorroboration: true,
      hasFalsifiableClaim: false,
      hasQuantitativeData: false,
      hasNamedAttribution: false,
      isReproducible: false,
    };
    expect(deriveConfidence({ evidenceChecklist: two })).toBe("speculative");
  });

  it("returns 'estimated' for exactly 3/6 checks", () => {
    const three: EvidenceChecklist = {
      hasPrimarySource: true,
      hasCorroboration: true,
      hasFalsifiableClaim: true,
      hasQuantitativeData: false,
      hasNamedAttribution: false,
      isReproducible: false,
    };
    expect(deriveConfidence({ evidenceChecklist: three })).toBe("estimated");
  });

  it("returns 'verified' for exactly 5/6 checks", () => {
    const five: EvidenceChecklist = {
      hasPrimarySource: true,
      hasCorroboration: true,
      hasFalsifiableClaim: true,
      hasQuantitativeData: true,
      hasNamedAttribution: true,
      isReproducible: false,
    };
    expect(deriveConfidence({ evidenceChecklist: five })).toBe("verified");
  });
});

// ─── Scenario: Determinism Invariant ───────────────────────────────────

describe("Determinism invariant", () => {
  it("same input produces same output across 100 calls", () => {
    const checklist: EvidenceChecklist = {
      hasPrimarySource: true,
      hasCorroboration: true,
      hasFalsifiableClaim: false,
      hasQuantitativeData: true,
      hasNamedAttribution: false,
      isReproducible: true,
    };

    const results = Array.from({ length: 100 }, () =>
      deriveConfidence({ evidenceChecklist: checklist }),
    );

    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe("estimated");
  });
});

// ─── Scenario: computeEvidenceChecklist ────────────────────────────────

describe("computeEvidenceChecklist — SEC filing with multiple sources", () => {
  const signal = {
    title: "SEC 10-K Filing: Revenue reaches $10.2B",
    summary: "John Smith, CFO of Anthropic, reported record quarterly revenue. The filing shows a 42% year-over-year increase.",
    directQuote: "We expect continued growth in the enterprise segment.",
    falsificationCriteria: "If Q3 2026 revenue falls below $2.5B quarterly, this thesis fails.",
  };

  const sources = [
    { url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany" },
    { url: "https://www.reuters.com/technology/anthropic-revenue-2026" },
  ];

  it("correctly identifies all 6 checks as passing", () => {
    const result = computeEvidenceChecklist(signal, sources);
    expect(result.hasPrimarySource).toBe(true);      // sec.gov
    expect(result.hasCorroboration).toBe(true);       // sec.gov + reuters.com
    expect(result.hasFalsifiableClaim).toBe(true);    // 40+ char criteria
    expect(result.hasQuantitativeData).toBe(true);    // $10.2B, 42%
    expect(result.hasNamedAttribution).toBe(true);    // "John Smith"
    expect(result.isReproducible).toBe(true);         // http URLs present
  });
});

describe("computeEvidenceChecklist — single blog source, no numbers", () => {
  const signal = {
    title: "Industry buzz about upcoming changes",
    summary: "Sources familiar with the matter suggest something big is coming. The market seems to be shifting.",
    directQuote: null,
    falsificationCriteria: null,
  };

  const sources = [
    { url: "https://medium.com/@random/speculation-post" },
  ];

  it("correctly identifies weak evidence", () => {
    const result = computeEvidenceChecklist(signal, sources);
    expect(result.hasPrimarySource).toBe(false);      // medium.com not tier 1/2
    expect(result.hasCorroboration).toBe(false);       // single domain
    expect(result.hasFalsifiableClaim).toBe(false);    // null criteria
    expect(result.hasQuantitativeData).toBe(false);    // no numbers
    expect(result.hasNamedAttribution).toBe(false);    // no "First Last" pattern
    expect(result.isReproducible).toBe(true);          // URL starts with http
  });
});

// ─── Scenario: significanceRank ordering ───────────────────────────────

describe("significanceRank — BLUF ordering", () => {
  const strong: Pick<BriefSignal, "evidenceChecklist" | "hardNumbers" | "directQuote"> = {
    evidenceChecklist: {
      hasPrimarySource: true, hasCorroboration: true, hasFalsifiableClaim: true,
      hasQuantitativeData: true, hasNamedAttribution: true, isReproducible: true,
    },
    hardNumbers: "$10B",
    directQuote: "We expect growth",
  };

  const weak: Pick<BriefSignal, "evidenceChecklist" | "hardNumbers" | "directQuote"> = {
    evidenceChecklist: {
      hasPrimarySource: false, hasCorroboration: false, hasFalsifiableClaim: false,
      hasQuantitativeData: false, hasNamedAttribution: false, isReproducible: true,
    },
    hardNumbers: undefined,
    directQuote: undefined,
  };

  it("strong signal ranks higher than weak signal", () => {
    expect(significanceRank(strong)).toBeGreaterThan(significanceRank(weak));
  });

  it("strong signal scores 9 (6 checks + 2 numbers + 1 quote)", () => {
    expect(significanceRank(strong)).toBe(9);
  });

  it("weak signal scores 1 (1 check + 0 numbers + 0 quote)", () => {
    expect(significanceRank(weak)).toBe(1);
  });
});
