/**
 * Forecasting OS — Schema
 *
 * 5 tables for the prediction engine: forecasts, evidence ledger,
 * resolutions, update history, and calibration log.
 *
 * Scoring uses strictly proper rules (Brier, log score) computed
 * deterministically — no LLM grading.
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

// ─── Forecasts ──────────────────────────────────────────────────────────────

export const forecasts = defineTable({
  userId: v.string(),
  question: v.string(),
  forecastType: v.union(
    v.literal("binary"),
    v.literal("numeric"),
    v.literal("categorical")
  ),

  // Binary
  probability: v.optional(v.number()), // 0-1
  confidenceInterval: v.optional(
    v.object({
      lower: v.number(),
      upper: v.number(),
    })
  ),

  // Numeric (future)
  numericDistribution: v.optional(
    v.object({
      median: v.number(),
      p25: v.number(),
      p75: v.number(),
    })
  ),

  // Categorical (future)
  categoricalProbs: v.optional(
    v.array(
      v.object({
        category: v.string(),
        probability: v.number(),
      })
    )
  ),

  // Context
  baseRate: v.optional(v.number()),
  resolutionDate: v.string(), // ISO YYYY-MM-DD
  resolutionCriteria: v.string(),
  status: v.union(
    v.literal("active"),
    v.literal("resolved"),
    v.literal("cancelled")
  ),

  // Drivers
  topDrivers: v.array(v.string()),
  topCounterarguments: v.array(v.string()),

  // Update policy
  refreshFrequency: v.union(
    v.literal("daily"),
    v.literal("weekly"),
    v.literal("on_trigger")
  ),
  lastRefreshedAt: v.optional(v.number()),
  updateCount: v.number(),

  // Categorization
  tags: v.array(v.string()),

  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_status", ["status"])
  .index("by_resolution_date", ["resolutionDate"])
  .index("by_status_refresh", ["status", "lastRefreshedAt"])
  .searchIndex("search_question", {
    searchField: "question",
    filterFields: ["status", "userId"],
  });

// ─── Evidence Ledger ────────────────────────────────────────────────────────

export const forecastEvidence = defineTable({
  forecastId: v.id("forecasts"),
  userId: v.string(),

  sourceUrl: v.string(),
  sourceTitle: v.string(),
  sourceType: v.union(
    v.literal("news"),
    v.literal("filing"),
    v.literal("macro_data"),
    v.literal("poll"),
    v.literal("market_signal"),
    v.literal("manual")
  ),

  excerpt: v.string(),
  signal: v.union(
    v.literal("supporting"),
    v.literal("disconfirming"),
    v.literal("neutral")
  ),
  impactOnProbability: v.optional(v.number()),

  addedAt: v.number(),
})
  .index("by_forecast", ["forecastId", "addedAt"])
  .index("by_source_url", ["sourceUrl"]);

// ─── Resolutions ────────────────────────────────────────────────────────────

export const forecastResolutions = defineTable({
  forecastId: v.id("forecasts"),
  userId: v.string(),

  outcome: v.union(
    v.literal("yes"),
    v.literal("no"),
    v.literal("ambiguous")
  ),
  numericOutcome: v.optional(v.number()),
  categoricalOutcome: v.optional(v.string()),

  brierScore: v.optional(v.number()),
  logScore: v.optional(v.number()),

  resolutionNotes: v.string(),
  resolutionSourceUrl: v.optional(v.string()),

  resolvedAt: v.number(),
})
  .index("by_forecast", ["forecastId"])
  .index("by_user_resolved", ["userId", "resolvedAt"]);

// ─── Update History ─────────────────────────────────────────────────────────

export const forecastUpdateHistory = defineTable({
  forecastId: v.id("forecasts"),
  userId: v.string(),

  previousProbability: v.number(),
  newProbability: v.number(),
  reasoning: v.string(),
  evidenceIds: v.array(v.id("forecastEvidence")),

  updatedAt: v.number(),
})
  .index("by_forecast_date", ["forecastId", "updatedAt"]);

// ─── Calibration Log ────────────────────────────────────────────────────────

export const forecastCalibrationLog = defineTable({
  userId: v.string(),

  windowStart: v.string(), // ISO date
  windowEnd: v.string(),

  bins: v.array(
    v.object({
      binLabel: v.string(),
      predictedProb: v.number(),
      observedFreq: v.number(),
      count: v.number(),
    })
  ),

  overallBrier: v.number(),
  meanLogScore: v.optional(v.number()),

  forecastCount: v.number(),
  resolvedCount: v.number(),

  createdAt: v.number(),
})
  .index("by_user_date", ["userId", "windowEnd"]);
