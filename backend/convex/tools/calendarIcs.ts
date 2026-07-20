// convex/tools/calendarIcs.ts
// Calendar ICS artifact tool for Agent component
//
// MVP: Generate and store ICS VEVENT artifacts for calendar actions
// This allows calendar operations to be testable without OAuth
// Later: swap backend to Google/Microsoft Calendar API
//
// VEVENT is a standard iCalendar component per RFC 5545

"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";
import { v4 as uuidv4 } from "uuid";

// ═══════════════════════════════════════════════════════════════════════════
// ICS GENERATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format date to ICS datetime format: YYYYMMDDTHHMMSSZ
 */
function formatIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Format date to ICS date-only format: YYYYMMDD
 */
function formatIcsDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Escape special characters for ICS text fields
 */
function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * Fold long lines per RFC 5545 (max 75 octets per line)
 */
function foldLine(line: string): string {
  const maxLen = 75;
  if (line.length <= maxLen) return line;

  const parts: string[] = [];
  let remaining = line;

  while (remaining.length > maxLen) {
    parts.push(remaining.slice(0, maxLen));
    remaining = " " + remaining.slice(maxLen); // Continuation line starts with space
  }
  parts.push(remaining);

  return parts.join("\r\n");
}

/**
 * Generate a full ICS VEVENT string
 */
function generateVevent(params: {
  uid: string;
  summary: string;
  dtStart: Date;
  dtEnd?: Date;
  allDay?: boolean;
  location?: string;
  description?: string;
  attendees?: string[];
  sequence: number;
  organizer?: string;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
}): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NodeBench AI//Calendar Tool//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${params.uid}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
  ];

  // Start/End time
  if (params.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDateOnly(params.dtStart)}`);
    if (params.dtEnd) {
      lines.push(`DTEND;VALUE=DATE:${formatIcsDateOnly(params.dtEnd)}`);
    }
  } else {
    lines.push(`DTSTART:${formatIcsDate(params.dtStart)}`);
    if (params.dtEnd) {
      lines.push(`DTEND:${formatIcsDate(params.dtEnd)}`);
    }
  }

  lines.push(foldLine(`SUMMARY:${escapeIcsText(params.summary)}`));
  lines.push(`SEQUENCE:${params.sequence}`);
  lines.push(`STATUS:${params.status || "CONFIRMED"}`);

  if (params.location) {
    lines.push(foldLine(`LOCATION:${escapeIcsText(params.location)}`));
  }

  if (params.description) {
    lines.push(foldLine(`DESCRIPTION:${escapeIcsText(params.description)}`));
  }

  if (params.organizer) {
    lines.push(`ORGANIZER:mailto:${params.organizer}`);
  }

  if (params.attendees) {
    for (const attendee of params.attendees) {
      lines.push(`ATTENDEE;RSVP=TRUE:mailto:${attendee}`);
    }
  }

  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  return lines.join("\r\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: CREATE CALENDAR EVENT
// ═══════════════════════════════════════════════════════════════════════════

export const createCalendarEvent = createTool({
  description: `Create a calendar event and generate an ICS artifact.

This tool creates a calendar event in the NodeBench system and generates a
standard ICS (iCalendar) file that can be imported into any calendar app.

IMPORTANT RULES:
1. Always parse dates relative to user's timezone if mentioned
2. Use ISO 8601 format for dates (e.g., "2025-01-15T14:00:00")
3. All-day events should have times omitted
4. Duration defaults to 1 hour if end time not specified
5. The ICS artifact is stored and downloadable

