// convex/globalResearch/compaction.ts
// Cron-driven compaction, retention, and dedupe for global research tables.
// Runs incrementally using state singletons to track progress.

import { v } from "convex/values";
import { internalMutation, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { MENTION_RETENTION_DAYS, getDayBucket } from "./mentions";
import { Doc } from "../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Compaction window: process 24 hours at a time */
const COMPACTION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Default batch sizes */
const MENTION_BATCH_SIZE = 1000;
const ARTIFACT_BATCH_SIZE = 50;

// ═══════════════════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get or create compaction state singleton.
 */
export const getCompactionState = internalMutation({
  args: {
    compactionType: v.string(),
  },
  handler: async (ctx, { compactionType }) => {
    const existing = await ctx.db
      .query("globalCompactionState")
      .withIndex("by_type", (q) => q.eq("compactionType", compactionType))
      .first() as Doc<"globalCompactionState"> | null;

    if (existing) {
      return existing;
    }

    // Create new state - start from 30 days ago for mentions
    const initialProcessedAt =
      compactionType === "mentions"
        ? Date.now() - MENTION_RETENTION_DAYS * 24 * 60 * 60 * 1000
        : 0;

    const id = await ctx.db.insert("globalCompactionState", {
      compactionType,
      lastProcessedAt: initialProcessedAt,
      lastRunAt: Date.now(),
    });

    return await ctx.db.get(id) as Doc<"globalCompactionState"> | null;
  },
});

/**
 * Update compaction state after a run.
 */
export const updateCompactionState = internalMutation({
  args: {
    compactionType: v.string(),
    lastProcessedAt: v.number(),
    mentionsCompacted: v.optional(v.number()),
    mentionsPurged: v.optional(v.number()),
    duplicatesMerged: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("globalCompactionState")
      .withIndex("by_type", (q) => q.eq("compactionType", args.compactionType))
      .first() as Doc<"globalCompactionState"> | null;

    if (!state) {
      console.error(
        `[globalResearch/compaction] State not found for ${args.compactionType}`
      );
      return;
    }

    await ctx.db.patch(state._id, {
      lastProcessedAt: args.lastProcessedAt,
      lastRunAt: Date.now(),
      mentionsCompacted: args.mentionsCompacted,
      mentionsPurged: args.mentionsPurged,
      duplicatesMerged: args.duplicatesMerged,
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MENTION COMPACTION CRON
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compact mentions from raw table to aggregates.
 * Called by daily cron. Processes one 24h window per run.
 */
export const compactMentions = internalAction({
  handler: async (ctx): Promise<{ error?: string; upToDate?: boolean; mentionsProcessed?: number; aggregatesUpserted?: number }> => {
    // Get current state
    const state = await ctx.runMutation(
      internal.globalResearch.compaction.getCompactionState,
      { compactionType: "mentions" }
    ) as { lastProcessedAt: number } | null;

    if (!state) {
      console.error("[globalResearch/compaction] Failed to get mentions state");
      return { error: "Failed to get state" };
    }

    const now = Date.now();
    const retentionCutoff = now - MENTION_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    // Don't compact data newer than retention period (still in raw form)
    if (state.lastProcessedAt >= retentionCutoff) {
      console.log("[globalResearch/compaction] Mentions up to date");
      return { upToDate: true };
    }

    // Process one window
    const fromMs: number = state.lastProcessedAt;
    const toMs = Math.min(fromMs + COMPACTION_WINDOW_MS, retentionCutoff);

    const result = await ctx.runMutation(
      internal.globalResearch.mentions.compactMentionsWindow,
      { fromMs, toMs, batchSize: MENTION_BATCH_SIZE }
    ) as { mentionsProcessed: number; aggregatesUpserted: number };

    // Update state
    await ctx.runMutation(
      internal.globalResearch.compaction.updateCompactionState,
      {
        compactionType: "mentions",
        lastProcessedAt: toMs,
        mentionsCompacted: result.aggregatesUpserted,
      }
    );

    console.log(
      `[globalResearch/compaction] Compacted mentions`,
      {
        window: `${getDayBucket(fromMs)} to ${getDayBucket(toMs)}`,
        processed: result.mentionsProcessed,
        aggregated: result.aggregatesUpserted,
      }
    );

    return result;
  },
});

/**
 * Purge old mentions beyond retention period.
 * Called by daily cron.
 */
export const purgeMentions = internalAction({
  handler: async (ctx) => {
    let totalDeleted = 0;
    let hasMore = true;

    // Process in batches until done
    while (hasMore) {
      const result = await ctx.runMutation(
        internal.globalResearch.mentions.purgeOldMentions,
        { retentionDays: MENTION_RETENTION_DAYS, batchSize: 500 }
      );

      totalDeleted += result.deleted;
      hasMore = result.hasMore;

      // Safety limit
      if (totalDeleted >= 10000) {
        console.log(
          "[globalResearch/compaction] Purge limit reached, will continue next run"
        );
        break;
      }
    }

    // Update state
    await ctx.runMutation(
      internal.globalResearch.compaction.updateCompactionState,
      {
        compactionType: "mentions",
        lastProcessedAt: Date.now() - MENTION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
        mentionsPurged: totalDeleted,
      }
    );

    return { deleted: totalDeleted };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// ARTIFACT DEDUPE CRON
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deduplicate global artifacts.
 * Called by daily cron.
 */
export const dedupeArtifacts = internalAction({
  handler: async (ctx): Promise<{ processed: number; duplicatesFound: number; artifactsMerged: number }> => {
    const result = await ctx.runMutation(
      internal.globalResearch.artifacts.dedupeArtifactsBatch,
      { batchSize: ARTIFACT_BATCH_SIZE }
    ) as { processed: number; duplicatesFound: number; artifactsMerged: number };

    if (result.duplicatesFound > 0) {
      // Update state
      await ctx.runMutation(
        internal.globalResearch.compaction.updateCompactionState,
        {
          compactionType: "artifacts",
          lastProcessedAt: Date.now(),
          duplicatesMerged: result.artifactsMerged,
        }
      );
    }

    return result;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STALE LOCK CLEANUP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Clean up stale locks that were never released.
 * Called by hourly cron (optional).
 */
export const cleanupStaleLocks = internalMutation({
  args: {
    maxAgeMs: v.optional(v.number()),
  },
  returns: v.object({
    cleaned: v.number(),
  }),
  handler: async (ctx, { maxAgeMs = 60 * 60 * 1000 }) => {
    const cutoff = Date.now() - maxAgeMs;

    // Find running locks older than cutoff
    const staleLocks = await ctx.db
      .query("globalQueryLocks")
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "running"),
          q.lt(q.field("startedAt"), cutoff)
        )
      )
      .take(100) as Doc<"globalQueryLocks">[];

    let cleaned = 0;
    for (const lock of staleLocks) {
      await ctx.db.patch(lock._id, {
        status: "failed",
        failedAt: Date.now(),
        error: "Cleaned up: stale lock exceeded max age",
      });
      cleaned++;
    }

    if (cleaned > 0) {
      console.log(
        `[globalResearch/compaction] Cleaned ${cleaned} stale locks`
      );
    }

    return { cleaned };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// EVENT RETENTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Purge old research events beyond retention period.
 * Called by weekly cron (events are less voluminous).
 */
export const purgeOldEvents = internalMutation({
  args: {
    retentionDays: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    deleted: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, { retentionDays = 90, batchSize = 500 }) => {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    const oldEvents = await ctx.db
      .query("globalResearchEvents")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .take(batchSize + 1) as Doc<"globalResearchEvents">[];

    const hasMore = oldEvents.length > batchSize;
    const toDelete = oldEvents.slice(0, batchSize);

    for (const event of toDelete) {
      await ctx.db.delete(event._id);
    }

    if (toDelete.length > 0) {
      console.log(
        `[globalResearch/compaction] Purged ${toDelete.length} old events`,
        { cutoffDate: new Date(cutoff).toISOString() }
      );
    }

    return {
      deleted: toDelete.length,
      hasMore,
    };
  },
});
