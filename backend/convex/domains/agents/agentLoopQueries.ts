/**
 * Agent Loop Queries — database queries for the perpetual agent loop.
 * Separated from agentLoop.ts because "use node" files cannot export queries.
 */

import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";

/** Get dispatched events assigned to an agent that haven't been processed yet. */
export const getDispatchedEventsForAgent = internalQuery({
  args: {
    agentId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    return await ctx.db
      .query("proactiveEvents")
      .withIndex("by_dispatched", (q) =>
        q.eq("dispatchedToAgentId", args.agentId)
      )
      .order("desc")
      .take(limit);
  },
});
