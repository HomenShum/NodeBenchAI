/**
 * Forecasting OS — Scoring Engine
 *
 * Pure functions for forecast scoring and calibration.
 * No Convex dependencies — can be unit tested standalone.
 *
 * Uses strictly proper scoring rules:
 * - Brier score: (p - outcome)^2, range [0,1], lower = better
 * - Log score: -log(p) if yes, -log(1-p) if no, lower = better
 *
 * References:
 * - Metaculus scoring primer
 * - Good Judgment Project calibration methodology
 */

import type { CalibrationBin } from "./validators";

// ─── Brier Score ────────────────────────────────────────────────────────────

/**
 * Brier score for binary forecasts.
 * (probability - outcome)^2
 *
 * @param probability - Forecast probability [0,1]
 * @param outcome - "yes" (1) or "no" (0)
 * @returns Score in [0,1]. 0 = perfect, 1 = worst possible.
 */
export function brierScore(
  probability: number,
  outcome: "yes" | "no"
): number {
  const o = outcome === "yes" ? 1 : 0;
  return (probability - o) ** 2;
}

// ─── Log Score ──────────────────────────────────────────────────────────────

/**
 * Logarithmic scoring rule for binary forecasts.
 * -log(p) if outcome=yes, -log(1-p) if outcome=no.
 *
 * Clamps probability to [0.001, 0.999] to avoid -Infinity.
 *
 * @param probability - Forecast probability [0,1]
 * @param outcome - "yes" or "no"
 * @returns Score >= 0. Lower = better. 0 = perfect certainty on correct outcome.
 */
export function logScore(
  probability: number,
  outcome: "yes" | "no"
): number {
  const clamped = Math.max(0.001, Math.min(0.999, probability));
  if (outcome === "yes") {
    return -Math.log(clamped);
  }
  return -Math.log(1 - clamped);
}

// ─── Calibration Bins ───────────────────────────────────────────────────────

/**
 * Bin resolved binary forecasts into 10 calibration buckets.
 * Each bucket represents a 10-percentage-point range (0-10%, 10-20%, ..., 90-100%).
 *
 * @param forecasts - Array of {probability, outcome} pairs
 * @returns 10 bins with predicted probability (bin center), observed frequency, and count
 */
export function calibrationBins(
  forecasts: Array<{ probability: number; outcome: "yes" | "no" }>
): CalibrationBin[] {
  const bins: CalibrationBin[] = [];

  for (let i = 0; i < 10; i++) {
    const lower = i * 0.1;
    const upper = (i + 1) * 0.1;
    const binLabel = `${i * 10}-${(i + 1) * 10}%`;
    const predictedProb = (lower + upper) / 2; // bin center

    const inBin = forecasts.filter((f) => {
      if (i === 9) return f.probability >= lower && f.probability <= upper;
      return f.probability >= lower && f.probability < upper;
    });

    const yesCount = inBin.filter((f) => f.outcome === "yes").length;
    const observedFreq = inBin.length > 0 ? yesCount / inBin.length : 0;

    bins.push({
      binLabel,
      predictedProb,
      observedFreq,
      count: inBin.length,
    });
  }

  return bins;
}

// ─── Aggregate Brier ────────────────────────────────────────────────────────

/**
 * Compute average Brier score across a set of resolved forecasts.
 *
 * @param forecasts - Array of {probability, outcome} pairs
 * @returns Average Brier score. Lower = better calibrated.
 */
export function averageBrier(
  forecasts: Array<{ probability: number; outcome: "yes" | "no" }>
): number {
  if (forecasts.length === 0) return 0;
  const total = forecasts.reduce(
    (sum, f) => sum + brierScore(f.probability, f.outcome),
    0
  );
  return total / forecasts.length;
}

/**
 * Compute average log score across a set of resolved forecasts.
 */
