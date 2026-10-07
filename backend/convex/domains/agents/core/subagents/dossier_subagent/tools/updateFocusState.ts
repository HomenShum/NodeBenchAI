/**
 * Update Focus State Tool
 * 
 * Updates the focus state to highlight a specific data point or section.
 * This triggers real-time updates in both the dossier view and Fast Agent Panel.
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../../../../../../_generated/api";

export const updateFocusState = createTool({
  description: `Highlight a specific data point or section in the dossier view.

Use this tool when:
- User says "highlight the peak" or "show me point 5"
- User asks to focus on a specific data point
- You want to direct user's attention to a specific area

This updates the chart highlighting in real-time - the user will see the point highlighted immediately.`,

  args: z.object({
    briefId: z.string().describe("The brief/memory ID"),
    focusedDataIndex: z.number().optional().describe("Data point index to highlight on the chart"),
    activeSectionId: z.string().optional().describe("Section ID to scroll to/highlight"),
    focusedSeriesId: z.string().optional().describe("Which chart series to focus"),
    currentAct: z.enum(["actI", "actII", "actIII"]).optional().describe("Which act to switch to"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      // Get userId from context - agent context should have this
      const userId = (ctx as any).userId;
      if (!userId) {
        return "Error: No user context available. Cannot update focus state.";
      }

      await ctx.runMutation(
        internal.domains.dossier.focusState.updateFocusInternal,
        {
          userId,
          briefId: args.briefId,
          focusedDataIndex: args.focusedDataIndex,
          activeSectionId: args.activeSectionId,
          focusedSeriesId: args.focusedSeriesId,
        }
      );

      // Build confirmation message
      const actions: string[] = [];
      if (args.focusedDataIndex !== undefined) {
        actions.push(`highlighted data point ${args.focusedDataIndex}`);
      }
      if (args.activeSectionId) {
        actions.push(`focused on section "${args.activeSectionId}"`);
      }
      if (args.focusedSeriesId) {
        actions.push(`selected series "${args.focusedSeriesId}"`);
      }
      if (args.currentAct) {
        actions.push(`switched to ${args.currentAct}`);
      }

      const message = actions.length > 0 
        ? `Successfully ${actions.join(", ")}. The dossier view has been updated.`
        : "Focus state updated successfully.";

      return message;
    } catch (error: any) {
      return `Error updating focus state: ${error.message}`;
    }
  },
});

