import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { Doc } from "../../_generated/dataModel";

export const writeMemory = internalMutation({
  args: {
    entry: v.object({
      key: v.string(),
      content: v.string(),
      metadata: v.optional(v.any()),
    }),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("mcpMemoryEntries")
      .withIndex("by_key", (q) => q.eq("key", args.entry.key))
      .first() as Doc<"mcpMemoryEntries"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        content: args.entry.content,
        metadata: args.entry.metadata,
        updatedAt: now,
      });
      return existing._id;
    }

    const id = await ctx.db.insert("mcpMemoryEntries", {
      key: args.entry.key,
      content: args.entry.content,
      metadata: args.entry.metadata,
      createdAt: now,
      updatedAt: now,
    });

    return id;
  },
});

export const readMemory = internalQuery({
  args: { key: v.string() },
  returns: v.union(
    v.object({
      id: v.string(),
      key: v.string(),
      content: v.string(),
      metadata: v.optional(v.any()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("mcpMemoryEntries")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first() as Doc<"mcpMemoryEntries"> | null;
    if (!entry) return null;
    return {
      id: entry._id,
      key: entry.key,
      content: entry.content,
      metadata: entry.metadata,
    };
  },
});

export const listMemory = internalQuery({
  args: {
    filter: v.optional(v.string()),
    key: v.optional(v.string()),
    contains: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({
    id: v.string(),
    key: v.string(),
    content: v.string(),
    metadata: v.optional(v.any()),
  })),
  handler: async (ctx, args) => {
    const limit = args.limit && args.limit > 0 ? args.limit : 100;

    // Exact key lookup fast-path.
    if (args.key) {
      const entry = await ctx.db
        .query("mcpMemoryEntries")
        .withIndex("by_key", (q) => q.eq("key", args.key as string))
        .first() as Doc<"mcpMemoryEntries"> | null;
      if (!entry) return [];
      return [{
        id: entry._id,
        key: entry.key,
        content: entry.content,
        metadata: entry.metadata,
      }];
    }

    const contains = (args.contains ?? args.filter ?? "").toLowerCase();
    const entries = await ctx.db.query("mcpMemoryEntries").collect() as Doc<"mcpMemoryEntries">[];
    const filtered = contains
      ? entries.filter((e: Doc<"mcpMemoryEntries">) => (e.key ?? "").toLowerCase().includes(contains))
      : entries;

    filtered.sort((a: Doc<"mcpMemoryEntries">, b: Doc<"mcpMemoryEntries">) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

    return filtered.slice(0, limit).map((e: Doc<"mcpMemoryEntries">) => ({
      id: e._id,
      key: e.key,
      content: e.content,
      metadata: e.metadata,
    }));
  },
});

export const deleteMemory = internalMutation({
  args: { key: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("mcpMemoryEntries")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first() as Doc<"mcpMemoryEntries"> | null;
    if (!entry) return false;
    await ctx.db.delete(entry._id);
    return true;
  },
});

export const getMemoryById = internalQuery({
  args: { id: v.id("mcpMemoryEntries") },
  returns: v.union(
    v.object({
      id: v.string(),
      key: v.string(),
      content: v.string(),
      metadata: v.optional(v.any()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.id) as Doc<"mcpMemoryEntries"> | null;
    if (!entry) return null;
    return {
      id: entry._id,
      key: entry.key,
      content: entry.content,
      metadata: entry.metadata,
    };
  },
});

export const deleteMemoryById = internalMutation({
  args: { id: v.id("mcpMemoryEntries") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.id) as Doc<"mcpMemoryEntries"> | null;
    if (!entry) return false;
    await ctx.db.delete(args.id);
    return true;
  },
});
