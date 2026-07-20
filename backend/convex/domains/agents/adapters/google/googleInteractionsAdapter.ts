"use node";

import { GoogleGenAI } from "@google/genai";
import type {
  AdapterInput,
  AdapterMessage,
  AdapterResult,
  SubAgentAdapter,
} from "../types";
import { DEFAULT_SDK_CONFIG } from "../types";
import { getLlmModel } from "../../../../../shared/llm/modelCatalog";

export const GEMINI_DEEP_RESEARCH_AGENT_IDS = [
  "deep-research-preview-04-2026",
  "deep-research-max-preview-04-2026",
  "deep-research-pro-preview-12-2025",
] as const;

export type GeminiDeepResearchAgentId =
  (typeof GEMINI_DEEP_RESEARCH_AGENT_IDS)[number];

export const DEFAULT_GEMINI_DEEP_RESEARCH_AGENT: GeminiDeepResearchAgentId =
  "deep-research-preview-04-2026";
export const DEFAULT_GEMINI_DEEP_RESEARCH_MAX_AGENT: GeminiDeepResearchAgentId =
  "deep-research-max-preview-04-2026";
export const LEGACY_GEMINI_DEEP_RESEARCH_AGENT: GeminiDeepResearchAgentId =
  "deep-research-pro-preview-12-2025";

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLLS = 90;
const DEFAULT_MAX_RESUME_ATTEMPTS = 2;
const DEFAULT_STREAM_RETRY_DELAY_MS = 2_000;

type GoogleInteractionStatus =
  | "in_progress"
  | "requires_action"
  | "completed"
  | "failed"
  | "cancelled"
  | "incomplete";

export interface GoogleAllowedToolsConfig {
  mode?: "auto" | "any" | "none" | "validated";
  tools?: string[];
}

export type GoogleInteractionTool =
  | {
      type: "google_search";
      search_types?: Array<"web_search" | "image_search">;
    }
  | {
      type: "url_context";
    }
  | {
      type: "code_execution";
    }
  | {
      type: "file_search";
      file_search_store_names?: string[];
      metadata_filter?: string;
      top_k?: number;
    }
  | {
      type: "mcp_server";
      name?: string;
      url?: string;
      headers?: Record<string, string>;
      allowed_tools?: GoogleAllowedToolsConfig[];
    };

export interface GoogleDeepResearchAgentConfig {
  type?: "deep-research";
  thinking_summaries?: "auto" | "none";
  collaborative_planning?: boolean;
  visualization?: "auto" | "none";
}

export interface GoogleInteractionExecutionOptions {
  agent?: string;
  model?: string;
  systemInstruction?: string;
  tools?: GoogleInteractionTool[];
  input?: unknown;
  previousInteractionId?: string;
  includeInput?: boolean;
  background?: boolean;
  stream?: boolean;
  agentConfig?: GoogleDeepResearchAgentConfig & Record<string, unknown>;
  generationConfig?: Record<string, unknown>;
  pollIntervalMs?: number;
  maxPolls?: number;
  maxResumeAttempts?: number;
  cancelOnTimeout?: boolean;
  useNodeBenchResearchMcp?: boolean;
  nodeBenchResearchMcpName?: string;
  nodeBenchResearchAllowedTools?: GoogleAllowedToolsConfig[];
}

export interface GoogleInteractionsAdapterConfig
  extends GoogleInteractionExecutionOptions {
  name: string;
  description?: string;
}

export interface GoogleInteractionOutputSummary {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  name?: string;
  serverName?: string;
}

export interface GoogleInteractionAdapterPayload {
  interactionId: string | null;
  agent?: string;
  model?: string;
  status: GoogleInteractionStatus;
  finalText: string;
  thoughtSummaries: string[];
  outputs: GoogleInteractionOutputSummary[];
  usage?: unknown;
  eventCount: number;
  eventTypes: string[];
  lastEventId: string | null;
  resumed: boolean;
}

type StreamState = {
  interactionId: string | null;
  status: GoogleInteractionStatus;
  finalText: string;
  thoughtSummaries: string[];
  outputs: GoogleInteractionOutputSummary[];
  usage?: Record<string, unknown>;
  lastEventId: string | null;
  eventCount: number;
  eventTypes: string[];
  resumed: boolean;
};

function getGoogleApiKey(): string {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Google Gemini API key not configured (set GEMINI_API_KEY, GOOGLE_AI_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY)",
    );
  }
  return apiKey;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messagesToPrompt(messages: AdapterMessage[] | undefined, query: string): string {
  const parts: string[] = [];

  for (const msg of messages ?? []) {
    const toolSuffix = msg.toolName ? `:${msg.toolName}` : "";
    parts.push(`${msg.role}${toolSuffix}: ${msg.content}`);
  }

  parts.push(`user: ${query}`);
  return parts.join("\n\n").trim();
}

