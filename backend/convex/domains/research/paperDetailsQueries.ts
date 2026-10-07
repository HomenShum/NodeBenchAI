import { v } from "convex/values";
import { query, internalMutation } from "../../_generated/server";

export const getPaperDetails = query({
  args: {
    paperId: v.optional(v.string()),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.paperId && !args.url) return null;
    if (args.paperId) {
      return await ctx.db
        .query("paperDetailsCache")
        .withIndex("by_paper_id", (q) => q.eq("paperId", args.paperId))
        .first();
    }
    return await ctx.db
      .query("paperDetailsCache")
      .withIndex("by_url", (q) => q.eq("url", args.url))
      .first();
  },
});

export const insertPaperDetails = internalMutation({
  args: {
    record: v.any(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("paperDetailsCache", args.record);
  },
});

export const patchPaperDetails = internalMutation({
  args: {
    id: v.id("paperDetailsCache"),
    updates: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, args.updates);
  },
});
