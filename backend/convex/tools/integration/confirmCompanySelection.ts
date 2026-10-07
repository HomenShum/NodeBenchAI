// convex/tools/confirmCompanySelection.ts
// Tool for confirming user's company selection after disambiguation

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../../_generated/api";

/**
 * Confirm a company selection after disambiguation
 * This tool is called when the user selects a company from the disambiguation prompt
 */
export const confirmCompanySelection = createTool({
  description: "Confirm the user's company selection after disambiguation. Use this when the user has selected a specific company from multiple options. This stores the selection so future queries in the same conversation don't require re-prompting.",
  
  args: z.object({
    threadId: z.string().describe("Thread ID for the conversation"),
    companyName: z.string().describe("Original company name the user searched for"),
    cik: z.string().describe("CIK of the selected company"),
    name: z.string().describe("Full legal name of the selected company"),
    ticker: z.string().optional().describe("Ticker symbol of the selected company"),
  }),
  
  handler: async (ctx, args): Promise<string> => {
    console.log(`[confirmCompanySelection] Confirming selection: ${args.name} (CIK: ${args.cik})`);

    try {
      await ctx.runMutation(internal.tools.sec.secCompanySearch.confirmCompany, {
        threadId: args.threadId,
        companyName: args.companyName,
        cik: args.cik,
        name: args.name,
        ticker: args.ticker,
      });

      return `✓ Confirmed: ${args.name}${args.ticker ? ` (${args.ticker})` : ''}. I'll use this company for future SEC filing queries in this conversation.`;

    } catch (error) {
      console.error("[confirmCompanySelection] Error:", error);
      return `Failed to confirm company selection: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

