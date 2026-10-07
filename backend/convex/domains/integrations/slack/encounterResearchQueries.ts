/**
 * Encounter Research Queries & Mutations
 *
 * Database operations for encounter research.
 * Separated from actions to comply with Convex runtime requirements.
 *
 * @module integrations/slack/encounterResearchQueries
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "../../../_generated/server";
import type { Id, Doc } from "../../../_generated/dataModel";

/**
 * Get cached research for an entity.
 */
export const getEntityResearchCache = internalQuery({
  args: {
    entityId: v.id("entityContexts"),
  },
  returns: v.union(
    v.null(),
    v.object({
      summary: v.optional(v.string()),
      keyFacts: v.optional(v.array(v.string())),
      updatedAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId) as Doc<"entityContexts"> | null;
    if (!entity) return null;

    return {
      summary: entity.summary,
      keyFacts: entity.keyFacts,
      // Use researchedAt as updatedAt since entityContexts doesn't have updatedAt
      updatedAt: entity.researchedAt,
    };
  },
});

/**
 * Create a research task for an entity.
 */
export const createResearchTask = internalMutation({
  args: {
    userId: v.id("users"),
    entityName: v.string(),
    entityType: v.union(v.literal("person"), v.literal("company")),
    encounterId: v.id("userEvents"),
  },
  returns: v.id("userEvents"),
  handler: async (ctx, args) => {
    const now = Date.now();

    const taskId = await ctx.db.insert("userEvents", {
      userId: args.userId,
      title: `Deep Research: ${args.entityName}`,
      description: `Comprehensive research for ${args.entityType}: ${args.entityName}`,
      status: "todo",
      priority: "high",
      tags: ["research", "deep-dive", args.entityType],
      refs: [{ kind: "userEvent", id: args.encounterId }],
      createdAt: now,
      updatedAt: now,
    });

    console.log(`[EncounterResearch] Created research task ${taskId} for ${args.entityName}`);
    return taskId;
  },
});

/**
 * Update entity context with new research.
 */
export const updateEntityWithResearch = internalMutation({
  args: {
    entityId: v.id("entityContexts"),
    summary: v.optional(v.string()),
    keyFacts: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      lastAccessedAt: Date.now(),
    };
    if (args.summary !== undefined) {
      patch.summary = args.summary;
    }
    if (args.keyFacts !== undefined) {
      patch.keyFacts = args.keyFacts;
    }
    await ctx.db.patch(args.entityId, patch as any);

    return null;
  },
});
