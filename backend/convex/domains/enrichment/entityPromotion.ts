/**
 * Entity Promotion
 *
 * Promotes funding events to first-class entities in entityContexts.
 * Links funding events to existing entities or creates new ones.
 */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Doc, Id } from "../../_generated/dataModel";

/**
 * Promote a funding event to an entity context.
 */
export const promoteToEntity = internalAction({
  args: {
    fundingEventId: v.id("fundingEvents"),
    forceCreate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Get the funding event
    const fundingEvent = await ctx.runQuery(
      internal.domains.enrichment.entityPromotion.getFundingEventInternal,
      { fundingEventId: args.fundingEventId }
    );

    if (!fundingEvent) {
      throw new Error(`Funding event not found: ${args.fundingEventId}`);
    }

    // Already linked to an entity
    if (fundingEvent.companyId && !args.forceCreate) {
      return {
        promoted: false,
        reason: "Already linked to entity",
        entityId: fundingEvent.companyId,
      };
    }

    // Search for existing entity by company name
    const existingEntity = await ctx.runQuery(
      internal.domains.enrichment.entityPromotion.findEntityByName,
      { companyName: fundingEvent.companyName }
    );

    if (existingEntity) {
      // Link funding event to existing entity
      await ctx.runMutation(
        internal.domains.enrichment.fundingMutations.linkToEntity,
        {
          fundingEventId: args.fundingEventId,
          entityId: existingEntity._id,
        }
      );

      // Update entity with funding info
      await ctx.runMutation(
        internal.domains.enrichment.entityPromotion.updateEntityWithFunding,
        {
          entityId: existingEntity._id,
          fundingEventId: args.fundingEventId,
          roundType: fundingEvent.roundType,
          amountUsd: fundingEvent.amountUsd,
          investors: fundingEvent.leadInvestors,
        }
      );

      return {
        promoted: true,
        created: false,
        entityId: existingEntity._id,
        entityName: existingEntity.name,
      };
    }

    // Create new entity from funding event
    const entityId = await ctx.runMutation(
      internal.domains.enrichment.entityPromotion.createEntityFromFunding,
      {
        fundingEventId: args.fundingEventId,
        companyName: fundingEvent.companyName,
        sector: fundingEvent.sector,
        description: fundingEvent.description,
        roundType: fundingEvent.roundType,
        amountUsd: fundingEvent.amountUsd,
        investors: fundingEvent.leadInvestors,
        sourceUrl: fundingEvent.sourceUrls[0],
      }
    );

    // Link funding event to new entity
    await ctx.runMutation(
      internal.domains.enrichment.fundingMutations.linkToEntity,
      {
        fundingEventId: args.fundingEventId,
        entityId,
      }
    );

    return {
      promoted: true,
      created: true,
      entityId,
      entityName: fundingEvent.companyName,
    };
  },
});

/**
 * Query helper to get funding event.
 */
export const getFundingEventInternal = internalQuery({
  args: {
    fundingEventId: v.id("fundingEvents"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.fundingEventId);
  },
});

/**
 * Find existing entity by company name.
 */
export const findEntityByName = internalQuery({
  args: {
    companyName: v.string(),
  },
  handler: async (ctx, args) => {
    // First try exact match
    const exact = await ctx.db
      .query("entityContexts")
      .withIndex("by_name", (q) => q.eq("name", args.companyName))
      .first();

    if (exact) return exact;

    // Try search index for fuzzy match
    const searchResults = await ctx.db
      .query("entityContexts")
      .withSearchIndex("search_name", (q) => q.search("name", args.companyName))
      .take(3);

    // Return first result if it's a close match
    for (const result of searchResults) {
      const similarity = calculateSimilarity(
        args.companyName.toLowerCase(),
        result.name.toLowerCase()
      );
      if (similarity > 0.8) {
        return result;
      }
    }

    return null;
  },
});

