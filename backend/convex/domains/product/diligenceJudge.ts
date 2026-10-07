/**
 * diligenceJudge — Convex persistence + retroactive evaluator for the
 * deterministic boolean-gate judge (server/pipeline/diligenceJudge.ts).
 *
 * Role: Agentic Systems Reliability Engineer — every orchestrator emit is
 *       scored against a fixed set of gates, verdicts persist, operator UI
 *       surfaces them above the raw trace drill-down.
 *
 * Contract:
 *   - The orchestrator records telemetry via diligenceRunTelemetry.recordTelemetry
 *     and then records a verdict via recordVerdict — both are fire-and-forget.
 *   - The inline judge in the writer and the Convex-side replay judge MUST
 *     agree on verdicts (DETERMINISTIC). The inline judge is the source of
 *     truth; this module persists its output. The evaluateRecent action
 *     re-runs the judge over stored telemetry so judge changes can be
 *     rolled out retroactively.
 *
 * Not here: LLM grading (prose quality, citation quality). That belongs in
 *           a separate action that WRAPS this module's output. Keeping LLM
 *           judgment out of this file keeps everything here deterministic.
 *
 * Canonical reference:
 *   docs/architecture/PIPELINE_OPERATIONAL_STANDARD.md
 */

import { v } from "convex/values";
import { internalMutation, query } from "../../_generated/server";
import { internal } from "../../_generated/api";
import {
  getActivePublicEntityShareByToken,
  requireProductIdentity,
  resolveEntityWorkspaceAccess,
} from "./helpers";

const MAX_VERDICTS = 200;
const JUDGE_VERSION = "v1";

const VERDICT_VALIDATOR = v.union(
  v.literal("verified"),
  v.literal("provisionally_verified"),
  v.literal("needs_review"),
  v.literal("failed"),
);

/**
 * Persist a judge verdict. Called by the orchestrator runtime right after
 * recordTelemetry — the telemetryId ties the two together.
 *
 * HONEST_SCORES: score is passed through from the deterministic judge. This
 * mutation validates the shape but never overrides the numbers.
 */
export const recordVerdict = internalMutation({
  args: {
    ownerKey: v.string(),
    entityId: v.id("productEntities"),
    telemetryId: v.id("diligenceRunTelemetry"),
    entitySlug: v.string(),
    blockType: v.string(),
    scratchpadRunId: v.string(),
    verdict: VERDICT_VALIDATOR,
    passCount: v.number(),
    failCount: v.number(),
    skipCount: v.number(),
    score: v.number(),
    latencyBudgetMs: v.number(),
    /** JSON-encoded GateResult[] from server/pipeline/diligenceJudge.ts */
    gatesJson: v.string(),
    judgeVersion: v.optional(v.string()),
    /**
     * When true (default), schedule the non-deterministic LLM semantic
     * judge to score this verdict in the background. Callers can opt out
     * by passing false — useful for:
     *   - back-fill jobs that replay historical verdicts (would spam the
     *     LLM with cold reruns)
     *   - cost-sensitive dev environments where GEMINI_API_KEY isn't set
     *
     * A second safety net lives in the action itself: if the API key is
     * missing, the run persists with status="request_failed" and an
     * errorMessage, so auto-scheduling is never a crash risk (HONEST_STATUS).
     */
    autoScore: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const [entity, telemetry] = await Promise.all([
      ctx.db.get(args.entityId),
      ctx.db.get(args.telemetryId),
    ]);
    if (
      !entity ||
      !telemetry ||
      entity.ownerKey !== args.ownerKey ||
      entity.slug !== args.entitySlug ||
      telemetry.ownerKey !== args.ownerKey ||
      telemetry.entityId !== args.entityId ||
      telemetry.entitySlug !== args.entitySlug ||
      telemetry.blockType !== args.blockType ||
      telemetry.scratchpadRunId !== args.scratchpadRunId
    ) {
      throw new Error("recordVerdict: invalid owner/entity telemetry context");
    }
    // Basic sanity: counts must not exceed total gates (10 canonical).
    if (args.passCount < 0 || args.failCount < 0 || args.skipCount < 0) {
      throw new Error("recordVerdict: negative counts are invalid");
    }
    if (args.score < 0 || args.score > 1) {
      throw new Error(`recordVerdict: score ${args.score} out of [0,1]`);
    }
    const id = await ctx.db.insert("diligenceJudgeVerdicts", {
      ownerKey: args.ownerKey,
      entityId: args.entityId,
      telemetryId: args.telemetryId,
      entitySlug: args.entitySlug,
      blockType: args.blockType,
      scratchpadRunId: args.scratchpadRunId,
      verdict: args.verdict,
      passCount: args.passCount,
      failCount: args.failCount,
      skipCount: args.skipCount,
      score: args.score,
      latencyBudgetMs: args.latencyBudgetMs,
      gatesJson: args.gatesJson,
      judgedAt: Date.now(),
      judgeVersion: args.judgeVersion ?? JUDGE_VERSION,
    });

    // Auto-schedule LLM semantic judge. Non-blocking — the deterministic
    // verdict is the source of truth; LLM scores hang off it as an
    // auxiliary annotation (see docs/architecture/PIPELINE_OPERATIONAL_STANDARD.md §7).
    const autoScore = args.autoScore !== false; // default true
    if (autoScore) {
      try {
        await ctx.scheduler.runAfter(
          0,
          internal.domains.product.diligenceLlmJudgeRuns.scoreVerdictWithLlm,
          { verdictId: id },
        );
      } catch {
        // ERROR_BOUNDARY: a scheduler failure must not break the verdict
        // write path. The deterministic row has already committed.
      }
    }

    return { id };
  },
});

