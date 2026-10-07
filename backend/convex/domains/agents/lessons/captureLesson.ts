/**
 * Lesson Capture — A-PR-B.6 of the Autonomous Continuation System
 *
 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116)
 *
 * Internal mutations that write structured "lessons" into the
 * `agentLessons` table (schema added in A-PR-A.1). A lesson is a
 * one-sentence pattern the next agent turn should remember in order
 * not to repeat the failure that produced it.
 *
 * Four lesson types are supported by the schema:
 *   - `semantic`         — agent broke an artifact (post-rollback)
 *   - `infrastructure`   — model failover / rate-limit pattern
 *   - `budget`           — request hit a cost cap
 *   - `spiral`           — 3+ same-signature turns with no progress
 *
 * Each capture path is a separate `internalMutation` so callers can
 * pass exactly the fields each lesson type needs without a sloppy
 * "any of these are optional" contract. Writers (rollback action,
 * model router catch block, spiral detector, budget gate) call the
 * appropriate function — they don't share a generic "write a lesson"
 * surface.
 *
 * Bound: callers should treat capture as best-effort. The agentLessons
 * read path (getRelevantLessons.ts) caps injection at K=5 lessons per
 * turn, and lessons never expire by default unless explicitly pinned
 * with `expiresAfterTurns`. Per-thread isolation in v1.
 */

import { v } from "convex/values";
import { internalMutation } from "../../../_generated/server";
import type { Doc } from "../../../_generated/dataModel";

// ════════════════════════════════════════════════════════════════════════
// SHARED VALIDATORS
// ════════════════════════════════════════════════════════════════════════

const lessonIdReturnValidator = v.id("agentLessons");

/**
 * Capture a SEMANTIC lesson — what the agent did wrong and what it
 * should do instead. Called by `rollbackToCheckpoint` (A-PR-A.3) when
 * the user issues `/rollback` after the agent broke an artifact.
 */
export const captureSemanticLesson = internalMutation({
  args: {
    threadId: v.string(),
    turnId: v.number(),
    /** Tool that produced the failure, e.g. `patch_notebook`. */
    toolName: v.string(),
    /** What the agent did wrong. Surfaced verbatim in injection. */
    mistakePattern: v.string(),
    /** What it should do next time. Surfaced verbatim in injection. */
    correctPattern: v.string(),
    /** Artifact category that was affected. */
    artifactType: v.string(),
    /** Optional sentence the user typed in the post-rollback toast. */
    userNote: v.optional(v.string()),
    /** Pin to bypass injection cap and skip expiry. Defaults false. */
    pinned: v.optional(v.boolean()),
    /** Auto-deprecate after N more turns of inactivity. */
    expiresAfterTurns: v.optional(v.number()),
  },
  returns: lessonIdReturnValidator,
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("agentLessons", {
      threadId: args.threadId,
      turnId: args.turnId,
      type: "semantic",
      toolName: args.toolName,
      mistakePattern: args.mistakePattern,
      correctPattern: args.correctPattern,
      artifactType: args.artifactType,
      userNote: args.userNote,
      capturedAt: Date.now(),
      expiresAfterTurns: args.expiresAfterTurns,
      pinned: args.pinned ?? false,
      deprecated: false,
    });
    return id;
  },
});

/**
 * Capture an INFRASTRUCTURE lesson — model failover pattern. Called
 * by the model router (B-PR4 follow-up) after a successful failover
 * so the next routing decision can prefer the proven-good fallback.
 *
 * The schema's `count` field accumulates: when an existing lesson
 * with the same (threadId, fromModel, toModel) tuple already exists,
 * we increment its count rather than insert a duplicate. This keeps
 * the audit clean and lets the read path rank by frequency.
 */
