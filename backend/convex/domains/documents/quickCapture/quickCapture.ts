import { v } from "convex/values";
import { mutation, query } from "../../../_generated/server";
import { Doc } from "../../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Save a quick capture (note, task, voice, screenshot)
 */
export const saveCapture = mutation({
  args: {
    type: v.union(
      v.literal("note"),
      v.literal("task"),
      v.literal("voice"),
      v.literal("screenshot")
    ),
    content: v.string(),
    title: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    audioStorageId: v.optional(v.id("_storage")),
    screenshotStorageId: v.optional(v.id("_storage")),
    annotations: v.optional(v.any()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Get URLs for storage IDs if provided
    let audioUrl: string | undefined;
    let screenshotUrl: string | undefined;

    if (args.audioStorageId) {
      audioUrl = await ctx.storage.getUrl(args.audioStorageId) ?? undefined;
    }
    if (args.screenshotStorageId) {
      screenshotUrl = await ctx.storage.getUrl(args.screenshotStorageId) ?? undefined;
    }

    const captureId = await ctx.db.insert("quickCaptures", {
      userId,
      type: args.type,
      content: args.content,
      title: args.title,
      tags: args.tags,
      audioStorageId: args.audioStorageId,
      audioUrl,
      screenshotStorageId: args.screenshotStorageId,
      screenshotUrl,
      annotations: args.annotations,
      metadata: args.metadata,
      processed: false,
      createdAt: Date.now(),
    });

    return captureId;
  },
});

/**
 * Get recent captures for the current user
 */
export const getRecentCaptures = query({
  args: {
    limit: v.optional(v.number()),
    type: v.optional(v.union(
      v.literal("note"),
      v.literal("task"),
      v.literal("voice"),
      v.literal("screenshot")
    )),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 20;

    let captures;
    if (args.type) {
      captures = await ctx.db
        .query("quickCaptures")
        .withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", args.type))
        .order("desc")
        .take(limit);
    } else {
      captures = await ctx.db
        .query("quickCaptures")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .order("desc")
        .take(limit);
    }

    return captures;
  },
});

/**
 * Get a single capture by ID
 */
export const getCapture = query({
  args: { captureId: v.id("quickCaptures") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const capture = await ctx.db.get(args.captureId) as Doc<"quickCaptures"> | null;
    if (!capture || capture.userId !== userId) return null;

    return capture;
  },
});

/**
 * Delete a capture
 */
export const deleteCapture = mutation({
  args: { captureId: v.id("quickCaptures") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const capture = await ctx.db.get(args.captureId) as Doc<"quickCaptures"> | null;
    if (!capture || capture.userId !== userId) {
      throw new Error("Capture not found");
    }

    // Delete associated storage files
    if (capture.audioStorageId) {
      await ctx.storage.delete(capture.audioStorageId);
    }
    if (capture.screenshotStorageId) {
      await ctx.storage.delete(capture.screenshotStorageId);
    }

    await ctx.db.delete(args.captureId);
  },
});

/**
 * Update capture (e.g., after AI processing)
 */
export const updateCapture = mutation({
  args: {
    captureId: v.id("quickCaptures"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    transcription: v.optional(v.string()),
    processed: v.optional(v.boolean()),
    linkedDocumentId: v.optional(v.id("documents")),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const capture = await ctx.db.get(args.captureId) as Doc<"quickCaptures"> | null;
    if (!capture || capture.userId !== userId) {
      throw new Error("Capture not found");
    }

    const { captureId, ...updates } = args;
    await ctx.db.patch(captureId, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Generate upload URL for audio/screenshot files
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    return await ctx.storage.generateUploadUrl();
  },
});

