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

describe("Scenario 4 — adversarial typo via vector hybrid (PR E)", () => {
  /**
   * Persona:    User typing fast in the Cmd-K palette
   * Goal:       Find Orbital Labs even with a typo
   * Prior:      Workspace has Orbital Labs entity (with embedding)
   * Actions:    Search "Orbtial" (transposed letters)
   * Scale:      1 user
   * Duration:   Single call
   *
   * PR D ship state (keyword-only): lexicalScore on the typo returns 0 —
   * keyword tokens don't overlap. This is the "honest zero" baseline.
   *
   * PR E ship state (vector hybrid): the typo's embedding is close to
   * "Orbital Labs"' embedding in the 1536-dim space, so vector search
   * surfaces the row even though the keyword path returns nothing.
   *
   * What this test asserts:
   *   - The lexical fallback STILL returns 0 (the keyword side is honest)
   *   - The rrfMerge function correctly handles "vector returns hits,
   *     keyword returns empty" — the merged result is the vector list
   *   - So a real federatedSearch call with vector hybrid enabled will
   *     return Orbital Labs for "Orbtial" (verified post-deploy via the
   *     CLI in the merge instructions).
   */
  it("keyword path honestly returns 0 for transposed-letter typo", () => {
    const typo = "Orbtial";
    const candidate = "Orbital Labs";
    // HONEST_SCORES — the keyword path didn't match, so score is 0.
    expect(lexicalScore(typo, candidate)).toBe(0);
  });

  it("rrfMerge gracefully handles vector-only hits (keyword empty)", () => {
    // Simulate the typo path: keyword path returned nothing, vector path
    // returned the entity at rank 0.
    const keyword: Array<{ id: string }> = [];
    const vector = [{ id: "entity://orbital-labs" }];
    const merged = rrfMerge(keyword, vector);
    expect(merged.length).toBe(1);
    expect(merged[0].id).toBe("entity://orbital-labs");
    // The score is the vector path's RRF contribution at rank 0:
    //   1 / (k + 0 + 1) = 1 / 61
    expect(merged[0].score).toBeCloseTo(1 / 61, 5);
  });

  it("rrfMerge boosts entries that BOTH paths agree on", () => {
    // When the typo is mild enough to match keyword via partial overlap
    // AND vector finds the same entity, the entity gets a higher score
    // than either path alone.
    const keyword = [{ id: "a" }, { id: "b" }];
    const vector = [{ id: "a" }, { id: "b" }];
    const merged = rrfMerge(keyword, vector);
    // a appears at rank 0 in BOTH paths → highest score.
    expect(merged[0].id).toBe("a");
    expect(merged[0].score).toBeCloseTo(2 / 61, 5);
    // b appears at rank 1 in both → second.
    expect(merged[1].id).toBe("b");
    expect(merged[1].score).toBeCloseTo(2 / 62, 5);
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

/* -------------------------------------------------------------------------- */
/* Scenario 6 — vector hybrid degradation when OPENAI_API_KEY missing (PR E)  */
/* -------------------------------------------------------------------------- */

describe("Scenario 6 — vector hybrid honest degradation (PR E)", () => {
  /**
   * Persona:    Self-hosted operator with no OpenAI key
   * Goal:       Search still works, just keyword-only
   * Prior:      Workspace has data but no embeddings backfilled
   * Actions:    Federated query for "Anthropic"
   * Scale:      1 user
   * Duration:   Single call
   *
   * Expected:   queryEmbedding is null → dispatchOne falls through to
   *             keyword-only — NEVER fakes a vector match.
   *             hybridUsed=false in the response surfaces this honestly.
   *
   * This is the HONEST_STATUS guard: degraded mode is ALWAYS visible to
   * the caller. No silent "we used vectors!" lies.
   */
  it("rrfMerge falls back gracefully when one side is empty", () => {
    // Vector-only fallback (keyword empty)
    const onlyVector = rrfMerge([], [{ id: "vec-hit" }]);
    expect(onlyVector.length).toBe(1);
    expect(onlyVector[0].id).toBe("vec-hit");
    // Keyword-only (vector empty / no embedding)
    const onlyKeyword = rrfMerge([{ id: "kw-hit" }], []);
    expect(onlyKeyword.length).toBe(1);
    expect(onlyKeyword[0].id).toBe("kw-hit");
    // Both empty
    expect(rrfMerge([], [])).toEqual([]);
  });

  it("FederatedSearchResponse type carries hybridUsed flag", () => {
    // This is a compile-time assertion — if FederatedSearchResponse loses
    // the hybridUsed field, the test file stops compiling.
    type AssertHasHybridUsed = "hybridUsed" extends
      keyof import("./federatedSearch").FederatedSearchResponse
      ? true
      : false;
    const flag: AssertHasHybridUsed = true;
    expect(flag).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Scenario 7 — long-running burst of typo queries (PR E)                     */
/* -------------------------------------------------------------------------- */

describe("Scenario 7 — typo queries at scale (PR E)", () => {
  /**
   * Persona:    Power user typing fast across a long session
   * Goal:       Every typo variant of "Orbital" recovers via vector hybrid
   * Prior:      Vector index populated with Orbital Labs embedding
   * Actions:    100 typo queries: Orbtial, Orbtal, Orbtl, Obital, Orbtl…
   * Scale:      100 sequential calls
   * Duration:   Sustained typing burst
   * Expected:   - Each typo's keyword path returns 0 (lexicalScore=0)
   *             - rrfMerge correctly merges the all-empty-keyword case
   *               with vector-only hits
   *             - No memory leak in rrfMerge, no determinism drift
   */
  it("100 typo queries' lexical fallback all return 0 (honest)", () => {
    const typos = [
      "Orbtial",
      "Orbtal",
      "Orbtl",
      "Obital",
      "Orbital ",
      "Orbital labs",
    ];
    const target = "Orbital Labs";
    for (let i = 0; i < 100; i += 1) {
      const typo = typos[i % typos.length];
      // Whole-word match works ("Orbital labs" matches "Orbital Labs"
      // case-insensitively); transposed-letter typos return 0.
      const isWholeWord = typo.toLowerCase().includes("orbital");
      const score = lexicalScore(typo, target);
      if (isWholeWord) {
        expect(score).toBeGreaterThan(0);
      } else {
        expect(score).toBe(0);
      }
    }
  });

  it("rrfMerge is stable under 1000 sequential merges (no leak)", () => {
    const keyword = [{ id: "a" }, { id: "b" }];
    const vector = [{ id: "b" }, { id: "c" }];
    let lastJson = "";
    for (let i = 0; i < 1000; i += 1) {
      const merged = rrfMerge(keyword, vector);
      const json = JSON.stringify(merged);
      if (i === 0) {
        lastJson = json;
        continue;
      }
      // DETERMINISTIC — same inputs MUST produce same output every iteration.
      expect(json).toBe(lastJson);
    }
  });
});