function normalizeUsage(usage: unknown): AdapterResult<unknown>["tokenUsage"] | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const record = usage as Record<string, unknown>;
  const input =
    record.inputTokens ??
    record.input_tokens ??
    record.promptTokenCount ??
    record.prompt_tokens ??
    record.promptTokens;
  const output =
    record.outputTokens ??
    record.output_tokens ??
    record.candidatesTokenCount ??
    record.completion_tokens ??
    record.completionTokens;
  const thinking =
    record.reasoningTokens ??
    record.reasoning_tokens ??
    record.thoughtTokens ??
    record.thought_tokens;

  if (typeof input !== "number" || typeof output !== "number") {
    return undefined;
  }

  return {
    input,
    output,
    thinking: typeof thinking === "number" ? thinking : undefined,
  };
}

function normalizeOutput(output: unknown): GoogleInteractionOutputSummary {
  if (!output || typeof output !== "object") {
    return { type: "unknown", text: String(output ?? "") };
  }

  const record = output as Record<string, unknown>;
  const type =
    typeof record.type === "string" && record.type.trim().length > 0
      ? record.type
      : "unknown";
  const text = typeof record.text === "string" ? record.text : undefined;
  const data = typeof record.data === "string" ? record.data : undefined;
  const mimeType =
    typeof record.mime_type === "string"
      ? record.mime_type
      : typeof record.mimeType === "string"
        ? record.mimeType
        : undefined;
  const name = typeof record.name === "string" ? record.name : undefined;
  const serverName =
    typeof record.server_name === "string"
      ? record.server_name
      : typeof record.serverName === "string"
        ? record.serverName
        : undefined;

  return {
    type,
    text,
    data,
    mimeType,
    name,
    serverName,
  };
}

function summarizeInteraction(
  interaction: any,
  streamState?: Partial<StreamState>,
): GoogleInteractionAdapterPayload {
  const normalizedOutputs = Array.isArray(interaction?.outputs)
    ? interaction.outputs.map(normalizeOutput)
    : [];
  const outputTexts = normalizedOutputs
    .filter((output) => output.type === "text" && output.text)
    .map((output) => output.text!.trim())
    .filter(Boolean);
  const streamTexts = streamState?.finalText?.trim()
    ? [streamState.finalText.trim()]
    : [];

  return {
    interactionId:
      typeof interaction?.id === "string"
        ? interaction.id
        : streamState?.interactionId ?? null,
    agent:
      typeof interaction?.agent === "string"
        ? interaction.agent
        : undefined,
    model:
      typeof interaction?.model === "string"
        ? interaction.model
        : undefined,
    status:
      (interaction?.status as GoogleInteractionStatus | undefined) ??
      streamState?.status ??
      "in_progress",
    finalText: [...streamTexts, ...outputTexts].join("\n\n").trim(),
    thoughtSummaries: streamState?.thoughtSummaries ?? [],
    outputs: normalizedOutputs.length > 0
      ? normalizedOutputs
      : streamState?.outputs ?? [],
    usage:
      interaction?.usage && typeof interaction.usage === "object"
        ? interaction.usage
        : streamState?.usage,
    eventCount: streamState?.eventCount ?? 0,
    eventTypes: streamState?.eventTypes ?? [],
    lastEventId: streamState?.lastEventId ?? null,
    resumed: streamState?.resumed ?? false,
  };
}

function isTerminalStatus(status: GoogleInteractionStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "incomplete" ||
    status === "requires_action"
  );
}

function buildAgentConfig(
  agent: string | undefined,
  config: GoogleDeepResearchAgentConfig & Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!agent && !config) return undefined;
  const merged: Record<string, unknown> = {
    type: "deep-research",
    ...(config ?? {}),
  };
  return merged;
}

export function getNodeBenchResearchMcpToolFromEnv(args?: {
  name?: string;
  allowedTools?: GoogleAllowedToolsConfig[];
  extraHeaders?: Record<string, string>;
}): GoogleInteractionTool | null {
  const url =
    process.env.RESEARCH_MCP_SERVER_URL ||
    process.env.RESEARCH_MCP_URL ||
    process.env.CORE_AGENT_MCP_SERVER_URL ||
    process.env.CORE_AGENT_MCP_URL;

  if (!url) return null;

  const secret = process.env.RESEARCH_API_KEY || process.env.MCP_SECRET;
  const headers: Record<string, string> = {
    ...(args?.extraHeaders ?? {}),
  };

  if (secret) {
    headers.Authorization = headers.Authorization ?? `Bearer ${secret}`;
    headers["x-mcp-secret"] = headers["x-mcp-secret"] ?? secret;
    headers["x-api-key"] = headers["x-api-key"] ?? secret;
  }

  return {
    type: "mcp_server",
    name: args?.name ?? "NodeBench Research MCP",
    url,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    allowed_tools: args?.allowedTools,
  };
}

