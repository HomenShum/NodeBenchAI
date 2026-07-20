/**
 * Detector Executor
 * Orchestrates detector execution and opportunity creation
 *
 * Responsibilities:
 * - Execute detectors (streaming or batch)
 * - Create opportunities in database
 * - Track detector runs for observability
 * - Handle errors and retries
 */

import { internalMutation, internalAction } from "../../../_generated/server";
import { v } from "convex/values";
import type { DetectorContext } from "./types";
import { detectorRegistry } from "./registry";
import { meetingPrepDetector } from "./meetingPrepDetector";
import { followUpDetector } from "./followUpDetector";
import { dailyBriefDetector } from "./dailyBriefDetector";

// Register all detectors
detectorRegistry.register(meetingPrepDetector);
detectorRegistry.register(followUpDetector);
detectorRegistry.register(dailyBriefDetector);

/**
 * Execute a streaming detector for a single event
 */
export const executeStreamingDetector = internalMutation({
  args: {
    detectorId: v.string(),
    userId: v.id("users"),
    proactiveEventId: v.id("proactiveEvents"),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();

    try {
      // Get detector
      const detector = detectorRegistry.get(args.detectorId);
      if (!detector) {
        throw new Error(`Detector ${args.detectorId} not found`);
      }

      if (detector.metadata.mode !== "streaming") {
        throw new Error(`Detector ${args.detectorId} is not a streaming detector`);
      }

      // Get event
      const proactiveEvent = await ctx.db.get(args.proactiveEventId);
      if (!proactiveEvent) {
        throw new Error(`Proactive event ${args.proactiveEventId} not found`);
      }

      // Get user settings
      const settings = await ctx.db
        .query("userProactiveSettings")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .first();

      // Build context
      const detectorContext: DetectorContext = {
        userId: args.userId,
        db: ctx.db,
        event: {
          eventId: proactiveEvent.eventId,
          eventType: proactiveEvent.eventType,
          timestamp: proactiveEvent.timestamp,
          source: proactiveEvent.source,
          summary: proactiveEvent.summary,
          contentPointer: proactiveEvent.contentPointer,
          entities: proactiveEvent.entities,
          metadata: proactiveEvent.metadata,
        },
        userSettings: settings
          ? {
              enabledDetectors: settings.enabledDetectors,
              quietHoursStart: settings.quietHoursStart,
              quietHoursEnd: settings.quietHoursEnd,
              timezone: settings.timezone,
              minimumConfidence: settings.minimumConfidence,
            }
          : undefined,
      };

      // Execute detector
      const result = await detector.run(detectorContext);

      // Create detector run record
      const runRecordId = await ctx.db.insert("detectorRuns", {
        detectorId: args.detectorId,
        detectorVersion: detector.metadata.version,
        userId: args.userId,
        status: result.success ? "completed" : "failed",
        inputEventId: proactiveEvent.eventId,
        opportunitiesDetected: result.opportunities.length,
        opportunities: [],
        startedAt: startTime,
        completedAt: Date.now(),
        executionTime: Date.now() - startTime,
        error: result.error,
        warnings: result.warnings,
        metadata: {
          eventType: proactiveEvent.eventType,
        },
      });

      // Create opportunities
      const opportunityIds: string[] = [];
      for (const opportunity of result.opportunities) {
        const oppId = await createOpportunity(ctx, opportunity, args.userId);
        opportunityIds.push(oppId);
      }

      // Update run record with opportunity IDs
      await ctx.db.patch(runRecordId, {
        opportunities: opportunityIds,
      });

      // Mark event as processed
      await ctx.db.patch(args.proactiveEventId, {
        processingStatus: "processed",
        processedAt: Date.now(),
      });

      return {
        success: true,
        runId: runRecordId,
        opportunitiesCreated: opportunityIds.length,
        opportunityIds,
      };
    } catch (error: any) {
      console.error(`[DetectorExecutor] Error executing ${args.detectorId}:`, error.message);

      // Create failed run record
      await ctx.db.insert("detectorRuns", {
        detectorId: args.detectorId,
        detectorVersion: "unknown",
        userId: args.userId,
        status: "failed",
        inputEventId: args.proactiveEventId.toString(),
        opportunitiesDetected: 0,
        opportunities: [],
        startedAt: startTime,
        completedAt: Date.now(),
        executionTime: Date.now() - startTime,
        error: error.message,
      });

      throw error;
    }
  },
});