export const captureInfrastructureLesson = internalMutation({
  args: {
    threadId: v.string(),
    turnId: v.number(),
    /** Model that failed (origin of the chain). */
    fromModel: v.string(),
    /** Model that succeeded as fallback. */
    toModel: v.string(),
    /** HTTP status / error symbol that triggered the switch. */
    failedWith: v.union(v.number(), v.string()),
    /** Whether the fallback ultimately succeeded. */
    succeeded: v.boolean(),
  },
  returns: lessonIdReturnValidator,
  handler: async (ctx, args) => {
    // Look for an existing lesson with the same fromModel/toModel pair
    // in this thread so we can fold the count instead of inserting a
    // duplicate. Read path uses `count` for ranking.
    const existing = await ctx.db
      .query("agentLessons")
      .withIndex("by_thread_type", (q) =>
        q.eq("threadId", args.threadId).eq("type", "infrastructure"),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("fromModel"), args.fromModel),
          q.eq(q.field("toModel"), args.toModel),
        ),
      )
      .first();

    if (existing) {
      const nextCount = (existing.count ?? 1) + 1;
      await ctx.db.patch(existing._id, {
        count: nextCount,
        succeeded: args.succeeded,
        failedWith: args.failedWith,
        turnId: args.turnId,
        capturedAt: Date.now(),
        deprecated: false,
      });
      return existing._id;
    }

    return await ctx.db.insert("agentLessons", {
      threadId: args.threadId,
      turnId: args.turnId,
      type: "infrastructure",
      fromModel: args.fromModel,
      toModel: args.toModel,
      failedWith: args.failedWith,
      succeeded: args.succeeded,
      count: 1,
      capturedAt: Date.now(),
      pinned: false,
      deprecated: false,
    });
  },
});

/**
 * Capture a BUDGET lesson — what task category hit the cost cap with
 * what tokens-remaining estimate. Called by the budget gate (B-PR6)
 * when a request is rejected. Future planning can use this to size
 * downstream calls more conservatively.
 */
export const captureBudgetLesson = internalMutation({
  args: {
    threadId: v.string(),
    turnId: v.number(),
    /** Task category that hit the cap. */
    taskCategory: v.string(),
    /** Estimated tokens remaining when the cap fired. */
    estimatedTokensRemaining: v.number(),
  },
  returns: lessonIdReturnValidator,
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentLessons", {
      threadId: args.threadId,
      turnId: args.turnId,
      type: "budget",
      taskCategory: args.taskCategory,
      estimatedTokensRemaining: args.estimatedTokensRemaining,
      capturedAt: Date.now(),
      pinned: false,
      deprecated: false,
    });
  },
});

/**
 * Capture a SPIRAL lesson — 3+ same-signature turns with no progress.
 * Called by the spiral detector (A-PR-B.7) when it identifies a loop
 * the agent cannot break out of without an external nudge. The
 * `mistakePattern` here describes the loop itself, e.g. "repeatedly
 * calling tool_X with the same args; output unchanged".
 */
export const captureSpiralLesson = internalMutation({
  args: {
    threadId: v.string(),
    turnId: v.number(),
    /** Tool whose calls form the loop. */
    toolName: v.string(),
    /** Description of the loop pattern. Injected verbatim. */
    mistakePattern: v.string(),
    /** What to do instead. Injected verbatim. */
    correctPattern: v.string(),
  },
  returns: lessonIdReturnValidator,
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentLessons", {
      threadId: args.threadId,
      turnId: args.turnId,
      type: "spiral",
      toolName: args.toolName,
      mistakePattern: args.mistakePattern,
      correctPattern: args.correctPattern,
      capturedAt: Date.now(),
      pinned: false,
      deprecated: false,
    });
  },
});

/**
 * Mark a lesson as deprecated so the read path stops injecting it.
 * Used by the LessonsPanel UI (A-PR-B.7) for "this is no longer
 * relevant" dismissals. We never hard-delete lessons in v1 so the
 * audit trail is preserved.
 */
export const deprecateLesson = internalMutation({
  args: {
    lessonId: v.id("agentLessons"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.lessonId, { deprecated: true });
    return null;
  },
});

/**
 * Pin a lesson so it bypasses the per-turn injection cap and never
 * expires. Used by the LessonsPanel UI for "always remind me" actions.
 */
export const pinLesson = internalMutation({
  args: {
    lessonId: v.id("agentLessons"),
    pinned: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.lessonId, { pinned: args.pinned });
    return null;
  },
});

/** Re-export of the lesson document type so callers don't need to dig
 * through `_generated/dataModel.d.ts`. */
export type AgentLesson = Doc<"agentLessons">;
