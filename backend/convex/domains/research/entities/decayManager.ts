/**
 * Decay Manager - Entity Freshness Lifecycle Management
 * Deep Agents 3.0 - Automatic staleness detection and re-research triggering
 *
 * Features:
 * - Daily decay score updates
 * - Stale entity identification
 * - Automatic research queue integration
 * - Enrichment opportunity detection
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { DECAY_CONFIG, RESEARCH_CONFIG } from "../../../config/autonomousConfig";
import type { Doc, Id } from "../../../_generated/dataModel";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

interface DecayReport {
  totalEntities: number;
  freshCount: number;
  staleCount: number;
  criticalCount: number;
  queuedForResearch: number;
  avgDecayScore: number;
}

interface EnrichmentOpportunity {
  entityId: string;
  entityName: string;
  type: "stale" | "incomplete" | "contradicted" | "trending" | "requested";
  priority: number;
  suggestedActions: string[];
  estimatedCost: number;
}

/* ================================================================== */
/* QUERIES                                                             */
/* ================================================================== */

/**
 * Get entities that need decay score updates
 */
export const getEntitiesForDecayUpdate = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 500 }): Promise<Doc<"entityStates">[]> => {
    // Get entities that haven't been checked recently (> 1 hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    const entities = await ctx.db
      .query("entityStates")
      .order("asc")
      .take(limit * 2) as Doc<"entityStates">[];

    return entities
      .filter(
        (e: Doc<"entityStates">) => !e.freshness.lastChecked || e.freshness.lastChecked < oneHourAgo
      )
      .slice(0, limit);
  },
});

/**
 * Identify entities that should be queued for re-research
 */
export const getEntitiesForReresearch = internalQuery({
  args: {
    decayThreshold: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { decayThreshold = DECAY_CONFIG.staleThreshold, limit = 50 }): Promise<Doc<"entityStates">[]> => {
    const entities = await ctx.db
      .query("entityStates")
      .order("asc")
      .take(limit * 3) as Doc<"entityStates">[];

    // Filter for stale entities that aren't already queued
    const staleEntities = entities.filter(
      (e: Doc<"entityStates">) => e.freshness.decayScore < decayThreshold
    );

    // Check which ones already have queued research tasks
    const result: Doc<"entityStates">[] = [];
    for (const entity of staleEntities) {
      if (result.length >= limit) break;

      // Check for existing queued task
      const existingTask = await ctx.db
        .query("researchTasks")
        .withIndex("by_entity", (q) => q.eq("entityId", entity.entityId))
        .filter((q) =>
          q.or(
            q.eq(q.field("status"), "queued"),
            q.eq(q.field("status"), "researching")
          )
        )
        .first() as Doc<"researchTasks"> | null;

      if (!existingTask) {
        result.push(entity);
      }
    }

    return result;
  },
});

/* ================================================================== */
/* MUTATIONS                                                           */
/* ================================================================== */

/**
 * Batch update decay scores
 */
export const batchUpdateDecayScores = internalMutation({
  args: {
    entityIds: v.array(v.string()),
  },
  handler: async (ctx, { entityIds }): Promise<number> => {
    const now = Date.now();
    let updated = 0;

    for (const entityId of entityIds) {
      const entity = await ctx.db
        .query("entityStates")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .first() as Doc<"entityStates"> | null;

      if (!entity) continue;

      const daysSinceUpdate = (now - entity.freshness.lastUpdated) / (1000 * 60 * 60 * 24);
      const halfLifeDays = entity.freshness.decayHalfLifeDays || DECAY_CONFIG.decayHalfLifeDays;
      const decayScore = Math.pow(0.5, daysSinceUpdate / halfLifeDays);

      await ctx.db.patch(entity._id, {
        freshness: {
          ...entity.freshness,
          lastChecked: now,
          staleDays: Math.floor(daysSinceUpdate),
          decayScore: Math.max(0, Math.min(1, decayScore)),
        },
      });
      updated++;
    }

    return updated;
  },
});

/**
 * Queue stale entity for re-research
 */
export const queueForReresearch = internalMutation({
  args: {
    entityId: v.string(),
    entityName: v.string(),
    entityType: v.string(),
    priority: v.number(),
    personas: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"researchTasks">> => {
    return await ctx.db.insert("researchTasks", {
      entityId: args.entityId,
      entityName: args.entityName,
      entityType: args.entityType,
      personas: args.personas,
      primaryPersona: args.personas[0],
      priority: args.priority,
      priorityFactors: {
        stalenessBoost: Math.round((1 - args.priority / 100) * RESEARCH_CONFIG.priorityBoosts.stale60Days),
      },
      status: "queued",
      triggeredBy: "decay",
      retryCount: 0,
      createdAt: Date.now(),
    });
  },
});

/* ================================================================== */
/* ACTIONS                                                             */
/* ================================================================== */

/**
 * Calculate priority for stale entity research
 */
function calculateStalePriority(entity: Doc<"entityStates">): number {
  let priority = RESEARCH_CONFIG.basePriority;

  // Staleness boost (inverse of decay score)
  const stalenessBoost = Math.round((1 - entity.freshness.decayScore) * 30);
  priority += stalenessBoost;

  // Engagement boost
  const watchlistBoost = Math.min(
    entity.engagement.watchlistCount * RESEARCH_CONFIG.priorityBoosts.perWatchlistUser,
    RESEARCH_CONFIG.priorityBoosts.maxWatchlistBoost
  );
  priority += watchlistBoost;

  // Critical entities get extra boost
  if (entity.freshness.decayScore < DECAY_CONFIG.criticalThreshold) {
    priority += 20;
  }

  return Math.min(priority, 100);
}

/**
 * Process decay updates for a batch of entities
 */
export const processDecayUpdates = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 100 }): Promise<number> => {
    const entities = await ctx.runQuery(
      internal.domains.entities.decayManager.getEntitiesForDecayUpdate,
      { limit }
    );

    if (entities.length === 0) {
      return 0;
    }

    const entityIds = entities.map((e: Doc<"entityStates">) => e.entityId);
    const updated = await ctx.runMutation(
      internal.domains.entities.decayManager.batchUpdateDecayScores,
      { entityIds }
    );

    console.log(`[DecayManager] Updated decay scores for ${updated} entities`);
    return updated;
  },
});

