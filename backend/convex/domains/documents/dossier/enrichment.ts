/**
 * Dossier Enrichment - Mutations/Queries
 * 
 * Manages cached context for data points.
 * When agent enriches a data point, the result is cached here for quick retrieval.
 */

import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc } from "../../../_generated/dataModel";

const entitySchema = v.object({
  name: v.string(),
  type: v.string(),
  url: v.optional(v.string()),
});

const sourceSchema = v.object({
  url: v.string(),
  title: v.optional(v.string()),
  retrievedAt: v.number(),
});

const enrichmentFields = {
  briefId: v.string(),
  seriesId: v.optional(v.string()),
  dataIndex: v.number(),
  title: v.string(),
  context: v.string(),
  entities: v.optional(v.array(entitySchema)),
  sources: v.optional(v.array(sourceSchema)),
  agentThreadId: v.optional(v.string()),
  expiresAt: v.optional(v.number()),
};

/**
 * Get enrichment for a specific data point
 */
export const getEnrichment = query({
  args: {
    briefId: v.string(),
    dataIndex: v.number(),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("dossierEnrichment"),
      userId: v.id("users"),
      ...enrichmentFields,
      createdAt: v.number(),
      lastAccessedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const enrichment = await ctx.db
      .query("dossierEnrichment")
      .withIndex("by_brief_dataIndex", (q) =>
        q.eq("briefId", args.briefId).eq("dataIndex", args.dataIndex)
      )
      .first() as Doc<"dossierEnrichment"> | null;

    // Check if expired
    if (enrichment && enrichment.expiresAt && enrichment.expiresAt < Date.now()) {
      return null;
    }

    return enrichment;
  },
});

/**
 * Get all enrichments for a brief
 */
export const getEnrichments = query({
  args: {
    briefId: v.string(),
  },
  returns: v.array(v.object({
    _id: v.id("dossierEnrichment"),
    userId: v.id("users"),
    ...enrichmentFields,
    createdAt: v.number(),
    lastAccessedAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const enrichments = await ctx.db
      .query("dossierEnrichment")
      .withIndex("by_user_brief", (q) => q.eq("userId", userId).eq("briefId", args.briefId))
      .collect();

    // Filter out expired
    const now = Date.now();
    return enrichments.filter((e) => !e.expiresAt || e.expiresAt > now);
  },
});

/**
 * Add or update enrichment for a data point
 */
export const addEnrichment = mutation({
  args: enrichmentFields,
  returns: v.id("dossierEnrichment"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check for existing enrichment
    const existing = await ctx.db
      .query("dossierEnrichment")
      .withIndex("by_brief_dataIndex", (q) =>
        q.eq("briefId", args.briefId).eq("dataIndex", args.dataIndex)
      )
      .first() as Doc<"dossierEnrichment"> | null;

    const now = Date.now();

    if (existing && existing.userId === userId) {
      // Update existing
      await ctx.db.patch(existing._id, {
        ...args,
        lastAccessedAt: now,
      });
      return existing._id;
    }

    // Create new
    return ctx.db.insert("dossierEnrichment", {
      userId,
      ...args,
      createdAt: now,
      lastAccessedAt: now,
    });
  },
});

/**
 * Internal mutation for agent tools to add enrichment
 */
export const addEnrichmentInternal = internalMutation({
  args: {
    userId: v.id("users"),
    ...enrichmentFields,
  },
  returns: v.id("dossierEnrichment"),
  handler: async (ctx, args) => {
    const { userId, ...rest } = args;
    const now = Date.now();

    // Check for existing
    const existing = await ctx.db
      .query("dossierEnrichment")
      .withIndex("by_brief_dataIndex", (q) =>
        q.eq("briefId", args.briefId).eq("dataIndex", args.dataIndex)
      )
      .first() as Doc<"dossierEnrichment"> | null;

    if (existing && existing.userId === userId) {
      await ctx.db.patch(existing._id, {
        ...rest,
        lastAccessedAt: now,
      });
      return existing._id;
    }

    return ctx.db.insert("dossierEnrichment", {
      userId,
      ...rest,
      createdAt: now,
      lastAccessedAt: now,
    });
  },
});

/**
 * Internal query for agent tools to get enrichment
 */
export const getEnrichmentInternal = internalQuery({
  args: {
    userId: v.id("users"),
    briefId: v.string(),
    dataIndex: v.number(),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("dossierEnrichment"),
      userId: v.id("users"),
      briefId: v.string(),
      seriesId: v.optional(v.string()),
      dataIndex: v.number(),
      title: v.string(),
      context: v.string(),
      entities: v.optional(v.array(v.object({
        name: v.string(),
        type: v.string(),
        url: v.optional(v.string()),
      }))),
      sources: v.optional(v.array(v.object({
        url: v.string(),
        title: v.optional(v.string()),
        retrievedAt: v.number(),
      }))),
      agentThreadId: v.optional(v.string()),
      expiresAt: v.optional(v.number()),
      createdAt: v.number(),
      lastAccessedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const enrichment = await ctx.db
      .query("dossierEnrichment")
      .withIndex("by_brief_dataIndex", (q) =>
        q.eq("briefId", args.briefId).eq("dataIndex", args.dataIndex)
      )
      .first() as Doc<"dossierEnrichment"> | null;

    // Check if expired
    if (enrichment && enrichment.expiresAt && enrichment.expiresAt < Date.now()) {
      return null;
    }

    // Check user ownership
    if (enrichment && enrichment.userId !== args.userId) {
      return null;
    }

    return enrichment;
  },
});
