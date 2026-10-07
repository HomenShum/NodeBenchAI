"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

function parseDateTimeToMs(input: string): number {
  const date = new Date(input);
  const ms = date.getTime();
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid datetime: "${input}"`);
  }
  return ms;
}

export const createEvent = createTool({
  description: `Create a calendar event (confirmed by default). Accepts start/end datetimes as ISO strings.`,
  args: z.object({
    title: z.string().min(1),
    startTime: z.string().describe("ISO datetime (e.g. 2026-01-03T10:00:00Z)"),
    endTime: z.string().optional().describe("ISO datetime (optional)"),
    allDay: z.boolean().optional(),
    location: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: z.enum(["confirmed", "tentative", "cancelled"]).optional(),
  }),
  handler: async (ctx, args): Promise<string> => {
    const startTime = parseDateTimeToMs(args.startTime);
    const endTime = args.endTime ? parseDateTimeToMs(args.endTime) : undefined;

    const eventId = await ctx.runMutation(api.domains.calendar.events.createEvent, {
      title: args.title,
      description: args.description,
      startTime,
      endTime,
      allDay: args.allDay,
      location: args.location,
      tags: args.tags,
      status: args.status,
    });

    return `Created event "${args.title}" (id: ${eventId}).`;
  },
});

export const updateEvent = createTool({
  description: `Update an existing calendar event.`,
  args: z.object({
    eventId: z.string().min(1).describe("Event ID"),
    title: z.string().optional(),
    startTime: z.string().optional().describe("ISO datetime"),
    endTime: z.string().optional().describe("ISO datetime"),
    allDay: z.boolean().optional(),
    location: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: z.enum(["confirmed", "tentative", "cancelled"]).optional(),
  }),
  handler: async (ctx, args): Promise<string> => {
    const startTime = args.startTime ? parseDateTimeToMs(args.startTime) : undefined;
    const endTime = args.endTime ? parseDateTimeToMs(args.endTime) : undefined;

    await ctx.runMutation(api.domains.calendar.events.updateEvent, {
      eventId: args.eventId,
      title: args.title,
      description: args.description,
      startTime,
      endTime,
      allDay: args.allDay,
      location: args.location,
      tags: args.tags,
      status: args.status,
    });

    return `Updated event ${args.eventId}.`;
  },
});

export const deleteEvent = createTool({
  description: `Delete (cancel) an event.`,
  args: z.object({
    eventId: z.string().min(1).describe("Event ID"),
  }),
  handler: async (ctx, args): Promise<string> => {
    await ctx.runMutation(api.domains.calendar.events.deleteEvent, {
      eventId: args.eventId,
    });
    return `Deleted event ${args.eventId}.`;
  },
});

export const listEventsInRange = createTool({
  description: `List events in a date range (ISO start/end).`,
  args: z.object({
    start: z.string().describe("ISO datetime start"),
    end: z.string().describe("ISO datetime end"),
    limit: z.number().min(1).max(200).default(50),
  }),
  handler: async (ctx, args): Promise<string> => {
    const startTime = parseDateTimeToMs(args.start);
    const endTime = parseDateTimeToMs(args.end);

    const events = await ctx.runQuery(api.domains.calendar.events.listEventsInRange, {
      startTime,
      endTime,
    });

    const limited = (events as any[]).slice(0, args.limit);
    if (!limited.length) return "No events found in range.";

    const lines = limited.map((ev: any, idx: number) => {
      const start = new Date(ev.startTime).toLocaleString();
      const end = ev.endTime ? new Date(ev.endTime).toLocaleString() : "";
      const when = end ? `${start} – ${end}` : start;
      const status = ev.status || "confirmed";
      return `${idx + 1}. ${ev.title} (${status}) — ${when} (id: ${ev._id})`;
    });

    return `Events:\n${lines.join("\n")}`;
  },
});

export const calendarCrudTools = {
  createEvent,
  updateEvent,
  deleteEvent,
  listEventsInRange,
};
