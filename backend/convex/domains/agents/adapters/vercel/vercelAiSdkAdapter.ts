"use node";

import { generateText, stepCountIs } from "ai";
import { z } from "zod";
import type { LanguageModelUsage } from "ai";
import { getLanguageModelSafe } from "../../mcp_tools/models";
import type {
  AdapterInput,
  AdapterMessage,
  AdapterResult,
  SubAgentAdapter,
} from "../types";
import { DEFAULT_SDK_CONFIG } from "../types";

export interface VercelAiSdkToolDefinition {
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: (input: unknown) => Promise<unknown>;
}

export interface VercelAiSdkAdapterConfig {
  name: string;
  model?: string;
  systemPrompt?: string;
  maxSteps?: number;
  tools?: Record<string, VercelAiSdkToolDefinition>;
}

function usageToTokenUsage(
  usage: LanguageModelUsage | undefined
): AdapterResult<unknown>["tokenUsage"] | undefined {
  const input = usage?.inputTokens;
  const output = usage?.outputTokens;
  if (typeof input !== "number" || typeof output !== "number") return undefined;
  return { input, output };
}

function messagesToPrompt(messages: AdapterMessage[]): string {
  return messages
    .map((m) => {
      const role = m.role;
      const name = m.toolName ? `:${m.toolName}` : "";
      return `${role}${name}: ${m.content}`;
    })
    .join("\n");
}

function normalizeMessagesForPrompt(input: AdapterInput): string {
  const parts: string[] = [];

  if (input.messages && input.messages.length > 0) {
    parts.push(messagesToPrompt(input.messages));
  }

  parts.push(`user: ${input.query}`);

  return parts.join("\n\n");
}

export function createVercelAiSdkAdapter(
  config: VercelAiSdkAdapterConfig
): SubAgentAdapter<AdapterInput, string> {
  const {
    name,
    model = DEFAULT_SDK_CONFIG.vercel?.defaultModel || "gpt-5.4",
    systemPrompt,
    maxSteps = DEFAULT_SDK_CONFIG.vercel?.defaultMaxSteps || 5,
    tools,
  } = config;

  return {
    name,
    sdk: "vercel",
    description: `Vercel AI SDK adapter: ${name}`,
    supportsHandoff: false,

    async execute(input: AdapterInput): Promise<AdapterResult<string>> {
      const startTime = Date.now();

      try {
        const prompt = normalizeMessagesForPrompt(input);

        const result = await generateText({
          model: getLanguageModelSafe(model),
          system: systemPrompt,
          prompt,
          tools: tools
            ? Object.fromEntries(
                Object.entries(tools).map(([toolName, def]) => [
                  toolName,
                  {
                    description: def.description,
                    inputSchema: def.inputSchema,
                    execute: async (toolInput: unknown) => def.execute(toolInput),
                  },
                ])
              )
            : undefined,
          stopWhen: stepCountIs(maxSteps),
          maxRetries: 3,
        });

        const tokenUsage =
          usageToTokenUsage(result.totalUsage) ??
          usageToTokenUsage(result.usage) ??
          undefined;

        return {
          agentName: name,
          sdk: "vercel",
          model,
          status: "success",
          result: result.text,
          executionTimeMs: Date.now() - startTime,
          tokenUsage,
          messages: [
            ...(input.messages ?? []),
            {
              role: "assistant",
              content: result.text,
            },
          ],
        };
      } catch (error) {
        return {
          agentName: name,
          sdk: "vercel",
          model,
          status: "error",
          result: error instanceof Error ? error.message : String(error),
          executionTimeMs: Date.now() - startTime,
        };
      }
    },
  };
}
