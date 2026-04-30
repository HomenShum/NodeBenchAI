/**
 * Pipeline Eval Queries
 *
 * Aggregate scoring over recent `pipelineRuns`:
 *
 *   - Verdict accuracy: % of runs landing on `verified` vs the rest.
 *     A simple proxy for "did the run produce trustworthy output."
 *   - Brier score: applied to the verify-step's pass-rate vs binary
 *     verdict outcome. Lower is better; <0.15 = good calibration.
 *   - Cost/quality breakdown: $ per verdict tier.
 *
 * Pattern: deterministic aggregation. No LLM calls — pure SQL-style
 * aggregation over the runs table. Cheap to compute, reactive on every
 * new run row.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";

const VERDICT_TO_TARGET: Record<string, number> = {
  verified: 1,
  provisionally_verified: 0.7,
  needs_review: 0.4,
  failed: 0,
};

export const getPipelineEvalScorecard = query({
  args: {
    pipelineKind: v.optional(
      v.union(
        v.literal("code_gen"),
        v.literal("design_gen"),
        v.literal("research"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    samples: v.number(),
    verdictCounts: v.object({
      verified: v.number(),
      provisionally_verified: v.number(),
      needs_review: v.number(),
      failed: v.number(),
      other: v.number(),
    }),
    verdictAccuracy: v.number(),
    brier: v.optional(v.number()),
    avgDurationMs: v.optional(v.number()),
    avgUsd: v.optional(v.number()),
    costByVerdict: v.array(
      v.object({
        verdict: v.string(),
        count: v.number(),
        usd: v.number(),
      }),
    ),
    byKind: v.array(
      v.object({
        pipelineKind: v.string(),
        samples: v.number(),
        verifiedShare: v.number(),
        avgDurationMs: v.optional(v.number()),
        avgUsd: v.optional(v.number()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, 500);
    let q;
    if (args.pipelineKind) {
      q = ctx.db
        .query("pipelineRuns")
        .withIndex("by_kind_createdAt", (q) =>
          q.eq("pipelineKind", args.pipelineKind!),
        )
        .order("desc");
    } else {
      q = ctx.db.query("pipelineRuns").order("desc");
    }
    const rows = await q.take(limit);
    const samples = rows.length;

    const verdictCounts = {
      verified: 0,
      provisionally_verified: 0,
      needs_review: 0,
      failed: 0,
      other: 0,
    };
    let totalDuration = 0;
    let durationSamples = 0;
    let totalUsd = 0;
    let usdSamples = 0;
    let brierSum = 0;
    let brierSamples = 0;
    const costByVerdictMap = new Map<string, { count: number; usd: number }>();
    const byKindMap = new Map<
      string,
      { samples: number; verified: number; durSum: number; durN: number; usdSum: number; usdN: number }
    >();

    for (const r of rows) {
      const v = r.verdict ?? "other";
      if (v === "verified") verdictCounts.verified += 1;
      else if (v === "provisionally_verified") verdictCounts.provisionally_verified += 1;
      else if (v === "needs_review") verdictCounts.needs_review += 1;
      else if (v === "failed") verdictCounts.failed += 1;
      else verdictCounts.other += 1;

      if (typeof r.durationMs === "number") {
        totalDuration += r.durationMs;
        durationSamples += 1;
      }
      if (typeof r.estimatedUsd === "number") {
        totalUsd += r.estimatedUsd;
        usdSamples += 1;
      }

      const cbvKey = v;
      const existing = costByVerdictMap.get(cbvKey) ?? { count: 0, usd: 0 };
      existing.count += 1;
      existing.usd += r.estimatedUsd ?? 0;
      costByVerdictMap.set(cbvKey, existing);

      const kindEntry = byKindMap.get(r.pipelineKind) ?? {
        samples: 0,
        verified: 0,
        durSum: 0,
        durN: 0,
        usdSum: 0,
        usdN: 0,
      };
      kindEntry.samples += 1;
      if (v === "verified") kindEntry.verified += 1;
      if (typeof r.durationMs === "number") {
        kindEntry.durSum += r.durationMs;
        kindEntry.durN += 1;
      }
      if (typeof r.estimatedUsd === "number") {
        kindEntry.usdSum += r.estimatedUsd;
        kindEntry.usdN += 1;
      }
      byKindMap.set(r.pipelineKind, kindEntry);

      // Brier: forecast = VERDICT_TO_TARGET[verdict], outcome = 1 if status==succeeded.
      const forecast = VERDICT_TO_TARGET[v];
      if (typeof forecast === "number") {
        const outcome = r.status === "succeeded" ? 1 : 0;
        brierSum += (forecast - outcome) ** 2;
        brierSamples += 1;
      }
    }

    const verdictAccuracy = samples > 0 ? verdictCounts.verified / samples : 0;
    const brier = brierSamples > 0 ? brierSum / brierSamples : undefined;
    const avgDurationMs = durationSamples > 0 ? totalDuration / durationSamples : undefined;
    const avgUsd = usdSamples > 0 ? totalUsd / usdSamples : undefined;

    const costByVerdict = [...costByVerdictMap.entries()]
      .map(([verdict, { count, usd }]) => ({ verdict, count, usd }))
      .sort((a, b) => b.count - a.count);

    const byKind = [...byKindMap.entries()].map(([pipelineKind, k]) => ({
      pipelineKind,
      samples: k.samples,
      verifiedShare: k.samples > 0 ? k.verified / k.samples : 0,
      avgDurationMs: k.durN > 0 ? k.durSum / k.durN : undefined,
      avgUsd: k.usdN > 0 ? k.usdSum / k.usdN : undefined,
    }));

    return {
      samples,
      verdictCounts,
      verdictAccuracy,
      brier,
      avgDurationMs,
      avgUsd,
      costByVerdict,
      byKind,
    };
  },
});
