/**
 * Encounter Entity Resolver
 *
 * Resolves extracted entities against existing entityContexts research.
 * Links encounters to known people and companies.
 *
 * @module integrations/slack/encounterResolver
 */

import { v } from "convex/values";
import { internalAction, internalQuery, internalMutation } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Id, Doc } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface ParsedParticipant {
  name: string;
  role?: string;
  company?: string;
}

interface ResolvedParticipant extends ParsedParticipant {
  linkedEntityId?: Id<"entityContexts">;
  existingResearch?: boolean;
}

interface ResolvedCompany {
  name: string;
  linkedEntityId?: Id<"entityContexts">;
  existingResearch?: boolean;
}

interface ResolvedEncounter {
  participants: ResolvedParticipant[];
  companies: ResolvedCompany[];
  newEntities: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN RESOLVER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve parsed entities against existing research.
 */
export const resolveEncounterEntities = internalAction({
  args: {
    parsed: v.object({
      participants: v.array(v.object({
        name: v.string(),
        role: v.optional(v.string()),
        company: v.optional(v.string()),
      })),
      companies: v.array(v.string()),
      context: v.optional(v.string()),
      followUpRequested: v.boolean(),
      confidence: v.number(),
    }),
    userId: v.id("users"),
  },
  returns: v.object({
    participants: v.array(v.object({
      name: v.string(),
      role: v.optional(v.string()),
      company: v.optional(v.string()),
      linkedEntityId: v.optional(v.id("entityContexts")),
      existingResearch: v.optional(v.boolean()),
    })),
    companies: v.array(v.object({
      name: v.string(),
      linkedEntityId: v.optional(v.id("entityContexts")),
      existingResearch: v.optional(v.boolean()),
    })),
    newEntities: v.array(v.string()),
  }),
  handler: async (ctx, args): Promise<ResolvedEncounter> => {
    const { parsed, userId } = args;
    console.log(`[EncounterResolver] Resolving ${parsed.participants.length} participants, ${parsed.companies.length} companies`);

    const resolvedParticipants: ResolvedParticipant[] = [];
    const resolvedCompanies: ResolvedCompany[] = [];
    const newEntities: string[] = [];

    // ─── Resolve Participants ──────────────────────────────────────────────
    for (const participant of parsed.participants) {
      // Try to find existing entity by name
      const entity = await ctx.runQuery(
        internal.domains.integrations.slack.encounterResolver.findEntityByName,
        {
          name: participant.name,
          entityType: "person",
          userId,
        }
      );

      if (entity) {
        resolvedParticipants.push({
          ...participant,
          linkedEntityId: entity._id,
          existingResearch: true,
        });

        // Update access count for frequently accessed entities
        await ctx.runMutation(
          internal.domains.integrations.slack.encounterResolver.updateEntityAccessCount,
          { entityId: entity._id }
        );

        console.log(`[EncounterResolver] Linked participant "${participant.name}" to existing entity`);
      } else {
        resolvedParticipants.push(participant);
        newEntities.push(`person:${participant.name}`);
        console.log(`[EncounterResolver] New participant: "${participant.name}"`);
      }
    }

    // ─── Resolve Companies ─────────────────────────────────────────────────
    for (const companyName of parsed.companies) {
      const entity = await ctx.runQuery(
        internal.domains.integrations.slack.encounterResolver.findEntityByName,
        {
          name: companyName,
          entityType: "company",
          userId,
        }
      );

      if (entity) {
        resolvedCompanies.push({
          name: companyName,
          linkedEntityId: entity._id,
          existingResearch: true,
        });

        await ctx.runMutation(
          internal.domains.integrations.slack.encounterResolver.updateEntityAccessCount,
          { entityId: entity._id }
        );

        console.log(`[EncounterResolver] Linked company "${companyName}" to existing entity`);
      } else {
        resolvedCompanies.push({ name: companyName });
        newEntities.push(`company:${companyName}`);
        console.log(`[EncounterResolver] New company: "${companyName}"`);
      }
    }

    console.log(`[EncounterResolver] Resolved: ${resolvedParticipants.filter(p => p.linkedEntityId).length}/${resolvedParticipants.length} participants, ${resolvedCompanies.filter(c => c.linkedEntityId).length}/${resolvedCompanies.length} companies`);

    return {
      participants: resolvedParticipants,
      companies: resolvedCompanies,
      newEntities,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find entity by name with fuzzy matching.
 */
export const findEntityByName = internalQuery({
  args: {
    name: v.string(),
    entityType: v.union(v.literal("person"), v.literal("company")),
    userId: v.id("users"),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("entityContexts"),
      entityName: v.string(),
      entityType: v.string(),
    })
  ),
  handler: async (ctx, args): Promise<{ _id: Id<"entityContexts">; entityName: string; entityType: string } | null> => {
    const nameLower = args.name.toLowerCase();

    // Try exact match first
    const exactMatch = await ctx.db
      .query("entityContexts")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("entityType"), args.entityType)
        )
      )
      .collect();

    // Find best match
    for (const entity of exactMatch) {
      const entityNameLower = entity.entityName.toLowerCase();

      // Exact match
      if (entityNameLower === nameLower) {
        return {
          _id: entity._id,
          entityName: entity.entityName,
          entityType: entity.entityType,
        };
      }

      // Partial match (name contained in entity or vice versa)
      if (entityNameLower.includes(nameLower) || nameLower.includes(entityNameLower)) {
        return {
          _id: entity._id,
          entityName: entity.entityName,
          entityType: entity.entityType,
        };
      }
    }

    // Try fuzzy matching with first/last name for people
    if (args.entityType === "person") {
      const nameParts = args.name.split(/\s+/);
      if (nameParts.length >= 2) {
        const firstName = nameParts[0].toLowerCase();
        const lastName = nameParts[nameParts.length - 1].toLowerCase();

        for (const entity of exactMatch) {
          const entityParts = entity.entityName.toLowerCase().split(/\s+/);
          if (entityParts.length >= 2) {
            const entityFirst = entityParts[0];
            const entityLast = entityParts[entityParts.length - 1];

            // Match if first and last names match
            if (entityFirst === firstName && entityLast === lastName) {
              return {
                _id: entity._id,
                entityName: entity.entityName,
                entityType: entity.entityType,
              };
            }
          }
        }
      }
    }

    return null;
  },
});

