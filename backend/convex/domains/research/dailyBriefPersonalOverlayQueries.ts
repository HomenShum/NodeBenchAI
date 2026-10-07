/**
 * Daily Brief Personal Overlay Queries
 *
 * Public queries return per-user overlays for the Brief tab.
 * Internal queries support worker/actions.
 */

import { v } from "convex/values";
import { query, internalQuery } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const getOverlayInternal = internalQuery({
  args: {
    userId: v.id("users"),
    memoryId: v.id("dailyBriefMemories"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("dailyBriefPersonalOverlays")
      .withIndex("by_user_memory", (q) =>
        q.eq("userId", args.userId).eq("memoryId", args.memoryId),
      )
      .order("desc")
      .first();
  },
});

export const getOverlay = query({
  args: { memoryId: v.id("dailyBriefMemories") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db
      .query("dailyBriefPersonalOverlays")
      .withIndex("by_user_memory", (q) =>
        q.eq("userId", userId as any).eq("memoryId", args.memoryId),
      )
      .order("desc")
      .first();
  },
});

export const getOverlayByDateString = query({
  args: { dateString: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db
      .query("dailyBriefPersonalOverlays")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId as any).eq("dateString", args.dateString),
      )
      .order("desc")
      .first();
  },
});

