/**
 * Temporal Ingestion Engine
 * High-level actions that orchestrate observation → signal → chain → draft → proof
 *
 * The core mechanism: Ingest unstructured data → Extract temporal signals →
 * Forecast the outcome → Execute the behavior (Zero-Drafting) → Log the Proof Pack
 */

import { v } from "convex/values";
import { internalAction, action } from "../../_generated/server";
import { internal, api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  buildObservationsFromExtraction,
  getSafeAverageStepMs,
} from "./ingestionUtils";
import { classifyForecastGate } from "./forecastGatePolicy";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

export interface IngestionBatch {
  streamKey: string;
  sourceType: "slack" | "github" | "jira" | "web" | "document" | "manual" | "system";
  items: Array<{
    observedAt: number;
    observationType: "numeric" | "categorical" | "event" | "text";
    valueNumber?: number;
    valueText?: string;
    headline?: string;
    summary?: string;
    sourceExcerpt?: string;
    sourceUrl?: string;
    tags?: string[];
  }>;
}

export interface SignalDetectionResult {
  signalType: "momentum" | "regime_shift" | "anomaly" | "causal_hint" | "opportunity_window" | "risk_window";
  confidence: number;
  severity: "low" | "medium" | "high";
  summary: string;
  plainEnglish: string;
  recommendedAction?: string;
  evidenceObservationIds: Id<"timeSeriesObservations">[];
}

/* ================================================================== */
/* STATISTICAL SIGNAL DETECTION (Lane A — deterministic math)          */
/* ================================================================== */

/**
 * Detect anomalies using z-score on numeric time series.
 * Pure math — no LLM involved.
 */
function detectAnomalies(
  values: Array<{ t: number; v: number }>,
  threshold: number = 2.5,
): Array<{ index: number; zScore: number; value: number; timestamp: number }> {
  if (values.length < 5) return [];
  const nums = values.map((x) => x.v);
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const std = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
  if (std === 0) return [];

  return values
    .map((val, i) => ({
      index: i,
      zScore: (val.v - mean) / std,
      value: val.v,
      timestamp: val.t,
    }))
    .filter((x) => Math.abs(x.zScore) >= threshold);
}

/**
 * Detect regime shifts using rolling mean comparison.
 * Splits series into windows and detects when the mean shifts significantly.
 */
function detectRegimeShifts(
  values: Array<{ t: number; v: number }>,
  windowSize: number = 10,
  shiftThreshold: number = 1.5,
): Array<{ breakpoint: number; timestamp: number; beforeMean: number; afterMean: number; magnitude: number }> {
  if (values.length < windowSize * 2) return [];
  const shifts: Array<{ breakpoint: number; timestamp: number; beforeMean: number; afterMean: number; magnitude: number }> = [];

  for (let i = windowSize; i <= values.length - windowSize; i++) {
    const before = values.slice(i - windowSize, i).map((x) => x.v);
    const after = values.slice(i, i + windowSize).map((x) => x.v);
    const beforeMean = before.reduce((a, b) => a + b, 0) / before.length;
    const afterMean = after.reduce((a, b) => a + b, 0) / after.length;
    const beforeStd = Math.sqrt(before.reduce((a, b) => a + (b - beforeMean) ** 2, 0) / before.length);

    if (beforeStd === 0) continue;
    const magnitude = Math.abs(afterMean - beforeMean) / beforeStd;

    if (magnitude >= shiftThreshold) {
      shifts.push({
        breakpoint: i,
        timestamp: values[i].t,
        beforeMean,
        afterMean,
        magnitude,
      });
    }
  }
  return shifts;
}

/**
 * Detect momentum (trend direction and strength) using linear regression.
 */
