/**
 * Teachability memory queries and mutations
 * - Convex runtime (no Node.js)
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* QUERIES                                                             */
/* ------------------------------------------------------------------ */

export const getTeachingById = internalQuery({
  args: { teachingId: v.id("userTeachings") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.teachingId) as Doc<"userTeachings"> | null;
  },
});

export const listTeachingsByUser = internalQuery({
  args: {
    userId: v.id("users"),
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
    type: v.optional(
      v.union(v.literal("fact"), v.literal("preference"), v.literal("skill"))
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    const rows = await ctx.db
      .query("userTeachings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(limit * 2) as Doc<"userTeachings">[];

    return rows
      .filter((t: Doc<"userTeachings">) => (!args.status || t.status === args.status))
      .filter((t: Doc<"userTeachings">) => (!args.type || t.type === args.type))
      .slice(0, limit);
  },
});

export const listSkillsWithTriggers = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const rows = await ctx.db
      .query("userTeachings")
      .withIndex("by_user_type", (q) => q.eq("userId", args.userId).eq("type", "skill"))
      .take(limit * 2) as Doc<"userTeachings">[];

    return rows
      .filter((r: Doc<"userTeachings">) => r.status === "active")
      .filter((r: Doc<"userTeachings">) => Array.isArray(r.triggerPhrases) && r.triggerPhrases.length > 0)
      .slice(0, limit);
  },
});

export const getTopPreferences = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 5;
    const prefs = await ctx.db
      .query("userTeachings")
      .withIndex("by_user_type", (q) => q.eq("userId", args.userId).eq("type", "preference"))
      .take(limit * 3) as Doc<"userTeachings">[];

    return prefs
      .filter((p: Doc<"userTeachings">) => p.status === "active")
      .sort((a: Doc<"userTeachings">, b: Doc<"userTeachings">) => (b.usageCount ?? 0) - (a.usageCount ?? 0))
      .slice(0, limit);
  },
});

/* ------------------------------------------------------------------ */
/* MUTATIONS                                                           */
/* ------------------------------------------------------------------ */

export const persistTeaching = internalMutation({
  args: {
    userId: v.id("users"),
    type: v.union(v.literal("fact"), v.literal("preference"), v.literal("skill")),
    content: v.string(),
    category: v.optional(v.string()),
    key: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
    source: v.optional(v.union(v.literal("explicit"), v.literal("inferred"))),
    steps: v.optional(v.array(v.string())),
    triggerPhrases: v.optional(v.array(v.string())),
    confidence: v.optional(v.number()),
    usageCount: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const archivedIds: Id<"userTeachings">[] = [];

    // Archive previous active entries in the same category (conflict resolution)
    if (args.category) {
      const conflicts = await ctx.db
        .query("userTeachings")
        .withIndex("by_user_category", (q) =>
          q.eq("userId", args.userId).eq("category", args.category))
        .take(50) as Doc<"userTeachings">[];

      for (const doc of conflicts) {
        if (doc.status === "active") {
          await ctx.db.patch(doc._id, { status: "archived", archivedAt: now });
          archivedIds.push(doc._id);
        }
      }
    }

    const teachingId = await ctx.db.insert("userTeachings", {
      userId: args.userId,
      type: args.type,
      content: args.content,
      category: args.category,
      key: args.key,
      embedding: args.embedding,
      status: args.status ?? "active",
      source: args.source,
      steps: args.steps,
      triggerPhrases: args.triggerPhrases,
      confidence: args.confidence,
      usageCount: args.usageCount ?? 0,
      lastUsedAt: args.lastUsedAt,
      createdAt: now,
      archivedAt: args.status === "archived" ? now : undefined,
      threadId: args.threadId,
    });

    return { teachingId, archivedIds };
  },
});

export const recordTeachingUsage = internalMutation({
  args: {
    teachingId: v.id("userTeachings"),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.teachingId) as Doc<"userTeachings"> | null;
    if (!doc) return;
    await ctx.db.patch(args.teachingId, {
      usageCount: (doc.usageCount ?? 0) + 1,
      lastUsedAt: Date.now(),
    });
  },
});
