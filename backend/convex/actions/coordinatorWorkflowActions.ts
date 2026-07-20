"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * Enqueue a durable coordinator workflow run.
 */
export const startCoordinatorWorkflow = action({
  args: {
    threadId: v.string(),
    prompt: v.string(),
    model: v.optional(v.string()),
  },
  returns: v.object({
    runId: v.string(),
  }),
  handler: async (ctx, args): Promise<{ runId: string }> => {
    const runId = await ctx.scheduler.runAfter(
      0,
       
      (internal as any).workflows.coordinatorWorkflow.runCoordinatorWorkflow.start,
      {
        threadId: args.threadId,
        prompt: args.prompt,
        model: args.model ?? undefined,
      }
    );
    return { runId: String(runId) };
  },
});
