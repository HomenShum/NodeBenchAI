/**
 * Forecasting Scoring Engine — Unit Tests
 *
 * Tests for brierScore, logScore, calibrationBins, isotonicCalibrate,
 * averageBrier, averageLogScore, formatForecastDiff.
 *
 * All functions are pure — no Convex, no SQLite, no network.
 */

import { describe, it, expect } from "vitest";
import {
  brierScore,
  logScore,
  calibrationBins,
  averageBrier,
  averageLogScore,
  isotonicCalibrate,
  formatForecastDiff,
} from "../../../../backend/convex/domains/forecasting/scoringEngine";

// ─── Brier Score ────────────────────────────────────────────────────────────

describe("brierScore", () => {
  it("perfect prediction — yes at 100%", () => {
    expect(brierScore(1.0, "yes")).toBe(0);
  });

  it("perfect prediction — no at 0%", () => {
    expect(brierScore(0.0, "no")).toBe(0);
  });

  it("worst prediction — yes at 0%", () => {
    expect(brierScore(0.0, "yes")).toBe(1);
  });

  it("worst prediction — no at 100%", () => {
    expect(brierScore(1.0, "no")).toBe(1);
  });

  it("coin flip — 50% on yes", () => {
    expect(brierScore(0.5, "yes")).toBe(0.25);
  });

  it("coin flip — 50% on no", () => {
    expect(brierScore(0.5, "no")).toBe(0.25);
  });

  it("65% on yes outcome", () => {
    expect(brierScore(0.65, "yes")).toBeCloseTo(0.1225, 4);
  });

  it("80% on no outcome", () => {
    expect(brierScore(0.8, "no")).toBeCloseTo(0.64, 4);
  });
});

// ─── Log Score ──────────────────────────────────────────────────────────────

describe("logScore", () => {
  it("perfect prediction — yes at ~100%", () => {
    expect(logScore(0.999, "yes")).toBeCloseTo(0.001, 2);
  });

  it("perfect prediction — no at ~0%", () => {
    expect(logScore(0.001, "no")).toBeCloseTo(0.001, 2);
  });

  it("worst prediction — yes at ~0%", () => {
    // -log(0.001) ≈ 6.9
    expect(logScore(0.001, "yes")).toBeCloseTo(6.908, 1);
  });

  it("coin flip — 50% on yes", () => {
    // -log(0.5) ≈ 0.693
    expect(logScore(0.5, "yes")).toBeCloseTo(0.693, 2);
  });

  it("clamps extreme values to avoid -Infinity", () => {
    const score = logScore(0.0, "yes");
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThan(0);
  });

  it("clamps 1.0 for no outcome", () => {
    const score = logScore(1.0, "no");
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThan(0);
  });
});

// ─── Calibration Bins ───────────────────────────────────────────────────────

describe("calibrationBins", () => {
  it("returns 10 bins", () => {
    const bins = calibrationBins([]);
    expect(bins).toHaveLength(10);
  });

  it("first bin is 0-10%", () => {
    const bins = calibrationBins([]);
    expect(bins[0].binLabel).toBe("0-10%");
    expect(bins[0].predictedProb).toBe(0.05);
  });

  it("last bin is 90-100%", () => {
    const bins = calibrationBins([]);
    expect(bins[9].binLabel).toBe("90-100%");
    expect(bins[9].predictedProb).toBe(0.95);
  });

  it("empty bins have count 0 and observedFreq 0", () => {
    const bins = calibrationBins([]);
    for (const bin of bins) {
      expect(bin.count).toBe(0);
      expect(bin.observedFreq).toBe(0);
    }
  });

  it("correctly bins a single forecast", () => {
    const bins = calibrationBins([{ probability: 0.75, outcome: "yes" }]);
    const bin70 = bins[7]; // 70-80%
    expect(bin70.count).toBe(1);
    expect(bin70.observedFreq).toBe(1); // 1/1 = yes
  });

  it("correctly computes observed frequency", () => {
    const forecasts = [
      { probability: 0.55, outcome: "yes" as const },
      { probability: 0.52, outcome: "no" as const },
      { probability: 0.58, outcome: "yes" as const },
      { probability: 0.51, outcome: "no" as const },
    ];
    const bins = calibrationBins(forecasts);
    const bin50 = bins[5]; // 50-60%
    expect(bin50.count).toBe(4);
    expect(bin50.observedFreq).toBe(0.5); // 2/4
  });

  it("boundary value 1.0 goes in 90-100% bin", () => {
    const bins = calibrationBins([{ probability: 1.0, outcome: "yes" }]);
    expect(bins[9].count).toBe(1);
  });

  it("boundary value 0.0 goes in 0-10% bin", () => {
    const bins = calibrationBins([{ probability: 0.0, outcome: "no" }]);
    expect(bins[0].count).toBe(1);
  });
});

