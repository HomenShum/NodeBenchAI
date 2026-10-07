/**
 * Position Annotation — scenario-based tests.
 *
 * Scenarios model real founder workflows:
 *   - Founder tracking a vendor dependency: signal mentions "Anthropic" → matches position
 *   - No match: signal about unrelated entity → returns null
 *   - Multiple positions: signal mentions one of several tracked entities → matches correct one
 *   - Edge cases: empty positions, empty signal, slug vs name matching
 *
 * See: .claude/rules/scenario_testing.md
 */

import { describe, it, expect } from "vitest";
import {
  extractEntityKeys,
  findUserPosition,
} from "./positionAnnotation";
import type { UserEntityPosition } from "./briefTypes";

// ─── Test Fixtures ─────────────────────────────────────────────────────

const POSITIONS: UserEntityPosition[] = [
  {
    entityId: "ent_1",
    entitySlug: "anthropic",
    entityName: "Anthropic",
    relationship: "vendor dependency",
    annualValue: 150_000,
    exposureType: "API spend",
    activeContext: "Claude integration in production",
  },
  {
    entityId: "ent_2",
    entitySlug: "openai",
    entityName: "OpenAI",
    relationship: "competitor monitoring",
    annualValue: 0,
    exposureType: "market watch",
    activeContext: "GPT-5 launch timeline",
  },
  {
    entityId: "ent_3",
    entitySlug: "rivian-automotive",
    entityName: "Rivian Automotive",
    relationship: "investment",
    annualValue: 50_000,
    exposureType: "equity position",
    activeContext: "Q3 earnings call pending",
  },
];

// ─── extractEntityKeys ─────────────────────────────────────────────────

describe("extractEntityKeys", () => {
  it("extracts multi-word capitalized entity names", () => {
    const keys = extractEntityKeys("Rivian Automotive reported earnings today");
    expect(keys).toContain("rivian automotive");
  });

  it("extracts single-word capitalized entity names", () => {
    const keys = extractEntityKeys("Anthropic raised $4B in Series E");
    expect(keys).toContain("anthropic");
  });

  it("strips possessives", () => {
    const keys = extractEntityKeys("Anthropic's new model outperforms competitors");
    expect(keys).toContain("anthropic");
  });

  it("strips corporate suffixes (Inc, Corp, Ltd)", () => {
    const keys = extractEntityKeys("Tesla Inc reported quarterly revenue");
    expect(keys).toContain("tesla");
  });

  it("returns empty array for empty string", () => {
    expect(extractEntityKeys("")).toEqual([]);
  });

  it("deduplicates entity keys", () => {
    const keys = extractEntityKeys("Anthropic ships Claude. Anthropic raises funding.");
    const anthropicCount = keys.filter((k) => k === "anthropic").length;
    expect(anthropicCount).toBe(1);
  });

  it("ignores lowercase words", () => {
    const keys = extractEntityKeys("the company reported strong results today");
    // Should be empty — no capitalized multi-word patterns
    expect(keys.length).toBe(0);
  });
});

// ─── Scenario: Founder tracking vendor dependency ──────────────────────

describe("Founder tracking vendor dependency scenario", () => {
  const signal = {
    title: "Anthropic raises $4B Series E at $60B valuation",
    summary: "Anthropic has secured its largest funding round yet, raising $4B from multiple investors including Google and Spark Capital.",
  };

  it("matches signal to Anthropic position", () => {
    const result = findUserPosition(POSITIONS, signal);
    expect(result).not.toBeNull();
    expect(result!.relationship).toBe("vendor dependency");
  });

  it("formats exposure correctly with currency", () => {
    const result = findUserPosition(POSITIONS, signal);
    expect(result!.exposure).toBe("$150K/yr API spend");
  });

  it("includes active context", () => {
    const result = findUserPosition(POSITIONS, signal);
    expect(result!.context).toBe("Claude integration in production");
  });
});

// ─── Scenario: No match — unrelated entity ─────────────────────────────