/**
 * Simple string similarity calculation.
 */
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  // Check if one contains the other
  if (longer.includes(shorter)) {
    return shorter.length / longer.length;
  }

  // Calculate Levenshtein-based similarity
  const matrix: number[][] = [];

  for (let i = 0; i <= shorter.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= longer.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= shorter.length; i++) {
    for (let j = 1; j <= longer.length; j++) {
      if (shorter[i - 1] === longer[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return 1 - matrix[shorter.length][longer.length] / longer.length;
}

/**
 * Create a new entity from funding event data.
 */
export const createEntityFromFunding = internalMutation({
  args: {
    fundingEventId: v.id("fundingEvents"),
    companyName: v.string(),
    sector: v.optional(v.string()),
    description: v.optional(v.string()),
    roundType: v.string(),
    amountUsd: v.optional(v.number()),
    investors: v.array(v.string()),
    sourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Determine entity type based on sector
    let entityType = "company";
    if (args.sector?.toLowerCase().includes("biotech")) {
      entityType = "biotech";
    } else if (args.sector?.toLowerCase().includes("ai") || args.sector?.toLowerCase().includes("tech")) {
      entityType = "tech";
    }

    const entityId = await ctx.db.insert("entityContexts", {
      name: args.companyName,
      type: entityType,
      status: "active",
      priority: "medium",
      // CRM fields
      sector: args.sector,
      stage: args.roundType,
      lastFundingRound: args.roundType,
      lastFundingAmount: args.amountUsd ? `$${(args.amountUsd / 1_000_000).toFixed(1)}M` : undefined,
      keyInvestors: args.investors,
      // Tracking fields
      ingestedAt: now,
      lastEnrichedAt: now,
      enrichmentJobId: undefined,
      // Source tracking
      sourceUrl: args.sourceUrl,
      // Notes
      notes: args.description || `Auto-created from funding announcement: ${args.roundType}`,
      createdAt: now,
      updatedAt: now,
    });

    console.log(`[entityPromotion] Created entity ${entityId} for ${args.companyName}`);
    return entityId;
  },
});

/**
 * Update existing entity with funding information.
 */
export const updateEntityWithFunding = internalMutation({
  args: {
    entityId: v.id("entityContexts"),
    fundingEventId: v.id("fundingEvents"),
    roundType: v.string(),
    amountUsd: v.optional(v.number()),
    investors: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId) as Doc<"entityContexts"> | null;
    if (!entity) {
      throw new Error(`Entity not found: ${args.entityId}`);
    }

    const now = Date.now();

    // Merge investors
    const existingInvestors = entity.keyInvestors || [];
    const mergedInvestors = [...new Set([...existingInvestors, ...args.investors])];

    await ctx.db.patch(args.entityId, {
      lastFundingRound: args.roundType,
      lastFundingAmount: args.amountUsd ? `$${(args.amountUsd / 1_000_000).toFixed(1)}M` : entity.lastFundingAmount,
      keyInvestors: mergedInvestors,
      lastEnrichedAt: now,
      updatedAt: now,
    });

    console.log(`[entityPromotion] Updated entity ${args.entityId} with funding info`);
    return { success: true };
  },
});

/**
 * Batch promote funding events to entities.
 */
export const batchPromoteToEntities = internalAction({
  args: {
    lookbackHours: v.optional(v.number()),
    minConfidence: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const lookbackMs = (args.lookbackHours ?? 24) * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;
    const minConfidence = args.minConfidence ?? 0.5;

    // Get unlinked funding events
    const events = await ctx.runQuery(
      internal.domains.enrichment.entityPromotion.getUnlinkedFundingEvents,
      { cutoff, minConfidence, limit: args.limit ?? 20 }
    );

    const results: Array<{
      fundingEventId: string;
      promoted: boolean;
      entityId?: string;
      error?: string;
    }> = [];

    for (const event of events) {
      try {
        const result = await promoteToEntity.handler(ctx, {
          fundingEventId: event._id,
        });

        results.push({
          fundingEventId: event._id,
          promoted: result.promoted,
          entityId: result.entityId?.toString(),
        });
      } catch (error) {
        results.push({
          fundingEventId: event._id,
          promoted: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const promoted = results.filter((r) => r.promoted).length;
    console.log(`[entityPromotion] Batch promoted ${promoted}/${events.length} events`);

    return {
      total: events.length,
      promoted,
      failed: events.length - promoted,
      results,
    };
  },
});

/**
 * Get funding events not yet linked to entities.
 */
export const getUnlinkedFundingEvents = internalQuery({
  args: {
    cutoff: v.number(),
    minConfidence: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("fundingEvents")
      .withIndex("by_announcedAt")
      .order("desc")
      .filter((q) =>
        q.and(
          q.gte(q.field("announcedAt"), args.cutoff),
          q.gte(q.field("confidence"), args.minConfidence),
          q.eq(q.field("companyId"), undefined)
        )
      )
      .take(args.limit);
  },
});
