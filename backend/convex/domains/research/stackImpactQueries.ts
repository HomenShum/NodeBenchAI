import { v } from "convex/values";
import { query, internalMutation } from "../../_generated/server";

export const getStackImpact = query({
  args: {
    signalKey: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("stackImpactCache")
      .withIndex("by_signal_key", (q) => q.eq("signalKey", args.signalKey))
      .first();
  },
});

export const insertStackImpact = internalMutation({
  args: { record: v.any() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("stackImpactCache", args.record);
  },
});

export const patchStackImpact = internalMutation({
  args: { id: v.id("stackImpactCache"), updates: v.any() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, args.updates);
  },
});