/** Latest verdicts for a specific entity, newest first. BOUND by MAX_VERDICTS. */
export const listForEntity = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entitySlug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (await getActivePublicEntityShareByToken(ctx, args.shareToken)) {
      return [];
    }
    const access = await resolveEntityWorkspaceAccess(ctx, args);
    if (!access) return [];
    const limit = Math.max(1, Math.min(args.limit ?? 50, MAX_VERDICTS));
    const rows = await ctx.db
      .query("diligenceJudgeVerdicts")
      .withIndex("by_owner_entity", (q) =>
        q
          .eq("ownerKey", access.entity.ownerKey)
          .eq("entityId", access.entity._id),
      )
      .order("desc")
      .take(limit);
    return rows;
  },
});

/** Global verdict stream for the operator dashboard. */
export const listRecentVerdicts = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    limit: v.optional(v.number()),
    verdict: v.optional(VERDICT_VALIDATOR),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const limit = Math.max(1, Math.min(args.limit ?? 100, MAX_VERDICTS));
    if (args.verdict) {
      return await ctx.db
        .query("diligenceJudgeVerdicts")
        .withIndex("by_owner_verdict", (q) =>
          q.eq("ownerKey", identity.ownerKey).eq("verdict", args.verdict!),
        )
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("diligenceJudgeVerdicts")
      .withIndex("by_owner_judged", (q) => q.eq("ownerKey", identity.ownerKey))
      .order("desc")
      .take(limit);
  },
});

/**
 * Aggregate verdict rollup for the system health dashboard. Returns counts
 * per verdict tier + average score. HONEST_SCORES — every metric is derived
 * from actual rows.
 */
export const rollupVerdicts = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const limit = Math.max(1, Math.min(args.limit ?? 200, MAX_VERDICTS));
    const rows = await ctx.db
      .query("diligenceJudgeVerdicts")
      .withIndex("by_owner_judged", (q) => q.eq("ownerKey", identity.ownerKey))
      .order("desc")
      .take(limit);
    if (rows.length === 0) {
      return {
        total: 0,
        verified: 0,
        provisionally_verified: 0,
        needs_review: 0,
        failed: 0,
        averageScore: 0,
        verifiedRate: 0,
      };
    }
    const counts = {
      verified: 0,
      provisionally_verified: 0,
      needs_review: 0,
      failed: 0,
    };
    let scoreSum = 0;
    for (const row of rows) {
      if (row.verdict in counts) {
        (counts as Record<string, number>)[row.verdict] += 1;
      }
      scoreSum += row.score;
    }
    return {
      total: rows.length,
      ...counts,
      averageScore: scoreSum / rows.length,
      verifiedRate: counts.verified / rows.length,
    };
  },
});
