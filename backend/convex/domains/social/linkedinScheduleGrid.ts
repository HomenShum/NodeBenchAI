"use node";

/**
 * LinkedIn Schedule Grid - Time slot management for org page posts
 *
 * Slots: 2-3 per day, priority-based assignment.
 * Prevents over-posting and ensures consistent cadence.
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULE GRID DEFINITION
// ═══════════════════════════════════════════════════════════════════════════

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

interface SlotDefinition {
  id: string;
  hourUTC: number;
  minuteUTC: number;
  daysOfWeek: string[];
  description: string;
  target: "personal" | "organization";
}

/**
 * Org page posting slots — 2-3 per day.
 * All post types accepted in all slots (backfill, fresh, manual).
 */
const ORG_PAGE_SLOTS: SlotDefinition[] = [
  {
    id: "org_morning",
    hourUTC: 8,
    minuteUTC: 0,
    daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    description: "Morning slot (8 AM UTC)",
    target: "organization",
  },
  {
    id: "org_midday",
    hourUTC: 13,
    minuteUTC: 0,
    daysOfWeek: ["monday", "wednesday", "friday"],
    description: "Midday slot (1 PM UTC)",
    target: "organization",
  },
  {
    id: "org_afternoon",
    hourUTC: 16,
    minuteUTC: 0,
    daysOfWeek: ["tuesday", "thursday"],
    description: "Afternoon slot (4 PM UTC)",
    target: "organization",
  },
];

/**
 * Personal profile posting slots — 3/week (Mon/Wed/Fri evenings).
 * Evening time avoids competing with org morning/midday posts in followers' feeds.
 */
const PERSONAL_SLOTS: SlotDefinition[] = [
  {
    id: "personal_monday",
    hourUTC: 18,
    minuteUTC: 0,
    daysOfWeek: ["monday"],
    description: "Personal Monday (6 PM UTC)",
    target: "personal",
  },
  {
    id: "personal_wednesday",
    hourUTC: 18,
    minuteUTC: 0,
    daysOfWeek: ["wednesday"],
    description: "Personal Wednesday (6 PM UTC)",
    target: "personal",
  },
  {
    id: "personal_friday",
    hourUTC: 18,
    minuteUTC: 0,
    daysOfWeek: ["friday"],
    description: "Personal Friday (6 PM UTC)",
    target: "personal",
  },
];

/** All slots combined, filterable by target. */
const ALL_SLOTS: SlotDefinition[] = [...ORG_PAGE_SLOTS, ...PERSONAL_SLOTS];

/**
 * Find the next available slot from a given date.
 * Searches up to 14 days ahead.
 */
