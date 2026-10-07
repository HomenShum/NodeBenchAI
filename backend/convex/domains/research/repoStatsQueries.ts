import { v } from "convex/values";
import { query, internalMutation } from "../../_generated/server";

export const getRepoStats = query({
  args: {
    repoFullName: v.optional(v.string()),
    repoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.repoFullName && !args.repoUrl) return null;

    if (args.repoFullName) {
      return await ctx.db
        .query("repoStatsCache")
        .withIndex("by_repo", (q) => q.eq("repoFullName", args.repoFullName))
        .first();
    }

    return await ctx.db
      .query("repoStatsCache")
      .withIndex("by_repo_url", (q) => q.eq("repoUrl", args.repoUrl))
      .first();
  },
});

export const insertRepoStats = internalMutation({
  args: {
    record: v.any(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("repoStatsCache", args.record);
  },
});

export const patchRepoStats = internalMutation({
  args: {
    id: v.id("repoStatsCache"),
    updates: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, args.updates);
  },
});
