import { v } from "convex/values";
import { query, internalMutation } from "../../_generated/server";

export const getStrategyMetrics = query({
  args: {
    signalKey: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("strategyMetricsCache")
      .withIndex("by_signal_key", (q) => q.eq("signalKey", args.signalKey))
      .first();
  },
});

export const insertStrategyMetrics = internalMutation({
  args: {
    record: v.any(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("strategyMetricsCache", args.record);
  },
});

export const patchStrategyMetrics = internalMutation({
  args: {
    id: v.id("strategyMetricsCache"),
    updates: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, args.updates);
  },
});
