// convex/domains/agents/agentChatActions.ts
// Action functions for Agent component-based chat
// Actions can call external APIs and integrate with the Agent component

"use node";

import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import type { ActionCtx } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { createCoordinatorAgent } from "./core/coordinatorAgent";
import { DEFAULT_MODEL, normalizeModelInput } from "./mcp_tools/models";

// Agent-mode chat should use the same CoordinatorAgent wiring as streaming mode.
const createChatAgent = (model: string) => createCoordinatorAgent(model);

/**
 * Utility function to safely extract and validate user ID from authentication
 */
async function getSafeUserId(ctx: ActionCtx): Promise<Id<"users">> {
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

  return userId;
}

/**
 * Create a new thread with an initial message and get agent response
 */
export const createThreadWithMessage: any = (action as any)({
  args: {
    message: v.string(),
    model: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any): Promise<{ success: boolean; threadId: string; messageId?: string }> => {
    const userId = await getSafeUserId(ctx);

    return await ctx.runAction(internal.domains.agents.agentChatActions.createThreadWithMessageInternal, {
      message: args.message,
      model: args.model,
      userId,
    });
  },
});

/**
 * Internal version of createThreadWithMessage for testing and internal use
 */
export const createThreadWithMessageInternal = (internalAction as any)({
  args: {
    message: v.string(),
    model: v.optional(v.string()),
    userId: v.id("users"),
  },
  handler: async (ctx: any, args: any): Promise<{ success: boolean; threadId: string; messageId?: string }> => {
    const { userId, message, model } = args;
    const modelName = normalizeModelInput(model ?? DEFAULT_MODEL);
    const chatAgent = createChatAgent(modelName);

    // Create agent thread
    const { threadId: agentThreadId } = await chatAgent.createThread(ctx, { userId });

    // Create streaming thread record linked to agent thread
    const threadId = await ctx.runMutation(internal.domains.agents.agentChat.createThread, {
      userId,
      title: message.slice(0, 50) + (message.length > 50 ? "..." : ""),
      model: modelName,
      agentThreadId,
    });

    // Continue with the message
    const result = await ctx.runAction(api.domains.agents.agentChatActions.continueThread, {
      threadId: agentThreadId, // Pass agent thread ID for the agent component
      message: message,
    });

    return {
      success: true,
      threadId: agentThreadId, // Return agent thread ID as expected by frontend
      messageId: result.messageId,
    };
  },
});

/**
 * Continue an existing thread with a new message
 */
export const continueThread = (action as any)({
  args: {
    threadId: v.string(),
    message: v.string(),
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    let agentThreadId = args.threadId;

    // Check if the threadId is a chatThreadsStream ID
    // We can't easily check the format if it's a generic string, but we can try to find it in the DB
    // via an internal query helper.
    // Since we can't query the DB directly in an action, we need a helper.

    const streamThread = await ctx.runQuery(internal.domains.agents.agentChat.getStreamThread, {
      threadId: args.threadId,
    });

    if (streamThread && streamThread.agentThreadId) {
      agentThreadId = streamThread.agentThreadId;
    }

    // Resolve per-thread model (stored on the linked stream thread if available)
    let modelName = DEFAULT_MODEL;
    try {
      const streamThreadByAgentId = await ctx.runQuery(
        internal.domains.agents.agentChat.getStreamThreadByAgentThreadId,
        { agentThreadId }
      );
      if (streamThreadByAgentId?.model) {
        modelName = normalizeModelInput(streamThreadByAgentId.model);
      }
    } catch (err) {
      console.warn("[agentChatActions.continueThread] Failed to resolve thread model, using default.", err);
    }

    const chatAgent = createChatAgent(modelName);

    // Save the user message
    const { messageId } = await chatAgent.saveMessage(ctx, {
      threadId: agentThreadId,
      prompt: args.message,
    });

    // Run the agent (using streamText and consumeStream to ensure execution)
    const result = await chatAgent.streamText(
      ctx,
      { threadId: agentThreadId },
      { promptMessageId: messageId }
    );

    await result.consumeStream();

    return {
      success: true,
      messageId,
    };
  },
});
