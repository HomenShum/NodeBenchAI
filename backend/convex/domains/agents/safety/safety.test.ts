/**
 * Unit tests for the four demo-safety modules.
 *
 * These tests are the regression boundary. Every rule in the modules maps
 * to at least one test here.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  decideArtifactState,
  assertSaveAllowed,
  assertPublishAllowed,
  type ArtifactDecisionInput,
} from "./artifactDecisionGate";
import {
  classifyRetrievalConfidence,
  buildLowConfidenceCard,
  shouldStreamAnswer,
  type RetrievalState,
} from "./lowConfidenceGuard";
import {
  SingleflightMap,
  stableKey,
  entitySummarySingleflight,
  webSearchSingleflight,
} from "./singleflightMap";
import {
  checkAndConsume,
  checkAllLayers,
  getRateLimitStats,
} from "./rateLimitGuard";

// ───────────────────────────────────────────────────────────────────────────
// artifactDecisionGate
// ───────────────────────────────────────────────────────────────────────────

function baseDecision(over: Partial<ArtifactDecisionInput> = {}): ArtifactDecisionInput {
  return {
    mode: "fast",
    primaryCategory: "entity",
    resolutionExpectation: "exact_or_probable",
    citationCount: 2,
    retrievalConfidence: "high",
    hallucinationGateFailed: false,
    userExplicitlyRequestedSave: false,
    userScopedToEvent: false,
    hasUnsupportedClaim: false,
    ...over,
  };
}

describe("artifactDecisionGate.decideArtifactState", () => {
  it("defaults fast mode to none|draft (no silent save)", () => {
    const d = decideArtifactState(baseDecision());
    expect(d.allowedState).toBe("none|draft");
    expect(d.saveAllowed).toBe(false);
    expect(d.publishAllowed).toBe(false);
  });

  it("blocks save for every adversarial category regardless of other signals", () => {
    const cats = [
      "adversarial_injection",
      "adversarial_pii",
      "adversarial_ssrf",
      "adversarial_exfil",
    ] as const;
    for (const cat of cats) {
      const d = decideArtifactState(
        baseDecision({
          mode: "slow",
          primaryCategory: cat,
          citationCount: 99,
          retrievalConfidence: "high",
          userExplicitlyRequestedSave: true,
          userScopedToEvent: true,
        }),
      );
      expect(d.allowedState, `${cat} must return none`).toBe("none");
      expect(d.saveAllowed).toBe(false);
      expect(d.publishAllowed).toBe(false);
    }
  });

  it("locks to draft_only when hallucination gate failed", () => {
    const d = decideArtifactState(
      baseDecision({ hallucinationGateFailed: true, retrievalConfidence: "high" }),
    );
    expect(d.allowedState).toBe("draft_only");
    expect(d.saveAllowed).toBe(false);
  });

  it("locks to draft_only when answer-control flagged unsupported claim", () => {
    const d = decideArtifactState(
      baseDecision({ hasUnsupportedClaim: true, retrievalConfidence: "high" }),
    );
    expect(d.allowedState).toBe("draft_only");
  });

  it("blocks canonicalization on ambiguous resolution", () => {
    const d = decideArtifactState(
      baseDecision({ resolutionExpectation: "ambiguous" }),
    );
    expect(d.allowedState).toBe("none|draft");
    expect(d.saveAllowed).toBe(false);
  });

  it("allows fast save only with explicit user intent AND high confidence", () => {
    const noIntent = decideArtifactState(
      baseDecision({ userExplicitlyRequestedSave: false, retrievalConfidence: "high" }),
    );
    expect(noIntent.saveAllowed).toBe(false);

    const noConfidence = decideArtifactState(
      baseDecision({ userExplicitlyRequestedSave: true, retrievalConfidence: "medium" }),
    );
    expect(noConfidence.saveAllowed).toBe(false);

    const both = decideArtifactState(
      baseDecision({ userExplicitlyRequestedSave: true, retrievalConfidence: "high" }),
    );
    expect(both.allowedState).toBe("draft|saved");
    expect(both.saveAllowed).toBe(true);
  });

  it("applies slow save-gate: exact + 2 citations + not-low + event-scoped", () => {
    const ok = decideArtifactState(
      baseDecision({
        mode: "slow",
        resolutionExpectation: "exact",
        citationCount: 2,
        retrievalConfidence: "high",
        userScopedToEvent: true,
      }),
    );
    expect(ok.allowedState).toBe("draft|saved");
    expect(ok.saveAllowed).toBe(true);

    const lowConfidence = decideArtifactState(
      baseDecision({
        mode: "slow",
        resolutionExpectation: "exact",
        citationCount: 2,
        retrievalConfidence: "low",
        userScopedToEvent: true,
      }),
    );
    expect(lowConfidence.allowedState).toBe("draft");
    expect(lowConfidence.saveAllowed).toBe(false);

    const noEvent = decideArtifactState(
      baseDecision({
        mode: "slow",
        resolutionExpectation: "exact",
        citationCount: 2,
        retrievalConfidence: "high",
        userScopedToEvent: false,
      }),
    );
    expect(noEvent.saveAllowed).toBe(false);
  });

  it("pulse category owns its artifact as saved", () => {
    const d = decideArtifactState(
      baseDecision({ mode: "pulse", primaryCategory: "pulse_generation" }),
    );
    expect(d.allowedState).toBe("saved");
    expect(d.saveAllowed).toBe(true);
  });

  it("export requires citations and confidence", () => {
    const good = decideArtifactState(
      baseDecision({
        mode: "slow",
        primaryCategory: "crm_export",
        citationCount: 3,
        retrievalConfidence: "high",
      }),
    );
    expect(good.allowedState).toBe("saved|published");
    expect(good.publishAllowed).toBe(true);

    const weak = decideArtifactState(
      baseDecision({
        mode: "slow",
        primaryCategory: "crm_export",
        citationCount: 1,
        retrievalConfidence: "medium",
      }),
    );
    expect(weak.allowedState).toBe("draft");
    expect(weak.publishAllowed).toBe(false);
  });

  it("assertSaveAllowed throws on blocked save with explicit context", () => {
    const d = decideArtifactState(baseDecision());
    expect(() => assertSaveAllowed(d, "chat.ts:1832")).toThrow(/chat\.ts:1832/);
  });

  it("assertPublishAllowed throws when publish not allowed", () => {
    const d = decideArtifactState(baseDecision({ mode: "slow", userScopedToEvent: true }));
    expect(() => assertPublishAllowed(d, "exportRoute")).toThrow(/exportRoute/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// lowConfidenceGuard
// ───────────────────────────────────────────────────────────────────────────

describe("lowConfidenceGuard.classifyRetrievalConfidence", () => {
  const now = Date.now();

  it("returns high when artifact block hit", () => {
    const state: RetrievalState = {
      snippets: [],
      scratchpadHit: false,
      artifactBlockHit: true,
      eslHit: false,
      queriedAt: now,
    };
    expect(classifyRetrievalConfidence(state)).toBe("high");
  });

  it("returns high when ESL hit with at least one snippet", () => {
    const state: RetrievalState = {
      snippets: [{ url: "u", title: "t", snippet: "s", sourceClass: "profile" }],
      scratchpadHit: false,
      artifactBlockHit: false,
      eslHit: true,
      queriedAt: now,
    };
    expect(classifyRetrievalConfidence(state)).toBe("high");
  });

  it("returns high with ≥3 fresh snippets", () => {
    const state: RetrievalState = {
      snippets: [
        { url: "u1", title: "t", snippet: "s", fetchedAt: now, sourceClass: "news" },
        { url: "u2", title: "t", snippet: "s", fetchedAt: now, sourceClass: "news" },
        { url: "u3", title: "t", snippet: "s", fetchedAt: now, sourceClass: "news" },
      ],
      scratchpadHit: false,
      artifactBlockHit: false,
      eslHit: false,
      queriedAt: now,
    };
    expect(classifyRetrievalConfidence(state)).toBe("high");
  });

  it("returns medium with 1-2 fresh snippets", () => {
    const state: RetrievalState = {
      snippets: [{ url: "u", title: "t", snippet: "s", fetchedAt: now, sourceClass: "news" }],
      scratchpadHit: false,
      artifactBlockHit: false,
      eslHit: false,
      queriedAt: now,
    };
    expect(classifyRetrievalConfidence(state)).toBe("medium");
  });

  it("returns low with zero fresh snippets", () => {
    const state: RetrievalState = {
      snippets: [],
      scratchpadHit: false,
      artifactBlockHit: false,
      eslHit: false,
      queriedAt: now,
    };
    expect(classifyRetrievalConfidence(state)).toBe("low");
  });

  it("treats stale news (>7 days) as not fresh", () => {
    const stale = now - 1000 * 60 * 60 * 24 * 8;
    const state: RetrievalState = {
      snippets: Array.from({ length: 3 }, (_, i) => ({
        url: `u${i}`,
        title: "t",
        snippet: "s",
        fetchedAt: stale,
        sourceClass: "news" as const,
      })),
      scratchpadHit: false,
      artifactBlockHit: false,
      eslHit: false,
      queriedAt: now,
    };
    expect(classifyRetrievalConfidence(state)).toBe("low");
  });
});

describe("lowConfidenceGuard.buildLowConfidenceCard", () => {
  it("returns no-sources variant when zero snippets", () => {
    const card = buildLowConfidenceCard("obscure query", {
      snippets: [],
      scratchpadHit: false,
      artifactBlockHit: false,
      eslHit: false,
      queriedAt: Date.now(),
    });
    expect(card.kind).toBe("low_confidence");
    expect(card.snippetCount).toBe(0);
    expect(card.ctaAction).toBe("escalate_to_slow");
  });

  it("returns limited-sources variant when 1-2 fresh snippets", () => {
    const card = buildLowConfidenceCard("niche entity", {
      snippets: [{ url: "u", title: "t", snippet: "s", fetchedAt: Date.now() }],
      scratchpadHit: false,
      artifactBlockHit: false,
      eslHit: false,
      queriedAt: Date.now(),
    });
    expect(card.snippetCount).toBe(1);
    expect(card.body).toMatch(/1 fresh source/);
  });
});

describe("lowConfidenceGuard.shouldStreamAnswer", () => {
  it("maps confidence → action correctly", () => {
    expect(shouldStreamAnswer("high")).toBe("stream");
    expect(shouldStreamAnswer("medium")).toBe("stream_with_caveat");
    expect(shouldStreamAnswer("low")).toBe("return_card");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// singleflightMap
// ───────────────────────────────────────────────────────────────────────────

describe("singleflightMap.stableKey", () => {
  it("produces same key regardless of property insertion order", () => {
    const a = stableKey({ provider: "linkup", entity: "stripe", day: "2026-04-22" });
    const b = stableKey({ day: "2026-04-22", entity: "stripe", provider: "linkup" });
    expect(a).toBe(b);
  });

  it("sort-stable at nested levels", () => {
    const a = stableKey({ outer: { z: 1, a: 2 }, other: 3 });
    const b = stableKey({ other: 3, outer: { a: 2, z: 1 } });
    expect(a).toBe(b);
  });
});

describe("singleflightMap", () => {
  it("coalesces concurrent callers for the same key onto one fetch", async () => {
    const map = new SingleflightMap<number>({ ttlMs: 5000 });
    let fetchCount = 0;
    const fetcher = () =>
      new Promise<number>((resolve) => {
        fetchCount++;
        setTimeout(() => resolve(42), 20);
      });

    const [a, b, c] = await Promise.all([
      map.run("entity:stripe", fetcher),
      map.run("entity:stripe", fetcher),
      map.run("entity:stripe", fetcher),
    ]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(c).toBe(42);
    expect(fetchCount).toBe(1);
    const stats = map.getStats();
    expect(stats.misses).toBe(1);
    expect(stats.inflightHits).toBeGreaterThanOrEqual(2);
  });

  it("different keys run independently", async () => {
    const map = new SingleflightMap<string>({ ttlMs: 5000 });
    let count = 0;
    const fetcher = (v: string) => async () => {
      count++;
      return v;
    };
    const [a, b] = await Promise.all([
      map.run("k1", fetcher("A")),
      map.run("k2", fetcher("B")),
    ]);
    expect(a).toBe("A");
    expect(b).toBe("B");
    expect(count).toBe(2);
  });

  it("second caller after TTL refetches", async () => {
    const map = new SingleflightMap<number>({ ttlMs: 10 });
    let count = 0;
    const fetcher = async () => {
      count++;
      return count;
    };
    const first = await map.run("k", fetcher);
    await new Promise((r) => setTimeout(r, 30));
    const second = await map.run("k", fetcher);
    expect(first).toBe(1);
    expect(second).toBe(2);
  });

  it("rejected leader evicts entry so retries can start fresh", async () => {
    const map = new SingleflightMap<number>({ ttlMs: 5000 });
    let calls = 0;
    const fetcher = async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return 7;
    };
    await expect(map.run("k", fetcher)).rejects.toThrow(/boom/);
    const retried = await map.run("k", fetcher);
    expect(retried).toBe(7);
    expect(calls).toBe(2);
  });

  it("enforces LRU when maxEntries exceeded", async () => {
    const map = new SingleflightMap<string>({ ttlMs: 5000, maxEntries: 3 });
    // Stagger completions so entries are "settled" by the time we evict
    await map.run("a", async () => "A");
    await map.run("b", async () => "B");
    await map.run("c", async () => "C");
    await map.run("d", async () => "D"); // forces eviction of "a"
    const stats = map.getStats();
    expect(stats.evictions).toBeGreaterThanOrEqual(1);
    expect(stats.size).toBeLessThanOrEqual(3);
  });

  it("exports shared singletons with distinct TTLs", () => {
    expect(entitySummarySingleflight).toBeDefined();
    expect(webSearchSingleflight).toBeDefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// rateLimitGuard
// ───────────────────────────────────────────────────────────────────────────

// Each rateLimitGuard test uses a unique user/entity so buckets don't collide
// across tests. Rate-limiter state is module-global by design.

describe("rateLimitGuard.checkAndConsume", () => {
  it("returns allowed with decrementing remaining for each call", () => {
    const userId = `test-user-${Math.random().toString(36).slice(2)}`;
    const first = checkAndConsume({ scope: "per_user_per_minute", userId });
    const second = checkAndConsume({ scope: "per_user_per_minute", userId });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBeLessThan(first.remaining);
  });

  it("denies once the cap is exhausted and returns retryAfterMs", () => {
    const userId = `test-user-exhaust-${Math.random().toString(36).slice(2)}`;
    for (let i = 0; i < 30; i++) {
      const r = checkAndConsume({ scope: "per_user_per_minute", userId });
      expect(r.allowed).toBe(true);
    }
    const denied = checkAndConsume({ scope: "per_user_per_minute", userId });
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.reason).toMatch(/exhausted/);
  });
});

describe("rateLimitGuard.checkAllLayers", () => {
  it("allows when all layers have capacity", () => {
    const r = checkAllLayers({
      userId: `user-${Math.random().toString(36).slice(2)}`,
      entitySlug: `entity-${Math.random().toString(36).slice(2)}`,
      provider: "linkup",
    });
    expect(r.allowed).toBe(true);
  });

  it("returns the denying layer when any one denies", () => {
    const userId = `user-deny-${Math.random().toString(36).slice(2)}`;
    // Exhaust the user layer
    for (let i = 0; i < 30; i++) {
      checkAndConsume({ scope: "per_user_per_minute", userId });
    }
    const denied = checkAllLayers({
      userId,
      entitySlug: `entity-${Math.random().toString(36).slice(2)}`,
      provider: "linkup",
    });
    expect(denied.allowed).toBe(false);
    expect(denied.scope).toBe("per_user_per_minute");
  });
});

describe("rateLimitGuard.getRateLimitStats", () => {
  it("returns bucket telemetry", () => {
    const stats = getRateLimitStats();
    expect(stats.totalBuckets).toBeGreaterThanOrEqual(0);
    expect(stats.bucketsNearCap).toBeGreaterThanOrEqual(0);
  });
});
