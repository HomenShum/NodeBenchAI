import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "../../_generated/dataModel";

/**
 * Query to get all grid projects for the authenticated user
 */
export const getUserGridProjects = query({
  args: {},
  returns: v.array(v.object({
    _id: v.id("gridProjects"),
    name: v.string(),
    description: v.optional(v.string()),
    createdBy: v.id("users"),
    documentIds: v.array(v.id("documents")),
    layout: v.object({
      cols: v.number(),
      rows: v.number(),
      gridClass: v.string(),
      name: v.string(),
    }),
    createdAt: v.number(),
    updatedAt: v.number(),
    isArchived: v.optional(v.boolean()),
  })),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    return await ctx.db
      .query("gridProjects")
      .withIndex("by_user_archived", (q) => 
        q.eq("createdBy", userId).eq("isArchived", undefined)
      )
      .order("desc")
      .collect();
  },
});

/**
 * Query to get a specific grid project by ID
 */
export const getGridProject = query({
  args: {
    gridProjectId: v.id("gridProjects"),
  },
  returns: v.union(
    v.object({
      _id: v.id("gridProjects"),
      name: v.string(),
      description: v.optional(v.string()),
      createdBy: v.id("users"),
      documentIds: v.array(v.id("documents")),
      layout: v.object({
        cols: v.number(),
        rows: v.number(),
        gridClass: v.string(),
        name: v.string(),
      }),
      createdAt: v.number(),
      updatedAt: v.number(),
      isArchived: v.optional(v.boolean()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const gridProject = await ctx.db.get(args.gridProjectId) as Doc<"gridProjects"> | null;
    if (!gridProject || gridProject.createdBy !== userId) {
      return null;
    }

    return gridProject;
  },
});

/**
 * Mutation to save a new grid project
 */
export const saveGridProject = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    documentIds: v.array(v.id("documents")),
    layout: v.object({
      cols: v.number(),
      rows: v.number(),
      gridClass: v.string(),
      name: v.string(),
    }),
  },
  returns: v.id("gridProjects"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const now = Date.now();
    
    return await ctx.db.insert("gridProjects", {
      name: args.name,
      description: args.description,
      createdBy: userId,
      documentIds: args.documentIds,
      layout: args.layout,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Mutation to update an existing grid project
 */
export const updateGridProject = mutation({
  args: {
    gridProjectId: v.id("gridProjects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    documentIds: v.optional(v.array(v.id("documents"))),
    layout: v.optional(v.object({
      cols: v.number(),
      rows: v.number(),
      gridClass: v.string(),
      name: v.string(),
    })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const gridProject = await ctx.db.get(args.gridProjectId) as Doc<"gridProjects"> | null;
    if (!gridProject || gridProject.createdBy !== userId) {
      throw new Error("Grid project not found or access denied");
    }

    const updates: any = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.documentIds !== undefined) updates.documentIds = args.documentIds;
    if (args.layout !== undefined) updates.layout = args.layout;

    await ctx.db.patch(args.gridProjectId, updates);
    return null;
  },
});

/**
 * Mutation to archive a grid project (soft delete)
 */
export const archiveGridProject = mutation({
  args: {
    gridProjectId: v.id("gridProjects"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const gridProject = await ctx.db.get(args.gridProjectId) as Doc<"gridProjects"> | null;
    if (!gridProject || gridProject.createdBy !== userId) {
      throw new Error("Grid project not found or access denied");
    }

    await ctx.db.patch(args.gridProjectId, {
      isArchived: true,
      updatedAt: Date.now(),
    });
    
    return null;
  },
});

/**
 * Mutation to permanently delete a grid project
 */
export const deleteGridProject = mutation({
  args: {
    gridProjectId: v.id("gridProjects"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const gridProject = await ctx.db.get(args.gridProjectId) as Doc<"gridProjects"> | null;
    if (!gridProject || gridProject.createdBy !== userId) {
      throw new Error("Grid project not found or access denied");
    }

    await ctx.db.delete(args.gridProjectId);
    return null;
  },
});

/**
 * Query to get archived grid projects for the authenticated user
 */
export const getArchivedGridProjects = query({
  args: {},
  returns: v.array(v.object({
    _id: v.id("gridProjects"),
    name: v.string(),
    description: v.optional(v.string()),
    createdBy: v.id("users"),
    documentIds: v.array(v.id("documents")),
    layout: v.object({
      cols: v.number(),
      rows: v.number(),
      gridClass: v.string(),
      name: v.string(),
    }),
    createdAt: v.number(),
    updatedAt: v.number(),
    isArchived: v.optional(v.boolean()),
  })),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    return await ctx.db
      .query("gridProjects")
      .withIndex("by_user_archived", (q) => 
        q.eq("createdBy", userId).eq("isArchived", true)
      )
      .order("desc")
      .collect();
  },
});