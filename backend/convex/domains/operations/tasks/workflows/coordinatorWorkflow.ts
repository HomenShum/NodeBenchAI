import { WorkflowManager } from "@convex-dev/workflow";
import { components, internal } from "../../../../_generated/api";
import { v } from "convex/values";

const workflowManager = new WorkflowManager(components.workflow);

/**
 * Run a coordinator agent inside a durable workflow.
 * This workflow can survive server restarts and has automatic retries.
 */
export const runCoordinatorWorkflow = workflowManager.define({
  args: {
    threadId: v.string(),
    prompt: v.string(),
    model: v.optional(v.string()),
  },
  handler: async (step, args): Promise<{ text: string; messageId?: string; toolCalls?: any }> => {
    // Run the coordinator agent as a durable action step
    const result = await step.runAction(
      internal.domains.agents.core.coordinatorAgent.runCoordinatorAgent,
      {
        threadId: args.threadId,
        prompt: args.prompt,
      },
      {
        retry: {
          maxAttempts: 3,
          initialBackoffMs: 1000,
          base: 2, // Exponential backoff: 1s, 2s, 4s
        }
      }
    );

    return result;
  },
});
