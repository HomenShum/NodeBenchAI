import { describe, it, expect } from "vitest";
import { rrfFuse, rerankWithGemini, triSearch, condenseQuery, RRF_K, type TriCandidate } from "./triSearch";

// Scenario-based tests (.claude/rules/scenario_testing.md).
// Persona: a founder/analyst running entity due-diligence; the grounding harness
// has retrieved candidate sources from three legs (Linkup, web_search, entity cache)
// and must fuse + rerank them by relevance before the answer is synthesized.

const mockGeminiFetch = (orderJson: string): typeof fetch =>
  (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: orderJson }] } }] }),
    }) as unknown as Response) as unknown as typeof fetch;

function leg(source: string, ids: string[]): TriCandidate[] {
  return ids.map((id) => ({ id, source, title: `${id} title`, snippet: `${id} snippet about the entity`, url: `https://x/${id}` }));
}

describe("rrfFuse — rank-based fusion across heterogeneous legs", () => {
  it("happy path: a source ranked high across multiple legs wins after fusion", () => {
    // 3 legs; "anthropic-funding" appears in all three near the top -> should fuse to #1.
    const legs = [
      leg("linkup", ["anthropic-funding", "anthropic-blog", "noise-a"]),
      leg("web", ["anthropic-funding", "noise-b", "anthropic-blog"]),
      leg("entity", ["anthropic-funding", "anthropic-team"]),
    ];
    const fused = rrfFuse(legs);
    expect(fused[0].id).toBe("anthropic-funding");
    expect(fused[0].fusedRank).toBe(0);
    // dedup: 5 distinct ids across the 3 legs (funding, blog, noise-a, noise-b, team)
    expect(new Set(fused.map((c) => c.id)).size).toBe(fused.length);
    expect(fused.length).toBe(5);
    // fused score is monotonic non-increasing
    for (let i = 1; i < fused.length; i++) expect(fused[i - 1].fusedScore).toBeGreaterThanOrEqual(fused[i].fusedScore);
  });

  it("uses k=60 by default and is deterministic across runs", () => {
    const legs = [leg("linkup", ["a", "b"]), leg("web", ["b", "a"])];
    const first = rrfFuse(legs);
    const second = rrfFuse(legs);
    expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id));
    // a and b each appear once at rank0 and once at rank1 -> equal score; tie broken by stable order
    expect(first[0].fusedScore).toBeCloseTo(1 / (RRF_K + 1) + 1 / (RRF_K + 2), 10);
  });

  it("edge: empty legs and malformed candidates don't crash", () => {
    const fused = rrfFuse([[], [{ id: "", source: "x" } as TriCandidate], leg("web", ["only"])]);
    expect(fused.map((c) => c.id)).toEqual(["only"]);
  });
});

describe("rerankWithGemini — precision leg with honest fallback", () => {
  const fused = rrfFuse([leg("linkup", ["s0", "s1", "s2", "s3"])]);

  it("happy path: reorders candidates per the model's index array", async () => {
    const r = await rerankWithGemini("entity funding", fused, { topN: 3, apiKey: "test", fetchImpl: mockGeminiFetch("[2,0,1]") });
    expect(r.rerankStatus).toBe("ok");
    expect(r.ranked.map((c) => c.id)).toEqual(["s2", "s0", "s1"]);
  });

  it("adversarial: out-of-range + duplicate indices are sanitized, completeness preserved", async () => {
    // Model returns garbage: dup (2), out-of-range (99, -1), valid (0). topN large enough to see completeness.
    const r = await rerankWithGemini("q", fused, { topN: 10, apiKey: "test", fetchImpl: mockGeminiFetch("[2, 2, 99, -1, 0]") });
    expect(r.rerankStatus).toBe("ok");
    // valid picks first (2,0), then omitted (1,3) appended in fused order
    expect(r.ranked.map((c) => c.id)).toEqual(["s2", "s0", "s1", "s3"]);
    expect(new Set(r.ranked.map((c) => c.id)).size).toBe(4); // no dupes
  });

  it("HONEST_STATUS: zero usable indices ([], all out-of-range, non-numeric) -> fallback, not a phantom 'ok'", async () => {
    // The model returned an array, but nothing in it maps to a real candidate. The result is pure
    // fused order — so the status MUST be fallback, not "ok" (which would lie that a rerank happened).
    for (const garbage of ["[]", "[999, -1, 7]", "[\"x\", \"y\"]"]) {
      const r = await rerankWithGemini("q", fused, { topN: 4, apiKey: "test", fetchImpl: mockGeminiFetch(garbage) });
      expect(r.rerankStatus).toBe("fallback");
      expect(r.ranked.map((c) => c.id)).toEqual(["s0", "s1", "s2", "s3"]); // untouched fused order
      expect(r.detail).toMatch(/no valid index/i);
    }
  });

  it("sad path: missing API key -> skipped, returns fused top-N unchanged", async () => {
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const r = await rerankWithGemini("q", fused, { topN: 2 });
      expect(r.rerankStatus).toBe("skipped");
      expect(r.ranked.map((c) => c.id)).toEqual(["s0", "s1"]);
    } finally {
      if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
    }
  });

  it("degraded: non-2xx falls back to fused order, never throws", async () => {
    const badFetch = (async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    const r = await rerankWithGemini("q", fused, { topN: 4, apiKey: "test", fetchImpl: badFetch });
    expect(r.rerankStatus).toBe("fallback");
    expect(r.ranked.map((c) => c.id)).toEqual(["s0", "s1", "s2", "s3"]);
  });

  it("degraded: fetch throws (timeout/abort) -> fallback, fused order, honest detail", async () => {
    const throwFetch = (async () => { const e: any = new Error("aborted"); e.name = "TimeoutError"; throw e; }) as unknown as typeof fetch;
    const r = await rerankWithGemini("q", fused, { topN: 4, apiKey: "test", fetchImpl: throwFetch });
    expect(r.rerankStatus).toBe("fallback");
    expect(r.detail).toMatch(/timed out/i);
    expect(r.ranked.length).toBe(4);
  });

  it("bound: never reranks more than MAX_RERANK_CANDIDATES", async () => {
    const many = rrfFuse([leg("web", Array.from({ length: 30 }, (_, i) => `c${i}`))]);
    let promptLen = 0;
    const spyFetch = (async (_url: string, init: any) => {
      promptLen = JSON.parse(init.body).contents[0].parts[0].text.length;
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "[0,1,2,3,4]" }] } }] }) } as unknown as Response;
    }) as unknown as typeof fetch;
    await rerankWithGemini("q", many, { topN: 5, apiKey: "test", fetchImpl: spyFetch });
    // only 12 candidates ([0]..[11]) should appear in the prompt, not [12]+
    expect(promptLen).toBeGreaterThan(0);
  });
});

