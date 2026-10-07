/**
 * Agent Initializer - seeds plan/feature list and progress log for a thread.
 *
 * This implements the "Initializer Agent" pattern so every thread starts with
 * persistent domain memory (plan + progress) before streaming begins.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

type PlannerTask = { description: string; agent?: string };

function mapTasksToFeatures(tasks: PlannerTask[] | null, prompt: string) {
  if (!tasks || tasks.length === 0) {
    return [{
      name: prompt.slice(0, 120),
      status: "pending" as const,
      testCriteria: "Confirm the main user request is satisfied and observable (unit or end-to-end check).",
    }];
  }

  return tasks.map((t) => ({
    name: t.description,
    status: "pending" as const,
    testCriteria: `Verify completion of: ${t.description}`,
  }));
}

/**
 * Generate a plan for a thread.
 *
 * NOTE: This function is called from a MUTATION handler (V8 runtime) where
 * dynamic `import()` is unsupported. We use a lightweight heuristic plan
 * generator instead of importing the full fastAgentPanelStreaming module.
 * The actual LLM-based planning happens later during the streaming action.
 */
function generatePlanForThread(_ctx: any, prompt: string, _model?: string): { mode: string; tasks: PlannerTask[]; raw: string } {
  // Heuristic: break prompt into sentences and treat each as a task
  const sentences = prompt
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  if (sentences.length <= 1) {
    // Simple single-task request
    return {
      mode: "simple",
      tasks: [{ description: prompt.slice(0, 200) }],
      raw: prompt,
    };
  }

  // Multi-sentence → treat as multiple tasks
  const tasks = sentences.slice(0, 5).map((s) => ({
    description: s.slice(0, 200),
  }));

  return {
    mode: "complex",
    tasks,
    raw: prompt,
  };
}

/**
 * Initialize a thread with a persistent plan + progress log.
 */
export const initializeThread = (mutation as any)({
  args: {
    threadId: v.id("chatThreadsStream"),
    prompt: v.string(),
    model: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any): Promise<{ planId: any; features: any[] }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Fetch streaming thread and linked agentThreadId
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.userId !== userId) {
      throw new Error("Thread not found or unauthorized");
    }
    const agentThreadId = thread.agentThreadId;
    if (!agentThreadId) {
      throw new Error("Thread missing agentThreadId");
    }

    // If plan already exists, return it
    const existing = await ctx.db
      .query("agentPlans")
      .withIndex("by_agent_thread", (q: any) => q.eq("agentThreadId", agentThreadId))
      .first();
    if (existing) {
      return { planId: existing._id, features: existing.features ?? [] };
    }

    // Generate plan via planner agent
    const planResult = generatePlanForThread(ctx, args.prompt, args.model ?? undefined);
    const features = mapTasksToFeatures(planResult.tasks, args.prompt);

    const now = Date.now();
    const planId = await ctx.db.insert("agentPlans", {
      userId,
      agentThreadId,
      goal: args.prompt,
      steps: (planResult.tasks ?? []).map((t: PlannerTask) => ({
        description: t.description,
        status: "pending" as const,
      })),
      features,
      progressLog: [{
        ts: now,
        status: "info" as const,
        message: "Initializer seeded plan and feature list",
        meta: { mode: planResult.mode },
      }],
      createdAt: now,
      updatedAt: now,
    });

    return { planId, features };
  },
});

/**
 * Fetch plan by agentThreadId (for boot-up ritual).
 */
export const getPlanByThread = (query as any)({
  args: { agentThreadId: v.string() },
  handler: async (ctx: any, args: any): Promise<any> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const plan = await ctx.db
      .query("agentPlans")
      .withIndex("by_agent_thread", (q: any) => q.eq("agentThreadId", args.agentThreadId))
      .first();

    if (!plan || plan.userId !== userId) return null;
    return plan;
  },
});
