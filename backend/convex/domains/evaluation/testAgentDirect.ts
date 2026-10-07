"use node";

/**
 * Test the Agent component directly to debug streaming
 */

import { action, internalAction } from "../../_generated/server";
import { v } from "convex/values";
import { Agent, stepCountIs, listUIMessages } from "@convex-dev/agent";
import { components, internal, api } from "../../_generated/api";
import { anthropic } from "@ai-sdk/anthropic";
import { Id } from "../../_generated/dataModel";

// Import the model resolver to match production
import { getLanguageModelSafe } from "../agents/mcp_tools/models/modelResolver";

// Create a minimal test agent - EXACTLY like createSimpleChatAgent
const createTestSimpleAgent = (model: string) => new Agent(components.agent, {
  name: "MiniNoteAgent",
  languageModel: getLanguageModelSafe(model),
  instructions: `You are a helpful, friendly AI assistant for quick conversations and note-taking.

Keep responses:
- Concise and conversational
- Helpful and informative
- Natural and friendly

You don't have access to tools or external data - just provide thoughtful, direct responses based on the conversation.`,
  tools: {},
  stopWhen: stepCountIs(3),
});

/**
 * Test direct agent streaming - exactly mimics streamAsync flow
 */
export const testAgentStreaming = action({
  args: {
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    text?: string;
    messageId?: string;
    threadId?: string;
    error?: string;
  }> => {
    const prompt = args.prompt || "Say 'HELLO FROM AGENT' and nothing else.";

    console.log(`[testAgentStreaming] Starting test with prompt: ${prompt}`);

    try {
      // Create a thread
      console.log(`[testAgentStreaming] Creating thread...`);
      const agent = createTestSimpleAgent("claude-haiku-4.5");
      const threadResult = await agent.createThread(ctx, {
        title: "Test Thread",
      });
      const threadId = threadResult.threadId;
      console.log(`[testAgentStreaming] Thread created: ${threadId}`);

      // Save the user message
      console.log(`[testAgentStreaming] Saving user message...`);
      const saveResult = await agent.saveMessage(ctx, {
        threadId,
        prompt,
        skipEmbeddings: true,
      });
      const messageId = saveResult.messageId;
      console.log(`[testAgentStreaming] User message saved: ${messageId}`);

      // Stream the response using prompt override (like streamAsync does when it finds the prompt text)
      console.log(`[testAgentStreaming] Starting stream with prompt override...`);
      const responsePromptOverride = `PROJECT CONTEXT\n\nUSER REQUEST:\n${prompt}`;
      const streamResult = await agent.streamText(
        ctx,
        { threadId },
        { prompt: responsePromptOverride },
        {
          // Use same settings as streamAsync
          saveStreamDeltas: {
            chunking: "word",
            throttleMs: 100,
          },
        }
      );

      console.log(`[testAgentStreaming] Stream started, messageId: ${streamResult.messageId}`);

      // Consume the stream
      console.log(`[testAgentStreaming] Consuming stream...`);
      await streamResult.consumeStream();
      console.log(`[testAgentStreaming] Stream consumed`);

      // Get the text
      const text = await streamResult.text;
      console.log(`[testAgentStreaming] Text result: "${text}"`);

      return {
        success: true,
        text,
        messageId: streamResult.messageId,
        threadId,
      };
    } catch (error: any) {
      console.error(`[testAgentStreaming] Error:`, error);
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  },
});

/**
 * Test that mimics the EXACT scheduled action flow
 */
export const testScheduledFlow = internalAction({
  args: {
    promptMessageId: v.string(),
    threadId: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    console.log(`[testScheduledFlow] Starting with args:`, args);

    try {
      // Create agent exactly like streamAsync does for simple mode
      const agent = createTestSimpleAgent(args.model);
      console.log(`[testScheduledFlow] Agent created`);

      // Build response prompt override exactly like streamAsync does
      const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
        threadId: args.threadId,
        order: "desc",
        paginationOpts: { cursor: null, numItems: 20 },
      });
      const page: any[] = (messages)?.page ?? (messages) ?? [];
      console.log(`[testScheduledFlow] Found ${page.length} messages`);

      const found = page.find((m: any) => String(m.messageId ?? m.id ?? m._id) === args.promptMessageId);
      let userPromptText: string | undefined;
      if (found && typeof found.text === "string") {
        userPromptText = found.text;
        console.log(`[testScheduledFlow] Found prompt text: "${userPromptText?.slice(0, 100)}"`);
      } else {
        console.log(`[testScheduledFlow] Prompt message not found!`);
      }

      let responsePromptOverride: string | undefined;
      if (userPromptText) {
        responsePromptOverride = `PROJECT CONTEXT\n\nUSER REQUEST:\n${userPromptText}`;
      }

      console.log(`[testScheduledFlow] responsePromptOverride: ${responsePromptOverride ? "SET" : "UNDEFINED"}`);

      // Stream exactly like streamAsync
      const result = await agent.streamText(
        ctx,
        { threadId: args.threadId },
        responsePromptOverride
          ? { prompt: responsePromptOverride }
          : { promptMessageId: args.promptMessageId },
        {
          saveStreamDeltas: {
            chunking: "word",
            throttleMs: 100,
          },
        }
      );

      console.log(`[testScheduledFlow] Stream started, messageId: ${result.messageId}`);

      await result.consumeStream();
      console.log(`[testScheduledFlow] Stream consumed`);

      const text = await result.text;
      console.log(`[testScheduledFlow] Text result: "${text}"`);

      return { success: true, text, messageId: result.messageId };
    } catch (error: any) {
      console.error(`[testScheduledFlow] Error:`, error);
      return { success: false, error: error.message || String(error) };
    }
  },
});

