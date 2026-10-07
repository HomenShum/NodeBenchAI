/**
 * Agents SDK Adapter — pi-agent-core implementation
 *
 * Migrated from @openai/agents (0.8.5) to @mariozechner/pi-agent-core
 * + @mariozechner/pi-ai. The OpenAI Agents SDK shipped a zod constructor
 * regression at module-load time in @openai/agents-core/src/types/protocol.ts
 * that made the Convex deploy bundler's static analysis fail on every
 * file that transitively imported it. Pi-agent-core covers the same
 * surface (Agent + tool calling + multi-provider models via pi-ai's
 * unified `getModel`) without that bundle-time crash.
 *
 * The exported function names + return shapes (SubAgentAdapter contract)
 * are preserved so callers (registerDefaultAdapters, multiSdkLiveValidation,
 * adapters/index.ts re-exports) continue to compile unchanged.
 *
 * Notable shape differences from @openai/agents:
 *   - `new Agent({...})` constructor takes `{ initialState: {...} }` instead
 *     of flat options.
 *   - `run(agent, query, { maxTurns })` becomes `agent.prompt(query)` +
 *     `await agent.waitForIdle()`; the final response is read from
 *     `agent.state.messages[last].content` after settle.
 *   - `handoff(agent)` is not a primitive in pi-agent-core. Cross-agent
 *     handoff is composed: a parent agent gets a tool whose `execute`
 *     calls the child agent's `prompt()` and returns its final text.
 *   - Tool parameter schemas are TypeBox/JSON Schema, not zod. Callers
 *     that pass zod schemas via `createOpenAITool` get an automatic
 *     `zod-to-json-schema` conversion.
 *
 * @see https://github.com/badlogic/pi-mono
 * @see docs/architecture/2025-12-30-multi-sdk-subagent-architecture.md
 */
"use node";

import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { Type, type TSchema } from "typebox";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  SubAgentAdapter,
  AdapterInput,
  AdapterResult,
  HandoffContext,
} from "../types";

/**
 * Configuration for OpenAI-style multi-agent adapter.
 *
 * `tools` is `AgentTool<any>[]` — TypeBox/JSON Schema-shaped, returned
 * by `createOpenAITool` (which converts a zod schema for caller convenience).
 */
export interface OpenAIAgentsConfig {
  /** Agent name */
  name: string;
  /** Agent instructions */
  instructions: string;
  /** Model to use (default: gpt-5.4-mini) */
  model?: string;
  /** Tools available to the agent */
  tools?: AgentTool<any>[];
  /** Other agents this agent can hand off to (composed as dispatch tools). */
  handoffs?: Agent[];
  /** Maximum turns before stopping (advisory; pi-agent-core uses tool/budget-driven loops). */
  maxTurns?: number;
}

/**
 * Convert an OpenAI-style model id ("gpt-5.4-mini") to a pi-ai Model.
 * Defaults to OpenAI provider; falls back to gpt-5.4-mini if unknown.
 */
function resolveOpenAIModel(modelId: string) {
  // Prefer OpenAI provider for "gpt-*" identifiers.
  // Cast to any: the pi-ai model registry keys are large literal unions
  // and we accept arbitrary user-supplied strings here.
  const m = getModel("openai" as any, modelId as any);
  if (m) return m;
  // Fallback: gpt-5.4-mini is the canonical default for the multi-SDK live validation.
  return getModel("openai" as any, "gpt-5.4-mini" as any);
}

/**
 * Extract plain text from a pi-agent-core AgentMessage's content.
 * Assistant content is `Array<{ type, text } | ...>`; we concat text parts.
 */
function extractFinalText(agent: Agent): string {
  const messages = agent.state.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m: any = messages[i];
    if (m.role !== "assistant") continue;
    const content = m.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const c of content) {
        if (c && typeof c === "object" && c.type === "text" && typeof c.text === "string") {
          parts.push(c.text);
        }
      }
      return parts.join("");
    }
    return "";
  }
  return "";
}

/**
 * Build a "handoff dispatch" tool: when the parent agent calls it,
 * we run the target agent's prompt() and return the target's final text.
 * Replaces @openai/agents' declarative `handoff(agent)` primitive.
 */
