/**
 * Proactive Calendar Ingestion Cron
 * Automatically ingests calendar events into the proactive event bus
 *
 * Schedule: Every 30 minutes
 * Purpose: Keep proactive events up-to-date with upcoming meetings
 */

import { cronJobs } from "convex/server";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";

/**
 * Orchestrator that processes calendar ingestion for all users with proactive consent
 */
export const orchestrateCalendarIngestion = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Find all users with proactive consent
    const consents = await ctx.db
      .query("userConsents")
      .filter((q) =>
        q.and(
          q.eq(q.field("consentType"), "proactive_features"),
          q.eq(q.field("granted"), true)
        )
      )
      .collect();

    console.log(
      `[proactiveCalendarIngestion] Processing ${consents.length} users with consent`
    );

    let processed = 0;
    let errors = 0;

    for (const consent of consents) {
      try {
        // Check if user has proactive settings enabled
        const settings = await ctx.db
          .query("userProactiveSettings")
          .withIndex("by_user", (q) => q.eq("userId", consent.userId))
          .first();

        if (!settings || !settings.proactiveEnabled) {
          continue; // Skip users with proactive disabled
        }

        // Check if meeting_prep is enabled
        if (!settings.features.meetingPrep) {
          continue; // Skip users who don't want meeting prep
        }

        // Batch ingest calendar events for this user
        const since = Date.now(); // Starting from now
        await ctx.runMutation(
          internal.domains.proactive.adapters.calendarEventAdapter.batchIngestCalendarEvents,
          {
            userId: consent.userId,
            since,
            limit: 50,
          }
        );

        processed++;
      } catch (error: any) {
        console.error(
          `[proactiveCalendarIngestion] Error processing user ${consent.userId}:`,
          error.message
        );
        errors++;
      }
    }

    return {
      success: true,
      usersProcessed: processed,
      errors,
      timestamp: Date.now(),
    };
  },
});

const crons = cronJobs();

crons.interval(
  "proactive-calendar-ingestion",
  { minutes: 30 }, // Run every 30 minutes
  internal.crons.proactiveCalendarIngestion.orchestrateCalendarIngestion
);

export default crons;
