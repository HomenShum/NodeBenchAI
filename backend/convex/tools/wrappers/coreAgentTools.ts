/**
 * Core Agent Tools - MCP-first wrappers
 *
 * These wrappers prefer the MCP core_agent_server (planning + memory), and
 * fall back to Convex-native mutations/queries if the MCP call fails.
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api } from "../../_generated/api";
import { callCoreAgentMcp } from "../../lib/mcpTransport";
import { MemoryEntry, PlanPayload, PlanStep, PlanStepStatus } from "../../domains/agents/types";

async function createPlanConvex(ctx: any, args: { goal: string; steps: PlanStep[] }) {
  const planId = await ctx.runMutation(api.domains.agents.agentPlanning.createPlan, {
    goal: args.goal,
    steps: args.steps.map((s) => ({
      description: s.step,
      status: s.status,
    })),
  });
  const plan = await ctx.runQuery(api.domains.agents.agentPlanning.getPlan, { planId });
  return {
    source: "convex" as const,
    planId: String(planId),
    goal: plan?.goal,
    steps: plan?.steps?.map((s: any) => ({ step: s.description, status: s.status })) ?? [],
    message: `Created plan with ${args.steps.length} steps`,
  };
}

async function updatePlanStepConvex(ctx: any, args: { planId: string; stepIndex: number; status: PlanStepStatus }) {
  await ctx.runMutation(api.domains.agents.agentPlanning.updatePlanStep, {
    planId: args.planId as any,
    stepIndex: args.stepIndex,
    status: args.status,
  });
  const plan = await ctx.runQuery(api.domains.agents.agentPlanning.getPlan, { planId: args.planId });
  return {
    source: "convex" as const,
    planId: args.planId,
    stepIndex: args.stepIndex,
    status: args.status,
    step: plan?.steps?.[args.stepIndex] ? {
      step: plan.steps[args.stepIndex].description,
      status: plan.steps[args.stepIndex].status,
    } : undefined,
    message: `Updated step ${args.stepIndex + 1}`,
  };
}

async function getPlanConvex(ctx: any, args: { planId: string }) {
  const plan = await ctx.runQuery(api.domains.agents.agentPlanning.getPlan, { planId: args.planId as any });
  if (!plan) {
    throw new Error(`Plan not found: ${args.planId}`);
  }
  return {
    source: "convex" as const,
    planId: args.planId,
    goal: plan.goal,
    steps: plan.steps.map((s: any) => ({ step: s.description, status: s.status })),
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

async function writeMemoryConvex(ctx: any, entry: MemoryEntry) {
  const id = await ctx.runMutation(api.domains.agents.agentMemory.writeMemory, {
    key: entry.key,
    content: entry.content,
    metadata: entry.metadata,
  });
  return { source: "convex" as const, key: entry.key, id: String(id) };
}

async function readMemoryConvex(ctx: any, key: string) {
  const entry = await ctx.runQuery(api.domains.agents.agentMemory.readMemory, { key });
  if (!entry) return { source: "convex" as const, entry: null };
  return {
    source: "convex" as const,
    entry: {
      key: entry.key,
      content: entry.content,
      metadata: entry.metadata ?? undefined,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    },
  };
}

async function listMemoryConvex(ctx: any) {
  const entries = await ctx.runQuery(api.domains.agents.agentMemory.listMemory, {});
  return {
    source: "convex" as const,
    entries: entries.map((e: any) => ({
      key: e.key,
      content: e.content,
      metadata: e.metadata ?? undefined,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    })),
  };
}

async function deleteMemoryConvex(ctx: any, key: string) {
  await ctx.runMutation(api.domains.agents.agentMemory.deleteMemory, { key });
  return { source: "convex" as const, deleted: true, key };
}

/**
 * Create an explicit task plan as a markdown document
 */
export const createPlan = createTool({
  description: `Create an explicit task plan as a markdown document with steps marked as pending/in_progress/completed.

Use this tool when:
- Starting a complex multi-step task
- User asks to plan something
- You need to break down a large goal into steps

The plan will be stored and can be updated as you progress.`,

  args: z.object({
    goal: z.string().describe("The overall goal or objective"),
    steps: z.array(z.object({
      description: z.string().describe("Description of the step"),
      status: z.enum(["pending", "in_progress", "completed"]).default("pending"),
    })).describe("List of steps to accomplish the goal"),
  }),

  handler: async (ctx, args): Promise<PlanPayload> => {
    const payload = {
      goal: args.goal,
      steps: args.steps.map((s) => ({
        step: s.description,
        status: s.status,
      })),
    };

    try {
      const { payload: res } = await callCoreAgentMcp(ctx, "createPlan", payload);
      const planId = res?.planId || res?.plan?.id;
      return {
        source: "mcp",
        planId: planId ?? "",
        goal: res?.plan?.goal ?? args.goal,
        steps: res?.plan?.steps ?? payload.steps,
        markdown: res?.markdown,
        message: res?.message,
      };
    } catch (err) {
      // Fallback to Convex-native plan storage
      return await createPlanConvex(ctx, payload);
    }
  },
});

/**
 * Update a step in an existing plan
 */
