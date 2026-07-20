/**
 * Voice Actions - HTTP endpoints for real-time voice agent integration
 * 
 * These actions handle voice bot requests from RTVI/Daily Bots clients
 * and integrate with Convex Fast Agents for reasoning and tool execution.
 */

import { httpAction } from "../../../_generated/server";
import { internal, components } from "../../../_generated/api";
import { createVoiceAgent, createVoiceCoordinatorAgent, createVoicePlannerAgent, voicePlanSchema } from "./voiceAgent";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getLlmModel } from "../../../../shared/llm/modelCatalog";

/**
 * Voice session state stored in DB
 */
export interface VoiceSession {
  sessionId: string;
  userId: string;
  threadId: string; // Agent thread ID for conversation continuity
  createdAt: number;
  lastActivityAt: number;
  metadata?: {
    clientType?: string; // "daily-bots", "rtvi", etc.
    deviceInfo?: string;
  };
}

/**
 * /voice/connect - Initialize voice session
 * 
 * Called when a voice client connects. Creates a new agent thread
 * for the session to maintain conversation context.
 * 
 * Request body:
 * {
 *   sessionId?: string,  // Optional client-provided session ID
 *   userId?: string,     // Optional user ID (falls back to auth)
 *   metadata?: object    // Optional session metadata
 * }
 * 
 * Response:
 * {
 *   sessionId: string,
 *   threadId: string,
 *   status: "connected"
 * }
 */
export const voiceConnect = httpAction(async (ctx, request) => {
  try {
    const body = await request.json();
    const sessionId = body?.sessionId || `voice_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Get authenticated user
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create agent thread for this voice session
    const model = body?.model || getLlmModel("voice", "openai"); // Fast model for voice
    const voiceAgent = createVoiceAgent(model);

    const { threadId } = await voiceAgent.createThread(ctx, {
      userId,
      title: `Voice Session ${new Date().toLocaleString()}`,
    });

    // Store session in DB
    await ctx.runMutation(internal.domains.integrations.voice.voiceMutations.createVoiceSession, {
      sessionId,
      userId,
      threadId,
      metadata: {
        clientType: body?.metadata?.clientType,
        deviceInfo: body?.metadata?.deviceInfo,
        model,
      },
    });

    console.log(`[voice/connect] Created session ${sessionId} with thread ${threadId} for user ${userId}`);

    return new Response(
      JSON.stringify({
        sessionId,
        threadId,
        status: "connected",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[voice/connect] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to initialize voice session";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

/**
 * /voice/action - Process voice input and generate response
 * 
 * Called when the user speaks. Routes to appropriate agent based on
 * request complexity and streams response for real-time TTS.
 * 
 * Request body:
 * {
 *   sessionId?: string,  // Voice session ID
 *   threadId?: string,   // Agent thread ID (alternative to sessionId)
 *   text: string,        // Transcribed user speech
 *   streaming?: boolean  // Whether to stream response (default: false)
 * }
 * 
 * Response:
 * {
 *   reply: string,
 *   threadId: string,
 *   mode: "simple" | "complex",
 *   toolsUsed?: string[]
 * }
 */
export const voiceAction = httpAction(async (ctx, request) => {
  try {
    const body = await request.json();
    const text = typeof body?.text === "string" ? body.text : "";
    const sessionId = body?.sessionId;
    const providedThreadId = body?.threadId;
    const streaming = body?.streaming ?? false;
    
    if (!text.trim()) {
      return new Response(
        JSON.stringify({ error: "Text input required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get thread ID from session or use provided
    let threadId = providedThreadId;
    
    if (!threadId && sessionId) {
      const session = await ctx.runQuery(internal.domains.integrations.voice.voiceMutations.getVoiceSession, {
        sessionId,
      });
      threadId = session?.threadId;
    }

    const model = getLlmModel("voice", "openai");
    
    // Use planner to determine routing
    const planner = createVoicePlannerAgent(model);
    const { object: plan } = await planner.generateObject(
      ctx,
      { threadId: threadId || "" },
      { schema: voicePlanSchema, prompt: text }
    );

    // Route to appropriate agent
    const agent = plan?.mode === "complex" || plan?.requiresTools
      ? createVoiceCoordinatorAgent(model)
      : createVoiceAgent(model);

    // Create thread if needed
    if (!threadId) {
      const result = await agent.createThread(ctx, { title: "Voice Session" });
      threadId = result.threadId;
    }

    // Generate response with streaming support
    const result = await agent.streamText(
      ctx,
      { threadId },
      { prompt: text },
      {
        saveStreamDeltas: streaming ? {
          chunking: "word",
          throttleMs: 50, // Faster for voice
        } : undefined,
      }
    );

    // Consume stream and get final text
    await result.consumeStream();
    const reply = (await result.text) || "I'm here to help.";
    const toolCalls = (await result.toolCalls) || [];

    // Update session activity
    if (sessionId) {
      await ctx.runMutation(internal.domains.integrations.voice.voiceMutations.updateVoiceSessionActivity, {
        sessionId,
      });
    }

    return new Response(
      JSON.stringify({
        reply,
        threadId,
        mode: plan?.mode ?? "simple",
        toolsUsed: toolCalls.map((call: any) => call.toolName),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[voice/action] Error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process voice input" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
