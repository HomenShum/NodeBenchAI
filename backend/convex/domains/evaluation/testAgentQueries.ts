/**
 * Debug queries for testing agent functionality
 * These are queries that don't need Node.js runtime
 */

import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { Id } from "../../_generated/dataModel";

/**
 * Internal query to get streaming thread (needed for debug actions)
 */
export const getStreamingThread = internalQuery({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId as Id<"chatThreadsStream">);
    return thread;
  },
});
