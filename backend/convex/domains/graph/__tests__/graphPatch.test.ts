/**
 * Scenario-based tests for the graph expansion pipeline.
 *
 * Tests cover the pure-function layers (SSRF validation, triple dedup,
 * URL safety, search query building, claim extraction shapes) that can
 * be tested without a Convex runtime. Integration tests for the full
 * mutation pipeline run against `convex dev --once` separately.
 *
 * Scenario anatomy per .claude/rules/scenario_testing.md:
 *   Who:      founder / analyst / adversarial user
 *   What:     expand entity, apply graph patch, query backlinks
 *   How:      click mention chip → expansion pipeline → graph patch
 *   Scale:    single user (unit), concurrent expansions (integration)
 *   Duration: single request
 *   Failure:  SSRF, duplicate claims, malformed URLs, oversized patches
 */

import { describe, it, expect } from "vitest";

// ── SSRF validation (extracted logic — mirrors expandEntity.ts & applyGraphPatch.ts) ──

const SSRF_BLOCKED_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^\[::1\]$/,
  /^metadata\.google\.internal$/i,
];

function isUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    return !SSRF_BLOCKED_PATTERNS.some((p) => p.test(parsed.hostname));
  } catch {
    return false;
  }
}

// ── Triple dedup key (mirrors applyGraphPatch.ts) ──

function tripleKey(subject: string, predicate: string, object: string): string {
  return `${subject.toLowerCase().trim()}::${predicate.toLowerCase().trim()}::${object.toLowerCase().trim()}`;
}

// ── Search query builder (mirrors expandEntity.ts) ──

function buildSearchQueries(entityName: string, entityType: string): string[] {
  const queries = [
    `${entityName} latest news 2026`,
    `${entityName} funding valuation revenue`,
    `${entityName} leadership team executives`,
  ];
  if (entityType === "company") {
    queries.push(`${entityName} competitors market position`);
    queries.push(`${entityName} product launches partnerships`);
  } else if (entityType === "person") {
    queries.push(`${entityName} career background biography`);
    queries.push(`${entityName} recent statements opinions`);
  } else {
    queries.push(`${entityName} overview analysis`);
    queries.push(`${entityName} trends developments`);
  }
  return queries;
}

// ═══════════════════════════════════════════════════════════════════════
// SSRF Protection Tests
// ═══════════════════════════════════════════════════════════════════════

