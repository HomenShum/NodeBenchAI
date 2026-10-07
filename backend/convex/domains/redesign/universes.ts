/**
 * Redesign Sprint S5 — Universes (Reports surface entity collections).
 *
 * Powers the universe sections in ReportsSurface (Healthcare AI Coverage, Sales accounts · Q3,
 * YC S25 batch, etc.). Bulk-action bar's "Run batch" CTA dispatches a batchAutopilot run
 * across the universe's entityIds.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const list = query({
  args: { monitoring: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    if (typeof args.monitoring === "boolean") {
      return await ctx.db
        .query("redesignUniverses")
        .withIndex("by_user_monitoring", (q) => q.eq("userId", userId).eq("monitoring", args.monitoring!))
        .order("desc")
        .take(100);
    }
    return await ctx.db
      .query("redesignUniverses")
      .filter((q) => q.eq(q.field("userId"), userId))
      .take(100);
  },
});

export const upsert = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    rubric: v.string(),
    monitoring: v.boolean(),
    monitoringMinutes: v.optional(v.number()),
    entityIds: v.array(v.string()),
    styleId: v.optional(v.id("styleProfiles")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Auth required");
    const now = Date.now();
    const existing = await ctx.db
      .query("redesignUniverses")
      .withIndex("by_user_monitoring", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("slug"), args.slug))
      .unique()
      .catch(() => null);
    const payload = {
      userId,
      name: args.name,
      slug: args.slug,
      rubric: args.rubric,
      monitoring: args.monitoring,
      monitoringMinutes: args.monitoringMinutes,
      entityIds: args.entityIds,
      entityCount: args.entityIds.length,
      styleId: args.styleId,
      refreshedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }
    return await ctx.db.insert("redesignUniverses", payload);
  },
});

export const setMonitoring = mutation({
  args: { universeId: v.id("redesignUniverses"), monitoring: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Auth required");
    const u = await ctx.db.get(args.universeId);
    if (!u || u.userId !== userId) throw new Error("Universe not found");
    await ctx.db.patch(args.universeId, { monitoring: args.monitoring });
    return args.universeId;
  },
});
