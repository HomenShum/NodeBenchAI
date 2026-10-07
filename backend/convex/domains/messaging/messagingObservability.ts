/**
 * Messaging Observability — Delivery traces, cost aggregation, error monitoring
 *
 * Provides structured observability for the multi-channel messaging pipeline:
 * - Delivery traces with correlation IDs (traceId → spans)
 * - Per-channel cost aggregation (reuses smsUsageDaily pattern)
 * - Error rate monitoring (failed deliveryJobs in window, grouped by channel)
 */

import type { ChannelId, DeliveryResult } from "./channelProvider.js";

/* ================================================================== */
/* TRACE TYPES                                                         */
/* ================================================================== */

export interface DeliverySpan {
  spanId: string;
  traceId: string;
  channelId: ChannelId;
  phase: "format" | "enqueue" | "send" | "delivered" | "failed";
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface DeliveryTrace {
  traceId: string;
  channelId: ChannelId;
  recipient: string;
  spans: DeliverySpan[];
  totalDurationMs: number;
  success: boolean;
  costCents: number;
  createdAt: number;
}

/* ================================================================== */
/* COST TRACKING                                                       */
/* ================================================================== */

export interface ChannelCostSummary {
  channelId: ChannelId;
  period: string; // ISO date (YYYY-MM-DD)
  messageCount: number;
  totalCostCents: number;
  avgCostCents: number;
}

/** In-memory cost accumulator (flushed to Convex periodically) */
const costAccumulator = new Map<string, { count: number; totalCents: number }>();

/**
 * Record a delivery cost for aggregation.
 */
export function recordDeliveryCost(channelId: ChannelId, costCents: number): void {
  const period = new Date().toISOString().slice(0, 10);
  const key = `${channelId}:${period}`;

  const entry = costAccumulator.get(key) ?? { count: 0, totalCents: 0 };
  entry.count++;
  entry.totalCents += costCents;
  costAccumulator.set(key, entry);
}

/**
 * Get cost summary for a channel and date range.
 */
export function getCostSummary(channelId?: ChannelId): ChannelCostSummary[] {
  const summaries: ChannelCostSummary[] = [];

  for (const [key, entry] of costAccumulator) {
    const [ch, period] = key.split(":");
    if (channelId && ch !== channelId) continue;

    summaries.push({
      channelId: ch as ChannelId,
      period,
      messageCount: entry.count,
      totalCostCents: Math.round(entry.totalCents * 100) / 100,
      avgCostCents: entry.count > 0
        ? Math.round((entry.totalCents / entry.count) * 100) / 100
        : 0,
    });
  }

  return summaries.sort((a, b) => b.period.localeCompare(a.period));
}

/* ================================================================== */
/* ERROR MONITORING                                                    */
/* ================================================================== */

export interface ChannelErrorRate {
  channelId: ChannelId;
  windowMs: number;
  totalAttempts: number;
  failures: number;
  errorRate: number; // 0-1
  commonErrors: Array<{ error: string; count: number }>;
}

/** In-memory error tracker */
const errorTracker = new Map<string, Array<{ timestamp: number; error?: string; success: boolean }>>();

/**
 * Record a delivery attempt for error rate tracking.
 */
export function recordDeliveryAttempt(result: DeliveryResult): void {
  const key = result.channelId;
  const entries = errorTracker.get(key) ?? [];
  entries.push({
    timestamp: Date.now(),
    error: result.error,
    success: result.success,
  });

  // Keep last 1000 entries per channel
  if (entries.length > 1000) {
    entries.splice(0, entries.length - 1000);
  }

  errorTracker.set(key, entries);
}

/**
 * Get error rate for a channel within a time window.
 */
export function getErrorRate(
  channelId: ChannelId,
  windowMs: number = 3600_000, // 1 hour default
): ChannelErrorRate {
  const cutoff = Date.now() - windowMs;
  const entries = (errorTracker.get(channelId) ?? []).filter((e) => e.timestamp >= cutoff);

  const failures = entries.filter((e) => !e.success);

  // Count common errors
  const errorCounts = new Map<string, number>();
  for (const entry of failures) {
    const err = entry.error ?? "unknown";
    errorCounts.set(err, (errorCounts.get(err) ?? 0) + 1);
  }

  const commonErrors = [...errorCounts.entries()]
    .map(([error, count]) => ({ error, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    channelId,
    windowMs,
    totalAttempts: entries.length,
    failures: failures.length,
    errorRate: entries.length > 0 ? failures.length / entries.length : 0,
    commonErrors,
  };
}

/* ================================================================== */
/* TRACE BUILDER                                                       */
/* ================================================================== */

/**
 * Create a new delivery trace for tracking a message through the pipeline.
 */
export function createTrace(channelId: ChannelId, recipient: string): DeliveryTrace {
  return {
    traceId: `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    channelId,
    recipient,
    spans: [],
    totalDurationMs: 0,
    success: false,
    costCents: 0,
    createdAt: Date.now(),
  };
}

/**
 * Add a span to a trace.
 */
export function addSpan(trace: DeliveryTrace, phase: DeliverySpan["phase"]): DeliverySpan {
  const span: DeliverySpan = {
    spanId: `span-${trace.spans.length}-${Math.random().toString(36).slice(2, 6)}`,
    traceId: trace.traceId,
    channelId: trace.channelId,
    phase,
    startedAt: Date.now(),
  };
  trace.spans.push(span);
  return span;
}

/**
 * Complete a span.
 */
export function completeSpan(span: DeliverySpan, error?: string): void {
  span.endedAt = Date.now();
  span.durationMs = span.endedAt - span.startedAt;
  span.error = error;
}

/**
 * Finalize a trace after delivery.
 */
export function finalizeTrace(trace: DeliveryTrace, result: DeliveryResult): void {
  trace.success = result.success;
  trace.costCents = result.costCents ?? 0;
  trace.totalDurationMs = Date.now() - trace.createdAt;

  // Record for monitoring
  recordDeliveryAttempt(result);
  if (result.costCents) {
    recordDeliveryCost(trace.channelId, result.costCents);
  }
}

/**
 * Reset all in-memory tracking (for testing).
 */
export function _resetForTesting(): void {
  costAccumulator.clear();
  errorTracker.clear();
}
