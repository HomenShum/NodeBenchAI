import { query, mutation } from "../../../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "../../../_generated/dataModel";

const TYPE_LITERAL = v.union(
  v.literal("fact"),
  v.literal("preference"),
  v.literal("skill"),
);

export const listUserTeachings = query({
  args: {
    type: v.optional(TYPE_LITERAL),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 12;
    const docs = await ctx.db
      .query("userTeachings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(limit * 3);

    const filtered = docs
      .filter((d: Doc<"userTeachings">) => d.status === "active")
      .filter((d: Doc<"userTeachings">) => !args.type || d.type === args.type);

    return filtered
      .sort((a, b) => {
        const aTime = a.lastUsedAt ?? a.createdAt ?? 0;
        const bTime = b.lastUsedAt ?? b.createdAt ?? 0;
        return bTime - aTime;
      })
      .slice(0, limit);
  },
});

export const updateTeaching = mutation({
  args: {
    teachingId: v.id("userTeachings"),
    key: v.optional(v.string()),
    content: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const teaching = await ctx.db.get(args.teachingId) as Doc<"userTeachings"> | null;
    if (!teaching || teaching.userId !== userId) {
      throw new Error("Teaching not found");
    }

    const patch: Partial<Doc<"userTeachings">> = {};
    if (args.key !== undefined) {
      patch.key = args.key;
      patch.category = teaching.category ?? args.key?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")?.slice(0, 80);
    }
    if (args.content !== undefined) {
      patch.content = args.content;
    }
    patch.lastUsedAt = Date.now();
    patch.usageCount = teaching.usageCount ?? 0;

    await ctx.db.patch(args.teachingId, patch);
  },
});

export const deleteTeaching = mutation({
  args: { teachingId: v.id("userTeachings") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const teaching = await ctx.db.get(args.teachingId) as Doc<"userTeachings"> | null;
    if (!teaching || teaching.userId !== userId) {
      throw new Error("Teaching not found");
    }

    await ctx.db.patch(args.teachingId, {
      status: "archived",
      archivedAt: Date.now(),
    });
  },
});
