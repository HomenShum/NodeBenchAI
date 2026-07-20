"use node";

import { generateText } from "ai";
import type { LanguageModelUsage } from "ai";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph/web";
import { getLanguageModelSafe } from "../../mcp_tools/models";
import type {
  AdapterInput,
  AdapterMessage,
  AdapterResult,
  SubAgentAdapter,
} from "../types";
import { DEFAULT_SDK_CONFIG } from "../types";
import {
  classifyForecastGate,
  type ForecastGateDecision,
  type ForecastGateInput,
} from "../../../temporal/forecastGatePolicy";

export interface LangGraphAdapterConfig {
  name: string;
  model?: string;
  systemPrompt?: string;
  maxIterations?: number;
}

export interface TemporalForecastGraphResult {
  decision: ForecastGateDecision;
  nodeTrace: Array<{
    node: string;
    status: "ok";
    detail: string;
  }>;
  founderEpisodeSpan: {
    stage: "during";
    type: "forecast_gate";
    status: "ok";
    label: string;
    detail: string;
    timestamp: string;
    metrics: Record<string, string | number | boolean | null>;
  };
  openclawDirective: {
    shouldDelegate: boolean;
    reason: string;
    recommendedAction: string;
  };
}

function usageToTokenUsage(
  usage: LanguageModelUsage | undefined
): AdapterResult<unknown>["tokenUsage"] | undefined {
  const input = usage?.inputTokens;
  const output = usage?.outputTokens;
  if (typeof input !== "number" || typeof output !== "number") return undefined;
  return { input, output };
}

function toBaseMessages(
  input: AdapterInput,
  systemPrompt: string | undefined
): BaseMessage[] {
  const base: BaseMessage[] = [];

  if (systemPrompt && systemPrompt.trim().length > 0) {
    base.push(new SystemMessage(systemPrompt));
  }

  const history = input.messages ?? [];
  for (const msg of history) {
    if (msg.role === "system") {
      base.push(new SystemMessage(msg.content));
      continue;
    }

    if (msg.role === "user") {
      base.push(new HumanMessage(msg.content));
      continue;
    }

    if (msg.role === "assistant") {
      base.push(new AIMessage(msg.content));
      continue;
    }

    const toolCallId = msg.toolCallId ?? `tool_${Date.now()}`;
    base.push(new ToolMessage(msg.content, toolCallId, msg.toolName));
  }

  base.push(new HumanMessage(input.query));

  return base;
}

function baseMessagesToPrompt(messages: BaseMessage[]): string {
  return messages
    .map((m) => {
      const type = (m as any)._getType?.() ?? (m as any).getType?.();
      const role =
        type === "human"
          ? "user"
          : type === "ai"
            ? "assistant"
            : type === "system"
              ? "system"
              : type === "tool"
                ? "tool"
                : "user";

      const content =
        typeof (m as any).content === "string"
          ? (m as any).content
          : JSON.stringify((m as any).content);

      return `${role}: ${content}`;
    })
    .join("\n");
}

function adapterMessagesFromBaseMessages(messages: BaseMessage[]): AdapterMessage[] {
  return messages.map((m) => {
    const type = (m as any)._getType?.() ?? (m as any).getType?.();
    const role: AdapterMessage["role"] =
      type === "human"
        ? "user"
        : type === "ai"
          ? "assistant"
          : type === "system"
            ? "system"
            : type === "tool"
              ? "tool"
              : "user";

    const content =
      typeof (m as any).content === "string"
        ? (m as any).content
        : JSON.stringify((m as any).content);

    return {
      role,
      content,
      toolCallId: (m as any).tool_call_id,
      toolName: (m as any).name,
    };
  });
}

function isTemporalForecastInput(value: unknown): value is ForecastGateInput {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).streamKey === "string" &&
    Array.isArray((value as Record<string, unknown>).values)
  );
}

