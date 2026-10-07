// convex/domains/agents/coordinator/contextPackMutations.ts
// Internal mutations for context pack storage

import { internalMutation } from "../../../_generated/server";
import { v } from "convex/values";
import type { Doc } from "../../../_generated/dataModel";

/**
 * Store a context pack in the cache
 */
export const storeContextPack = internalMutation({
  args: {
    pack: v.any(), // ContextPack object
  },
  handler: async (ctx, args) => {
    const pack = args.pack;

    // Check if we already have this pack cached
    const existing = await ctx.db
      .query("contextPacks")
      .withIndex("by_thread_hash", q =>
        q.eq("threadId", pack.threadId).eq("docSetHash", pack.docSetHash)
      )
      .first() as Doc<"contextPacks"> | null;

    if (existing) {
      // Update existing
      await ctx.db.patch(existing._id, {
        documents: pack.documents,
        totalTokens: pack.totalTokens,
        expiresAt: pack.expiresAt,
        metadata: pack.metadata,
      });
      return existing._id;
    }

    // Insert new
    const id = await ctx.db.insert("contextPacks", {
      packId: pack.packId,
      threadId: pack.threadId,
      docSetHash: pack.docSetHash,
      documents: pack.documents,
      totalTokens: pack.totalTokens,
      createdAt: pack.createdAt,
      expiresAt: pack.expiresAt,
      metadata: pack.metadata,
    });

    return id;
  },
});

/**
 * Clean up expired context packs
 */
export const cleanupExpiredPacks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Find expired packs
    const expired = await ctx.db
      .query("contextPacks")
      .filter(q => q.lt(q.field("expiresAt"), now))
      .collect();

    // Delete them
    for (const pack of expired) {
      await ctx.db.delete(pack._id);
    }

    if (expired.length > 0) {
      console.log(`[cleanupExpiredPacks] Deleted ${expired.length} expired packs`);
    }

    return { deleted: expired.length };
  },
});

/**
 * Invalidate context pack for a specific thread
 * (e.g., when documents are edited)
 */
export const invalidateThreadPacks = internalMutation({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const packs = await ctx.db
      .query("contextPacks")
      .withIndex("by_thread", q => q.eq("threadId", args.threadId))
      .collect();

    for (const pack of packs) {
      await ctx.db.delete(pack._id);
    }

    return { invalidated: packs.length };
  },
});
