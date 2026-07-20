/**
 * Entity Linking Queries - Database queries for entity linking
 *
 * Separated from entityLinkingService.ts because queries cannot be
 * defined in Node.js files.
 *
 * @module domains/enrichment/entityLinkingQueries
 */

import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";

/**
 * Search for entity profile by name (fuzzy match via search index)
 */
export const searchProfileByName = internalQuery({
  args: {
    name: v.string(),
    entityType: v.optional(v.string()),
  },
  returns: v.array(v.object({
    _id: v.id("entityProfiles"),
    wikidataId: v.string(),
    canonicalName: v.string(),
    description: v.optional(v.string()),
    entityType: v.string(),
    score: v.number(),
  })),
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("entityProfiles")
      .withSearchIndex("search_name", (q) => {
        let query = q.search("canonicalName", args.name);
        if (args.entityType) {
          query = query.eq("entityType", args.entityType as any);
        }
        return query;
      })
      .take(5);

    return results.map((r, i) => ({
      _id: r._id,
      wikidataId: r.wikidataId,
      canonicalName: r.canonicalName,
      description: r.description,
      entityType: r.entityType,
      score: 1 - (i * 0.1), // Simple score based on position
    }));
  },
});

/**
 * Look up entity profile by Wikidata ID
 */
export const getProfileByWikidataId = internalQuery({
  args: { wikidataId: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("entityProfiles"),
      wikidataId: v.string(),
      entityType: v.string(),
      canonicalName: v.string(),
      description: v.optional(v.string()),
      aliases: v.optional(v.array(v.string())),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("entityProfiles")
      .withIndex("by_wikidataId", (q) => q.eq("wikidataId", args.wikidataId))
      .first();

    if (!profile) return null;

    return {
      _id: profile._id,
      wikidataId: profile.wikidataId,
      entityType: profile.entityType,
      canonicalName: profile.canonicalName,
      description: profile.description,
      aliases: profile.aliases,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  },
});
