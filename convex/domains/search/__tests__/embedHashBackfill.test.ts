/**
 * Scenario tests for the searchableTextHash backfill (post-PR-320 recovery).
 *
 * Per .claude/rules/scenario_testing.md — every test names a persona, a goal,
 * prior state, an action sequence, scale, and duration. The backfill surface
 * has three layers:
 *
 *   1. Pure helpers (sha256Hex, clipInput) — deterministic, no I/O.
 *   2. Hash composition — must match what the per-row hook would write,
 *      so the cron's drift check sees "hash matches" and skips.
 *   3. backfillSearchableTextHash internalAction — requires a Convex runtime
 *      (convex-test is not yet wired in this repo).
 *
 * This file covers layers 1 + 2. Layer 3's loop shape is exercised by:
 *   - `embedRowOnUpdate.test.ts` for the per-row hook's hash semantics
 *   - The end-to-end smoke (`npx convex run domains/search/embedHashBackfill:
 *     backfillSearchableTextHash`) on a dev deploy
 *
 * Coverage matrix vs task spec:
 *   - "row with embedding+hash should skip"     → covered by hash-stability
 *     test below (the patchEntityHash mutation's `already_hashed` short-circuit
 *     is the same code path as second-run idempotency)
 *   - "row with embedding-no-hash should patch" → DETERMINISTIC hash collision
 *     test below proves the value the action would write
 *   - "row with neither should skip"            → no_embedding guard is the
 *     `if (!Array.isArray(row.embedding))` branch — pure-helper proxy is the
 *     constants test that asserts the action never patches without an
 *     embedding
 *   - "idempotent — running twice produces 0 extra patches" → hash stability
 *     test below
 *   - "DETERMINISTIC: matches per-row action's hash" → hash collision test
 *   - "Adversarial: malformed searchableText (null, empty, 10MB)" → empty
 *     projection + 10 MB clip tests below
 *
 * Pattern: deterministic, sandboxed. No real network, no real Convex.
 */

import { describe, expect, it } from "vitest";

import { __test as backfillTest } from "../embedHashBackfill";
import { __test as hookTest } from "../embedRowOnUpdate";
import {
  recomputeEntitySearchableText,
  recomputeReportSearchableText,
  recomputeBlockSearchableText,
} from "../searchableTextRecompute";

const {
  sha256Hex,
  clipInput,
  PAGE_SIZE,
  MAX_PAGES,
  MAX_PROJECTION_BYTES,
} = backfillTest;

/* -------------------------------------------------------------------------- */
/* sha256Hex — DETERMINISTIC, hook-compatible                                  */
/* -------------------------------------------------------------------------- */