/**
 * Queue stale entities for re-research
 */
export const queueStaleEntities = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 20 }): Promise<number> => {
    const staleEntities = await ctx.runQuery(
      internal.domains.entities.decayManager.getEntitiesForReresearch,
      { limit }
    );

    if (staleEntities.length === 0) {
      console.log("[DecayManager] No stale entities to queue");
      return 0;
    }

    let queued = 0;
    for (const entity of staleEntities) {
      const priority = calculateStalePriority(entity);

      // Default personas for re-research (can be customized per entity type)
      const personas = ["JPM_STARTUP_BANKER", "EARLY_STAGE_VC"];

      await ctx.runMutation(
        internal.domains.entities.decayManager.queueForReresearch,
        {
          entityId: entity.entityId,
          entityName: entity.canonicalName,
          entityType: entity.entityType,
          priority,
          personas,
        }
      );

      queued++;
      console.log(
        `[DecayManager] Queued ${entity.canonicalName} for re-research (decay: ${entity.freshness.decayScore.toFixed(2)}, priority: ${priority})`
      );
    }

    return queued;
  },
});

/**
 * Identify enrichment opportunities across all entities
 */
export const identifyEnrichmentOpportunities = internalAction({
  args: {},
  handler: async (ctx): Promise<EnrichmentOpportunity[]> => {
    const opportunities: EnrichmentOpportunity[] = [];

    // 1. Stale entities
    const staleEntities = await ctx.runQuery(
      internal.domains.entities.entityLifecycle.getStaleEntities,
      { decayThreshold: DECAY_CONFIG.staleThreshold, limit: 50 }
    );

    for (const entity of staleEntities) {
      opportunities.push({
        entityId: entity.entityId,
        entityName: entity.canonicalName,
        type: "stale",
        priority: Math.round((1 - entity.freshness.decayScore) * 100),
        suggestedActions: ["refreshNews", "updateMetrics", "verifyContacts"],
        estimatedCost: 5000, // tokens
      });
    }

    // 2. Incomplete entities
    const incompleteEntities = await ctx.runQuery(
      internal.domains.entities.entityLifecycle.getIncompleteEntities,
      { completenessThreshold: 70, limit: 50 }
    );

    for (const entity of incompleteEntities) {
      opportunities.push({
        entityId: entity.entityId,
        entityName: entity.canonicalName,
        type: "incomplete",
        priority: 100 - entity.completeness.score,
        suggestedActions: entity.completeness.enrichmentOpportunities,
        estimatedCost: 3000, // tokens
      });
    }

    // 3. Contradicted entities
    const contradictedEntities = await ctx.runQuery(
      internal.domains.entities.entityLifecycle.getContradictedEntities,
      { limit: 20 }
    );

    for (const entity of contradictedEntities) {
      opportunities.push({
        entityId: entity.entityId,
        entityName: entity.canonicalName,
        type: "contradicted",
        priority: 90, // High priority for data integrity
        suggestedActions: ["resolveContradictions", "verifyPrimarySources"],
        estimatedCost: 8000, // tokens
      });
    }

    // Sort by priority
    return opportunities.sort((a, b) => b.priority - a.priority);
  },
});

/**
 * Main decay check - called by daily cron
 */
export const checkAndQueueStale = internalAction({
  args: {},
  handler: async (ctx): Promise<DecayReport> => {
    console.log("[DecayManager] Starting daily decay check...");

    // 1. Update all decay scores
    const updated = await ctx.runAction(
      internal.domains.entities.decayManager.processDecayUpdates,
      { limit: 500 }
    );

    // 2. Get lifecycle stats
    const stats = await ctx.runQuery(
      internal.domains.entities.entityLifecycle.getLifecycleStats,
      {}
    );

    // 3. Queue stale entities for re-research
    const queued = await ctx.runAction(
      internal.domains.entities.decayManager.queueStaleEntities,
      { limit: 30 }
    );

    const report: DecayReport = {
      totalEntities: stats.total,
      freshCount: stats.fresh,
      staleCount: stats.stale,
      criticalCount: stats.critical,
      queuedForResearch: queued,
      avgDecayScore: stats.avgDecayScore,
    };

    console.log(
      `[DecayManager] Decay check complete. Total: ${report.totalEntities}, Fresh: ${report.freshCount}, Stale: ${report.staleCount}, Critical: ${report.criticalCount}, Queued: ${report.queuedForResearch}`
    );

    return report;
  },
});

/**
 * Tick function for hourly decay updates (lighter than daily)
 */
export const tickDecayUpdate = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    console.log("[DecayManager] Starting hourly decay update...");

    await ctx.runAction(
      internal.domains.entities.decayManager.processDecayUpdates,
      { limit: 100 }
    );

    console.log("[DecayManager] Hourly decay update complete.");
  },
});
