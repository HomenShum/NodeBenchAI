/**
 * Narrative Signal Metrics Mutations (Phase 7)
 *
 * CRUD operations for narrativeSignalMetrics table.
 * Stores quantitative data products for hypothesis evaluation:
 *   - attention: News/social/search volume (attentionShiftDelta, distractionIndex)
 *   - policy: EO/memo/procurement activity (policyVelocityScore)
 *   - labor: Job postings, layoffs (laborShockScore)
 *   - market: Insider selling, sector rotation (positioningShiftScore)
 *   - sentiment: Public opinion / social mood
 *
 * These metrics feed directly into hypothesis scoring.
 * The Analyst agent generates two narratives from these:
 *   1. "Coordination not evidenced; co-movement consistent with attention cycles."
 *   2. "Co-movement + supportive evidence suggests X; here's what would falsify it."
 *
 * @module domains/narrative/mutations/signalMetrics
 */

import { v } from "convex/values";
import { mutation, internalMutation } from "../../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../../../../_generated/dataModel";
import { signalDomainValidator, sourceTierValidator as sharedSourceTierValidator } from "../validators";

/**
 * FNV-1a 32-bit hash for stable ID generation
 */
function fnv1a32Hex(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const domainValidator = signalDomainValidator;

const sourceTierValidator = sharedSourceTierValidator;

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC MUTATIONS (User-facing, require auth)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record a signal metric measurement.
 */
export const recordMetric = mutation({
  args: {
    threadId: v.optional(v.id("narrativeThreads")),
    hypothesisId: v.optional(v.string()),
    domain: domainValidator,
    metricName: v.string(),
    topic: v.string(),
    value: v.number(),
    unit: v.optional(v.string()),
    windowStartAt: v.number(),
    windowEndAt: v.number(),
    sourceDescription: v.string(),
    sourceUrls: v.array(v.string()),
    sourceTier: sourceTierValidator,
    confidence: v.number(),
    baselineValue: v.optional(v.number()),
    deltaFromBaseline: v.optional(v.number()),
  },
  returns: v.id("narrativeSignalMetrics"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    // If threadId provided, verify ownership
    if (args.threadId) {
      const thread = await ctx.db.get(args.threadId);
      if (!thread) throw new Error("Thread not found");
      if (thread.userId !== userId) throw new Error("Not authorized");
    }

    const now = Date.now();
    const metricId = `nsm_${fnv1a32Hex(args.metricName + args.topic + now)}`;

    return await ctx.db.insert("narrativeSignalMetrics", {
      metricId,
      threadId: args.threadId,
      hypothesisId: args.hypothesisId,
      domain: args.domain,
      metricName: args.metricName,
      topic: args.topic,
      value: args.value,
      unit: args.unit,
      measuredAt: now,
      windowStartAt: args.windowStartAt,
      windowEndAt: args.windowEndAt,
      sourceDescription: args.sourceDescription,
      sourceUrls: args.sourceUrls,
      sourceTier: args.sourceTier,
      confidence: args.confidence,
      baselineValue: args.baselineValue,
      deltaFromBaseline: args.deltaFromBaseline,
      collectedByAgent: "user",
      createdAt: now,
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL MUTATIONS (Agent-facing, no auth required)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Agent-facing: record a signal metric during pipeline execution.
 */
export const recordMetricInternal = internalMutation({
  args: {
    threadId: v.optional(v.id("narrativeThreads")),
    hypothesisId: v.optional(v.string()),
    domain: domainValidator,
    metricName: v.string(),
    topic: v.string(),
    value: v.number(),
    unit: v.optional(v.string()),
    measuredAt: v.optional(v.number()),
    windowStartAt: v.number(),
    windowEndAt: v.number(),
    sourceDescription: v.string(),
    sourceUrls: v.array(v.string()),
    sourceTier: sourceTierValidator,
    confidence: v.number(),
    baselineValue: v.optional(v.number()),
    deltaFromBaseline: v.optional(v.number()),
    collectedByAgent: v.string(),
  },
  returns: v.id("narrativeSignalMetrics"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const metricId = `nsm_${fnv1a32Hex(args.metricName + args.topic + now)}`;

    return await ctx.db.insert("narrativeSignalMetrics", {
      metricId,
      threadId: args.threadId,
      hypothesisId: args.hypothesisId,
      domain: args.domain,
      metricName: args.metricName,
      topic: args.topic,
      value: args.value,
      unit: args.unit,
      measuredAt: args.measuredAt ?? now,
      windowStartAt: args.windowStartAt,
      windowEndAt: args.windowEndAt,
      sourceDescription: args.sourceDescription,
      sourceUrls: args.sourceUrls,
      sourceTier: args.sourceTier,
      confidence: args.confidence,
      baselineValue: args.baselineValue,
      deltaFromBaseline: args.deltaFromBaseline,
      collectedByAgent: args.collectedByAgent,
      createdAt: now,
    });
  },
});

/**
 * Agent-facing: batch record multiple signal metrics at once.
 */
export const batchRecordMetricsInternal = internalMutation({
  args: {
    metrics: v.array(v.object({
      threadId: v.optional(v.id("narrativeThreads")),
      hypothesisId: v.optional(v.string()),
      domain: domainValidator,
      metricName: v.string(),
      topic: v.string(),
      value: v.number(),
      unit: v.optional(v.string()),
      measuredAt: v.optional(v.number()),
      windowStartAt: v.number(),
      windowEndAt: v.number(),
      sourceDescription: v.string(),
      sourceUrls: v.array(v.string()),
      sourceTier: sourceTierValidator,
      confidence: v.number(),
      baselineValue: v.optional(v.number()),
      deltaFromBaseline: v.optional(v.number()),
      collectedByAgent: v.string(),
    })),
  },
  returns: v.array(v.id("narrativeSignalMetrics")),
  handler: async (ctx, args) => {
    const now = Date.now();
    const ids: Id<"narrativeSignalMetrics">[] = [];

    for (const metric of args.metrics) {
      const metricId = `nsm_${fnv1a32Hex(metric.metricName + metric.topic + now + ids.length)}`;
      const id = await ctx.db.insert("narrativeSignalMetrics", {
        metricId,
        threadId: metric.threadId,
        hypothesisId: metric.hypothesisId,
        domain: metric.domain,
        metricName: metric.metricName,
        topic: metric.topic,
        value: metric.value,
        unit: metric.unit,
        measuredAt: metric.measuredAt ?? now,
        windowStartAt: metric.windowStartAt,
        windowEndAt: metric.windowEndAt,
        sourceDescription: metric.sourceDescription,
        sourceUrls: metric.sourceUrls,
        sourceTier: metric.sourceTier,
        confidence: metric.confidence,
        baselineValue: metric.baselineValue,
        deltaFromBaseline: metric.deltaFromBaseline,
        collectedByAgent: metric.collectedByAgent,
        createdAt: now,
      });
      ids.push(id);
    }

    return ids;
  },
});
