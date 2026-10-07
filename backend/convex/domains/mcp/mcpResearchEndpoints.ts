/**
 * MCP-safe research endpoints.
 * Internal action wrappers for MCP gateway dispatch.
 *
 * Note: getEntityInsights already handles null userId gracefully
 * (line ~1104: "userId can be null for anonymous users").
 * This wrapper exists for consistency with the dispatcher pattern.
 */
"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { api } from "../../_generated/api";

export const mcpGetEntityInsights = internalAction({
  args: {
    userId: v.string(),
    entityName: v.string(),
    entityType: v.optional(
      v.union(v.literal("company"), v.literal("person"))
    ),
    forceRefresh: v.optional(v.boolean()),
  },
  handler: async (ctx, { entityName, entityType, forceRefresh }) => {
    return await ctx.runAction(
      api.domains.knowledge.entityInsights.getEntityInsights,
      {
        entityName,
        entityType: entityType ?? "company",
        forceRefresh,
      }
    );
  },
});
