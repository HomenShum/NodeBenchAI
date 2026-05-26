/**
 * Events Schema — Phase 1 of the live prod plan
 *
 * Backs scratchnode.live event rooms with anonymous shared chat.
 * No auth — guests join with a sessionId UUID from the browser.
 *
 * See public/proto/docs.html#plan-phases for the full spec.
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

// ------------------------------------------------------------------
// events — top-level event record
// ------------------------------------------------------------------
export const liveEvents = defineTable({
  slug: v.string(),                                     // "ai-infra-summit-2026"
  name: v.string(),                                     // "AI Infra Summit"
  roomCode: v.string(),                                 // "ORBITAL" — short pronounceable code
  hostUserId: v.optional(v.id("users")),                // optional in Phase 1; required from Phase 4
  status: v.union(
    v.literal("draft"),
    v.literal("live"),
    v.literal("ended"),
  ),
  startedAt: v.number(),
  endedAt: v.optional(v.number()),
})
  .index("by_slug", ["slug"])
  .index("by_roomCode", ["roomCode"]);

// ------------------------------------------------------------------
// liveEventMembers — anonymous presence per event
// TTL: 5min — janitor cron evicts entries with lastSeenAt older than that.
// ------------------------------------------------------------------
export const liveEventMembers = defineTable({
  eventId: v.id("liveEvents"),
  sessionId: v.string(),                                // browser-generated UUID; not tied to auth
  displayName: v.string(),
  joinedAt: v.number(),
  lastSeenAt: v.number(),
})
  .index("by_event_session", ["eventId", "sessionId"])
  .index("by_event_lastSeen", ["eventId", "lastSeenAt"]);

// ------------------------------------------------------------------
// liveEventMessages — public chat feed for an event
// kind: "chat" (normal), "ask" (invokes agent in Phase 2), "system" (joins/leaves)
// ------------------------------------------------------------------
export const liveEventMessages = defineTable({
  eventId: v.id("liveEvents"),
  sessionId: v.string(),
  displayName: v.string(),                              // snapshot at send time
  text: v.string(),
  kind: v.union(
    v.literal("chat"),
    v.literal("ask"),
    v.literal("system"),
  ),
  replyToMessageId: v.optional(v.id("liveEventMessages")),
  createdAt: v.number(),
})
  .index("by_event_time", ["eventId", "createdAt"]);
