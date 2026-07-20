/**
 * Contradiction Detector Queries
 *
 * Separated from contradictionDetector.ts because queries cannot run in Node.js.
 */

import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";

/**
 * Get existing claims from a thread for comparison
 */
export const getThreadClaims = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
    lookbackDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - (args.lookbackDays || 30) * 24 * 60 * 60 * 1000;

    // Get recent verified posts
    const posts = await ctx.db
      .query("narrativePosts")
      .withIndex("by_thread", q => q.eq("threadId", args.threadId))
      .filter(q => q.gte(q.field("createdAt"), cutoff))
      .order("desc")
      .take(50);

    // Get temporal facts for the thread
    const thread = await ctx.db.get(args.threadId);
    const entityKeys = thread?.entityKeys || [];

    const facts: Doc<"temporalFacts">[] = [];
    for (const entityKey of entityKeys.slice(0, 5)) {
      const entityFacts = await ctx.db
        .query("temporalFacts")
        .withIndex("by_entity", q => q.eq("entityKey", entityKey))
        .filter(q => q.eq(q.field("isActive"), true))
        .take(20);
      facts.push(...entityFacts);
    }

    return {
      posts: posts.map(p => ({
        _id: p._id,
        content: p.content,
        postType: p.postType,
        isVerified: p.isVerified,
        createdAt: p.createdAt,
      })),
      facts: facts.map(f => ({
        _id: f._id,
        claim: f.claim,
        confidence: f.confidence,
        validFrom: f.validFrom,
        validUntil: f.validUntil,
      })),
    };
  },
});

/**
 * Get posts needing contradiction check (recently created, not yet verified)
 */
export const getPostsNeedingCheck = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const posts = await ctx.db
      .query("narrativePosts")
      .filter(q =>
        q.and(
          q.eq(q.field("isVerified"), false),
          q.eq(q.field("hasContradictions"), false)
        )
      )
      .order("desc")
      .take(args.limit || 20);

    return posts.map(p => ({
      _id: p._id,
      threadId: p.threadId,
      content: p.content,
      createdAt: p.createdAt,
    }));
  },
});
