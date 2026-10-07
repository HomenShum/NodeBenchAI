/**
 * Narrative Reply Mutations
 *
 * CRUD operations for narrative thread replies (Phase 7 Social Substrate).
 * Supports evidence additions, questions, corrections, and endorsements.
 *
 * @module domains/narrative/mutations/replies
 */

import { v } from "convex/values";
import { mutation, internalMutation, internalQuery } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import type { Id } from "../../../../_generated/dataModel";
import { fnv1a32Hex } from "../adapters/types";

// ═══════════════════════════════════════════════════════════════════════════
// REPLY CREATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new reply to a post
 */
export const createReply = mutation({
  args: {
    postId: v.id("narrativePosts"),
    parentReplyId: v.optional(v.id("narrativeReplies")),
    replyType: v.union(
      v.literal("evidence"),
      v.literal("question"),
      v.literal("correction"),
      v.literal("support"),
      v.literal("challenge")
    ),
    content: v.string(),
    evidenceArtifactIds: v.optional(v.array(v.id("sourceArtifacts"))),
    citationIds: v.optional(v.array(v.string())),
  },
  returns: v.id("narrativeReplies"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const replyId = `nr_${fnv1a32Hex(args.postId + args.content + Date.now())}`;

    return await ctx.db.insert("narrativeReplies", {
      replyId,
      postId: args.postId,
      parentReplyId: args.parentReplyId,
      replyType: args.replyType,
      content: args.content,
      evidenceArtifactIds: args.evidenceArtifactIds,
      citationIds: args.citationIds,
      sourceType: "internal",
      authorType: "human",
      authorId: identity.subject,
      isHighSignal: false,
      isVerified: false,
      isFlagged: false,
      createdAt: Date.now(),
    });
  },
});

/**
 * Internal mutation for agent-created replies
 */
export const createAgentReply = internalMutation({
  args: {
    postId: v.id("narrativePosts"),
    parentReplyId: v.optional(v.id("narrativeReplies")),
    replyType: v.union(
      v.literal("evidence"),
      v.literal("question"),
      v.literal("correction"),
      v.literal("support"),
      v.literal("challenge")
    ),
    content: v.string(),
    evidenceArtifactIds: v.optional(v.array(v.id("sourceArtifacts"))),
    citationIds: v.optional(v.array(v.string())),
    agentName: v.string(),
    relevanceScore: v.optional(v.number()),
    isHighSignal: v.optional(v.boolean()),
  },
  returns: v.id("narrativeReplies"),
  handler: async (ctx, args) => {
    const replyId = `nr_${fnv1a32Hex(args.postId + args.content + Date.now())}`;

    return await ctx.db.insert("narrativeReplies", {
      replyId,
      postId: args.postId,
      parentReplyId: args.parentReplyId,
      replyType: args.replyType,
      content: args.content,
      evidenceArtifactIds: args.evidenceArtifactIds,
      citationIds: args.citationIds,
      sourceType: "internal",
      authorType: "agent",
      authorId: args.agentName,
      relevanceScore: args.relevanceScore,
      isHighSignal: args.isHighSignal ?? false,
      isVerified: false,
      isFlagged: false,
      createdAt: Date.now(),
    });
  },
});

/**
 * Internal mutation for harvested replies (from HN, Reddit, Twitter)
 */
