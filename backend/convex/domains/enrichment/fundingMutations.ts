/**
 * Funding Mutations
 *
 * CRUD operations for the fundingEvents table.
 */
import { v } from "convex/values";
import { mutation, internalMutation, query, internalQuery } from "../../_generated/server";
import { Doc, Id } from "../../_generated/dataModel";

const roundTypeValidator = v.union(
  v.literal("pre-seed"),
  v.literal("seed"),
  v.literal("series-a"),
  v.literal("series-b"),
  v.literal("series-c"),
  v.literal("series-d-plus"),
  v.literal("growth"),
  v.literal("debt"),
  v.literal("unknown")
);

const verificationStatusValidator = v.union(
  v.literal("unverified"),
  v.literal("single-source"),
  v.literal("multi-source"),
  v.literal("verified")
);

/**
 * Create a new funding event.
 */
export const createFundingEvent = internalMutation({
  args: {
    companyName: v.string(),
    companyId: v.optional(v.id("entityContexts")),
    roundType: roundTypeValidator,
    amountRaw: v.string(),
    amountUsd: v.optional(v.number()),
    announcedAt: v.number(),
    leadInvestors: v.array(v.string()),
    coInvestors: v.optional(v.array(v.string())),
    sourceUrls: v.array(v.string()),
    sourceNames: v.array(v.string()),
    confidence: v.number(),
    sector: v.optional(v.string()),
    location: v.optional(v.string()),
    description: v.optional(v.string()),
    valuation: v.optional(v.string()),
    useOfProceeds: v.optional(v.string()),
    feedItemIds: v.optional(v.array(v.id("feedItems"))),
    factIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check for existing funding event for same company + round
    const existing = await ctx.db
      .query("fundingEvents")
      .withIndex("by_company", (q) =>
        q.eq("companyName", args.companyName).eq("roundType", args.roundType)
      )
      .first() as Doc<"fundingEvents"> | null;

    if (existing) {
      // Update existing event with new sources
      const updatedSources = [...new Set([...existing.sourceUrls, ...args.sourceUrls])];
      const updatedSourceNames = [...new Set([...existing.sourceNames, ...args.sourceNames])];
      const updatedFeedItems = [...new Set([...(existing.feedItemIds || []), ...(args.feedItemIds || [])])];

      // Increase confidence for multi-source
      const newConfidence = Math.min(
        existing.confidence + 0.2,
        1
      );

      // Update verification status
      let verificationStatus = existing.verificationStatus;
      if (updatedSources.length >= 3) {
        verificationStatus = "verified";
      } else if (updatedSources.length >= 2) {
        verificationStatus = "multi-source";
      }

      await ctx.db.patch(existing._id, {
        sourceUrls: updatedSources,
        sourceNames: updatedSourceNames,
        feedItemIds: updatedFeedItems,
        confidence: newConfidence,
        verificationStatus,
        updatedAt: now,
        // Update amount if new one is more specific
        ...(args.amountUsd && !existing.amountUsd ? { amountUsd: args.amountUsd } : {}),
        // Merge investors
        leadInvestors: [...new Set([...existing.leadInvestors, ...args.leadInvestors])],
      });

      console.log(`[fundingMutations] Updated existing funding event: ${existing._id}`);
      return existing._id;
    }

    // Create new funding event
    const eventId = await ctx.db.insert("fundingEvents", {
      companyName: args.companyName,
      companyId: args.companyId,
      roundType: args.roundType,
      amountRaw: args.amountRaw,
      amountUsd: args.amountUsd,
      announcedAt: args.announcedAt,
      leadInvestors: args.leadInvestors,
      coInvestors: args.coInvestors,
      sourceUrls: args.sourceUrls,
      sourceNames: args.sourceNames,
      confidence: args.confidence,
      verificationStatus: args.sourceUrls.length > 1 ? "multi-source" : "single-source",
      sector: args.sector,
      location: args.location,
      description: args.description,
      valuation: args.valuation,
      useOfProceeds: args.useOfProceeds,
      ttlDays: 90, // Keep funding events for 90 days
      createdAt: now,
      updatedAt: now,
      feedItemIds: args.feedItemIds,
      factIds: args.factIds,
    });

    console.log(`[fundingMutations] Created new funding event: ${eventId} for ${args.companyName}`);
    return eventId;
  },
});

