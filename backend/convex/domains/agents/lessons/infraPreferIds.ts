/**
 * Infra Prefer IDs — B-PR8 of the Autonomous Continuation System
 *
 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116)
 *
 * Reads the `agentLessons` table for `type: "infrastructure"` rows and
 * returns the `toModel` IDs that have proven good in past failovers,
 * sorted by `count` descending so the chain resolver (B-PR3) can use
 * them as `preferIds` to bias future routing decisions toward
 * recovery patterns we have already verified.
 *
 * Why a separate file:
 *   - Keeps the existing `getRelevantLessons.ts` focused on system
 *     prompt injection (which has different ranking rules).
 *   - The model router lives in a `"use node"` file and calls Convex
 *     functions only via `ctx.runQuery`. A small dedicated query is
 *     cheaper than over-fetching all lessons and sorting client-side.
 *
 * HONEST_STATUS:
 *   - Returns `[]` when no thread is supplied OR no infrastructure
 *     lessons exist. Caller falls through to the operator-tuned
 *     `TIER_MODELS` ordering — never a guessed prefer list.
 *   - Skips deprecated entries silently.
 *   - Skips lessons where `succeeded === false`. A failed fallback
 *     pattern is in the audit trail but should not bias future
 *     routing toward the failure.
 */

import { v } from "convex/values";
import { internalQuery } from "../../../_generated/server";

/**
 * Default cap on prefer IDs returned. The chain resolver caps the
 * resolved chain at 6, so 4 prefer slots leaves room for 2 fresh
 * candidates from the registry while still honoring proven patterns.
 */
export const DEFAULT_PREFER_LIMIT = 4;

export const getInfraPreferIdsForThread = internalQuery({
  args: {
    /** Thread to scope the lookup to. */
    threadId: v.string(),
    /** Optional cap on returned IDs. Defaults to 4. */
    limit: v.optional(v.number()),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const limit = Math.max(1, args.limit ?? DEFAULT_PREFER_LIMIT);

    // Pull every infrastructure lesson for the thread. Per-thread
    // isolation in v1 keeps this small (lessons accumulate slowly).
    const rows = await ctx.db
      .query("agentLessons")
      .withIndex("by_thread_type", (q) =>
        q.eq("threadId", args.threadId).eq("type", "infrastructure"),
      )
      .collect();

    const prefer: Array<{ toModel: string; rank: number }> = [];
    const seen = new Set<string>();

    for (const lesson of rows) {
      if (lesson.deprecated) continue;
      if (lesson.succeeded !== true) continue;
      if (!lesson.toModel) continue;
      if (seen.has(lesson.toModel)) continue;
      seen.add(lesson.toModel);
      prefer.push({
        toModel: lesson.toModel,
        // Pinned lessons jump the line. Otherwise rank by observed
        // success count (HONEST_STATUS — no synthetic boost).
        rank:
          (lesson.pinned ? 1_000_000 : 0) + (lesson.count ?? 1),
      });
    }

    prefer.sort((a, b) => b.rank - a.rank);
    return prefer.slice(0, limit).map((p) => p.toModel);
  },
});