/**
 * Trigger the scheduled test flow
 */
export const triggerScheduledTest = action({
  args: {
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    threadId: string;
    messageId: string;
  }> => {
    const prompt = args.prompt || "Say exactly: SCHEDULED TEST OK";
    console.log(`[triggerScheduledTest] Starting with prompt: ${prompt}`);

    // Create agent and thread
    const agent = createTestSimpleAgent("claude-haiku-4.5");
    const { threadId } = await agent.createThread(ctx, { title: "Scheduled Test" });
    console.log(`[triggerScheduledTest] Thread created: ${threadId}`);

    // Save user message
    const { messageId } = await agent.saveMessage(ctx, {
      threadId,
      prompt,
      skipEmbeddings: true,
    });
    console.log(`[triggerScheduledTest] Message saved: ${messageId}`);

    // Schedule the test internal action
    await ctx.scheduler.runAfter(0, internal.domains.evaluation.testAgentDirect.testScheduledFlow, {
      threadId,
      promptMessageId: messageId,
      model: "claude-haiku-4.5",
    });

    console.log(`[triggerScheduledTest] Scheduled testScheduledFlow`);

    return { threadId, messageId };
  },
});

/**
 * Query messages from a thread
 */
export const getTestMessages = action({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args): Promise<any[]> => {
    const uiMessages = await listUIMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: { cursor: null, numItems: 100 },
    });
    const page: any[] = (uiMessages as any)?.page ?? [];
    return page.map((m: any) => ({
      id: m.id,
      role: m.role,
      text: m.text || "",
      textLen: (m.text || "").length,
    }));
  },
});

/**
 * Get agentThreadId from a chatThreadsStream thread (for debugging)
 */
export const getAgentThreadId = action({
  args: {
    streamThreadId: v.string(),
  },
  handler: async (ctx, args): Promise<string | null> => {
    const thread = await ctx.runQuery(internal.domains.evaluation.testAgentQueries.getStreamingThread, {
      threadId: args.streamThreadId,
    });
    return thread?.agentThreadId || null;
  },
});

/**
 * Query raw messages from agent component (for debugging)
 */
export const getRawMessages = action({
  args: {
    agentThreadId: v.string(),
  },
  handler: async (ctx, args): Promise<any> => {
    // Query raw messages from agent component
    const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
      threadId: args.agentThreadId,
      order: "asc",
      paginationOpts: { cursor: null, numItems: 100 },
    });

    const page: any[] = (messages)?.page ?? (messages) ?? [];

    // Also try listUIMessages for comparison
    const uiMessages = await listUIMessages(ctx, components.agent, {
      threadId: args.agentThreadId,
      paginationOpts: { cursor: null, numItems: 100 },
    });
    const uiPage: any[] = (uiMessages as any)?.page ?? [];

    return {
      raw: page.map((m: any) => ({
        id: m.messageId || m.id || m._id,
        role: m.role,
        text: m.text,
        textLen: m.text?.length ?? 0,
        keys: Object.keys(m),
        error: m.error, // Include error field for debugging
        status: m.status,
        message: m.message, // Include full message object
      })),
      ui: uiPage.map((m: any) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        textLen: m.text?.length ?? 0,
        keys: Object.keys(m),
        status: m.status,
        parts: m.parts,
      })),
    };
  },
});