function detectMomentum(
  values: Array<{ t: number; v: number }>,
): { slope: number; rSquared: number; direction: "accelerating" | "decelerating" | "flat" } | null {
  if (values.length < 3) return null;
  const n = values.length;
  const xs = values.map((_, i) => i);
  const ys = values.map((x) => x.v);
  const xMean = (n - 1) / 2;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;

  let ssXY = 0, ssXX = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssXY += (xs[i] - xMean) * (ys[i] - yMean);
    ssXX += (xs[i] - xMean) ** 2;
    ssTot += (ys[i] - yMean) ** 2;
  }
  if (ssXX === 0) return null;
  const slope = ssXY / ssXX;
  const ssRes = ys.reduce((acc, y, i) => acc + (y - (yMean + slope * (xs[i] - xMean))) ** 2, 0);
  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  const normalizedSlope = slope / (yMean || 1); // relative to mean
  const direction = Math.abs(normalizedSlope) < 0.01 ? "flat" as const
    : normalizedSlope > 0 ? "accelerating" as const
    : "decelerating" as const;

  return { slope, rSquared, direction };
}

/**
 * Simple statistical forecast using exponential smoothing.
 * Placeholder until Chronos/TimesFM microservice is deployed.
 */
export function forecastExponentialSmoothing(
  values: Array<{ t: number; v: number }>,
  horizonSteps: number,
  alpha: number = 0.3,
): Array<{ t: number; predicted: number; lower: number; upper: number }> {
  if (values.length < 2) return [];

  // Compute average time step
  const avgStep = (values[values.length - 1].t - values[0].t) / (values.length - 1);

  // Exponential smoothing
  let level = values[0].v;
  const residuals: number[] = [];
  for (const obs of values) {
    const error = obs.v - level;
    residuals.push(error);
    level = alpha * obs.v + (1 - alpha) * level;
  }

  // Prediction interval from residual std
  const residualStd = Math.sqrt(
    residuals.reduce((a, r) => a + r * r, 0) / residuals.length
  );

  const forecasts: Array<{ t: number; predicted: number; lower: number; upper: number }> = [];
  const lastT = values[values.length - 1].t;
  for (let h = 1; h <= horizonSteps; h++) {
    const widening = Math.sqrt(h); // uncertainty grows with horizon
    forecasts.push({
      t: lastT + avgStep * h,
      predicted: level,
      lower: level - 1.96 * residualStd * widening,
      upper: level + 1.96 * residualStd * widening,
    });
  }
  return forecasts;
}

/* ================================================================== */
/* INGESTION PIPELINE ACTION                                           */
/* ================================================================== */

/**
 * Full ingestion pipeline:
 * 1. Batch insert observations
 * 2. Run statistical signal detection on the stream
 * 3. Return detected signals for downstream processing
 */