/**
 * Update entity access count for tracking frequently accessed entities.
 */
export const updateEntityAccessCount = internalMutation({
  args: {
    entityId: v.id("entityContexts"),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // This would update an accessCount field if it exists
    // For now, we just log the access
    console.log(`[EncounterResolver] Entity accessed: ${args.entityId}`);
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get recent entities for a user.
 */
export const getRecentEntities = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({
    _id: v.id("entityContexts"),
    entityName: v.string(),
    entityType: v.string(),
    updatedAt: v.optional(v.number()),
  })),
  handler: async (ctx, args) => {
    const limit = args.limit || 20;

    const entities = await ctx.db
      .query("entityContexts")
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .order("desc")
      .take(limit);

    return entities.map((e: Doc<"entityContexts">) => ({
      _id: e._id,
      entityName: e.entityName,
      entityType: e.entityType,
      updatedAt: e.updatedAt,
    }));
  },
});

/**
 * Search entities by partial name.
 */
export const searchEntitiesByName = internalQuery({
  args: {
    userId: v.id("users"),
    query: v.string(),
    entityType: v.optional(v.union(v.literal("person"), v.literal("company"))),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({
    _id: v.id("entityContexts"),
    entityName: v.string(),
    entityType: v.string(),
    score: v.number(),
  })),
  handler: async (ctx, args) => {
    const queryLower = args.query.toLowerCase();
    const limit = args.limit || 10;

    let query = ctx.db
      .query("entityContexts")
      .filter((q) => q.eq(q.field("userId"), args.userId));

    if (args.entityType) {
      query = query.filter((q) => q.eq(q.field("entityType"), args.entityType));
    }

    const entities = await query.collect();

    // Score and filter matches
    const scored = entities
      .map((e: Doc<"entityContexts">) => {
        const nameLower = e.entityName.toLowerCase();
        let score = 0;

        if (nameLower === queryLower) {
          score = 1.0; // Exact match
        } else if (nameLower.startsWith(queryLower)) {
          score = 0.8; // Prefix match
        } else if (nameLower.includes(queryLower)) {
          score = 0.5; // Contains match
        } else if (queryLower.split(/\s+/).some((part: string) => nameLower.includes(part))) {
          score = 0.3; // Partial word match
        }

        return {
          _id: e._id,
          entityName: e.entityName,
          entityType: e.entityType,
          score,
        };
      })
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  },
});
