/**
 * Dossier Focus State - Mutations/Queries
 * 
 * Enables bidirectional focus sync between Fast Agent Panel and Dossier views.
 * Agent tools call these to update focus, React components subscribe via useQuery.
 */

import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc } from "../../../_generated/dataModel";

/**
 * Get current focus state for a brief
 * React components subscribe to this for real-time updates
 */
export const getFocusState = query({
  args: {
    briefId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      _creationTime: v.number(),
      _id: v.id("dossierFocusState"),
      userId: v.id("users"),
      briefId: v.string(),
      currentAct: v.optional(v.union(v.literal("actI"), v.literal("actII"), v.literal("actIII"))),
      focusedDataIndex: v.optional(v.number()),
      hoveredSpanId: v.optional(v.string()),
      activeSectionId: v.optional(v.string()),
      focusedSeriesId: v.optional(v.string()),
      focusSource: v.optional(v.union(
        v.literal("chart_hover"),
        v.literal("text_hover"),
        v.literal("agent_tool"),
        v.literal("panel_action"),
      )),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    return ctx.db
      .query("dossierFocusState")
      .withIndex("by_user_brief", (q) => q.eq("userId", userId).eq("briefId", args.briefId))
      .first() as Doc<"dossierFocusState"> | null;
  },
});

/**
 * Update focus state - called by agent tools or UI interactions
 */
export const updateFocus = mutation({
  args: {
    briefId: v.string(),
    currentAct: v.optional(v.union(v.literal("actI"), v.literal("actII"), v.literal("actIII"))),
    focusedDataIndex: v.optional(v.number()),
    hoveredSpanId: v.optional(v.string()),
    activeSectionId: v.optional(v.string()),
    focusedSeriesId: v.optional(v.string()),
    focusSource: v.optional(v.union(
      v.literal("chart_hover"),
      v.literal("text_hover"),
      v.literal("agent_tool"),
      v.literal("panel_action"),
    )),
  },
  returns: v.union(v.id("dossierFocusState"), v.null()),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const existing = await ctx.db
      .query("dossierFocusState")
      .withIndex("by_user_brief", (q) => q.eq("userId", userId).eq("briefId", args.briefId))
      .first() as Doc<"dossierFocusState"> | null;

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: now,
      });
      return existing._id;
    } else {
      return ctx.db.insert("dossierFocusState", {
        userId,
        briefId: args.briefId,
        currentAct: args.currentAct,
        focusedDataIndex: args.focusedDataIndex,
        hoveredSpanId: args.hoveredSpanId,
        activeSectionId: args.activeSectionId,
        focusedSeriesId: args.focusedSeriesId,
        focusSource: args.focusSource,
        updatedAt: now,
      });
    }
  },
});

/**
 * Clear focus state - reset all focus
 */
export const clearFocus = mutation({
  args: {
    briefId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return false;

    const existing = await ctx.db
      .query("dossierFocusState")
      .withIndex("by_user_brief", (q) => q.eq("userId", userId).eq("briefId", args.briefId))
      .first() as Doc<"dossierFocusState"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        focusedDataIndex: undefined,
        hoveredSpanId: undefined,
        focusedSeriesId: undefined,
        focusSource: undefined,
        updatedAt: Date.now(),
      });
      return true;
    }
    return false;
  },
});

/**
 * Internal mutation for agent tools to update focus state
 * Bypasses auth check since agent already has userId
 */
export const updateFocusInternal = internalMutation({
  args: {
    userId: v.id("users"),
    briefId: v.string(),
    focusedDataIndex: v.optional(v.number()),
    hoveredSpanId: v.optional(v.string()),
    activeSectionId: v.optional(v.string()),
    focusedSeriesId: v.optional(v.string()),
  },
  returns: v.id("dossierFocusState"),
  handler: async (ctx, args) => {
    const { userId, ...rest } = args;
    
    const existing = await ctx.db
      .query("dossierFocusState")
      .withIndex("by_user_brief", (q) => q.eq("userId", userId).eq("briefId", args.briefId))
      .first() as Doc<"dossierFocusState"> | null;

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...rest,
        focusSource: "agent_tool",
        updatedAt: now,
      });
      return existing._id;
    }

    return ctx.db.insert("dossierFocusState", {
      userId,
      ...rest,
      focusSource: "agent_tool",
      updatedAt: now,
    });
  },
});

/**
 * Internal query for agent tools to get focus state
 * Bypasses auth check since agent already has userId
 */
export const getFocusStateInternal = internalQuery({
  args: {
    userId: v.id("users"),
    briefId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      _creationTime: v.number(),
      _id: v.id("dossierFocusState"),
      userId: v.id("users"),
      briefId: v.string(),
      currentAct: v.optional(v.union(v.literal("actI"), v.literal("actII"), v.literal("actIII"))),
      focusedDataIndex: v.optional(v.number()),
      hoveredSpanId: v.optional(v.string()),
      activeSectionId: v.optional(v.string()),
      focusedSeriesId: v.optional(v.string()),
      focusSource: v.optional(v.union(
        v.literal("chart_hover"),
        v.literal("text_hover"),
        v.literal("agent_tool"),
        v.literal("panel_action"),
      )),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    return ctx.db
      .query("dossierFocusState")
      .withIndex("by_user_brief", (q) => q.eq("userId", args.userId).eq("briefId", args.briefId))
      .first() as Doc<"dossierFocusState"> | null;
  },
});
