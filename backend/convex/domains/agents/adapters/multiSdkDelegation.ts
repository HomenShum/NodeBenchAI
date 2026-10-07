/**
 * Multi-SDK Delegation Tools
 *
 * Tools for delegating tasks to specific SDK adapters from
 * the Convex coordinator agent. Enables routing to OpenAI Agents,
 * Anthropic extended thinking, etc.
 *
 * @see docs/architecture/2025-12-30-multi-sdk-subagent-architecture.md
 */

"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import {
  getAdapter,
  executeWithAdapter,
  executeParallel,
  routeQuery,
  listAdaptersWithSDK,
} from "./registry";
import { ensureDefaultAdaptersRegistered } from "./registerDefaultAdapters";
import {
  executeHandoff,
  findBestAdapterForTask,
  createHandoffContextFromResult,
} from "./handoffBridge";
import type { AdapterInput, HandoffContext, SDKType } from "./types";

async function ensureDefaults(): Promise<void> {
  await ensureDefaultAdaptersRegistered();
}

function createToolLoose(config: any) {
  // Avoid TS2589 "excessively deep" from Zod inference + tool generics.
  return createTool(config as any) as any;
}

/**
 * Tool to delegate a task to a specific SDK adapter
 */
export const delegateToSdkAdapter = createToolLoose({
  description: `Delegate a task to a specific SDK adapter. Available adapters can be discovered with listSdkAdapters.

Use this when you need:
- OpenAI Agents SDK for triage/handoff patterns
- Anthropic for extended thinking and complex reasoning
- Google Interactions for deep research and grounded web workflows
- LangGraph for multi-step research workflows`,
  args: z.object({
    adapterName: z.string().describe("Name of the adapter to use"),
    query: z.string().describe("The task or query to execute"),
    includeConversationContext: z
      .boolean()
      .optional()
      .describe("Whether to include the current conversation context"),
    timeoutMs: z.number().optional().describe("Timeout in milliseconds (default: 30000)"),
  }),
  handler: async (ctx: any, args: { adapterName: string; query: string; includeConversationContext?: boolean; timeoutMs?: number }) => {
    await ensureDefaults();
    const adapter = getAdapter(args.adapterName);
    if (!adapter) {
      return JSON.stringify({
        success: false,
        error: `Adapter not found: ${args.adapterName}`,
        availableAdapters: listAdaptersWithSDK(),
      });
    }

    const input: AdapterInput = {
      query: args.query,
      userId: ctx.userId,
      threadId: ctx.threadId,
      timeoutMs: args.timeoutMs,
    };

    const result = await executeWithAdapter(args.adapterName, input);

    return JSON.stringify({
      success: result.status === "success",
      agentName: result.agentName,
      sdk: result.sdk,
      result: result.result,
      executionTimeMs: result.executionTimeMs,
      tokenUsage: result.tokenUsage,
      thinkingTrace: result.thinkingTrace?.substring(0, 500), // Truncate for response
    });
  },
});

/**
 * Tool to auto-route a query to the best SDK based on content
 */
export const autoRouteToSdk = createToolLoose({
  description: `Automatically route a query to the most appropriate SDK based on the task type.

Routing rules:
- "reason", "think through", "complex" → Anthropic extended thinking
- "research", "investigate", "workflow" → LangGraph (if available)
- "triage", "handoff", "route" → OpenAI Agents SDK
- Default → Convex native agents`,
  args: z.object({
    query: z.string().describe("The task or query to execute"),
    preferredSdk: z
      .enum(["convex", "openai", "anthropic", "google", "langgraph", "vercel"])
      .optional()
      .describe("Optional: override auto-routing with a preferred SDK"),
  }),
  handler: async (ctx: any, args: { query: string; preferredSdk?: "convex" | "openai" | "anthropic" | "google" | "langgraph" | "vercel" }) => {
    await ensureDefaults();
    // Find the best adapter
    const adapter = routeQuery(args.query, args.preferredSdk as SDKType);

    if (!adapter) {
      return JSON.stringify({
        success: false,
        error: "No suitable adapter found for this query",
        query: args.query,
      });
    }

    const input: AdapterInput = {
      query: args.query,
      userId: ctx.userId,
      threadId: ctx.threadId,
    };

    const result = await adapter.execute(input);

    return JSON.stringify({
      success: result.status === "success",
      routedTo: adapter.name,
      sdk: adapter.sdk,
      result: result.result,
      executionTimeMs: result.executionTimeMs,
    });
  },
});