export function createLangGraphAdapter(
  config: LangGraphAdapterConfig
): SubAgentAdapter<AdapterInput, string> {
  const {
    name,
    model = DEFAULT_SDK_CONFIG.vercel?.defaultModel || "kimi-k2.6",
    systemPrompt,
    maxIterations = DEFAULT_SDK_CONFIG.langgraph?.maxIterations || 5,
  } = config;

  return {
    name,
    sdk: "langgraph",
    description: `LangGraph adapter: ${name}`,
    supportsHandoff: false,

    async execute(input: AdapterInput): Promise<AdapterResult<string>> {
      const startTime = Date.now();

      try {
        let lastUsage: LanguageModelUsage | undefined;

        const graph = new StateGraph(MessagesAnnotation)
          .addNode("agent", async (state) => {
            const prompt = baseMessagesToPrompt(state.messages);
            const result = await generateText({
              model: getLanguageModelSafe(model),
              prompt,
              maxRetries: 3,
            });
            lastUsage = result.totalUsage;
            return { messages: [new AIMessage(result.text)] };
          })
          .addEdge(START, "agent")
          .addEdge("agent", END)
          .compile();

        const initialMessages = toBaseMessages(input, systemPrompt);

        const output = await graph.invoke(
          { messages: initialMessages },
          {
            recursionLimit: maxIterations,
          }
        );

        const allMessages = output.messages ?? [];
        const lastMessage = allMessages[allMessages.length - 1];
        const answer =
          typeof (lastMessage as any)?.content === "string"
            ? ((lastMessage as any).content as string)
            : JSON.stringify((lastMessage as any)?.content ?? "");

        return {
          agentName: name,
          sdk: "langgraph",
          model,
          status: "success",
          result: answer,
          executionTimeMs: Date.now() - startTime,
          tokenUsage: usageToTokenUsage(lastUsage),
          messages: adapterMessagesFromBaseMessages(allMessages),
        };
      } catch (error) {
        return {
          agentName: name,
          sdk: "langgraph",
          model,
          status: "error",
          result: error instanceof Error ? error.message : String(error),
          executionTimeMs: Date.now() - startTime,
        };
      }
    },
  };
}

