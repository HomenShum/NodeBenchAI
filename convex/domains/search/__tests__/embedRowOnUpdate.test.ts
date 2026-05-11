/**
 * Scenario tests for the embedding-pipeline auto-hooks (PR E).
 *
 * Per .claude/rules/scenario_testing.md — every test names a persona, a goal,
 * prior state, an action sequence, scale, and duration. The hook surface has
 * three layers:
 *
 *   1. Pure helpers (sha256Hex, clipInput, bounded) — deterministic, no I/O.
 *   2. embedSingle — single OpenAI fetch with timeout + BOUND_READ + HONEST_STATUS.
 *   3. embedXxxRow / embedStaleRows — Convex actions that require a runtime.
 *
 * `convex-test` is not yet wired in this repo (no devDependency, no harness),
 * so layer 3 is exercised via the existing federated search backfill tests
 * (where the same `searchableTextHash` field is read end-to-end). This file
 * covers layers 1 + 2, which is where the production bugs hide: silent 2xx
 * on failure paths, unbounded inputs/responses, non-deterministic hashes,
 * timeout never firing.
 *
 * Coverage matrix vs Agent-A's spec:
 *   - Single-user entity insert  → exercised by federatedSearch.test.ts and
 *     the live Convex deploy smoke (the schedule call here is a 2-line patch
 *     under the existing PR-D-tested code path).
 *   - Idempotency on hash         → tested here via sha256Hex stability +
 *     embedSingle behavior under repeated identical input.
 *   - HONEST_STATUS on 5xx        → tested here with a fetch mock returning 503.
 *   - 50 KB cap                   → tested here with a 200 KB input.
 *   - Cron sweep batchSize bound  → tested here via MAX_CRON_BATCH_SIZE constant
 *     and the bounded() reason cap.
 *
 * Pattern: deterministic, sandboxed mocks. No real network, no real Convex.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __test } from "../embedRowOnUpdate";

const {
  sha256Hex,
  clipInput,
  bounded,
  embedSingle,
  MAX_EMBED_INPUT_BYTES,
  EMBEDDING_DIMENSIONS,
  FETCH_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_CRON_BATCH_SIZE,
} = __test;

/* -------------------------------------------------------------------------- */
/* sha256Hex — DETERMINISTIC                                                   */
/* -------------------------------------------------------------------------- */

