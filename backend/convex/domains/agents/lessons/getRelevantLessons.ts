/**
 * Get Relevant Lessons — A-PR-B.6 of the Autonomous Continuation System
 *
 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116)
 *
 * Read-side companion of `captureLesson.ts`. Returns the top-K lessons
 * for a thread that are NOT deprecated and (when not pinned) have not
 * outlived their `expiresAfterTurns` budget.
 *
 * Ranking rules (in order of precedence):
 *   1. Pinned lessons first, in capture-time order (newest first).
 *      Pins bypass the K cap — they always inject.
 *   2. Tool-relevant lessons next — when the caller passes
 *      `currentToolName`, lessons whose `toolName` matches are ranked
 *      higher than tool-agnostic lessons.
 *   3. Infrastructure lessons ranked by `count` descending so frequent
 *      failover patterns surface above one-offs.
 *   4. Tie-break by `capturedAt` descending (newer wins).
 *
 * HONEST_STATUS:
 *   - Returns `[]` when no lessons exist (never a fake "all-clear"
 *     placeholder).
 *   - Skips deprecated lessons silently — they remain in the table for
 *     audit, but the agent never sees them.
 *   - Expiry is computed against `currentTurnId` so a stale read with
 *     no turnId hint just returns everything still on file.
 */

import { v } from "convex/values";
import { internalQuery } from "../../../_generated/server";
import type { Doc } from "../../../_generated/dataModel";

/** Default cap on lessons returned per turn. Pinned lessons bypass. */
export const DEFAULT_LESSON_LIMIT = 5;

/** Validator describing the lesson document shape returned to callers. */
const lessonDocValidator = v.object({
  _id: v.id("agentLessons"),
  _creationTime: v.number(),
  threadId: v.string(),
  turnId: v.number(),
  type: v.union(
    v.literal("semantic"),
    v.literal("infrastructure"),
    v.literal("budget"),
    v.literal("spiral"),
  ),
  toolName: v.optional(v.string()),
  mistakePattern: v.optional(v.string()),
  correctPattern: v.optional(v.string()),
  artifactType: v.optional(v.string()),
  fromModel: v.optional(v.string()),
  toModel: v.optional(v.string()),
  failedWith: v.optional(v.union(v.number(), v.string())),
  succeeded: v.optional(v.boolean()),
  count: v.optional(v.number()),
  taskCategory: v.optional(v.string()),
  estimatedTokensRemaining: v.optional(v.number()),
  capturedAt: v.number(),
  expiresAfterTurns: v.optional(v.number()),
  pinned: v.boolean(),
  deprecated: v.boolean(),
  userNote: v.optional(v.string()),
});

/**
 * Score a lesson against the caller's context. Higher score wins.
 * Pinned lessons get a separate fast path and never enter scoring.
 */
function scoreLesson(
  lesson: Doc<"agentLessons">,
  currentToolName: string | undefined,
): number {
  let score = 0;

  // Tool match is the strongest signal — give it 1000 points so it
  // dominates count + recency.
  if (currentToolName && lesson.toolName === currentToolName) {
    score += 1000;
  }

  // Infrastructure lessons rank by frequency. Cap contribution at 100
  // so a single very-frequent pair doesn't drown out tool relevance.
  if (lesson.type === "infrastructure" && typeof lesson.count === "number") {
    score += Math.min(lesson.count * 10, 100);
  }

  // Successful infrastructure failovers matter more than failed ones.
  if (lesson.type === "infrastructure" && lesson.succeeded) {
    score += 5;
  }

  // Recency bonus — every minute of age reduces score by 1, floor 0.
  const ageMinutes = (Date.now() - lesson.capturedAt) / 60_000;
  score -= Math.min(ageMinutes, 60);

  return score;
}

/** True when an unpinned lesson has outlived its expiresAfterTurns budget. */
function isExpired(
  lesson: Doc<"agentLessons">,
  currentTurnId: number | undefined,
): boolean {
  if (lesson.pinned) return false;
  if (lesson.expiresAfterTurns === undefined) return false;
  if (currentTurnId === undefined) return false;
  return currentTurnId - lesson.turnId > lesson.expiresAfterTurns;
}

/**
 * Internal query — returns the top-K relevant lessons for a thread.
 * Caller passes `currentToolName` to bias toward tool-specific
 * lessons, and `currentTurnId` to enforce expiry.
 */
export const getRelevantLessons = internalQuery({
  args: {
    threadId: v.string(),
    /** Tool the agent is about to call. Boosts matching lessons. */
    currentToolName: v.optional(v.string()),
    /** Current turn — used to enforce expiry on unpinned lessons. */
    currentTurnId: v.optional(v.number()),
    /** Cap on returned lessons. Pinned lessons bypass. Default 5. */
    limit: v.optional(v.number()),
  },
  returns: v.array(lessonDocValidator),
  handler: async (ctx, args) => {
    const limit = args.limit ?? DEFAULT_LESSON_LIMIT;

    // Pull every non-deprecated lesson for the thread. With per-thread
    // isolation in v1 and the normal "lessons accumulate slowly" usage
    // pattern, this is well within Convex's per-query read limit.
    const all = await ctx.db
      .query("agentLessons")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();

    const live = all.filter(
      (l) => !l.deprecated && !isExpired(l, args.currentTurnId),
    );

    // Pinned lessons bypass the K cap and the scoring pass entirely.
    const pinned = live
      .filter((l) => l.pinned)
      .sort((a, b) => b.capturedAt - a.capturedAt);

    const unpinned = live
      .filter((l) => !l.pinned)
      .map((l) => ({ lesson: l, score: scoreLesson(l, args.currentToolName) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.lesson.capturedAt - a.lesson.capturedAt;
      })
      .slice(0, limit)
      .map((entry) => entry.lesson);

    return [...pinned, ...unpinned];
  },
});

/**
 * Internal query — returns ALL lessons for a thread for audit / panel
 * views. Includes deprecated and expired ones so the user can see the
 * full history. Sorted newest-first.
 */
export const listAllLessonsForThread = internalQuery({
  args: {
    threadId: v.string(),
  },
  returns: v.array(lessonDocValidator),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("agentLessons")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    return rows.sort((a, b) => b.capturedAt - a.capturedAt);
  },
});
