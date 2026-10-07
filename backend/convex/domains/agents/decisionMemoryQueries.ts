/**
 * Decision Memory Queries & Mutations
 *
 * Separated from decisionMemory.ts because Convex requires that
 * "use node" files only export actions.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../_generated/server";

// ============================================================================
// Constants — BOUND limits for all queries
// ============================================================================

/** BOUND: Max entries returned for exact fingerprint lookups */
const MAX_PRIOR_DECISIONS = 10;
/** BOUND: Max entries returned for fuzzy (domain+action / entity) queries */
const MAX_RELATED_DECISIONS = 5;

// ============================================================================
// Mutations
// ============================================================================

/**
 * Record a decision fingerprint into the decisionMemory table.
 *
 * Called by recordFromJudgeReview or directly when decisions originate
 * outside the standard judge flow (e.g. manual overrides, evolution cycles).
 */
export const recordDecisionFingerprint = internalMutation({
  args: {
    fingerprint: v.string(),
    entityRef: v.optional(v.string()),
    actionType: v.string(),
    domain: v.string(),
    verdict: v.string(),
    confidence: v.number(),
    reasoning: v.string(),
    rubricVersion: v.optional(v.number()),
    sourceJudgeReviewId: v.optional(v.id("judgeReviews")),
    sourceMissionId: v.optional(v.id("missions")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("decisionMemory", {
      fingerprint: args.fingerprint,
      entityRef: args.entityRef,
      actionType: args.actionType,
      domain: args.domain,
      verdict: args.verdict,
      confidence: args.confidence,
      reasoning: args.reasoning,
      rubricVersion: args.rubricVersion,
      sourceJudgeReviewId: args.sourceJudgeReviewId,
      sourceMissionId: args.sourceMissionId,
      createdAt: Date.now(),
    });
  },
});

// ============================================================================
// Queries
// ============================================================================

/**
 * Look up prior decisions by exact fingerprint match.
 *
 * Returns up to MAX_PRIOR_DECISIONS entries, most recent first.
 * Use this when you have the exact (entityRef, actionType, domain) tuple.
 */
export const queryPriorDecisions = internalQuery({
  args: {
    fingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("decisionMemory")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", args.fingerprint))
      .order("desc")
      .take(MAX_PRIOR_DECISIONS);
    return results;
  },
});

/**
 * Look up related decisions by domain + actionType (fuzzy match).
 *
 * Returns up to MAX_RELATED_DECISIONS entries, most recent first.
 * Use this when you want to find similar-but-not-identical scenarios.
 */
export const queryRelatedDecisions = internalQuery({
  args: {
    domain: v.string(),
    actionType: v.string(),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("decisionMemory")
      .withIndex("by_domain_action", (q) =>
        q.eq("domain", args.domain).eq("actionType", args.actionType),
      )
      .order("desc")
      .take(MAX_RELATED_DECISIONS);
    return results;
  },
});

/**
 * Look up all decisions for a specific entity.
 *
 * Returns up to MAX_RELATED_DECISIONS entries, most recent first.
 * Use this when reviewing an entity's decision history across domains.
 */
export const queryByEntity = internalQuery({
  args: {
    entityRef: v.string(),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("decisionMemory")
      .withIndex("by_entity", (q) => q.eq("entityRef", args.entityRef))
      .order("desc")
      .take(MAX_RELATED_DECISIONS);
    return results;
  },
});

// ============================================================================
// Internal helper queries (used by recordFromJudgeReview action)
// ============================================================================

/** @internal Fetch a single judge review by ID */
export const getJudgeReview = internalQuery({
  args: { judgeReviewId: v.id("judgeReviews") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.judgeReviewId);
  },
});

/** @internal Fetch a single task plan by ID */
export const getTaskPlan = internalQuery({
  args: { taskId: v.id("taskPlans") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.taskId);
  },
});

/** @internal Fetch a single mission by ID */
export const getMission = internalQuery({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.missionId);
  },
});