export const updatePlanStep = createTool({
  description: "Update the status of a step in an existing plan",

  args: z.object({
    planId: z.string().describe("The plan ID returned from createPlan"),
    stepIndex: z.number().describe("Index of the step to update (0-based)"),
    status: z.enum(["pending", "in_progress", "completed"]).describe("New status for the step"),
  }),

  handler: async (ctx, args): Promise<{
    source: "mcp" | "convex";
    planId: string;
    stepIndex: number;
    status: PlanStepStatus;
    step?: PlanStep;
    message?: string;
  }> => {
    const payload = {
      planId: args.planId,
      stepIndex: args.stepIndex,
      status: args.status,
    };
    try {
      const { payload: res } = await callCoreAgentMcp(ctx, "updatePlanStep", payload);
      const step = res?.step ?? res?.plan?.steps?.[args.stepIndex];
      return {
        source: "mcp",
        planId: args.planId,
        stepIndex: args.stepIndex,
        status: args.status,
        step,
        message: res?.message,
      };
    } catch (err) {
      return await updatePlanStepConvex(ctx, payload);
    }
  },
});

/**
 * Get an existing plan
 */
export const getPlan = createTool({
  description: "Retrieve an existing plan by ID",

  args: z.object({
    planId: z.string().describe("The plan ID to retrieve"),
  }),

  handler: async (ctx, args): Promise<{
    source: "mcp" | "convex";
    planId: string;
    goal?: string;
    steps?: PlanStep[];
    createdAt?: string | number;
    updatedAt?: string | number;
  }> => {
    try {
      const { payload: res } = await callCoreAgentMcp(ctx, "getPlan", { planId: args.planId });
      const plan = res?.plan ?? res;
      return {
        source: "mcp",
        planId: args.planId,
        goal: plan?.goal,
        steps: plan?.steps,
        createdAt: plan?.createdAt,
        updatedAt: plan?.updatedAt,
      };
    } catch (err) {
      return await getPlanConvex(ctx, { planId: args.planId });
    }
  },
});

/**
 * Write data to agent memory
 */
export const writeAgentMemory = (createTool as any)({
  description: `Store intermediate results or data for later retrieval. Use this to avoid context window overflow.

Use this tool when:
- You have intermediate results that might be needed later
- You want to save data between steps
- You need to store large amounts of data temporarily`,

  args: z.object({
    key: z.string().describe("Unique key for this memory entry"),
    content: z.string().describe("Content to store"),
    metadata: z.record(z.any()).optional().describe("Optional metadata"),
  }),

  handler: async (ctx: any, args: any): Promise<{ source: "mcp" | "convex"; key: string; id?: string }> => {
    try {
      const { payload: res } = await callCoreAgentMcp(ctx, "writeAgentMemory", args);
      return { source: "mcp", key: args.key, id: res?.id ?? res?.key ?? undefined };
    } catch (err) {
      return await writeMemoryConvex(ctx, {
        key: String(args?.key ?? ""),
        content: String(args?.content ?? ""),
        metadata: args?.metadata,
      });
    }
  },
});

/**
 * Read data from agent memory
 */
export const readAgentMemory = (createTool as any)({
  description: "Retrieve previously stored data from agent memory",

  args: z.object({
    key: z.string().describe("Key of the memory entry to retrieve"),
  }),

  handler: async (ctx: any, args: any): Promise<{ source: "mcp" | "convex"; entry: MemoryEntry | null }> => {
    try {
      const { payload: res } = await callCoreAgentMcp(ctx, "readAgentMemory", args);
      const entry = res?.entry ?? res;
      if (!entry) return { source: "mcp", entry: null };
      return {
        source: "mcp",
        entry: {
          key: entry.key,
          content: entry.content,
          metadata: entry.metadata,
        },
      };
    } catch (err) {
      return await readMemoryConvex(ctx, args.key);
    }
  },
});

/**
 * List all memory entries
 */
export const listAgentMemory = (createTool as any)({
  description: "List all stored memory entries with their keys and metadata",

  args: z.object({}),

  handler: async (ctx: any): Promise<{ source: "mcp" | "convex"; entries: MemoryEntry[] }> => {
    try {
      const { payload: res } = await callCoreAgentMcp(ctx, "listAgentMemory", {});
      const entries = res?.entries ?? res?.result ?? res ?? [];
      return {
        source: "mcp",
        entries: Array.isArray(entries) ? entries : [],
      };
    } catch (err) {
      return await listMemoryConvex(ctx);
    }
  },
} as any);

/**
 * Delete a memory entry
 */
export const deleteAgentMemory = (createTool as any)({
  description: "Delete a memory entry by key",

  args: z.object({
    key: z.string().describe("Key of the memory entry to delete"),
  }),

  handler: async (ctx: any, args: any): Promise<{ source: "mcp" | "convex"; deleted: boolean; key: string }> => {
    try {
      await callCoreAgentMcp(ctx, "deleteAgentMemory", args);
      return { source: "mcp", deleted: true, key: args.key };
    } catch (err) {
      return await deleteMemoryConvex(ctx, args.key);
    }
  },
} as any);
