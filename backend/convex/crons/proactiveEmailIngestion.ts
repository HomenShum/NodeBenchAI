/**
 * Proactive Email Ingestion Cron
 * Automatically ingests recent emails into the proactive event bus
 *
 * Schedule: Every 15 minutes
 * Purpose: Keep proactive events up-to-date with latest email activity
 */

import { cronJobs } from "convex/server";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";

/**
 * Orchestrator that processes email ingestion for all users with proactive consent
 */
export const orchestrateEmailIngestion = internalMutation({
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

    console.log(`[proactiveEmailIngestion] Processing ${consents.length} users with consent`);

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

        // Batch ingest emails for this user
        const since = Date.now() - 24 * 60 * 60 * 1000; // Last 24 hours
        await ctx.runMutation(
          internal.domains.proactive.adapters.emailEventAdapter.batchIngestEmails,
          {
            userId: consent.userId,
            since,
            limit: 50,
          }
        );

        processed++;
      } catch (error: any) {
        console.error(
          `[proactiveEmailIngestion] Error processing user ${consent.userId}:`,
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
  "proactive-email-ingestion",
  { minutes: 15 }, // Run every 15 minutes
  internal.crons.proactiveEmailIngestion.orchestrateEmailIngestion
);

export default crons;