/**
 * Execute a batch detector
 */
export const executeBatchDetector = internalMutation({
  args: {
    detectorId: v.string(),
    userId: v.id("users"),
    startTime: v.number(),
    endTime: v.number(),
  },
  handler: async (ctx, args) => {
    const executionStartTime = Date.now();

    try {
      // Get detector
      const detector = detectorRegistry.get(args.detectorId);
      if (!detector) {
        throw new Error(`Detector ${args.detectorId} not found`);
      }

      if (detector.metadata.mode !== "batch") {
        throw new Error(`Detector ${args.detectorId} is not a batch detector`);
      }

      // Get user settings
      const settings = await ctx.db
        .query("userProactiveSettings")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .first();

      // Query events in time window
      const events = await ctx.db
        .query("proactiveEvents")
        .withIndex("by_timestamp", (q) =>
          q.gte("timestamp", args.startTime).lte("timestamp", args.endTime)
        )
        .collect();

      // Build context with helper methods
      const detectorContext: DetectorContext = {
        userId: args.userId,
        db: ctx.db,
        timeWindow: {
          startTime: args.startTime,
          endTime: args.endTime,
        },
        userSettings: settings
          ? {
              enabledDetectors: settings.enabledDetectors,
              quietHoursStart: settings.quietHoursStart,
              quietHoursEnd: settings.quietHoursEnd,
              timezone: settings.timezone,
              minimumConfidence: settings.minimumConfidence,
            }
          : undefined,
        queryEvents: async (filter: any) => {
          const filtered = events.filter((e) => {
            if (filter.eventTypes && !filter.eventTypes.includes(e.eventType)) {
              return false;
            }
            return true;
          });
          return filtered.map((e) => ({
            eventId: e.eventId,
            eventType: e.eventType,
            timestamp: e.timestamp,
            source: e.source,
            summary: e.summary,
            contentPointer: e.contentPointer,
            entities: e.entities,
            metadata: e.metadata,
          }));
        },
      };

      // Execute detector
      const result = await detector.run(detectorContext);

      // Create detector run record
      const runRecordId = await ctx.db.insert("detectorRuns", {
        detectorId: args.detectorId,
        detectorVersion: detector.metadata.version,
        userId: args.userId,
        status: result.success ? "completed" : "failed",
        inputTimeWindow: {
          startTime: args.startTime,
          endTime: args.endTime,
        },
        opportunitiesDetected: result.opportunities.length,
        opportunities: [],
        startedAt: executionStartTime,
        completedAt: Date.now(),
        executionTime: Date.now() - executionStartTime,
        error: result.error,
        warnings: result.warnings,
        metadata: {
          eventsProcessed: result.eventsProcessed,
        },
      });

      // Create opportunities
      const opportunityIds: string[] = [];
      for (const opportunity of result.opportunities) {
        const oppId = await createOpportunity(ctx, opportunity, args.userId);
        opportunityIds.push(oppId);
      }

      // Update run record with opportunity IDs
      await ctx.db.patch(runRecordId, {
        opportunities: opportunityIds,
      });

      return {
        success: true,
        runId: runRecordId,
        opportunitiesCreated: opportunityIds.length,
        opportunityIds,
      };
    } catch (error: any) {
      console.error(`[DetectorExecutor] Error executing ${args.detectorId}:`, error.message);

      // Create failed run record
      await ctx.db.insert("detectorRuns", {
        detectorId: args.detectorId,
        detectorVersion: "unknown",
        userId: args.userId,
        status: "failed",
        inputTimeWindow: {
          startTime: args.startTime,
          endTime: args.endTime,
        },
        opportunitiesDetected: 0,
        opportunities: [],
        startedAt: executionStartTime,
        completedAt: Date.now(),
        executionTime: Date.now() - executionStartTime,
        error: error.message,
      });

      throw error;
    }
  },
});

/**
 * Helper: Create opportunity in database
 */