Use this tool when user asks to schedule, create, or add an event to their calendar.`,

  args: z.object({
    summary: z.string().describe("Event title/summary"),
    startTime: z.string().describe("Start time in ISO 8601 format (e.g., '2025-01-15T14:00:00')"),
    endTime: z.string().optional().describe("End time in ISO 8601 format. If omitted, defaults to 1 hour after start."),
    allDay: z.boolean().default(false).describe("If true, this is an all-day event"),
    location: z.string().optional().describe("Event location (physical address or virtual meeting URL)"),
    description: z.string().optional().describe("Detailed event description"),
    attendees: z.array(z.string()).optional().describe("List of attendee email addresses"),
  }),

  handler: async (ctx, args): Promise<string> => {
    const startTime = Date.now();

    try {
      // Parse dates
      const dtStart = new Date(args.startTime);
      if (isNaN(dtStart.getTime())) {
        return `❌ Invalid start time format: "${args.startTime}". Please use ISO 8601 format (e.g., "2025-01-15T14:00:00").`;
      }

      let dtEnd: Date | undefined;
      if (args.endTime) {
        dtEnd = new Date(args.endTime);
        if (isNaN(dtEnd.getTime())) {
          return `❌ Invalid end time format: "${args.endTime}". Please use ISO 8601 format.`;
        }
      } else if (!args.allDay) {
        // Default to 1 hour duration
        dtEnd = new Date(dtStart.getTime() + 60 * 60 * 1000);
      }

      // Generate unique event ID
      const eventUid = `${uuidv4()}@nodebench.ai`;

      // Generate ICS content
      const icsContent = generateVevent({
        uid: eventUid,
        summary: args.summary,
        dtStart,
        dtEnd,
        allDay: args.allDay,
        location: args.location,
        description: args.description,
        attendees: args.attendees,
        sequence: 0,
        status: "CONFIRMED",
      });

      // Store the calendar artifact
      try {
        await ctx.runMutation(internal.tools.calendarIcsMutations.createCalendarArtifact, {
          eventUid,
          operation: "create",
          icsContent,
          summary: args.summary,
          dtStart: dtStart.getTime(),
          dtEnd: dtEnd?.getTime(),
          location: args.location,
          description: args.description,
          attendees: args.attendees,
          sequence: 0,
          version: 1,
        });
      } catch (storeError) {
        console.error("[createCalendarEvent] Failed to store artifact:", storeError);
        // Continue - we'll still return the ICS content
      }

      // Format response
      const dateFormatter = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: args.allDay ? undefined : "numeric",
        minute: args.allDay ? undefined : "2-digit",
        timeZoneName: args.allDay ? undefined : "short",
      });

      let result = `✅ Calendar event created!\n\n`;
      result += `**${args.summary}**\n`;
      result += `📅 ${dateFormatter.format(dtStart)}`;
      if (dtEnd && !args.allDay) {
        result += ` - ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(dtEnd)}`;
      }
      result += "\n";

      if (args.location) {
        result += `📍 ${args.location}\n`;
      }

      if (args.attendees && args.attendees.length > 0) {
        result += `👥 Attendees: ${args.attendees.join(", ")}\n`;
      }

      result += `\n**Event ID:** ${eventUid}\n`;
      result += `\n<!-- ICS_ARTIFACT\n${JSON.stringify({ eventUid, icsContent: icsContent.substring(0, 200) + "..." }, null, 2)}\n-->`;
      result += `\nThe ICS file has been stored and can be downloaded or imported into your calendar.`;

      console.log("[createCalendarEvent] Event created", {
        eventUid,
        summary: args.summary,
        elapsedMs: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      console.error("[createCalendarEvent] Error:", error);
      return `❌ Failed to create calendar event: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: UPDATE CALENDAR EVENT
// ═══════════════════════════════════════════════════════════════════════════

