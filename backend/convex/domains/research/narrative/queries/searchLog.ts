import { v } from "convex/values";
import { internalQuery } from "../../../../_generated/server";

/**
 * Fetch narrativeSearchLog rows for a given Newsroom workflow run.
 * Uses the `workflowId` written by the Newsroom pipeline.
 */
export const getSearchLogsByWorkflowId = internalQuery({
  args: {
    workflowId: v.string(),
    limit: v.optional(v.number()),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async (ctx, args) => {
    const q = ctx.db
      .query("narrativeSearchLog")
      .withIndex("by_workflow", (ix) => ix.eq("workflowId", args.workflowId));

    const ordered = (args.order ?? "desc") === "asc" ? q.order("asc") : q.order("desc");
    return await ordered.take(args.limit ?? 200);
  },
});

