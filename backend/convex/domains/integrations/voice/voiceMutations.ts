/**
 * Voice Mutations - Database operations for voice sessions
 * 
 * Manages voice session state for RTVI/Daily Bots integration
 */

import { internalMutation, internalQuery } from "../../../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../../../_generated/dataModel";

/**
 * Create a new voice session
 * 
 * Called when a voice client connects via /voice/connect
 */
export const createVoiceSession = internalMutation({
  args: {
    sessionId: v.string(),
    userId: v.string(),
    threadId: v.string(),
    metadata: v.optional(v.object({
      clientType: v.optional(v.string()),
      deviceInfo: v.optional(v.string()),
      model: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // Check if session already exists
    const existing = await ctx.db
      .query("voiceSessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
      .first() as Doc<"voiceSessions"> | null;
    
    if (existing) {
      // Update existing session
      await ctx.db.patch(existing._id, {
        threadId: args.threadId,
        lastActivityAt: now,
        metadata: args.metadata,
      });
      return existing._id;
    }
    
    // Create new session
    const sessionId = await ctx.db.insert("voiceSessions", {
      sessionId: args.sessionId,
      userId: args.userId as Id<"users">,
      threadId: args.threadId,
      createdAt: now,
      lastActivityAt: now,
      metadata: args.metadata,
    });
    
    return sessionId;
  },
});

/**
 * Get a voice session by sessionId
 */
export const getVoiceSession = internalQuery({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("voiceSessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
      .first() as Doc<"voiceSessions"> | null;

    return session;
  },
});

/**
 * Update session activity timestamp
 * 
 * Called on each voice interaction to track session liveness
 */
export const updateVoiceSessionActivity = internalMutation({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("voiceSessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
      .first() as Doc<"voiceSessions"> | null;

    if (!session) {
      throw new Error(`Voice session not found: ${args.sessionId}`);
    }

    await ctx.db.patch(session._id, {
      lastActivityAt: Date.now(),
    });
  },
});

/**
 * Delete a voice session
 * 
 * Called when a voice client disconnects
 */
export const deleteVoiceSession = internalMutation({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("voiceSessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
      .first() as Doc<"voiceSessions"> | null;

    if (session) {
      await ctx.db.delete(session._id);
    }
  },
});

/**
 * Get all active voice sessions for a user
 */
export const getUserVoiceSessions = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("voiceSessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect() as Doc<"voiceSessions">[];

    return sessions;
  },
});

/**
 * Clean up stale voice sessions (older than 24 hours)
 */
export const cleanupStaleSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    const staleSessions = await ctx.db
      .query("voiceSessions")
      .withIndex("by_last_activity")
      .filter((q) => q.lt(q.field("lastActivityAt"), oneDayAgo))
      .collect() as Doc<"voiceSessions">[];

    for (const session of staleSessions) {
      await ctx.db.delete(session._id);
    }

    return { deleted: staleSessions.length };
  },
});

