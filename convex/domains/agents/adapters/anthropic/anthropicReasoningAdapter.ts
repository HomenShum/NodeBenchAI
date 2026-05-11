/**
 * Anthropic SDK Adapter with Extended Thinking
 *
 * Wraps @anthropic-ai/sdk for deep reasoning tasks using
 * Claude's extended thinking capability. Best for complex
 * analysis, math, coding, and multi-step reasoning.
 *
 * @see https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
 * @see docs/architecture/2025-12-30-multi-sdk-subagent-architecture.md
 */
"use node";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getModelSpec, resolveModelAlias } from "../../mcp_tools/models";
import type {
  SubAgentAdapter,
  AdapterInput,
  AdapterResult,
  HandoffContext,
  AdapterMessage,
  SDKConfig,
} from "../types";
import { DEFAULT_SDK_CONFIG } from "../types";
import {
  buildCachedSystem,
  buildCachedTools,
  extractCacheStats,
  type AnthropicCacheStats,
} from "./promptCacheHelpers";

function resolveAnthropicSdkModelId(model: string): string {
  const approved = resolveModelAlias(model);
  if (!approved) return model;
  const spec = getModelSpec(approved);
  return spec.provider === "anthropic" ? spec.sdkId : model;
}

/**
 * Extended thinking configuration
 */
export interface ExtendedThinkingConfig {
  /** Whether to enable extended thinking */
  enabled: boolean;
  /** Token budget for thinking (1024-32000, or higher for Claude 4 models) */
  budgetTokens: number;
}

/**
 * Tool definition for Anthropic
 */
export interface AnthropicToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType<unknown>;
  execute: (input: unknown) => Promise<string>;
}

/**
 * Configuration for Anthropic reasoning adapter
 */
export interface AnthropicAdapterConfig {
  /** Adapter name */
  name: string;
  /** Model to use */
  model?: string;
  /** Maximum output tokens */
  maxTokens?: number;
  /** Extended thinking configuration */
  thinking?: ExtendedThinkingConfig;
  /** Tools available to the agent */
  tools?: AnthropicToolDefinition[];
  /** System prompt */
  systemPrompt?: string;
}

/**
 * Create an Anthropic SDK adapter with extended thinking support
 */