describe("No match — unrelated entity scenario", () => {
  const signal = {
    title: "SpaceX launches Starship v3",
    summary: "SpaceX completed a successful full-stack test of its next-generation Starship vehicle.",
  };

  it("returns null when no position matches", () => {
    const result = findUserPosition(POSITIONS, signal);
    expect(result).toBeNull();
  });
});

// ─── Scenario: Multiple positions, correct match ───────────────────────

describe("Multiple positions, correct match scenario", () => {
  const signal = {
    title: "OpenAI announces GPT-5 preview",
    summary: "Sam Altman confirmed GPT-5 will launch in Q3 2026 with multimodal capabilities.",
  };

  it("matches OpenAI position (not Anthropic)", () => {
    const result = findUserPosition(POSITIONS, signal);
    expect(result).not.toBeNull();
    expect(result!.relationship).toBe("competitor monitoring");
  });

  it("formats zero-value exposure without currency", () => {
    const result = findUserPosition(POSITIONS, signal);
    expect(result!.exposure).toBe("market watch");
  });
});

// ─── Scenario: Slug vs name matching ───────────────────────────────────

describe("Slug vs name matching scenario", () => {
  it("matches by entity name containment (multi-word entity)", () => {
    const signal = {
      title: "Rivian beats Q3 expectations",
      summary: "Rivian Automotive exceeded analyst estimates with deliveries up 35%.",
    };
    const result = findUserPosition(POSITIONS, signal);
    expect(result).not.toBeNull();
    expect(result!.relationship).toBe("investment");
  });

  it("formats large exposure correctly", () => {
    const signal = {
      title: "Rivian earnings preview",
      summary: "Rivian Automotive Q3 earnings call scheduled for next week.",
    };
    const result = findUserPosition(POSITIONS, signal);
    expect(result!.exposure).toBe("$50K/yr equity position");
  });
});

// ─── Scenario: Edge cases ──────────────────────────────────────────────

describe("Edge cases", () => {
  it("returns null for undefined positions", () => {
    const signal = { title: "Something", summary: "Something" };
    expect(findUserPosition(undefined, signal)).toBeNull();
  });

  it("returns null for empty positions array", () => {
    const signal = { title: "Anthropic", summary: "Anthropic ships Claude" };
    expect(findUserPosition([], signal)).toBeNull();
  });

  it("handles signal with no capitalized words gracefully", () => {
    const signal = {
      title: "market update for today",
      summary: "the market moved in unexpected directions today",
    };
    expect(findUserPosition(POSITIONS, signal)).toBeNull();
  });
});

// ─── Scenario: Currency formatting at scale ────────────────────────────

describe("Currency formatting edge cases", () => {
  it("handles billion-scale values", () => {
    const bigPosition: UserEntityPosition[] = [{
      entityId: "ent_big",
      entitySlug: "apple",
      entityName: "Apple",
      relationship: "investment",
      annualValue: 2_500_000_000,
      exposureType: "AUM",
    }];
    const signal = { title: "Apple announces earnings", summary: "Apple Inc." };
    const result = findUserPosition(bigPosition, signal);
    expect(result!.exposure).toBe("$2.5B/yr AUM");
  });

  it("handles million-scale values", () => {
    const medPosition: UserEntityPosition[] = [{
      entityId: "ent_med",
      entitySlug: "stripe",
      entityName: "Stripe",
      relationship: "vendor",
      annualValue: 3_200_000,
      exposureType: "payment volume",
    }];
    const signal = { title: "Stripe fees increase", summary: "Stripe Inc adjusts pricing." };
    const result = findUserPosition(medPosition, signal);
    expect(result!.exposure).toBe("$3.2M/yr payment volume");
  });

  it("handles sub-thousand values without K suffix", () => {
    const smallPosition: UserEntityPosition[] = [{
      entityId: "ent_small",
      entitySlug: "notion",
      entityName: "Notion",
      relationship: "tool subscription",
      annualValue: 500,
      exposureType: "seat licenses",
    }];
    const signal = { title: "Notion updates pricing", summary: "Notion Labs raises prices." };
    const result = findUserPosition(smallPosition, signal);
    expect(result!.exposure).toBe("$500/yr seat licenses");
  });
});
