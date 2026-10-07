import { v } from "convex/values";
import { query, internalMutation } from "../../_generated/server";

export const getModelComparison = query({
  args: {
    modelKey: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("modelComparisonCache")
      .withIndex("by_model_key", (q) => q.eq("modelKey", args.modelKey))
      .first();
  },
});

export const insertModelComparison = internalMutation({
  args: { record: v.any() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("modelComparisonCache", args.record);
  },
});

export const patchModelComparison = internalMutation({
  args: { id: v.id("modelComparisonCache"), updates: v.any() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, args.updates);
  },
});
