/**
 * Convex Agent SDK Adapter
 *
 * Wraps Convex @convex-dev/agent agents as adapters with sub-thread
 * handoff support. This is the primary adapter for most operations
 * as it has native database access.
 *
 * @see docs/architecture/2025-12-30-multi-sdk-subagent-architecture.md
 */

import { Agent, createTool } from "@convex-dev/agent";
import { z } from "zod";
import type {
  SubAgentAdapter,
  AdapterInput,
  AdapterResult,
  HandoffContext,
  AdapterMessage,
} from "../types";

/**
 * Configuration for Convex agent adapter
 */
export interface ConvexAdapterConfig {
  /** Human-readable name for the adapter */
  name: string;
  /** Agent instance to wrap */
  agent: Agent;
  /** Maximum steps before stopping */
  maxSteps?: number;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Whether to persist sub-threads */
  persistSubThreads?: boolean;
}

/**
 * Create a Convex agent adapter
 *
 * This adapter wraps an existing Convex Agent instance and provides
 * a unified interface for execution and handoffs.
 */
export function createConvexAgentAdapter(
  config: ConvexAdapterConfig
): SubAgentAdapter<AdapterInput, string> {
  const { name, agent, maxSteps = 10, timeoutMs = 30000, persistSubThreads = true } = config;

  return {
    name,
    sdk: "convex",
    description: `Convex-native agent with database access: ${name}`,
    supportsHandoff: true,

    async execute(input: AdapterInput): Promise<AdapterResult<string>> {
      const startTime = Date.now();

      try {
        // Note: Convex agents need an action context to execute
        // This adapter is designed to be called within a Convex action
        // The actual execution is handled by the delegation tools

        // For now, return a placeholder that indicates the adapter is ready
        // Actual execution happens through agent.generateText() in actions
        return {
          agentName: name,
          sdk: "convex",
          status: "success",
          result: `[ConvexAdapter:${name}] Ready for execution with query: ${input.query}`,
          executionTimeMs: Date.now() - startTime,
        };
      } catch (error) {
        return {
          agentName: name,
          sdk: "convex",
          status: "error",
          result: error instanceof Error ? error.message : String(error),
          executionTimeMs: Date.now() - startTime,
        };
      }
    },

    async handoff(
      targetAgent: string,
      context: HandoffContext
    ): Promise<AdapterResult<string>> {
      const startTime = Date.now();

      // Handoffs in Convex use sub-threads
      // The actual handoff is implemented in the delegation tools
      return {
        agentName: targetAgent,
        sdk: "convex",
        status: "handoff",
        result: `Handoff to ${targetAgent} initiated`,
        executionTimeMs: Date.now() - startTime,
        handoffTarget: targetAgent,
        messages: context.messages,
      };
    },
  };
}

/**
 * Create a tool that delegates to another Convex agent
 *
 * This is the official pattern from @convex-dev/agent for
 * creating sub-agent handoffs via tools.
 */
export function createConvexHandoffTool(
  targetAgent: Agent,
  targetAgentName: string,
  description: string
) {
  return createTool({
    description: `Delegate to ${targetAgentName}: ${description}`,
    args: z.object({
      message: z.string().describe("The message/task to send to the agent"),
      includeContext: z
        .boolean()
        .optional()
        .describe("Whether to include conversation context"),
    }),
    handler: async (ctx, args: { message: string; includeContext?: boolean }, options) => {
      const { userId } = ctx;

      // Create a sub-thread for the delegated task
      const { thread } = await targetAgent.createThread(ctx, {
        userId,
        title: `Sub-thread for ${targetAgentName}`,
      });

      // Build prompt with optional context
      const prompt = args.includeContext && options?.messages
        ? [...options.messages, { role: "user" as const, content: args.message }]
        : args.message;

      // Execute the sub-agent
      const result = await thread.generateText({
        prompt,
      });

      return result.text;
    },
  });
}

/**
 * Create a parallel delegation tool for multiple Convex agents
 */
export function createConvexParallelDelegationTool(
  agents: Array<{ agent: Agent; name: string }>,
  description: string
) {
  const agentNames = agents.map((a) => a.name);

  return createTool({
    description: `Run multiple agents in parallel: ${description}. Available agents: ${agentNames.join(", ")}`,
    args: z.object({
      tasks: z.array(
        z.object({
          agentName: z.string().describe("Name of the agent to run"),
          message: z.string().describe("Message to send to the agent"),
        })
      ),
    }),
    handler: async (ctx, args: { tasks: Array<{ agentName: string; message: string }> }) => {
      const { userId } = ctx;

      // Map agent names to agents
      const agentMap = new Map(agents.map((a) => [a.name, a.agent]));

      // Execute all tasks in parallel
      const results = await Promise.allSettled(
        args.tasks.map(async (task) => {
          const agent = agentMap.get(task.agentName);
          if (!agent) {
            throw new Error(`Unknown agent: ${task.agentName}`);
          }

          const { thread } = await agent.createThread(ctx, {
            userId,
            title: `Parallel task: ${task.agentName}`,
          });

          const result = await thread.generateText({
            prompt: task.message,
          });

          return {
            agentName: task.agentName,
            result: result.text,
          };
        })
      );

      // Format results
      return JSON.stringify(
        results.map((r, i) =>
          r.status === "fulfilled"
            ? r.value
            : { agentName: args.tasks[i].agentName, error: r.reason?.message }
        ),
        null,
        2
      );
    },
  });
}

/**
 * Helper to convert Convex thread messages to adapter format
 */
export function convertConvexMessagesToAdapterFormat(
  messages: Array<{ role: string; content: string }>
): AdapterMessage[] {
  return messages.map((m) => ({
    role: m.role as AdapterMessage["role"],
    content: m.content,
  }));
}
