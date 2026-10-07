import { v } from "convex/values";
import { mutation, query, internalQuery } from "../../../_generated/server";
import type { Id, Doc } from "../../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

async function getSafeUserId(ctx: any): Promise<Id<"users">> {
  // Support evaluation mode where userId is passed in ctx.evaluationUserId
  if ((ctx).evaluationUserId) {
    return (ctx).evaluationUserId as Id<"users">;
  }

  const rawUserId = await getAuthUserId(ctx);
  if (!rawUserId) throw new Error("Not authenticated");
  let userId: Id<"users">;
  if (typeof rawUserId === "string" && rawUserId.includes("|")) {
    const first = rawUserId.split("|")[0];
    if (!first || first.length < 10) throw new Error("Invalid user ID format. Please sign out and in.");
    userId = first;
  } else {
    userId = rawUserId;
  }
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("User not found. Please sign out and sign back in.");
  return userId;
}

// Returns null instead of throwing when unauthenticated / user missing
async function getOptionalUserId(ctx: any): Promise<Id<"users"> | null> {
  const rawUserId = await getAuthUserId(ctx);
  if (!rawUserId) return null;
  let userId: Id<"users"> | null = null;
  if (typeof rawUserId === "string" && rawUserId.includes("|")) {
    const first = rawUserId.split("|")[0];
    if (!first || first.length < 10) return null;
    userId = first;
  } else {
    userId = rawUserId;
  }
  const user = userId ? await ctx.db.get(userId) : null;
  if (!user) return null;
  return userId;
}

export const createEvent = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    descriptionJson: v.optional(v.string()),
    startTime: v.number(),
    endTime: v.optional(v.number()),
    allDay: v.optional(v.boolean()),
    location: v.optional(v.string()),
    status: v.optional(v.union(
      v.literal("confirmed"),
      v.literal("tentative"),
      v.literal("cancelled"),
    )),
    color: v.optional(v.string()),
    documentId: v.optional(v.id("documents")),
    tags: v.optional(v.array(v.string())),
    recurrence: v.optional(v.string()),
    sourceType: v.optional(v.union(v.literal("gmail"), v.literal("gcal"), v.literal("doc"))),
    sourceId: v.optional(v.string()),
    ingestionConfidence: v.optional(v.union(v.literal("low"), v.literal("med"), v.literal("high"))),
    proposed: v.optional(v.boolean()),
    rawSummary: v.optional(v.string()),
    meta: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (args.endTime !== undefined && args.endTime < args.startTime) {
      throw new Error("endTime cannot be earlier than startTime");
    }
    const now = Date.now();
    const id = await ctx.db.insert("events", {
      userId,
      title: args.title,
      description: args.description,
      descriptionJson: args.descriptionJson,
      startTime: args.startTime,
      endTime: args.endTime,
      allDay: args.allDay,
      location: args.location,
      status: args.status ?? "confirmed",
      color: args.color,
      documentId: args.documentId,
      tags: args.tags,
      recurrence: args.recurrence,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      ingestionConfidence: args.ingestionConfidence,
      proposed: args.proposed,
      rawSummary: args.rawSummary,
      meta: args.meta,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },
});

// Tiny resolvers for event titles (for references UI)
export const getTitle = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const userId = await getOptionalUserId(ctx);
    if (!userId) return null;
    const ev = await ctx.db.get(args.eventId) as Doc<"events"> | null;
    if (!ev || ev.userId !== userId) return null;
    return { title: ev.title } as { title: string };
  },
});

export const getTitles = query({
  args: { ids: v.array(v.id("events")) },
  handler: async (ctx, args) => {
    const userId = await getOptionalUserId(ctx);
    if (!userId) return [] as Array<{ _id: Id<"events">; title: string }>;
    const out: Array<{ _id: Id<"events">; title: string }> = [];
    for (const id of args.ids) {
      const ev = await ctx.db.get(id) as Doc<"events"> | null;
      if (ev && ev.userId === userId) {
        out.push({ _id: id, title: ev.title });
      }
    }
    return out;
  },
});