/**
 * Tool to list all available SDK adapters
 */
export const listSdkAdapters = createToolLoose({
  description: "List all registered SDK adapters with their capabilities",
  args: z.object({
    sdkFilter: z
      .enum(["convex", "openai", "anthropic", "google", "langgraph", "vercel"])
      .optional()
      .describe("Optional: filter by SDK type"),
  }),
  handler: async (_ctx: any, args: { sdkFilter?: "convex" | "openai" | "anthropic" | "google" | "langgraph" | "vercel" }) => {
    await ensureDefaults();
    let adapters = listAdaptersWithSDK();

    if (args.sdkFilter) {
      adapters = adapters.filter((a) => a.sdk === args.sdkFilter);
    }

    return JSON.stringify({
      adapters,
      count: adapters.length,
    });
  },
});

/**
 * Tool to execute multiple tasks across different SDKs in parallel
 */
export const parallelSdkExecution = createToolLoose({
  description: `Execute multiple tasks across different SDK adapters in parallel.

Example use cases:
- Run research on multiple entities simultaneously
- Compare results from different reasoning approaches
- Gather information from multiple specialized agents`,
  args: z.object({
    tasks: z.array(
      z.object({
        adapterName: z.string().describe("Name of the adapter"),
        query: z.string().describe("The task/query for this adapter"),
      })
    ),
    timeoutMs: z.number().optional().describe("Timeout for all tasks (default: 60000)"),
  }),
  handler: async (ctx: any, args: { tasks: Array<{ adapterName: string; query: string }>; timeoutMs?: number }) => {
    await ensureDefaults();
    const taskInputs = args.tasks.map((task) => ({
      adapterName: task.adapterName,
      input: {
        query: task.query,
        userId: ctx.userId,
        threadId: ctx.threadId,
        timeoutMs: args.timeoutMs,
      } as AdapterInput,
    }));

    const results = await executeParallel(taskInputs);

    return JSON.stringify({
      results: results.map((r) => ({
        agentName: r.agentName,
        sdk: r.sdk,
        status: r.status,
        result: r.result,
        executionTimeMs: r.executionTimeMs,
      })),
      totalTasks: results.length,
      successCount: results.filter((r) => r.status === "success").length,
    });
  },
});

/**
 * Tool to perform a cross-SDK handoff
 */
export const crossSdkHandoff = createToolLoose({
  description: `Hand off a task from one SDK adapter to another with full context transfer.

Use this when:
- A task needs capabilities from a different SDK
- The current adapter encounters a task outside its specialty
- Multi-stage workflows require different processing approaches`,
  args: z.object({
    targetAdapterName: z.string().describe("Name of the adapter to hand off to"),
    taskDescription: z.string().describe("Description of the task for the target adapter"),
    context: z
      .array(
        z.object({
          role: z.enum(["user", "assistant", "system", "tool"]),
          content: z.string(),
        })
      )
      .optional()
      .describe("Optional: conversation context to transfer"),
  }),
  handler: async (ctx: any, args: { targetAdapterName: string; taskDescription: string; context?: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }> }) => {
    await ensureDefaults();
    const handoffContext: HandoffContext = {
      userId: ctx.userId,
      parentThreadId: ctx.threadId,
      messages: args.context || [
        { role: "user", content: args.taskDescription },
      ],
      taskDescription: args.taskDescription,
      initiatedAt: Date.now(),
    };

    const result = await executeHandoff(
      "ConvexCoordinator", // Source is always the coordinator
      args.targetAdapterName,
      handoffContext
    );

    return JSON.stringify({
      success: result.success,
      handoffChain: result.handoffChain,
      result: result.result?.result,
      totalExecutionTimeMs: result.totalExecutionTimeMs,
      error: result.error,
    });
  },
});

