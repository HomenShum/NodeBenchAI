/**
 * Calendar Tools for Data Access Agent
 */

import { api } from "../../../../_generated/api";
import type { ActionCtx } from "../../../../_generated/server";
import { listEventsSchema, createEventSchema, type ListEventsInput, type CreateEventInput } from "../config";

/**
 * Calculate date range based on timeRange parameter
 */
function calculateDateRange(timeRange: string): { start: number; end: number } {
  const now = Date.now();
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const dayStart = d.getTime();

  switch (timeRange) {
    case "today":
      return { start: dayStart, end: dayStart + 24 * 60 * 60 * 1000 - 1 };
    case "tomorrow":
      return { 
        start: dayStart + 24 * 60 * 60 * 1000, 
        end: dayStart + 48 * 60 * 60 * 1000 - 1 
      };
    case "week":
      return { start: dayStart, end: dayStart + 7 * 24 * 60 * 60 * 1000 - 1 };
    case "month":
      return { start: dayStart, end: dayStart + 30 * 24 * 60 * 60 * 1000 - 1 };
    default:
      return { start: dayStart, end: dayStart + 24 * 60 * 60 * 1000 - 1 };
  }
}

/**
 * List calendar events tool execution
 */
export async function executeListEvents(
  ctx: ActionCtx,
  args: ListEventsInput
): Promise<{
  success: boolean;
  message: string;
  events: Array<{
    index: number;
    title: string;
    startTime: string;
    endTime: string | null;
    location: string | null;
    description: string | null;
    status: string;
  }>;
}> {
  console.log(`[calendarTools.listEvents] Querying events for: ${args.timeRange}`);
  
  const { start, end } = calculateDateRange(args.timeRange);

  // Query the unified calendar agenda
  const agenda = await ctx.runQuery(api.domains.calendar.calendar.listAgendaInRange, {
    start,
    end,
    country: "US",
  });

  const events = agenda.events || [];
  
  if (events.length === 0) {
    return { 
      success: true, 
      message: `No events found for ${args.timeRange}.`,
      events: []
    };
  }

  // Format events for display
  const formattedEvents = events.map((event: any, idx: number) => ({
    index: idx + 1,
    title: event.title,
    startTime: new Date(event.startTime).toLocaleString(),
    endTime: event.endTime ? new Date(event.endTime).toLocaleString() : null,
    location: event.location || null,
    description: event.description ? event.description.substring(0, 100) : null,
    status: event.status || "confirmed",
  }));

  console.log(`[calendarTools.listEvents] Found ${events.length} events`);
  return {
    success: true,
    message: `Found ${events.length} event(s) for ${args.timeRange}.`,
    events: formattedEvents,
  };
}

/**
 * Create calendar event tool execution
 */
export async function executeCreateEvent(
  ctx: ActionCtx,
  args: CreateEventInput
): Promise<{
  success: boolean;
  message: string;
  eventId?: string;
}> {
  console.log(`[calendarTools.createEvent] Creating event: ${args.title}`);
  
  try {
    const eventId = await ctx.runMutation(api.domains.calendar.events.createEvent, {
      title: args.title,
      startTime: new Date(args.startTime).getTime(),
      endTime: args.endTime ? new Date(args.endTime).getTime() : undefined,
      location: args.location,
      description: args.description,
    });

    return {
      success: true,
      message: `Event "${args.title}" created successfully.`,
      eventId: eventId as string,
    };
  } catch (error: any) {
    console.error(`[calendarTools.createEvent] Error:`, error);
    return {
      success: false,
      message: `Failed to create event: ${error.message}`,
    };
  }
}

// Tool definitions for AI SDK
export const calendarToolDefinitions = {
  listEvents: {
    description: "List calendar events for a specified time range. Use this when the user asks about their calendar, schedule, or events.",
    inputSchema: listEventsSchema,
    execute: executeListEvents,
  },
  createEvent: {
    description: "Create a new calendar event. Use this when the user wants to add an event to their calendar.",
    inputSchema: createEventSchema,
    execute: executeCreateEvent,
  },
};
