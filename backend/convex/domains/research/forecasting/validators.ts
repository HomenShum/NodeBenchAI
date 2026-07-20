/**
 * Forecasting OS — Shared Validators
 *
 * Single source of truth for validators used across forecast mutations,
 * queries, and actions. Mirrors the pattern from narrative/validators.ts.
 */

import { v } from "convex/values";

// ─── Forecast Type ──────────────────────────────────────────────────────────

export const forecastTypeValidator = v.union(
  v.literal("binary"),
  v.literal("numeric"),
  v.literal("categorical")
);

export type ForecastType = "binary" | "numeric" | "categorical";

// ─── Forecast Status ────────────────────────────────────────────────────────

export const forecastStatusValidator = v.union(
  v.literal("active"),
  v.literal("resolved"),
  v.literal("cancelled")
);

export type ForecastStatus = "active" | "resolved" | "cancelled";

// ─── Refresh Frequency ──────────────────────────────────────────────────────

export const refreshFrequencyValidator = v.union(
  v.literal("daily"),
  v.literal("weekly"),
  v.literal("on_trigger")
);

export type RefreshFrequency = "daily" | "weekly" | "on_trigger";

// ─── Evidence Source Type ───────────────────────────────────────────────────

export const sourceTypeValidator = v.union(
  v.literal("news"),
  v.literal("filing"),
  v.literal("macro_data"),
  v.literal("poll"),
  v.literal("market_signal"),
  v.literal("manual")
);

export type SourceType = "news" | "filing" | "macro_data" | "poll" | "market_signal" | "manual";

// ─── Evidence Signal Direction ──────────────────────────────────────────────

export const signalDirectionValidator = v.union(
  v.literal("supporting"),
  v.literal("disconfirming"),
  v.literal("neutral")
);

export type SignalDirection = "supporting" | "disconfirming" | "neutral";

// ─── Resolution Outcome ────────────────────────────────────────────────────

export const outcomeValidator = v.union(
  v.literal("yes"),
  v.literal("no"),
  v.literal("ambiguous")
);

export type Outcome = "yes" | "no" | "ambiguous";

// ─── Forecast Tag Categories ────────────────────────────────────────────────

export const FORECAST_TAG_CATEGORIES = [
  "ai_tech",
  "econ",
  "company",
  "geo",
  "wildcard",
] as const;

export type ForecastTagCategory = (typeof FORECAST_TAG_CATEGORIES)[number];

// ─── Confidence Interval ────────────────────────────────────────────────────

export const confidenceIntervalValidator = v.object({
  lower: v.number(),
  upper: v.number(),
});

// ─── Calibration Bin ────────────────────────────────────────────────────────

export const calibrationBinValidator = v.object({
  binLabel: v.string(),
  predictedProb: v.number(),
  observedFreq: v.number(),
  count: v.number(),
});

export interface CalibrationBin {
  binLabel: string;
  predictedProb: number;
  observedFreq: number;
  count: number;
}
