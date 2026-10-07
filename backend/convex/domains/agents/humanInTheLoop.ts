// convex/humanInTheLoop.ts
// Human-in-the-loop functionality for agent interactions
// Allows agents to ask humans for input during execution

import { v } from "convex/values";
import { query, mutation, internalMutation } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

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
 * Get all pending human requests for a specific thread
 */
export const getPendingHumanRequests = query({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);

    // Get all pending requests for this thread
    const requests = await ctx.db
      .query("humanRequests")
      .withIndex("by_thread_and_status", (q) =>
        q.eq("threadId", args.threadId).eq("status", "pending")
      )
      .collect();

    // Filter to only requests owned by this user
    return requests.filter((req) => req.userId === userId);
  },
});

/**
 * Get all pending human requests for the current user (across all threads)
 */
export const getAllPendingRequests = query({
  args: {},
  handler: async (ctx) => {
    // Return empty array if not authenticated (don't throw)
    const rawUserId = await getAuthUserId(ctx);
    if (!rawUserId) {
      return [];
    }

    // Handle malformed user IDs with pipe characters
    let userId: Id<"users">;
    if (typeof rawUserId === "string" && rawUserId.includes("|")) {
      const userIdPart = rawUserId.split("|")[0];
      if (!userIdPart || userIdPart.length < 10) {
        return [];
      }
      userId = userIdPart as Id<"users">;
    } else {
      userId = rawUserId as Id<"users">;
    }

    // Verify user exists
    const user = await ctx.db.get(userId);
    if (!user) {
      return [];
    }

    // Get all pending requests for this user
    return await ctx.db
      .query("humanRequests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();
  },
});

/**
 * Respond to a human request
 */
export const respondToRequest = mutation({
  args: {
    requestId: v.id("humanRequests"),
    response: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);

    // Get the request
    const request = await ctx.db.get(args.requestId) as { userId: typeof userId; status: string } | null;
    if (!request) {
      throw new Error("Request not found");
    }

    // Verify user has access
    if (request.userId !== userId) {
      throw new Error("Not authorized to respond to this request");
    }

    // Verify request is still pending
    if (request.status !== "pending") {
      throw new Error("Request has already been answered or cancelled");
    }

    // Update the request
    await ctx.db.patch(args.requestId, {
      status: "answered",
      response: args.response,
      respondedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Cancel a human request
 */
export const cancelRequest = mutation({
  args: {
    requestId: v.id("humanRequests"),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);

    // Get the request
    const request = await ctx.db.get(args.requestId) as { userId: typeof userId; status: string } | null;
    if (!request) {
      throw new Error("Request not found");
    }

    // Verify user has access
    if (request.userId !== userId) {
      throw new Error("Not authorized to cancel this request");
    }

    // Verify request is still pending
    if (request.status !== "pending") {
      throw new Error("Request has already been answered or cancelled");
    }

    // Update the request
    await ctx.db.patch(args.requestId, {
      status: "cancelled",
    });

    return { success: true };
  },
});


/**
 * Create a new human request (Internal)
 * Note: Internal mutations don't have auth context, so userId must be passed explicitly
 */
export const createRequest = internalMutation({
  args: {
    userId: v.id("users"),
    threadId: v.string(),
    messageId: v.string(),
    toolCallId: v.string(),
    question: v.string(),
    context: v.optional(v.string()),
    options: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // userId is passed from the tool handler (which has auth context)
    await ctx.db.insert("humanRequests", {
      userId: args.userId,
      threadId: args.threadId,
      messageId: args.messageId,
      toolCallId: args.toolCallId,
      question: args.question,
      context: args.context,
      options: args.options,
      status: "pending",
    });
  },
});
