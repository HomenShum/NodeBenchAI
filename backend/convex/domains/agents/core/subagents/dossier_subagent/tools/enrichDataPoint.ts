/**
 * Enrich Data Point Tool
 * 
 * Fetches additional context for a specific data point and caches it.
 * This is used when user hovers or clicks on a data point that doesn't
 * have existing enrichment.
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../../../../../../_generated/api";

export const enrichDataPoint = createTool({
  description: `Fetch and cache additional context for a specific data point.

Use this tool when:
- User clicks on a data point and asks "what happened here?"
- User wants more details about a specific event/date
- You need to provide context that isn't in the existing brief

This tool caches the enrichment so subsequent requests are instant.
Include relevant entities (companies, people, events) and source URLs.`,

  args: z.object({
    briefId: z.string().describe("The brief/memory ID"),
    dataIndex: z.number().describe("Which data point to enrich (0-indexed)"),
    title: z.string().describe("Short title for the enrichment (e.g., 'Fed Rate Decision')"),
    context: z.string().describe("Detailed context explaining this data point (1-3 paragraphs)"),
    entities: z.array(z.object({
      name: z.string().describe("Entity name"),
      type: z.string().describe("Entity type (company, person, event, metric)"),
      url: z.string().optional().describe("Link to more info"),
    })).optional().describe("Related entities to highlight"),
    sources: z.array(z.object({
      url: z.string().describe("Source URL"),
      title: z.string().optional().describe("Source title"),
    })).optional().describe("Source URLs for citations"),
    seriesId: z.string().optional().describe("Which series this enrichment is for"),
    agentThreadId: z.string().optional().describe("Thread ID for provenance"),
    cacheDurationHours: z.number().default(24).describe("How long to cache this enrichment"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      const userId = (ctx as any).userId;
      if (!userId) {
        return "Error: No user context available. Cannot create enrichment.";
      }

      const now = Date.now();
      const expiresAt = now + (args.cacheDurationHours * 60 * 60 * 1000);

      // Add retrievedAt to sources
      const sourcesWithTimestamp = args.sources?.map(s => ({
        ...s,
        retrievedAt: now,
      }));

      const enrichmentId = await ctx.runMutation(
        internal.domains.dossier.enrichment.addEnrichmentInternal,
        {
          userId,
          briefId: args.briefId,
          dataIndex: args.dataIndex,
          title: args.title,
          context: args.context,
          entities: args.entities,
          sources: sourcesWithTimestamp,
          seriesId: args.seriesId,
          agentThreadId: args.agentThreadId,
          expiresAt,
        }
      );

      const entityCount = args.entities?.length || 0;
      const sourceCount = args.sources?.length || 0;

      return `Enriched data point ${args.dataIndex} with "${args.title}". ` +
        `Added ${entityCount} entities and ${sourceCount} sources. ` +
        `Cached for ${args.cacheDurationHours} hours.`;
    } catch (error: any) {
      return `Error enriching data point: ${error.message}`;
    }
  },
});

