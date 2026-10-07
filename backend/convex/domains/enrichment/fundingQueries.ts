/**
 * Funding Queries
 *
 * Query functions for funding events, optimized for digest generation.
 */
import { v } from "convex/values";
import { query, internalQuery } from "../../_generated/server";
import { Doc, Id } from "../../_generated/dataModel";

/**
 * Get funding events formatted for digest consumption.
 */
export const getFundingDigestSections = internalQuery({
  args: {
    lookbackHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const lookbackMs = (args.lookbackHours ?? 24) * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;

    const events = await ctx.db
      .query("fundingEvents")
      .withIndex("by_announcedAt")
      .order("desc")
      .filter((q) => q.gte(q.field("announcedAt"), cutoff))
      .collect();

    // Group by round type
    const seedEvents = events.filter(
      (e) => e.roundType === "seed" || e.roundType === "pre-seed"
    );
    const seriesAEvents = events.filter((e) => e.roundType === "series-a");
    const otherEvents = events.filter(
      (e) => !["seed", "pre-seed", "series-a"].includes(e.roundType)
    );

    // Transform to digest format. Fields below are consumed by the LinkedIn
    // funding-tracker formatter (`postDailyFundingToLinkedIn`) and the digest
    // agent's evidence-checklist computation. Dropping any of them silently
    // degrades posts to "0 sources | confidence X%" with placeholder prose.
    const toDigestFormat = (event: typeof events[0]) => ({
      eventId: event._id,
      companyName: event.companyName,
      companyId: event.companyId,
      roundType: event.roundType,
      amountRaw: event.amountRaw,
      amountUsd: event.amountUsd,
      announcedAt: event.announcedAt,
      leadInvestors: event.leadInvestors,
      coInvestors: event.coInvestors,
      sector: event.sector,
      location: event.location,
      valuation: event.valuation,
      description: event.description,
      confidence: event.confidence,
      verificationStatus: event.verificationStatus,
      sourceUrls: event.sourceUrls,
      sourceNames: event.sourceNames,
      sourceCount: event.sourceUrls.length,
      // TODO: Add persona pass count from entity evaluation
      personaPassCount: undefined as number | undefined,
      // TODO: Determine missing fields based on banker-grade requirements
      missingFields: [] as string[],
    });

    return {
      seed: seedEvents.map(toDigestFormat),
      seriesA: seriesAEvents.map(toDigestFormat),
      other: otherEvents.map(toDigestFormat),
      total: events.length,
    };
  },
});

/**
 * Get funding events with associated entities.
 */
export const getFundingWithEntities = query({
  args: {
    lookbackHours: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const lookbackMs = (args.lookbackHours ?? 24) * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;

    const events = await ctx.db
      .query("fundingEvents")
      .withIndex("by_announcedAt")
      .order("desc")
      .filter((q) => q.gte(q.field("announcedAt"), cutoff))
      .take(args.limit ?? 20);

    // Fetch associated entities
    const result = await Promise.all(
      events.map(async (event: Doc<"fundingEvents">) => {
        let entity: Doc<"entityContexts"> | null = null;
        if (event.companyId) {
          entity = await ctx.db.get(event.companyId) as Doc<"entityContexts"> | null;
        }
        return {
          ...event,
          entity: entity
            ? {
                id: entity._id,
                name: entity.entityName,
                type: entity.entityType,
                sector: entity.crmFields?.industry,
              }
            : null,
        };
      })
    );

    return result;
  },
});

/**
 * Get funding statistics for dashboard.
 */
export const getFundingStats = query({
  args: {
    lookbackDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const lookbackMs = (args.lookbackDays ?? 7) * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;

    const events = await ctx.db
      .query("fundingEvents")
      .withIndex("by_announcedAt")
      .filter((q) => q.gte(q.field("announcedAt"), cutoff))
      .collect();

    const byRoundType: Record<string, number> = {};
    let totalAmount = 0;
    let eventsWithAmount = 0;

    for (const event of events) {
      byRoundType[event.roundType] = (byRoundType[event.roundType] ?? 0) + 1;
      if (event.amountUsd) {
        totalAmount += event.amountUsd;
        eventsWithAmount++;
      }
    }

    return {
      total: events.length,
      byRoundType,
      totalAmountUsd: totalAmount,
      averageAmountUsd: eventsWithAmount > 0 ? totalAmount / eventsWithAmount : 0,
      lookbackDays: args.lookbackDays ?? 7,
    };
  },
});

