/**
 * Generate Annotation Tool
 * 
 * Creates a text annotation for a specific data point on the chart.
 * Annotations appear as labels near data points and can be configured
 * to show/hide based on the current act.
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../../../../../../_generated/api";

export const generateAnnotation = createTool({
  description: `Add a text annotation to a specific data point on the chart.

Use this tool when:
- User asks "what happened here?" about a data point
- You want to label a significant event (peak, trough, inflection)
- User asks to annotate or mark a point

The annotation will appear as a label near the data point. You can control:
- Position (above/below/left/right of the point)
- Which acts it's visible in (for progressive disclosure)
- Optional icon for visual emphasis`,

  args: z.object({
    briefId: z.string().describe("The brief/memory ID"),
    dataIndex: z.number().describe("Which data point to annotate (0-indexed)"),
    text: z.string().describe("The annotation text (keep concise, 2-8 words ideal)"),
    position: z.enum(["above", "below", "left", "right"]).default("above")
      .describe("Where to place the annotation relative to the point"),
    visibleInActs: z.array(z.enum(["actI", "actII", "actIII"])).default(["actI", "actII", "actIII"])
      .describe("Which acts this annotation should be visible in"),
    icon: z.string().optional().describe("Optional emoji or icon (e.g., '📈', '⚠️', '🎯')"),
    seriesId: z.string().optional().describe("Which series this annotation belongs to"),
    agentThreadId: z.string().optional().describe("Thread ID for provenance tracking"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      const userId = (ctx as any).userId;
      if (!userId) {
        return "Error: No user context available. Cannot create annotation.";
      }

      const annotationId = await ctx.runMutation(
        internal.domains.dossier.annotations.addAnnotationInternal,
        {
          userId,
          briefId: args.briefId,
          dataIndex: args.dataIndex,
          text: args.text,
          position: args.position,
          visibleInActs: args.visibleInActs,
          icon: args.icon,
          seriesId: args.seriesId,
          agentThreadId: args.agentThreadId,
          source: "agent",
        }
      );

      const iconText = args.icon ? ` with icon ${args.icon}` : "";
      const actsText = args.visibleInActs.length < 3 
        ? ` (visible in ${args.visibleInActs.join(", ")})`
        : "";

      return `Created annotation "${args.text}" at data point ${args.dataIndex}${iconText}${actsText}. The chart will update to show this label.`;
    } catch (error: any) {
      return `Error creating annotation: ${error.message}`;
    }
  },
});

