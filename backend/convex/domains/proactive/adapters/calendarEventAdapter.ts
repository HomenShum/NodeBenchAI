/**
 * Calendar Event Adapter
 * Converts Google Calendar events to unified proactive events
 *
 * Features:
 * - Ingests calendar_event_created, calendar_event_updated, meeting_started, meeting_ended events
 * - Extracts attendees as entities
 * - Links to event details
 * - Deduplicates via content hash
 * - Identifies upcoming meetings for prep
 */

import { internalMutation } from "../../../_generated/server";
import { v } from "convex/values";
import { Id } from "../../../_generated/dataModel";

/**
 * Create proactive event from calendar event
 */
export const createCalendarEvent = internalMutation({
  args: {
    // Calendar event metadata
    calendarEventId: v.id("events"), // Reference to events table
    externalId: v.string(), // Google Calendar event ID
    userId: v.id("users"),
    eventType: v.union(
      v.literal("calendar_event_created"),
      v.literal("calendar_event_updated"),
      v.literal("meeting_started"),
      v.literal("meeting_ended")
    ),

    // Event metadata
    timestamp: v.number(), // When the calendar event starts/started
    title: v.string(),
    description: v.optional(v.string()),
    location: v.optional(v.string()),

    // Attendees
    attendees: v.optional(
      v.array(
        v.object({
          email: v.string(),
          name: v.optional(v.string()),
          status: v.optional(v.string()), // "accepted", "tentative", "declined"
        })
      )
    ),

    // Timing
    startTime: v.number(),
    endTime: v.optional(v.number()),
    duration: v.optional(v.number()), // Minutes

    // Meeting link (if available)
    meetingLink: v.optional(v.string()),

    // Source artifact
    sourceArtifactId: v.optional(v.id("sourceArtifacts")),
  },
  handler: async (ctx, args) => {
    // Generate event ID and content hash
    const eventId = `calendar_${args.externalId}_${args.eventType}_${args.timestamp}`;
    const contentHash = await generateCalendarContentHash({
      title: args.title,
      startTime: args.startTime,
      externalId: args.externalId,
    });

    // Check for duplicate
    const existing = await ctx.db
      .query("proactiveEvents")
      .withIndex("by_contentHash", (q) => q.eq("contentHash", contentHash))
      .first();

    if (existing) {
      console.log(`[calendarEventAdapter] Skipping duplicate event: ${eventId}`);
      return { eventId: existing.eventId, skipped: true };
    }

    // Extract entities (attendees as people)
    const entities: Array<{
      entityId: string;
      entityType: string;
      entityName: string;
      confidence: number;
      mentionContext?: string;
    }> = [];

    if (args.attendees) {
      for (const attendee of args.attendees) {
        entities.push({
          entityId: `person_${attendee.email}`,
          entityType: "person",
          entityName: attendee.name || attendee.email,
          confidence: 1.0,
          mentionContext: `Meeting attendee (${attendee.status || "unknown"})`,
        });
      }
    }

    // Determine sensitivity (meetings are generally not sensitive unless keywords present)
    const { hasPII, hasFinancial, hasConfidential } = classifyMeetingSensitivity(
      args.title,
      args.description
    );

    // Standard retention for calendar events
    const retentionClass = hasConfidential ? "extended" : "standard";
    const retentionDays = retentionClass === "extended" ? 365 : 90;
    const expiresAt = args.timestamp + retentionDays * 24 * 60 * 60 * 1000;

    // Build summary
    const attendeeCount = args.attendees?.length || 0;
    const summary = `${args.title}${attendeeCount > 0 ? ` (${attendeeCount} attendees)` : ""}${
      args.location ? ` at ${args.location}` : ""
    }`;

    // Create proactive event
    const proactiveEventId = await ctx.db.insert("proactiveEvents", {
      eventId,
      timestamp: args.timestamp,
      eventType: args.eventType,
      source: "calendar",
      sourceId: args.externalId,
      sourceUrl: `https://calendar.google.com/calendar/event?eid=${args.externalId}`,

      contentPointer: args.sourceArtifactId,
      contentHash,
      summary,

      entities,

      sensitivity: {
        hasPII: hasPII ?? false,
        hasFinancial: hasFinancial ?? false,
        hasConfidential: hasConfidential ?? false,
        retentionClass,
      },

      processingStatus: "pending",
      extractionConfidence: 1.0, // Calendar events are well-structured
      sourceQuality: "high", // Google Calendar is a verified source

      metadata: {
        startTime: args.startTime,
        endTime: args.endTime,
        duration: args.duration,
        location: args.location,
        meetingLink: args.meetingLink,
        attendeeCount,
      },

      expiresAt,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    console.log(`[calendarEventAdapter] Created proactive event: ${eventId}`);

    return {
      eventId,
      proactiveEventId,
      skipped: false,
    };
  },
});

/**
 * Bulk ingest calendar events (for batch processing)
 */
export const batchIngestCalendarEvents = internalMutation({
  args: {
    userId: v.id("users"),
    since: v.optional(v.number()), // Timestamp to start from
    limit: v.optional(v.number()), // Max events to process
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    const since = args.since ?? Date.now(); // Default: upcoming events only
    const until = Date.now() + 30 * 24 * 60 * 60 * 1000; // Next 30 days

    // Fetch calendar events
    const calendarEvents = await ctx.db
      .query("events")
      .withIndex("by_user_start", (q) =>
        q.eq("userId", args.userId).gte("startTime", since)
      )
      .filter((q) => q.lte(q.field("startTime"), until))
      .take(limit);

    console.log(
      `[calendarEventAdapter] Batch ingesting ${calendarEvents.length} calendar events for user ${args.userId}`
    );

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const event of calendarEvents) {
      try {
        // Skip cancelled events
        if (event.status === "cancelled") {
          skipped++;
          continue;
        }

        // Find or create source artifact
        const sourceArtifactId = await findOrCreateCalendarArtifact(ctx, event);

        // Extract attendees (simplified - in production, parse from event metadata)
        const attendees = extractAttendeesFromEvent(event);

        // Calculate duration
        const duration = event.endTime
          ? Math.floor((event.endTime - event.startTime) / (60 * 1000))
          : undefined;

        // Create proactive event
        const result = await createCalendarEvent(ctx, {
          calendarEventId: event._id,
          externalId: event.sourceId || event._id,
          userId: args.userId,
          eventType: "calendar_event_created",
          timestamp: event.startTime,
          title: event.title,
          description: event.description,
          location: event.location,
          attendees,
          startTime: event.startTime,
          endTime: event.endTime,
          duration,
          sourceArtifactId,
        });

        if (result.skipped) {
          skipped++;
        } else {
          created++;
        }
      } catch (error: any) {
        console.error(
          `[calendarEventAdapter] Error processing event ${event._id}:`,
          error.message
        );
        errors++;
      }
    }

    return {
      success: true,
      processed: calendarEvents.length,
      created,
      skipped,
      errors,
    };
  },
});

// Helper functions

function classifyMeetingSensitivity(title: string, description?: string): {
  hasPII: boolean;
  hasFinancial: boolean;
  hasConfidential: boolean;
} {
  const content = `${title} ${description || ""}`.toLowerCase();

  const hasPII = false; // Meetings rarely contain PII in title
  const hasFinancial =
    content.includes("investor") ||
    content.includes("funding") ||
    content.includes("financial") ||
    content.includes("board meeting");
  const hasConfidential =
    content.includes("confidential") ||
    content.includes("private") ||
    content.includes("executive") ||
    content.includes("legal");

  return { hasPII, hasFinancial, hasConfidential };
}

function extractAttendeesFromEvent(event: any): Array<{
  email: string;
  name?: string;
  status?: string;
}> {
  // TODO: Parse attendees from event.meta or event metadata
  // For now, return empty array
  return [];
}

async function findOrCreateCalendarArtifact(
  ctx: any,
  event: any
): Promise<Id<"sourceArtifacts"> | undefined> {
  const externalId = event.sourceId || event._id;

  // Check if artifact already exists
  const existing = await ctx.db
    .query("sourceArtifacts")
    .filter((q) =>
      q.and(
        q.eq(q.field("source"), "gcal"),
        q.eq(q.field("externalId"), externalId)
      )
    )
    .first();

  if (existing) {
    return existing._id;
  }

  // Create new artifact
  try {
    const artifactId = await ctx.db.insert("sourceArtifacts", {
      userId: event.userId,
      source: "gcal",
      sourceType: "calendar_event",
      externalId,
      url: `https://calendar.google.com/calendar/event?eid=${externalId}`,
      title: event.title,
      content: event.description || "",
      metadata: {
        startTime: event.startTime,
        endTime: event.endTime,
        location: event.location,
        status: event.status,
      },
      createdAt: event.createdAt,
      lastSyncedAt: Date.now(),
    });

    return artifactId;
  } catch (error) {
    console.error("[calendarEventAdapter] Error creating source artifact:", error);
    return undefined;
  }
}

async function generateCalendarContentHash(data: {
  title: string;
  startTime: number;
  externalId: string;
}): Promise<string> {
  // Simple hash function
  const content = `${data.title}${data.startTime}${data.externalId}`;
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `calendar_${Math.abs(hash).toString(36)}`;
}