/**
 * Get today's funding targets with persona evaluation status.
 */
export const getTodaysFundingTargets = query({
  args: {},
  handler: async (ctx) => {
    const lookbackMs = 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;

    const events = await ctx.db
      .query("fundingEvents")
      .withIndex("by_announcedAt")
      .order("desc")
      .filter((q) => q.gte(q.field("announcedAt"), cutoff))
      .take(20);

    return events.map((event) => ({
      id: event._id,
      companyName: event.companyName,
      roundType: event.roundType,
      amountRaw: event.amountRaw,
      amountUsd: event.amountUsd,
      leadInvestors: event.leadInvestors,
      sector: event.sector,
      confidence: event.confidence,
      verificationStatus: event.verificationStatus,
      sourceCount: event.sourceUrls.length,
      hasEntity: !!event.companyId,
    }));
  },
});


/**
 * Get recent funding events with configurable filters.
 * Used by the agent tools.
 */
export const getRecentFundingEvents = query({
  args: {
    lookbackHours: v.optional(v.number()),
    limit: v.optional(v.number()),
    minConfidence: v.optional(v.number()),
    roundTypes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const lookbackMs = (args.lookbackHours ?? 24) * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;
    const minConfidence = args.minConfidence ?? 0.5;

    let events = await ctx.db
      .query("fundingEvents")
      .withIndex("by_announcedAt")
      .order("desc")
      .filter((q) => 
        q.and(
          q.gte(q.field("announcedAt"), cutoff),
          q.gte(q.field("confidence"), minConfidence)
        )
      )
      .take(args.limit ?? 20);

    // Filter by round types if specified
    if (args.roundTypes && args.roundTypes.length > 0) {
      events = events.filter((e) => args.roundTypes!.includes(e.roundType));
    }

    return events.map((event) => ({
      id: event._id,
      companyName: event.companyName,
      roundType: event.roundType,
      amountRaw: event.amountRaw,
      amountUsd: event.amountUsd,
      leadInvestors: event.leadInvestors,
      coInvestors: event.coInvestors,
      sector: event.sector,
      location: event.location,
      valuation: event.valuation,
      description: event.description,
      confidence: event.confidence,
      verificationStatus: event.verificationStatus,
      sourceUrls: event.sourceUrls,
      sourceNames: event.sourceNames,
      announcedAt: event.announcedAt,
    }));
  },
});

/**
 * Search funding events by company name.
 */
export const searchFundingByCompany = query({
  args: {
    companyName: v.string(),
  },
  handler: async (ctx, args) => {
    // Use search index for fuzzy matching
    const searchResults = await ctx.db
      .query("fundingEvents")
      .withSearchIndex("search_company", (q) => q.search("companyName", args.companyName))
      .take(10);

    return searchResults.map((event) => ({
      id: event._id,
      companyName: event.companyName,
      roundType: event.roundType,
      amountRaw: event.amountRaw,
      amountUsd: event.amountUsd,
      leadInvestors: event.leadInvestors,
      sector: event.sector,
      confidence: event.confidence,
      verificationStatus: event.verificationStatus,
      announcedAt: event.announcedAt,
      sourceUrls: event.sourceUrls,
    }));
  },
});

/**
 * Trigger verification for a specific funding event.
 * Used by agent tools.
 */