export const runIngestionPipeline = action({
  args: {
    streamKey: v.string(),
    sourceType: v.union(
      v.literal("slack"),
      v.literal("github"),
      v.literal("jira"),
      v.literal("web"),
      v.literal("document"),
      v.literal("manual"),
      v.literal("system"),
    ),
    entityKey: v.optional(v.string()),
    observations: v.array(v.object({
      observedAt: v.number(),
      observationType: v.union(
        v.literal("numeric"),
        v.literal("categorical"),
        v.literal("event"),
        v.literal("text"),
      ),
      valueNumber: v.optional(v.number()),
      valueText: v.optional(v.string()),
      headline: v.optional(v.string()),
      summary: v.optional(v.string()),
      sourceExcerpt: v.optional(v.string()),
      sourceUrl: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
    })),
    detectSignals: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ingestionRunId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Step 1: Batch insert observations
    const obsToInsert = args.observations.map((obs) => ({
      streamKey: args.streamKey,
      sourceType: args.sourceType,
      entityKey: args.entityKey,
      ingestionRunId,
      ...obs,
    }));

    const observationIds = await ctx.runMutation(
      internal.domains.temporal.mutations.batchInsertObservations,
      { observations: obsToInsert },
    );

    // Step 2: Signal detection (optional, default true)
    const detectedSignals: SignalDetectionResult[] = [];
    if (args.detectSignals !== false) {
      // Get full numeric time series for this stream
      const numericSeries = await ctx.runQuery(
        api.domains.temporal.queries.getNumericTimeSeries,
        { streamKey: args.streamKey },
      );

      if (numericSeries.length >= 5) {
        // Anomaly detection
        const anomalies = detectAnomalies(numericSeries);
        for (const a of anomalies) {
          detectedSignals.push({
            signalType: "anomaly",
            confidence: Math.min(0.95, Math.abs(a.zScore) / 5),
            severity: Math.abs(a.zScore) > 4 ? "high" : Math.abs(a.zScore) > 3 ? "medium" : "low",
            summary: `Anomaly detected: z-score ${a.zScore.toFixed(2)} at value ${a.value}`,
            plainEnglish: `An unusual value of ${a.value} was observed — this is ${Math.abs(a.zScore).toFixed(1)} standard deviations from the norm.`,
            evidenceObservationIds: observationIds.slice(-5) as Id<"timeSeriesObservations">[],
          });
        }

        // Regime shift detection
        const shifts = detectRegimeShifts(numericSeries);
        for (const s of shifts) {
          detectedSignals.push({
            signalType: "regime_shift",
            confidence: Math.min(0.95, s.magnitude / 4),
            severity: s.magnitude > 3 ? "high" : s.magnitude > 2 ? "medium" : "low",
            summary: `Regime shift: mean changed from ${s.beforeMean.toFixed(2)} to ${s.afterMean.toFixed(2)} (magnitude: ${s.magnitude.toFixed(2)}σ)`,
            plainEnglish: `The pattern fundamentally changed — the average shifted from ${s.beforeMean.toFixed(1)} to ${s.afterMean.toFixed(1)}, which is a ${s.magnitude.toFixed(1)}x standard deviation move.`,
            evidenceObservationIds: observationIds.slice(-5) as Id<"timeSeriesObservations">[],
          });
        }

        // Momentum detection
        const momentum = detectMomentum(numericSeries);
        if (momentum && momentum.rSquared > 0.5 && momentum.direction !== "flat") {
          detectedSignals.push({
            signalType: "momentum",
            confidence: momentum.rSquared,
            severity: momentum.rSquared > 0.8 ? "high" : "medium",
            summary: `${momentum.direction} trend detected (R²=${momentum.rSquared.toFixed(2)}, slope=${momentum.slope.toFixed(4)})`,
            plainEnglish: `There is a clear ${momentum.direction} trend — the data is consistently moving ${momentum.direction === "accelerating" ? "up" : "down"} with ${(momentum.rSquared * 100).toFixed(0)}% consistency.`,
            evidenceObservationIds: observationIds.slice(-5) as Id<"timeSeriesObservations">[],
          });
        }
      }

      // Persist detected signals
      for (const signal of detectedSignals) {
        const signalKey = `${args.streamKey}_${signal.signalType}_${Date.now()}`;
        await ctx.runMutation(api.domains.temporal.mutations.insertSignal, {
          signalKey,
          streamKey: args.streamKey,
          entityKey: args.entityKey,
          signalType: signal.signalType,
          status: "open",
          detectedAt: Date.now(),
          confidence: signal.confidence,
          severity: signal.severity,
          summary: signal.summary,
          plainEnglish: signal.plainEnglish,
          evidenceObservationIds: signal.evidenceObservationIds,
          recommendedAction: signal.recommendedAction,
        });
      }
    }

    return {
      ingestionRunId,
      observationsInserted: observationIds.length,
      signalsDetected: detectedSignals.length,
      signals: detectedSignals.map((s) => ({
        type: s.signalType,
        severity: s.severity,
        confidence: s.confidence,
        plainEnglish: s.plainEnglish,
      })),
    };
  },
});

/**
 * End-to-end Phase 1 bridge:
 * 1. extract line-level evidence from raw text
 * 2. map extracted facts/claims/temporal markers into observations with source refs
 * 3. store observations and derive first signals
 * 4. forecast the stream when enough numeric history exists
 */
