/**
 * Cross-SDK Handoff Bridge
 *
 * Provides serialization and transfer of context between
 * different SDK adapters. Handles message format conversion,
 * state transfer, and handoff orchestration.
 *
 * @see docs/architecture/2025-12-30-multi-sdk-subagent-architecture.md
 */

import type {
  SubAgentAdapter,
  AdapterInput,
  AdapterResult,
  HandoffContext,
  AdapterMessage,
  SDKType,
} from "./types";
import {
  getAdapter,
  listAdaptersWithSDK,
  executeWithAdapter,
} from "./registry";

/**
 * Serialized handoff state for cross-SDK transfer
 */
export interface SerializedHandoffState {
  /** Unique handoff ID */
  handoffId: string;
  /** Source adapter name */
  sourceAdapter: string;
  /** Source SDK type */
  sourceSDK: SDKType;
  /** Target adapter name */
  targetAdapter: string;
  /** Target SDK type */
  targetSDK: SDKType;
  /** Serialized messages */
  messages: AdapterMessage[];
  /** Task description */
  taskDescription: string;
  /** Additional context */
  context: Record<string, unknown>;
  /** Timestamp */
  timestamp: number;
  /** Parent thread ID for tracking */
  parentThreadId?: string;
  /** User ID */
  userId?: string;
}

/**
 * Handoff result with full trace
 */
export interface HandoffResult<T = unknown> {
  /** Whether handoff was successful */
  success: boolean;
  /** The adapter result */
  result?: AdapterResult<T>;
  /** Handoff chain (for multi-hop handoffs) */
  handoffChain: string[];
  /** Total execution time */
  totalExecutionTimeMs: number;
  /** Error if failed */
  error?: string;
}

/**
 * Generate a unique handoff ID
 */
