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

// ------------------------------------------------------------------
// liveEventSources — corpus the /ask agent retrieves from (Phase 2)
// vectorIndex enables semantic search by embedding similarity.
// 1536 dims matches OpenAI text-embedding-3-small (cheap + good enough).
// ------------------------------------------------------------------
export const liveEventSources = defineTable({
  eventId: v.id("liveEvents"),
  uri: v.string(),                                      // canonical URI ("https://..." or "transcript://...")
  kind: v.union(
    v.literal("transcript"),
    v.literal("doc"),
    v.literal("url"),
    v.literal("slide"),
  ),
  title: v.string(),
  excerpt: v.string(),                                  // first ~280 chars rendered as a source chip preview
  body: v.string(),                                     // retrieval text; bounded by mutation layer
  sourceHash: v.string(),
  isSeeded: v.boolean(),
  bodyEmbedding: v.optional(v.array(v.number())),       // optional — sources can exist without embedding initially
  uploadedAt: v.number(),
})
  .index("by_event", ["eventId"])
  .index("by_event_uri", ["eventId", "uri"])
  .vectorIndex("by_embedding", {
    vectorField: "bodyEmbedding",
    dimensions: 1536,
    filterFields: ["eventId"],
  });

// ------------------------------------------------------------------
// liveEventAnswers — /ask results, source-cited, cacheable (Phase 2)
// Reusable across attendees who ask similar questions (semantic cache
// lookup is Phase 6 — Redis layer). Phase 2 stores answers as a
// foundation; Phase 6 adds the similarity-based reuse.
// ------------------------------------------------------------------
export const liveEventAnswers = defineTable({
  eventId: v.id("liveEvents"),
  questionMessageId: v.id("liveEventMessages"),
  question: v.string(),
  normalizedQuestion: v.string(),
  body: v.string(),
  sourceIds: v.array(v.id("liveEventSources")),
  trace: v.array(v.object({
    step: v.string(),                                   // "cache_lookup", "retrieve", "llm_run", "persist"
    status: v.union(
      v.literal("ok"),
      v.literal("miss"),
      v.literal("error"),
    ),
    detail: v.optional(v.string()),
    durationMs: v.number(),
  })),
  cacheHit: v.boolean(),
  faqStatus: v.union(
    v.literal("none"),
    v.literal("suggested"),                             // attendee proposed it
    v.literal("promoted"),                              // host accepted it into the wiki
  ),
  createdAt: v.number(),
})
  .index("by_event_time", ["eventId", "createdAt"])
  .index("by_event_normalized", ["eventId", "normalizedQuestion"])
  .index("by_question", ["questionMessageId"]);

// ------------------------------------------------------------------
// userNotes — private notes per anonymous session (Phase 3)
// ownerKey = sessionId for anonymous, or "user:<userId>" once authed (Phase 4).
// Server gates ALL reads/writes by ownerKey === ctx.session.ownerKey —
// client-controlled ownerKey would let anyone read anyone's notes.
// ------------------------------------------------------------------
export const userNotes = defineTable({
  ownerKey: v.string(),                                 // session-based identity
  eventId: v.optional(v.id("liveEvents")),              // scoped to event, or null = general
  title: v.string(),
  bodyHtml: v.string(),                                 // rich text (TipTap output in Phase 7)
  tags: v.array(v.string()),
  pinned: v.boolean(),
  isAsk: v.boolean(),                                   // created via private /ask
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_updated", ["ownerKey", "updatedAt"])
  .index("by_owner_event", ["ownerKey", "eventId"]);

// ------------------------------------------------------------------
// liveEventHosts - Phase 4 host ownership and moderation gate.
// ownerKey is sessionId for anonymous demo hosts and user:<id> after auth.
// ------------------------------------------------------------------
export const liveEventHosts = defineTable({
  eventId: v.id("liveEvents"),
  ownerKey: v.string(),
  displayName: v.string(),
  role: v.union(v.literal("owner"), v.literal("host")),
  createdAt: v.number(),
})
  .index("by_event_owner", ["eventId", "ownerKey"])
  .index("by_event", ["eventId"]);

// ------------------------------------------------------------------
// liveEventWikiVersions - Phase 5 durable public wiki snapshots.
// Built only from public chat, public /ask answers, and event sources.
// ------------------------------------------------------------------
export const liveEventWikiVersions = defineTable({
  eventId: v.id("liveEvents"),
  version: v.number(),
  status: v.union(v.literal("draft"), v.literal("published")),
  title: v.string(),
  bodyHtml: v.string(),
  sourceAnswerIds: v.array(v.id("liveEventAnswers")),
  sourceIds: v.array(v.id("liveEventSources")),
  createdByOwnerKey: v.string(),
  createdAt: v.number(),
  publishedAt: v.optional(v.number()),
})
  .index("by_event_version", ["eventId", "version"])
  .index("by_event_status", ["eventId", "status", "version"]);