/**
 * Tool to use Anthropic extended thinking for complex reasoning
 */
export const useExtendedThinking = createToolLoose({
  description: `Use Anthropic Claude with extended thinking for complex reasoning tasks.

Best for:
- Complex mathematical problems
- Multi-step logical reasoning
- Code analysis and debugging
- Strategic decision making`,
  args: z.object({
    problem: z.string().describe("The problem or question to reason through"),
    thinkingBudget: z
      .enum(["minimal", "moderate", "extensive", "maximum"])
      .optional()
      .describe("How much thinking budget to allocate (default: moderate)"),
  }),
  handler: async (ctx: any, args: { problem: string; thinkingBudget?: "minimal" | "moderate" | "extensive" | "maximum" }) => {
    await ensureDefaults();
    // Find Anthropic adapter
    const adapters = listAdaptersWithSDK();
    const anthropicAdapter = adapters.find((a) => a.sdk === "anthropic");

    if (!anthropicAdapter) {
      return JSON.stringify({
        success: false,
        error: "Anthropic adapter not registered. Use registerAdapter() first.",
      });
    }

    // Map thinking budget to token count
    const budgetTokens = {
      minimal: 2000,
      moderate: 8000,
      extensive: 16000,
      maximum: 32000,
    }[args.thinkingBudget || "moderate"];

    const input: AdapterInput = {
      query: args.problem,
      userId: ctx.userId,
      threadId: ctx.threadId,
      options: {
        thinkingBudget: budgetTokens,
      },
    };

    const result = await executeWithAdapter(anthropicAdapter.name, input);

    // Parse thinking result
    const thinkingResult = result.result as { thinking: string; answer: string } | null;

    return JSON.stringify({
      success: result.status === "success",
      thinking: thinkingResult?.thinking?.substring(0, 1000), // Truncate thinking
      answer: thinkingResult?.answer,
      executionTimeMs: result.executionTimeMs,
      tokenUsage: result.tokenUsage,
    });
  },
});

/**
 * Tool to create a triage flow with OpenAI Agents SDK
 */
export const createTriageFlow = createToolLoose({
  description: `Create and execute a triage flow using OpenAI Agents SDK.

The triage agent routes the query to the appropriate specialist based on content.

Best for:
- Customer support routing
- Multi-domain question handling
- Automatic categorization and delegation`,
  args: z.object({
    query: z.string().describe("The user query to triage"),
    availableSpecialists: z
      .array(z.string())
      .optional()
      .describe("List of specialist names to route to"),
  }),
  handler: async (ctx: any, args: { query: string; availableSpecialists?: string[] }) => {
    await ensureDefaults();
    // Find OpenAI adapter
    const adapters = listAdaptersWithSDK();
    const openaiAdapter = adapters.find((a) => a.sdk === "openai");

    if (!openaiAdapter) {
      return JSON.stringify({
        success: false,
        error: "OpenAI Agents adapter not registered. Use registerAdapter() first.",
      });
    }

    const input: AdapterInput = {
      query: args.query,
      userId: ctx.userId,
      threadId: ctx.threadId,
      options: {
        triage: true,
        specialists: args.availableSpecialists,
      },
    };

    const result = await executeWithAdapter(openaiAdapter.name, input);

    return JSON.stringify({
      success: result.status === "success",
      result: result.result,
      handoffTarget: result.handoffTarget,
      executionTimeMs: result.executionTimeMs,
    });
  },
});

/**
 * All multi-SDK delegation tools for export
 */
export const multiSdkTools = {
  delegateToSdkAdapter,
  autoRouteToSdk,
  listSdkAdapters,
  parallelSdkExecution,
  crossSdkHandoff,
  useExtendedThinking,
  createTriageFlow,
};