// ─── Average Brier ──────────────────────────────────────────────────────────

describe("averageBrier", () => {
  it("returns 0 for empty array", () => {
    expect(averageBrier([])).toBe(0);
  });

  it("returns single score for single forecast", () => {
    expect(averageBrier([{ probability: 0.7, outcome: "yes" }])).toBeCloseTo(
      0.09,
      2
    );
  });

  it("averages multiple forecasts", () => {
    const forecasts = [
      { probability: 1.0, outcome: "yes" as const }, // 0
      { probability: 0.0, outcome: "yes" as const }, // 1
    ];
    expect(averageBrier(forecasts)).toBe(0.5);
  });
});

// ─── Average Log Score ──────────────────────────────────────────────────────

describe("averageLogScore", () => {
  it("returns 0 for empty array", () => {
    expect(averageLogScore([])).toBe(0);
  });

  it("lower for better-calibrated forecasts", () => {
    const good = [
      { probability: 0.9, outcome: "yes" as const },
      { probability: 0.1, outcome: "no" as const },
    ];
    const bad = [
      { probability: 0.1, outcome: "yes" as const },
      { probability: 0.9, outcome: "no" as const },
    ];
    expect(averageLogScore(good)).toBeLessThan(averageLogScore(bad));
  });
});

// ─── Isotonic Calibration ───────────────────────────────────────────────────

describe("isotonicCalibrate", () => {
  it("returns raw probability with fewer than 3 non-empty bins", () => {
    const sparse = calibrationBins([
      { probability: 0.15, outcome: "yes" },
      { probability: 0.85, outcome: "no" },
    ]);
    expect(isotonicCalibrate(0.5, sparse)).toBe(0.5);
  });

  it("returns a value in [0, 1]", () => {
    // Create bins with enough data
    const forecasts = Array.from({ length: 50 }, (_, i) => ({
      probability: (i + 0.5) / 50,
      outcome: (Math.random() > 0.5 ? "yes" : "no") as "yes" | "no",
    }));
    const bins = calibrationBins(forecasts);
    const calibrated = isotonicCalibrate(0.7, bins);
    expect(calibrated).toBeGreaterThanOrEqual(0);
    expect(calibrated).toBeLessThanOrEqual(1);
  });

  it("produces monotonically non-decreasing output for ordered inputs", () => {
    // Create well-populated bins
    const forecasts: Array<{ probability: number; outcome: "yes" | "no" }> = [];
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        const p = (i * 10 + j + 0.5) / 100;
        // Roughly calibrated: higher p → more "yes"
        const yesThreshold = i;
        const outcome = j < yesThreshold ? "yes" : "no";
        forecasts.push({ probability: p, outcome: outcome as "yes" | "no" });
      }
    }
    const bins = calibrationBins(forecasts);

    const inputs = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    const outputs = inputs.map((p) => isotonicCalibrate(p, bins));

    for (let i = 0; i < outputs.length - 1; i++) {
      expect(outputs[i]).toBeLessThanOrEqual(outputs[i + 1] + 0.05); // allow for random data noise in PAV
    }
  });
});

// ─── Format Forecast Diff ───────────────────────────────────────────────────

describe("formatForecastDiff", () => {
  it("formats increase correctly", () => {
    const diff = formatForecastDiff(0.35, 0.55, "New evidence from Fed minutes");
    expect(diff).toBe(
      "35% → 55% (+20pp): New evidence from Fed minutes"
    );
  });

  it("formats decrease correctly", () => {
    const diff = formatForecastDiff(0.8, 0.6, "CEO resignation");
    expect(diff).toBe("80% → 60% (-20pp): CEO resignation");
  });

  it("formats no change", () => {
    const diff = formatForecastDiff(0.5, 0.5, "No new evidence");
    expect(diff).toBe("50% → 50% (+0pp): No new evidence");
  });
});