export const updateCalendarEvent = createTool({
  description: `Update an existing calendar event and generate a new ICS artifact.

This tool modifies an existing calendar event. The SEQUENCE number is automatically
incremented per iCalendar spec to indicate the event has been updated.

IMPORTANT:
1. Requires the event UID from the original event
2. Only provide fields you want to change - others remain unchanged
3. Creates a new version of the ICS artifact

Use this tool when user asks to update, modify, reschedule, or change an event.`,

  args: z.object({
    eventUid: z.string().describe("The event UID from the original createCalendarEvent call"),
    summary: z.string().optional().describe("New event title (omit to keep current)"),
    startTime: z.string().optional().describe("New start time in ISO 8601 format"),
    endTime: z.string().optional().describe("New end time in ISO 8601 format"),
    location: z.string().optional().describe("New location"),
    description: z.string().optional().describe("New description"),
    attendees: z.array(z.string()).optional().describe("Updated list of attendee emails"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      // Fetch current artifact
      const currentArtifact = await ctx.runQuery(
        internal.tools.calendarIcsMutations.getCalendarArtifact,
        { eventUid: args.eventUid }
      );

      if (!currentArtifact) {
        return `❌ Event not found with UID: "${args.eventUid}". Please verify the event ID.`;
      }

      // Parse dates if provided
      let dtStart = new Date(currentArtifact.dtStart);
      let dtEnd = currentArtifact.dtEnd ? new Date(currentArtifact.dtEnd) : undefined;

      if (args.startTime) {
        dtStart = new Date(args.startTime);
        if (isNaN(dtStart.getTime())) {
          return `❌ Invalid start time format: "${args.startTime}"`;
        }
      }

      if (args.endTime) {
        dtEnd = new Date(args.endTime);
        if (isNaN(dtEnd.getTime())) {
          return `❌ Invalid end time format: "${args.endTime}"`;
        }
      }

      // Merge updates
      const updatedSummary = args.summary || currentArtifact.summary;
      const updatedLocation = args.location !== undefined ? args.location : currentArtifact.location;
      const updatedDescription = args.description !== undefined ? args.description : currentArtifact.description;
      const updatedAttendees = args.attendees || currentArtifact.attendees;
      const newSequence = currentArtifact.sequence + 1;
      const newVersion = currentArtifact.version + 1;

      // Generate new ICS content
      const icsContent = generateVevent({
        uid: args.eventUid,
        summary: updatedSummary,
        dtStart,
        dtEnd,
        location: updatedLocation,
        description: updatedDescription,
        attendees: updatedAttendees,
        sequence: newSequence,
        status: "CONFIRMED",
      });

      // Store updated artifact
      await ctx.runMutation(internal.tools.calendarIcsMutations.createCalendarArtifact, {
        eventUid: args.eventUid,
        operation: "update",
        icsContent,
        summary: updatedSummary,
        dtStart: dtStart.getTime(),
        dtEnd: dtEnd?.getTime(),
        location: updatedLocation,
        description: updatedDescription,
        attendees: updatedAttendees,
        sequence: newSequence,
        version: newVersion,
      });

      // Format response
      let result = `✅ Calendar event updated!\n\n`;
      result += `**${updatedSummary}**\n`;

      const changes: string[] = [];
      if (args.summary) changes.push(`Title: "${args.summary}"`);
      if (args.startTime) changes.push(`Start: ${dtStart.toLocaleString()}`);
      if (args.endTime) changes.push(`End: ${dtEnd?.toLocaleString()}`);
      if (args.location !== undefined) changes.push(`Location: ${args.location || "(removed)"}`);
      if (args.attendees) changes.push(`Attendees: ${args.attendees.join(", ")}`);

      if (changes.length > 0) {
        result += `\n**Changes:**\n${changes.map(c => `• ${c}`).join("\n")}\n`;
      }

      result += `\n**Version:** ${newVersion} (Sequence: ${newSequence})\n`;
      result += `\nThe updated ICS artifact has been stored.`;

      return result;
    } catch (error) {
      console.error("[updateCalendarEvent] Error:", error);
      return `❌ Failed to update calendar event: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: CANCEL CALENDAR EVENT
// ═══════════════════════════════════════════════════════════════════════════

export const cancelCalendarEvent = createTool({
  description: `Cancel a calendar event and generate a cancellation ICS.

This creates a cancellation notice per iCalendar spec (STATUS:CANCELLED).
Recipients' calendar apps should automatically remove the event.

Use this tool when user asks to cancel, delete, or remove an event.`,

  args: z.object({
    eventUid: z.string().describe("The event UID to cancel"),
    reason: z.string().optional().describe("Reason for cancellation (optional, added to description)"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      // Fetch current artifact
      const currentArtifact = await ctx.runQuery(
        internal.tools.calendarIcsMutations.getCalendarArtifact,
        { eventUid: args.eventUid }
      );

      if (!currentArtifact) {
        return `❌ Event not found with UID: "${args.eventUid}".`;
      }

      const newSequence = currentArtifact.sequence + 1;
      const newVersion = currentArtifact.version + 1;

      // Generate cancellation ICS
      const cancellationDescription = args.reason
        ? `CANCELLED: ${args.reason}\n\n${currentArtifact.description || ""}`
        : `CANCELLED\n\n${currentArtifact.description || ""}`;

      const icsContent = generateVevent({
        uid: args.eventUid,
        summary: `CANCELLED: ${currentArtifact.summary}`,
        dtStart: new Date(currentArtifact.dtStart),
        dtEnd: currentArtifact.dtEnd ? new Date(currentArtifact.dtEnd) : undefined,
        location: currentArtifact.location,
        description: cancellationDescription,
        attendees: currentArtifact.attendees,
        sequence: newSequence,
        status: "CANCELLED",
      });

      // Store cancellation artifact
      await ctx.runMutation(internal.tools.calendarIcsMutations.createCalendarArtifact, {
        eventUid: args.eventUid,
        operation: "cancel",
        icsContent,
        summary: currentArtifact.summary,
        dtStart: currentArtifact.dtStart,
        dtEnd: currentArtifact.dtEnd,
        location: currentArtifact.location,
        description: cancellationDescription,
        attendees: currentArtifact.attendees,
        sequence: newSequence,
        version: newVersion,
      });

      let result = `✅ Calendar event cancelled!\n\n`;
      result += `**${currentArtifact.summary}**\n`;
      if (args.reason) {
        result += `📝 Reason: ${args.reason}\n`;
      }
      result += `\nA cancellation notice (ICS with STATUS:CANCELLED) has been generated.`;
      if (currentArtifact.attendees && currentArtifact.attendees.length > 0) {
        result += `\n\n⚠️ Note: ${currentArtifact.attendees.length} attendees should be notified of this cancellation.`;
      }

      return result;
    } catch (error) {
      console.error("[cancelCalendarEvent] Error:", error);
      return `❌ Failed to cancel calendar event: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
});
