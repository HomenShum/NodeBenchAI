/**
 * Narrative Hypotheses Queries (Phase 7)
 *
 * Read operations for narrativeHypotheses table.
 * Supports: listing by thread, getting by ID, filtering by status/risk.
 *
 * @module domains/narrative/queries/hypotheses
 */

import { v } from "convex/values";
import { query, internalQuery } from "../../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Get all hypotheses for a thread
 */
export const getByThread = query({
  args: {
    threadId: v.id("narrativeThreads"),
    status: v.optional(v.union(
      v.literal("active"),
      v.literal("supported"),
      v.literal("weakened"),
      v.literal("inconclusive"),
      v.literal("retired")
    )),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread not found");
    if (!thread.isPublic && thread.userId !== userId) throw new Error("Not authorized");

    let results = await ctx.db
      .query("narrativeHypotheses")
      .withIndex("by_thread", (q) =>
        args.status
          ? q.eq("threadId", args.threadId).eq("status", args.status)
          : q.eq("threadId", args.threadId)
      )
      .collect();

    // Sort by label (H1, H2, H3...)
    results.sort((a, b) => a.label.localeCompare(b.label));
    return results;
  },
});

/**
 * Get a single hypothesis by doc ID
 */
export const getById = query({
  args: {
    hypothesisDocId: v.id("narrativeHypotheses"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const hypothesis = await ctx.db.get(args.hypothesisDocId);
    if (!hypothesis) return null;

    const thread = await ctx.db.get(hypothesis.threadId);
    if (!thread) return null;
    if (!thread.isPublic && thread.userId !== userId) return null;

    return hypothesis;
  },
});

/**
 * Get hypothesis scorecard for a thread (summary view)
 */
export const getThreadScorecard = query({
  args: {
    threadId: v.id("narrativeThreads"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread not found");
    if (!thread.isPublic && thread.userId !== userId) throw new Error("Not authorized");

    const hypotheses = await ctx.db
      .query("narrativeHypotheses")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();

    return {
      threadId: args.threadId,
      threadName: thread.name,
      thesis: thread.thesis,
      counterThesis: thread.counterThesis,
      totalHypotheses: hypotheses.length,
      byStatus: {
        active: hypotheses.filter((h) => h.status === "active").length,
        supported: hypotheses.filter((h) => h.status === "supported").length,
        weakened: hypotheses.filter((h) => h.status === "weakened").length,
        inconclusive: hypotheses.filter((h) => h.status === "inconclusive").length,
        retired: hypotheses.filter((h) => h.status === "retired").length,
      },
      byRisk: {
        grounded: hypotheses.filter((h) => h.speculativeRisk === "grounded").length,
        mixed: hypotheses.filter((h) => h.speculativeRisk === "mixed").length,
        speculative: hypotheses.filter((h) => h.speculativeRisk === "speculative").length,
      },
      hypotheses: hypotheses
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((h) => ({
          _id: h._id,
          label: h.label,
          title: h.title,
          status: h.status,
          confidence: h.confidence,
          speculativeRisk: h.speculativeRisk,
          supportingEvidenceCount: h.supportingEvidenceCount,
          contradictingEvidenceCount: h.contradictingEvidenceCount,
          falsificationCriteria: h.falsificationCriteria,
        })),
    };
  },
});

/**
 * Internal: Get hypotheses for agent pipeline use
 */
export const getByThreadInternal = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
    status: v.optional(v.union(
      v.literal("active"),
      v.literal("supported"),
      v.literal("weakened"),
      v.literal("inconclusive"),
      v.literal("retired")
    )),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("narrativeHypotheses")
      .withIndex("by_thread", (q) =>
        args.status
          ? q.eq("threadId", args.threadId).eq("status", args.status)
          : q.eq("threadId", args.threadId)
      )
      .collect();
  },
});

/**
 * Internal: Get hypothesis by hypothesisId string (for claim linking)
 */
export const getByHypothesisId = internalQuery({
  args: {
    hypothesisId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("narrativeHypotheses")
      .withIndex("by_hypothesis_id", (q) => q.eq("hypothesisId", args.hypothesisId))
      .first();
  },
});
