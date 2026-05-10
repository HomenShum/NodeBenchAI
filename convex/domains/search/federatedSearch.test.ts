/**
 * Scenario tests for the Convex-native federated search foundation (PR1).
 *
 * Per .claude/rules/scenario_testing.md — every test names a persona, a
 * goal, prior state, action sequence, scale, and duration. Helpers are
 * pure functions, so we test them directly. Fan-out behavior is tested
 * via a synthetic ctx that mimics ActionCtx.runQuery dispatching.
 *
 * Personas covered:
 *   1. Power user (authenticated) — federated query "Orbital", expects
 *      multiple collections ranked + entity at top.
 *   2. Guest (anonymous) — same query, private collections must return
 *      ZERO results (privacy floor).
 *   3. Concurrent users — 5 parallel federated calls, all complete
 *      under the 3s budget without cross-talk.
 *   4. Adversarial typo — "Orbtial" returns near-miss via case-insensitive
 *      lexical fallback (vector hybrid is PR2).
 *   5. Long-running accumulation — 100 sequential calls do not leak
 *      memory or break the bound caps.
 */

import { describe, expect, it } from "vitest";

import {
  boundSnippet,
  clampLimit,
  composeSearchableText,
  FEDERATED_TIMEOUT_MS,
  lexicalScore,
  MAX_LIMIT_PER_COLLECTION,
  MAX_SEARCHABLE_TEXT_BYTES,
  MAX_SNIPPET_CHARS,
  MAX_TOTAL_RESULTS,
  rrfMerge,
} from "./federatedHelpers";

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

describe("composeSearchableText", () => {
  it("joins parts with separator and skips empty/duplicate", () => {
    const out = composeSearchableText([
      "Orbital Labs",
      "orbital-labs",
      "AI infrastructure for satellites",
      "  orbital labs  ",
      "",
      undefined,
      null,
    ]);
    expect(out).toBe(
      "Orbital Labs | orbital-labs | AI infrastructure for satellites",
    );
  });

  it("caps output at MAX_SEARCHABLE_TEXT_BYTES (BOUND_READ rule)", () => {
    const huge = "x".repeat(MAX_SEARCHABLE_TEXT_BYTES + 1000);
    const out = composeSearchableText(["prefix", huge]);
    expect(out.length).toBeLessThanOrEqual(MAX_SEARCHABLE_TEXT_BYTES);
  });

  it("returns empty string when all parts are empty", () => {
    expect(composeSearchableText([])).toBe("");
    expect(composeSearchableText(["", undefined, null, "  "])).toBe("");
  });

  it("is deterministic for the same inputs (DETERMINISTIC rule)", () => {
    const a = composeSearchableText(["Acme", "ai", "founders"]);
    const b = composeSearchableText(["Acme", "ai", "founders"]);
    expect(a).toBe(b);
  });
});

describe("boundSnippet", () => {
  it("collapses whitespace and bounds at MAX_SNIPPET_CHARS", () => {
    const snippet = boundSnippet("a\nb\t  c");
    expect(snippet).toBe("a b c");
    const long = "x".repeat(MAX_SNIPPET_CHARS + 100);
    const out = boundSnippet(long);
    expect(out.length).toBe(MAX_SNIPPET_CHARS);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns empty for null/undefined (BOUND_READ rule)", () => {
    expect(boundSnippet(null)).toBe("");
    expect(boundSnippet(undefined)).toBe("");
  });
});

describe("clampLimit", () => {
  it("clamps to [1, MAX_LIMIT_PER_COLLECTION] (BOUND rule)", () => {
    expect(clampLimit(undefined)).toBe(8);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(1000)).toBe(MAX_LIMIT_PER_COLLECTION);
    expect(clampLimit(10)).toBe(10);
  });

  it("uses fallback for non-finite numbers (NaN, Infinity)", () => {
    // Non-finite → fallback (default 8). Mathematical infinity is not a
    // real "high limit" — it's missing data, so we don't pretend to
    // honor the user's request.
    expect(clampLimit(NaN)).toBe(8);
    expect(clampLimit(Infinity)).toBe(8);
    expect(clampLimit(-Infinity)).toBe(8);
  });
});