export const verifyFundingEvent = query({
  args: {
    fundingEventId: v.id("fundingEvents"),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.fundingEventId) as Doc<"fundingEvents"> | null;
    if (!event) {
      return null;
    }
    return {
      id: event._id,
      companyName: event.companyName,
      roundType: event.roundType,
      amountRaw: event.amountRaw,
      confidence: event.confidence,
      verificationStatus: event.verificationStatus,
      sourceUrls: event.sourceUrls,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API - Comprehensive funding data for frontend display
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get ALL funding events for the funding brief page.
 * Returns comprehensive data suitable for frontend display.
 *
 * This is the main query for the /funding-brief page.
 */
export const getAllFundingForBrief = query({
  args: {
    lookbackDays: v.optional(v.number()),
    limit: v.optional(v.number()),
    sectorFilter: v.optional(v.string()),
    roundTypeFilter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const lookbackMs = (args.lookbackDays ?? 30) * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;
    const limit = args.limit ?? 100; // Default to 100 events

    // Collect all events within the cutoff window first, then apply limit
    // This ensures historical data isn't cut off by newer records
    let allEvents = await ctx.db
      .query("fundingEvents")
      .withIndex("by_announcedAt")
      .order("desc")
      .collect();

    // Filter to events within the lookback window
    let events = allEvents.filter((e) => e.announcedAt >= cutoff);

    // Apply sector filter if specified
    if (args.sectorFilter) {
      const filter = args.sectorFilter.toLowerCase();
      events = events.filter((e) =>
        e.sector?.toLowerCase().includes(filter)
      );
    }

    // Apply round type filter if specified
    if (args.roundTypeFilter) {
      events = events.filter((e) => e.roundType === args.roundTypeFilter);
    }

    // Apply limit after all filters (so historical data isn't cut off)
    const limitedEvents = events.slice(0, limit);

    // Fetch associated entity data for enrichment (only for limited set)
    const enrichedEvents = await Promise.all(
      limitedEvents.map(async (event: Doc<"fundingEvents">) => {
        let entityData: {
          name: any;
          type: any;
          sector: any;
          crmFields: any;
        } | null = null;
        if (event.companyId) {
          const entity = await ctx.db.get(event.companyId) as Doc<"entityContexts"> | null;
          if (entity) {
            entityData = {
              name: entity.entityName,
              type: entity.entityType,
              sector: entity.crmFields?.industry,
              crmFields: entity.crmFields,
            };
          }
        }

        return {
          id: event._id,
          companyName: event.companyName,
          roundType: event.roundType,
          amountRaw: event.amountRaw,
          amountUsd: event.amountUsd,
          leadInvestors: event.leadInvestors,
          coInvestors: event.coInvestors,
          sector: event.sector,
          location: event.location,
          description: event.description,
          valuation: event.valuation,
          useOfProceeds: event.useOfProceeds,
          confidence: event.confidence,
          verificationStatus: event.verificationStatus,
          sourceUrls: event.sourceUrls,
          sourceNames: event.sourceNames,
          announcedAt: event.announcedAt,
          createdAt: event.createdAt,
          // Enriched data from entity
          entityData,
        };
      })
    );

    // Compute stats
    const totalAmount = events.reduce((sum, e) => sum + (e.amountUsd ?? 0), 0);
    const byRoundType: Record<string, number> = {};
    for (const event of events) {
      byRoundType[event.roundType] = (byRoundType[event.roundType] ?? 0) + 1;
    }

    return {
      events: enrichedEvents,
      stats: {
        total: enrichedEvents.length,
        totalAmountUsd: totalAmount,
        byRoundType,
        lookbackDays: args.lookbackDays ?? 30,
      },
    };
  },
});

/**
 * Get funding brief summary - minimal data for card/preview display.
 * Used for homepage widgets and social share previews.
 */
export const getFundingBriefSummary = query({
  args: {},
  handler: async (ctx) => {
    const lookbackMs = 7 * 24 * 60 * 60 * 1000; // Last 7 days
    const cutoff = Date.now() - lookbackMs;

    const events = await ctx.db
      .query("fundingEvents")
      .withIndex("by_announcedAt")
      .order("desc")
      .filter((q) => q.gte(q.field("announcedAt"), cutoff))
      .take(50);

    // Top 5 by amount
    const topByAmount = [...events]
      .filter((e) => e.amountUsd)
      .sort((a, b) => (b.amountUsd ?? 0) - (a.amountUsd ?? 0))
      .slice(0, 5)
      .map((e) => ({
        companyName: e.companyName,
        roundType: e.roundType,
        amountRaw: e.amountRaw,
        sector: e.sector,
      }));

    // Compute stats
    const totalAmount = events.reduce((sum, e) => sum + (e.amountUsd ?? 0), 0);

    return {
      topFunding: topByAmount,
      stats: {
        totalEvents: events.length,
        totalAmountUsd: totalAmount,
        periodDays: 7,
      },
      lastUpdated: Date.now(),
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// FUNDING HISTORY/TIMELINE - For LinkedIn posts with historical context
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize company name for matching across funding events.
 * Lowercase, trim, remove common suffixes.
 */
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[,.]$/g, "")
    .replace(/\s+(inc|corp|llc|ltd|co|company|technologies|technology|labs|ai|io)\.?$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Get full funding history for a company from the fundingEvents table.
 * Returns ALL past funding rounds with original source URLs.
 *
 * This is the correct source for funding timelines - not our LinkedIn posts.
 * Real funding data with original announcement dates and source URLs.
 *
 * For later-stage companies (Series B+), we want the COMPLETE funding journey
 * from inception - no arbitrary lookback limits.
 */
export const getCompanyFundingHistory = internalQuery({
  args: {
    companyName: v.string(),
    // If true, fetches ALL history regardless of time (for Series B+ companies)
    fullHistory: v.optional(v.boolean()),
    // Fallback lookback for early-stage if fullHistory not specified
    lookbackDays: v.optional(v.number()), // Default: unlimited
  },
  returns: v.array(
    v.object({
      roundType: v.string(),
      amountRaw: v.string(),
      amountUsd: v.optional(v.number()),
      announcedAt: v.number(),
      sourceUrls: v.array(v.string()),
      leadInvestors: v.array(v.string()),
      confidence: v.number(),
      verificationStatus: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const normalized = normalizeCompanyName(args.companyName);

    // Get all funding events - we need to filter by normalized name
    const allEvents = await ctx.db
      .query("fundingEvents")
      .withIndex("by_announcedAt")
      .order("asc") // Oldest first for timeline
      .collect();

    // Filter by company name (normalized)
    // If fullHistory=true or no lookbackDays specified, get ALL events
    const useFullHistory = args.fullHistory ?? !args.lookbackDays;
    const cutoffTime = useFullHistory
      ? 0 // No cutoff - get everything
      : Date.now() - (args.lookbackDays! * 24 * 60 * 60 * 1000);

    const companyEvents = allEvents.filter(event => {
      const eventNormalized = normalizeCompanyName(event.companyName);
      return eventNormalized === normalized && event.announcedAt >= cutoffTime;
    });

    return companyEvents.map(event => ({
      roundType: event.roundType,
      amountRaw: event.amountRaw,
      amountUsd: event.amountUsd,
      announcedAt: event.announcedAt,
      sourceUrls: event.sourceUrls,
      leadInvestors: event.leadInvestors,
      confidence: event.confidence,
      verificationStatus: event.verificationStatus,
    }));
  },
});

/**
 * Batch fetch funding history for multiple companies.
 * Efficient for LinkedIn posts that include multiple companies.
 *
 * For later-stage companies (Series B, C, D, IPO), we want the COMPLETE
 * funding journey from the very beginning - not just recent history.
 */
export const batchGetFundingHistory = internalQuery({
  args: {
    companyNames: v.array(v.string()),
    // Always fetch full history - no lookback limits
    // Later-stage companies need complete journey from inception
    fullHistory: v.optional(v.boolean()), // Default: true
  },
  returns: v.any(), // Map<string, FundingHistoryEntry[]>
  handler: async (ctx, args) => {
    // Default to full history - we want complete funding journeys
    const useFullHistory = args.fullHistory ?? true;

    // Normalize all company names for matching
    const normalizedNames = new Map<string, string>();
    for (const name of args.companyNames) {
      normalizedNames.set(normalizeCompanyName(name), name);
    }

    // Get ALL funding events (no time filter for complete history)
    const allEvents = await ctx.db
      .query("fundingEvents")
      .withIndex("by_announcedAt")
      .order("asc") // Oldest first for timeline
      .collect();

    // Build result map
    const results: Record<string, Array<{
      roundType: string;
      amountRaw: string;
      amountUsd?: number;
      announcedAt: number;
      sourceUrls: string[];
      leadInvestors: string[];
      confidence: number;
      verificationStatus: string;
    }>> = {};

    // Initialize empty arrays for all requested companies
    for (const name of args.companyNames) {
      results[name] = [];
    }

    // Match events to companies
    for (const event of allEvents) {
      const eventNormalized = normalizeCompanyName(event.companyName);
      const originalName = normalizedNames.get(eventNormalized);

      if (originalName) {
        results[originalName].push({
          roundType: event.roundType,
          amountRaw: event.amountRaw,
          amountUsd: event.amountUsd,
          announcedAt: event.announcedAt,
          sourceUrls: event.sourceUrls,
          leadInvestors: event.leadInvestors,
          confidence: event.confidence,
          verificationStatus: event.verificationStatus,
        });
      }
    }

    return results;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL QUERIES - For scheduled report generation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get a single funding event by ID.
 * Used by backfill and enrichment scripts.
 */
export const getFundingEventById = internalQuery({
  args: {
    id: v.id("fundingEvents"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Get funding events in a specific announced-at window.
 * Used by the LinkedIn funding-tracker backfill to recompute the post
 * content for a historical date using the original event window.
 */
export const getFundingEventsInWindow = internalQuery({
  args: {
    startMs: v.number(),
    endMs: v.number(),
  },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("fundingEvents")
      .withIndex("by_announcedAt", (q) =>
        q.gte("announcedAt", args.startMs).lte("announcedAt", args.endMs),
      )
      .collect();

    return events.map((event) => ({
      eventId: event._id,
      companyName: event.companyName,
      companyId: event.companyId,
      roundType: event.roundType,
      amountRaw: event.amountRaw,
      amountUsd: event.amountUsd,
      announcedAt: event.announcedAt,
      leadInvestors: event.leadInvestors,
      coInvestors: event.coInvestors,
      sector: event.sector,
      location: event.location,
      valuation: event.valuation,
      description: event.description,
      confidence: event.confidence,
      verificationStatus: event.verificationStatus,
      sourceUrls: event.sourceUrls,
      sourceNames: event.sourceNames,
      sourceCount: event.sourceUrls.length,
    }));
  },
});

/**
 * Best-effort enrichment lookup: pull product/founder fields off
 * `entityContexts.crmFields` for a batch of company IDs. Used by the LinkedIn
 * funding-tracker workflow to replace placeholder lines ("Product details are
 * limited", "Founder background not captured") with real data when the entity
 * has been enriched. Returns an empty array on no match — caller treats
 * missing fields as "omit the line entirely" rather than fabricating prose.
 */
export const getEntityFundingDetails = internalQuery({
  args: {
    companyIds: v.array(v.id("entityContexts")),
  },
  returns: v.array(
    v.object({
      companyId: v.id("entityContexts"),
      productDescription: v.optional(v.string()),
      founderBackground: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const results: Array<{
      companyId: Id<"entityContexts">;
      productDescription?: string;
      founderBackground?: string;
    }> = [];
    for (const companyId of args.companyIds) {
      const entity = await ctx.db.get(companyId);
      if (!entity) continue;
      const crm = entity.crmFields;
      const product =
        (crm?.product && crm.product.trim()) ||
        (crm?.description && crm.description.trim()) ||
        (entity.summary && entity.summary.trim()) ||
        undefined;
      const founder =
        (crm?.foundersBackground && crm.foundersBackground.trim()) ||
        (Array.isArray(crm?.founders) && crm!.founders.length > 0
          ? crm!.founders.slice(0, 3).join(", ")
          : undefined);
      if (!product && !founder) continue;
      results.push({
        companyId,
        productDescription: product,
        founderBackground: founder,
      });
    }
    return results;
  },
});

/**
 * Get funding data for scheduled PDF report generation.
 * Internal-only query for cron jobs.
 */
export const getFundingForScheduledReport = internalQuery({
  args: {
    lookbackDays: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const lookbackMs = args.lookbackDays * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;
    const limit = args.limit ?? 100;

    const events = await ctx.db
      .query("fundingEvents")
      .withIndex("by_announcedAt")
      .order("desc")
      .filter((q) => q.gte(q.field("announcedAt"), cutoff))
      .take(limit);

    return events.map((event) => ({
      companyName: event.companyName,
      roundType: event.roundType,
      amountRaw: event.amountRaw ?? "",
      amountUsd: event.amountUsd,
      leadInvestors: event.leadInvestors ?? [],
      sector: event.sector,
      location: event.location,
      announcedAt: event.announcedAt,
      confidence: event.confidence,
      verificationStatus: event.verificationStatus,
    }));
  },
});
