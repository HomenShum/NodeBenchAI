import { createTool } from "@convex-dev/agent";
import { internal } from "../../../../_generated/api";
import { z } from "zod";

const DEFAULT_CONTEXT =
  "NodeBench AI Fast Agents external orchestrator: keep replies concise and tool-call friendly; respect provided plan/memory context.";

export const externalOrchestratorTool = createTool({
  description: "Call an external orchestrator (OpenAI or Gemini) for a subtask.",
  args: z.object({
    provider: z.enum(["openai", "gemini"]).describe("External orchestrator to use"),
    message: z.string().describe("Instruction or question for the external orchestrator"),
    sessionId: z.string().optional().describe("Optional session/thread id for the external provider"),
    model: z.string().optional().describe("Optional model override for the selected provider"),
    context: z
      .string()
      .optional()
      .describe("Override the MCP Context7 system context sent to the external orchestrator"),
  }),
  handler: async (ctx, args): Promise<{ text: string; provider: string; metadata?: any }> => {
    const result = await ctx.runAction(internal.actions.externalOrchestrator.runExternalOrchestrator, {
      provider: args.provider,
      message: args.message,
      sessionId: args.sessionId,
      model: args.model,
      context: args.context ?? DEFAULT_CONTEXT,
    });
    return result;
  },
});