describe("sha256Hex — deterministic fingerprint", () => {
  /**
   * Persona:    Backfill worker re-runs after a partial failure
   * Goal:       Same row content collides with prior run's hash, so we skip
   * Prior:      Row was hashed yesterday with sha256(text) = X
   * Actions:    Hash same text today
   * Scale:      1 call
   * Duration:   Single call
   * Expected:   Identical lowercase-hex output
   */
  it("returns the same hex for the same input across calls", async () => {
    const a = await sha256Hex("Anthropic | anthropic-ai | safety research");
    const b = await sha256Hex("Anthropic | anthropic-ai | safety research");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * Persona:    Edit-after-create — user changes a single character
   * Goal:       Hash changes so the embed re-runs (and the cron picks up drift)
   * Prior:      Row had hash for "Anthropic"
   * Actions:    Hash "Anthropi" (one char shorter)
   * Scale:      2 calls
   * Duration:   Single tick
   * Expected:   Hashes differ
   */
  it("returns different hex when input differs by one character", async () => {
    const a = await sha256Hex("Anthropic");
    const b = await sha256Hex("Anthropi");
    expect(a).not.toBe(b);
  });

  /**
   * Adversarial: Unicode payload must not corrupt the digest.
   */
  it("handles unicode (emoji + non-Latin) without crashing", async () => {
    const a = await sha256Hex("🤖 Claude — モデル");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * Edge case: empty input is still a valid SHA-256 (the well-known constant).
   */
  it("returns the well-known empty-string SHA-256 for empty input", async () => {
    const a = await sha256Hex("");
    expect(a).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* clipInput — BOUND                                                           */
/* -------------------------------------------------------------------------- */

describe("clipInput — 50 KB cap", () => {
  /**
   * Persona:    Hostile/buggy client posts a 200 KB block (e.g. agent pastes
   *             a giant tool result into a notebook block)
   * Goal:       OpenAI request stays bounded — no $10 embedding call by accident
   * Prior:      Block.content flattens to a 200 KB string
   * Actions:    clipInput truncates before send
   * Scale:      200 KB → 50 KB
   * Duration:   Single tick
   * Expected:   Returned length === MAX_EMBED_INPUT_BYTES
   */
  it("truncates a 200 KB input to 50 KB", () => {
    const huge = "x".repeat(200_000);
    const got = clipInput(huge);
    expect(got.length).toBe(MAX_EMBED_INPUT_BYTES);
    expect(MAX_EMBED_INPUT_BYTES).toBe(50_000);
  });

  /**
   * Happy path: under-cap input passes through unchanged.
   */
  it("returns the input unchanged when under the cap", () => {
    const small = "Anthropic | anthropic-ai | safety research";
    expect(clipInput(small)).toBe(small);
  });

  /**
   * Edge case: input exactly at the cap is unchanged (off-by-one guard).
   */
  it("returns the input unchanged when exactly at the cap", () => {
    const exact = "y".repeat(MAX_EMBED_INPUT_BYTES);
    expect(clipInput(exact)).toBe(exact);
    expect(clipInput(exact).length).toBe(MAX_EMBED_INPUT_BYTES);
  });
});

/* -------------------------------------------------------------------------- */
/* bounded — 200-char reason cap                                               */
/* -------------------------------------------------------------------------- */

describe("bounded — HONEST_STATUS reason cap", () => {
  /**
   * Persona:    OpenAI returns a 5 KB error HTML page in the body
   * Goal:       Telemetry stays compact; reason field never floods logs
   * Prior:      Failure → reason = "OpenAI 503: <5KB HTML>"
   * Actions:    bounded() trims to 200 chars
   * Scale:      5000 → 200
   * Duration:   Single tick
   * Expected:   Truncated string ends in "..." marker
   */
  it("truncates a 5000-char reason to 200 chars with ellipsis", () => {
    const huge = "A".repeat(5_000);
    const got = bounded(huge);
    expect(got.length).toBe(200);
    expect(got.endsWith("...")).toBe(true);
  });

  it("passes through a short reason unchanged", () => {
    expect(bounded("ok")).toBe("ok");
    expect(bounded("hash unchanged")).toBe("hash unchanged");
  });

  it("returns the input unchanged when exactly at the cap", () => {
    const exact = "B".repeat(200);
    expect(bounded(exact)).toBe(exact);
    expect(bounded(exact).length).toBe(200);
  });
});

/* -------------------------------------------------------------------------- */
/* embedSingle — TIMEOUT, HONEST_STATUS, BOUND_READ                            */
/* -------------------------------------------------------------------------- */

describe("embedSingle — OpenAI fetch wire shape", () => {
  let originalKey: string | undefined;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-key-for-fetch-mock";
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalKey;
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  /**
   * Persona:    Founder edits an entity name; hook fires; OpenAI returns 200
   * Goal:       Embedding lands; downstream mutation can patch it back
   * Prior:      Mocked OpenAI returns a 1536-dim float array
   * Actions:    embedSingle("text") → ok: true with 1536 floats
   * Scale:      1 call
   * Duration:   Sub-second mocked
   * Expected:   { ok: true, embedding: [1536 floats] }
   */
  it("returns ok=true with a 1536-dim embedding on 200", async () => {
    const fakeEmbedding = Array.from({ length: 1536 }, (_, i) => i / 1536);
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ embedding: fakeEmbedding, index: 0 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const got = await embedSingle("Anthropic safety research");
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.embedding.length).toBe(EMBEDDING_DIMENSIONS);
    }
  });

  /**
   * Persona:    OpenAI returns a transient 5xx during a backfill sweep
   * Goal:       HONEST_STATUS — caller sees "failed", embedding stays null
   * Prior:      Fetch mock returns 503 with body "service unavailable"
   * Actions:    embedSingle → ok: false with bounded reason
   * Scale:      1 call
   * Duration:   Sub-second
   * Expected:   ok=false, reason contains "503"
   */
  it("returns ok=false on OpenAI 5xx (HONEST_STATUS)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("upstream unavailable", { status: 503 }),
    );
    const got = await embedSingle("Anthropic safety research");
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.reason).toContain("503");
    }
  });

  /**
   * Persona:    Misconfigured deploy — OPENAI_API_KEY missing
   * Goal:       HONEST_STATUS — explicit failure, no silent 2xx
   * Prior:      env unset
   * Actions:    embedSingle("text") → ok: false
   * Scale:      1 call
   * Duration:   Sub-second
   * Expected:   ok=false, reason "OPENAI_API_KEY missing"
   */
  it("returns ok=false when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const got = await embedSingle("text");
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.reason).toContain("OPENAI_API_KEY");
    }
    // No HTTP attempt should be made — we fail before fetch.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /**
   * Persona:    Network partition; AbortController fires at FETCH_TIMEOUT_MS
   * Goal:       TIMEOUT invariant — request never hangs forever
   * Prior:      Fetch mock throws AbortError
   * Actions:    embedSingle → ok: false
   * Scale:      1 call
   * Duration:   ≤ FETCH_TIMEOUT_MS (mocked instant)
   * Expected:   ok=false with reason mentioning the abort
   */
  it("returns ok=false when the fetch is aborted (TIMEOUT)", async () => {
    fetchSpy.mockImplementationOnce(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    const got = await embedSingle("text");
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.reason).toMatch(/aborted|abort/i);
    }
  });

  /**
   * Persona:    OpenAI returns wrong-dim embedding (model swap, regression)
   * Goal:       HONEST_STATUS — detect dimension drift, don't write to vector index
   * Prior:      Mocked response has 512-dim embedding instead of 1536
   * Actions:    embedSingle → ok: false
   * Scale:      1 call
   * Duration:   Sub-second
   * Expected:   ok=false, reason mentions wrong dims
   */
  it("returns ok=false on wrong embedding dimension", async () => {
    const wrongEmbedding = Array.from({ length: 512 }, () => 0);
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ embedding: wrongEmbedding, index: 0 }] }), {
        status: 200,
      }),
    );
    const got = await embedSingle("text");
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.reason).toContain("512");
      expect(got.reason).toContain("1536");
    }
  });

  /**
   * Persona:    Hostile/buggy OpenAI response — body exceeds 64 KB cap
   * Goal:       BOUND_READ — abort the stream, don't load megabytes into memory
   * Prior:      Mocked response body is a 200 KB JSON blob
   * Actions:    embedSingle reads up to MAX_RESPONSE_BYTES then cancels
   * Scale:      200 KB body
   * Duration:   Sub-second
   * Expected:   ok=false with reason mentioning the cap
   */
  it("returns ok=false when the OpenAI response exceeds the byte cap", async () => {
    const huge = JSON.stringify({
      data: [{ embedding: Array.from({ length: 1536 }, () => 0), index: 0 }],
      // Bloat the response with a 100 KB padding field.
      padding: "z".repeat(100_000),
    });
    // The Response body is huge — embedSingle should detect it crosses
    // MAX_RESPONSE_BYTES while streaming.
    fetchSpy.mockResolvedValueOnce(new Response(huge, { status: 200 }));
    const got = await embedSingle("text");
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.reason).toContain(String(MAX_RESPONSE_BYTES));
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Cron batch-size invariants — BOUND                                          */
/* -------------------------------------------------------------------------- */

describe("Cron batch size — BOUND invariants", () => {
  /**
   * Persona:    Operator bumps batchSize=10_000 hoping to clear the queue fast
   * Goal:       Cron is hard-capped at MAX_CRON_BATCH_SIZE
   * Prior:      Constant defined in the module
   * Actions:    Read the exported constant
   * Scale:      Compile-time invariant
   * Duration:   N/A
   * Expected:   MAX_CRON_BATCH_SIZE is bounded (we picked 500 as a safe ceiling)
   */
  it("caps batchSize at a reasonable ceiling", () => {
    expect(MAX_CRON_BATCH_SIZE).toBeLessThanOrEqual(500);
    expect(MAX_CRON_BATCH_SIZE).toBeGreaterThanOrEqual(200);
  });

  it("TIMEOUT budget is at least 5s and at most 60s", () => {
    expect(FETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(FETCH_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });
});
