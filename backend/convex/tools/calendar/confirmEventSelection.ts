// convex/tools/confirmEventSelection.ts
// Tool for confirming user's event selection after disambiguation

import { createTool } from "@convex-dev/agent";
import { z } from "zod/v3";
import { internal } from "../../_generated/api";

export const confirmEventSelection = createTool({
  description: `Confirm the user's event selection after disambiguation.

Use this tool when the user has explicitly selected an event from multiple options.
This stores the confirmation so future queries about the same event don't require re-prompting.

Example usage:
- User query: "What happened at the Apple Event?"
- System shows multiple Apple events
- User responds: "I confirm: Apple iPhone 16 Launch Event"
- Call this tool to store the confirmation`,

  args: z.object({
    threadId: z.string().describe("The conversation thread ID"),
    eventQuery: z.string().describe("The original event query from the user (e.g., 'Apple Event')"),
    id: z.string().describe("The unique identifier of the confirmed event"),
    name: z.string().describe("The full name of the confirmed event"),
    date: z.string().optional().describe("The event date"),
    location: z.string().optional().describe("The event location"),
    description: z.string().optional().describe("The event description"),
  }),

  handler: async (ctx, args) => {
    // Store the confirmation
    await ctx.runMutation(internal.tools.calendar.recentEventSearch.confirmEvent, {
      threadId: args.threadId,
      eventQuery: args.eventQuery,
      id: args.id,
      name: args.name,
      date: args.date,
      location: args.location,
      description: args.description,
    });

    return `✓ Confirmed: ${args.name}${args.date ? ` (${args.date})` : ''}${args.location ? ` at ${args.location}` : ''}

I'll remember this selection for future queries in this conversation.`;
  },
});