export const updateEvent = mutation({
  args: {
    eventId: v.id("events"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    descriptionJson: v.optional(v.string()),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    allDay: v.optional(v.boolean()),
    location: v.optional(v.string()),
    status: v.optional(v.union(
      v.literal("confirmed"),
      v.literal("tentative"),
      v.literal("cancelled"),
    )),
    color: v.optional(v.string()),
    documentId: v.optional(v.id("documents")),
    tags: v.optional(v.array(v.string())),
    recurrence: v.optional(v.string()),
    sourceType: v.optional(v.union(v.literal("gmail"), v.literal("gcal"), v.literal("doc"))),
    sourceId: v.optional(v.string()),
    ingestionConfidence: v.optional(v.union(v.literal("low"), v.literal("med"), v.literal("high"))),
    proposed: v.optional(v.boolean()),
    rawSummary: v.optional(v.string()),
    meta: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    const existing = await ctx.db.get(args.eventId) as Doc<"events"> | null;
    if (!existing) throw new Error("Event not found");
    if (existing.userId !== userId) throw new Error("Not authorized");

    const start = args.startTime ?? existing.startTime;
    const end = args.endTime ?? existing.endTime;
    if (end !== undefined && start !== undefined && end < start) {
      throw new Error("endTime cannot be earlier than startTime");
    }

    const updates: any = { updatedAt: Date.now() };
    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;
    if (args.descriptionJson !== undefined) updates.descriptionJson = args.descriptionJson;
    if (args.startTime !== undefined) updates.startTime = args.startTime;
    if (args.endTime !== undefined) updates.endTime = args.endTime;
    if (args.allDay !== undefined) updates.allDay = args.allDay;
    if (args.location !== undefined) updates.location = args.location;
    if (args.status !== undefined) updates.status = args.status;
    if (args.color !== undefined) updates.color = args.color;
    if (args.documentId !== undefined) updates.documentId = args.documentId;
    if (args.tags !== undefined) updates.tags = args.tags;
    if (args.recurrence !== undefined) updates.recurrence = args.recurrence;
    if (args.sourceType !== undefined) updates.sourceType = args.sourceType;
    if (args.sourceId !== undefined) updates.sourceId = args.sourceId;
    if (args.ingestionConfidence !== undefined) updates.ingestionConfidence = args.ingestionConfidence;
    if (args.proposed !== undefined) updates.proposed = args.proposed;
    if (args.rawSummary !== undefined) updates.rawSummary = args.rawSummary;
    if (args.meta !== undefined) updates.meta = args.meta;

    await ctx.db.patch(args.eventId, updates);
    return { success: true };
  },
});

export const deleteEvent = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    const existing = await ctx.db.get(args.eventId) as Doc<"events"> | null;
    if (!existing) return { success: true };
    if (existing.userId !== userId) throw new Error("Not authorized");
    await ctx.db.delete(args.eventId);
    return { success: true };
  },
});

export const getEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const userId = await getOptionalUserId(ctx);
    if (!userId) return null;
    const ev = await ctx.db.get(args.eventId) as Doc<"events"> | null;
    if (!ev || ev.userId !== userId) return null;
    return ev;
  },
});

function overlaps(startA: number, endA: number | undefined, startB: number, endB: number): boolean {
  const aEnd = endA ?? startA;
  return startA <= endB && aEnd >= startB;
}

export const listEventsInRange = query({
  args: {
    start: v.number(),
    end: v.number(),
    userId: v.optional(v.id("users")), // Optional for evaluation/testing
  },
  handler: async (ctx, args) => {
    // Use provided userId or fall back to authenticated user
    const userId = args.userId || await getOptionalUserId(ctx);
    if (!userId) return [];
    // Primary: events starting within range
    const inRange = await ctx.db
      .query("events")
      .withIndex("by_user_start", (q: any) =>
        q.eq("userId", userId).gte("startTime", args.start).lte("startTime", args.end)
      )
      .order("asc")
      .collect();

    // Secondary: events that start before range but overlap into it (limited scan)
    const before = await ctx.db
      .query("events")
      .withIndex("by_user_start", (q: any) => q.eq("userId", userId).lt("startTime", args.start))
      .order("desc")
      .take(200);

    const overlapping = before.filter((e: any) => overlaps(e.startTime, e.endTime, args.start, args.end));

    const map = new Map<string, any>();
    for (const e of [...inRange, ...overlapping]) map.set(e._id, e);
    return Array.from(map.values()).sort((a, b) => a.startTime - b.startTime);
  },
});

export const listEventsByStatus = query({
  args: { status: v.union(
    v.literal("confirmed"),
    v.literal("tentative"),
    v.literal("cancelled"),
  ) },
  handler: async (ctx, args) => {
    const userId = await getOptionalUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("events")
      .withIndex("by_user_status", (q: any) => q.eq("userId", userId).eq("status", args.status))
      .order("asc")
      .collect();
  },
});

// Removed listEventsForDay and listEventsForWeek - use listAgendaInRange via useCalendarAgenda hook instead

// ────────────────────────────────────────────────────────────────────────────
// Email Calendar Integration - MVP Queries & Mutations
// ────────────────────────────────────────────────────────────────────────────

