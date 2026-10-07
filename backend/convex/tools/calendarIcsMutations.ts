// convex/tools/calendarIcsMutations.ts
// Internal mutations and queries for calendar ICS artifacts

import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

/**
 * Create or update a calendar artifact
 */
export const createCalendarArtifact = internalMutation({
  args: {
    eventUid: v.string(),
    operation: v.union(
      v.literal("create"),
      v.literal("update"),
      v.literal("cancel"),
    ),
    icsContent: v.string(),
    summary: v.string(),
    dtStart: v.number(),
    dtEnd: v.optional(v.number()),
    location: v.optional(v.string()),
    description: v.optional(v.string()),
    attendees: v.optional(v.array(v.string())),
    sequence: v.number(),
    version: v.number(),
    threadId: v.optional(v.string()),
    runId: v.optional(v.string()),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const artifactData: any = {
      eventUid: args.eventUid,
      operation: args.operation,
      icsContent: args.icsContent,
      summary: args.summary,
      dtStart: args.dtStart,
      sequence: args.sequence,
      version: args.version,
      createdAt: now,
    };

    // Add optional fields
    if (args.dtEnd !== undefined) artifactData.dtEnd = args.dtEnd;
    if (args.location) artifactData.location = args.location;
    if (args.description) artifactData.description = args.description;
    if (args.attendees) artifactData.attendees = args.attendees;
    if (args.threadId) artifactData.threadId = args.threadId;
    if (args.runId) artifactData.runId = args.runId;

    // Handle userId - required for the table
    if (args.userId) {
      artifactData.userId = args.userId;
      const id = await ctx.db.insert("calendarArtifacts", artifactData);
      console.log("[createCalendarArtifact] Artifact created", {
        id,
        eventUid: args.eventUid,
        operation: args.operation,
        version: args.version,
      });
      return id;
    } else {
      // Log warning - artifact won't be persisted without userId
      console.warn("[createCalendarArtifact] No userId provided - artifact logged but not persisted", {
        eventUid: args.eventUid,
        operation: args.operation,
        summary: args.summary,
      });
      return null;
    }
  },
});

/**
 * Get the latest calendar artifact by event UID
 */
export const getCalendarArtifact = internalQuery({
  args: {
    eventUid: v.string(),
  },
  handler: async (ctx, args) => {
    // Get all artifacts for this event UID, ordered by creation time
    const artifacts = await ctx.db
      .query("calendarArtifacts")
      .withIndex("by_eventUid", q => q.eq("eventUid", args.eventUid))
      .collect();

    if (artifacts.length === 0) {
      return null;
    }

    // Return the most recent version
    return artifacts.reduce((latest, current) =>
      current.version > latest.version ? current : latest
    );
  },
});

/**
 * Get all calendar artifacts for a user within a date range
 */
export const getUserCalendarArtifacts = internalQuery({
  args: {
    userId: v.id("users"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const query = ctx.db
      .query("calendarArtifacts")
      .withIndex("by_user", q => q.eq("userId", args.userId));

    const artifacts = await query.collect();

    // Filter by date range if provided
    let filtered = artifacts;
    if (args.startDate) {
      filtered = filtered.filter(a => a.dtStart >= args.startDate!);
    }
    if (args.endDate) {
      filtered = filtered.filter(a => a.dtStart <= args.endDate!);
    }

    // Group by eventUid and return only latest version of each
    const latestByUid = new Map<string, typeof artifacts[0]>();
    for (const artifact of filtered) {
      const existing = latestByUid.get(artifact.eventUid);
      if (!existing || artifact.version > existing.version) {
        latestByUid.set(artifact.eventUid, artifact);
      }
    }

    // Filter out cancelled events unless explicitly requested
    return Array.from(latestByUid.values())
      .filter(a => a.operation !== "cancel")
      .sort((a, b) => a.dtStart - b.dtStart);
  },
});

/**
 * Get ICS content for download
 */
export const getIcsContent = internalQuery({
  args: {
    eventUid: v.string(),
    version: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const artifacts = await ctx.db
      .query("calendarArtifacts")
      .withIndex("by_eventUid", q => q.eq("eventUid", args.eventUid))
      .collect();

    if (artifacts.length === 0) {
      return null;
    }

    // Get specific version or latest
    let artifact;
    if (args.version !== undefined) {
      artifact = artifacts.find(a => a.version === args.version);
    } else {
      artifact = artifacts.reduce((latest, current) =>
        current.version > latest.version ? current : latest
      );
    }

    return artifact ? { icsContent: artifact.icsContent, version: artifact.version } : null;
  },
});