/**
 * Update funding event verification status.
 */
export const updateVerificationStatus = internalMutation({
  args: {
    fundingEventId: v.id("fundingEvents"),
    verificationStatus: verificationStatusValidator,
    confidence: v.optional(v.number()),
    newSources: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.fundingEventId) as Doc<"fundingEvents"> | null;
    if (!event) {
      throw new Error(`Funding event not found: ${args.fundingEventId}`);
    }

    const updates: Partial<Doc<"fundingEvents">> = {
      verificationStatus: args.verificationStatus,
      updatedAt: Date.now(),
    };

    if (args.confidence !== undefined) {
      updates.confidence = args.confidence;
    }

    if (args.newSources) {
      updates.sourceUrls = [...new Set([...event.sourceUrls, ...args.newSources])];
    }

    await ctx.db.patch(args.fundingEventId, updates);
    return { success: true };
  },
});

/**
 * Link funding event to entity context.
 */
export const linkToEntity = internalMutation({
  args: {
    fundingEventId: v.id("fundingEvents"),
    entityId: v.id("entityContexts"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.fundingEventId, {
      companyId: args.entityId,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

/**
 * Get recent funding events.
 */
export const getRecentFundingEvents = query({
  args: {
    lookbackHours: v.optional(v.number()),
    roundTypes: v.optional(v.array(roundTypeValidator)),
    minConfidence: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const lookbackMs = (args.lookbackHours ?? 24) * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;
    const minConfidence = args.minConfidence ?? 0;

    const query = ctx.db
      .query("fundingEvents")
      .withIndex("by_announcedAt")
      .order("desc")
      .filter((q) => q.gte(q.field("announcedAt"), cutoff));

    const events = await query.take(args.limit ?? 50) as Doc<"fundingEvents">[];

    // Filter by round type and confidence
    return events.filter((e: Doc<"fundingEvents">) => {
      if (e.confidence < minConfidence) return false;
      if (args.roundTypes && !args.roundTypes.includes(e.roundType)) return false;
      return true;
    });
  },
});

/**
 * Get funding events for digest.
 */
export const getFundingForDigest = internalQuery({
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
      .collect() as Doc<"fundingEvents">[];

    // Group by round type
    const seedEvents = events.filter(
      (e: Doc<"fundingEvents">) => e.roundType === "seed" || e.roundType === "pre-seed"
    );
    const seriesAEvents = events.filter((e: Doc<"fundingEvents">) => e.roundType === "series-a");
    const otherEvents = events.filter(
      (e: Doc<"fundingEvents">) => !["seed", "pre-seed", "series-a"].includes(e.roundType)
    );

    return {
      seed: seedEvents,
      seriesA: seriesAEvents,
      other: otherEvents,
      total: events.length,
    };
  },
});

/**
 * Get funding event by ID.
 */
export const getFundingEvent = query({
  args: {
    fundingEventId: v.id("fundingEvents"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.fundingEventId) as Doc<"fundingEvents"> | null;
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
    return await ctx.db
      .query("fundingEvents")
      .withSearchIndex("search_company", (q) => q.search("companyName", args.companyName))
      .take(10) as Doc<"fundingEvents">[];
  },
});

/**
 * Bulk seed funding events (for historical data import).
 * Public mutation for CLI usage.
 */
export const bulkSeedFundingEvents = mutation({
  args: {
    events: v.array(v.object({
      companyName: v.string(),
      roundType: roundTypeValidator,
      amountRaw: v.string(),
      amountUsd: v.optional(v.number()),
      announcedAt: v.number(),
      leadInvestors: v.array(v.string()),
      coInvestors: v.optional(v.array(v.string())),
      sourceUrls: v.array(v.string()),
      sourceNames: v.array(v.string()),
      confidence: v.number(),
      sector: v.optional(v.string()),
      location: v.optional(v.string()),
      description: v.optional(v.string()),
      valuation: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const inserted: string[] = [];
    const updated: string[] = [];

    for (const event of args.events) {
      // Check for existing
      const existing = await ctx.db
        .query("fundingEvents")
        .withIndex("by_company", (q) =>
          q.eq("companyName", event.companyName).eq("roundType", event.roundType)
        )
        .first() as Doc<"fundingEvents"> | null;

      if (existing) {
        // Delete existing and recreate to ensure fresh data (including correct timestamps)
        await ctx.db.delete(existing._id);
        // Insert new record
        await ctx.db.insert("fundingEvents", {
          companyName: event.companyName,
          companyId: undefined,
          roundType: event.roundType,
          amountRaw: event.amountRaw,
          amountUsd: event.amountUsd,
          announcedAt: event.announcedAt, // Use the new timestamp directly
          leadInvestors: event.leadInvestors,
          coInvestors: event.coInvestors,
          sourceUrls: [...new Set([...existing.sourceUrls, ...event.sourceUrls])],
          sourceNames: [...new Set([...existing.sourceNames, ...event.sourceNames])],
          confidence: event.confidence,
          verificationStatus: existing.sourceUrls.length > 1 ? "multi-source" : "single-source",
          sector: event.sector || existing.sector,
          location: event.location || existing.location,
          description: event.description || existing.description,
          valuation: event.valuation || existing.valuation,
          useOfProceeds: undefined,
          ttlDays: 365,
          createdAt: now,
          updatedAt: now,
          feedItemIds: existing.feedItemIds || [],
          factIds: existing.factIds || [],
        });
        updated.push(event.companyName);
      } else {
        // Create new
        await ctx.db.insert("fundingEvents", {
          companyName: event.companyName,
          companyId: undefined,
          roundType: event.roundType,
          amountRaw: event.amountRaw,
          amountUsd: event.amountUsd,
          announcedAt: event.announcedAt,
          leadInvestors: event.leadInvestors,
          coInvestors: event.coInvestors,
          sourceUrls: event.sourceUrls,
          sourceNames: event.sourceNames,
          confidence: event.confidence,
          verificationStatus: event.sourceUrls.length > 1 ? "multi-source" : "single-source",
          sector: event.sector,
          location: event.location,
          description: event.description,
          valuation: event.valuation,
          useOfProceeds: undefined,
          ttlDays: 365, // Historical data kept for 1 year
          createdAt: now,
          updatedAt: now,
          feedItemIds: [],
          factIds: [],
        });
        inserted.push(event.companyName);
      }
    }

    return { inserted, updated, totalProcessed: args.events.length };
  },
});

/**
 * Clean up old funding events (called by cron).
 */
export const cleanupOldFundingEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const oldEvents = await ctx.db
      .query("fundingEvents")
      .withIndex("by_createdAt")
      .filter((q) => {
        // Calculate expiry based on ttlDays
        return q.lt(
          q.add(q.field("createdAt"), q.mul(q.field("ttlDays"), 24 * 60 * 60 * 1000)),
          now
        );
      })
      .take(50) as Doc<"fundingEvents">[];

    for (const event of oldEvents) {
      await ctx.db.delete(event._id);
    }

    return { deleted: oldEvents.length };
  },
});

/**
 * Delete a funding event by ID.
 */
export const deleteFundingEvent = mutation({
  args: {
    fundingEventId: v.id("fundingEvents"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.fundingEventId);
    return { success: true };
  },
});

/**
 * Patch a funding event's announcedAt timestamp.
 */
export const patchFundingEventTimestamp = mutation({
  args: {
    fundingEventId: v.id("fundingEvents"),
    announcedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.fundingEventId, {
      announcedAt: args.announcedAt,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});
