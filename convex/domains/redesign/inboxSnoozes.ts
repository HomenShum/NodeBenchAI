/**
 * Redesign Sprint S5 — Inbox snooze queries + mutations.
 *
 * Powers the InboxSurface bulk-snooze action ("Tomorrow", "Next week"). Soft-hides
 * an inbox item until snoozeUntil. Items expire automatically when snoozeUntil < now.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

const ONE_DAY = 24 * 60 * 60 * 1000;
const ONE_WEEK = 7 * ONE_DAY;

/** List currently-active snoozes for the calling user (snoozeUntil > now). */
export const listActive = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const now = Date.now();
    return await ctx.db
      .query("inboxSnoozes")
      .withIndex("by_user_until", (q) => q.eq("userId", userId).gt("snoozeUntil", now))
      .take(200);
  },
});

export const snooze = mutation({
  args: {
    items: v.array(v.object({
      itemId: v.string(),
      itemSource: v.string(),
    })),
    /** "tomorrow" | "next-week" | "1h" | iso-timestamp */
    until: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Auth required");
    const now = Date.now();
    let snoozeUntil = now + ONE_DAY;
    if (args.until === "next-week") snoozeUntil = now + ONE_WEEK;
    else if (args.until === "1h") snoozeUntil = now + 60 * 60 * 1000;
    else if (/^\d{4}-\d{2}-\d{2}/.test(args.until)) {
      const t = Date.parse(args.until);
      if (!Number.isNaN(t) && t > now) snoozeUntil = t;
    }

    const ids: string[] = [];
    for (const item of args.items) {
      // Replace any existing snooze for the same item
      const existing = await ctx.db
        .query("inboxSnoozes")
        .withIndex("by_user_item", (q) => q.eq("userId", userId).eq("itemId", item.itemId))
        .unique()
        .catch(() => null);
      if (existing) {
        await ctx.db.patch(existing._id, { snoozeUntil, snoozedAt: now, note: args.note });
        ids.push(existing._id);
      } else {
        const id = await ctx.db.insert("inboxSnoozes", {
          userId,
          itemId: item.itemId,
          itemSource: item.itemSource,
          snoozeUntil,
          snoozedAt: now,
          note: args.note,
        });
        ids.push(id);
      }
    }
    return { snoozedUntil: snoozeUntil, count: ids.length };
  },
});

export const unsnooze = mutation({
  args: { itemIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Auth required");
    let removed = 0;
    for (const itemId of args.itemIds) {
      const existing = await ctx.db
        .query("inboxSnoozes")
        .withIndex("by_user_item", (q) => q.eq("userId", userId).eq("itemId", itemId))
        .unique()
        .catch(() => null);
      if (existing) {
        await ctx.db.delete(existing._id);
        removed++;
      }
    }
    return { removed };
  },
});

export const unsnoozeAll = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Auth required");
    const all = await ctx.db
      .query("inboxSnoozes")
      .withIndex("by_user_until", (q) => q.eq("userId", userId))
      .collect();
    for (const row of all) await ctx.db.delete(row._id);
    return { removed: all.length };
  },
});
