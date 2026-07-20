/**
 * Scenario tests for the federated-search response cache (Phase 12).
 *
 * Per .claude/rules/scenario_testing.md — every test names a persona,
 * goal, prior state, scale, duration, and expected outcome.
 *
 * Personas covered:
 *   1. Guest typing the same hot query twice — cache key is stable.
 *   2. Guest with different limit — cache key differs.
 *   3. Guest with collections in different order — same key (sorted).
 *   4. Adversarial — extra whitespace + casing produce the same key.
 *   5. Long-running — 1000 distinct keys, all unique.
 */

import { describe, expect, it } from "vitest";

import {
  buildFederatedCacheKey,
  FEDERATED_CACHE_TTL_MS,
  MAX_CACHED_RESPONSE_BYTES,
} from "./federatedSearchCache";

describe("buildFederatedCacheKey — DETERMINISTIC", () => {
  it("produces the same key for the same args (HONEST_STATUS hit)", () => {
    const a = buildFederatedCacheKey({
      q: "Anthropic",
      collections: ["nb_entities", "nb_reports"],
      limit: 8,
    });
    const b = buildFederatedCacheKey({
      q: "Anthropic",
      collections: ["nb_entities", "nb_reports"],
      limit: 8,
    });
    expect(a).toBe(b);
  });

  it("is order-independent for the collections array", () => {
    const ascending = buildFederatedCacheKey({
      q: "stripe",
      collections: ["nb_entities", "nb_reports", "nb_threads"],
      limit: 10,
    });
    const descending = buildFederatedCacheKey({
      q: "stripe",
      collections: ["nb_threads", "nb_reports", "nb_entities"],
      limit: 10,
    });
    expect(ascending).toBe(descending);
  });

  it("normalizes whitespace and case before hashing", () => {
    const lower = buildFederatedCacheKey({
      q: "anthropic",
      collections: ["nb_entities"],
      limit: 8,
    });
    const padded = buildFederatedCacheKey({
      q: "  Anthropic  ",
      collections: ["nb_entities"],
      limit: 8,
    });
    expect(lower).toBe(padded);
  });

  it("differs when limit changes (no cross-contamination)", () => {
    const eight = buildFederatedCacheKey({
      q: "openai",
      collections: ["nb_entities"],
      limit: 8,
    });
    const twentyFive = buildFederatedCacheKey({
      q: "openai",
      collections: ["nb_entities"],
      limit: 25,
    });
    expect(eight).not.toBe(twentyFive);
  });

  it("differs when the collection set changes", () => {
    const a = buildFederatedCacheKey({
      q: "vercel",
      collections: ["nb_entities"],
      limit: 8,
    });
    const b = buildFederatedCacheKey({
      q: "vercel",
      collections: ["nb_entities", "nb_reports"],
      limit: 8,
    });
    expect(a).not.toBe(b);
  });

  it("produces distinct keys for 1000 distinct queries (no collisions)", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const key = buildFederatedCacheKey({
        q: `query-${i}`,
        collections: ["nb_entities"],
        limit: 8,
      });
      keys.add(key);
    }
    expect(keys.size).toBe(1000);
  });

  it("separates fields so q vs collection-name cannot collide", () => {
    const aliasedQuery = buildFederatedCacheKey({
      q: "nb_entities",
      collections: [],
      limit: 8,
    });
    const aliasedCollection = buildFederatedCacheKey({
      q: "",
      collections: ["nb_entities"],
      limit: 8,
    });
    expect(aliasedQuery).not.toBe(aliasedCollection);
  });
});

describe("Phase 12 cache constants — BOUND invariants", () => {
  it("TTL is 5 minutes (matches schema documentation)", () => {
    expect(FEDERATED_CACHE_TTL_MS).toBe(5 * 60 * 1000);
  });

  it("response byte cap is 32 KB (fits MAX_TOTAL_RESULTS shape)", () => {
    expect(MAX_CACHED_RESPONSE_BYTES).toBe(32 * 1024);
  });
});
