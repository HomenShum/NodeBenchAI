import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { api } from "../_generated/api";

export const runEmailIntelligenceSweep = internalAction({
  args: {
    maxEmails: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const parsed: any = await ctx.runAction(
      api.tools.email.emailIntelligenceParser.parseEmailForIntelligenceAction,
      {
        maxEmails: args.maxEmails ?? 10,
        unreadOnly: true,
      }
    );

    if (!parsed.success || !parsed.emails) {
      return { success: false, processed: 0, error: parsed.error };
    }

    for (const email of parsed.emails) {
      try {
        await ctx.runAction(api.workflows.emailResearchOrchestrator.orchestrateEmailResearch, {
          email,
          deliverEmail: false,
        });
      } catch (err) {
        console.warn("[emailIntelligenceCron] failed to orchestrate email", err);
      }
    }

    return { success: true, processed: parsed.emails.length };
  },
});