export function averageLogScore(
  forecasts: Array<{ probability: number; outcome: "yes" | "no" }>
): number {
  if (forecasts.length === 0) return 0;
  const total = forecasts.reduce(
    (sum, f) => sum + logScore(f.probability, f.outcome),
    0
  );
  return total / forecasts.length;
}

// ─── Isotonic Calibration ───────────────────────────────────────────────────

/**
 * Isotonic regression: adjust raw probability using historical calibration bins.
 * Produces monotonically non-decreasing calibrated probabilities.
 *
 * Uses Pool Adjacent Violators (PAV) algorithm on bin observed frequencies.
 * Falls back to raw probability if insufficient data (< 3 non-empty bins).
 *
 * @param rawProbability - Raw forecast probability [0,1]
 * @param historicalBins - Calibration bins from past resolved forecasts
 * @returns Calibrated probability [0,1]
 */
export function isotonicCalibrate(
  rawProbability: number,
  historicalBins: CalibrationBin[]
): number {
  // Need at least 3 non-empty bins to calibrate
  const nonEmpty = historicalBins.filter((b) => b.count > 0);
  if (nonEmpty.length < 3) return rawProbability;

  // Pool Adjacent Violators on non-empty bins
  const pav = pavAlgorithm(nonEmpty.map((b) => b.observedFreq));
  const pavBins = nonEmpty.map((b, i) => ({
    center: b.predictedProb,
    calibrated: pav[i],
  }));

  // Linear interpolation for the raw probability
  return interpolate(rawProbability, pavBins);
}

/**
 * Pool Adjacent Violators algorithm.
 * Ensures monotonically non-decreasing output.
 */
function pavAlgorithm(values: number[]): number[] {
  const n = values.length;
  const result = [...values];
  const weights = new Array(n).fill(1);

  let i = 0;
  while (i < n - 1) {
    if (result[i] > result[i + 1]) {
      // Pool: weighted average of adjacent violators
      const totalWeight = weights[i] + weights[i + 1];
      const pooled =
        (result[i] * weights[i] + result[i + 1] * weights[i + 1]) /
        totalWeight;
      result[i] = pooled;
      result[i + 1] = pooled;
      weights[i] = totalWeight;
      weights[i + 1] = totalWeight;

      // Check backwards for new violations
      let j = i;
      while (j > 0 && result[j - 1] > result[j]) {
        const tw = weights[j - 1] + weights[j];
        const p =
          (result[j - 1] * weights[j - 1] + result[j] * weights[j]) / tw;
        result[j - 1] = p;
        result[j] = p;
        weights[j - 1] = tw;
        weights[j] = tw;
        j--;
      }
    }
    i++;
  }

  return result;
}

/**
 * Linear interpolation between calibration points.
 */
function interpolate(
  x: number,
  points: Array<{ center: number; calibrated: number }>
): number {
  if (points.length === 0) return x;
  if (x <= points[0].center) return points[0].calibrated;
  if (x >= points[points.length - 1].center)
    return points[points.length - 1].calibrated;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (x >= a.center && x <= b.center) {
      const t = (x - a.center) / (b.center - a.center);
      return a.calibrated + t * (b.calibrated - a.calibrated);
    }
  }

  return x; // shouldn't reach here
}

// ─── Forecast Diff ──────────────────────────────────────────────────────────

/**
 * Format a human-readable forecast diff for LinkedIn/dashboard display.
 *
 * @param prev - Previous probability
 * @param next - New probability
 * @param reasoning - Why the update happened
 * @returns Formatted diff string
 */
export function formatForecastDiff(
  prev: number,
  next: number,
  reasoning: string
): string {
  const prevPct = (prev * 100).toFixed(0);
  const nextPct = (next * 100).toFixed(0);
  const delta = next - prev;
  const direction = delta >= 0 ? "+" : "";
  const deltaPct = (delta * 100).toFixed(0);

  return `${prevPct}% → ${nextPct}% (${direction}${deltaPct}pp): ${reasoning}`;
}
