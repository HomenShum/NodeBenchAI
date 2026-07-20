/**
 * Pipeline Eval Queries
 *
 * Aggregate observed outcomes over recent `pipelineRuns`:
 *
 *   - Verified share: % of runs whose recorded final verdict is `verified`.
 *     This describes the stored verdict mix; it is not an accuracy measure.
 *   - Cost and duration breakdowns by recorded verdict and pipeline kind.
 *
 * Pattern: deterministic aggregation. No LLM calls — pure SQL-style
 * aggregation over the runs table. Cheap to compute, reactive on every
 * new run row.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import { requirePipelineCallerOwnerKey } from "./pipelineOwnership";

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
    anonymousSessionId: v.optional(v.string()),
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
    verifiedShare: v.number(),
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
    const ownerKey = await requirePipelineCallerOwnerKey(
      ctx,
      args.anonymousSessionId,
    );
    const limit = Math.min(args.limit ?? 100, 500);
    const candidateLimit = args.pipelineKind ? Math.min(limit * 4, 2_000) : limit;
    const candidates = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_owner_createdAt", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .take(candidateLimit);
    const rows = args.pipelineKind
      ? candidates.filter((row) => row.pipelineKind === args.pipelineKind).slice(0, limit)
      : candidates;
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
    }

    const verifiedShare = samples > 0 ? verdictCounts.verified / samples : 0;
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
      verifiedShare,
      avgDurationMs,
      avgUsd,
      costByVerdict,
      byKind,
    };
  },
});
