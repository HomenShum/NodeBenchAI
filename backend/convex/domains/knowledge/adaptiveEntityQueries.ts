/**
 * Adaptive Entity Profile Queries and Mutations
 *
 * Separated from the enrichment actions because queries/mutations cannot use "use node"
 */

import { v } from "convex/values";
import { query, internalMutation } from "../../_generated/server";
import { Doc } from "../../_generated/dataModel";

/**
 * Query an adaptive profile by entity name
 */
export const getAdaptiveProfile = query({
  args: {
    entityName: v.string(),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("adaptiveEntityProfiles")
      .withIndex("by_name", (q) => q.eq("entityName", args.entityName))
      .first() as Doc<"adaptiveEntityProfiles"> | null;

    return profile?.profile || null;
  },
});

/**
 * List all adaptive profiles (for debugging/admin)
 */
export const listAdaptiveProfiles = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    const profiles = await ctx.db
      .query("adaptiveEntityProfiles")
      .order("desc")
      .take(limit) as Doc<"adaptiveEntityProfiles">[];

    return profiles.map((p: Doc<"adaptiveEntityProfiles">) => ({
      entityName: p.entityName,
      entityType: p.entityType,
      completeness: p.completeness,
      confidence: p.confidence,
      updatedAt: p.updatedAt,
      version: p.version,
    }));
  },
});

/**
 * Search for adaptive profiles by type
 */
export const getProfilesByType = query({
  args: {
    entityType: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 10;
    const profiles = await ctx.db
      .query("adaptiveEntityProfiles")
      .withIndex("by_type", (q) => q.eq("entityType", args.entityType))
      .take(limit) as Doc<"adaptiveEntityProfiles">[];

    return profiles.map((p: Doc<"adaptiveEntityProfiles">) => ({
      entityName: p.entityName,
      entityType: p.entityType,
      headline: p.profile?.headline,
      completeness: p.completeness,
      updatedAt: p.updatedAt,
    }));
  },
});

/**
 * Get multiple adaptive profiles by entity names (batch fetch for digest enrichment)
 */
export const getAdaptiveProfilesBatch = query({
  args: {
    entityNames: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const results: Record<string, any> = {};

    // Fetch all profiles in parallel
    await Promise.all(
      args.entityNames.map(async (name: string) => {
        const profile = await ctx.db
          .query("adaptiveEntityProfiles")
          .withIndex("by_name", (q) => q.eq("entityName", name))
          .first() as Doc<"adaptiveEntityProfiles"> | null;

        if (profile?.profile) {
          results[name] = profile.profile;
        }
      })
    );

    return results;
  },
});

// ═══════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Store an adaptive profile (internal mutation called from enrichment action)
 */
export const storeAdaptiveProfile = internalMutation({
  args: {
    entityName: v.string(),
    profile: v.any(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if profile exists
    const existing = await ctx.db
      .query("adaptiveEntityProfiles")
      .withIndex("by_name", (q) => q.eq("entityName", args.entityName))
      .first() as Doc<"adaptiveEntityProfiles"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        profile: args.profile,
        updatedAt: now,
        version: (existing.version || 0) + 1,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("adaptiveEntityProfiles", {
        entityName: args.entityName,
        entityType: args.profile.entityType,
        profile: args.profile,
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
    }
  },
});