export const createHarvestedReply = internalMutation({
  args: {
    postId: v.id("narrativePosts"),
    replyType: v.union(
      v.literal("evidence"),
      v.literal("question"),
      v.literal("correction"),
      v.literal("support"),
      v.literal("challenge")
    ),
    content: v.string(),
    evidenceArtifactIds: v.optional(v.array(v.id("sourceArtifacts"))),
    citationIds: v.optional(v.array(v.string())),
    sourceType: v.union(
      v.literal("hackernews"),
      v.literal("reddit"),
      v.literal("twitter"),
      v.literal("other")
    ),
    sourceUrl: v.string(),
    sourceAuthor: v.optional(v.string()),
    sourceTimestamp: v.optional(v.number()),
    sentiment: v.optional(v.union(
      v.literal("positive"),
      v.literal("negative"),
      v.literal("neutral"),
      v.literal("mixed")
    )),
    relevanceScore: v.number(),
    isHighSignal: v.boolean(),
    harvesterAgent: v.string(),
  },
  returns: v.id("narrativeReplies"),
  handler: async (ctx, args) => {
    const replyId = `nr_${fnv1a32Hex(args.sourceUrl + args.content)}`;

    // Check for duplicate (same source URL)
    const existing = await ctx.db
      .query("narrativeReplies")
      .filter((q) => q.eq(q.field("sourceUrl"), args.sourceUrl))
      .first();

    if (existing) {
      const nextEvidence = args.evidenceArtifactIds ?? [];
      const nextCitations = args.citationIds ?? [];
      if (nextEvidence.length > 0 || nextCitations.length > 0) {
        const mergedEvidence = Array.from(
          new Set([...(existing.evidenceArtifactIds ?? []), ...nextEvidence].map((x) => String(x)))
        ) as any;
        const mergedCitations = Array.from(
          new Set([...(existing.citationIds ?? []), ...nextCitations].map((x) => String(x)))
        );
        await ctx.db.patch(existing._id, {
          evidenceArtifactIds: mergedEvidence.length > 0 ? mergedEvidence : existing.evidenceArtifactIds,
          citationIds: mergedCitations.length > 0 ? mergedCitations : existing.citationIds,
        });
      }
      console.log(`[Replies] Skipping duplicate harvested reply from ${args.sourceUrl}`);
      return existing._id;
    }

    return await ctx.db.insert("narrativeReplies", {
      replyId,
      postId: args.postId,
      replyType: args.replyType,
      content: args.content,
      evidenceArtifactIds: args.evidenceArtifactIds,
      citationIds: args.citationIds,
      sourceType: args.sourceType,
      sourceUrl: args.sourceUrl,
      sourceAuthor: args.sourceAuthor,
      sourceTimestamp: args.sourceTimestamp,
      authorType: "harvested",
      authorId: args.harvesterAgent,
      sentiment: args.sentiment,
      relevanceScore: args.relevanceScore,
      isHighSignal: args.isHighSignal,
      isVerified: false,
      isFlagged: false,
      createdAt: Date.now(),
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// REPLY QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get replies for a post
 */
export const getRepliesForPost = internalQuery({
  args: {
    postId: v.id("narrativePosts"),
    limit: v.optional(v.number()),
    onlyHighSignal: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("narrativeReplies")
      .withIndex("by_post", (q) => q.eq("postId", args.postId));

    const replies = await query.collect();

    let filtered = replies;
    if (args.onlyHighSignal) {
      filtered = replies.filter((r) => r.isHighSignal);
    }

    // Sort by creation time, newest first
    filtered.sort((a, b) => b.createdAt - a.createdAt);

    if (args.limit) {
      filtered = filtered.slice(0, args.limit);
    }

    return filtered;
  },
});

/**
 * Get reply thread (nested replies)
 */
export const getReplyThread = internalQuery({
  args: {
    replyId: v.id("narrativeReplies"),
  },
  handler: async (ctx, args) => {
    const parentReply = await ctx.db.get(args.replyId);
    if (!parentReply) return null;

    const childReplies = await ctx.db
      .query("narrativeReplies")
      .withIndex("by_parent", (q) => q.eq("parentReplyId", args.replyId))
      .collect();

    return {
      parent: parentReply,
      children: childReplies.sort((a, b) => a.createdAt - b.createdAt),
    };
  },
});

/**
 * Get high-signal replies across all posts
 */
export const getHighSignalReplies = internalQuery({
  args: {
    limit: v.optional(v.number()),
    sinceTimestamp: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;
    const sinceTimestamp = args.sinceTimestamp || 0;

    const replies = await ctx.db
      .query("narrativeReplies")
      .withIndex("by_high_signal", (q) => q.eq("isHighSignal", true))
      .filter((q) => q.gt(q.field("createdAt"), sinceTimestamp))
      .order("desc")
      .take(limit);

    return replies;
  },
});

/**
 * Get harvested replies by source
 */
export const getHarvestedRepliesBySource = internalQuery({
  args: {
    sourceType: v.union(
      v.literal("hackernews"),
      v.literal("reddit"),
      v.literal("twitter"),
      v.literal("other")
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 100;

    return await ctx.db
      .query("narrativeReplies")
      .withIndex("by_source", (q) => q.eq("sourceType", args.sourceType))
      .order("desc")
      .take(limit);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// REPLY MODERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Flag a reply for review
 */
export const flagReply = internalMutation({
  args: {
    replyId: v.id("narrativeReplies"),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.replyId, {
      isFlagged: true,
      flagReason: args.reason,
    });

    console.log(`[Replies] Flagged reply ${args.replyId}: ${args.reason}`);
    return null;
  },
});

/**
 * Verify a reply
 */
export const verifyReply = internalMutation({
  args: {
    replyId: v.id("narrativeReplies"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.replyId, {
      isVerified: true,
      isFlagged: false,
      flagReason: undefined,
    });

    console.log(`[Replies] Verified reply ${args.replyId}`);
    return null;
  },
});

/**
 * Mark reply as high signal
 */
export const markHighSignal = internalMutation({
  args: {
    replyId: v.id("narrativeReplies"),
    isHighSignal: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.replyId, {
      isHighSignal: args.isHighSignal,
    });

    console.log(
      `[Replies] Marked reply ${args.replyId} as ${args.isHighSignal ? "high" : "normal"} signal`
    );
    return null;
  },
});

/**
 * Delete a reply
 */
export const deleteReply = internalMutation({
  args: {
    replyId: v.id("narrativeReplies"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Delete child replies first
    const children = await ctx.db
      .query("narrativeReplies")
      .withIndex("by_parent", (q) => q.eq("parentReplyId", args.replyId))
      .collect();

    for (const child of children) {
      await ctx.db.delete(child._id);
    }

    await ctx.db.delete(args.replyId);
    console.log(`[Replies] Deleted reply ${args.replyId} and ${children.length} children`);
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// REPLY STATS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get reply statistics for a post
 */
export const getReplyStats = internalQuery({
  args: {
    postId: v.id("narrativePosts"),
  },
  handler: async (ctx, args) => {
    const replies = await ctx.db
      .query("narrativeReplies")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .collect();

    const stats = {
      total: replies.length,
      byType: {
        evidence: 0,
        question: 0,
        correction: 0,
        support: 0,
        challenge: 0,
      },
      bySource: {
        internal: 0,
        hackernews: 0,
        reddit: 0,
        twitter: 0,
        other: 0,
      },
      highSignalCount: 0,
      verifiedCount: 0,
      flaggedCount: 0,
    };

    for (const reply of replies) {
      stats.byType[reply.replyType]++;
      stats.bySource[reply.sourceType || "internal"]++;
      if (reply.isHighSignal) stats.highSignalCount++;
      if (reply.isVerified) stats.verifiedCount++;
      if (reply.isFlagged) stats.flaggedCount++;
    }

    return stats;
  },
});