function makeHandoffTool(target: Agent, targetName: string): AgentTool<any> {
  return {
    name: `handoff_to_${targetName}`,
    label: `Handoff → ${targetName}`,
    description: `Hand off the conversation to the ${targetName} specialist agent. Pass the full context as the 'message' argument.`,
    parameters: Type.Object({
      message: Type.String({ description: "The user-facing question or context to pass to the specialist." }),
    }),
    execute: async (_toolCallId, params) => {
      const { message } = params as { message: string };
      await target.prompt(message);
      await target.waitForIdle();
      const text = extractFinalText(target);
      return {
        content: [{ type: "text", text } as any],
        details: { handoffTarget: targetName },
      };
    },
  };
}

/**
 * Create an Agents SDK adapter (pi-agent-core under the hood).
 *
 * Preserves the @openai/agents adapter contract: returns a
 * SubAgentAdapter with execute() + handoff() methods that the
 * multi-SDK orchestrator dispatches to.
 */
export function createOpenAIAgentsAdapter(
  config: OpenAIAgentsConfig
): SubAgentAdapter<AdapterInput, unknown> {
  const {
    name,
    instructions,
    model = "gpt-5.4-mini",
    tools = [],
    handoffs: handoffAgents = [],
  } = config;

  const handoffTools = handoffAgents.map((a) =>
    makeHandoffTool(a, (a.state as any).name ?? "specialist")
  );

  const agent = new Agent({
    initialState: {
      systemPrompt: instructions,
      model: resolveOpenAIModel(model),
      tools: [...tools, ...handoffTools],
    },
  });

  return {
    name,
    sdk: "openai",
    description: `pi-agent-core agent (formerly @openai/agents): ${name}`,
    supportsHandoff: true,

    async execute(input: AdapterInput): Promise<AdapterResult<unknown>> {
      const startTime = Date.now();
      try {
        await agent.prompt(input.query);
        await agent.waitForIdle();

        // HONEST_STATUS — pi-agent-core's prompt() does NOT throw on
        // auth/network/model errors; it stashes them in state.errorMessage
        // and resolves waitForIdle() without producing an assistant message.
        // We must surface that as status:"error" rather than reporting
        // success on an empty response.
        const errMsg = (agent.state as { errorMessage?: string }).errorMessage;
        const result = extractFinalText(agent);
        if (errMsg) {
          return {
            agentName: name,
            sdk: "openai",
            status: "error",
            result: errMsg,
            executionTimeMs: Date.now() - startTime,
          };
        }
        if (!result) {
          return {
            agentName: name,
            sdk: "openai",
            status: "error",
            result:
              "Agent produced no response (no assistant message in state.messages — check OPENAI_API_KEY and model availability)",
            executionTimeMs: Date.now() - startTime,
          };
        }

        return {
          agentName: name,
          sdk: "openai",
          status: "success",
          result,
          executionTimeMs: Date.now() - startTime,
        };
      } catch (error) {
        return {
          agentName: name,
          sdk: "openai",
          status: "error",
          result: error instanceof Error ? error.message : String(error),
          executionTimeMs: Date.now() - startTime,
        };
      }
    },

    async handoff(
      targetAgent: string,
      context: HandoffContext
    ): Promise<AdapterResult<unknown>> {
      const startTime = Date.now();
      try {
        const combinedPrompt = context.messages
          .map((m) => `${m.role}: ${m.content}`)
          .join("\n");

        await agent.prompt(combinedPrompt);
        await agent.waitForIdle();

        // Same HONEST_STATUS guard as execute() above.
        const errMsg = (agent.state as { errorMessage?: string }).errorMessage;
        const result = extractFinalText(agent);
        if (errMsg) {
          return {
            agentName: name,
            sdk: "openai",
            status: "error",
            result: errMsg,
            executionTimeMs: Date.now() - startTime,
            handoffTarget: targetAgent,
          };
        }

        return {
          agentName: name,
          sdk: "openai",
          status: result ? "success" : "handoff",
          result,
          executionTimeMs: Date.now() - startTime,
          handoffTarget: targetAgent,
        };
      } catch (error) {
        return {
          agentName: name,
          sdk: "openai",
          status: "error",
          result: error instanceof Error ? error.message : String(error),
          executionTimeMs: Date.now() - startTime,
        };
      }
    },
  };
}

/**
 * Create a triage agent that routes to specialist agents.
 * The triage agent gets one handoff_to_<specialist> tool per specialist.
 */
