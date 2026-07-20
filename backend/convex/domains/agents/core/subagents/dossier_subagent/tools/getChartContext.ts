/**
 * Get Chart Context Tool
 *
 * Reads current chart state and data point information for the dossier.
 * Used when agent needs to understand what the user is looking at.
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../../../../../../_generated/api";

export const getChartContext = createTool({
  description: `Get context about the current chart or data point being viewed.

Use this tool when:
- User asks about "this data point" or "this spike"
- You need to understand what chart/section the user is viewing
- You want to get data values for a specific point

Returns chart series info, data values, current act, and any existing annotations.`,

  args: z.object({
    briefId: z.string().describe("The brief/memory ID to get context for"),
    dataIndex: z.number().optional().describe("Specific data point index to get details for"),
    seriesId: z.string().optional().describe("Specific series ID to focus on"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      // Get userId from context
      const userId = (ctx as any).userId;
      if (!userId) {
        return "Error: No user context available. Cannot get chart context.";
      }

      // Get focus state to understand what user is viewing
      const focusState = await ctx.runQuery(
        internal.domains.dossier.focusState.getFocusStateInternal,
        { userId, briefId: args.briefId }
      );

      // Get any existing annotations for context
      const annotations = await ctx.runQuery(
        internal.domains.dossier.annotations.getAnnotationsInternal,
        {
          userId,
          briefId: args.briefId,
          seriesId: args.seriesId,
        }
      );

      // Get existing enrichment if dataIndex specified
      let enrichment = null;
      if (args.dataIndex !== undefined) {
        enrichment = await ctx.runQuery(
          internal.domains.dossier.enrichment.getEnrichmentInternal,
          {
            userId,
            briefId: args.briefId,
            dataIndex: args.dataIndex,
          }
        );
      }

      const enrichmentData: any = enrichment;

      // Build context response
      const response = {
        briefId: args.briefId,
        focusState: focusState ? {
          currentAct: focusState.currentAct || "actI",
          focusedDataIndex: focusState.focusedDataIndex,
          hoveredSpanId: focusState.hoveredSpanId,
          activeSectionId: focusState.activeSectionId,
          focusedSeriesId: focusState.focusedSeriesId,
        } : {
          currentAct: "actI",
          focusedDataIndex: null,
          hoveredSpanId: null,
        },
        annotationCount: annotations.length,
        annotations: annotations.slice(0, 5).map((a: { dataIndex: number; text: string; position: string }) => ({
          dataIndex: a.dataIndex,
          text: a.text,
          position: a.position,
        })),
        existingEnrichment: enrichment ? {
          title: enrichmentData?.title,
          hasContext: !!enrichmentData?.context,
          entityCount: enrichmentData?.entities?.length || 0,
          sourceCount: enrichmentData?.sources?.length || 0,
        } : null,
      };

      return JSON.stringify(response, null, 2);
    } catch (error: any) {
      return `Error getting chart context: ${error.message}`;
    }
  },
});
