/**
 * Thread Curator Queries
 *
 * Separated from main index.ts because queries cannot run in Node.js environment.
 * These are called via ctx.runQuery from actions in index.ts.
 */

import { v } from "convex/values";
import { internalQuery } from "../../../../../_generated/server";
import type { Doc } from "../../../../../_generated/dataModel";

// Types copied from index.ts for reference
export interface ThreadContext {
  thread: Doc<"narrativeThreads">;
  recentPosts: Array<{
    postType: string;
    title?: string;
    content: string;
    createdAt: number;
  }>;
  thesis: string;
  counterThesis?: string;
  openDisputes: number;
  todayPostCount: number;
}

/**
 * Get thread state for curation decision
 */
export const getThreadState = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
  },
  handler: async (ctx, args): Promise<ThreadContext | null> => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) return null;

    // Get recent posts
    const recentPosts = await ctx.db
      .query("narrativePosts")
      .withIndex("by_thread", q => q.eq("threadId", args.threadId))
      .order("desc")
      .take(10);

    // Count today's posts
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayPostCount = recentPosts.filter(
      p => p.createdAt >= todayStart.getTime()
    ).length;

    // Count open disputes
    const disputes = await ctx.db
      .query("narrativeDisputeChains")
      .withIndex("by_status", q => q.eq("status", "open"))
      .take(100);

    const threadPostIds = new Set(recentPosts.map(p => p._id));
    const openDisputes = disputes.filter(
      d => d.targetType === "post" && threadPostIds.has(d.targetId as any)
    ).length;

    return {
      thread,
      recentPosts: recentPosts.map(p => ({
        postType: p.postType,
        title: p.title,
        content: p.content,
        createdAt: p.createdAt,
      })),
      thesis: thread.thesis,
      counterThesis: thread.counterThesis,
      openDisputes,
      todayPostCount,
    };
  },
});