async function consumeInteractionStream(
  client: GoogleGenAI,
  createParams: Record<string, unknown>,
  maxResumeAttempts: number,
): Promise<GoogleInteractionAdapterPayload> {
  const state: StreamState = {
    interactionId: null,
    status: "in_progress",
    finalText: "",
    thoughtSummaries: [],
    outputs: [],
    eventCount: 0,
    eventTypes: [],
    lastEventId: null,
    resumed: false,
  };

  const readStream = async (stream: AsyncIterable<any>) => {
    for await (const chunk of stream) {
      state.eventCount += 1;
      if (typeof chunk?.event_type === "string") {
        state.eventTypes.push(chunk.event_type);
      }
      if (typeof chunk?.event_id === "string") {
        state.lastEventId = chunk.event_id;
      }

      if (chunk?.event_type === "interaction.start" && chunk?.interaction) {
        state.interactionId =
          typeof chunk.interaction.id === "string" ? chunk.interaction.id : state.interactionId;
        state.status =
          (chunk.interaction.status as GoogleInteractionStatus | undefined) ?? state.status;
      } else if (chunk?.event_type === "interaction.status_update") {
        state.interactionId =
          typeof chunk.interaction_id === "string"
            ? chunk.interaction_id
            : state.interactionId;
        state.status =
          (chunk.status as GoogleInteractionStatus | undefined) ?? state.status;
      } else if (chunk?.event_type === "content.delta" && chunk?.delta) {
        const deltaType = typeof chunk.delta.type === "string" ? chunk.delta.type : "unknown";
        if (deltaType === "text" && typeof chunk.delta.text === "string") {
          state.finalText += chunk.delta.text;
        } else if (deltaType === "thought_summary") {
          const thoughtText =
            typeof chunk.delta.text === "string"
              ? chunk.delta.text
              : typeof chunk.delta?.content?.text === "string"
                ? chunk.delta.content.text
                : "";
          if (thoughtText.trim().length > 0) {
            state.thoughtSummaries.push(thoughtText.trim());
          }
        } else {
          state.outputs.push(normalizeOutput(chunk.delta));
        }
      } else if (chunk?.event_type === "interaction.complete" && chunk?.interaction) {
        state.interactionId =
          typeof chunk.interaction.id === "string" ? chunk.interaction.id : state.interactionId;
        state.status =
          (chunk.interaction.status as GoogleInteractionStatus | undefined) ?? "completed";
      } else if (chunk?.event_type === "error") {
        throw new Error(
          typeof chunk?.error?.message === "string"
            ? chunk.error.message
            : "Google interaction stream failed",
        );
      }
    }
  };

  let attempts = 0;
  let activeStream = await client.interactions.create(createParams as any);

  while (true) {
    try {
      await readStream(activeStream as unknown as AsyncIterable<any>);
      if (isTerminalStatus(state.status)) {
        break;
      }
      if (!state.interactionId || attempts >= maxResumeAttempts) {
        break;
      }
      attempts += 1;
      state.resumed = true;
      await sleep(DEFAULT_STREAM_RETRY_DELAY_MS);
      activeStream = await client.interactions.get(state.interactionId, {
        stream: true,
        last_event_id: state.lastEventId ?? undefined,
      } as any);
    } catch (error) {
      if (!state.interactionId || attempts >= maxResumeAttempts) {
        throw error;
      }
      attempts += 1;
      state.resumed = true;
      await sleep(DEFAULT_STREAM_RETRY_DELAY_MS);
      activeStream = await client.interactions.get(state.interactionId, {
        stream: true,
        last_event_id: state.lastEventId ?? undefined,
      } as any);
    }
  }

  if (!state.interactionId) {
    return {
      interactionId: null,
      status: state.status,
      agent: typeof createParams.agent === "string" ? createParams.agent : undefined,
      model: typeof createParams.model === "string" ? createParams.model : undefined,
      finalText: state.finalText.trim(),
      thoughtSummaries: state.thoughtSummaries,
      outputs: state.outputs,
      eventCount: state.eventCount,
      eventTypes: state.eventTypes,
      lastEventId: state.lastEventId,
      resumed: state.resumed,
    };
  }

  const finalInteraction = await client.interactions.get(state.interactionId, {
    include_input: false,
  } as any);

  return summarizeInteraction(finalInteraction, state);
}

