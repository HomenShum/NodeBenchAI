// convex/agentChat.ts
// Query and mutation functions for Agent component-based chat
// This provides the interface between the frontend and the @convex-dev/agent component

import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "../../_generated/server";
import { internal, components } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";

/**
 * Utility function to safely extract and validate user ID from authentication
 */
async function getSafeUserId(ctx: any): Promise<Id<"users">> {
  const rawUserId = await getAuthUserId(ctx);
  if (!rawUserId) {
    throw new Error("Not authenticated");
  }

  // Handle malformed user IDs with pipe characters
  let userId: Id<"users">;
  if (typeof rawUserId === "string" && rawUserId.includes("|")) {
    const userIdPart = rawUserId.split("|")[0];
    if (!userIdPart || userIdPart.length < 10) {
      throw new Error("Invalid user ID format. Please sign out and sign back in.");
    }
    userId = userIdPart as Id<"users">;
  } else {
    userId = rawUserId;
  }

  // Verify user exists
  const user = await ctx.db.get(userId);
  if (!user) {
    throw new Error("User not found. Please sign out and sign back in.");
  }

  return userId;
}

/**
 * List all agent threads for the current user
 * Returns threads from the Agent component's storage
 */
export const listUserThreads = (query as any)({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    const userId = await getSafeUserId(ctx);

    const streamThreads = await ctx.db
      .query("chatThreadsStream")
      .withIndex("by_user_updatedAt", (q: any) => q.eq("userId", userId))
      .order("desc")
      .paginate(args.paginationOpts);

    // Map to the format expected by the frontend
    return {
      ...streamThreads,
      page: streamThreads.page.map((thread: any) => ({
        _id: thread.agentThreadId || thread._id, // Use agent thread ID if available
        userId: thread.userId,
        title: thread.title,
        pinned: thread.pinned || false,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        _creationTime: thread._creationTime,
        lastMessageAt: thread.updatedAt,
        modelsUsed: thread.model ? [thread.model] : [],
      })),
    };
  },
});

/**
 * Get messages for a specific thread
 */
export const getThreadMessages = (query as any)({
  args: {
    threadId: v.string(),
    paginationOpts: v.optional(v.any()),
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    const userId = await getSafeUserId(ctx);

    // Verify user has access to this thread (via the stream thread link)
    const streamThread = await ctx.db
      .query("chatThreadsStream")
      .withIndex("by_agentThreadId", (q: any) => q.eq("agentThreadId", args.threadId))
      .first();

    if (!streamThread) {
      // Fallback: check if it's a raw agent thread owned by user (if not linked yet)
      // But for now, let's assume it must be linked.
      // Actually, if we just created it, it should be linked.
      // If not found, return empty.
      return { page: [], isDone: true, continueCursor: null };
    }

    if (streamThread.userId !== userId) {
      throw new Error("Not authorized to view this thread");
    }

    // Fetch messages from the Agent component
    const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
      threadId: args.threadId,
      order: "asc",
      paginationOpts: args.paginationOpts || { numItems: 100, cursor: null },
    });

    return messages;
  },
});



/**
 * Delete a thread
 */
export const deleteThread = (mutation as any)({
  args: { threadId: v.string() },
  handler: async (ctx: any, args: any): Promise<any> => {
    const userId = await getSafeUserId(ctx);

    // Find the streaming thread by agent thread ID
    const streamThread = await ctx.db
      .query("chatThreadsStream")
      .withIndex("by_agentThreadId", (q: any) => q.eq("agentThreadId", args.threadId))
      .first();

    if (!streamThread) {
      throw new Error("Thread not found");
    }

    // Verify user has access
    if (streamThread.userId !== userId) {
      throw new Error("Not authorized to delete this thread");
    }

    // Delete all messages in the thread
    const messages = await ctx.db
      .query("chatMessagesStream")
      .withIndex("by_thread", (q: any) => q.eq("threadId", streamThread._id))
      .collect();

    for (const message of messages) {
      await ctx.db.delete(message._id);
    }

    // Delete the thread
    await ctx.db.delete(streamThread._id);

    return { success: true };
  },
});

/**
 * Internal mutation to create a new thread
 */
export const createThread = (internalMutation as any)({
  args: {
    userId: v.id("users"),
    title: v.string(),
    model: v.optional(v.string()),
    agentThreadId: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    const now = Date.now();
    const threadId = await ctx.db.insert("chatThreadsStream", {
      userId: args.userId,
      title: args.title,
      model: args.model,
      agentThreadId: args.agentThreadId,
      createdAt: now,
      updatedAt: now,
    });

    return threadId;
  },
});

/**
 * Internal query to get a streaming thread by ID
 * Used to resolve thread IDs in actions
 */
export const getStreamThread = (internalQuery as any)({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    // Try to get it as a valid ID first
    try {
      const threadId = ctx.db.normalizeId("chatThreadsStream", args.threadId);
      if (threadId) {
        return await ctx.db.get(threadId);
      }
    } catch (e) {
      // Not a valid ID format
    }
    return null;
  },
});

/**
 * Internal query to get a streaming thread by agent thread ID.
 * Used by actions to resolve per-thread settings (e.g., selected model).
 */
export const getStreamThreadByAgentThreadId = (internalQuery as any)({
  args: {
    agentThreadId: v.string(),
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    return await ctx.db
      .query("chatThreadsStream")
      .withIndex("by_agentThreadId", (q: any) => q.eq("agentThreadId", args.agentThreadId))
      .order("desc")
      .first();
  },
});
