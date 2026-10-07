/**
 * Entity Lifecycle Management - Comprehensive Entity State Tracking
 * Deep Agents 3.0 - Manages entity freshness, completeness, and quality
 *
 * Features:
 * - Decay scoring with exponential decay
 * - Completeness assessment
 * - Quality tracking with persona scores
 * - Engagement metrics
 * - Research history
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { DECAY_CONFIG, type PersonaId } from "../../../config/autonomousConfig";
import type { Doc, Id } from "../../../_generated/dataModel";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

export interface EntityFreshness {
  lastUpdated: number;
  lastChecked?: number;
  staleDays: number;
  decayScore: number;
  decayHalfLifeDays?: number;
}

export interface EntityCompleteness {
  score: number;
  missingFields: string[];
  enrichmentOpportunities: string[];
  lastAssessed: number;
}

export interface EntityQuality {
  overallScore: number;
  personaScores?: Record<string, number>;
  sourceCount: number;
  contradictionCount: number;
  lastValidated: number;
}

export interface EntityEngagement {
  viewCount: number;
  watchlistCount: number;
  lastViewed?: number;
  trendingScore?: number;
}

/* ================================================================== */
/* UTILITY FUNCTIONS                                                   */
/* ================================================================== */

/**
 * Calculate decay score using exponential decay
 */
export function calculateDecayScore(
  lastUpdated: number,
  entityType?: string,
  customHalfLife?: number
): number {
  const now = Date.now();
  const daysSinceUpdate = (now - lastUpdated) / (1000 * 60 * 60 * 24);

  // Get half-life based on entity type or custom value
  const halfLifeDays =
    customHalfLife ||
    (entityType
      ? DECAY_CONFIG.entityTypeHalfLives[entityType as keyof typeof DECAY_CONFIG.entityTypeHalfLives]
      : DECAY_CONFIG.decayHalfLifeDays) ||
    DECAY_CONFIG.decayHalfLifeDays;

  // Exponential decay: score = 0.5^(days/halfLife)
  const decayScore = Math.pow(0.5, daysSinceUpdate / halfLifeDays);

  return Math.max(0, Math.min(1, decayScore));
}

/**
 * Determine required fields based on entity type and persona
 */
function getRequiredFields(
  entityType: string,
  personaId?: string
): string[] {
  const baseFields: Record<string, string[]> = {
    company: ["name", "description", "funding", "hq", "website"],
    person: ["name", "title", "organization", "linkedin"],
    topic: ["name", "description", "relatedEntities"],
    product: ["name", "company", "description", "status"],
    event: ["name", "date", "location", "description"],
  };

  const personaFields: Record<string, string[]> = {
    JPM_STARTUP_BANKER: ["funding", "contact", "verdict", "nextActions"],
    EARLY_STAGE_VC: ["thesis", "comps", "tam", "whyNow"],
    CTO_TECH_LEAD: ["exposure", "impact", "mitigations", "verification"],
    ACADEMIC_RD: ["methodology", "findings", "citations", "gaps"],
    PHARMA_BD: ["pipeline", "fdaStatus", "trials", "partnerships"],
  };

  const fields = [...(baseFields[entityType] || [])];
  if (personaId && personaFields[personaId]) {
    fields.push(...personaFields[personaId]);
  }

  return [...new Set(fields)];
}

/**
 * Assess completeness of entity data
 */
function assessCompleteness(
  entityId: string,
  entityType: string,
  data: Record<string, unknown>,
  primaryPersona?: string
): EntityCompleteness {
  const requiredFields = getRequiredFields(entityType, primaryPersona);
  const missingFields: string[] = [];
  const enrichmentOpportunities: string[] = [];

  for (const field of requiredFields) {
    if (!data[field] || data[field] === "") {
      missingFields.push(field);
    }
  }

  // Suggest enrichment opportunities based on missing fields
  if (missingFields.includes("funding")) {
    enrichmentOpportunities.push("fetchFundingData");
  }
  if (missingFields.includes("contact")) {
    enrichmentOpportunities.push("findContactInfo");
  }
  if (missingFields.includes("linkedin")) {
    enrichmentOpportunities.push("linkedinSearch");
  }

  const score = Math.round(
    ((requiredFields.length - missingFields.length) / requiredFields.length) * 100
  );

  return {
    score,
    missingFields,
    enrichmentOpportunities,
    lastAssessed: Date.now(),
  };
}

/* ================================================================== */
/* QUERIES                                                             */
/* ================================================================== */

/**
 * Get entity state by ID
 */
export const getEntityState = internalQuery({
  args: { entityId: v.string() },
  handler: async (ctx, { entityId }): Promise<Doc<"entityStates"> | null> => {
    return await ctx.db
      .query("entityStates")
      .withIndex("by_entity", (q) => q.eq("entityId", entityId))
      .first() as Doc<"entityStates"> | null;
  },
});

/**
 * Get stale entities (decay score below threshold)
 */
