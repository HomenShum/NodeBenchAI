/**
 * Narrative Domain Cron Handlers
 *
 * Internal mutations/actions called by the cron jobs.
 *
 * @module domains/narrative/cronHandlers
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalAction,
  internalQuery,
} from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Doc } from "../../../_generated/dataModel";
import { getCurrentWeekNumber } from "./newsroom/state";

/**
 * Get all users who have narrative threads (for pipeline scheduling)
 */
export const getUsersWithNarratives = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Get unique user IDs from threads
    const threads = await ctx.db.query("narrativeThreads").collect();
    const userIds = [...new Set(threads.map((t: Doc<"narrativeThreads">) => t.userId))];

    // Also get entity keys per user for targeted searches
    const userEntityMap = new Map<string, Set<string>>();
    for (const thread of threads) {
      const userId = thread.userId as string;
      if (!userEntityMap.has(userId)) {
        userEntityMap.set(userId, new Set());
      }
      for (const entityKey of thread.entityKeys) {
        userEntityMap.get(userId)!.add(entityKey);
      }
    }

    return Array.from(userEntityMap.entries()).map(([userId, entityKeys]) => ({
      userId,
      entityKeys: Array.from(entityKeys),
    }));
  },
});

/**
 * Trigger weekly pipelines for all users with narratives
 */
export const triggerWeeklyPipelines = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("[Cron] Triggering weekly newsroom pipelines...");

    // Get users with narratives
    const usersWithNarratives = await ctx.runQuery(
      internal.domains.narrative.cronHandlers.getUsersWithNarratives
    );

    if (usersWithNarratives.length === 0) {
      console.log("[Cron] No users with narratives to process");
      return { processed: 0 };
    }

    console.log(`[Cron] Processing ${usersWithNarratives.length} users`);

    const weekNumber = getCurrentWeekNumber();
    let processed = 0;
    let failed = 0;

    for (const { userId, entityKeys } of usersWithNarratives) {
      try {
        // Run pipeline for this user
        await ctx.runAction(internal.domains.narrative.newsroom.workflow.runPipeline, {
          entityKeys,
          weekNumber,
          userId: userId as any,
        });
        processed++;
        console.log(`[Cron] Pipeline completed for user ${userId}`);
      } catch (error) {
        failed++;
        console.error(`[Cron] Pipeline failed for user ${userId}:`, error);
      }
    }

    console.log(`[Cron] Weekly pipelines complete: ${processed} succeeded, ${failed} failed`);
    return { processed, failed };
  },
});

/**
 * Mark threads as dormant if no activity in 30 days
 */
export const markDormantThreads = internalMutation({
  args: {},
  handler: async (ctx) => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    // Find threads with no recent activity that aren't already dormant
    const threads = await ctx.db.query("narrativeThreads").collect();

    let markedCount = 0;
    for (const thread of threads) {
      if (
        thread.latestEventAt < thirtyDaysAgo &&
        thread.currentPhase !== "dormant"
      ) {
        await ctx.db.patch(thread._id, {
          currentPhase: "dormant",
          updatedAt: Date.now(),
        });
        markedCount++;
        console.log(`[Cron] Marked thread "${thread.name}" as dormant`);
      }
    }

    console.log(`[Cron] Marked ${markedCount} threads as dormant`);
    return { markedCount };
  },
});

/**
 * Clean up old search logs (older than 90 days)
 */
export const cleanupOldSearchLogs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;

    const oldLogs = await ctx.db
      .query("narrativeSearchLog")
      .filter((q) => q.lt(q.field("searchedAt"), ninetyDaysAgo))
      .collect();

    for (const log of oldLogs) {
      await ctx.db.delete(log._id);
    }

    console.log(`[Cron] Deleted ${oldLogs.length} old search logs`);
    return { deleted: oldLogs.length };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 8: DEFENSIBILITY CRON HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Expire old quarantine entries.
 * Marks pending entries past their expiry date as expired.
 */
export const expireQuarantineEntries = internalMutation({
  args: {},
  returns: v.object({
    expired: v.number(),
  }),
  handler: async (ctx) => {
    const result = await ctx.runMutation(
      internal.domains.narrative.guards.quarantine.expireOldEntries
    );

    console.log(`[Cron] Expired ${result} quarantine entries`);
    return { expired: result };
  },
});

/**
 * Enforce content TTL - delete expired content based on content rights policies.
 * Runs daily to remove content past its TTL.
 */
export const enforceContentTTL = internalAction({
  args: {},
  returns: v.object({
    deletedCount: v.number(),
    errors: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const result = await ctx.runAction(
      internal.domains.narrative.mutations.policyEnforcedOps.enforceContentTTL
    );

    console.log(
      `[Cron] Content TTL enforcement: deleted ${result.deletedCount}, ` +
        `errors: ${result.errors.length}`
    );
    return result;
  },
});