export function createTemporalForecastGraphAdapter(
  config: LangGraphAdapterConfig
): SubAgentAdapter<AdapterInput, TemporalForecastGraphResult> {
  const {
    name,
  } = config;
  const maxIterations = Math.max(config.maxIterations ?? 0, DEFAULT_SDK_CONFIG.langgraph?.maxIterations ?? 0, 12);

  return {
    name,
    sdk: "langgraph",
    description: `LangGraph temporal forecast gate adapter: ${name}`,
    supportsHandoff: false,

    async execute(input: AdapterInput): Promise<AdapterResult<TemporalForecastGraphResult>> {
      const startTime = Date.now();
      const temporalForecast = input.options?.temporalForecast;

      if (!isTemporalForecastInput(temporalForecast)) {
        return {
          agentName: name,
          sdk: "langgraph",
          model: "deterministic-forecast-gate",
          status: "error",
          result: {
            decision: classifyForecastGate({
              streamKey: "missing_temporal_forecast",
              values: [],
              modelUsed: "insufficient_data",
            }),
            nodeTrace: [],
            founderEpisodeSpan: {
              stage: "during",
              type: "forecast_gate",
              status: "ok",
              label: "Forecast gate unavailable",
              detail: "Missing options.temporalForecast payload.",
              timestamp: new Date().toISOString(),
              metrics: {
                valuesCount: 0,
                latestOutsideInterval: false,
                confidenceBandWidth: null,
              },
            },
            openclawDirective: {
              shouldDelegate: false,
              reason: "Missing temporal forecast input.",
              recommendedAction: "observe",
            },
          },
          executionTimeMs: Date.now() - startTime,
        };
      }

      try {
        const nodeTrace: TemporalForecastGraphResult["nodeTrace"] = [];
        let decision: ForecastGateDecision | null = null;

        const recordNode = (node: string, detail: string) => {
          nodeTrace.push({ node, status: "ok", detail });
          return { messages: [new AIMessage(`${node}: ${detail}`)] };
        };

        const graph = new StateGraph(MessagesAnnotation)
          .addNode("load_founder_state", async () =>
            recordNode("load_founder_state", "Loaded founder state reference from NodeBench control plane.")
          )
          .addNode("load_packet_lineage", async () =>
            recordNode("load_packet_lineage", "Loaded packet lineage reference from NodeBench control plane.")
          )
          .addNode("load_time_series", async () =>
            recordNode("load_time_series", `Loaded ${temporalForecast.values.length} observations for ${temporalForecast.streamKey}.`)
          )
          .addNode("forecast_with_tsfm", async () =>
            recordNode(
              "forecast_with_tsfm",
              `Using ${temporalForecast.modelUsed ?? "unmodeled"} forecast context from NodeBench TSFM boundary.`
            )
          )
          .addNode("classify_forecast_gate", async () => {
            decision = classifyForecastGate(temporalForecast);
            return recordNode(
              "classify_forecast_gate",
              `${decision.trendDirection} -> ${decision.recommendedAction}`
            );
          })
          .addNode("decide_next_action", async () =>
            recordNode(
              "decide_next_action",
              decision?.explanation ?? "Forecast gate decision unavailable."
            )
          )
          .addNode("write_founder_episode_span", async () =>
            recordNode("write_founder_episode_span", "Prepared founder episode forecast_gate span payload.")
          )
          .addNode("emit_packet_update_or_handoff", async () =>
            recordNode(
              "emit_packet_update_or_handoff",
              decision?.recommendedAction === "delegate"
                ? "Prepared OpenClaw handoff directive."
                : "Prepared packet or observation directive."
            )
          )
          .addEdge(START, "load_founder_state")
          .addEdge("load_founder_state", "load_packet_lineage")
          .addEdge("load_packet_lineage", "load_time_series")
          .addEdge("load_time_series", "forecast_with_tsfm")
          .addEdge("forecast_with_tsfm", "classify_forecast_gate")
          .addEdge("classify_forecast_gate", "decide_next_action")
          .addEdge("decide_next_action", "write_founder_episode_span")
          .addEdge("write_founder_episode_span", "emit_packet_update_or_handoff")
          .addEdge("emit_packet_update_or_handoff", END)
          .compile();

        const output = await graph.invoke(
          { messages: [new HumanMessage(input.query)] },
          { recursionLimit: maxIterations }
        );

        const finalDecision = decision ?? classifyForecastGate(temporalForecast);
        const result: TemporalForecastGraphResult = {
          decision: finalDecision,
          nodeTrace,
          founderEpisodeSpan: {
            stage: "during",
            type: "forecast_gate",
            status: "ok",
            label: `Forecast gate: ${finalDecision.recommendedAction}`,
            detail: finalDecision.explanation,
            timestamp: new Date().toISOString(),
            metrics: {
              streamKey: finalDecision.streamKey,
              valuesCount: finalDecision.valuesCount,
              latestOutsideInterval: finalDecision.latestOutsideInterval,
              confidenceBandWidth: finalDecision.confidenceBandWidth,
              trendDirection: finalDecision.trendDirection,
            },
          },
          openclawDirective: {
            shouldDelegate: finalDecision.recommendedAction === "delegate",
            reason: finalDecision.explanation,
            recommendedAction: finalDecision.recommendedAction,
          },
        };

        return {
          agentName: name,
          sdk: "langgraph",
          model: "deterministic-forecast-gate",
          status: "success",
          result,
          executionTimeMs: Date.now() - startTime,
          messages: adapterMessagesFromBaseMessages(output.messages ?? []),
        };
      } catch (error) {
        return {
          agentName: name,
          sdk: "langgraph",
          model: "deterministic-forecast-gate",
          status: "error",
          result: {
            decision: classifyForecastGate(temporalForecast),
            nodeTrace: [],
            founderEpisodeSpan: {
              stage: "during",
              type: "forecast_gate",
              status: "ok",
              label: "Forecast gate fallback",
              detail: error instanceof Error ? error.message : String(error),
              timestamp: new Date().toISOString(),
              metrics: {
                valuesCount: temporalForecast.values.length,
                latestOutsideInterval: false,
                confidenceBandWidth: null,
              },
            },
            openclawDirective: {
              shouldDelegate: false,
              reason: "Temporal graph failed; fallback policy held delegation.",
              recommendedAction: "observe",
            },
          },
          executionTimeMs: Date.now() - startTime,
        };
      }
    },
  };
}
