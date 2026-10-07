/**
 * Narrative Event Mutations
 *
 * CRUD operations for narrativeEvents table.
 * Events are individual occurrences that advance a narrative thread.
 */

import { v } from "convex/values";
import { mutation, internalMutation } from "../../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../../../../_generated/api";
import { claimSetValidator } from "../validators";

/**
 * FNV-1a 32-bit hash for stable ID generation
 */
function fnv1a32Hex(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Get ISO week number from timestamp
 */
function getWeekNumber(timestamp: number): string {
  const date = new Date(timestamp);
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, "0")}`;
}

/**
 * Generate citation IDs from URLs
 */
function generateCitationIds(urls: string[]): string[] {
  return urls.map((url) => `websrc_${fnv1a32Hex(url)}`);
}

/**
 * Add an event to a narrative thread
 */
export const addEvent = mutation({
  args: {
    threadId: v.id("narrativeThreads"),
    headline: v.string(),
    summary: v.string(),
    significance: v.union(
      v.literal("minor"),
      v.literal("moderate"),
      v.literal("major"),
      v.literal("plot_twist")
    ),
    occurredAt: v.number(),
    sourceUrls: v.array(v.string()),
    sourceNames: v.array(v.string()),
    discoveredByAgent: v.optional(v.string()),
    agentConfidence: v.optional(v.number()),
  },
  returns: v.id("narrativeEvents"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    // Verify thread ownership
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread not found");
    if (thread.userId !== userId) throw new Error("Not authorized");

    const now = Date.now();
    const eventId = `ne_${fnv1a32Hex(args.headline + now)}`;
    const weekNumber = getWeekNumber(args.occurredAt);
    const citationIds = generateCitationIds(args.sourceUrls);

    // Insert event
    const eventDocId = await ctx.db.insert("narrativeEvents", {
      eventId,
      threadId: args.threadId,
      headline: args.headline,
      summary: args.summary,
      significance: args.significance,
      occurredAt: args.occurredAt,
      discoveredAt: now,
      weekNumber,
      sourceUrls: args.sourceUrls,
      sourceNames: args.sourceNames,
      citationIds,
      discoveredByAgent: args.discoveredByAgent || "user",
      agentConfidence: args.agentConfidence || 1.0,
      isVerified: false,
      hasContradictions: false,
      createdAt: now,
    });

    // Update thread metrics
    await ctx.scheduler.runAfter(0, internal.domains.narrative.mutations.threads.updateThreadMetrics, {
      threadId: args.threadId,
      eventOccurredAt: args.occurredAt,
      isPlotTwist: args.significance === "plot_twist",
      hasMultipleSources: args.sourceUrls.length > 1,
    });

    return eventDocId;
  },
});

/**
 * Internal version for agent use
 */
export const addEventInternal = internalMutation({
  args: {
    threadId: v.id("narrativeThreads"),
    headline: v.string(),
    summary: v.string(),
    significance: v.union(
      v.literal("minor"),
      v.literal("moderate"),
      v.literal("major"),
      v.literal("plot_twist")
    ),
    occurredAt: v.number(),
    sourceUrls: v.array(v.string()),
    sourceNames: v.array(v.string()),
    discoveredByAgent: v.string(),
    agentConfidence: v.number(),
    claimIds: v.optional(v.array(v.id("graphClaims"))),
    artifactIds: v.optional(v.array(v.id("sourceArtifacts"))),
    claimSet: claimSetValidator,
  },
  returns: v.id("narrativeEvents"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const eventId = `ne_${fnv1a32Hex(args.headline + now)}`;
    const weekNumber = getWeekNumber(args.occurredAt);
    const citationIds = generateCitationIds(args.sourceUrls);

    // Insert event
    const eventDocId = await ctx.db.insert("narrativeEvents", {
      eventId,
      threadId: args.threadId,
      headline: args.headline,
      summary: args.summary,
      significance: args.significance,
      occurredAt: args.occurredAt,
      discoveredAt: now,
      weekNumber,
      sourceUrls: args.sourceUrls,
      sourceNames: args.sourceNames,
      citationIds,
      claimIds: args.claimIds,
      artifactIds: args.artifactIds,
      claimSet: args.claimSet,
      discoveredByAgent: args.discoveredByAgent,
      agentConfidence: args.agentConfidence,
      isVerified: false,
      hasContradictions: false,
      createdAt: now,
    });

    // Update thread metrics
    await ctx.scheduler.runAfter(0, internal.domains.narrative.mutations.threads.updateThreadMetrics, {
      threadId: args.threadId,
      eventOccurredAt: args.occurredAt,
      isPlotTwist: args.significance === "plot_twist",
      hasMultipleSources: args.sourceUrls.length > 1,
    });

    return eventDocId;
  },
});

/**
 * Update event verification status
 */
export const updateEventVerification = mutation({
  args: {
    eventId: v.id("narrativeEvents"),
    isVerified: v.boolean(),
    hasContradictions: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("Event not found");

    // Verify thread ownership
    const thread = await ctx.db.get(event.threadId);
    if (!thread || thread.userId !== userId) throw new Error("Not authorized");

    const updates: Record<string, unknown> = {
      isVerified: args.isVerified,
    };
    if (args.hasContradictions !== undefined) {
      updates.hasContradictions = args.hasContradictions;
    }

    await ctx.db.patch(args.eventId, updates);

    // Update thread quality if verified
    if (args.isVerified) {
      await ctx.scheduler.runAfter(0, internal.domains.narrative.mutations.threads.updateThreadMetrics, {
        threadId: event.threadId,
        eventOccurredAt: event.occurredAt,
        isPlotTwist: false,
        hasVerifiedClaims: true,
      });
    }
  },
});

/**
 * Internal: Update event verification status (agent/system)
 */
export const setEventVerificationInternal = internalMutation({
  args: {
    eventId: v.id("narrativeEvents"),
    isVerified: v.boolean(),
    hasContradictions: v.boolean(),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) return;

    await ctx.db.patch(args.eventId, {
      isVerified: args.isVerified,
      hasContradictions: args.hasContradictions,
    });

    if (args.isVerified) {
      await ctx.scheduler.runAfter(0, internal.domains.narrative.mutations.threads.updateThreadMetrics, {
        threadId: event.threadId,
        eventOccurredAt: event.occurredAt,
        isPlotTwist: false,
        hasVerifiedClaims: true,
      });
    }
  },
});

/**
 * Internal: Update event evidence artifactIds (agent/system)
 */
export const setEventArtifactIdsInternal = internalMutation({
  args: {
    eventId: v.id("narrativeEvents"),
    artifactIds: v.array(v.id("sourceArtifacts")),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) return;
    await ctx.db.patch(args.eventId, { artifactIds: args.artifactIds });
  },
});

/**
 * Delete an event
 */
export const deleteEvent = mutation({
  args: {
    eventId: v.id("narrativeEvents"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("Event not found");

    // Verify thread ownership
    const thread = await ctx.db.get(event.threadId);
    if (!thread || thread.userId !== userId) throw new Error("Not authorized");

    await ctx.db.delete(args.eventId);

    // Decrement thread event count
    await ctx.db.patch(event.threadId, {
      eventCount: Math.max(0, thread.eventCount - 1),
      plotTwistCount: event.significance === "plot_twist"
        ? Math.max(0, thread.plotTwistCount - 1)
        : thread.plotTwistCount,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Batch add events (for agent use)
 */
export const batchAddEvents = internalMutation({
  args: {
    events: v.array(
      v.object({
        threadId: v.id("narrativeThreads"),
        headline: v.string(),
        summary: v.string(),
        significance: v.union(
          v.literal("minor"),
          v.literal("moderate"),
          v.literal("major"),
          v.literal("plot_twist")
        ),
        occurredAt: v.number(),
        sourceUrls: v.array(v.string()),
        sourceNames: v.array(v.string()),
        discoveredByAgent: v.string(),
        agentConfidence: v.number(),
      })
    ),
  },
  returns: v.array(v.id("narrativeEvents")),
  handler: async (ctx, args) => {
    const now = Date.now();
    const eventIds: Array<typeof args.events[0]["threadId"]> = [];

    for (const event of args.events) {
      const eventId = `ne_${fnv1a32Hex(event.headline + now + Math.random())}`;
      const weekNumber = getWeekNumber(event.occurredAt);
      const citationIds = generateCitationIds(event.sourceUrls);

      const docId = await ctx.db.insert("narrativeEvents", {
        eventId,
        threadId: event.threadId,
        headline: event.headline,
        summary: event.summary,
        significance: event.significance,
        occurredAt: event.occurredAt,
        discoveredAt: now,
        weekNumber,
        sourceUrls: event.sourceUrls,
        sourceNames: event.sourceNames,
        citationIds,
        discoveredByAgent: event.discoveredByAgent,
        agentConfidence: event.agentConfidence,
        isVerified: false,
        hasContradictions: false,
        createdAt: now,
      });

      eventIds.push(docId as any);
    }

    return eventIds as any;
  },
});