/**
 * Find event by source (gmail/gcal) and sourceId
 * Used for deduplication during email ingestion
 */
export const findBySourceId = query({
  args: {
    sourceType: v.union(v.literal("gmail"), v.literal("gcal"), v.literal("doc")),
    sourceId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getOptionalUserId(ctx);
    if (!userId) return null;
    return await ctx.db
      .query("events")
      .withIndex("by_user_source", (q: any) =>
        q.eq("userId", userId).eq("sourceType", args.sourceType).eq("sourceId", args.sourceId)
      )
      .first();
  },
});

/**
 * List email-sourced events for a date range
 * Used by mini calendar to show email event indicators
 */
export const listEmailEventsInRange = query({
  args: {
    start: v.number(),
    end: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getOptionalUserId(ctx);
    if (!userId) return [];

    const events = await ctx.db
      .query("events")
      .withIndex("by_user_start", (q: any) =>
        q.eq("userId", userId).gte("startTime", args.start).lte("startTime", args.end)
      )
      .filter((q: any) => q.eq(q.field("sourceType"), "gmail"))
      .collect();

    return events.map((e: any) => ({
      _id: e._id,
      title: e.title,
      startTime: e.startTime,
      endTime: e.endTime,
      allDay: e.allDay,
      location: e.location,
      status: e.status,
      proposed: e.proposed ?? false,
      ingestionConfidence: e.ingestionConfidence,
      sourceId: e.sourceId,
      rawSummary: e.rawSummary,
    }));
  },
});

/**
 * List proposed events from email that need user confirmation
 */
export const listProposedFromEmail = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getOptionalUserId(ctx);
    if (!userId) return [];

    const events = await ctx.db
      .query("events")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .filter((q: any) =>
        q.and(
          q.eq(q.field("sourceType"), "gmail"),
          q.eq(q.field("proposed"), true)
        )
      )
      .order("asc")
      .take(50);

    return events.map((e: any) => ({
      _id: e._id,
      title: e.title,
      startTime: e.startTime,
      endTime: e.endTime,
      allDay: e.allDay,
      location: e.location,
      status: e.status,
      sourceId: e.sourceId,
      rawSummary: e.rawSummary,
      ingestionConfidence: e.ingestionConfidence,
      meta: e.meta,
    }));
  },
});

/**
 * Confirm a proposed event - changes proposed to false, status to confirmed
 */
export const confirmProposed = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    const event = await ctx.db.get(args.eventId) as Doc<"events"> | null;
    if (!event) throw new Error("Event not found");
    if (event.userId !== userId) throw new Error("Not authorized");

    await ctx.db.patch(args.eventId, {
      proposed: false,
      status: "confirmed",
      ingestionConfidence: "high",
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Dismiss a proposed event - deletes it entirely
 */
export const dismissProposed = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    const event = await ctx.db.get(args.eventId) as Doc<"events"> | null;
    if (!event) return { success: true }; // Already deleted
    if (event.userId !== userId) throw new Error("Not authorized");

    await ctx.db.delete(args.eventId);
    return { success: true };
  },
});

/**
 * Link a document to an event
 */
