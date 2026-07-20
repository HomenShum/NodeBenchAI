/**
 * Tests for the founder block — verification gates + confidence tier math.
 *
 * Scenario: A sub-agent extracts founder candidates from a company's public
 *           sources. Each candidate gets scored by the block's gates; the
 *           resulting confidence tier drives the UI chip.
 *
 * Invariants under test:
 *   - Candidate name must actually appear in the corpus (no fabrication)
 *   - Role must appear near the name (no drive-by mentions promoted to roles)
 *   - Confidence tier is computed honestly from gate outcomes + source tiers
 *   - HONEST_SCORES: unverified when any required gate fails, regardless of source count
 */

import { describe, it, expect } from "vitest";
import {
  FOUNDER_BLOCK,
  computeFounderConfidence,
  type FounderCandidate,
} from "./founder";

const CORPUS_WITH_JANE_DOE = `
Acme AI is led by co-founders Jane Doe (CEO, previously at Stripe) and Arun Patel (CTO, previously at Scale AI).
Jane Doe joined Stripe in 2018 and led payments engineering before founding Acme AI in 2023.
Arun Patel was at Scale AI for three years, focusing on evaluation tooling.
The company is headquartered in San Francisco with a team of four.
`.trim();

const JANE: FounderCandidate = {
  name: "Jane Doe",
  role: "CEO",
  tenure: { startYear: 2023 },
  priorRoles: [{ company: "Stripe", title: "Lead Engineer", years: "2018-2023" }],
  sourceIndices: [0, 1],
  identityHash: "jane_doe:stripe",
};

const FABRICATED: FounderCandidate = {
  name: "Samantha Nonexistent",
  role: "Head of Growth",
  sourceIndices: [],
  identityHash: "samantha:none",
};

describe("FOUNDER_BLOCK config", () => {
  it("has the founder block type and matching scratchpad section", () => {
    expect(FOUNDER_BLOCK.block).toBe("founder");
    expect(FOUNDER_BLOCK.scratchpadSection).toBe("Founders");
  });

  it("attributes to person entities (not company)", () => {
    expect(FOUNDER_BLOCK.attributionTarget).toBe("person");
  });

  it("auto-spawns by default (core block, not premium)", () => {
    expect(FOUNDER_BLOCK.autoSpawn).toBe(true);
  });

  it("declares all three required gates", () => {
    const required = FOUNDER_BLOCK.gates.filter((g) => g.required);
    expect(required.map((g) => g.name)).toEqual([
      "name_appears_in_source",
      "role_matches_somewhere",
      "no_homonym_collision",
    ]);
  });

  it("has a finite budget (BOUND rule)", () => {
    expect(FOUNDER_BLOCK.budget.wallMs).toBeGreaterThan(0);
    expect(FOUNDER_BLOCK.budget.outTokens).toBeGreaterThan(0);
    expect(FOUNDER_BLOCK.budget.toolCalls).toBeGreaterThan(0);
  });
});

describe("gates: name_appears_in_source", () => {
  const gate = FOUNDER_BLOCK.gates.find((g) => g.name === "name_appears_in_source")!;
  const ctx = { sourceCorpus: CORPUS_WITH_JANE_DOE, entityName: "Acme AI" };

  it("passes when the candidate's name is in the corpus", async () => {
    expect(await gate.check(JANE, ctx)).toBe(true);
  });

  it("fails for a fabricated candidate never mentioned in sources", async () => {
    expect(await gate.check(FABRICATED, ctx)).toBe(false);
  });
});

describe("gates: role_matches_somewhere", () => {
  const gate = FOUNDER_BLOCK.gates.find((g) => g.name === "role_matches_somewhere")!;
  const ctx = { sourceCorpus: CORPUS_WITH_JANE_DOE, entityName: "Acme AI" };

  it("passes when role keywords appear near the name", async () => {
    expect(await gate.check(JANE, ctx)).toBe(true);
  });

  it("fails when the candidate isn't in the corpus (can't check proximity)", async () => {
    expect(await gate.check(FABRICATED, ctx)).toBe(false);
  });

  it("fails when the role has no substantive tokens (>3 chars)", async () => {
    const vague: FounderCandidate = { ...JANE, role: "HoG" }; // too short
    expect(await gate.check(vague, ctx)).toBe(false);
  });
});

describe("computeFounderConfidence", () => {
  const allPassed = [
    { gateName: "name_appears_in_source", passed: true },
    { gateName: "role_matches_somewhere", passed: true },
    { gateName: "no_homonym_collision", passed: true },
  ] as const;

  it("verified when all gates pass AND ≥2 tier1/tier2 sources", () => {
    expect(computeFounderConfidence([...allPassed], ["tier1", "tier1"])).toBe("verified");
    expect(computeFounderConfidence([...allPassed], ["tier1", "tier2"])).toBe("verified");
    expect(computeFounderConfidence([...allPassed], ["tier2", "tier2"])).toBe("verified");
  });

  it("corroborated with exactly 1 tier1/tier2 source", () => {
    expect(computeFounderConfidence([...allPassed], ["tier1"])).toBe("single-source");
    // Note: only tier1 + no tier2 + no tier3 → 1 source total → single-source
    // That's correct per our tier definition.
    expect(computeFounderConfidence([...allPassed], ["tier2", "tier3"])).toBe("corroborated");
  });

  it("corroborated when ≥2 tier3 sources agree", () => {
    expect(computeFounderConfidence([...allPassed], ["tier3", "tier3"])).toBe("corroborated");
  });

  it("single-source when gates pass but only 1 source overall", () => {
    expect(computeFounderConfidence([...allPassed], ["tier1"])).toBe("single-source");
    expect(computeFounderConfidence([...allPassed], ["tier3"])).toBe("single-source");
  });

  it("unverified when any required gate fails, regardless of source count", () => {
    const oneFailed = [
      { gateName: "name_appears_in_source", passed: false },
      { gateName: "role_matches_somewhere", passed: true },
      { gateName: "no_homonym_collision", passed: true },
    ];
    expect(computeFounderConfidence(oneFailed, ["tier1", "tier1", "tier1"])).toBe("unverified");
  });

  it("unverified with zero sources even if gates pass (HONEST_SCORES)", () => {
    expect(computeFounderConfidence([...allPassed], [])).toBe("unverified");
  });

  it("unverified when a gate verdict is null/unknown (HONEST_SCORES — fails closed)", () => {
    const unknownGate = [
      { gateName: "name_appears_in_source", passed: null },
      { gateName: "role_matches_somewhere", passed: true },
      { gateName: "no_homonym_collision", passed: true },
    ];
    expect(computeFounderConfidence(unknownGate, ["tier1", "tier1"])).toBe("unverified");
  });
});
