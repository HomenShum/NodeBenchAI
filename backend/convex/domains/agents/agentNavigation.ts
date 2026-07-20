import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";

/**
 * Agent Navigation — Allows agents to request UI view switches.
 *
 * The agent stores a navigation intent in the thread metadata.
 * The frontend watches via useQuery and switches views accordingly.
 * This enables "do everything from chat" — the agent says
 * "Let me open that document for you" and the UI responds.
 */

export const requestNavigation = mutation({
  args: {
    threadId: v.string(),
    targetView: v.string(),
    context: v.optional(v.any()),
    reason: v.optional(v.string()),
  },
  returns: v.object({
    navigationId: v.string(),
    targetView: v.string(),
  }),
  handler: async (ctx, args) => {
    const navigationId = `nav_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Store navigation intent
    const id = await ctx.db.insert("agentNavigationIntents", {
      navigationId,
      threadId: args.threadId,
      targetView: args.targetView,
      context: args.context,
      reason: args.reason,
      status: "pending",
      createdAt: Date.now(),
    });

    return { navigationId, targetView: args.targetView };
  },
});

export const getPendingNavigation = query({
  args: {
    threadId: v.string(),
  },
  returns: v.union(
    v.object({
      navigationId: v.string(),
      targetView: v.string(),
      context: v.any(),
      reason: v.optional(v.string()),
      createdAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const intent = await ctx.db
      .query("agentNavigationIntents")
      .filter((q) =>
        q.and(
          q.eq(q.field("threadId"), args.threadId),
          q.eq(q.field("status"), "pending")
        )
      )
      .order("desc")
      .first();

    if (!intent) return null;

    return {
      navigationId: intent.navigationId,
      targetView: intent.targetView,
      context: intent.context,
      reason: intent.reason,
      createdAt: intent.createdAt,
    };
  },
});

export const acknowledgeNavigation = mutation({
  args: {
    navigationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const intent = await ctx.db
      .query("agentNavigationIntents")
      .filter((q) => q.eq(q.field("navigationId"), args.navigationId))
      .first();

    if (intent) {
      await ctx.db.patch(intent._id, { status: "acknowledged" });
    }

    return null;
  },
});