export const ingestStructuredSourceText = action({
  args: {
    text: v.string(),
    streamKey: v.string(),
    sourceType: v.union(
      v.literal("slack"),
      v.literal("github"),
      v.literal("jira"),
      v.literal("web"),
      v.literal("document"),
      v.literal("manual"),
      v.literal("system"),
    ),
    entityKey: v.optional(v.string()),
    sourceId: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceLabel: v.optional(v.string()),
    detectSignals: v.optional(v.boolean()),
    forecastHorizonDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const extraction = await ctx.runAction(api.domains.temporal.langExtract.extractFromText, {
      text: args.text,
      sourceType: args.sourceType,
      streamKey: args.streamKey,
      entityKey: args.entityKey,
      ingestResults: false,
      sourceLabel: args.sourceLabel,
    });

    const artifact = await ctx.runMutation(
      internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact,
      {
        sourceType: args.sourceType === "web" ? "url_fetch" : "extracted_text",
        sourceUrl: args.sourceUrl,
        rawContent: args.text,
        title: args.sourceLabel ?? `${args.streamKey} source text`,
        extractedData: {
          kind: "structured_source_text",
          streamKey: args.streamKey,
          entityKey: args.entityKey,
          extractionSummary: {
            entities: extraction.entities.length,
            claims: extraction.claims.length,
            temporalMarkers: extraction.temporalMarkers.length,
            numericFacts: extraction.numericFacts.length,
          },
        },
        fetchedAt: Date.now(),
      },
    );

    const observations = buildObservationsFromExtraction(extraction, {
      sourceType: args.sourceType,
      sourceLabel: args.sourceLabel,
      sourceUrl: args.sourceUrl,
    });

    const enrichedObservations = observations.map((observation) => ({
      ...observation,
      streamKey: args.streamKey,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      sourceUrl: args.sourceUrl,
      entityKey: args.entityKey,
    }));

    const ingestionResult = await ctx.runAction(api.domains.temporal.ingestion.runIngestionPipeline, {
      streamKey: args.streamKey,
      sourceType: args.sourceType,
      entityKey: args.entityKey,
      observations: enrichedObservations,
      detectSignals: args.detectSignals ?? true,
    });

    const deepTraceSync = await ctx.runAction(
      internal.domains.deepTrace.integrations.syncStructuredSourceTextToDeepTrace,
      {
        entityKey: args.entityKey,
        entityName: undefined,
        sourceArtifactId: artifact.id,
        extraction,
        observedAt: Date.now(),
      },
    );

    const numericObservationCount = observations.filter(
      (observation) => observation.observationType === "numeric"
    ).length;

    const forecast =
      numericObservationCount >= 3
        ? await ctx.runAction(api.domains.temporal.ingestion.forecastStream, {
            streamKey: args.streamKey,
            horizonDays: args.forecastHorizonDays ?? 14,
            method: "auto",
          })
        : null;

    return {
      streamKey: args.streamKey,
      sourceType: args.sourceType,
      extractionSummary: {
        entities: extraction.entities.length,
        claims: extraction.claims.length,
        temporalMarkers: extraction.temporalMarkers.length,
        numericFacts: extraction.numericFacts.length,
        totalLines: extraction.sourceMetadata.totalLines,
      },
      observationsPrepared: observations.length,
      numericObservationsPrepared: numericObservationCount,
      ingestionResult,
      sourceArtifactId: artifact.id,
      deepTraceSync,
      forecast,
      sampleSourceRefs: observations
        .flatMap((observation) => observation.sourceRefs ?? [])
        .slice(0, 5),
    };
  },
});

/* ================================================================== */
/* TSFM MICROSERVICE BRIDGE                                            */
/* ================================================================== */

const TSFM_BASE_URL = process.env.TSFM_BASE_URL ?? "http://localhost:8010";

interface TsfmForecastResponse {
  predictions: Array<{
    timestamp_offset?: number;
    predicted: number;
    lower: number;
    upper: number;
  }>;
  model_used: string;
  computation_ms: number;
  request_id?: string;
}

/**
 * Call the TSFM inference microservice (Chronos / TimesFM / statistical).
 * Returns null on failure — caller falls back to local exponential smoothing.
 */