export function generateHandoffId(): string {
  return `ho_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Serialize handoff context for cross-SDK transfer
 */
export function serializeHandoffContext(
  sourceAdapter: string,
  targetAdapter: string,
  context: HandoffContext
): SerializedHandoffState {
  const source = getAdapter(sourceAdapter);
  const target = getAdapter(targetAdapter);

  return {
    handoffId: generateHandoffId(),
    sourceAdapter,
    sourceSDK: source?.sdk || "convex",
    targetAdapter,
    targetSDK: target?.sdk || "convex",
    messages: normalizeMessages(context.messages),
    taskDescription: context.taskDescription || "",
    context: context.metadata || {},
    timestamp: Date.now(),
    parentThreadId: context.parentThreadId,
    userId: context.userId?.toString(),
  };
}

/**
 * Deserialize handoff state back to context
 */
export function deserializeHandoffContext(
  state: SerializedHandoffState
): HandoffContext {
  return {
    parentThreadId: state.parentThreadId,
    userId: state.userId as unknown as HandoffContext["userId"],
    messages: state.messages,
    metadata: state.context,
    taskDescription: state.taskDescription,
    sourceAgent: state.sourceAdapter,
    initiatedAt: state.timestamp,
  };
}

/**
 * Normalize messages to a common format across SDKs
 */
export function normalizeMessages(messages: AdapterMessage[]): AdapterMessage[] {
  return messages.map((msg) => ({
    role: normalizeRole(msg.role),
    content: normalizeContent(msg.content),
    toolCallId: msg.toolCallId,
    toolName: msg.toolName,
    metadata: msg.metadata,
  }));
}

/**
 * Normalize role names across SDKs
 */
function normalizeRole(role: string): AdapterMessage["role"] {
  switch (role.toLowerCase()) {
    case "user":
    case "human":
      return "user";
    case "assistant":
    case "ai":
    case "bot":
      return "assistant";
    case "system":
      return "system";
    case "tool":
    case "function":
      return "tool";
    default:
      return "user";
  }
}

/**
 * Normalize content format
 */
function normalizeContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (content === null || content === undefined) {
    return "";
  }
  return JSON.stringify(content);
}

/**
 * Execute a cross-SDK handoff
 */
export async function executeHandoff<T>(
  sourceAdapterName: string,
  targetAdapterName: string,
  context: HandoffContext
): Promise<HandoffResult<T>> {
  const startTime = Date.now();
  const handoffChain = [sourceAdapterName];

  try {
    const targetAdapter = getAdapter(targetAdapterName);
    if (!targetAdapter) {
      return {
        success: false,
        handoffChain,
        totalExecutionTimeMs: Date.now() - startTime,
        error: `Target adapter not found: ${targetAdapterName}`,
      };
    }

    // Serialize the handoff state
    const serializedState = serializeHandoffContext(
      sourceAdapterName,
      targetAdapterName,
      context
    );

    // Convert to adapter input
    const input: AdapterInput = {
      query: context.taskDescription || context.messages[context.messages.length - 1]?.content || "",
      messages: serializedState.messages,
      threadId: serializedState.parentThreadId,
      options: {
        handoffState: serializedState,
      },
    };

    // Execute on target adapter
    const result = await executeWithAdapter<T>(targetAdapterName, input);

    handoffChain.push(targetAdapterName);

    // Check if result indicates another handoff
    if (result.status === "handoff" && result.handoffTarget) {
      // Recursive handoff (with max depth protection)
      if (handoffChain.length >= 5) {
        return {
          success: false,
          handoffChain,
          totalExecutionTimeMs: Date.now() - startTime,
          error: "Maximum handoff chain depth exceeded",
        };
      }

      // Build new context from result
      const newContext: HandoffContext = {
        ...context,
        messages: result.messages || context.messages,
        sourceAgent: targetAdapterName,
      };

      const chainResult = await executeHandoff<T>(
        targetAdapterName,
        result.handoffTarget,
        newContext
      );

      return {
        ...chainResult,
        handoffChain: [...handoffChain, ...chainResult.handoffChain.slice(1)],
        totalExecutionTimeMs: Date.now() - startTime,
      };
    }

    return {
      success: result.status === "success",
      result,
      handoffChain,
      totalExecutionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      handoffChain,
      totalExecutionTimeMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Find the best adapter for a handoff based on task type
 */
export function findBestAdapterForTask(
  taskDescription: string,
  excludeAdapters: string[] = []
): string | null {
  const adapters = listAdaptersWithSDK();
  const available = adapters.filter((a) => !excludeAdapters.includes(a.name));

  if (available.length === 0) return null;

  // Simple keyword matching for now
  const lowerTask = taskDescription.toLowerCase();

  // Check for SDK-specific keywords
  if (
    lowerTask.includes("deep research") ||
    lowerTask.includes("deep-research") ||
    lowerTask.includes("grounded research") ||
    lowerTask.includes("research with sources") ||
    lowerTask.includes("google deep research")
  ) {
    const googleAdapter = available.find((a) => a.sdk === "google");
    if (googleAdapter) return googleAdapter.name;
  }

  if (
    lowerTask.includes("reason") ||
    lowerTask.includes("think") ||
    lowerTask.includes("complex")
  ) {
    const anthropicAdapter = available.find((a) => a.sdk === "anthropic");
    if (anthropicAdapter) return anthropicAdapter.name;
  }

  if (
    lowerTask.includes("triage") ||
    lowerTask.includes("route") ||
    lowerTask.includes("handoff")
  ) {
    const openaiAdapter = available.find((a) => a.sdk === "openai");
    if (openaiAdapter) return openaiAdapter.name;
  }

  if (
    lowerTask.includes("research") ||
    lowerTask.includes("workflow") ||
    lowerTask.includes("investigate")
  ) {
    const langgraphAdapter = available.find((a) => a.sdk === "langgraph");
    if (langgraphAdapter) return langgraphAdapter.name;
  }

  // Default to Convex adapter
  const convexAdapter = available.find((a) => a.sdk === "convex");
  return convexAdapter?.name || available[0]?.name || null;
}

/**
 * Create a handoff context from an adapter result
 */
export function createHandoffContextFromResult<T>(
  result: AdapterResult<T>,
  taskDescription: string,
  userId?: string
): HandoffContext {
  return {
    messages: result.messages || [
      {
        role: "assistant",
        content: typeof result.result === "string"
          ? result.result
          : JSON.stringify(result.result),
      },
    ],
    taskDescription,
    sourceAgent: result.agentName,
    initiatedAt: Date.now(),
    metadata: {
      previousSDK: result.sdk,
      previousExecutionTimeMs: result.executionTimeMs,
      tokenUsage: result.tokenUsage,
    },
  };
}

/**
 * Compress messages for handoff (reduce token usage)
 */
export function compressMessagesForHandoff(
  messages: AdapterMessage[],
  maxTokensEstimate: number = 4000
): AdapterMessage[] {
  // Estimate ~4 chars per token
  const charLimit = maxTokensEstimate * 4;

  let totalChars = 0;
  const result: AdapterMessage[] = [];

  // Always include the last message
  const lastMessage = messages[messages.length - 1];
  if (lastMessage) {
    result.unshift(lastMessage);
    totalChars += lastMessage.content.length;
  }

  // Add earlier messages if space allows, prioritizing user messages
  for (let i = messages.length - 2; i >= 0; i--) {
    const msg = messages[i];
    if (totalChars + msg.content.length > charLimit) break;

    result.unshift(msg);
    totalChars += msg.content.length;
  }

  return result;
}

/**
 * Log handoff for debugging/tracing
 */
/**
 * Cross-SDK bridge utilities
 *
 * These helpers convert between common state formats used by different SDKs.
 * The shapes are intentionally loose to avoid leaking SDK-specific types into Convex.
 */
export const CrossSdkBridge = {
  /** Converts AdapterMessage history into a LangGraph-like state */
  toLangGraphState: (ctx: HandoffContext) => ({
    messages: (ctx.messages ?? []).map((m) => ({
      type: m.role === 'user' ? 'human' : m.role === 'assistant' ? 'ai' : 'system',
      content: m.content,
    })),
    context: ctx.artifacts ?? ctx.metadata ?? {},
    intent: ctx.intent ?? ctx.taskDescription ?? '',
    traceId: ctx.traceId,
  }),

  /** Converts a LangGraph-like state into an OpenAI Agents SDK style context payload */
  toOpenAIContext: (graphState: any, ctx: HandoffContext) => {
    const messages = Array.isArray(graphState?.messages) ? graphState.messages : [];
    const last = messages.length ? messages[messages.length - 1] : undefined;
    const synthesis =
      typeof last?.content === 'string' ? last.content :
      typeof last?.text === 'string' ? last.text :
      '';
    return {
      userId: ctx.personaProfile?.role || 'user',
      instructions: 'Previous Agent Summary: ' + synthesis + '. Continue task: ' + (ctx.intent ?? ctx.taskDescription ?? ''),
      additional_context: graphState?.context ?? ctx.artifacts ?? ctx.metadata ?? {},
      traceId: ctx.traceId,
    };
  },

  /** Converts generic state into an Anthropic-friendly prompt bundle */
  toAnthropicPrompt: (ctx: HandoffContext) => {
    const history = (ctx.messages ?? []).map((m) => m.role + ': ' + m.content).join('\n');
    const personaLine = ctx.personaProfile
      ? 'Persona: ' + ctx.personaProfile.role + '. Format: ' + ctx.personaProfile.preferredFormat + '. Risk tolerance: ' + ctx.personaProfile.riskTolerance + '.'
      : undefined;
    const task = ctx.intent ?? ctx.taskDescription ?? '';
    return {
      system: personaLine,
      prompt: (history + '\n\nTask: ' + task).trim(),
      context: ctx.artifacts ?? ctx.metadata ?? {},
      traceId: ctx.traceId,
    };
  },
};

export function logHandoff(
  state: SerializedHandoffState,
  result?: HandoffResult
): void {
  console.log(`[HandoffBridge] Handoff ${state.handoffId}:`, {
    from: `${state.sourceAdapter} (${state.sourceSDK})`,
    to: `${state.targetAdapter} (${state.targetSDK})`,
    messageCount: state.messages.length,
    taskDescription: state.taskDescription.substring(0, 100),
    success: result?.success,
    chain: result?.handoffChain,
    totalTimeMs: result?.totalExecutionTimeMs,
  });
}
