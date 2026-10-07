import { v } from "convex/values";
import { query, internalMutation } from "../../_generated/server";
import { Doc } from "../../_generated/dataModel";

export const getDealFlow = query({
  args: {
    dateString: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const today = new Date().toISOString().slice(0, 10);
    const dateString = args.dateString ?? today;
    let snapshot = await ctx.db
      .query("dealFlowCache")
      .withIndex("by_date", (q) => q.eq("dateString", dateString))
      .first() as Doc<"dealFlowCache"> | null;

    if (!snapshot) {
      snapshot = await ctx.db
        .query("dealFlowCache")
        .withIndex("by_fetched_at")
        .order("desc")
        .first() as Doc<"dealFlowCache"> | null;
    }

    return snapshot?.deals ?? [];
  },
});

export const getDealFlowSnapshot = query({
  args: {
    dateString: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("dealFlowCache")
      .withIndex("by_date", (q) => q.eq("dateString", args.dateString))
      .first() as Doc<"dealFlowCache"> | null;
  },
});

export const insertDealFlow = internalMutation({
  args: {
    record: v.any(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("dealFlowCache", args.record);
  },
});

export const patchDealFlow = internalMutation({
  args: {
    id: v.id("dealFlowCache"),
    updates: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, args.updates);
  },
});
