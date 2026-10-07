import { v } from "convex/values";
import { mutation, query, action, internalMutation } from "../../_generated/server";
import { api } from "../../_generated/api";
import { recomputeAndPersistDimensionProfile } from "./dimensionEngine";

const recomputeArgs = {
  entityKey: v.optional(v.string()),
  entityId: v.optional(v.id("entityContexts")),
  entityName: v.optional(v.string()),
  entityType: v.optional(v.string()),
  triggerEventKey: v.optional(v.string()),
};

export const recomputeDimensionProfileInternal = internalMutation({
  args: recomputeArgs,
  handler: async (ctx, args) => {
    return await recomputeAndPersistDimensionProfile(ctx, args);
  },
});

export const recomputeDimensionProfile = mutation({
  args: recomputeArgs,
  handler: async (ctx, args) => {
    return await recomputeAndPersistDimensionProfile(ctx, args);
  },
});

export const refreshDimensionProfile = action({
  args: recomputeArgs,
  handler: async (ctx, args) => {
    return await ctx.runMutation(api.domains.deepTrace.dimensions.recomputeDimensionProfile, args);
  },
});

export const getDimensionProfile = query({
  args: {
    entityKey: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("dimensionProfiles")
      .withIndex("by_entity", (q) => q.eq("entityKey", args.entityKey))
      .first();
  },
});

export const listDimensionSnapshots = query({
  args: {
    entityKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("dimensionSnapshots")
      .withIndex("by_entity_asOfDate", (q) => q.eq("entityKey", args.entityKey))
      .order("desc")
      .take(args.limit ?? 12);
  },
});

export const listDimensionEvidence = query({
  args: {
    entityKey: v.string(),
    dimensionFamily: v.optional(v.string()),
    dimensionName: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.dimensionFamily && args.dimensionName) {
      return await ctx.db
        .query("dimensionEvidence")
        .withIndex("by_entity_dimension_time", (q) =>
          q.eq("entityKey", args.entityKey).eq("dimensionFamily", args.dimensionFamily as any).eq("dimensionName", args.dimensionName),
        )
        .order("desc")
        .take(args.limit ?? 20);
    }

    const rows = await ctx.db
      .query("dimensionEvidence")
      .withIndex("by_entity_dimension_time", (q) => q.eq("entityKey", args.entityKey))
      .order("desc")
      .take(args.limit ?? 40);

    if (args.dimensionFamily) {
      return rows.filter((row) => row.dimensionFamily === args.dimensionFamily);
    }
    return rows;
  },
});

export const listDimensionInteractions = query({
  args: {
    entityKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("dimensionInteractions")
      .withIndex("by_entity_updated", (q) => q.eq("entityKey", args.entityKey))
      .order("desc")
      .take(args.limit ?? 16);
  },
});

export const getDimensionBundle = query({
  args: {
    entityKey: v.string(),
    snapshotLimit: v.optional(v.number()),
    evidenceLimit: v.optional(v.number()),
    interactionLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const [profile, snapshots, evidence, interactions] = await Promise.all([
      ctx.db
        .query("dimensionProfiles")
        .withIndex("by_entity", (q) => q.eq("entityKey", args.entityKey))
        .first(),
      ctx.db
        .query("dimensionSnapshots")
        .withIndex("by_entity_asOfDate", (q) => q.eq("entityKey", args.entityKey))
        .order("desc")
        .take(args.snapshotLimit ?? 12),
      ctx.db
        .query("dimensionEvidence")
        .withIndex("by_entity_dimension_time", (q) => q.eq("entityKey", args.entityKey))
        .order("desc")
        .take(args.evidenceLimit ?? 48),
      ctx.db
        .query("dimensionInteractions")
        .withIndex("by_entity_updated", (q) => q.eq("entityKey", args.entityKey))
        .order("desc")
        .take(args.interactionLimit ?? 16),
    ]);

    return {
      profile,
      snapshots,
      evidence,
      interactions,
    };
  },
});