export const linkDocument = mutation({
  args: {
    eventId: v.id("events"),
    documentId: v.id("documents"),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    const event = await ctx.db.get(args.eventId) as Doc<"events"> | null;
    if (!event) throw new Error("Event not found");
    if (event.userId !== userId) throw new Error("Not authorized");

    await ctx.db.patch(args.eventId, {
      documentId: args.documentId,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Get today's email events - for agent "what's on my calendar today" queries
 */
export const listTodaysEmailEvents = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getOptionalUserId(ctx);
    if (!userId) return [];

    // Get start and end of today in user's local timezone approximation
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000 - 1;

    const events = await ctx.db
      .query("events")
      .withIndex("by_user_start", (q: any) =>
        q.eq("userId", userId).gte("startTime", startOfDay).lte("startTime", endOfDay)
      )
      .filter((q: any) => q.eq(q.field("sourceType"), "gmail"))
      .order("asc")
      .collect();

    return events.map((e: any) => ({
      _id: e._id,
      title: e.title,
      startTime: e.startTime,
      endTime: e.endTime,
      allDay: e.allDay,
      location: e.location,
      status: e.status,
      proposed: e.proposed ?? false,
      ingestionConfidence: e.ingestionConfidence,
      sourceId: e.sourceId,
      rawSummary: e.rawSummary,
      meta: e.meta,
    }));
  },
});

/**
 * Create event from email intelligence
 * Wrapper around createEvent with email-specific defaults
 */
export const createFromEmail = mutation({
  args: {
    title: v.string(),
    startTime: v.number(),
    endTime: v.optional(v.number()),
    allDay: v.optional(v.boolean()),
    location: v.optional(v.string()),
    description: v.optional(v.string()),
    sourceId: v.string(), // Gmail messageId
    confidence: v.number(), // 0-1 extraction confidence
    rawSummary: v.optional(v.string()),
    meta: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);

    // Check for existing event with same sourceId to avoid duplicates
    const existing = await ctx.db
      .query("events")
      .withIndex("by_user_source", (q: any) =>
        q.eq("userId", userId).eq("sourceType", "gmail").eq("sourceId", args.sourceId)
      )
      .first() as Doc<"events"> | null;

    if (existing) {
      // Update existing event
      await ctx.db.patch(existing._id, {
        title: args.title,
        startTime: args.startTime,
        endTime: args.endTime,
        allDay: args.allDay,
        location: args.location,
        description: args.description,
        rawSummary: args.rawSummary,
        meta: args.meta,
        updatedAt: Date.now(),
      });
      return { eventId: existing._id, created: false };
    }

    // Determine proposed status based on confidence
    // High confidence (>=0.8) from ICS = auto-confirm
    // Lower confidence = propose for user review
    const isHighConfidence = args.confidence >= 0.8;

    const now = Date.now();
    const eventId = await ctx.db.insert("events", {
      userId,
      title: args.title,
      description: args.description,
      startTime: args.startTime,
      endTime: args.endTime,
      allDay: args.allDay ?? false,
      location: args.location,
      status: isHighConfidence ? "confirmed" : "tentative",
      sourceType: "gmail",
      sourceId: args.sourceId,
      ingestionConfidence: args.confidence >= 0.8 ? "high" : args.confidence >= 0.5 ? "med" : "low",
      proposed: !isHighConfidence,
      rawSummary: args.rawSummary,
      meta: args.meta,
      createdAt: now,
      updatedAt: now,
    });

    return { eventId, created: true };
  },
});

// ────────────────────────────────────────────────────────────────────────────
// Internal Queries for Cron Jobs / Workflows
// ────────────────────────────────────────────────────────────────────────────

/**
 * Get today's events for a specific user (internal use for morning digest)
 * Returns events for the current UTC day
 */
export const getTodaysEventsForUser = internalQuery({
  args: {
    userId: v.id("users"),
    timezoneOffsetMinutes: v.optional(v.number()), // User's timezone offset (defaults to 0/UTC)
  },
  handler: async (ctx, args) => {
    const offsetMs = (args.timezoneOffsetMinutes ?? 0) * 60 * 1000;

    // Calculate today's start and end in user's timezone
    const now = Date.now();
    const userLocalNow = new Date(now + offsetMs);
    userLocalNow.setUTCHours(0, 0, 0, 0);
    const todayStartUtc = userLocalNow.getTime() - offsetMs;
    const todayEndUtc = todayStartUtc + 24 * 60 * 60 * 1000 - 1;

    // Query events for this user in today's range
    const events = await ctx.db
      .query("events")
      .withIndex("by_user_start", (q: any) =>
        q.eq("userId", args.userId).gte("startTime", todayStartUtc).lte("startTime", todayEndUtc)
      )
      .order("asc")
      .collect();

    // Filter out cancelled events
    return events.filter((e: any) => e.status !== "cancelled");
  },
});

/**
 * Get all users with events today (for batch morning digest sending)
 *
 * Note: This scans all users and their events. For production scale,
 * consider adding a by_startTime index or using a scheduled approach.
 */
export const getUsersWithEventsToday = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Use UTC day boundaries
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);
    const todayStartMs = todayStart.getTime();
    const todayEndMs = todayEnd.getTime();

    // Get all users first
    const users = await ctx.db.query("users").collect();

    const result: Array<{
      userId: Id<"users">;
      email: string | undefined;
      name: string | undefined;
      events: any[];
    }> = [];

    // For each user, check if they have events today
    for (const user of users) {
      if (!user.email) continue; // Skip users without email

      // Query events for this user in today's range using the existing index
      const userEvents = await ctx.db
        .query("events")
        .withIndex("by_user_start", (q: any) =>
          q.eq("userId", user._id).gte("startTime", todayStartMs).lte("startTime", todayEndMs)
        )
        .collect();

      // Filter out cancelled events
      const activeEvents = userEvents.filter((e: any) => e.status !== "cancelled");

      if (activeEvents.length > 0) {
        result.push({
          userId: user._id,
          email: user.email,
          name: user.name,
          events: activeEvents.sort((a, b) => a.startTime - b.startTime),
        });
      }
    }

    return result;
  },
});
