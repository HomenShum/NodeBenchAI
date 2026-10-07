/**
 * Dossier Annotations - Mutations/Queries
 * 
 * Manages agent-generated chart annotations.
 * Annotations are text labels attached to data points that appear/fade based on act.
 */

import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc } from "../../../_generated/dataModel";

const annotationFields = {
  briefId: v.string(),
  seriesId: v.optional(v.string()),
  dataIndex: v.number(),
  text: v.string(),
  position: v.union(v.literal("above"), v.literal("below"), v.literal("left"), v.literal("right")),
  icon: v.optional(v.string()),
  visibleInActs: v.array(v.union(v.literal("actI"), v.literal("actII"), v.literal("actIII"))),
  source: v.union(v.literal("agent"), v.literal("user"), v.literal("system")),
  agentThreadId: v.optional(v.string()),
};

/**
 * Get all annotations for a brief
 */
export const getAnnotations = query({
  args: {
    briefId: v.string(),
    seriesId: v.optional(v.string()),
  },
  returns: v.array(v.object({
    _id: v.id("dossierAnnotations"),
    userId: v.id("users"),
    ...annotationFields,
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const q = ctx.db
      .query("dossierAnnotations")
      .withIndex("by_user_brief", (q) => q.eq("userId", userId).eq("briefId", args.briefId));

    const annotations = await q.collect();

    // Filter by seriesId if specified
    if (args.seriesId) {
      return annotations.filter((a) => a.seriesId === args.seriesId);
    }

    return annotations;
  },
});

/**
 * Get annotation for a specific data point
 */
export const getAnnotationForDataPoint = query({
  args: {
    briefId: v.string(),
    dataIndex: v.number(),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("dossierAnnotations"),
      userId: v.id("users"),
      ...annotationFields,
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    return ctx.db
      .query("dossierAnnotations")
      .withIndex("by_brief_dataIndex", (q) =>
        q.eq("briefId", args.briefId).eq("dataIndex", args.dataIndex)
      )
      .first();
  },
});

/**
 * Add a new annotation
 */
export const addAnnotation = mutation({
  args: annotationFields,
  returns: v.id("dossierAnnotations"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    return ctx.db.insert("dossierAnnotations", {
      userId,
      ...args,
      createdAt: Date.now(),
    });
  },
});

/**
 * Delete an annotation
 */
export const deleteAnnotation = mutation({
  args: {
    annotationId: v.id("dossierAnnotations"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return false;

    const annotation = await ctx.db.get(args.annotationId) as Doc<"dossierAnnotations"> | null;
    if (!annotation || annotation.userId !== userId) return false;

    await ctx.db.delete(args.annotationId);
    return true;
  },
});

/**
 * Internal mutation for agent tools to add annotations
 */
export const addAnnotationInternal = internalMutation({
  args: {
    userId: v.id("users"),
    ...annotationFields,
  },
  returns: v.id("dossierAnnotations"),
  handler: async (ctx, args) => {
    const { userId, ...rest } = args;

    return ctx.db.insert("dossierAnnotations", {
      userId,
      ...rest,
      source: "agent",
      createdAt: Date.now(),
    });
  },
});

/**
 * Update an existing annotation
 */
export const updateAnnotation = mutation({
  args: {
    annotationId: v.id("dossierAnnotations"),
    text: v.optional(v.string()),
    position: v.optional(v.union(v.literal("above"), v.literal("below"), v.literal("left"), v.literal("right"))),
    icon: v.optional(v.string()),
    visibleInActs: v.optional(v.array(v.union(v.literal("actI"), v.literal("actII"), v.literal("actIII")))),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return false;

    const annotation = await ctx.db.get(args.annotationId) as Doc<"dossierAnnotations"> | null;
    if (!annotation || annotation.userId !== userId) return false;

    const { annotationId, ...updates } = args;
    await ctx.db.patch(annotationId, updates);
    return true;
  },
});

/**
 * Internal query for agent tools to get annotations
 */
export const getAnnotationsInternal = internalQuery({
  args: {
    userId: v.id("users"),
    briefId: v.string(),
    seriesId: v.optional(v.string()),
  },
  returns: v.array(v.object({
    _id: v.id("dossierAnnotations"),
    userId: v.id("users"),
    briefId: v.string(),
    seriesId: v.optional(v.string()),
    dataIndex: v.number(),
    text: v.string(),
    position: v.union(v.literal("above"), v.literal("below"), v.literal("left"), v.literal("right")),
    icon: v.optional(v.string()),
    visibleInActs: v.array(v.union(v.literal("actI"), v.literal("actII"), v.literal("actIII"))),
    source: v.union(v.literal("agent"), v.literal("user"), v.literal("system")),
    agentThreadId: v.optional(v.string()),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const annotations = await ctx.db
      .query("dossierAnnotations")
      .withIndex("by_user_brief", (q) => q.eq("userId", args.userId).eq("briefId", args.briefId))
      .collect();

    if (args.seriesId) {
      return annotations.filter((a) => a.seriesId === args.seriesId);
    }

    return annotations;
  },
});
