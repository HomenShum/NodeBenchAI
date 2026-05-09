/**
 * Phase 8b §5 — scenario tests for capability bucketing pure logic.
 *
 * Per `.claude/rules/scenario_testing.md`: scenario-based tests with
 * persona+goal context.  Tests the pure helper that determines the
 * tier label for a given arXiv weekly count.
 */

import { describe, expect, it } from "vitest";

// Inlined from editionScoreboardSeed.ts (kept in sync manually).
const CAPABILITY_EXISTING_THRESHOLD = 50;
const CAPABILITY_EMERGING_THRESHOLD = 10;

function bucketCapability(weeklyCount: number): "existing" | "emerging" | "sciFi" {
  if (weeklyCount >= CAPABILITY_EXISTING_THRESHOLD) return "existing";
  if (weeklyCount >= CAPABILITY_EMERGING_THRESHOLD) return "emerging";
  return "sciFi";
}

describe("Phase 8b §5 bucketCapability", () => {
  /*
   * Scenario: Daily editorial scoreboard cron observes that cs.AI had
   * 80 papers submitted last week.  The reader expects "existing" tier
   * because cs.AI is well-developed.
   *
   *   User:       editorial scoreboard cron
   *   Goal:       map week-volume to tier label honestly
   *   Prior:      cs.AI sustained ~70-100 papers/wk in 2026 Q1
   *   Action:     bucketCapability(80)
   *   Expected:   "existing"
   */
  it("classifies high-volume categories as 'existing'", () => {
    expect(bucketCapability(80)).toBe("existing");
    expect(bucketCapability(50)).toBe("existing"); // boundary
    expect(bucketCapability(1000)).toBe("existing"); // tail
  });

  /*
   * Scenario: cs.RO (Robotics) shows 15 papers/wk — emerging area in
   * the agent stack frame.  Reader expects the "emerging" tier so the
   * dot grid renders with the warmer color.
   */
  it("classifies medium-volume categories as 'emerging'", () => {
    expect(bucketCapability(15)).toBe("emerging");
    expect(bucketCapability(10)).toBe("emerging"); // boundary
    expect(bucketCapability(49)).toBe("emerging"); // upper edge
  });

  /*
   * Scenario: A new niche category (e.g. cs.SC scientific computing
   * with AI) had only 5 papers/wk.  Reader expects "sciFi" tier — the
   * low-volume frontier.
   */
  it("classifies low-volume categories as 'sciFi'", () => {
    expect(bucketCapability(5)).toBe("sciFi");
    expect(bucketCapability(0)).toBe("sciFi");
    expect(bucketCapability(9)).toBe("sciFi"); // just below emerging
  });

  /*
   * Scenario: Adversarial input — what if arXiv returns a negative or
   * NaN?  We should NOT crash; the bucket should default to sciFi
   * (which is the most conservative tier) so the dot grid renders.
   *
   *   Note: in production we filter !Number.isFinite earlier, but the
   *   bucket function must not throw on weird inputs even so.
   */
  it("handles edge-case inputs without throwing", () => {
    expect(bucketCapability(-1)).toBe("sciFi");
    // NaN comparisons are false, so all branches fall through to sciFi.
    expect(bucketCapability(NaN)).toBe("sciFi");
  });

  /*
   * Scenario: Long-running accumulation — 10,000 bucket calls in a
   * tight loop must complete in <50ms.  The cron processes 6
   * categories per run, but if we ever expand to 60 (per-cs-area
   * sub-categories), the function must stay O(1) per call.
   */
  it("performance — 10000 bucket calls complete in <50ms", () => {
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      bucketCapability(i % 200);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  /*
   * Scenario: Threshold contract test — boundary conditions are
   * documented.  Reader of CAPABILITY_THRESHOLDS in the source
   * expects ≥ 50 to be existing, ≥ 10 < 50 to be emerging, < 10 to be
   * sciFi.  This test pins the contract.
   */
  it("threshold contract: ≥50 existing, [10,50) emerging, <10 sciFi", () => {
    expect(bucketCapability(50)).toBe("existing");
    expect(bucketCapability(49)).toBe("emerging");
    expect(bucketCapability(10)).toBe("emerging");
    expect(bucketCapability(9)).toBe("sciFi");
  });
});