async function pollInteraction(
  client: GoogleGenAI,
  createParams: Record<string, unknown>,
  args: {
    includeInput?: boolean;
    pollIntervalMs: number;
    maxPolls: number;
    cancelOnTimeout: boolean;
  },
): Promise<GoogleInteractionAdapterPayload> {
  const created = await client.interactions.create(createParams as any);
  const interactionId =
    typeof created?.id === "string"
      ? created.id
      : null;

  if (!interactionId) {
    return summarizeInteraction(created);
  }

  let latest = created;

  for (let attempt = 0; attempt < args.maxPolls; attempt += 1) {
    latest = await client.interactions.get(interactionId, {
      include_input: args.includeInput ?? false,
    } as any);

    const status =
      (latest?.status as GoogleInteractionStatus | undefined) ?? "in_progress";
    if (isTerminalStatus(status)) {
      return summarizeInteraction(latest);
    }

    await sleep(args.pollIntervalMs);
  }

  if (args.cancelOnTimeout) {
    try {
      await client.interactions.cancel(interactionId);
    } catch {
      // best effort only
    }
  }

  return {
    interactionId,
    agent:
      typeof latest?.agent === "string"
        ? latest.agent
        : typeof createParams.agent === "string"
          ? createParams.agent
          : undefined,
    model:
      typeof latest?.model === "string"
        ? latest.model
        : typeof createParams.model === "string"
          ? createParams.model
          : undefined,
    status: "in_progress",
    finalText: "",
    thoughtSummaries: [],
    outputs: [],
    usage:
      latest?.usage && typeof latest.usage === "object"
        ? latest.usage
        : undefined,
    eventCount: 0,
    eventTypes: [],
    lastEventId: null,
    resumed: false,
  };
}

