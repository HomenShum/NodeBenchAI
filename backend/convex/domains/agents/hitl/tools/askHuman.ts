/**
 * Ask Human Tool
 * 
 * Tool for requesting human input/approval during agent execution
 */

import { z } from "zod";
import type { ActionCtx } from "../../../../_generated/server";
import { api } from "../../../../_generated/api";

// Schema for askHuman tool
export const askHumanSchema = z.object({
  question: z.string().describe("The question to ask the human"),
  context: z.string().optional().describe("Additional context for the question"),
  options: z.array(z.string()).optional().describe("Optional list of choices"),
  requiresApproval: z.boolean().optional().describe("If true, this is an approval request"),
  toolName: z.string().optional().describe("Tool name if requesting approval for a tool call"),
  toolArgs: z.record(z.any()).optional().describe("Tool arguments if requesting approval"),
});

export type AskHumanInput = z.infer<typeof askHumanSchema>;

/**
 * Execute askHuman - creates an interrupt and waits for human response
 */
export async function executeAskHuman(
  ctx: ActionCtx,
  args: AskHumanInput,
  threadId: string
): Promise<{
  success: boolean;
  response?: string;
  decision?: string;
  interruptId?: string;
  message: string;
}> {
  console.log(`[askHuman] Question: ${args.question}`);
  
  try {
    // Create interrupt request
    const description = args.requiresApproval 
      ? `Tool approval required: ${args.toolName}\nArgs: ${JSON.stringify(args.toolArgs)}\n\n${args.question}`
      : args.question;

    const interruptId = await ctx.runMutation(api.domains.agents.hitl.interruptManager.createInterrupt, {
      threadId,
      toolName: args.toolName || "askHuman",
      arguments: args.toolArgs || { question: args.question },
      description,
      allowedDecisions: args.requiresApproval 
        ? ["approve", "reject"] 
        : ["approve"], // For questions, just need acknowledgment
    });

    return {
      success: true,
      interruptId: interruptId as string,
      message: `Waiting for human response. Interrupt ID: ${interruptId}`,
    };
  } catch (error: any) {
    console.error(`[askHuman] Error:`, error);
    return {
      success: false,
      message: `Failed to create interrupt: ${error.message}`,
    };
  }
}

// Tool definition for AI SDK
export const askHumanToolDefinition = {
  description: `Ask the human user a question or request approval for an action.
Use this when:
- You need clarification from the user
- You need approval for a sensitive operation (delete, bulk update)
- You want to confirm before proceeding with an action`,
  inputSchema: askHumanSchema,
  // Note: execute function needs threadId passed in at runtime
};
