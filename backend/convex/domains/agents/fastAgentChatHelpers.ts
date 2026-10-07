// Helper functions for fastAgentChat.ts
// These are thin wrappers around existing functions in aiAgents.ts

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";

/**
 * Update agent run status
 * Wrapper around aiAgents.updateAgentRun
 */
export const updateRunStatus = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    status: v.union(
      v.literal("pending"),
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("error")
    ),
    finalResponse: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Legacy function - aiAgents module doesn't exist
    // Update the agentRuns table directly
    const fields: any = { status: args.status };
    if (args.finalResponse !== undefined) {
      fields.finalResponse = args.finalResponse;
    }
    if (args.errorMessage !== undefined) {
      fields.errorMessage = args.errorMessage;
    }

    // Direct update instead of calling non-existent aiAgents module
    await ctx.db.patch(args.runId, fields);

    return null;
  },
});

/**
 * Get messages by run ID
 * Note: The agentRuns table doesn't directly link to messages.
 * This is a placeholder that returns an empty array.
 * In a real implementation, you'd need to track message IDs in the run or vice versa.
 */
export const getMessagesByRun = internalQuery({
  args: {
    runId: v.id("agentRuns"),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    // The current schema doesn't have a direct link from agentRuns to messages
    // This would need to be implemented if you want to track messages per run
    // For now, return empty array to prevent errors
    console.warn(`[getMessagesByRun] Not implemented - returning empty array for runId: ${args.runId}`);
    return [];
  },
});

/**
 * Update message content
 * Note: This is a placeholder since we don't have a messages table linked to agentRuns
 */
export const updateMessageContent = internalMutation({
  args: {
    messageId: v.id("chatMessagesStream"),
    content: v.string(),
    status: v.optional(v.union(
      v.literal("streaming"),
      v.literal("complete"),
      v.literal("error")
    )),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // This would update a message in chatMessagesStream table
    // For now, just log a warning since fastAgentChat doesn't use chatMessagesStream
    console.warn(`[updateMessageContent] Not implemented - would update message ${args.messageId}`);
    return null;
  },
});

/**
 * Append run event
 * Wrapper around aiAgents.appendRunEvent
 */
export const appendRunEvent = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    kind: v.string(),
    message: v.optional(v.string()),
    data: v.optional(v.any()),
  },
  returns: v.object({ seq: v.number() }),
  handler: async (ctx, args): Promise<{ seq: number }> => {
    // Legacy function - aiAgents module doesn't exist
    // For now, just return a dummy sequence number
    // In a real implementation, you'd store events in a separate table
    console.warn(`[appendRunEvent] Not implemented - would append event to run ${args.runId}: ${args.kind}`);
    return { seq: 1 };
  },
});
