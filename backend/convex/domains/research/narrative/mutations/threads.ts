/**
 * Narrative Thread Mutations
 *
 * CRUD operations for narrativeThreads table.
 * Threads represent evolving story arcs tracked over time.
 */

import { v } from "convex/values";
import { mutation, internalMutation } from "../../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * FNV-1a 32-bit hash for stable ID generation
 * Matches the pattern used in webSourceCitations.ts
 */
function fnv1a32Hex(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Generate a URL-friendly slug from a name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 100);
}

/**
 * Create a new narrative thread
 */
export const createThread = mutation({
  args: {
    name: v.string(),
    thesis: v.string(),
    entityKeys: v.array(v.string()),
    topicTags: v.optional(v.array(v.string())),
    counterThesis: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  returns: v.id("narrativeThreads"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const now = Date.now();
    const threadId = `nt_${fnv1a32Hex(args.name + now)}`;
    const slug = generateSlug(args.name);

    return await ctx.db.insert("narrativeThreads", {
      threadId,
      name: args.name,
      slug,
      thesis: args.thesis,
      entityKeys: args.entityKeys,
      topicTags: args.topicTags || [],
      counterThesis: args.counterThesis,
      currentPhase: "emerging",
      firstEventAt: now,
      latestEventAt: now,
      eventCount: 0,
      plotTwistCount: 0,
      quality: {
        hasMultipleSources: false,
        hasRecentActivity: true,
        hasVerifiedClaims: false,
        hasCounterNarrative: !!args.counterThesis,
      },
      userId,
      isPublic: args.isPublic || false,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Internal version for agent use
 */
export const createThreadInternal = internalMutation({
  args: {
    threadId: v.optional(v.string()),
    name: v.string(),
    slug: v.optional(v.string()),
    thesis: v.string(),
    entityKeys: v.array(v.string()),
    topicTags: v.optional(v.array(v.string())),
    counterThesis: v.optional(v.string()),
    currentPhase: v.optional(
      v.union(
        v.literal("emerging"),
        v.literal("escalating"),
        v.literal("climax"),
        v.literal("resolution"),
        v.literal("dormant")
      )
    ),
    firstEventAt: v.optional(v.number()),
    latestEventAt: v.optional(v.number()),
    eventCount: v.optional(v.number()),
    plotTwistCount: v.optional(v.number()),
    quality: v.optional(
      v.object({
        hasMultipleSources: v.boolean(),
        hasRecentActivity: v.boolean(),
        hasVerifiedClaims: v.boolean(),
        hasCounterNarrative: v.boolean(),
      })
    ),
    userId: v.id("users"),
    isPublic: v.optional(v.boolean()),
    /** Override timestamps for deterministic runs. */
    createdAtOverride: v.optional(v.number()),
  },
  returns: v.id("narrativeThreads"),
  handler: async (ctx, args) => {
    const now = args.createdAtOverride ?? Date.now();
    const threadId = args.threadId || `nt_${fnv1a32Hex(args.name + now)}`;
    const slug = args.slug || generateSlug(args.name);

    // Idempotency: if a thread with this stable threadId already exists, reuse it.
    const existing = await ctx.db
      .query("narrativeThreads")
      .filter((q) => q.eq(q.field("threadId"), threadId))
      .first();
    if (existing) return existing._id;

    return await ctx.db.insert("narrativeThreads", {
      threadId,
      name: args.name,
      slug,
      thesis: args.thesis,
      entityKeys: args.entityKeys,
      topicTags: args.topicTags || [],
      counterThesis: args.counterThesis,
      currentPhase: args.currentPhase ?? "emerging",
      firstEventAt: args.firstEventAt ?? now,
      latestEventAt: args.latestEventAt ?? now,
      eventCount: args.eventCount ?? 0,
      plotTwistCount: args.plotTwistCount ?? 0,
      quality: args.quality ?? {
        hasMultipleSources: false,
        hasRecentActivity: true,
        hasVerifiedClaims: false,
        hasCounterNarrative: !!args.counterThesis,
      },
      userId: args.userId,
      isPublic: args.isPublic || false,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Update a thread's thesis and/or phase
 */
export const updateThread = mutation({
  args: {
    threadId: v.id("narrativeThreads"),
    thesis: v.optional(v.string()),
    counterThesis: v.optional(v.string()),
    currentPhase: v.optional(
      v.union(
        v.literal("emerging"),
        v.literal("escalating"),
        v.literal("climax"),
        v.literal("resolution"),
        v.literal("dormant")
      )
    ),
    topicTags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread not found");
    if (thread.userId !== userId) throw new Error("Not authorized");

    const updates: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    if (args.thesis !== undefined) updates.thesis = args.thesis;
    if (args.counterThesis !== undefined) updates.counterThesis = args.counterThesis;
    if (args.currentPhase !== undefined) updates.currentPhase = args.currentPhase;
    if (args.topicTags !== undefined) updates.topicTags = args.topicTags;

    await ctx.db.patch(args.threadId, updates);
  },
});

/**
 * Internal: Update thread metrics after adding an event
 */
export const updateThreadMetrics = internalMutation({
  args: {
    threadId: v.id("narrativeThreads"),
    eventOccurredAt: v.number(),
    isPlotTwist: v.boolean(),
    hasMultipleSources: v.optional(v.boolean()),
    hasVerifiedClaims: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) return;

    const updates: Record<string, unknown> = {
      eventCount: thread.eventCount + 1,
      latestEventAt: Math.max(thread.latestEventAt, args.eventOccurredAt),
      updatedAt: Date.now(),
    };

    if (args.isPlotTwist) {
      updates.plotTwistCount = thread.plotTwistCount + 1;
    }

    // Update quality flags
    const quality = { ...thread.quality };
    if (args.hasMultipleSources !== undefined) {
      quality.hasMultipleSources = args.hasMultipleSources;
    }
    if (args.hasVerifiedClaims !== undefined) {
      quality.hasVerifiedClaims = args.hasVerifiedClaims;
    }
    quality.hasRecentActivity = true;
    updates.quality = quality;

    await ctx.db.patch(args.threadId, updates);
  },
});

/**
 * Delete a thread (and optionally its events)
 */
export const deleteThread = mutation({
  args: {
    threadId: v.id("narrativeThreads"),
    deleteEvents: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread not found");
    if (thread.userId !== userId) throw new Error("Not authorized");

    if (args.deleteEvents) {
      // Delete all events for this thread
      const events = await ctx.db
        .query("narrativeEvents")
        .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
        .collect();

      for (const event of events) {
        await ctx.db.delete(event._id);
      }

      // Delete all sentiment records for this thread
      const sentiments = await ctx.db
        .query("narrativeSentiment")
        .withIndex("by_thread_week", (q) => q.eq("threadId", args.threadId))
        .collect();

      for (const sentiment of sentiments) {
        await ctx.db.delete(sentiment._id);
      }
    }

    await ctx.db.delete(args.threadId);
  },
});

/**
 * Toggle thread visibility
 */
export const togglePublic = mutation({
  args: {
    threadId: v.id("narrativeThreads"),
    isPublic: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread not found");
    if (thread.userId !== userId) throw new Error("Not authorized");

    await ctx.db.patch(args.threadId, {
      isPublic: args.isPublic,
      updatedAt: Date.now(),
    });
  },
});
