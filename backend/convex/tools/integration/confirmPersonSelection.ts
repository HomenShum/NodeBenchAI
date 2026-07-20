// convex/tools/confirmPersonSelection.ts
// Tool for confirming user's person selection after disambiguation

import { createTool } from "@convex-dev/agent";
import { z } from "zod/v3";
import { internal } from "../../_generated/api";

export const confirmPersonSelection = createTool({
  description: `Confirm the user's person selection after disambiguation.

Use this tool when the user has explicitly selected a person from multiple options.
This stores the confirmation so future queries about the same person don't require re-prompting.

Example usage:
- User query: "Find information about Michael Jordan"
- System shows multiple Michael Jordans
- User responds: "I confirm: Michael Jordan the basketball player"
- Call this tool to store the confirmation`,

  args: z.object({
    threadId: z.string().describe("The conversation thread ID"),
    personName: z.string().describe("The original person name from the user's query (e.g., 'Michael Jordan')"),
    id: z.string().describe("The unique identifier of the confirmed person"),
    name: z.string().describe("The full name of the confirmed person"),
    profession: z.string().optional().describe("The person's profession/occupation"),
    organization: z.string().optional().describe("The person's organization/company"),
    location: z.string().optional().describe("The person's location"),
  }),

  handler: async (ctx, args) => {
    // Store the confirmation
    await ctx.runMutation(internal.tools.integration.peopleProfileSearch.confirmPerson, {
      threadId: args.threadId,
      personName: args.personName,
      id: args.id,
      name: args.name,
      profession: args.profession,
      organization: args.organization,
      location: args.location,
    });

    return `✓ Confirmed: ${args.name}${args.profession ? ` (${args.profession})` : ''}${args.organization ? ` at ${args.organization}` : ''}

I'll remember this selection for future queries in this conversation.`;
  },
});