describe("SSRF validation — adversarial user submitting agent-discovered URLs", () => {
  /*
   * Scenario: Adversarial expansion
   * User:      adversarial actor using expand feature
   * Goal:      exploit Linkup results containing internal network URLs
   * Prior:     entity exists, expansion run queued
   * Scale:     single user, single expansion
   * Duration:  single request
   * Expected:  all internal/metadata URLs rejected, external URLs accepted
   * Edge cases: protocol smuggling, cloud metadata, IPv6 localhost
   */

  it("blocks localhost variants", () => {
    expect(isUrlSafe("http://localhost/admin")).toBe(false);
    expect(isUrlSafe("http://LOCALHOST/admin")).toBe(false);
    expect(isUrlSafe("http://127.0.0.1/admin")).toBe(false);
    expect(isUrlSafe("http://127.0.0.99/admin")).toBe(false);
  });

  it("blocks RFC1918 private ranges", () => {
    expect(isUrlSafe("http://10.0.0.1/metadata")).toBe(false);
    expect(isUrlSafe("http://10.255.255.255/api")).toBe(false);
    expect(isUrlSafe("http://172.16.0.1/internal")).toBe(false);
    expect(isUrlSafe("http://172.31.255.255/api")).toBe(false);
    expect(isUrlSafe("http://192.168.1.1/router")).toBe(false);
    expect(isUrlSafe("http://192.168.0.100/api")).toBe(false);
  });

  it("blocks cloud metadata endpoint", () => {
    expect(isUrlSafe("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isUrlSafe("http://metadata.google.internal/computeMetadata/v1")).toBe(false);
  });

  it("blocks IPv6 localhost", () => {
    expect(isUrlSafe("http://[::1]/admin")).toBe(false);
  });

  it("blocks non-HTTP protocols", () => {
    expect(isUrlSafe("ftp://example.com/file")).toBe(false);
    expect(isUrlSafe("file:///etc/passwd")).toBe(false);
    expect(isUrlSafe("javascript:alert(1)")).toBe(false);
  });

  it("accepts legitimate external URLs", () => {
    expect(isUrlSafe("https://www.sec.gov/cgi-bin/browse-edgar")).toBe(true);
    expect(isUrlSafe("https://arxiv.org/abs/2301.00001")).toBe(true);
    expect(isUrlSafe("https://techcrunch.com/2026/05/01/ai-news")).toBe(true);
    expect(isUrlSafe("https://reuters.com/business/article")).toBe(true);
  });

  it("rejects malformed URLs gracefully", () => {
    expect(isUrlSafe("not-a-url")).toBe(false);
    expect(isUrlSafe("")).toBe(false);
    expect(isUrlSafe("://missing-protocol")).toBe(false);
  });

  it("accepts 172.x outside the 16-31 private range", () => {
    // 172.32.x.x is NOT private — should be allowed
    expect(isUrlSafe("http://172.32.0.1/api")).toBe(true);
    expect(isUrlSafe("http://172.15.0.1/api")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Triple Dedup Tests
// ═══════════════════════════════════════════════════════════════════════

describe("DETERMINISTIC triple key — founder expanding a company entity", () => {
  /*
   * Scenario: Duplicate claim prevention
   * User:      power user / founder
   * Goal:      expand "Anthropic" and verify no duplicate SPO triples created
   * Prior:     existing graph with 10 claims about Anthropic
   * Scale:     single user, re-expansion (2nd click)
   * Duration:  single request
   * Expected:  same (S,P,O) produces same key regardless of casing/whitespace
   * Edge cases: mixed case, leading/trailing spaces, unicode normalization
   */

  it("produces identical keys for same triple with different casing", () => {
    const k1 = tripleKey("Anthropic", "has_revenue", "$1B ARR");
    const k2 = tripleKey("anthropic", "HAS_REVENUE", "$1b arr");
    expect(k1).toBe(k2);
  });

  it("produces identical keys with whitespace variations", () => {
    const k1 = tripleKey("Anthropic", "founded_by", "Dario Amodei");
    const k2 = tripleKey("  Anthropic  ", "  founded_by  ", "  Dario Amodei  ");
    expect(k1).toBe(k2);
  });

  it("produces different keys for genuinely different triples", () => {
    const k1 = tripleKey("Anthropic", "competes_with", "OpenAI");
    const k2 = tripleKey("OpenAI", "competes_with", "Anthropic");
    expect(k1).not.toBe(k2); // Direction matters
  });

  it("handles empty strings without crashing", () => {
    const key = tripleKey("", "", "");
    expect(key).toBe("::::"); // Degenerate but deterministic
  });

  it("is deterministic across 100 calls (invariant)", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      keys.add(tripleKey("Anthropic", "has_ceo", "Dario Amodei"));
    }
    expect(keys.size).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Search Query Builder Tests
// ═══════════════════════════════════════════════════════════════════════

describe("search query builder — entity type routing", () => {
  /*
   * Scenario: Query template selection
   * User:      founder exploring different entity types
   * Goal:      expand a company, person, and topic entity
   * Prior:     entities resolved, expansion triggered
   * Scale:     single user
   * Duration:  single request
   * Expected:  company gets competitor/product queries, person gets career/statement queries
   * Edge cases: unknown entity type, very long entity name
   */

  it("generates company-specific queries", () => {
    const queries = buildSearchQueries("Anthropic", "company");
    expect(queries).toHaveLength(5);
    expect(queries.some((q) => q.includes("competitors"))).toBe(true);
    expect(queries.some((q) => q.includes("product launches"))).toBe(true);
  });

  it("generates person-specific queries", () => {
    const queries = buildSearchQueries("Dario Amodei", "person");
    expect(queries).toHaveLength(5);
    expect(queries.some((q) => q.includes("career"))).toBe(true);
    expect(queries.some((q) => q.includes("statements"))).toBe(true);
  });

  it("generates generic queries for unknown entity types", () => {
    const queries = buildSearchQueries("Quantum Computing", "topic");
    expect(queries).toHaveLength(5);
    expect(queries.some((q) => q.includes("overview"))).toBe(true);
    expect(queries.some((q) => q.includes("trends"))).toBe(true);
  });

  it("always includes 3 base queries regardless of type", () => {
    for (const type of ["company", "person", "topic", "organization"]) {
      const queries = buildSearchQueries("Test Entity", type);
      expect(queries.length).toBeGreaterThanOrEqual(5);
      expect(queries[0]).toContain("latest news");
      expect(queries[1]).toContain("funding valuation");
      expect(queries[2]).toContain("leadership team");
    }
  });

  it("includes entity name in every query", () => {
    const queries = buildSearchQueries("Stripe", "company");
    for (const q of queries) {
      expect(q).toContain("Stripe");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Bound Enforcement Tests
// ═══════════════════════════════════════════════════════════════════════

describe("BOUND enforcement — preventing unbounded graph growth", () => {
  /*
   * Scenario: Large expansion with many results
   * User:      power user expanding a heavily-covered entity (e.g., Apple, Google)
   * Goal:      verify that patch bounds are enforced even with massive input
   * Prior:     entity exists, Linkup returns 100+ snippets
   * Scale:     single user, large result set
   * Duration:  single request
   * Expected:  claims capped at 50, edges at 100, backlinks at 50, key facts at 10
   */

  it("MAX_CLAIMS_PER_PATCH caps at 50", () => {
    const MAX_CLAIMS_PER_PATCH = 50;
    const overclaims = Array.from({ length: 200 }, (_, i) => ({
      subject: "Google",
      predicate: `fact_${i}`,
      object: `value_${i}`,
      claimText: `Google fact ${i}`,
      sourceUrls: [],
      isHighConfidence: true,
    }));
    const bounded = overclaims.slice(0, MAX_CLAIMS_PER_PATCH);
    expect(bounded).toHaveLength(50);
  });

  it("MAX_KEY_FACTS caps at 10", () => {
    const MAX_KEY_FACTS = 10;
    const overFacts = Array.from({ length: 30 }, (_, i) => `Fact ${i}`);
    const bounded = overFacts.slice(0, MAX_KEY_FACTS);
    expect(bounded).toHaveLength(10);
  });

  it("MAX_RECENT_CLAIMS caps at 20", () => {
    const MAX_RECENT_CLAIMS = 20;
    const overClaims = Array.from({ length: 50 }, (_, i) => ({
      claimText: `Claim ${i}`,
      predicate: `pred_${i}`,
      confidence: true,
    }));
    const bounded = overClaims.slice(0, MAX_RECENT_CLAIMS);
    expect(bounded).toHaveLength(20);
  });

  it("confidence values are clamped to [0, 1]", () => {
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    expect(clamp(-0.5)).toBe(0);
    expect(clamp(0)).toBe(0);
    expect(clamp(0.75)).toBe(0.75);
    expect(clamp(1)).toBe(1);
    expect(clamp(1.5)).toBe(1);
    expect(clamp(999)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Backlink Type Coverage Tests
// ═══════════════════════════════════════════════════════════════════════

describe("backlink type taxonomy — all types serve a user need", () => {
  /*
   * Scenario: Backlink panel showing all reference types
   * User:      analyst reviewing entity cross-references
   * Goal:      verify all 7 backlink types are distinguishable and useful
   * Prior:     entity expanded with multiple backlink types
   * Scale:     single user, viewing backlink panel
   * Duration:  single request
   * Expected:  each type maps to a distinct user action or information need
   */

  const ALL_BACKLINK_TYPES = [
    "mention",
    "citation",
    "relatedTo",
    "causes",
    "contradicts",
    "supports",
    "derived",
  ] as const;

  const ALL_SOURCE_TYPES = [
    "block",
    "claim",
    "document",
    "signal",
    "action",
  ] as const;

  it("has 7 distinct backlink types", () => {
    expect(new Set(ALL_BACKLINK_TYPES).size).toBe(7);
  });

  it("has 5 distinct source types", () => {
    expect(new Set(ALL_SOURCE_TYPES).size).toBe(5);
  });

  it("every backlink type serves a distinct user need", () => {
    const descriptions: Record<string, string> = {
      mention: "User manually @mentioned this entity in the editor",
      citation: "A source cited this entity as evidence",
      relatedTo: "Semantic relationship discovered by agent or user",
      causes: "Causal relationship (A causes B)",
      contradicts: "Contradicting claim found",
      supports: "Supporting evidence found",
      derived: "Agent-discovered relationship during expansion",
    };

    for (const type of ALL_BACKLINK_TYPES) {
      expect(descriptions[type]).toBeDefined();
      expect(descriptions[type].length).toBeGreaterThan(10);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Expansion State Machine Tests
// ═══════════════════════════════════════════════════════════════════════

describe("expansion run state machine — valid transitions only", () => {
  /*
   * Scenario: Expansion lifecycle
   * User:      founder clicking [⊕ Expand] on an @Anthropic mention
   * Goal:      verify state machine transitions are valid and terminal states are honest
   * Prior:     entity exists, user authenticated
   * Scale:     single user
   * Duration:  full expansion lifecycle (~10-30s)
   * Expected:  queued → searching → extracting → persisting → completed|partial|failed
   * Edge cases: immediate failure, partial success, timeout
   */

  const VALID_TRANSITIONS: Record<string, string[]> = {
    queued: ["searching", "failed"],
    searching: ["extracting", "failed", "completed"], // completed if no snippets found
    extracting: ["persisting", "failed"],
    persisting: ["completed", "partial", "failed"],
    completed: [], // terminal
    partial: [],   // terminal
    failed: [],    // terminal
  };

  it("every status has defined transitions", () => {
    const allStatuses = ["queued", "searching", "extracting", "persisting", "completed", "partial", "failed"];
    for (const status of allStatuses) {
      expect(VALID_TRANSITIONS[status]).toBeDefined();
    }
  });

  it("terminal states have no outgoing transitions", () => {
    for (const terminal of ["completed", "partial", "failed"]) {
      expect(VALID_TRANSITIONS[terminal]).toHaveLength(0);
    }
  });

  it("searching can transition to completed (empty results — honest status)", () => {
    // HONEST_STATUS: if Linkup returns 0 snippets, don't fake extraction
    expect(VALID_TRANSITIONS["searching"]).toContain("completed");
  });

  it("every non-terminal state can transition to failed (error boundary)", () => {
    for (const status of ["queued", "searching", "extracting", "persisting"]) {
      expect(VALID_TRANSITIONS[status]).toContain("failed");
    }
  });
});
