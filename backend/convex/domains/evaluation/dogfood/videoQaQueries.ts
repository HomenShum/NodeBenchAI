import { v } from "convex/values";
import { internalQuery, query } from "../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const listMyDogfoodQaRuns = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
    return await ctx.db
      .query("dogfoodQaRuns")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
  },
});

export const getDogfoodQaTrending = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const cutoff = Date.now() - (args.days ?? 14) * 86_400_000;
    const runs = await ctx.db
      .query("dogfoodQaRuns")
      .withIndex("by_user_createdAt", (q) =>
        q.eq("userId", userId).gte("createdAt", cutoff),
      )
      .order("asc")
      .collect();

    return runs.map((run) => ({
      date: new Date(run.createdAt).toISOString().slice(0, 10),
      createdAt: run.createdAt,
      source: run.source,
      p0: run.issues.filter((i) => i.severity === "p0").length,
      p1: run.issues.filter((i) => i.severity === "p1").length,
      p2: run.issues.filter((i) => i.severity === "p2").length,
      p3: run.issues.filter((i) => i.severity === "p3").length,
      total: run.issues.length,
    }));
  },
});

export const countMyDogfoodQaRuns = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return 0;

    const runs = await ctx.db
      .query("dogfoodQaRuns")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .collect();
    return runs.length;
  },
});

/**
 * Get the latest Pro-tier analysis for use as reference context in Flash runs.
 * Returns the most recent run where model contains "pro" — summary + issues only (no rawText).
 */
export const getLatestProAnalysis = internalQuery({
  args: { source: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const runs = await ctx.db
      .query("dogfoodQaRuns")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);

    const proRun = runs.find((r) => {
      const isProModel = /pro/i.test(r.model ?? "");
      const matchesSource = !args.source || r.source === args.source;
      return isProModel && matchesSource;
    });

    if (!proRun) return null;

    return {
      createdAt: proRun.createdAt,
      model: proRun.model,
      source: proRun.source,
      summary: proRun.summary,
      issues: proRun.issues,
    };
  },
});

export const findMyDogfoodQaRunByInputSha256 = internalQuery({
  args: { inputSha256: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    return await ctx.db
      .query("dogfoodQaRuns")
      .withIndex("by_user_inputSha256", (q) => q.eq("userId", userId).eq("inputSha256", args.inputSha256))
      .order("desc")
      .first();
  },
});