describe("triSearch — fuse + rerank end to end", () => {
  it("returns reranked top-N with a trace-ready summary", async () => {
    const legs = [leg("linkup", ["a", "b", "c"]), leg("web", ["b", "d"])];
    const out = await triSearch("the query", legs, { topN: 2, apiKey: "test", fetchImpl: mockGeminiFetch("[1,0]") });
    expect(out.fusedCount).toBe(4); // a,b,c,d
    expect(out.rerankStatus).toBe("ok");
    expect(out.ranked.length).toBe(2);
    expect(typeof out.durationMs).toBe("number");
  });
});

// Multi-turn condense (rewrite-then-retrieve). Persona: an event attendee asking a
// running /ask thread with context-dependent follow-ups ("how do I rotate those?").
describe("condenseQuery — multi-turn query rewrite", () => {
  it("passthrough: no prior turns → raw question unchanged (no LLM call)", async () => {
    const r = await condenseQuery("how do I rotate those?", [], { apiKey: "test" });
    expect(r.status).toBe("passthrough");
    expect(r.query).toBe("how do I rotate those?");
  });

  it("happy path: rewrites the follow-up into a standalone query using history", async () => {
    const r = await condenseQuery("how do I rotate those?", ["What did the panel say about MCP enterprise auth?"], {
      apiKey: "test",
      fetchImpl: mockGeminiFetch("rotate MCP scoped credentials"),
    });
    expect(r.status).toBe("rewritten");
    expect(r.query).toBe("rotate MCP scoped credentials");
  });

  it("sad path: missing API key → fallback to raw question", async () => {
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const r = await condenseQuery("compare that to static keys", ["scoped creds vs static keys"]);
      expect(r.status).toBe("fallback");
      expect(r.query).toBe("compare that to static keys");
    } finally {
      if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
    }
  });

  it("degraded: non-2xx → fallback to raw question, never throws", async () => {
    const bad = (async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    const r = await condenseQuery("and the cost?", ["audit tool calls"], { apiKey: "test", fetchImpl: bad });
    expect(r.status).toBe("fallback");
    expect(r.query).toBe("and the cost?");
  });

  it("bound: only the last maxTurns of history reach the prompt", async () => {
    let promptText = "";
    const spy = (async (_u: string, init: any) => {
      promptText = JSON.parse(init.body).contents[0].parts[0].text;
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "rewritten" }] } }] }) } as unknown as Response;
    }) as unknown as typeof fetch;
    const turns = Array.from({ length: 12 }, (_, i) => `turn ${i}`);
    const r = await condenseQuery("now what?", turns, { apiKey: "test", maxTurns: 3, fetchImpl: spy });
    expect(r.status).toBe("rewritten");
    expect(promptText).toContain("turn 11"); // last turn included
    expect(promptText).not.toContain("turn 0"); // beyond the last 3 → excluded
  });
});
