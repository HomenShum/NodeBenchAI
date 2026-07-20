import { v } from "convex/values";
import { mutation, query } from "../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Get time of day category
 */
function getTimeOfDay(): "morning" | "afternoon" | "evening" | "night" {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

/**
 * Get day of week
 */
function getDayOfWeek(): string {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return days[new Date().getDay()];
}

/**
 * Track a user behavior event
 */
export const trackEvent = mutation({
  args: {
    eventType: v.union(
      v.literal("document_created"),
      v.literal("document_viewed"),
      v.literal("document_edited"),
      v.literal("task_completed"),
      v.literal("task_created"),
      v.literal("agent_interaction"),
      v.literal("search_performed"),
      v.literal("calendar_event_ended"),
      v.literal("quick_capture")
    ),
    entityId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const eventId = await ctx.db.insert("userBehaviorEvents", {
      userId,
      eventType: args.eventType,
      entityId: args.entityId,
      metadata: args.metadata,
      timestamp: Date.now(),
      timeOfDay: getTimeOfDay(),
      dayOfWeek: getDayOfWeek(),
    });

    return eventId;
  },
});

/**
 * Get recent behavior events for pattern analysis
 */
export const getRecentEvents = query({
  args: {
    days: v.optional(v.number()),
    eventType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const daysAgo = args.days ?? 30;
    const cutoff = Date.now() - daysAgo * 24 * 60 * 60 * 1000;

    let events = await ctx.db
      .query("userBehaviorEvents")
      .withIndex("by_user_time", (q) => q.eq("userId", userId).gte("timestamp", cutoff))
      .order("desc")
      .take(500);

    if (args.eventType) {
      events = events.filter((e) => e.eventType === args.eventType);
    }

    return events;
  },
});

/**
 * Get behavior summary for the current user
 */
export const getBehaviorSummary = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const events = await ctx.db
      .query("userBehaviorEvents")
      .withIndex("by_user_time", (q) => q.eq("userId", userId).gte("timestamp", weekAgo))
      .collect();

    // Count by event type
    const counts: Record<string, number> = {};
    const byTimeOfDay: Record<string, number> = {};
    const byDayOfWeek: Record<string, number> = {};

    for (const event of events) {
      counts[event.eventType] = (counts[event.eventType] || 0) + 1;
      byTimeOfDay[event.timeOfDay] = (byTimeOfDay[event.timeOfDay] || 0) + 1;
      byDayOfWeek[event.dayOfWeek] = (byDayOfWeek[event.dayOfWeek] || 0) + 1;
    }

    // Find most active time
    const mostActiveTime = Object.entries(byTimeOfDay).sort((a, b) => b[1] - a[1])[0]?.[0] || "morning";
    const mostActiveDay = Object.entries(byDayOfWeek).sort((a, b) => b[1] - a[1])[0]?.[0] || "monday";

    return {
      totalEvents: events.length,
      eventCounts: counts,
      byTimeOfDay,
      byDayOfWeek,
      mostActiveTime,
      mostActiveDay,
    };
  },
});