async function createOpportunity(
  ctx: any,
  opportunity: any,
  userId: any
): Promise<string> {
  const oppId = await ctx.db.insert("opportunities", {
    opportunityId: opportunity.opportunityId,
    type: opportunity.type,
    trigger: {
      eventIds: opportunity.trigger.eventIds,
      whyNow: opportunity.trigger.whyNow,
      detectorName: opportunity.trigger.detectorName,
      detectorVersion: opportunity.trigger.detectorVersion,
      userId: userId,
    },
    evidencePointers: opportunity.evidencePointers,
    impactEstimate: opportunity.impactEstimate,
    riskLevel: opportunity.riskLevel,
    status: "detected",
    suggestedActions: opportunity.suggestedActions,
    metadata: opportunity.metadata,
    expiresAt: opportunity.expiresAt,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  console.log(`[DetectorExecutor] Created opportunity: ${opportunity.opportunityId}`);
  return opportunity.opportunityId;
}

/**
 * Check if a detector should run based on its cron schedule
 * Parses cron expression to determine if current time matches schedule
 */
function shouldDetectorRun(cronSchedule: string): boolean {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentMinute = now.getUTCMinutes();

  // Parse cron: "minute hour day month dayOfWeek"
  // We only check hour for simplicity (minute and others assumed to be *)
  const parts = cronSchedule.split(" ");
  if (parts.length < 5) return true; // If invalid cron, run it

  const minutePart = parts[0];
  const hourPart = parts[1];

  // Check minute (0 means top of hour)
  if (minutePart !== "*" && parseInt(minutePart) !== currentMinute) {
    return false;
  }

  // Check hour (e.g., "9,14" means 9 AM and 2 PM)
  if (hourPart === "*") return true; // Run every hour

  const allowedHours = hourPart.split(",").map((h) => parseInt(h.trim()));
  return allowedHours.includes(currentHour);
}

/**
 * Cron job: Run all batch detectors
 */
export const runBatchDetectors = internalMutation({
  args: {},
  handler: async (ctx) => {
    console.log("[DetectorExecutor] Running batch detectors");

    // Get all users with proactive consent
    const consents = await ctx.db
      .query("userConsents")
      .filter((q) =>
        q.and(
          q.eq(q.field("consentType"), "proactive_features"),
          q.eq(q.field("granted"), true)
        )
      )
      .collect();

    console.log(`[DetectorExecutor] Found ${consents.length} users with consent`);

    // Get all batch detectors
    const batchDetectors = detectorRegistry.getBatchDetectors();

    let totalRuns = 0;
    let totalOpportunities = 0;
    let skippedDueToSchedule = 0;

    for (const consent of consents) {
      // Check if user has settings
      const settings = await ctx.db
        .query("userProactiveSettings")
        .withIndex("by_user", (q) => q.eq("userId", consent.userId))
        .first();

      if (!settings || settings.enabledDetectors.length === 0) {
        continue;
      }

      // Run each enabled detector
      for (const detector of batchDetectors) {
        if (!settings.enabledDetectors.includes(detector.metadata.detectorId)) {
          continue;
        }

        // Check if detector should run based on its schedule
        const schedule = detector.metadata.schedule?.cron;
        if (schedule && !shouldDetectorRun(schedule)) {
          console.log(
            `[DetectorExecutor] Skipping ${detector.metadata.detectorId} - not scheduled to run at this hour`
          );
          skippedDueToSchedule++;
          continue;
        }

        try {
          // Define time window (last 24 hours for now)
          const endTime = Date.now();
          const startTime = endTime - 24 * 60 * 60 * 1000;

          const result = await executeBatchDetector(ctx, {
            detectorId: detector.metadata.detectorId,
            userId: consent.userId,
            startTime,
            endTime,
          });

          totalRuns++;
          totalOpportunities += result.opportunitiesCreated;
        } catch (error: any) {
          console.error(
            `[DetectorExecutor] Error running ${detector.metadata.detectorId} for user ${consent.userId}:`,
            error.message
          );
        }
      }
    }

    console.log(
      `[DetectorExecutor] Completed: ${totalRuns} runs, ${totalOpportunities} opportunities, ${skippedDueToSchedule} skipped due to schedule`
    );

    return {
      success: true,
      usersProcessed: consents.length,
      detectorsRun: totalRuns,
      opportunitiesCreated: totalOpportunities,
      skippedDueToSchedule,
      timestamp: Date.now(),
    };
  },
});
