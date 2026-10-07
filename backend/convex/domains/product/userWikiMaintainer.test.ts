/**
 * Unit tests for userWikiMaintainer pure helpers.
 *
 * Ctx-based mutations are tested via integration (separate harness). Here
 * we lock the primitives that must be deterministic: idempotency keys,
 * source-snapshot hashes, slug normalization, freshness tiering, material-
 * change detection, debounce-bucket math.
 */

import { describe, it, expect } from "vitest";
import {
  computeIdempotencyKey,
  computeSourceSnapshotHash,
  toSlug,
  freshnessForAge,
  debounceBucketNow,
  countContradictions,
  isMaterialChange,
  REGEN_DEBOUNCE_MS,
  REGEN_MIN_INTERVAL_MS,
  MAX_REGEN_ATTEMPTS,
  REGEN_WALL_BUDGET_MS,
  FRESHNESS_THRESHOLDS,
  type WikiPageType,
  type MaintainerSignal,
} from "./userWikiMaintainer";

// ───────────────────────────────────────────────────────────────────────────
// computeIdempotencyKey
// ───────────────────────────────────────────────────────────────────────────

const baseKeyInput = {
  ownerKey: "user:abc123",
  targetSlug: "stripe",
  targetPageType: "company" as WikiPageType,
  triggerSignal: "report_saved" as MaintainerSignal,
  triggerRef: "report:xyz",
  debounceBucket: 42,
};