export function createAnthropicReasoningAdapter(
  config: AnthropicAdapterConfig
): SubAgentAdapter<AdapterInput, { thinking: string; answer: string }> {
  const {
    name,
    model = DEFAULT_SDK_CONFIG.anthropic?.defaultModel || "claude-sonnet-4.6",
    maxTokens = 16000,
    thinking = {
      enabled: true,
      budgetTokens: DEFAULT_SDK_CONFIG.anthropic?.defaultThinkingBudget || 8000,
    },
    tools = [],
    systemPrompt,
  } = config;

  const sdkModelId = resolveAnthropicSdkModelId(model);

  return {
    name,
    sdk: "anthropic",
    description: `Anthropic Claude with extended thinking: ${name}`,
    supportsHandoff: false, // Anthropic doesn't have native handoffs

    async execute(
      input: AdapterInput
    ): Promise<AdapterResult<{ thinking: string; answer: string }>> {
      const startTime = Date.now();

      try {
        const anthropic = new Anthropic();

        // Build messages
        const messages: Anthropic.MessageParam[] = [];

        // Add context messages if provided
        if (input.messages) {
          for (const msg of input.messages) {
            if (msg.role === "user" || msg.role === "assistant") {
              messages.push({
                role: msg.role,
                content: msg.content,
              });
            }
          }
        }

        // Add the current query
        messages.push({
          role: "user",
          content: input.query,
        });

        // Build request params - use type assertion for extended thinking
        const requestParams: Record<string, unknown> = {
          model: sdkModelId,
          max_tokens: maxTokens,
          messages,
        };

        // Add system prompt — wrap in cache_control when above the 1024-token
        // floor so prefix-stable sub-agent runs (DeepReasoning, CodeAnalysis,
        // any custom adapter with the same role) hit the cache on subsequent
        // calls within the 5-min ephemeral window.  Below the floor the helper
        // returns the plain string so we don't waste request bytes on a
        // marker the API would silently drop.
        const cachedSystem = buildCachedSystem(systemPrompt);
        let systemCacheAttached = cachedSystem.attached;

        // Add extended thinking if enabled
        if (thinking.enabled) {
          requestParams.thinking = {
            type: "enabled",
            budget_tokens: thinking.budgetTokens,
          };
        }

        // Add tools — same gating logic.  Tools are typically the largest
        // stable block (10+ tools × full JSON schema = thousands of tokens),
        // so caching them is the highest-leverage move on any agent that
        // uses runWithTools or repeated single-turn `execute()` calls.
        let toolsCacheAttached = false;
        let preparedTools: Array<Anthropic.Tool> | undefined;
        if (tools.length > 0) {
          const rawTools = tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: zodToJsonSchema(t.inputSchema),
          }));
          const cachedTools = buildCachedTools(rawTools);
          toolsCacheAttached = cachedTools.attached;
          preparedTools = cachedTools.tools as Anthropic.Tool[] | undefined;
        }

        // Execute the request - build non-streaming params properly
        const nonStreamingParams: Anthropic.MessageCreateParamsNonStreaming = {
          model: requestParams.model as string,
          max_tokens: requestParams.max_tokens as number,
          messages: requestParams.messages as Anthropic.MessageParam[],
        };

        if (cachedSystem.system !== undefined) {
          // SDK accepts both `string` and `TextBlockParam[]`; the cast covers
          // the structured-blocks branch produced when caching is attached.
          nonStreamingParams.system =
            cachedSystem.system as Anthropic.MessageCreateParamsNonStreaming["system"];
        }
        if (preparedTools) {
          nonStreamingParams.tools = preparedTools;
        }

        const response = await anthropic.messages.create(nonStreamingParams);

        // HONEST_SCORES — record real cache stats from the API response.  No
        // fabricated floors: if the marker was dropped (e.g. the prompt
        // estimator was too generous) the stats will show
        // cacheControlAttached=true with cacheReadInputTokens=0 on first
        // call, which is exactly the signal the operator dashboard needs.
        const cacheStats: AnthropicCacheStats = extractCacheStats(
          response.usage,
          systemCacheAttached || toolsCacheAttached,
        );

        // Parse response blocks
        let thinkingContent = "";
        let textContent = "";

        for (const block of response.content) {
          // Check for thinking block (may be in beta)
          const blockAny = block as unknown as Record<string, unknown>;
          if (blockAny.type === "thinking") {
            thinkingContent = (blockAny.thinking as string) || "";
          }
          if (block.type === "text") {
            textContent = block.text;
          }
        }

        return {
          agentName: name,
          sdk: "anthropic",
          status: "success",
          result: {
            thinking: thinkingContent,
            answer: textContent,
          },
          executionTimeMs: Date.now() - startTime,
          thinkingTrace: thinkingContent,
          tokenUsage: {
            input: response.usage.input_tokens,
            output: response.usage.output_tokens,
            // HONEST_SCORES — only emit `cache` when we actually attempted
            // caching.  Downstream consumers can treat absence as "feature
            // off" and presence with read=0 as "first call, expect hits next".
            ...(cacheStats.cacheControlAttached
              ? {
                  cache: {
                    cacheControlAttached: cacheStats.cacheControlAttached,
                    cacheCreationInputTokens:
                      cacheStats.cacheCreationInputTokens,
                    cacheReadInputTokens: cacheStats.cacheReadInputTokens,
                    cacheHitRate: cacheStats.cacheHitRate,
                  },
                }
              : {}),
          },
        };
      } catch (error) {
        return {
          agentName: name,
          sdk: "anthropic",
          status: "error",
          result: {
            thinking: "",
            answer: error instanceof Error ? error.message : String(error),
          },
          executionTimeMs: Date.now() - startTime,
        };
      }
    },
  };
}

/**
 * Create a deep reasoning agent for complex analysis
 */
export function createDeepReasoningAgent(config?: {
  name?: string;
  thinkingBudget?: number;
  model?: string;
}): SubAgentAdapter<AdapterInput, { thinking: string; answer: string }> {
  return createAnthropicReasoningAdapter({
    name: config?.name || "DeepReasoningAgent",
    model: config?.model,
    thinking: {
      enabled: true,
      budgetTokens: config?.thinkingBudget || 10000,
    },
    systemPrompt: `You are a deep reasoning agent. When given a complex problem:

1. Take your time to think through the problem step by step
2. Consider multiple approaches and their trade-offs
3. Verify your reasoning at each step
4. Provide a clear, well-structured answer

Your thinking process should be thorough and systematic.`,
  });
}

/**
 * Create a code analysis agent with extended thinking
 */
export function createCodeAnalysisAgent(config?: {
  name?: string;
  thinkingBudget?: number;
}): SubAgentAdapter<AdapterInput, { thinking: string; answer: string }> {
  return createAnthropicReasoningAdapter({
    name: config?.name || "CodeAnalysisAgent",
    thinking: {
      enabled: true,
      budgetTokens: config?.thinkingBudget || 12000,
    },
    systemPrompt: `You are a code analysis agent. When analyzing code:

1. Understand the overall structure and purpose
2. Identify potential bugs, security issues, or performance problems
3. Trace data flow and control flow
4. Consider edge cases and error handling
5. Suggest improvements with clear reasoning

Be thorough and precise in your analysis.`,
  });
}