export function createGoogleInteractionsAdapter(
  config: GoogleInteractionsAdapterConfig,
): SubAgentAdapter<AdapterInput, GoogleInteractionAdapterPayload> {
  const {
    name,
    description,
    agent = DEFAULT_GEMINI_DEEP_RESEARCH_AGENT,
    model,
    systemInstruction,
    tools,
    input,
    previousInteractionId,
    includeInput,
    background,
    stream,
    agentConfig,
    generationConfig,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    maxPolls = DEFAULT_MAX_POLLS,
    maxResumeAttempts = DEFAULT_MAX_RESUME_ATTEMPTS,
    cancelOnTimeout = true,
    useNodeBenchResearchMcp,
    nodeBenchResearchMcpName,
    nodeBenchResearchAllowedTools,
  } = config;

  return {
    name,
    sdk: "google",
    description:
      description ??
      `Google Interactions API adapter: ${name}`,
    supportsHandoff: false,

    async execute(
      adapterInput: AdapterInput,
    ): Promise<AdapterResult<GoogleInteractionAdapterPayload>> {
      const startTime = Date.now();

      try {
        const apiKey = getGoogleApiKey();
        const client = new GoogleGenAI({ apiKey });

        const runtimeOptions = (adapterInput.options?.googleInteraction ??
          {}) as GoogleInteractionExecutionOptions;

        const effectiveAgent = runtimeOptions.agent ?? agent;
        const effectiveModel =
          runtimeOptions.model ??
          model ??
          (effectiveAgent
            ? undefined
            : getLlmModel(
                "analysis",
                "gemini",
                DEFAULT_SDK_CONFIG.google?.defaultModel,
              ));
        const mergedAgentConfig = buildAgentConfig(
          effectiveAgent,
          runtimeOptions.agentConfig ?? agentConfig,
        );
        const interactionInput =
          runtimeOptions.input ??
          input ??
          messagesToPrompt(adapterInput.messages, adapterInput.query);

        const configuredTools = [
          ...((runtimeOptions.tools ?? tools) ?? []),
        ];
        if (runtimeOptions.useNodeBenchResearchMcp ?? useNodeBenchResearchMcp) {
          const nodeBenchTool = getNodeBenchResearchMcpToolFromEnv({
            name:
              runtimeOptions.nodeBenchResearchMcpName ??
              nodeBenchResearchMcpName,
            allowedTools:
              runtimeOptions.nodeBenchResearchAllowedTools ??
              nodeBenchResearchAllowedTools,
          });
          if (nodeBenchTool) {
            configuredTools.push(nodeBenchTool);
          }
        }

        const shouldUseAgent = Boolean(effectiveAgent);
        const shouldBackground =
          typeof (runtimeOptions.background ?? background) === "boolean"
            ? Boolean(runtimeOptions.background ?? background)
            : shouldUseAgent;
        const shouldStream = Boolean(runtimeOptions.stream ?? stream);
        const effectivePollIntervalMs =
          runtimeOptions.pollIntervalMs ?? pollIntervalMs;
        const effectiveMaxPolls =
          runtimeOptions.maxPolls ??
          Math.max(
            1,
            adapterInput.timeoutMs
              ? Math.ceil(adapterInput.timeoutMs / Math.max(1, effectivePollIntervalMs))
              : maxPolls,
          );
        const effectiveMaxResumeAttempts =
          runtimeOptions.maxResumeAttempts ?? maxResumeAttempts;
        const effectiveCancelOnTimeout =
          runtimeOptions.cancelOnTimeout ?? cancelOnTimeout;

        const createParams: Record<string, unknown> = {
          input: interactionInput,
          system_instruction:
            runtimeOptions.systemInstruction ?? systemInstruction,
          previous_interaction_id:
            runtimeOptions.previousInteractionId ?? previousInteractionId,
          background: shouldBackground,
          stream: shouldStream,
        };

        if (effectiveAgent) {
          createParams.agent = effectiveAgent;
          if (mergedAgentConfig) {
            createParams.agent_config = mergedAgentConfig;
          }
        } else if (effectiveModel) {
          createParams.model = effectiveModel;
          if (runtimeOptions.generationConfig ?? generationConfig) {
            createParams.generation_config =
              runtimeOptions.generationConfig ?? generationConfig;
          }
        } else {
          throw new Error("Google adapter requires either an agent or a model");
        }

        if (configuredTools.length > 0) {
          createParams.tools = configuredTools;
        }

        const payload = shouldStream
          ? await consumeInteractionStream(
              client,
              createParams,
              effectiveMaxResumeAttempts,
            )
          : await pollInteraction(client, createParams, {
              includeInput: runtimeOptions.includeInput ?? includeInput,
              pollIntervalMs: effectivePollIntervalMs,
              maxPolls: effectiveMaxPolls,
              cancelOnTimeout: effectiveCancelOnTimeout,
            });

        if (payload.status === "requires_action") {
          return {
            agentName: name,
            sdk: "google",
            model: payload.agent ?? payload.model,
            status: "handoff",
            result: payload,
            executionTimeMs: Date.now() - startTime,
            tokenUsage: normalizeUsage(payload.usage),
            handoffTarget: name,
            messages: payload.finalText
              ? [
                  ...(adapterInput.messages ?? []),
                  {
                    role: "assistant",
                    content: payload.finalText,
                    metadata: {
                      interactionId: payload.interactionId,
                      interactionStatus: payload.status,
                    },
                  },
                ]
              : adapterInput.messages,
          };
        }

        if (payload.status !== "completed") {
          return {
            agentName: name,
            sdk: "google",
            model: payload.agent ?? payload.model,
            status:
              payload.status === "in_progress" ? "timeout" : "error",
            result: payload,
            executionTimeMs: Date.now() - startTime,
            tokenUsage: normalizeUsage(payload.usage),
            messages: payload.finalText
              ? [
                  ...(adapterInput.messages ?? []),
                  {
                    role: "assistant",
                    content: payload.finalText,
                    metadata: {
                      interactionId: payload.interactionId,
                      interactionStatus: payload.status,
                    },
                  },
                ]
              : adapterInput.messages,
          };
        }

        return {
          agentName: name,
          sdk: "google",
          model: payload.agent ?? payload.model,
          status: "success",
          result: payload,
          executionTimeMs: Date.now() - startTime,
          tokenUsage: normalizeUsage(payload.usage),
          messages: payload.finalText
            ? [
                ...(adapterInput.messages ?? []),
                {
                  role: "assistant",
                  content: payload.finalText,
                  metadata: {
                    interactionId: payload.interactionId,
                    interactionStatus: payload.status,
                    thoughtSummaries: payload.thoughtSummaries,
                  },
                },
              ]
            : adapterInput.messages,
        };
      } catch (error) {
        return {
          agentName: name,
          sdk: "google",
          model: model ?? agent,
          status: "error",
          result: {
            interactionId: null,
            agent,
            model,
            status: "failed",
            finalText: "",
            thoughtSummaries: [],
            outputs: [],
            eventCount: 0,
            eventTypes: [],
            lastEventId: null,
            resumed: false,
          },
          executionTimeMs: Date.now() - startTime,
          messages: adapterInput.messages,
          thinkingTrace: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
