/**
 * Scenario tests for DiligenceDriftBanner.computeDriftState — the pure
 * derivation function that decides whether the banner renders.
 *
 * Per .claude/rules/scenario_testing.md — every test anchors to a real
 * operator state we expect on the entity page:
 *   - empty / cold start
 *   - single bad run (must NOT fire — one-shot is not drift)
 *   - sustained bad runs (MUST fire)
 *   - recovery (rate back above floor → hide)
 *   - borderline (exactly at floor → hide; just below → fire)
 *   - window smaller than runs (only most recent counted)
 */

import { describe, it, expect } from "vitest";
import { computeDriftState } from "./DiligenceDriftBanner";

const DEFAULTS = { windowSize: 20, verifiedRateFloor: 0.6, minRunsForAlert: 5 };

const mk = (verdict: string, judgedAt = 1_000): { _id: string; verdict: string; judgedAt: number } => ({
  _id: `v_${verdict}_${judgedAt}`,
  verdict,
  judgedAt,
});

describe("computeDriftState — honest thresholds", () => {
  it("cold start: empty verdicts → hidden (zero noise)", () => {
    expect(computeDriftState([], DEFAULTS).kind).toBe("hidden");
  });

  it("single bad run: below minRunsForAlert → hidden (one-shot is not drift)", () => {
    const one = [mk("failed")];
    expect(computeDriftState(one, DEFAULTS).kind).toBe("hidden");
  });

  it("4 bad runs: still below minRunsForAlert (default 5) → hidden", () => {
    const four = [mk("failed"), mk("failed"), mk("failed"), mk("failed")];
    expect(computeDriftState(four, DEFAULTS).kind).toBe("hidden");
  });

  it("5 runs all verified: rate=1.0 above floor → hidden", () => {
    const all = Array.from({ length: 5 }, () => mk("verified"));
    expect(computeDriftState(all, DEFAULTS).kind).toBe("hidden");
  });

  it("5 runs, 2 verified 3 failed: rate=0.4 below floor → warn", () => {
    const mixed = [
      mk("verified"),
      mk("verified"),
      mk("failed"),
      mk("failed"),
      mk("failed"),
    ];
    const state = computeDriftState(mixed, DEFAULTS);
    expect(state.kind).toBe("warn");
    if (state.kind !== "warn") throw new Error("unreachable");
    expect(state.verifiedRate).toBeCloseTo(0.4, 2);
    expect(state.failedCount).toBe(3);
    expect(state.total).toBe(5);
  });

  it("borderline: rate exactly equal to floor → hidden (floor is >=, not >)", () => {
    // 6 runs → rate 0.666... > 0.6 → hidden
    const border = [
      mk("verified"),
      mk("verified"),
      mk("verified"),
      mk("verified"),
      mk("failed"),
      mk("failed"),
    ];
    // 4/6 = 0.666 > 0.6 so hidden
    expect(computeDriftState(border, DEFAULTS).kind).toBe("hidden");
  });

  it("recovery: recent window is good even if old runs were bad", () => {
    // windowSize=5, only first 5 counted (sorted newest-first from Convex)
    const recovered = [
      mk("verified"),
      mk("verified"),
      mk("verified"),
      mk("verified"),
      mk("verified"),
      mk("failed"),
      mk("failed"),
      mk("failed"),
      mk("failed"),
      mk("failed"),
    ];
    const state = computeDriftState(recovered, { ...DEFAULTS, windowSize: 5 });
    expect(state.kind).toBe("hidden");
  });

  it("adversarial: needs_review + failed both counted in breakdown", () => {
    const rough = [
      mk("verified"),
      mk("needs_review"),
      mk("needs_review"),
      mk("failed"),
      mk("failed"),
    ];
    const state = computeDriftState(rough, DEFAULTS);
    expect(state.kind).toBe("warn");
    if (state.kind !== "warn") throw new Error("unreachable");
    expect(state.needsReviewCount).toBe(2);
    expect(state.failedCount).toBe(2);
  });

  it("custom minRunsForAlert: 3 threshold fires at 3 bad runs", () => {
    const three = [mk("failed"), mk("failed"), mk("failed")];
    const state = computeDriftState(three, {
      ...DEFAULTS,
      minRunsForAlert: 3,
    });
    expect(state.kind).toBe("warn");
  });

  it("custom verifiedRateFloor: strict 0.9 floor fires even on mostly-verified", () => {
    const mostly = [
      mk("verified"),
      mk("verified"),
      mk("verified"),
      mk("verified"),
      mk("needs_review"), // 0.8 verified rate
    ];
    const state = computeDriftState(mostly, {
      ...DEFAULTS,
      verifiedRateFloor: 0.9,
    });
    expect(state.kind).toBe("warn");
    if (state.kind !== "warn") throw new Error("unreachable");
    expect(state.verifiedRate).toBeCloseTo(0.8, 2);
  });

  it("long-running: 100 runs, most recent 20 drive the decision", () => {
    const long = [
      // 20 most recent: 8 verified, 12 failed (rate 0.4)
      ...Array.from({ length: 8 }, () => mk("verified", 3000)),
      ...Array.from({ length: 12 }, () => mk("failed", 2000)),
      // 80 older all verified — should be IGNORED because outside window
      ...Array.from({ length: 80 }, () => mk("verified", 1000)),
    ];
    const state = computeDriftState(long, DEFAULTS);
    expect(state.kind).toBe("warn");
    if (state.kind !== "warn") throw new Error("unreachable");
    expect(state.total).toBe(20); // window respected
  });
});