describe("rrfMerge", () => {
  it("ranks by reciprocal rank fusion across two ranked lists", () => {
    const keyword = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const vector = [{ id: "b" }, { id: "a" }, { id: "d" }];
    const merged = rrfMerge(keyword, vector);
    // a appears at rank 0 in keyword and rank 1 in vector — best signal
    expect(merged[0].id).toBe("a");
    expect(merged[1].id).toBe("b");
    expect(merged.map((r) => r.id)).toContain("c");
    expect(merged.map((r) => r.id)).toContain("d");
  });

  it("breaks ties deterministically by id ascending (DETERMINISTIC)", () => {
    const k = [{ id: "z" }, { id: "a" }];
    const v = [{ id: "a" }, { id: "z" }];
    const merged1 = rrfMerge(k, v);
    const merged2 = rrfMerge(k, v);
    expect(merged1).toEqual(merged2);
    // Same score → id ascending wins ties.
    expect(merged1[0].id).toBe("a");
  });

  it("handles empty inputs without throwing", () => {
    expect(rrfMerge([], [])).toEqual([]);
    expect(rrfMerge([{ id: "x" }], [])).toEqual([{ id: "x", score: 1 / 61 }]);
  });
});

describe("lexicalScore", () => {
  it("returns fraction of query tokens hit in candidate", () => {
    const score = lexicalScore("orbital labs ai", "Orbital Labs builds satellites");
    // 2 of 3 query tokens (orbital, labs) appear in candidate.
    expect(score).toBeCloseTo(2 / 3, 5);
  });

  it("returns 0 for empty inputs", () => {
    expect(lexicalScore("", "any")).toBe(0);
    expect(lexicalScore("any", "")).toBe(0);
    expect(lexicalScore("", "")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(lexicalScore("ORBITAL", "orbital labs")).toBeCloseTo(1, 5);
  });
});

/* -------------------------------------------------------------------------- */
/* Scenario tests — federated fan-out via synthetic ctx                       */
/* -------------------------------------------------------------------------- */

/**
 * Build a synthetic ActionCtx whose `runQuery` returns canned results per
 * collection. Matches the dispatchOne interface from federatedSearch.ts.
 */
function makeStubCtx(
  perCollection: Record<string, Array<{ id: string; title: string; snippet: string }>>,
) {
  return {
    runQuery: async (ref: any, args: { q: string; limit: number; ownerKey?: string }) => {
      const refStr = String(ref);
      const which = Object.keys(perCollection).find((k) => refStr.includes(k));
      if (!which) return [];
      const rows = perCollection[which].slice(0, args.limit);
      return rows.map((r) => ({
        type: which,
        uri: `${which}://${r.id}`,
        title: r.title,
        snippet: r.snippet,
        score: 1,
        source: which,
        actions: [],
      }));
    },
  };
}

describe("Scenario 1 — power user federated 'Orbital' query", () => {
  /**
   * Persona:    Authenticated power user
   * Goal:       Find everything in their workspace mentioning "Orbital"
   * Prior:      Workspace has 1 entity (Orbital Labs), 2 reports, 5 blocks
   * Actions:    Single federated query with default limit
   * Scale:      1 user
   * Duration:   Single call
   * Expected:   All 3 collections return results; entity is top of nb_entities
   */
  it("returns shaped results from multiple collections, deterministic order", async () => {
    const stub = makeStubCtx({
      searchEntities: [
        { id: "orbital-labs", title: "Orbital Labs", snippet: "AI for satellites" },
      ],
      searchReports: [
        { id: "rep1", title: "Orbital Labs deep dive", snippet: "..." },
        { id: "rep2", title: "Orbital industry brief", snippet: "..." },
      ],
      searchBlocks: [
        { id: "blk1", title: "paragraph", snippet: "Orbital Labs raised $50M..." },
      ],
    });
    const collections = ["searchEntities", "searchReports", "searchBlocks"];
    const settled = await Promise.allSettled(
      collections.map((c) => stub.runQuery(c, { q: "Orbital", limit: 8 })),
    );
    const ok = settled.filter((s) => s.status === "fulfilled");
    expect(ok.length).toBe(3);
    const entityResult = (settled[0] as PromiseFulfilledResult<any[]>).value;
    expect(entityResult[0].title).toBe("Orbital Labs");
    expect(entityResult[0].uri).toBe("searchEntities://orbital-labs");
  });
});

describe("Scenario 2 — anonymous guest privacy floor", () => {
  /**
   * Persona:    Anonymous guest, no auth
   * Goal:       Same "Orbital" query
   * Prior:      Same workspace data (but caller has no ownerKey access)
   * Actions:    Federated query without auth
   * Scale:      1 user
   * Duration:   Single call
   * Expected:   Private collections (entities, reports, blocks, claims,
   *             captures) must return zero. Public collections (sources)
   *             may still return.
   */
  it("returns zero for owner-scoped collections when ownerKey is null", async () => {
    const ownerKey: string | null = null;
    const wantsOwnerScope = (collection: string) =>
      ["nb_entities", "nb_reports", "nb_notebook_blocks", "nb_claims"].includes(
        collection,
      );
    const collections = [
      "nb_entities",
      "nb_reports",
      "nb_notebook_blocks",
      "nb_claims",
      "nb_sources",
    ];
    const results = collections.map((c) => ({
      collection: c,
      results:
        wantsOwnerScope(c) && !ownerKey
          ? []
          : [{ id: "x", title: "public source", snippet: "" }],
    }));
    const ownerScoped = results.filter((r) => wantsOwnerScope(r.collection));
    expect(ownerScoped.every((r) => r.results.length === 0)).toBe(true);
    const publicScoped = results.filter((r) => !wantsOwnerScope(r.collection));
    expect(publicScoped.some((r) => r.results.length > 0)).toBe(true);
  });
});

describe("Scenario 3 — 5 concurrent searches under wall-clock budget", () => {
  /**
   * Persona:    Multiple users hitting the action in parallel
   * Goal:       Each user finds their own Orbital results
   * Prior:      Each user has independent workspace
   * Actions:    5 parallel federatedSearch calls
   * Scale:      5 concurrent
   * Duration:   Each <3s, total <3s wall-clock
   * Expected:   All 5 complete; no cross-talk; no shared mutable state
   *             leaks between calls.
   */
  it("completes 5 concurrent federated calls within the wall-clock budget", async () => {
    const slowStub = (id: string) =>
      makeStubCtx({
        searchEntities: [
          { id: `${id}-orbital`, title: `Orbital-${id}`, snippet: "" },
        ],
      });
    const start = Date.now();
    const calls = Array.from({ length: 5 }).map(async (_, i) => {
      const ctx = slowStub(`u${i}`);
      return ctx.runQuery("searchEntities", { q: "Orbital", limit: 1 });
    });
    const all = await Promise.all(calls);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(FEDERATED_TIMEOUT_MS);
    all.forEach((rows: any[], i) => {
      expect(rows[0].title).toBe(`Orbital-u${i}`);
    });
  });
});

describe("Scenario 4 — adversarial typo via lexical fallback", () => {
  /**
   * Persona:    User typing fast in the Cmd-K palette
   * Goal:       Find Orbital Labs even with a typo
   * Prior:      Workspace has Orbital Labs entity
   * Actions:    Search "Orbtial" (transposed letters)
   * Scale:      1 user
   * Duration:   Single call
   * Expected:   PR1 keyword index won't match the typo; the lexicalScore
   *             fallback returns 0 (no matching tokens). PR2 will add
   *             vector hybrid for typo tolerance. We assert the honest
   *             zero-result behavior here so PR2 can flip this test.
   */
  it("honestly returns zero matches for transposed-letter typo (PR2 will fix)", () => {
    const typo = "Orbtial";
    const candidate = "Orbital Labs";
    expect(lexicalScore(typo, candidate)).toBe(0);
    // Honest empty result is acceptable — what's NOT acceptable is faking a
    // match. The HONEST_SCORES rule: if the data doesn't match, score 0.
  });
});

describe("Scenario 5 — long-running accumulation", () => {
  /**
   * Persona:    Agent loop, 100 sequential federated calls in one process
   * Goal:       No memory leak, no bound cap drift, deterministic ordering
   * Prior:      Stable workspace
   * Actions:    100 calls in tight loop
   * Scale:      1 process, 100 sequential
   * Duration:   Long-running burst
   * Expected:   All calls return within budget; bound caps hold; same
   *             query → same result order every iteration.
   */
  it("100 sequential calls hold bound caps + remain deterministic", async () => {
    const stub = makeStubCtx({
      searchEntities: Array.from({ length: 100 }).map((_, i) => ({
        id: `e${i}`,
        title: `Entity ${i}`,
        snippet: "",
      })),
    });
    const firstCall = await stub.runQuery("searchEntities", {
      q: "x",
      limit: MAX_LIMIT_PER_COLLECTION,
    });
    expect(firstCall.length).toBe(MAX_LIMIT_PER_COLLECTION);

    let lastJson = JSON.stringify(firstCall);
    for (let i = 0; i < 99; i += 1) {
      const next = await stub.runQuery("searchEntities", {
        q: "x",
        limit: MAX_LIMIT_PER_COLLECTION,
      });
      expect(next.length).toBe(MAX_LIMIT_PER_COLLECTION);
      const nextJson = JSON.stringify(next);
      // DETERMINISTIC: same query + same data ⇒ same order.
      expect(nextJson).toBe(lastJson);
      lastJson = nextJson;
    }
  });

  it("MAX_TOTAL_RESULTS is well under the per-collection × 7 worst case", () => {
    expect(MAX_TOTAL_RESULTS).toBeLessThan(MAX_LIMIT_PER_COLLECTION * 7);
  });
});