function getNextAvailableSlot(
  fromDate: Date,
  target?: "personal" | "organization",
): {
  slotId: string;
  scheduledFor: number;
  description: string;
} | null {
  const slots = target
    ? ALL_SLOTS.filter((s) => s.target === target)
    : ORG_PAGE_SLOTS; // backwards-compatible default

  for (let daysAhead = 0; daysAhead < 14; daysAhead++) {
    const checkDate = new Date(fromDate);
    checkDate.setUTCDate(checkDate.getUTCDate() + daysAhead);

    const dayOfWeek = DAY_NAMES[checkDate.getUTCDay()];

    for (const slot of slots) {
      if (!slot.daysOfWeek.includes(dayOfWeek)) continue;

      const slotDate = new Date(checkDate);
      slotDate.setUTCHours(slot.hourUTC, slot.minuteUTC, 0, 0);

      // Only future slots
      if (slotDate.getTime() > fromDate.getTime()) {
        return {
          slotId: slot.id,
          scheduledFor: slotDate.getTime(),
          description: `${slot.description} on ${dayOfWeek} (${slotDate.toISOString().split("T")[0]})`,
        };
      }
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULING ACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schedule the next approved post into an available time slot.
 * Called by cron every hour.
 */
export const scheduleNextApprovedPost = internalAction({
  args: {
    target: v.optional(v.union(v.literal("personal"), v.literal("organization"))),
  },
  handler: async (ctx, args) => {
    const target = args.target || "organization";

    // Get highest-priority approved post
    const item = await ctx.runQuery(
      internal.domains.social.linkedinContentQueue.getNextApprovedForScheduling,
      { target },
    );

    if (!item) {
      return { scheduled: false, reason: "no_approved_posts" };
    }

    // Find next available slot (filtered by target)
    const now = new Date();
    let slot = getNextAvailableSlot(now, target);

    if (!slot) {
      console.log(`[schedule] No available slots in next 14 days`);
      return { scheduled: false, reason: "no_slots_available" };
    }

    // Check if slot is already taken — advance if needed
    for (let attempts = 0; attempts < 30; attempts++) {
      const taken = await ctx.runQuery(
        internal.domains.social.linkedinContentQueue.isSlotTaken,
        { scheduledSlot: slot!.slotId, scheduledFor: slot!.scheduledFor },
      );

      if (!taken) break;

      // Try next slot from just after the taken one
      const nextFrom = new Date(slot!.scheduledFor + 1);
      slot = getNextAvailableSlot(nextFrom, target);

      if (!slot) {
        console.log(`[schedule] All slots taken in next 14 days`);
        return { scheduled: false, reason: "all_slots_taken" };
      }
    }

    // Assign post to slot
    await ctx.runMutation(
      internal.domains.social.linkedinContentQueue.updateQueueStatus,
      {
        queueId: item._id,
        status: "scheduled",
        scheduledSlot: slot!.slotId,
        scheduledFor: slot!.scheduledFor,
      },
    );

    console.log(`[schedule] Scheduled ${item._id} (${item.postType}, priority=${item.priority}) → ${slot!.description}`);

    return {
      scheduled: true,
      queueId: item._id,
      slotId: slot!.slotId,
      scheduledFor: slot!.scheduledFor,
      description: slot!.description,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// BACKFILL - Load personal archive into content queue
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Backfill personal archive posts into the content queue for org page reposting.
 *
 * Usage:
 *   npx convex run domains/social/linkedinScheduleGrid:backfillPersonalToQueue '{"limit":5,"dryRun":true}'
 *   npx convex run domains/social/linkedinScheduleGrid:backfillPersonalToQueue '{"limit":67,"dryRun":false}'
 */
export const backfillPersonalToQueue = internalAction({
  args: {
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 67;
    const dryRun = args.dryRun ?? true;

    console.log(`[backfill] Starting: limit=${limit}, dryRun=${dryRun}`);

    // Get personal archive posts
    const personalPosts = await ctx.runQuery(
      internal.workflows.dailyLinkedInPostMutations.getPersonalArchivePosts,
      { limit: 500 },
    );

    console.log(`[backfill] Found ${personalPosts.length} personal archive posts`);

    // Deduplicate within the set (same content = keep first occurrence only)
    const seen = new Set<string>();
    const uniquePosts = personalPosts.filter((p: any) => {
      const key = p.content.trim().toLowerCase().substring(0, 200);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`[backfill] ${uniquePosts.length} unique posts after internal dedup (removed ${personalPosts.length - uniquePosts.length} duplicates)`);

    const results = {
      total: 0,
      queued: 0,
      duplicateInQueue: 0,
      alreadyOnOrg: 0,
      errors: 0,
    };

    const postsToProcess = uniquePosts.slice(0, limit);

    for (const post of postsToProcess) {
      results.total++;

      if (dryRun) {
        console.log(`[backfill] [DRY] ${post.postType || "unknown"} (${post.dateString}) - ${post.content.substring(0, 60)}...`);
        continue;
      }

      try {
        const result = await ctx.runMutation(
          internal.domains.social.linkedinContentQueue.enqueueContent,
          {
            content: post.content,
            postType: post.postType || "backfill",
            persona: post.persona || "GENERAL",
            target: "organization",
            source: "backfill",
            sourcePostId: post.postId,
            metadata: {
              originalDateString: post.dateString,
              originalTarget: "personal",
              originalPostUrl: post.postUrl,
            },
          },
        );

        if (result.queued) {
          results.queued++;
        } else if (result.reason === "duplicate_in_queue") {
          results.duplicateInQueue++;
        } else if (result.reason === "already_posted_to_org") {
          results.alreadyOnOrg++;
        }
      } catch (error) {
        results.errors++;
        console.error(`[backfill] Error:`, error);
      }

      // Small delay between mutations
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    console.log(`[backfill] Complete:`, JSON.stringify(results));
    return results;
  },
});