export const getStaleEntities = internalQuery({
  args: {
    decayThreshold: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { decayThreshold = DECAY_CONFIG.staleThreshold, limit = 100 }): Promise<Doc<"entityStates">[]> => {
    // Note: We need to filter in memory since Convex doesn't support < queries on nested fields in indexes
    const entities = await ctx.db
      .query("entityStates")
      .order("asc")
      .take(limit * 2) as Doc<"entityStates">[];

    return entities
      .filter((e: Doc<"entityStates">) => e.freshness.decayScore < decayThreshold)
      .slice(0, limit);
  },
});

/**
 * Get critical entities (very stale)
 */
export const getCriticalEntities = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 50 }): Promise<Doc<"entityStates">[]> => {
    const entities = await ctx.db
      .query("entityStates")
      .order("asc")
      .take(limit * 2) as Doc<"entityStates">[];

    return entities
      .filter((e: Doc<"entityStates">) => e.freshness.decayScore < DECAY_CONFIG.criticalThreshold)
      .slice(0, limit);
  },
});

/**
 * Get incomplete entities
 */
export const getIncompleteEntities = internalQuery({
  args: {
    completenessThreshold: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { completenessThreshold = 70, limit = 100 }): Promise<Doc<"entityStates">[]> => {
    const entities = await ctx.db
      .query("entityStates")
      .order("asc")
      .take(limit * 2) as Doc<"entityStates">[];

    return entities
      .filter((e: Doc<"entityStates">) => e.completeness.score < completenessThreshold)
      .slice(0, limit);
  },
});

/**
 * Get entities with unresolved contradictions
 */
export const getContradictedEntities = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 50 }): Promise<Doc<"entityStates">[]> => {
    const entities = await ctx.db
      .query("entityStates")
      .order("desc")
      .take(limit * 2) as Doc<"entityStates">[];

    return entities
      .filter((e: Doc<"entityStates">) => e.quality.contradictionCount > 0)
      .slice(0, limit);
  },
});

/**
 * Get entity lifecycle stats
 */
export const getLifecycleStats = internalQuery({
  args: {},
  handler: async (ctx): Promise<{
    total: number;
    fresh: number;
    stale: number;
    critical: number;
    avgDecayScore: number;
    avgCompleteness: number;
    avgQuality: number;
    byType: Record<string, number>;
  }> => {
    const entities = await ctx.db.query("entityStates").collect() as Doc<"entityStates">[];

    const stats = {
      total: entities.length,
      fresh: 0,
      stale: 0,
      critical: 0,
      avgDecayScore: 0,
      avgCompleteness: 0,
      avgQuality: 0,
      byType: {} as Record<string, number>,
    };

    if (entities.length === 0) {
      return stats;
    }

    let totalDecay = 0;
    let totalCompleteness = 0;
    let totalQuality = 0;

    for (const entity of entities) {
      totalDecay += entity.freshness.decayScore;
      totalCompleteness += entity.completeness.score;
      totalQuality += entity.quality.overallScore;

      if (entity.freshness.decayScore >= DECAY_CONFIG.staleThreshold) {
        stats.fresh++;
      } else if (entity.freshness.decayScore >= DECAY_CONFIG.criticalThreshold) {
        stats.stale++;
      } else {
        stats.critical++;
      }

      stats.byType[entity.entityType] = (stats.byType[entity.entityType] || 0) + 1;
    }

    stats.avgDecayScore = totalDecay / entities.length;
    stats.avgCompleteness = totalCompleteness / entities.length;
    stats.avgQuality = totalQuality / entities.length;

    return stats;
  },
});

/**
 * Public query for lifecycle stats (for UI dashboard)
 */
export const getPublicLifecycleStats = query({
  args: {},
  handler: async (ctx) => {
    const entities = await ctx.db.query("entityStates").collect() as Doc<"entityStates">[];

    return {
      total: entities.length,
      fresh: entities.filter((e: Doc<"entityStates">) => e.freshness.decayScore >= DECAY_CONFIG.staleThreshold).length,
      stale: entities.filter(
        (e: Doc<"entityStates">) =>
          e.freshness.decayScore < DECAY_CONFIG.staleThreshold &&
          e.freshness.decayScore >= DECAY_CONFIG.criticalThreshold
      ).length,
      critical: entities.filter((e: Doc<"entityStates">) => e.freshness.decayScore < DECAY_CONFIG.criticalThreshold).length,
    };
  },
});

/* ================================================================== */
/* MUTATIONS                                                           */
/* ================================================================== */

/**
 * Create or update entity state
 */