async function callTsfmService(
  values: number[],
  horizon: number,
  model: "auto" | "chronos" | "timesfm" | "statistical" = "chronos",
): Promise<TsfmForecastResponse | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const resp = await fetch(`${TSFM_BASE_URL}/forecast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values, horizon, model, confidence_level: 0.9 }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    return (await resp.json()) as TsfmForecastResponse;
  } catch {
    // Service unavailable — fall back to local math
    return null;
  }
}

/**
 * Forecast a numeric stream using TSFM microservice with local fallback.
 *
 * Priority chain:
 *   1. Chronos-T5 (via tsfm-inference service, port 8010)
 *   2. TimesFM (via tsfm-inference service, port 8010)
 *   3. Local exponential smoothing (deterministic, no external deps)
 */
export const forecastStream = action({
  args: {
    streamKey: v.string(),
    horizonDays: v.number(),
    method: v.optional(v.union(
      v.literal("chronos"),
      v.literal("timesfm"),
      v.literal("exponential_smoothing"),
      v.literal("statistical"),
      v.literal("auto"),
    )),
  },
  handler: async (ctx, { streamKey, horizonDays, method }) => {
    const numericSeries = await ctx.runQuery(
      api.domains.temporal.queries.getNumericTimeSeries,
      { streamKey },
    );

    if (numericSeries.length < 3) {
      const values = numericSeries.map((p) => p.v);
      return {
        error: "Insufficient data",
        message: `Need at least 3 numeric observations, found ${numericSeries.length}`,
        streamKey,
        forecastGate: classifyForecastGate({
          streamKey,
          values,
          modelUsed: "insufficient_data",
        }),
      };
    }

    const avgStepMs = getSafeAverageStepMs(numericSeries);
    const stepsPerDay = 86400000 / avgStepMs;
    const horizonSteps = Math.max(1, Math.round(horizonDays * stepsPerDay));
    const values = numericSeries.map((p) => p.v);
    const lastT = numericSeries[numericSeries.length - 1].t;

    let usedMethod = method ?? "auto";
    let forecasts: Array<{ t: number; predicted: number; lower: number; upper: number }>;

    // Try TSFM microservice for chronos/timesfm/auto
    if (usedMethod === "chronos" || usedMethod === "timesfm" || usedMethod === "auto" || usedMethod === "statistical") {
      const tsfmModel = usedMethod === "auto" ? "auto" : usedMethod === "exponential_smoothing" ? "statistical" : usedMethod;
      const tsfmResult = await callTsfmService(values, horizonSteps, tsfmModel as "auto" | "chronos" | "timesfm" | "statistical");

      if (tsfmResult) {
        usedMethod = tsfmResult.model_used as typeof usedMethod;
        forecasts = tsfmResult.predictions.map((f, i) => ({
          t: lastT + avgStepMs * (f.timestamp_offset ?? i + 1),
          predicted: f.predicted,
          lower: f.lower,
          upper: f.upper,
        }));
      } else {
        // TSFM service unavailable — fall back to local
        usedMethod = "exponential_smoothing";
        forecasts = forecastExponentialSmoothing(numericSeries, horizonSteps);
      }
    } else {
      // Explicit exponential_smoothing requested
      forecasts = forecastExponentialSmoothing(numericSeries, horizonSteps);
    }

    const momentum = detectMomentum(numericSeries);
    const roundedForecasts = forecasts.map((f) => ({
      timestamp: f.t,
      date: new Date(f.t).toISOString().split("T")[0],
      predicted: Math.round(f.predicted * 100) / 100,
      lower: Math.round(f.lower * 100) / 100,
      upper: Math.round(f.upper * 100) / 100,
    }));
    const forecastGate = classifyForecastGate({
      streamKey,
      values,
      modelUsed: usedMethod,
      forecasts: roundedForecasts.map((forecast) => ({
        predicted: forecast.predicted,
        lower: forecast.lower,
        upper: forecast.upper,
      })),
      evidenceRefs: numericSeries
        .map((point) => point.headline)
        .filter((ref): ref is string => typeof ref === "string" && ref.trim().length > 0)
        .slice(0, 5),
    });

    return {
      streamKey,
      method: usedMethod,
      dataPoints: numericSeries.length,
      horizonDays,
      horizonSteps,
      tsfmServiceUrl: TSFM_BASE_URL,
      momentum: momentum ? {
        direction: momentum.direction,
        rSquared: momentum.rSquared,
        slope: momentum.slope,
      } : null,
      forecasts: roundedForecasts,
      forecastGate,
    };
  },
});
