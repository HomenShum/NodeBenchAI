/**
 * Delegation Helpers
 * 
 * Utility functions for managing delegation between coordinator and subagents
 */

import type { Agent } from "@convex-dev/agent";
import type { ToolCtx } from "@convex-dev/agent";
import type { TemporalContext } from "./temporalContext";

/**
 * Extended context type for delegation with optional evaluation user ID
 */
export type DelegationCtx = ToolCtx & {
  evaluationUserId?: string;
  depth?: number;
  /**
   * Normalized temporal window the orchestrator parsed from the user's query.
   * Subagents can use this to set date filters or prefer fresh sources.
   */
  temporalContext?: TemporalContext;
};

/**
 * Pick the appropriate user ID from context
 * Prefers evaluationUserId for testing, falls back to userId
 * 
 * @throws Error if no user ID is available (unauthenticated)
 */
export function pickUserId(ctx: DelegationCtx): string {
  const userId = (ctx.evaluationUserId) ?? ctx.userId;

  if (!userId) {
    throw new Error("Authentication required: No user ID found in context. User must be authenticated to delegate tasks.");
  }

  return userId;
}

/**
 * Ensure a thread exists for the agent
 * Reuses existing thread if provided, otherwise creates a new one
 * 
 * @param agent - The agent to create/reuse thread for
 * @param ctx - Delegation context
 * @param threadId - Optional existing thread ID
 * @returns Thread ID (existing or newly created)
 */
export async function ensureThread(
  agent: Agent,
  ctx: DelegationCtx,
  threadId?: string
): Promise<string> {
  // If threadId is explicitly provided and looks like a real Convex thread ID, use it.
  // Guard against LLM-provided labels like "ai_infra_funding_last_week".
  const isLikelyThreadId = (val?: string) =>
    typeof val === "string" && /^[a-z0-9]{20,}$/i.test(val);
  if (isLikelyThreadId(threadId) && threadId) return threadId;

  // If context has a threadId, use it
  if (ctx.threadId) return ctx.threadId;

  // Otherwise, create a new thread
  const { threadId: created } = await agent.createThread(ctx as any, {
    userId: pickUserId(ctx),
  });

  return created;
}

/**
 * Format delegation result for consistent response structure
 * 
 * @param delegate - Name of the subagent that handled the request
 * @param threadId - Thread ID used for the delegation
 * @param messageId - Message ID of the agent's response
 * @param text - The agent's text response
 * @param toolsUsed - Array of tool names used by the agent
 * @returns Formatted delegation result object
 */
export function formatDelegationResult(
  delegate: string,
  threadId: string,
  messageId: string,
  text: string,
  toolsUsed: string[]
): {
  delegate: string;
  threadId: string;
  messageId: string;
  text: string;
  toolsUsed: string[];
} {
  return {
    delegate,
    threadId,
    messageId,
    text,
    toolsUsed,
  };
}

/**
 * Extract tool names from agent result
 * 
 * @param result - Agent generation result
 * @returns Array of tool names used
 */
export function extractToolNames(result: any): string[] {
  const tools = new Set<string>();

  const maybeToolCalls: any[] | undefined =
    Array.isArray(result?.toolCalls) ? result.toolCalls :
      Array.isArray(result?.toolcalls) ? result.toolcalls :
        undefined;

  if (maybeToolCalls) {
    for (const call of maybeToolCalls) {
      if (call?.toolName && typeof call.toolName === "string") tools.add(call.toolName);
      if (call?.name && typeof call.name === "string") tools.add(call.name);
    }
  }

  if (!Array.isArray(result?.steps)) return Array.from(tools);

  const toolCalls: any[] = [];
  for (const step of result.steps) {
    if (step.toolCalls) {
      toolCalls.push(...step.toolCalls);
    }
  }

  for (const call of toolCalls) {
    if (call?.toolName && typeof call.toolName === "string") tools.add(call.toolName);
    if (call?.name && typeof call.name === "string") tools.add(call.name);
  }

  return Array.from(tools);
}

