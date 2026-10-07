/**
 * Forecasting OS — Manager
 *
 * Internal CRUD queries and mutations for the forecasting domain.
 * Used by actions, cron handlers, and MCP gateway endpoints.
 */

import { internalMutation, internalQuery, query } from "../../../_generated/server";
import { v } from "convex/values";
import {
  forecastTypeValidator,
  forecastStatusValidator,
  refreshFrequencyValidator,
  sourceTypeValidator,
  signalDirectionValidator,
  outcomeValidator,
  confidenceIntervalValidator,
} from "./validators";
import { brierScore, logScore } from "./scoringEngine";

// ─── Create ─────────────────────────────────────────────────────────────────

export const createForecast = internalMutation({
  args: {
    userId: v.string(),
    question: v.string(),
    forecastType: forecastTypeValidator,
    probability: v.optional(v.number()),
    confidenceInterval: v.optional(confidenceIntervalValidator),
    baseRate: v.optional(v.number()),
    resolutionDate: v.string(),
    resolutionCriteria: v.string(),
    refreshFrequency: refreshFrequencyValidator,
    topDrivers: v.optional(v.array(v.string())),
    topCounterarguments: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.id("forecasts"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return ctx.db.insert("forecasts", {
      userId: args.userId,
      question: args.question,
      forecastType: args.forecastType,
      probability: args.probability,
      confidenceInterval: args.confidenceInterval,
      baseRate: args.baseRate,
      resolutionDate: args.resolutionDate,
      resolutionCriteria: args.resolutionCriteria,
      status: "active",
      topDrivers: args.topDrivers ?? [],
      topCounterarguments: args.topCounterarguments ?? [],
      refreshFrequency: args.refreshFrequency,
      lastRefreshedAt: undefined,
      updateCount: 0,
      tags: args.tags ?? [],
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ─── Update Probability ─────────────────────────────────────────────────────

export const updateProbability = internalMutation({
  args: {
    forecastId: v.id("forecasts"),
    probability: v.number(),
    confidenceInterval: v.optional(confidenceIntervalValidator),
    topDrivers: v.optional(v.array(v.string())),
    topCounterarguments: v.optional(v.array(v.string())),
    reasoning: v.string(),
    evidenceIds: v.optional(v.array(v.id("forecastEvidence"))),
  },
  handler: async (ctx, args) => {
    const forecast = await ctx.db.get(args.forecastId);
    if (!forecast) throw new Error(`Forecast ${args.forecastId} not found`);
    if (forecast.status !== "active")
      throw new Error(`Cannot update ${forecast.status} forecast`);

    const now = Date.now();
    const previousProbability = forecast.probability ?? 0.5;

    // Record update history
    await ctx.db.insert("forecastUpdateHistory", {
      forecastId: args.forecastId,
      userId: forecast.userId,
      previousProbability,
      newProbability: args.probability,
      reasoning: args.reasoning,
      evidenceIds: args.evidenceIds ?? [],
      updatedAt: now,
    });

    // Patch forecast
    await ctx.db.patch(args.forecastId, {
      probability: args.probability,
      confidenceInterval: args.confidenceInterval ?? forecast.confidenceInterval,
      topDrivers: args.topDrivers ?? forecast.topDrivers,
      topCounterarguments:
        args.topCounterarguments ?? forecast.topCounterarguments,
      updateCount: forecast.updateCount + 1,
      lastRefreshedAt: now,
      updatedAt: now,
    });
  },
});

// ─── Add Evidence ───────────────────────────────────────────────────────────

export const addEvidence = internalMutation({
  args: {
    forecastId: v.id("forecasts"),
    userId: v.string(),
    sourceUrl: v.string(),
    sourceTitle: v.string(),
    sourceType: sourceTypeValidator,
    excerpt: v.string(),
    signal: signalDirectionValidator,
    impactOnProbability: v.optional(v.number()),
  },
  returns: v.id("forecastEvidence"),
  handler: async (ctx, args) => {
    // Dedup by sourceUrl for same forecast
    const existing = await ctx.db
      .query("forecastEvidence")
      .withIndex("by_source_url", (q) => q.eq("sourceUrl", args.sourceUrl))
      .filter((q) => q.eq(q.field("forecastId"), args.forecastId))
      .first();

    if (existing) {
      throw new Error(
        `Evidence from ${args.sourceUrl} already exists for this forecast`
      );
    }

    return ctx.db.insert("forecastEvidence", {
      forecastId: args.forecastId,
      userId: args.userId,
      sourceUrl: args.sourceUrl,
      sourceTitle: args.sourceTitle,
      sourceType: args.sourceType,
      excerpt: args.excerpt.slice(0, 500), // cap at 500 chars
      signal: args.signal,
      impactOnProbability: args.impactOnProbability,
      addedAt: Date.now(),
    });
  },
});

// ─── Resolve Forecast ───────────────────────────────────────────────────────

export const resolveForecast = internalMutation({
  args: {
    forecastId: v.id("forecasts"),
    outcome: outcomeValidator,
    numericOutcome: v.optional(v.number()),
    categoricalOutcome: v.optional(v.string()),
    resolutionNotes: v.string(),
    resolutionSourceUrl: v.optional(v.string()),
  },
  returns: v.id("forecastResolutions"),
  handler: async (ctx, args) => {
    const forecast = await ctx.db.get(args.forecastId);
    if (!forecast) throw new Error(`Forecast ${args.forecastId} not found`);
    if (forecast.status === "resolved")
      throw new Error("Forecast already resolved");

    const now = Date.now();

    // Compute scores for binary forecasts (skip ambiguous)
    let brier: number | undefined;
    let log: number | undefined;
    if (
      forecast.forecastType === "binary" &&
      forecast.probability != null &&
      args.outcome !== "ambiguous"
    ) {
      brier = brierScore(forecast.probability, args.outcome);
      log = logScore(forecast.probability, args.outcome);
    }

    // Create resolution record
    const resolutionId = await ctx.db.insert("forecastResolutions", {
      forecastId: args.forecastId,
      userId: forecast.userId,
      outcome: args.outcome,
      numericOutcome: args.numericOutcome,
      categoricalOutcome: args.categoricalOutcome,
      brierScore: brier,
      logScore: log,
      resolutionNotes: args.resolutionNotes,
      resolutionSourceUrl: args.resolutionSourceUrl,
      resolvedAt: now,
    });

    // Update forecast status
    await ctx.db.patch(args.forecastId, {
      status: "resolved",
      updatedAt: now,
    });

    return resolutionId;
  },
});

// ─── Queries ────────────────────────────────────────────────────────────────

export const getActiveForecastsForRefresh = internalQuery({
  args: {
    limit: v.optional(v.number()),
    refreshBefore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("forecasts")
      .withIndex("by_status", (q) => q.eq("status", "active"));

    const forecasts = await query.collect();

    // Filter by refresh timing if specified
    let filtered = forecasts;
    if (args.refreshBefore) {
      filtered = forecasts.filter(
        (f) => !f.lastRefreshedAt || f.lastRefreshedAt < args.refreshBefore!
      );
    }

    // Sort by least recently refreshed
    filtered.sort(
      (a, b) => (a.lastRefreshedAt ?? 0) - (b.lastRefreshedAt ?? 0)
    );

    return filtered.slice(0, args.limit ?? 50);
  },
});

export const getForecastsPastResolution = internalQuery({
  args: {
    asOfDate: v.string(), // ISO YYYY-MM-DD
  },
  handler: async (ctx, args) => {
    const forecasts = await ctx.db
      .query("forecasts")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    return forecasts.filter((f) => f.resolutionDate <= args.asOfDate);
  },
});

export const getEvidenceForForecast = internalQuery({
  args: {
    forecastId: v.id("forecasts"),
    signal: v.optional(signalDirectionValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("forecastEvidence")
      .withIndex("by_forecast", (q) => q.eq("forecastId", args.forecastId))
      .order("desc")
      .collect();

    let results = all;
    if (args.signal) {
      results = all.filter((e) => e.signal === args.signal);
    }

    return results.slice(0, args.limit ?? 20);
  },
});

export const getUpdateHistory = internalQuery({
  args: {
    forecastId: v.id("forecasts"),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("forecastUpdateHistory")
      .withIndex("by_forecast_date", (q) =>
        q.eq("forecastId", args.forecastId)
      )
      .order("desc")
      .collect();
  },
});

export const getUserResolutions = internalQuery({
  args: {
    userId: v.string(),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("forecastResolutions")
      .withIndex("by_user_resolved", (q) => q.eq("userId", args.userId))
      .order("desc");

    const all = await query.collect();

    return all.filter((r) => {
      if (args.startDate && r.resolvedAt < args.startDate) return false;
      if (args.endDate && r.resolvedAt > args.endDate) return false;
      return true;
    });
  },
});

export const getTopForecastsForLinkedIn = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 3;

    const forecasts = await ctx.db
      .query("forecasts")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    // Filter: must have at least 1 update (probability set)
    const updated = forecasts.filter(
      (f) => f.updateCount > 0 && f.probability != null
    );

    // Sort by: recent update > resolution date proximity > evidence count
    const now = Date.now();
    updated.sort((a, b) => {
      // Primary: most recently updated
      const aFresh = a.lastRefreshedAt ?? a.createdAt;
      const bFresh = b.lastRefreshedAt ?? b.createdAt;
      const freshDiff = bFresh - aFresh;
      if (Math.abs(freshDiff) > 86_400_000) return freshDiff; // >1 day diff

      // Secondary: closest resolution date
      const aDate = new Date(a.resolutionDate).getTime();
      const bDate = new Date(b.resolutionDate).getTime();
      return aDate - bDate; // earlier resolution = more urgent
    });

    // Enrich with previous probability from most recent update history
    const top = updated.slice(0, limit);
	    const enriched: Array<(typeof top)[number] & { previousProbability?: number }> = [];
	    for (const f of top) {
	      const lastUpdate = await ctx.db
	        .query("forecastUpdateHistory")
	        .withIndex("by_forecast_date", (q) => q.eq("forecastId", f._id))
	        .order("desc")
	        .first();
	      enriched.push({
	        ...f,
	        previousProbability: lastUpdate?.previousProbability,
	      });
	    }
	    return enriched;
	  },
	});

export const storeCalibrationLog = internalMutation({
  args: {
    userId: v.string(),
    windowStart: v.string(),
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
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("forecastCalibrationLog", {
      userId: args.userId,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      bins: args.bins,
      overallBrier: args.overallBrier,
      meanLogScore: args.meanLogScore,
      forecastCount: args.forecastCount,
      resolvedCount: args.resolvedCount,
      createdAt: Date.now(),
    });
  },
});

export const getUserTrackRecord = internalQuery({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const resolutions = await ctx.db
      .query("forecastResolutions")
      .withIndex("by_user_resolved", (q) => q.eq("userId", args.userId))
      .collect();

    // Only score non-ambiguous binary resolutions
    const scored = resolutions.filter(
      (r) => r.brierScore != null && r.outcome !== "ambiguous"
    );

    if (scored.length === 0) {
      return {
        totalResolved: resolutions.length,
        scoredCount: 0,
        overallBrier: null,
        meanLogScore: null,
      };
    }

    const totalBrier = scored.reduce((s, r) => s + (r.brierScore ?? 0), 0);
    const totalLog = scored.reduce((s, r) => s + (r.logScore ?? 0), 0);

    return {
      totalResolved: resolutions.length,
      scoredCount: scored.length,
      overallBrier: totalBrier / scored.length,
      meanLogScore: totalLog / scored.length,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC QUERIES (Dashboard UI)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all active forecasts for the dashboard cockpit.
 * Returns forecasts with their latest probability, delta, and metadata.
 */
export const getActiveForecasts = query({
  args: {},
  handler: async (ctx) => {
    const forecasts = await ctx.db
      .query("forecasts")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

	    const enriched: Array<{
	      _id: (typeof forecasts)[number]["_id"];
	      question: (typeof forecasts)[number]["question"];
	      forecastType: (typeof forecasts)[number]["forecastType"];
	      probability: (typeof forecasts)[number]["probability"];
	      confidenceInterval: (typeof forecasts)[number]["confidenceInterval"];
	      resolutionDate: (typeof forecasts)[number]["resolutionDate"];
	      resolutionCriteria: (typeof forecasts)[number]["resolutionCriteria"];
	      topDrivers: (typeof forecasts)[number]["topDrivers"];
	      topCounterarguments: (typeof forecasts)[number]["topCounterarguments"];
	      tags: (typeof forecasts)[number]["tags"];
	      updateCount: (typeof forecasts)[number]["updateCount"];
	      lastRefreshedAt: (typeof forecasts)[number]["lastRefreshedAt"];
	      previousProbability?: number;
	    }> = [];
	    for (const f of forecasts) {
	      const lastUpdate = await ctx.db
	        .query("forecastUpdateHistory")
	        .withIndex("by_forecast_date", (q) => q.eq("forecastId", f._id))
	        .order("desc")
	        .first();

      enriched.push({
        _id: f._id,
        question: f.question,
        forecastType: f.forecastType,
        probability: f.probability,
        confidenceInterval: f.confidenceInterval,
        resolutionDate: f.resolutionDate,
        resolutionCriteria: f.resolutionCriteria,
        topDrivers: f.topDrivers,
        topCounterarguments: f.topCounterarguments,
        tags: f.tags,
        updateCount: f.updateCount,
        lastRefreshedAt: f.lastRefreshedAt,
        previousProbability: lastUpdate?.previousProbability,
      });
    }
	    return enriched;
	  },
	});

/**
 * Get resolved forecasts with outcomes and Brier scores.
 */
export const getResolvedForecasts = query({
  args: {},
  handler: async (ctx) => {
    const forecasts = await ctx.db
      .query("forecasts")
      .withIndex("by_status", (q) => q.eq("status", "resolved"))
      .collect();

	    const enriched: Array<{
	      _id: (typeof forecasts)[number]["_id"];
	      question: (typeof forecasts)[number]["question"];
	      probability: (typeof forecasts)[number]["probability"];
	      resolutionDate: (typeof forecasts)[number]["resolutionDate"];
	      outcome?: unknown;
	      brierScore?: number;
	      resolvedAt?: number;
	    }> = [];
	    for (const f of forecasts) {
	      const resolution = await ctx.db
	        .query("forecastResolutions")
	        .withIndex("by_forecast", (q) => q.eq("forecastId", f._id))
	        .first();

      enriched.push({
        _id: f._id,
        question: f.question,
        probability: f.probability,
        resolutionDate: f.resolutionDate,
        outcome: resolution?.outcome,
        brierScore: resolution?.brierScore,
        resolvedAt: resolution?.resolvedAt,
      });
    }
    return enriched;
  },
});

/**
 * Get the latest calibration data for the calibration plot.
 */
export const getLatestCalibration = query({
  args: {},
  handler: async (ctx) => {
    const log = await ctx.db
      .query("forecastCalibrationLog")
      .order("desc")
      .first();

    if (!log) return null;

    return {
      bins: log.bins,
      overallBrier: log.overallBrier,
      windowStart: log.windowStart,
      windowEnd: log.windowEnd,
    };
  },
});

/**
 * Get Brier score trend data (one entry per resolution).
 */
export const getBrierTrend = query({
  args: {},
  handler: async (ctx) => {
    const resolutions = await ctx.db
      .query("forecastResolutions")
      .order("asc")
      .collect();

    const scored = resolutions.filter((r) => r.brierScore != null);

    // Rolling average: window of last 10
    const dataPoints: Array<{ label: string; brierScore: number }> = [];
    for (let i = 0; i < scored.length; i++) {
      const window = scored.slice(Math.max(0, i - 9), i + 1);
      const avg = window.reduce((s, r) => s + (r.brierScore ?? 0), 0) / window.length;
      const date = new Date(scored[i].resolvedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      dataPoints.push({ label: date, brierScore: Number(avg.toFixed(4)) });
    }

    return dataPoints;
  },
});

/**
 * Get evidence timeline for a specific forecast.
 */
export const getEvidenceTimelineForDashboard = query({
  args: {
    forecastId: v.id("forecasts"),
  },
  handler: async (ctx, args) => {
    const evidence = await ctx.db
      .query("forecastEvidence")
      .withIndex("by_forecast", (q) => q.eq("forecastId", args.forecastId))
      .order("desc")
      .collect();

    return evidence.map((e) => ({
      date: new Date(e.observedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      title: e.title,
      direction: e.signalDirection as "supporting" | "disconfirming" | "neutral",
      sourceUrl: e.sourceUrl,
      excerpt: e.excerpt,
    }));
  },
});

/**
 * Get dashboard summary stats.
 */
export const getDashboardSummary = query({
  args: {},
  handler: async (ctx) => {
    const active = await ctx.db
      .query("forecasts")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    const resolved = await ctx.db
      .query("forecasts")
      .withIndex("by_status", (q) => q.eq("status", "resolved"))
      .collect();

    const resolutions = await ctx.db
      .query("forecastResolutions")
      .collect();

    const scored = resolutions.filter((r) => r.brierScore != null && r.outcome !== "ambiguous");
    const overallBrier = scored.length > 0
      ? scored.reduce((s, r) => s + (r.brierScore ?? 0), 0) / scored.length
      : null;

    return {
      activeCount: active.length,
      resolvedCount: resolved.length,
      scoredCount: scored.length,
      overallBrier,
    };
  },
});