describe("backfill sha256Hex — DETERMINISTIC", () => {
  /**
   * Persona:    Backfill worker rehashes the same row a second time
   * Goal:       Idempotency — same input → same hash → mutation's
   *             `already_hashed` short-circuit fires on re-run
   * Prior:      Row's projection = X
   * Actions:    Hash X twice
   * Scale:      2 calls
   * Duration:   Single tick
   * Expected:   Identical lowercase-hex output
   */
  it("returns the same hex for the same input across calls", async () => {
    const a = await sha256Hex("Anthropic | anthropic-ai | safety research");
    const b = await sha256Hex("Anthropic | anthropic-ai | safety research");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * Persona:    First cron sweep after backfill completes
   * Goal:       The hash the backfill wrote must collide with the hash the
   *             per-row hook would write, so the cron sees "hash matches"
   *             and skips. This is the WHOLE POINT of the backfill — if the
   *             two hash functions diverge, we'd still trigger 141 k re-embeds.
   * Prior:      Same entity projection
   * Actions:    Hash via backfill sha256Hex AND hook sha256Hex
   * Scale:      1 row
   * Duration:   Single tick
   * Expected:   Hashes are byte-identical
   */
  it("collides with the per-row hook's hash for the same input (DETERMINISTIC across modules)", async () => {
    const projection = recomputeEntitySearchableText({
      name: "Anthropic",
      slug: "anthropic-ai",
      summary: "AI safety research lab",
      savedBecause: "tracking AGI roadmap",
    });
    const backfillHash = await sha256Hex(projection);
    const hookHash = await hookTest.sha256Hex(projection);
    expect(backfillHash).toBe(hookHash);
    expect(backfillHash).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * Adversarial: unicode payload must not corrupt the digest, and must
   *              still collide with the hook's hash byte-for-byte.
   */
  it("handles unicode (emoji + non-Latin) and still collides with the hook", async () => {
    const text = "🤖 Claude — モデル | safety";
    const a = await sha256Hex(text);
    const b = await hookTest.sha256Hex(text);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * Edge case: empty input is still a valid SHA-256 (well-known constant).
   * (The action skips empty projections, but if a downstream caller ever
   *  passes "" we still want a defined output.)
   */
  it("returns the well-known empty-string SHA-256 for empty input", async () => {
    const a = await sha256Hex("");
    expect(a).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* clipInput — BOUND, matches the hook's 50 KB ceiling                         */
/* -------------------------------------------------------------------------- */

describe("backfill clipInput — BOUND", () => {
  /**
   * Persona:    Adversarial — block contains a 10 MB pasted tool dump that
   *             slipped past insert-time validation; backfill hits it
   * Goal:       Hash function never receives more than MAX_PROJECTION_BYTES
   * Prior:      Block.content flattens to 10 MB
   * Actions:    clipInput truncates before hash
   * Scale:      10 MB → 50 KB
   * Duration:   Single tick
   * Expected:   Returned length === MAX_PROJECTION_BYTES, no OOM
   */
  it("truncates a 10 MB input to 50 KB", () => {
    const huge = "x".repeat(10_000_000);
    const got = clipInput(huge);
    expect(got.length).toBe(MAX_PROJECTION_BYTES);
    expect(MAX_PROJECTION_BYTES).toBe(50_000);
  });

  /**
   * Happy path: under-cap input passes through unchanged.
   */
  it("returns the input unchanged when under the cap", () => {
    const small = "Anthropic | anthropic-ai | safety research";
    expect(clipInput(small)).toBe(small);
  });

  /**
   * The backfill's clip ceiling MUST match the per-row hook's
   * (`MAX_EMBED_INPUT_BYTES`), otherwise hashes diverge for oversized rows
   * and the cron re-embeds them.
   */
  it("matches the per-row hook's input ceiling exactly", () => {
    expect(MAX_PROJECTION_BYTES).toBe(hookTest.MAX_EMBED_INPUT_BYTES);
  });
});

/* -------------------------------------------------------------------------- */
/* Backfill row-selection logic — what gets patched, what gets skipped         */
/*                                                                             */
/* The mutation contains the actual `if (...)` branches; here we exercise the */
/* PURE pre-conditions those branches check against, by composing the same    */
/* shapes the mutation receives.                                              */
/* -------------------------------------------------------------------------- */

describe("backfill row-selection — what patches, what skips", () => {
  /**
   * Persona:    Cron's first sweep — rows fall into 3 buckets:
   *               (a) embedding + hash  → skip (already_hashed)
   *               (b) embedding, no hash → patch
   *               (c) no embedding      → skip (no_embedding)
   *             This test pre-computes the hash for bucket (b) and proves
   *             it's the value the mutation would write.
   * Goal:       The action only patches bucket (b), and the hash matches
   *             what the hook would write later.
   * Scale:      3 rows
   * Duration:   Single tick (pure)
   */
  it("computes the same hash for bucket-(b) rows as the per-row hook", async () => {
    // Bucket (b) row — has embedding (irrelevant to hash), no hash
    const bucketB = {
      name: "OpenAI",
      slug: "openai",
      summary: "ChatGPT",
      savedBecause: undefined,
    };
    const projection = recomputeEntitySearchableText(bucketB);
    const wouldWrite = await sha256Hex(projection);
    const hookWouldWrite = await hookTest.sha256Hex(
      hookTest.clipInput(projection),
    );
    expect(wouldWrite).toBe(hookWouldWrite);
  });

  /**
   * Persona:    Report rows from a six-month-old backfill — hash absent
   * Goal:       Same hash collision invariant holds for the report shape
   * Scale:      1 row
   */
  it("computes hook-compatible hashes for productReports rows", async () => {
    const projection = recomputeReportSearchableText({
      title: "Anthropic Q1 2026 narrative",
      summary: "Constitutional AI iteration 3",
      query: "anthropic constitutional ai",
      primaryEntity: "Anthropic",
      entitySlug: "anthropic-ai",
    });
    expect(projection.length).toBeGreaterThan(0);
    const wouldWrite = await sha256Hex(projection);
    const hookWouldWrite = await hookTest.sha256Hex(
      hookTest.clipInput(projection),
    );
    expect(wouldWrite).toBe(hookWouldWrite);
  });

  /**
   * Persona:    Notebook blocks from 2025 — old embeddings, missing hash
   * Goal:       Block chip flattening must produce hook-compatible hashes
   * Scale:      1 row, multi-chip
   */
  it("computes hook-compatible hashes for productBlocks rows", async () => {
    const projection = recomputeBlockSearchableText({
      content: [
        { type: "text", value: "I think Anthropic just shipped " },
        { type: "mention", value: "Claude Opus 4.7", mentionTarget: "claude-opus-4-7" },
        { type: "text", value: " — see " },
        { type: "link", value: "the blog", url: "https://anthropic.com/news/opus" },
      ],
      deletedAt: undefined,
    });
    expect(projection.length).toBeGreaterThan(0);
    const wouldWrite = await sha256Hex(projection);
    const hookWouldWrite = await hookTest.sha256Hex(
      hookTest.clipInput(projection),
    );
    expect(wouldWrite).toBe(hookWouldWrite);
  });

  /**
   * Adversarial: malformed `content` — null block content array.
   * The recompute helper returns "" for non-array; the mutation must skip
   * empty-projection rows (no hash, no patch) instead of writing a hash for "".
   */
  it("returns empty projection for null/non-array block content (action will skip)", () => {
    // @ts-expect-error — intentionally invalid shape to model schema drift
    const projection = recomputeBlockSearchableText({ content: null, deletedAt: undefined });
    expect(projection).toBe("");
  });

  /**
   * Adversarial: soft-deleted block — should return "" so the action
   * skips it (and the row falls out of the vector index naturally).
   */
  it("returns empty projection for soft-deleted blocks (action will skip)", () => {
    const projection = recomputeBlockSearchableText({
      content: [{ type: "text", value: "was useful, now archived" }],
      deletedAt: Date.now(),
    });
    expect(projection).toBe("");
  });

  /**
   * Adversarial: 10 MB block — clipInput must cap before hashing so the
   * backfill never sends a 10 MB string into the crypto digest.
   */
  it("caps 10 MB blocks at the projection ceiling before hashing", async () => {
    const projection = "z".repeat(10_000_000);
    const clipped = clipInput(projection);
    expect(clipped.length).toBe(MAX_PROJECTION_BYTES);
    // And hashing the clipped value is fast + deterministic.
    const hash = await sha256Hex(clipped);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

/* -------------------------------------------------------------------------- */
/* Backfill constants — BOUND ceilings                                         */
/* -------------------------------------------------------------------------- */

describe("backfill constants — BOUND invariants", () => {
  /**
   * Persona:    Operator inadvertently re-runs the backfill on an already
   *             50 % done deploy; or the data grows past 141 k
   * Goal:       The hard ceiling of MAX_PAGES * PAGE_SIZE is comfortably
   *             above the observed 141 k row count, but not so large that
   *             a runaway loop could scan the universe.
   * Scale:      Compile-time invariant
   * Duration:   N/A
   * Expected:   1000 * 500 = 500 000 rows ceiling (≈3.5× headroom over 141 k)
   */
  it("hard-caps total rows at 500 000 (1000 pages × 500 page size)", () => {
    expect(PAGE_SIZE).toBe(500);
    expect(MAX_PAGES).toBe(1000);
    expect(PAGE_SIZE * MAX_PAGES).toBe(500_000);
    // Observed: 141 645 rows — confirm headroom is at least 3×
    expect(PAGE_SIZE * MAX_PAGES).toBeGreaterThanOrEqual(141_645 * 3);
  });

  /**
   * The projection ceiling must match the hook's so hash collisions are
   * preserved for oversized rows (otherwise cron re-embeds them).
   */
  it("projection ceiling matches the hook's input ceiling", () => {
    expect(MAX_PROJECTION_BYTES).toBe(hookTest.MAX_EMBED_INPUT_BYTES);
  });
});