describe("computeIdempotencyKey", () => {
  it("is deterministic for the same input", () => {
    const a = computeIdempotencyKey(baseKeyInput);
    const b = computeIdempotencyKey({ ...baseKeyInput });
    expect(a).toBe(b);
  });

  it("differs when any field differs", () => {
    const base = computeIdempotencyKey(baseKeyInput);
    expect(computeIdempotencyKey({ ...baseKeyInput, ownerKey: "other" })).not.toBe(base);
    expect(computeIdempotencyKey({ ...baseKeyInput, targetSlug: "anthropic" })).not.toBe(base);
    expect(computeIdempotencyKey({ ...baseKeyInput, targetPageType: "person" })).not.toBe(base);
    expect(computeIdempotencyKey({ ...baseKeyInput, triggerSignal: "pulse_material_change" })).not.toBe(base);
    expect(computeIdempotencyKey({ ...baseKeyInput, triggerRef: "report:other" })).not.toBe(base);
    expect(computeIdempotencyKey({ ...baseKeyInput, debounceBucket: 43 })).not.toBe(base);
  });

  it("coalesces triggers within the same debounce bucket", () => {
    // Two events for the same page in the same 5-minute bucket → same key
    const a = computeIdempotencyKey({ ...baseKeyInput, triggerRef: "report:x1" });
    const b = computeIdempotencyKey({ ...baseKeyInput, triggerRef: "report:x1" });
    expect(a).toBe(b);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// computeSourceSnapshotHash
// ───────────────────────────────────────────────────────────────────────────

describe("computeSourceSnapshotHash", () => {
  it("is deterministic regardless of list order when inputs are sorted", () => {
    const a = computeSourceSnapshotHash({
      sortedArtifactIds: ["a1", "a2"],
      sortedClaimIds: ["c1", "c2"],
      sortedSourceKeys: ["s1", "s2"],
      sortedFileIds: [],
      modelUsed: "claude-sonnet-4.6",
      promptVersion: "v1",
    });
    // Identical inputs → identical hash
    const b = computeSourceSnapshotHash({
      sortedArtifactIds: ["a1", "a2"],
      sortedClaimIds: ["c1", "c2"],
      sortedSourceKeys: ["s1", "s2"],
      sortedFileIds: [],
      modelUsed: "claude-sonnet-4.6",
      promptVersion: "v1",
    });
    expect(a).toBe(b);
  });

  it("differs when model changes", () => {
    const base = computeSourceSnapshotHash({
      sortedArtifactIds: [],
      sortedClaimIds: [],
      sortedSourceKeys: [],
      sortedFileIds: [],
      modelUsed: "claude-sonnet-4.6",
      promptVersion: "v1",
    });
    const differentModel = computeSourceSnapshotHash({
      sortedArtifactIds: [],
      sortedClaimIds: [],
      sortedSourceKeys: [],
      sortedFileIds: [],
      modelUsed: "gpt-5.4",
      promptVersion: "v1",
    });
    expect(base).not.toBe(differentModel);
  });

  it("differs when prompt version changes", () => {
    const v1 = computeSourceSnapshotHash({
      sortedArtifactIds: ["a"],
      sortedClaimIds: [],
      sortedSourceKeys: [],
      sortedFileIds: [],
      modelUsed: "claude-sonnet-4.6",
      promptVersion: "v1",
    });
    const v2 = computeSourceSnapshotHash({
      sortedArtifactIds: ["a"],
      sortedClaimIds: [],
      sortedSourceKeys: [],
      sortedFileIds: [],
      modelUsed: "claude-sonnet-4.6",
      promptVersion: "v2",
    });
    expect(v1).not.toBe(v2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// toSlug
// ───────────────────────────────────────────────────────────────────────────

describe("toSlug", () => {
  it("lowercases + hyphenates", () => {
    expect(toSlug("Patrick Collison")).toBe("patrick-collison");
    expect(toSlug("Stripe Inc.")).toBe("stripe-inc");
  });

  it("strips leading / trailing hyphens", () => {
    expect(toSlug("  --Stripe--  ")).toBe("stripe");
  });

  it("collapses runs of non-alphanumerics", () => {
    expect(toSlug("A  &  B !!! 2026")).toBe("a-b-2026");
  });

  it("caps length at 96 chars", () => {
    const long = "a".repeat(200);
    expect(toSlug(long).length).toBeLessThanOrEqual(96);
  });

  it("empty input returns empty string", () => {
    expect(toSlug("")).toBe("");
    expect(toSlug("   ")).toBe("");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// freshnessForAge
// ───────────────────────────────────────────────────────────────────────────

describe("freshnessForAge", () => {
  it("< 24h → fresh", () => {
    expect(freshnessForAge(0)).toBe("fresh");
    expect(freshnessForAge(1000 * 60 * 60 * 12)).toBe("fresh");
    expect(freshnessForAge(FRESHNESS_THRESHOLDS.fresh - 1)).toBe("fresh");
  });

  it("24h–7d → recent", () => {
    expect(freshnessForAge(FRESHNESS_THRESHOLDS.fresh)).toBe("recent");
    expect(freshnessForAge(FRESHNESS_THRESHOLDS.recent - 1)).toBe("recent");
  });

  it("7d–30d → stale", () => {
    expect(freshnessForAge(FRESHNESS_THRESHOLDS.recent)).toBe("stale");
    expect(freshnessForAge(FRESHNESS_THRESHOLDS.stale - 1)).toBe("stale");
  });

  it("> 30d → very_stale", () => {
    expect(freshnessForAge(FRESHNESS_THRESHOLDS.stale)).toBe("very_stale");
    expect(freshnessForAge(1000 * 60 * 60 * 24 * 365)).toBe("very_stale");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// debounceBucketNow
// ───────────────────────────────────────────────────────────────────────────

describe("debounceBucketNow", () => {
  it("two timestamps in the same 5-min window share a bucket", () => {
    const t0 = Date.parse("2026-04-22T10:00:00Z");
    const t1 = Date.parse("2026-04-22T10:04:59Z");
    expect(debounceBucketNow(t0)).toBe(debounceBucketNow(t1));
  });

  it("timestamps that cross a 5-min boundary land in different buckets", () => {
    const t0 = Date.parse("2026-04-22T10:04:59Z");
    const t1 = Date.parse("2026-04-22T10:05:00Z");
    expect(debounceBucketNow(t0)).not.toBe(debounceBucketNow(t1));
  });

  it("monotonically increases", () => {
    const t0 = Date.parse("2026-04-22T10:00:00Z");
    const t1 = Date.parse("2026-04-22T11:00:00Z");
    expect(debounceBucketNow(t1)).toBeGreaterThan(debounceBucketNow(t0));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// countContradictions
// ───────────────────────────────────────────────────────────────────────────

describe("countContradictions", () => {
  it("returns 0 on empty input", () => {
    expect(countContradictions([])).toBe(0);
  });

  it("counts only contradicted status entries", () => {
    expect(
      countContradictions([
        { claimId: "a", status: "accepted" },
        { claimId: "b", status: "contradicted" },
        { claimId: "c", status: "pending" },
        { claimId: "d", status: "contradicted" },
      ]),
    ).toBe(2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// isMaterialChange
// ───────────────────────────────────────────────────────────────────────────

describe("isMaterialChange", () => {
  const baseInput = {
    previousRevision: 1,
    newRevision: 2,
    previousSummary: "Stripe is a payment platform.",
    newSummary: "Stripe is a payment platform.",
    previousContradictionCount: 0,
    newContradictionCount: 0,
  };

  it("returns true when contradiction count jumps", () => {
    expect(
      isMaterialChange({ ...baseInput, newContradictionCount: 1 }),
    ).toBe(true);
  });

  it("returns true when summary changes materially", () => {
    expect(
      isMaterialChange({
        ...baseInput,
        newSummary: "Stripe just raised $5B at $200B valuation.",
      }),
    ).toBe(true);
  });

  it("returns false when revisions match (no-op)", () => {
    expect(
      isMaterialChange({ ...baseInput, newRevision: 1 }),
    ).toBe(false);
  });

  it("returns false when summary and contradiction count are stable", () => {
    // Same summary, same contradiction count → not material
    expect(isMaterialChange(baseInput)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Constants sanity
// ───────────────────────────────────────────────────────────────────────────

describe("maintainer constants", () => {
  it("debounce window is 5 minutes", () => {
    expect(REGEN_DEBOUNCE_MS).toBe(5 * 60 * 1000);
  });

  it("min interval between regens is 1 minute", () => {
    expect(REGEN_MIN_INTERVAL_MS).toBe(60 * 1000);
  });

  it("max attempts before dead-letter is 3", () => {
    expect(MAX_REGEN_ATTEMPTS).toBe(3);
  });

  it("wall budget is 60 seconds", () => {
    expect(REGEN_WALL_BUDGET_MS).toBe(60_000);
  });

  it("freshness thresholds monotonically increase", () => {
    expect(FRESHNESS_THRESHOLDS.fresh).toBeLessThan(FRESHNESS_THRESHOLDS.recent);
    expect(FRESHNESS_THRESHOLDS.recent).toBeLessThan(FRESHNESS_THRESHOLDS.stale);
  });
});
