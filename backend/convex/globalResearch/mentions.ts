// convex/globalResearch/mentions.ts
// Append-only mention ledger tracking artifact sightings.
// Raw mentions kept 30 days, then compacted to aggregates.

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { Doc } from "../_generated/dataModel";
import { hashSync } from "../../shared/artifacts";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Raw mentions retention period: 30 days */
export const MENTION_RETENTION_DAYS = 30;
export const MENTION_RETENTION_MS = MENTION_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate aggregate key for a mention.
 * Key = hash(artifactKey + queryKey + dayBucket)
 */
export function generateAggKey(
  artifactKey: string,
  queryKey: string,
  dayBucket: string
): string {
  return hashSync(`${artifactKey}|${queryKey}|${dayBucket}`);
}

/**
 * Get day bucket string from timestamp.
 * Format: "2024-01-15"
 */
export function getDayBucket(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toISOString().split("T")[0];
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record a new artifact mention (append-only).
 */
export const recordMention = internalMutation({
  args: {
    artifactKey: v.string(),
    queryKey: v.string(),
    entityKey: v.optional(v.string()),
    toolName: v.string(),
    runId: v.optional(v.string()),
    sectionId: v.optional(v.string()),
    rank: v.optional(v.number()),
    score: v.optional(v.number()),
  },
  returns: v.id("globalArtifactMentions"),
  handler: async (ctx, args) => {
    const now = Date.now();

    const id = await ctx.db.insert("globalArtifactMentions", {
      artifactKey: args.artifactKey,
      queryKey: args.queryKey,
      entityKey: args.entityKey ?? "", // Empty string for unscoped
      seenAt: now,
      toolName: args.toolName,
      runId: args.runId ?? "", // Empty string for backfill
      sectionId: args.sectionId ?? "", // Empty string if none
      rank: args.rank,
      score: args.score,
    });

    return id;
  },
});

/**
 * Record multiple mentions in batch (for bulk operations).
 */
export const recordMentionsBatch = internalMutation({
  args: {
    mentions: v.array(
      v.object({
        artifactKey: v.string(),
        queryKey: v.string(),
        entityKey: v.optional(v.string()),
        toolName: v.string(),
        runId: v.optional(v.string()),
        sectionId: v.optional(v.string()),
        rank: v.optional(v.number()),
        score: v.optional(v.number()),
      })
    ),
  },
  returns: v.number(), // count inserted
  handler: async (ctx, { mentions }) => {
    const now = Date.now();
    let count = 0;

    for (const m of mentions) {
      await ctx.db.insert("globalArtifactMentions", {
        artifactKey: m.artifactKey,
        queryKey: m.queryKey,
        entityKey: m.entityKey ?? "",
        seenAt: now,
        toolName: m.toolName,
        runId: m.runId ?? "",
        sectionId: m.sectionId ?? "",
        rank: m.rank,
        score: m.score,
      });
      count++;
    }

    return count;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get mentions for a query (most recent first).
 */
export const getMentionsByQuery = internalQuery({
  args: {
    queryKey: v.string(),
    limit: v.optional(v.number()),
    sinceMs: v.optional(v.number()),
  },
  handler: async (ctx, { queryKey, limit = 100, sinceMs }) => {
    const query = ctx.db
      .query("globalArtifactMentions")
      .withIndex("by_queryKey_seenAt", (q) => {
        const base = q.eq("queryKey", queryKey);
        return sinceMs ? base.gte("seenAt", sinceMs) : base;
      })
      .order("desc");

    return query.take(limit);
  },
});

/**
 * Get mentions for an artifact (most recent first).
 */
export const getMentionsByArtifact = internalQuery({
  args: {
    artifactKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { artifactKey, limit = 100 }) => {
    return ctx.db
      .query("globalArtifactMentions")
      .withIndex("by_artifactKey_seenAt", (q) => q.eq("artifactKey", artifactKey))
      .order("desc")
      .take(limit);
  },
});

/**
 * Get mentions for an entity (most recent first).
 * WARNING: Only use when entityKey !== "" to avoid hot partition scan.
 */
export const getMentionsByEntity = internalQuery({
  args: {
    entityKey: v.string(),
    limit: v.optional(v.number()),
    sinceMs: v.optional(v.number()),
  },
  handler: async (ctx, { entityKey, limit = 100, sinceMs }) => {
    // Guard against empty entityKey queries
    if (!entityKey) {
      console.warn("[globalResearch/mentions] getMentionsByEntity called with empty entityKey");
      return [];
    }

    const query = ctx.db
      .query("globalArtifactMentions")
      .withIndex("by_entityKey_seenAt", (q) => {
        const base = q.eq("entityKey", entityKey);
        return sinceMs ? base.gte("seenAt", sinceMs) : base;
      })
      .order("desc");

    return query.take(limit);
  },
});

/**
 * Count mentions in a time window.
 */
export const countMentions = internalQuery({
  args: {
    sinceMs: v.number(),
    untilMs: v.optional(v.number()),
  },
  handler: async (ctx, { sinceMs, untilMs }) => {
    const until = untilMs ?? Date.now();

    const mentions = await ctx.db
      .query("globalArtifactMentions")
      .withIndex("by_seenAt", (q) => q.gte("seenAt", sinceMs).lte("seenAt", until))
      .collect();

    return mentions.length;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// COMPACTION & RETENTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compact mentions from a time window into aggregates.
 * Called by compaction cron.
 */
export const compactMentionsWindow = internalMutation({
  args: {
    fromMs: v.number(),
    toMs: v.number(),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    mentionsProcessed: v.number(),
    aggregatesUpserted: v.number(),
  }),
  handler: async (ctx, { fromMs, toMs, batchSize = 1000 }) => {
    // Get mentions in window
    const mentions = await ctx.db
      .query("globalArtifactMentions")
      .withIndex("by_seenAt", (q) => q.gte("seenAt", fromMs).lte("seenAt", toMs))
      .take(batchSize);

    if (mentions.length === 0) {
      return { mentionsProcessed: 0, aggregatesUpserted: 0 };
    }

    // Group by (artifactKey, queryKey, dayBucket)
    const groups = new Map<
      string,
      {
        artifactKey: string;
        queryKey: string;
        entityKey: string;
        dayBucket: string;
        count: number;
        bestRank: number | undefined;
        firstSeenAt: number;
        lastSeenAt: number;
      }
    >();

    for (const m of mentions) {
      const dayBucket = getDayBucket(m.seenAt);
      const aggKey = generateAggKey(m.artifactKey, m.queryKey, dayBucket);

      const existing = groups.get(aggKey);
      if (existing) {
        existing.count++;
        if (m.rank !== undefined) {
          existing.bestRank =
            existing.bestRank === undefined
              ? m.rank
              : Math.min(existing.bestRank, m.rank);
        }
        existing.firstSeenAt = Math.min(existing.firstSeenAt, m.seenAt);
        existing.lastSeenAt = Math.max(existing.lastSeenAt, m.seenAt);
      } else {
        groups.set(aggKey, {
          artifactKey: m.artifactKey,
          queryKey: m.queryKey,
          entityKey: m.entityKey,
          dayBucket,
          count: 1,
          bestRank: m.rank,
          firstSeenAt: m.seenAt,
          lastSeenAt: m.seenAt,
        });
      }
    }

    // Upsert aggregates
    let aggregatesUpserted = 0;
    for (const [aggKey, group] of groups) {
      const existing = await ctx.db
        .query("globalMentionAgg")
        .withIndex("by_aggKey", (q) => q.eq("aggKey", aggKey))
        .first() as Doc<"globalMentionAgg"> | null;

      if (existing) {
        // Merge with existing
        const newBestRank =
          existing.bestRank === undefined
            ? group.bestRank
            : group.bestRank === undefined
              ? existing.bestRank
              : Math.min(existing.bestRank, group.bestRank);

        await ctx.db.patch(existing._id, {
          mentionCount: existing.mentionCount + group.count,
          bestRank: newBestRank,
          firstSeenAt: Math.min(existing.firstSeenAt, group.firstSeenAt),
          lastSeenAt: Math.max(existing.lastSeenAt, group.lastSeenAt),
        });
      } else {
        // Insert new aggregate
        await ctx.db.insert("globalMentionAgg", {
          aggKey,
          artifactKey: group.artifactKey,
          queryKey: group.queryKey,
          entityKey: group.entityKey,
          dayBucket: group.dayBucket,
          mentionCount: group.count,
          bestRank: group.bestRank,
          firstSeenAt: group.firstSeenAt,
          lastSeenAt: group.lastSeenAt,
        });
      }
      aggregatesUpserted++;
    }

    return {
      mentionsProcessed: mentions.length,
      aggregatesUpserted,
    };
  },
});

/**
 * Purge old mentions beyond retention period.
 * Called by retention cron.
 */
export const purgeOldMentions = internalMutation({
  args: {
    retentionDays: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    deleted: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, { retentionDays = MENTION_RETENTION_DAYS, batchSize = 500 }) => {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    const oldMentions = await ctx.db
      .query("globalArtifactMentions")
      .withIndex("by_seenAt", (q) => q.lt("seenAt", cutoff))
      .take(batchSize + 1);

    const hasMore = oldMentions.length > batchSize;
    const toDelete = oldMentions.slice(0, batchSize);

    for (const mention of toDelete) {
      await ctx.db.delete(mention._id);
    }

    if (toDelete.length > 0) {
      console.log(
        `[globalResearch/mentions] Purged ${toDelete.length} old mentions`,
        { cutoffDate: new Date(cutoff).toISOString(), hasMore }
      );
    }

    return {
      deleted: toDelete.length,
      hasMore,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// AGGREGATE QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get aggregates for a query by day.
 */
export const getAggByQuery = internalQuery({
  args: {
    queryKey: v.string(),
    fromDay: v.optional(v.string()),
    toDay: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { queryKey, fromDay, toDay, limit = 30 }) => {
    // Fetch all for this queryKey and filter in memory
    // (Convex doesn't support complex range queries on compound indexes)
    const aggs = await ctx.db
      .query("globalMentionAgg")
      .withIndex("by_queryKey_day", (q) => q.eq("queryKey", queryKey))
      .order("desc")
      .take(limit * 3); // Overfetch to allow filtering

    // Filter by date range in memory
    const filtered = aggs.filter((a: Doc<"globalMentionAgg">) => {
      if (fromDay && a.dayBucket < fromDay) return false;
      if (toDay && a.dayBucket > toDay) return false;
      return true;
    });

    return filtered.slice(0, limit);
  },
});

/**
 * Get aggregates for an entity by day.
 * WARNING: Only use when entityKey !== "".
 */
export const getAggByEntity = internalQuery({
  args: {
    entityKey: v.string(),
    fromDay: v.optional(v.string()),
    toDay: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { entityKey, fromDay, toDay, limit = 30 }) => {
    if (!entityKey) {
      console.warn("[globalResearch/mentions] getAggByEntity called with empty entityKey");
      return [];
    }

    // Fetch all for this entityKey and filter in memory
    const aggs = await ctx.db
      .query("globalMentionAgg")
      .withIndex("by_entityKey_day", (q) => q.eq("entityKey", entityKey))
      .order("desc")
      .take(limit * 3);

    // Filter by date range in memory
    const filtered = aggs.filter((a: Doc<"globalMentionAgg">) => {
      if (fromDay && a.dayBucket < fromDay) return false;
      if (toDay && a.dayBucket > toDay) return false;
      return true;
    });

    return filtered.slice(0, limit);
  },
});

/**
 * Get top artifacts for a day (for "trending today" views).
 */
export const getTopByDay = internalQuery({
  args: {
    dayBucket: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { dayBucket, limit = 50 }) => {
    const aggs = await ctx.db
      .query("globalMentionAgg")
      .withIndex("by_dayBucket", (q) => q.eq("dayBucket", dayBucket))
      .collect();

    // Sort by mentionCount descending
    aggs.sort((a: Doc<"globalMentionAgg">, b: Doc<"globalMentionAgg">) => b.mentionCount - a.mentionCount);

    return aggs.slice(0, limit);
  },
});
