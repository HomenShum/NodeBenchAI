/**
 * Lessons Public — public-facing thin wrappers for the operator UI.
 *
 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116) — follow-up
 * wiring step.
 *
 * The internal lesson capture / query / pin / deprecate functions live in
 * `captureLesson.ts` and `getRelevantLessons.ts` and are intentionally
 * `internalMutation` / `internalQuery` so the agent runtime is the only
 * caller in v1. The `LessonsPanel` operator UI (A-PR-B.7) needs these
 * surfaces from React, so this module exposes minimal public wrappers
 * that simply delegate to the internal entrypoints.
 *
 * Design rules:
 *   - No business logic here. Wrappers only. Logic stays in the canonical
 *     internal modules so test coverage and audit trails are unaffected.
 *   - Same validators on args + returns to keep contracts identical.
 *   - HONEST_STATUS preserved — wrappers return whatever the internal
 *     function returned, including `null` and empty arrays.
 *
 * Why a separate file rather than promoting the originals:
 *   - The internal functions are referenced via `internal.*` from the
 *     model router and other backend callers. Promoting them to public
 *     would change every existing call site. The wrapper pattern gives
 *     us the public surface without churning the agent runtime.
 */

import { v } from "convex/values";
import { mutation, query } from "../../../_generated/server";
import { internal } from "../../../_generated/api";

/**
 * Public list of every lesson for a thread — feeds the audit `LessonsPanel`.
 * Returns `_id`, `_creationTime`, all lesson fields, sorted newest-first.
 */
export const listAllLessonsForThreadPublic = query({
  args: { threadId: v.string() },
  returns: v.array(
    v.object({
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
    }),
  ),
  handler: async (ctx, args) => {
    return await ctx.runQuery(
      internal.domains.agents.lessons.getRelevantLessons
        .listAllLessonsForThread,
      { threadId: args.threadId },
    );
  },
});

/**
 * Public pin/unpin — used by the LessonsPanel "always remind me" toggle.
 * Pinned lessons bypass the per-turn injection cap and never expire.
 */
export const pinLessonPublic = mutation({
  args: {
    lessonId: v.id("agentLessons"),
    pinned: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(
      internal.domains.agents.lessons.captureLesson.pinLesson,
      { lessonId: args.lessonId, pinned: args.pinned },
    );
    return null;
  },
});

/**
 * Public deprecate — used by the LessonsPanel "no longer relevant" action.
 * Deprecated lessons stay in the audit trail but stop injecting.
 */
export const deprecateLessonPublic = mutation({
  args: { lessonId: v.id("agentLessons") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(
      internal.domains.agents.lessons.captureLesson.deprecateLesson,
      { lessonId: args.lessonId },
    );
    return null;
  },
});
