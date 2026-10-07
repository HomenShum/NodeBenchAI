/**
 * Resource Link Tools - wrappers for retrieving excerpts from stored artifacts.
 *
 * These are the "R" in store → index → retrieve. They keep retrieval bounded by a
 * token budget and emit citation anchors like {{cite:artifactId:chunkId}}.
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api } from "../../_generated/api";

export const retrieveArtifact = createTool({
  description:
    "Retrieve relevant excerpts from a stored sourceArtifact (often referenced by a resource_link) using a query and a token budget.",
  args: z.object({
    artifactId: z.string().describe("sourceArtifacts ID"),
    query: z.string().describe("What to find in the artifact"),
    budget: z.number().optional().describe("Token budget for excerpts (default 2000, max 8000)"),
    resourceId: z.string().optional().describe("Optional resourceLinks ID to attribute access"),
  }),
  handler: async (ctx, args) => {
    return await ctx.runAction(api.tools.context.retrieveArtifact.retrieveArtifact, {
      artifactId: args.artifactId as any,
      query: args.query,
      budget: args.budget,
      resourceId: args.resourceId as any,
    });
  },
});

export const retrieveFullArtifact = createTool({
  description:
    "Retrieve full raw content from a stored sourceArtifact (bounded/truncated to fit a token budget). Use sparingly; prefer retrieveArtifact for targeted excerpts.",
  args: z.object({
    artifactId: z.string().describe("sourceArtifacts ID"),
    budget: z.number().optional().describe("Token budget for full content (default 2000, max 8000)"),
  }),
  handler: async (ctx, args) => {
    return await ctx.runAction(api.tools.context.retrieveArtifact.retrieveFullArtifact, {
      artifactId: args.artifactId as any,
      budget: args.budget,
    });
  },
});

export const retrieveMultipleArtifacts = createTool({
  description:
    "Batch retrieve relevant excerpts from multiple sourceArtifacts using a shared total token budget.",
  args: z.object({
    artifactIds: z.array(z.string()).describe("List of sourceArtifacts IDs"),
    query: z.string().describe("What to find across the artifacts"),
    totalBudget: z.number().optional().describe("Total token budget across all artifacts"),
  }),
  handler: async (ctx, args) => {
    return await ctx.runAction(api.tools.context.retrieveArtifact.retrieveMultipleArtifacts, {
      artifactIds: args.artifactIds as any,
      query: args.query,
      totalBudget: args.totalBudget,
    });
  },
});

