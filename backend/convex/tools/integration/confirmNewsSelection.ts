// convex/tools/confirmNewsSelection.ts
// Tool for confirming user's news article selection after disambiguation

import { createTool } from "@convex-dev/agent";
import { z } from "zod/v3";
import { internal } from "../../_generated/api";

export const confirmNewsSelection = createTool({
  description: `Confirm the user's news article selection after disambiguation.

Use this tool when the user has explicitly selected a news article from multiple options.
This stores the confirmation so future queries about the same topic don't require re-prompting.

Example usage:
- User query: "Show me recent Tesla news"
- System shows multiple Tesla articles
- User responds: "I confirm: Tesla Reports Record Q4 2024 Earnings"
- Call this tool to store the confirmation`,

  args: z.object({
    threadId: z.string().describe("The conversation thread ID"),
    newsQuery: z.string().describe("The original news query from the user (e.g., 'Tesla news')"),
    id: z.string().describe("The unique identifier of the confirmed article"),
    headline: z.string().describe("The headline of the confirmed article"),
    source: z.string().optional().describe("The news source"),
    date: z.string().optional().describe("The publication date"),
    url: z.string().optional().describe("The article URL"),
  }),

  handler: async (ctx, args) => {
    // Store the confirmation
    await ctx.runMutation(internal.tools.media.recentNewsSearch.confirmNewsTopic, {
      threadId: args.threadId,
      newsQuery: args.newsQuery,
      id: args.id,
      headline: args.headline,
      source: args.source,
      date: args.date,
      url: args.url,
    });

    return `✓ Confirmed: ${args.headline}${args.source ? ` (${args.source})` : ''}${args.date ? ` - ${args.date}` : ''}

I'll remember this selection for future queries in this conversation.`;
  },
});

