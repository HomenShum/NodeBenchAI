/**
 * Daily Brief Personal Overlay Mutations
 *
 * Non-Node runtime so we can mutate DB.
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { Doc } from "../../_generated/dataModel";

export const createOverlay = internalMutation({
  args: {
    userId: v.id("users"),
    memoryId: v.id("dailyBriefMemories"),
    dateString: v.string(),
    features: v.array(v.any()),
    progressLog: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const overlayId = await ctx.db.insert("dailyBriefPersonalOverlays", {
      userId: args.userId,
      memoryId: args.memoryId,
      dateString: args.dateString,
      features: args.features,
      progressLog: args.progressLog,
      createdAt: now,
      updatedAt: now,
    });
    return overlayId;
  },
});

export const updatePersonalTaskStatus = internalMutation({
  args: {
    overlayId: v.id("dailyBriefPersonalOverlays"),
    taskId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("failing"),
      v.literal("passing"),
    ),
    notes: v.optional(v.string()),
    resultMarkdown: v.optional(v.string()),
    logMessage: v.string(),
    logStatus: v.optional(
      v.union(
        v.literal("info"),
        v.literal("pending"),
        v.literal("working"),
        v.literal("passing"),
        v.literal("failing"),
        v.literal("error"),
      ),
    ),
    meta: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const overlay = await ctx.db.get(args.overlayId) as Doc<"dailyBriefPersonalOverlays"> | null;
    if (!overlay) throw new Error("Overlay not found");

    const now = Date.now();

    const features = (overlay.features as any[]).map((f) =>
      f.id === args.taskId
        ? {
            ...f,
            status: args.status,
            notes: args.notes ?? f.notes,
            resultMarkdown: args.resultMarkdown ?? f.resultMarkdown,
            updatedAt: now,
          }
        : f,
    );

    const progressLog = [
      ...(overlay.progressLog as any[]),
      {
        ts: now,
        status:
          args.logStatus ??
          (args.status === "passing"
            ? "passing"
            : args.status === "failing"
              ? "failing"
              : "info"),
        message: args.logMessage,
        meta: args.meta,
      },
    ];

    await ctx.db.patch(overlay._id, {
      features,
      progressLog,
      updatedAt: now,
    });
  },
});