export function createTriageAgentSystem(config: {
  triageName: string;
  triageInstructions: string;
  specialists: Array<{
    name: string;
    instructions: string;
    handoffDescription?: string;
    tools?: AgentTool<any>[];
  }>;
  model?: string;
}) {
  const { triageName, triageInstructions, specialists, model = "gpt-5.4-mini" } = config;
  const resolvedModel = resolveOpenAIModel(model);

  const specialistAgents = specialists.map((spec) => {
    const a = new Agent({
      initialState: {
        systemPrompt: spec.instructions,
        model: resolvedModel,
        tools: spec.tools ?? [],
      },
    });
    // Stash name on state so makeHandoffTool can find it.
    (a.state as any).name = spec.name;
    return a;
  });

  const triageAgent = new Agent({
    initialState: {
      systemPrompt: triageInstructions,
      model: resolvedModel,
      tools: specialistAgents.map((a, i) => makeHandoffTool(a, specialists[i].name)),
    },
  });

  return {
    triageAgent,
    specialistAgents,
    async run(query: string) {
      await triageAgent.prompt(query);
      await triageAgent.waitForIdle();
      return { finalOutput: extractFinalText(triageAgent) };
    },
  };
}

/**
 * Create a manager agent that uses specialists as tools (not handoffs).
 * The manager keeps control; specialists are invoked synchronously per call.
 */
export function createManagerAgentSystem(config: {
  managerName: string;
  managerInstructions: string;
  specialists: Array<{
    name: string;
    instructions: string;
    toolName: string;
    toolDescription: string;
  }>;
  model?: string;
}) {
  const { managerInstructions, specialists, model = "gpt-5.4-mini" } = config;
  const resolvedModel = resolveOpenAIModel(model);

  const specialistAgents = specialists.map(
    (spec) =>
      new Agent({
        initialState: {
          systemPrompt: spec.instructions,
          model: resolvedModel,
          tools: [],
        },
      })
  );

  const specialistTools: AgentTool<any>[] = specialists.map((spec, i) => ({
    name: spec.toolName,
    label: spec.toolName,
    description: spec.toolDescription,
    parameters: Type.Object({
      query: Type.String({ description: "Question or task for the specialist." }),
    }),
    execute: async (_toolCallId, params) => {
      const { query } = params as { query: string };
      const target = specialistAgents[i];
      await target.prompt(query);
      await target.waitForIdle();
      return {
        content: [{ type: "text", text: extractFinalText(target) } as any],
        details: { specialist: spec.name },
      };
    },
  }));

  const managerAgent = new Agent({
    initialState: {
      systemPrompt: managerInstructions,
      model: resolvedModel,
      tools: specialistTools,
    },
  });

  return {
    managerAgent,
    specialistAgents,
    async run(query: string) {
      await managerAgent.prompt(query);
      await managerAgent.waitForIdle();
      return { finalOutput: extractFinalText(managerAgent) };
    },
  };
}

/**
 * Create a research agent with web search (and optional analysis) tools.
 */
export function createResearchAgent(config: {
  name?: string;
  model?: string;
  searchTool: AgentTool<any>;
  analysisTool?: AgentTool<any>;
}) {
  const { model = "gpt-5.4-mini", searchTool, analysisTool } = config;
  const tools: AgentTool<any>[] = [searchTool];
  if (analysisTool) tools.push(analysisTool);

  return new Agent({
    initialState: {
      systemPrompt: `You are a research agent. Use your tools to search for information and analyze findings.

When given a research task:
1. Break down the query into searchable terms
2. Use the search tool to find relevant information
3. Synthesize the findings into a clear summary
4. Cite sources where appropriate`,
      model: resolveOpenAIModel(model),
      tools,
    },
  });
}

/**
 * Convert a zod schema to a TypeBox-compatible TSchema.
 *
 * pi-agent-core uses TypeBox/JSON Schema; this adapter accepts
 * zod for caller convenience and converts via `zod-to-json-schema`.
 * The output is JSON Schema, which is structurally a subset of TSchema.
 */
export function createOpenAITool(config: {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}): AgentTool<any> {
  const jsonSchema = zodToJsonSchema(config.schema, { target: "openApi3" }) as unknown as TSchema;
  return {
    name: config.name,
    label: config.name,
    description: config.description,
    parameters: jsonSchema,
    execute: async (_toolCallId, params) => {
      const text = await config.execute(params as Record<string, unknown>);
      return {
        content: [{ type: "text", text } as any],
        details: {},
      };
    },
  };
}
