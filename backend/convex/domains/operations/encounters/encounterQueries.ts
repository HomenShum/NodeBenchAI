/**
 * encounterQueries.ts - Query operations for encounters
 *
 * Read operations for the encounterEvents table.
 */

import { v } from "convex/values";
import { query, internalQuery } from "../../../_generated/server";
import { Doc } from "../../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

// ============================================================================
// Public Queries
// ============================================================================

/**
 * Get recent encounters for the current user
 */
export const getRecentEncounters = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("none"),
        v.literal("fast_pass_queued"),
        v.literal("fast_pass_complete"),
        v.literal("deep_dive_queued"),
        v.literal("deep_dive_running"),
        v.literal("complete")
      )
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 20;

    let encounters;
    if (args.status) {
      encounters = await ctx.db
        .query("encounterEvents")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", userId).eq("researchStatus", args.status!)
        )
        .order("desc")
        .take(limit);
    } else {
      encounters = await ctx.db
        .query("encounterEvents")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .order("desc")
        .take(limit);
    }

    return encounters;
  },
});

/**
 * Get a single encounter by ID
 */
export const getEncounter = query({
  args: {
    encounterId: v.id("encounterEvents"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const encounter = await ctx.db.get(args.encounterId) as Doc<"encounterEvents"> | null;
    if (!encounter) return null;
    if (encounter.userId !== userId) return null;

    return encounter;
  },
});

/**
 * Get encounter with full enrichment data
 * Includes DD memo if available
 */
export const getEncounterWithEnrichment = query({
  args: {
    encounterId: v.id("encounterEvents"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const encounter = await ctx.db.get(args.encounterId) as Doc<"encounterEvents"> | null;
    if (!encounter) return null;
    if (encounter.userId !== userId) return null;

    // If DD memo exists, fetch it
    let ddMemo = null;
    if (encounter.ddMemoId) {
      ddMemo = await ctx.db.get(encounter.ddMemoId);
    }

    // Fetch linked entity contexts for participants and companies
    const entityContexts: any[] = [];
    for (const participant of encounter.participants) {
      if (participant.linkedEntityId) {
        const context = await ctx.db.get(participant.linkedEntityId);
        if (context) {
          entityContexts.push({
            type: "participant",
            name: participant.name,
            context,
          });
        }
      }
    }
    for (const company of encounter.companies) {
      if (company.linkedEntityId) {
        const context = await ctx.db.get(company.linkedEntityId);
        if (context) {
          entityContexts.push({
            type: "company",
            name: company.name,
            context,
          });
        }
      }
    }

    return {
      encounter,
      ddMemo,
      entityContexts,
    };
  },
});

/**
 * Search encounters by text
 */
export const searchEncounters = query({
  args: {
    searchQuery: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 20;

    const results = await ctx.db
      .query("encounterEvents")
      .withSearchIndex("search_encounter", (q) =>
        q.search("rawText", args.searchQuery).eq("userId", userId)
      )
      .take(limit);

    return results;
  },
});

/**
 * Get encounters with pending follow-ups
 */
export const getPendingFollowUps = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 20;

    const encounters = await ctx.db
      .query("encounterEvents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("followUpRequested"), true))
      .order("desc")
      .take(limit);

    return encounters;
  },
});

/**
 * Get encounters by date range
 */
export const getEncountersByDateRange = query({
  args: {
    startDate: v.number(),
    endDate: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 100;

    const encounters = await ctx.db
      .query("encounterEvents")
      .withIndex("by_user_captured", (q) => q.eq("userId", userId))
      .filter((q) =>
        q.and(
          q.gte(q.field("capturedAt"), args.startDate),
          q.lte(q.field("capturedAt"), args.endDate)
        )
      )
      .order("desc")
      .take(limit);

    return encounters;
  },
});

/**
 * Get encounter stats for the current user
 */
export const getEncounterStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        total: 0,
        withFastPass: 0,
        withDeepDive: 0,
        pendingFollowUp: 0,
        thisWeek: 0,
      };
    }

    const allEncounters = await ctx.db
      .query("encounterEvents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    return {
      total: allEncounters.length,
      withFastPass: allEncounters.filter(
        (e) =>
          e.researchStatus === "fast_pass_complete" ||
          e.researchStatus === "deep_dive_queued" ||
          e.researchStatus === "deep_dive_running" ||
          e.researchStatus === "complete"
      ).length,
      withDeepDive: allEncounters.filter(
        (e) => e.researchStatus === "complete" && e.ddMemoId
      ).length,
      pendingFollowUp: allEncounters.filter((e) => e.followUpRequested).length,
      thisWeek: allEncounters.filter((e) => e.capturedAt >= weekAgo).length,
    };
  },
});

// ============================================================================
// Internal Queries
// ============================================================================

/**
 * Get encounter by DD job ID (internal)
 */
export const getByDDJobId = internalQuery({
  args: {
    ddJobId: v.string(),
  },
  handler: async (ctx, args) => {
    const encounter = await ctx.db
      .query("encounterEvents")
      .withIndex("by_dd_job", (q) => q.eq("ddJobId", args.ddJobId))
      .first();

    return encounter;
  },
});

/**
 * Get all encounters for a user (internal)
 */
export const getAllForUser = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const encounters = await ctx.db
      .query("encounterEvents")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    return encounters;
  },
});