/**
 * Create an agent with tool use capabilities
 */
export async function runWithTools(config: {
  query: string;
  tools: AnthropicToolDefinition[];
  model?: string;
  maxTokens?: number;
  maxIterations?: number;
}): Promise<{ messages: AdapterMessage[]; finalAnswer: string }> {
  const {
    query,
    tools,
    model = DEFAULT_SDK_CONFIG.anthropic?.defaultModel || "claude-sonnet-4.6",
    maxTokens = 4096,
    maxIterations = 10,
  } = config;

  const anthropic = new Anthropic();
  const messages: AdapterMessage[] = [];
  const currentMessages: Anthropic.MessageParam[] = [{ role: "user", content: query }];
  let iteration = 0;

  // Build the tools array ONCE outside the loop and attach a cache_control
  // marker to the last tool when the catalog clears the 1024-token floor.
  // Inside a tool-loop the catalog is byte-identical across every iteration,
  // so the second iteration onward gets a cache hit on the entire schema
  // block (~90% discount on tool tokens).  This is the highest-leverage
  // single change in the file — multi-iteration tool loops were paying full
  // price for the same schema 5–10× per agent run.
  const rawTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: zodToJsonSchema(t.inputSchema),
  }));
  const cachedTools = buildCachedTools(rawTools);
  const preparedTools = (cachedTools.tools as Anthropic.Tool[] | undefined) ?? [];

  while (iteration < maxIterations) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      messages: currentMessages,
      tools: preparedTools,
    });

    // Check for tool use
    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      // No tool calls, return the text response
      const textBlock = response.content.find((b) => b.type === "text");
      const finalAnswer = textBlock?.type === "text" ? textBlock.text : "";

      messages.push({
        role: "assistant",
        content: finalAnswer,
      });

      return { messages, finalAnswer };
    }

    // Process tool calls
    const toolResults: Anthropic.MessageParam = {
      role: "user",
      content: [],
    };

    for (const block of toolUseBlocks) {
      if (block.type === "tool_use") {
        const toolDef = tools.find((t) => t.name === block.name);
        if (toolDef) {
          const result = await toolDef.execute(block.input);
          (toolResults.content as Anthropic.ToolResultBlockParam[]).push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });

          messages.push({
            role: "tool",
            content: result,
            toolCallId: block.id,
            toolName: block.name,
          });
        }
      }
    }

    // Add assistant response and tool results
    currentMessages.push({
      role: "assistant",
      content: response.content,
    });
    currentMessages.push(toolResults);

    iteration++;
  }

  // Max iterations reached
  return {
    messages,
    finalAnswer: "Maximum iterations reached without completion.",
  };
}

/**
 * Helper to convert Zod schema to JSON schema
 */
function zodToJsonSchema(schema: z.ZodType<unknown>): Anthropic.Tool.InputSchema {
  // Simple conversion - in production use zod-to-json-schema
  const zodAny = schema as z.ZodObject<Record<string, z.ZodType>>;

  if (zodAny._def?.typeName === "ZodObject") {
    const shape = zodAny.shape;
    const properties: Record<string, { type: string; description?: string }> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const zodValue = value as z.ZodType & { _def: { typeName: string; description?: string } };
      let type = "string";

      if (zodValue._def.typeName === "ZodNumber") type = "number";
      else if (zodValue._def.typeName === "ZodBoolean") type = "boolean";
      else if (zodValue._def.typeName === "ZodArray") type = "array";

      properties[key] = {
        type,
        description: zodValue._def.description,
      };

      // Check if required (not optional)
      if (!zodValue.isOptional?.()) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required,
    };
  }

  // Fallback
  return { type: "object" };
}

/**
 * Utility to adjust thinking budget based on task complexity
 */
export function calculateThinkingBudget(
  taskType: "simple" | "moderate" | "complex" | "very_complex",
  config: SDKConfig = DEFAULT_SDK_CONFIG
): number {
  const maxBudget = config.anthropic?.maxThinkingBudget || 32000;
  const defaultBudget = config.anthropic?.defaultThinkingBudget || 8000;

  switch (taskType) {
    case "simple":
      return 1024; // Minimum
    case "moderate":
      return defaultBudget;
    case "complex":
      return Math.min(defaultBudget * 2, maxBudget);
    case "very_complex":
      return maxBudget;
    default:
      return defaultBudget;
  }
}
