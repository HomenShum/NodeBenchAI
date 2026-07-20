import { v } from "convex/values";
import { query, internalMutation } from "../../_generated/server";
import { Doc } from "../../_generated/dataModel";

export const getRepoScout = query({
  args: {
    signalKey: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("repoScoutCache")
      .withIndex("by_signal_key", (q) => q.eq("signalKey", args.signalKey))
      .first() as Doc<"repoScoutCache"> | null;
  },
});

export const insertRepoScout = internalMutation({
  args: {
    record: v.any(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("repoScoutCache", args.record);
  },
});

export const patchRepoScout = internalMutation({
  args: {
    id: v.id("repoScoutCache"),
    updates: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, args.updates);
  },
});
