/**
 * Entity Linking Mutations - Database mutations for entity linking
 *
 * Separated from entityLinkingService.ts because mutations cannot be
 * defined in Node.js files.
 *
 * @module domains/enrichment/entityLinkingMutations
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";

/**
 * Create or update entity profile
 */
export const upsertEntityProfile = internalMutation({
  args: {
    wikidataId: v.string(),
    entityType: v.union(
      v.literal("person"),
      v.literal("company"),
      v.literal("organization"),
      v.literal("location"),
      v.literal("other")
    ),
    canonicalName: v.string(),
    description: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
  },
  returns: v.id("entityProfiles"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("entityProfiles")
      .withIndex("by_wikidataId", (q) => q.eq("wikidataId", args.wikidataId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        canonicalName: args.canonicalName,
        description: args.description,
        aliases: args.aliases,
        updatedAt: now,
        mentionCount: (existing.mentionCount || 0) + 1,
        lastMentionedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("entityProfiles", {
      wikidataId: args.wikidataId,
      entityType: args.entityType,
      canonicalName: args.canonicalName,
      description: args.description,
      aliases: args.aliases,
      createdAt: now,
      updatedAt: now,
      mentionCount: 1,
      lastMentionedAt: now,
    });
  },
});

/**
 * Record an entity mention
 */
export const recordEntityMention = internalMutation({
  args: {
    entityId: v.id("entityProfiles"),
    wikidataId: v.string(),
    sourceType: v.union(
      v.literal("linkedinFundingPost"),
      v.literal("feedItem"),
      v.literal("narrativeEvent"),
      v.literal("narrativePost"),
      v.literal("document")
    ),
    sourceId: v.string(),
    mentionType: v.union(
      v.literal("primary"),
      v.literal("secondary"),
      v.literal("investor"),
      v.literal("partner"),
      v.literal("competitor")
    ),
    extractedName: v.string(),
    context: v.optional(v.string()),
    confidence: v.number(),
  },
  returns: v.id("entityMentions"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("entityMentions", {
      entityId: args.entityId,
      wikidataId: args.wikidataId,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      mentionType: args.mentionType,
      extractedName: args.extractedName,
      context: args.context,
      confidence: args.confidence,
      createdAt: Date.now(),
    });
  },
});
