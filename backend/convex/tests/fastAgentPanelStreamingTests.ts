import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../_generated/api";

// Integration-style internal actions to validate deleteMessage behavior
// Run with:
//   npx convex run convex/tests/fastAgentPanelStreamingTests:testDeleteByStreamId
//   npx convex run convex/tests/fastAgentPanelStreamingTests:testDeleteByAgentId

export const testDeleteByStreamId = internalMutation({
  args: {},
  returns: v.object({ ok: v.boolean(), info: v.string() }),
  handler: async (ctx) => {
    const userId = await (ctx as any).runMutation((internal as any).testHelpers.createTestUser, {});

    // Create a streaming thread linked to a dummy agent thread
    const now = Date.now();
    const threadId = await ctx.db.insert("chatThreadsStream", {
      userId,
      title: "Test Thread",
      model: "gpt-5-chat-latest",
      agentThreadId: "dummyAgentThread",
      pinned: false,
      createdAt: now,
      updatedAt: now,
    });

    // Insert a stream message that links to a dummy agent message id
    const streamMessageId = await ctx.db.insert("chatMessagesStream", {
      threadId,
      userId,
      role: "user",
      content: "Hello",
      streamId: undefined,
      agentMessageId: "dummyAgentMessageId-1",
      status: "complete",
      model: "gpt-5-chat-latest",
      tokensUsed: { input: 1, output: 1 },
      elapsedMs: 1,
      createdAt: now,
      updatedAt: now,
    });

    // Call the public mutation with the stream _id (the mutation accepts string)
    await (ctx as any).runMutation((api as any).fastAgentPanelStreaming.deleteMessage, {
      threadId,
      messageId: (streamMessageId as unknown as string),
    });

    // Verify stream message was deleted
    const stillThere = await ctx.db.get(streamMessageId);
    if (stillThere) throw new Error("Stream message was not deleted");

    // Verify no linked rows remain for that agentMessageId
    const linked = await ctx.db
      .query("chatMessagesStream")
      .withIndex("by_agentMessageId", (q) => q.eq("agentMessageId", "dummyAgentMessageId-1"))
      .collect();

    if (linked.length !== 0) throw new Error("Linked stream messages were not deleted");

    return { ok: true, info: "Deleted by stream _id: OK" };
  },
});

export const testDeleteByAgentId = internalMutation({
  args: {},
  returns: v.object({ ok: v.boolean(), info: v.string() }),
  handler: async (ctx) => {
    const userId = await (ctx as any).runMutation((internal as any).testHelpers.createTestUser, {});

    // Create a streaming thread linked to a dummy agent thread
    const now = Date.now();
    const threadId = await ctx.db.insert("chatThreadsStream", {
      userId,
      title: "Test Thread 2",
      model: "gpt-5-chat-latest",
      agentThreadId: "dummyAgentThread-2",
      pinned: false,
      createdAt: now,
      updatedAt: now,
    });

    // Insert a stream message that links to a dummy agent message id
    const agentMessageId = "dummyAgentMessageId-2";
    const streamMessageId = await ctx.db.insert("chatMessagesStream", {
      threadId,
      userId,
      role: "assistant",
      content: "World",
      streamId: undefined,
      agentMessageId,
      status: "complete",
      model: "gpt-5-chat-latest",
      tokensUsed: { input: 1, output: 1 },
      elapsedMs: 1,
      createdAt: now,
      updatedAt: now,
    });

    // Call the public mutation with the AGENT message id
    await (ctx as any).runMutation((api as any).fastAgentPanelStreaming.deleteMessage, {
      threadId,
      messageId: agentMessageId,
    });

    // Verify any stream message linked to that agent id is deleted
    const stillThere = await ctx.db.get(streamMessageId);
    if (stillThere) throw new Error("Linked stream message was not deleted when deleting by agent id");

    return { ok: true, info: "Deleted by agent message id: OK" };
  },
});

