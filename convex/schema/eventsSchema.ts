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
  // Phase 4 real-auth: SHA-256 hash of the one-time host claim code.
  // Server-generated, never readable by clients. Plaintext code is
  // returned exactly once from requestHostClaim and must be shown
  // out-of-band to the legitimate host. claimHostWithCode validates
  // by hashing the submitted code and comparing constant-time.
  hostClaimCodeHash: v.optional(v.string()),
  hostClaimCodeCreatedAt: v.optional(v.number()),
  status: v.union(
    v.literal("draft"),
    v.literal("live"),
    v.literal("ended"),
  ),
  publicDiscoverable: v.optional(v.boolean()),          // opt-in listing on the apex landing
  joinPolicy: v.optional(v.union(
    v.literal("open"),
    v.literal("request"),
  )),
  startedAt: v.number(),
  lastActivityAt: v.optional(v.number()),               // create/join/message activity; heartbeat does not keep listings warm
  endedAt: v.optional(v.number()),
})
  .index("by_slug", ["slug"])
  .index("by_roomCode", ["roomCode"])
  // Landing live-stats (events:getLandingStats): index-ordered scans for the
  // total room count and the "live rooms right now" count, so the apex counter
  // never full-scans the table. Additive — Convex builds them on deploy.
  .index("by_startedAt", ["startedAt"])
  .index("by_status_startedAt", ["status", "startedAt"])
  .index("by_public_status_startedAt", ["publicDiscoverable", "status", "startedAt"]);

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
  // Step 10 (additive, optional): server-side rate-limit timestamp for the
  // users:generateLiveCues / users:generateLiveCuesLLM cue rail. Unrelated to
  // lastSeenAt — that one is updated by every presence ping and chat send; this
  // one only by cue generation. Optional so existing rows don't need backfill.
  lastCueGenAt: v.optional(v.number()),
})
  .index("by_event_session", ["eventId", "sessionId"])
  .index("by_session_joined", ["sessionId", "joinedAt"])
  .index("by_event_lastSeen", ["eventId", "lastSeenAt"])
  // Global presence index — powers "active now" on the landing counter
  // (events:getLandingStats counts members with lastSeenAt within the TTL).
  .index("by_lastSeen", ["lastSeenAt"]);

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
  askedBySessionId: v.optional(v.string()),
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
  agentMode: v.optional(v.union(
    v.literal("deterministic"),
    v.literal("provider"),
    v.literal("provider_fallback"),
    v.literal("cache"),
  )),
  provider: v.optional(v.string()),
  modelId: v.optional(v.string()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  estimatedCostCents: v.optional(v.number()),
  externalSearches: v.optional(v.number()),
  evaluation: v.optional(v.object({
    passed: v.boolean(),
    score: v.number(),
    checks: v.array(v.object({
      name: v.string(),
      status: v.union(v.literal("pass"), v.literal("warn"), v.literal("fail")),
      detail: v.optional(v.string()),
    })),
  })),
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
  anchorType: v.optional(v.union(
    v.literal("message"),
    v.literal("thread"),
    v.literal("time_range"),
    v.literal("answer"),
    v.literal("entity"),
    v.literal("event"),
  )),
  anchorId: v.optional(v.string()),                      // messageId, answerId, entityUri, event slug, etc.
  anchorLabel: v.optional(v.string()),                   // human readable label: "Sarah Kim - 1:37p"
  anchorPreview: v.optional(v.string()),                 // short public-context preview visible only to owner
  startTs: v.optional(v.number()),                       // for time_range anchors
  endTs: v.optional(v.number()),                         // for time_range anchors
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_updated", ["ownerKey", "updatedAt"])
  .index("by_owner_event", ["ownerKey", "eventId"])
  .index("by_owner_event_anchor", ["ownerKey", "eventId", "anchorType", "anchorId"]);

// ------------------------------------------------------------------
// liveEventHosts - Phase 4 host ownership and moderation gate.
//
// ownerKey field carries one of two formats:
//
//   1. Legacy demo format (Phase 1-3 backward compat):
//      Plain string 8-80 chars. Verified only by table membership
//      (the row exists with this exact ownerKey). Used by the
//      dogfood static key and any localStorage-only host.
//
//   2. Real-auth format (Phase 4+):
//      "hk1:<eventIdShort>:<nonce>:<issuedAt>:<hmac>" where hmac =
//      HMAC-SHA256(SCRATCHNODE_HOST_TOKEN_SECRET, eventId|nonce|issuedAt).
//      Verified cryptographically by requireHost — no DB lookup needed
//      to prove the token was issued by the server. Server-generated
//      only after a successful claimHostWithCode call, so possession of
//      the token IS proof of having possessed the one-time host claim
//      code.
//
// authMethod records which path issued this row so future audits can
// distinguish legacy from real-auth hosts.
// ------------------------------------------------------------------
export const liveEventHosts = defineTable({
  eventId: v.id("liveEvents"),
  ownerKey: v.string(),
  displayName: v.string(),
  role: v.union(v.literal("owner"), v.literal("host")),
  authMethod: v.optional(v.union(
    v.literal("legacy_ownerkey"),                       // Phase 1-3 — client-chosen key
    v.literal("claim_code"),                            // Phase 4+ — server-issued HMAC token
  )),
  createdAt: v.number(),
})
  .index("by_event_owner", ["eventId", "ownerKey"])
  .index("by_owner", ["ownerKey", "createdAt"])
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

// ------------------------------------------------------------------
// liveEventNoteAnchors — Phase 5 follow-up: link a private note to a
// specific public chat message or public /ask answer.
//
// Privacy invariants (release-blocker per .claude audit 2026-05-27):
//   - Anchor content (the linked note) is owner-keyed and NEVER appears
//     in any public surface — chat feed, wiki, or others' /ask traces.
//   - Marker visibility is decided client-side from listMyAnchors;
//     no broadcast query exposes "is X anchored?" to non-owners.
//   - There is INTENTIONALLY no by_target_* index. Looking up "does any
//     anyone have a note anchored at messageId M?" would let an attacker
//     map other users' private interest in M. All lookups must go
//     through (ownerKey, eventId).
//
// Cascade contract:
//   - notes:deleteNote removes anchors for that note inline (no janitor
//     cron). Keeps the (note, anchors) state transactionally consistent.
//
// Reliability (per .claude/rules/agentic_reliability.md):
//   - BOUND: listMyAnchors capped at 500 with _truncated flag
//   - HONEST_STATUS: createNoteAnchor throws typed ConvexError on validation
//   - DETERMINISTIC: pure inserts, server-generated createdAt
// ------------------------------------------------------------------
export const liveEventNoteAnchors = defineTable({
  ownerKey: v.string(),                                 // same shape as userNotes.ownerKey
  eventId: v.id("liveEvents"),
  noteId: v.id("userNotes"),
  targetKind: v.union(v.literal("message"), v.literal("answer")),
  targetMessageId: v.optional(v.id("liveEventMessages")),
  targetAnswerId: v.optional(v.id("liveEventAnswers")),
  createdAt: v.number(),
})
  .index("by_owner_event", ["ownerKey", "eventId"])
  .index("by_note", ["noteId"]);

// scratchnodeRateLimits — DB-backed fixed-window rate-limit counters for the
// public ScratchNode mutations (join / send / hostclaim / signin). WHY A TABLE
// AND NOT AN IN-MEMORY MAP: Convex mutations run in V8 isolates that do NOT
// share memory and get recycled between calls, so an in-memory counter would
// reset to 0 on every cold isolate — a HONEST_SCORES violation (the limiter
// would report "allowed" while counting nothing). A counter ROW under Convex
// OCC serializability is exact even under a concurrent burst: a range-read that
// finds no row is in the txn read set, so a competing insert into the same
// (key, windowStart) range invalidates it → retry → re-read → patch.
//   - BOUND: janitor sweeps expired rows via by_expiresAt, ≤500/run.
//   - DETERMINISTIC: windowStart = floor(now / windowMs) * windowMs.
// See convex/scratchnodeRateLimit.ts for the enforcement + eviction logic.
export const scratchnodeRateLimits = defineTable({
  key: v.string(),            // "<action>:<identity>" — e.g. "send:<sessionId>"
  windowStart: v.number(),    // floor(now / windowMs) * windowMs
  count: v.number(),
  expiresAt: v.number(),      // windowStart + windowMs — janitor sweep key
})
  .index("by_key_window", ["key", "windowStart"])
  .index("by_expiresAt", ["expiresAt"]);

// ------------------------------------------------------------------
// liveEventWallItems — Phase 8: the spatial "Memory Wall" overlay.
//
// LAYOUT-ONLY overlay over PUBLIC content. A wall item carries a
// position (x,y), size (w), style (color), optional flat group, and a
// z-order, and POINTS at content that already lives elsewhere:
//   - refType "message" -> refMessageId (a public chat message)
//   - refType "answer"  -> refAnswerId  (a public /ask answer)
//   - refType "note"    -> text         (a short free-text sticky
//                                         authored directly on the wall)
//
// Content/layout separation (NodeBench-original adaptation of the
// FigJam/Miro "frame holds widgets" model): message/answer text is
// NEVER duplicated — the card renders by dereferencing the pointer.
// Only a "note" sticky stores its own inline text, and that text is
// PUBLIC by construction (every member of the room sees the wall),
// exactly like a chat message. This keeps Chat and Wall a single
// source of truth — the "Twitch" model of one stream, two render lanes.
//
// Privacy invariant (mirrors liveEventNoteAnchors): the Wall is a
// PUBLIC surface. It may ONLY reference public content — NEVER
// userNotes (private, owner-keyed). There is intentionally no field
// or index that can reach a private note from a wall item.
//
// Reliability (per .claude/rules/agentic_reliability.md):
//   - BOUND: listWallItems caps at MAX_WALL_ITEMS = 500 (mirrors getMembers);
//     every id[] mutation caps at MAX_WALL_BATCH = 200.
//   - HONEST_STATUS: mutations throw typed ConvexError on validation.
//   - DETERMINISTIC: server-stamped createdAt/updatedAt; groupId derived
//     from the lexicographically smallest member id ("g:" + minId), so the
//     same selection always groups to the same id.
//
// Conflict resolution: position writes commit once on pointerup via
// moveWallItems. Convex's serializable txn ordering IS the last-write-
// wins resolver — no CRDT needed at room scale.
// ------------------------------------------------------------------
export const liveEventWallItems = defineTable({
  eventId: v.id("liveEvents"),
  refType: v.union(
    v.literal("message"),
    v.literal("answer"),
    v.literal("note"),
  ),
  refMessageId: v.optional(v.id("liveEventMessages")),  // refType "message"
  refAnswerId: v.optional(v.id("liveEventAnswers")),    // refType "answer"
  text: v.optional(v.string()),                         // refType "note" — inline PUBLIC text
  x: v.number(),
  y: v.number(),
  w: v.number(),
  color: v.string(),                                    // validated vs WALL_COLORS in wall.ts
  groupId: v.optional(v.string()),                      // flat Figma-style group model
  z: v.number(),                                        // stacking order; bumped on interaction
  createdBySessionId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_event", ["eventId"])
  .index("by_event_updated", ["eventId", "updatedAt"])
  .index("by_event_message", ["eventId", "refMessageId"])  // pin-dedup for messages
  .index("by_event_answer", ["eventId", "refAnswerId"]);   // pin-dedup for answers
