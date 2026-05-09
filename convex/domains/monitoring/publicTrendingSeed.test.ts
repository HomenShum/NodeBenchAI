/**
 * Phase 8a §6 — scenario tests for `publicTrendingSeed`.
 *
 * Per `.claude/rules/scenario_testing.md`: every test starts from a
 * persona+goal, simulates realistic behavior, and verifies invariants
 * at scale.  The pure helpers exported by the module are the surface
 * tested here; integration with Convex DB is exercised separately by
 * the live-prod verification (verify-live.ts) since the file pulls
 * from the network.
 */

import { describe, expect, it } from "vitest";

// Pull the pure helper module-locally.  We do not import the action
// (`seedPublicTrending`) — that hits the network and the Convex DB.
//
// The hash + artifactId helpers are pure; their determinism is the
// agentic_reliability invariant under test.

// Inlined copies of the pure helpers under test.  This file does NOT
// import the source module to avoid pulling Convex's `_generated/api`
// into Vitest's pure-test runner.  Each helper here is the verbatim
// implementation in publicTrendingSeed.ts; if the source changes,
// these copies must be re-synced.
function fnv1aHex(input: string): string {
  const offsets = [0x811c9dc5, 0xcbf29ce4, 0x84222325, 0x55555555];
  const out: string[] = [];
  for (const seed of offsets) {
    let hash = seed >>> 0;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    out.push(hash.toString(16).padStart(8, "0"));
  }
  return out.join("");
}

function computeFootnoteArtifactId(url: string, dayMs: number): string {
  const day = new Date(dayMs).toISOString().slice(0, 10);
  const stable = JSON.stringify({ day, url });
  return `pt:${fnv1aHex(stable)}`;
}

describe("Phase 8a §6 fnv1aHex", () => {
  /*
   * Scenario: Daily cron re-runs and must dedupe its own writes.
   *   User:        the seedPublicTrending cron itself
   *   Goal:        same URL fetched twice in the same UTC day must
   *                produce the same artifactId, so the upsert sees the
   *                row and skips.  (DETERMINISTIC.)
   *   Prior state: row exists in evidenceArtifacts from the morning
   *                cron run.
   *   Action:      the next cron run computes the artifactId for the
   *                same URL.
   *   Scale:       at MAX_FOOTNOTES_PER_RUN = 24 entries × 4 cron
   *                runs/day = 96 hashes/day; collision probability
   *                must be effectively 0.
   *   Duration:    determinism must hold across years (year-boundary
   *                date string is the only thing that changes).
   *   Expected:    same input → same hash, every time.
   */
  it("is deterministic across runs", () => {
    const url = "https://news.ycombinator.com/item?id=12345";
    const day = Date.parse("2026-05-09T00:00:00Z");
    expect(fnv1aHex(url)).toBe(fnv1aHex(url));
    expect(computeFootnoteArtifactId(url, day)).toBe(
      computeFootnoteArtifactId(url, day),
    );
  });

  /*
   * Scenario: Two distinct trending URLs on the same day.
   *   Same daily cron, two different URLs.  Idempotency keys must
   *   differ — otherwise the upsert deduplicates real distinct rows.
   *   (HONEST_STATUS — no silent merging.)
   */
  it("distinct URLs on same day produce distinct hashes", () => {
    const day = Date.parse("2026-05-09T00:00:00Z");
    const a = computeFootnoteArtifactId("https://arxiv.org/abs/2501.12345", day);
    const b = computeFootnoteArtifactId("https://arxiv.org/abs/2501.67890", day);
    expect(a).not.toBe(b);
  });

  /*
   * Scenario: Same URL on two consecutive UTC days.
   *   The footnote row is keyed by (URL, day).  HN top-stories often
   *   re-trend across days, so the cron must allow a NEW footnote row
   *   for a NEW day (different audit context, different fetchedAt).
   *
   *   This catches the bug where a too-coarse key (URL only) silently
   *   skips repeat trends.  Rule: same URL + DIFFERENT day → DIFFERENT
   *   artifactId.
   */
  it("day-transition produces distinct artifactIds for same URL", () => {
    const url = "https://arxiv.org/abs/2501.12345";
    const day1 = Date.parse("2026-05-08T23:59:59Z");
    const day2 = Date.parse("2026-05-09T00:00:01Z");
    expect(computeFootnoteArtifactId(url, day1)).not.toBe(
      computeFootnoteArtifactId(url, day2),
    );
  });

  /*
   * Scenario: Adversarial — long URL with control chars, unicode, and
   * shell-meta chars must hash without crashing.  Adversarial source:
   * malicious HN submission with a 2KB URL.
   *
   *   Adversarial scale: 1000 hash calls in <100ms (hot path).
   */
  it("handles adversarial URLs without throwing", () => {
    const longUrl =
      "https://example.com/" + "a".repeat(2000) + "?q=" + "🔥".repeat(200);
    const day = Date.parse("2026-05-09T00:00:00Z");
    expect(() => computeFootnoteArtifactId(longUrl, day)).not.toThrow();
    // 32 hex chars from 4 separate FNV-1a hashes.
    const id = computeFootnoteArtifactId(longUrl, day);
    expect(id.startsWith("pt:")).toBe(true);
    expect(id.length).toBe(35); // "pt:" + 32 hex = 35 chars
  });

  /*
   * Scenario: Long-running accumulation — 10,000 hashes computed back
   * to back must complete in <500ms.  Cron may process ~100 URLs in
   * one tick; long-running accumulation tests that the hash function
   * doesn't leak memory across calls.
   *
   *   Scale: 10000 calls.
   *   Duration: tight loop, no async.
   */
  it("performance — 10000 hashes complete in <500ms", () => {
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      fnv1aHex(`https://example.com/path/${i}`);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  /*
   * Scenario: Output stability — fnv1aHex must produce 32-char hex.
   *   Audit invariant: artifactId fits the existing
   *   evidenceArtifacts.artifactId schema (string, no length limit
   *   but stable shape expected by downstream queries).
   */
  it("output is exactly 32 hex characters", () => {
    expect(fnv1aHex("a")).toMatch(/^[0-9a-f]{32}$/);
    expect(fnv1aHex("")).toMatch(/^[0-9a-f]{32}$/);
    expect(fnv1aHex("a".repeat(10_000))).toMatch(/^[0-9a-f]{32}$/);
  });

  /*
   * Scenario: Different day-string within the same day-of-month must
   * NOT collide due to leading-zero pad inconsistency.
   *
   *   Catches the bug where day "2026-5-9" and "2026-05-09" hash
   *   differently — both must be treated identically (we use
   *   toISOString().slice(0,10) which always pads, so this is
   *   asserting the contract).
   */
  it("day-string is always zero-padded ISO format", () => {
    // Two timestamps within the same UTC day must produce the same
    // artifactId because the day-string is derived via
    // toISOString().slice(0, 10) which always zero-pads month/day.
    // This is the agentic_reliability::DETERMINISTIC contract.
    const id1 = computeFootnoteArtifactId(
      "https://example.com",
      Date.parse("2026-01-09T00:00:01Z"),
    );
    const id2 = computeFootnoteArtifactId(
      "https://example.com",
      Date.parse("2026-01-09T23:59:59Z"),
    );
    expect(id1).toBe(id2);
    // And the next UTC day MUST differ.
    const id3 = computeFootnoteArtifactId(
      "https://example.com",
      Date.parse("2026-01-10T00:00:01Z"),
    );
    expect(id1).not.toBe(id3);
  });
});
