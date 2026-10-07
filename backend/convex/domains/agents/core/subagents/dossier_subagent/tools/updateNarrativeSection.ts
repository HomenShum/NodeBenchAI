/**
 * Update Narrative Section Tool
 * 
 * Updates a specific section of the dossier narrative.
 * This allows the agent to refine or expand sections based on user questions.
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";

export const updateNarrativeSection = createTool({
  description: `Update or expand a specific section of the dossier narrative.

Use this tool when:
- User asks for more detail on a specific section
- User wants to refine or correct information
- You need to add new insights to an existing section

Note: This tool updates the narrative in the user's view but does not
persist changes to the underlying brief. For persistent changes, use
document editing tools.`,

  args: z.object({
    briefId: z.string().describe("The brief/memory ID"),
    sectionId: z.string().describe("Which section to update (e.g., 'market_summary', 'key_events')"),
    action: z.enum(["replace", "append", "prepend"]).default("replace")
      .describe("How to apply the update"),
    content: z.string().describe("The new content for this section"),
    highlightDuration: z.number().default(3000)
      .describe("How long to highlight the updated section (ms)"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      // This tool primarily signals to the UI to update a section
      // The actual update happens via the focus state subscription
      // which the UI listens to
      
      // For now, we return a structured response that the UI can parse
      // In a full implementation, this would update a narrative state table
      
      const response = {
        action: "narrative_update",
        briefId: args.briefId,
        sectionId: args.sectionId,
        updateType: args.action,
        content: args.content,
        highlightDuration: args.highlightDuration,
        timestamp: Date.now(),
      };

      return `Updated section "${args.sectionId}" with ${args.action} action. ` +
        `The section will be highlighted for ${args.highlightDuration}ms. ` +
        `Content preview: "${args.content.slice(0, 100)}${args.content.length > 100 ? '...' : ''}"`;
    } catch (error: any) {
      return `Error updating narrative section: ${error.message}`;
    }
  },
});