export const upsertEntityState = internalMutation({
  args: {
    entityId: v.string(),
    canonicalName: v.string(),
    entityType: v.string(),
    aliases: v.optional(v.array(v.string())),
    data: v.optional(v.any()),
    primaryPersona: v.optional(v.string()),
    sourceCount: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"entityStates">> => {
    const existing = await ctx.db
      .query("entityStates")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .first() as Doc<"entityStates"> | null;

    const now = Date.now();
    const decayScore = calculateDecayScore(now, args.entityType);
    const completeness = assessCompleteness(
      args.entityId,
      args.entityType,
      args.data || {},
      args.primaryPersona
    );

    if (existing) {
      // Update existing
      await ctx.db.patch(existing._id, {
        canonicalName: args.canonicalName,
        aliases: args.aliases || existing.aliases,
        freshness: {
          lastUpdated: now,
          lastChecked: now,
          staleDays: 0,
          decayScore,
          decayHalfLifeDays: existing.freshness.decayHalfLifeDays,
        },
        completeness,
        quality: {
          ...existing.quality,
          sourceCount: args.sourceCount || existing.quality.sourceCount,
          lastValidated: now,
        },
        updatedAt: now,
      });
      return existing._id;
    }

    // Create new
    return await ctx.db.insert("entityStates", {
      entityId: args.entityId,
      canonicalName: args.canonicalName,
      aliases: args.aliases || [],
      entityType: args.entityType,
      freshness: {
        lastUpdated: now,
        lastChecked: now,
        staleDays: 0,
        decayScore,
      },
      completeness,
      quality: {
        overallScore: 50, // Default starting score
        sourceCount: args.sourceCount || 0,
        contradictionCount: 0,
        lastValidated: now,
      },
      engagement: {
        viewCount: 0,
        watchlistCount: 0,
      },
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Update decay scores for all entities
 */
export const updateAllDecayScores = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ updated: number }> => {
    const entities = await ctx.db.query("entityStates").collect() as Doc<"entityStates">[];
    const now = Date.now();
    let updated = 0;

    for (const entity of entities) {
      const decayScore = calculateDecayScore(
        entity.freshness.lastUpdated,
        entity.entityType,
        entity.freshness.decayHalfLifeDays
      );
      const staleDays = Math.floor(
        (now - entity.freshness.lastUpdated) / (1000 * 60 * 60 * 24)
      );

      await ctx.db.patch(entity._id, {
        freshness: {
          ...entity.freshness,
          lastChecked: now,
          staleDays,
          decayScore,
        },
      });
      updated++;
    }

    return { updated };
  },
});

/**
 * Update entity quality score
 */
export const updateQualityScore = internalMutation({
  args: {
    entityId: v.string(),
    overallScore: v.optional(v.number()),
    personaScores: v.optional(v.any()),
    sourceCount: v.optional(v.number()),
    contradictionCount: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const entity = await ctx.db
      .query("entityStates")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .first() as Doc<"entityStates"> | null;

    if (!entity) return;

    const updates: Partial<Doc<"entityStates">["quality"]> = {
      lastValidated: Date.now(),
    };

    if (args.overallScore !== undefined) updates.overallScore = args.overallScore;
    if (args.personaScores !== undefined) updates.personaScores = args.personaScores;
    if (args.sourceCount !== undefined) updates.sourceCount = args.sourceCount;
    if (args.contradictionCount !== undefined) updates.contradictionCount = args.contradictionCount;

    await ctx.db.patch(entity._id, {
      quality: { ...entity.quality, ...updates },
      updatedAt: Date.now(),
    });
  },
});

/**
 * Record entity engagement event
 */
export const recordEngagement = internalMutation({
  args: {
    entityId: v.string(),
    eventType: v.union(v.literal("view"), v.literal("watchlist_add"), v.literal("watchlist_remove")),
  },
  handler: async (ctx, { entityId, eventType }): Promise<void> => {
    const entity = await ctx.db
      .query("entityStates")
      .withIndex("by_entity", (q) => q.eq("entityId", entityId))
      .first() as Doc<"entityStates"> | null;

    if (!entity) return;

    const updates: Partial<Doc<"entityStates">["engagement"]> = {};

    switch (eventType) {
      case "view":
        updates.viewCount = entity.engagement.viewCount + 1;
        updates.lastViewed = Date.now();
        break;
      case "watchlist_add":
        updates.watchlistCount = entity.engagement.watchlistCount + 1;
        break;
      case "watchlist_remove":
        updates.watchlistCount = Math.max(0, entity.engagement.watchlistCount - 1);
        break;
    }

    await ctx.db.patch(entity._id, {
      engagement: { ...entity.engagement, ...updates },
      updatedAt: Date.now(),
    });
  },
});

/**
 * Add research task to entity history
 */
export const addResearchHistory = internalMutation({
  args: {
    entityId: v.string(),
    taskId: v.id("researchTasks"),
    qualityScore: v.number(),
    personas: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const entity = await ctx.db
      .query("entityStates")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .first() as Doc<"entityStates"> | null;

    if (!entity) return;

    const history = entity.researchHistory || [];
    history.push({
      taskId: args.taskId,
      completedAt: Date.now(),
      qualityScore: args.qualityScore,
      personas: args.personas,
    });

    // Keep only last 10 entries
    const trimmedHistory = history.slice(-10);

    await ctx.db.patch(entity._id, {
      researchHistory: trimmedHistory,
      updatedAt: Date.now(),
    });
  },
});
