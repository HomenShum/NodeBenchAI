/**
 * Tests for the grounding module. Scenario-framed per scenario_testing rule.
 *
 * Scenario: A sub-agent extracts N candidate claims from a company research
 *           run. Before the claims are persisted to a Report, the grounding
 *           filter drops ones that have zero substantive overlap with the
 *           retrieved source corpus. This is the anti-hallucination floor.
 *
 * Failure modes covered: empty claim, empty corpus, short corpus, short words,
 * exact-boundary word length, case sensitivity, missing source, all-dropped.
 */

import { describe, it, expect } from "vitest";
import {
  isGrounded,
  filterGrounded,
  buildSourceCorpus,
  getRetrievalConfidence,
} from "./index";

describe("isGrounded", () => {
  const corpus =
    "Acme AI is a four-person startup building agent-native CRM systems. They raised a Series B from Sequoia in December 2025.";

  it("passes an empty claim (nothing to reject)", () => {
    expect(isGrounded("", corpus)).toBe(true);
  });

  it("passes when the corpus is too short to filter", () => {
    expect(isGrounded("founder launches product", "short")).toBe(true);
  });

  it("passes a short-word-only claim (no substantive words)", () => {
    expect(isGrounded("they did it", corpus)).toBe(true);
  });

  it("keeps a claim with at least one substantive word overlap", () => {
    expect(isGrounded("Acme raised Series B from Sequoia", corpus)).toBe(true);
  });

  it("drops a claim with zero substantive word overlap (fabricated)", () => {
    expect(isGrounded("Quarterly molybdenum conjugations blossomed", corpus)).toBe(false);
  });

  it("is case-insensitive on matching", () => {
    expect(isGrounded("ACME raised SERIES B", corpus)).toBe(true);
  });

  it("treats words of length 4 as non-substantive (boundary)", () => {
    // 'team' is exactly 4 chars → dropped as non-substantive; but 'Acme' also 4 chars
    // So both claim words drop out, claim passes as "no substantive words"
    expect(isGrounded("team Acme", corpus)).toBe(true);
  });

  it("treats words of length 5+ as substantive (boundary)", () => {
    // 'startup' is 7 chars → substantive. Present in corpus → kept.
    expect(isGrounded("startup team", corpus)).toBe(true);
    // 'flying' is 6 chars → substantive. Not in corpus → dropped.
    expect(isGrounded("flying carpets", corpus)).toBe(false);
  });
});

describe("filterGrounded", () => {
  // Corpus MUST be ≥ 50 chars to actually exercise the filter (shorter corpora
  // hit the short-corpus escape hatch and pass everything).
  const corpus =
    "Jane Doe is CEO of Acme AI. Arun Patel is CTO. Their headquarters is in San Francisco.";

  it("returns kept + droppedCount split", () => {
    const items = [
      // 'previously' (10 chars, NOT in corpus), 'Stripe' (6 chars, NOT in corpus) → DROPPED
      { text: "Jane was previously at Stripe" },
      // 'engineering' (11 chars, NOT in corpus), 'Patel' (5 chars, IN corpus), 'leads' (5 chars, NOT) → KEPT (1 match)
      { text: "Patel leads engineering" },
      // empty → KEPT (nothing to reject)
      { text: "" },
    ];
    const result = filterGrounded(items, (i) => i.text, corpus);
    expect(result.kept.length).toBe(2);
    expect(result.droppedCount).toBe(1);
  });

  it("returns everything kept when corpus is short (<50 chars) — escape hatch", () => {
    const items = [{ text: "anything" }, { text: "quantum supremacy achieved" }];
    const result = filterGrounded(items, (i) => i.text, "short");
    expect(result.kept.length).toBe(2);
    expect(result.droppedCount).toBe(0);
  });
});

describe("buildSourceCorpus", () => {
  it("is deterministic across identical inputs (DETERMINISTIC rule)", () => {
    const a = buildSourceCorpus(["Jane is CEO", "Arun is CTO"]);
    const b = buildSourceCorpus(["Jane is CEO", "Arun is CTO"]);
    expect(a).toBe(b);
  });

  it("filters empty strings", () => {
    const corpus = buildSourceCorpus(["alpha", "", "beta", ""]);
    expect(corpus).toBe("alpha beta");
  });

  it("handles null/undefined entries gracefully", () => {
    // Cast to any to test runtime resilience to accidental undefineds
    const corpus = buildSourceCorpus([
      "alpha",
      undefined as unknown as string,
      "beta",
    ]);
    expect(corpus).toBe("alpha beta");
  });
});

describe("getRetrievalConfidence", () => {
  it("returns 'high' for 3+ snippets (strong retrieval signal)", () => {
    expect(getRetrievalConfidence(3)).toBe("high");
    expect(getRetrievalConfidence(10)).toBe("high");
  });

  it("returns 'medium' for 1–2 snippets (thin but workable)", () => {
    expect(getRetrievalConfidence(1)).toBe("medium");
    expect(getRetrievalConfidence(2)).toBe("medium");
  });

  it("returns 'low' for 0 snippets (agent should bail or mark unverified)", () => {
    expect(getRetrievalConfidence(0)).toBe("low");
  });
});
