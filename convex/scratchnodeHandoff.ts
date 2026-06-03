/**
 * convex/scratchnodeHandoff.ts — Step 9 of the scratchnode release loop.
 *
 * Surfaces ScratchNode event participation inside NodeBench (nodebenchai.com).
 * Pure read-only join over canonical tables (liveEvents · liveEventMembers ·
 * liveEventHosts). Step 8's users table + events:listMyEvents is still in
 * flight at the time this lands; this file does NOT depend on it.
 *
 * Identity model: ownerKey === sessionId for anonymous Phase 1-3 (the
 * sn_session_id localStorage value from scratchnode.live). Phase 4 auth'd
 * notes have already migrated via notes:migrateOwnerKey to user:<convexId>;
 * this query accepts both.
 *
 * Why a separate file: this PR is scoped to NodeBench-side handoff and is
 * constrained NOT to modify convex/events.ts or convex/notes.ts (Step 8
 * owns those). A sibling file keeps the new query reviewable.
 *
 * Reliability (.claude/rules/agentic_reliability.md):
 *   - BOUND: MAX_JOINED_EVENTS caps; _truncated:true exposed honestly.
 *   - HONEST_STATUS: empty result on invalid input, never throws (guest-safe).
 *   - DETERMINISTIC: sorted joinedAt DESC.
 *
 * Privacy: returns ONLY membership metadata. Never enumerates other
 * sessions' memberships. Private notes flow through notes:listMyNotes
 * (independently validates ownerKey).
 */

import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { enforceRateLimit } from "./scratchnodeRateLimit";

// Local ConvexError shim — mirrors convex/events.ts / convex/notes.ts so the
// thrown error serializes to the client with `data` (code) intact. The handoff
// mutations FAIL CLOSED with a typed error on every denial path.
class ConvexError<T extends Record<string, unknown>> extends Error {
  data: T;
  constructor(data: T) {
    super(String(data.message ?? JSON.stringify(data)));
    this.name = "ConvexError";
    this.data = data;
    (this as Record<PropertyKey, unknown>)[Symbol.for("ConvexError")] = true;
  }
}

// BOUND: liveEventMembers has no by_sessionId index — the canonical index
// is by_event_session. We filter in memory with a scan cap. Predictable
// cost > silent row drop OR a schema index we can't ship in this PR.
const MAX_JOINED_EVENTS = 100;
const MAX_SESSION_SCAN = 500;
const MIN_OWNER_KEY_LEN = 8;
const MAX_OWNER_KEY_LEN = 80;

const isOwnerKeyValid = (ownerKey: string): boolean =>
  typeof ownerKey === "string" &&
  ownerKey.length >= MIN_OWNER_KEY_LEN &&
  ownerKey.length <= MAX_OWNER_KEY_LEN;

export type JoinedScratchnodeEvent = {
  eventId: string;
  eventSlug: string;
  eventName: string;
  status: string;
  joinedAt: number;
  lastSeenAt: number;
  role: "attendee" | "host";
  scratchnodeUrl: string;
};

export type ListMyJoinedEventsResult = {
  joined: JoinedScratchnodeEvent[];
  _truncated: boolean;
};

const SCRATCHNODE_BASE_URL = "https://scratchnode.live";

/**
 * List the ScratchNode events a session has joined, sorted joinedAt DESC.
 *
 * @param ownerKey — sn_session_id (anonymous) or user:<convexId> (auth'd).
 *
 * Returns empty { joined: [], _truncated: false } when:
 *   - ownerKey is malformed (length / type)
 *   - session never joined any event (typical for fresh NodeBench visitors)
 *
 * NEVER throws — this is a guest-safe read.
 */
export const listMyJoinedEvents = query({
  args: { ownerKey: v.string() },
  handler: async (ctx, { ownerKey }): Promise<ListMyJoinedEventsResult> => {
    if (!isOwnerKeyValid(ownerKey)) {
      return { joined: [], _truncated: false };
    }

    const memberships = await ctx.db
      .query("liveEventMembers")
      .take(MAX_SESSION_SCAN);
    const mine = memberships.filter((row) => row.sessionId === ownerKey);

    const truncated = mine.length > MAX_JOINED_EVENTS;
    const limited = mine.slice(0, MAX_JOINED_EVENTS);

    const enriched: JoinedScratchnodeEvent[] = [];
    for (const membership of limited) {
      const event = await ctx.db.get(membership.eventId);
      if (!event) continue; // event deleted — skip silently

      // Host detection: only checks the canonical by_event_owner index
      // with ownerKey === sessionId (legacy Phase 1-3 path). Phase 4
      // HMAC tokens are NOT discoverable from a sessionId alone — we
      // deliberately do NOT enumerate liveEventHosts, that would leak
      // host count to unrelated sessions. Missing match → attendee
      // (the correct safe default).
      const hostRow = await ctx.db
        .query("liveEventHosts")
        .withIndex("by_event_owner", (q) =>
          q.eq("eventId", event._id).eq("ownerKey", ownerKey),
        )
        .first();

      enriched.push({
        eventId: String(event._id),
        eventSlug: event.slug,
        eventName: event.name,
        status: event.status,
        joinedAt: membership.joinedAt,
        lastSeenAt: membership.lastSeenAt,
        role: hostRow ? "host" : "attendee",
        scratchnodeUrl: `${SCRATCHNODE_BASE_URL}/e/${encodeURIComponent(event.slug)}`,
      });
    }

    enriched.sort((a, b) => b.joinedAt - a.joinedAt);
    return { joined: enriched, _truncated: truncated };
  },
});

/* ========================================================================== */
/* CROSS-DOMAIN PRIVATE-NOTES HANDOFF — opaque stateful token (roadmap #4)     */
/* ========================================================================== */
//
// LIFECYCLE (token never the session id travels):
//   1. MINT (on scratchnode.live): a member of <event> with <session> calls
//      mintEventHandoffToken({ slug, sessionId }). Server PROVES membership
//      (liveEventMembers.by_event_session), generates a 32-byte CSPRNG token,
//      stores SHA-256(token) + the binding {eventId, boundOwnerKey=sessionId}
//      in a server-only row with TTL ~10min + low maxUses, and returns ONLY
//      { token, expiresAt }. The raw token is never stored; the session id is
//      never returned.
//   2. TRAVEL: scratchnode.live navigates the browser to
//      nodebenchai.com/events/<slug>/private?token=<token>. ONLY the opaque
//      token is in the URL — never the session id.
//   3. CONSUME (on nodebenchai.com): the bridge surface calls
//      consumeEventHandoffToken({ token }). Server re-hashes the presented
//      token, looks the row up by hash, FAILS CLOSED if unknown / expired /
//      used up / wrong scope, increments usedCount, resolves the bound owner
//      server-side, and returns that event's PRIVATE notes READ-ONLY (≤200).
//      The session id is never returned.
//
// See convex/schema/eventsSchema.ts (liveEventHandoffTokens) for the binding
// rationale and the full security model.

// Token TTL — short by design. A handoff is a single navigation; 10 minutes
// covers a slow cross-domain hop + sign-in detour without leaving a long-lived
// credential alive.
const HANDOFF_TOKEN_TTL_MS = 10 * 60 * 1000;
// Low use cap — the NodeBench bridge consumes once; a couple extra uses absorb
// a refresh / back-button without re-mint. Far below anything an attacker could
// leverage even if a token leaked from history.
const HANDOFF_TOKEN_MAX_USES = 5;
// 32 random bytes = 256 bits. base64url ≈ 43 chars.
const HANDOFF_TOKEN_BYTES = 32;
// Reject obviously-malformed presented tokens before any DB work (BOUND_READ).
const MIN_PRESENTED_TOKEN_LEN = 20;
const MAX_PRESENTED_TOKEN_LEN = 200;
// BOUND: consume returns at most this many notes (read-only projection).
const MAX_HANDOFF_NOTES = 200;
// BOUND: janitor evicts at most this many expired rows per sweep.
const MAX_HANDOFF_TOKEN_EVICT = 500;
// Mint rate limit — per minting session. Generous for humans, caps a token
// flood. Uses the shared DB-backed fixed-window limiter (HONEST_SCORES).
const MINT_RATE_LIMIT_PER_WINDOW = 10;
const MINT_RATE_WINDOW_MS = 60_000;

// Convex runtime exposes Web Crypto. Same APIs used in convex/events.ts
// (randomString / sha256Hex). CSPRNG, NOT Math.random (DETERMINISTIC +
// unguessable token requirement from agentic_reliability).
const base64UrlEncode = (bytes: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  // btoa is available in the Convex V8 runtime.
  return (globalThis as any)
    .btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const generateOpaqueToken = (): string => {
  const buf = new Uint8Array(HANDOFF_TOKEN_BYTES);
  (globalThis as any).crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
};

const sha256Hex = async (input: string): Promise<string> => {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await (globalThis as any).crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(hashBuffer));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
};

const cleanSlug = (slug: string): string =>
  String(slug || "").trim().toLowerCase().slice(0, 120);

const isRoomCodeShape = (value: string): boolean =>
  /^[A-Z0-9-]{3,24}$/.test(value);

// Mirror of events.ts resolveEventBySlugOrRoomCode — kept local so this file
// stays self-contained (it cannot import non-exported helpers from events.ts).
const resolveEvent = async (ctx: any, slug: string) => {
  const s = cleanSlug(slug);
  if (!s) return null;
  const bySlug = await ctx.db
    .query("liveEvents")
    .withIndex("by_slug", (q: any) => q.eq("slug", s))
    .first();
  if (bySlug) return bySlug;
  const roomCode = s.toUpperCase();
  if (!isRoomCodeShape(roomCode)) return null;
  return await ctx.db
    .query("liveEvents")
    .withIndex("by_roomCode", (q: any) => q.eq("roomCode", roomCode))
    .first();
};

/**
 * MINT — issue an opaque, event-scoped, read-only handoff token.
 *
 * Callable from public/proto/home-v5.html on scratchnode.live via the live
 * Convex browser client.
 *
 * Security invariants enforced here:
 *   #1  The session id is NEVER returned (only { token, expiresAt }).
 *   #2  Membership is PROVEN: the (eventId, sessionId) pair must exist in
 *       liveEventMembers (by_event_session). A non-member — or a member of a
 *       DIFFERENT event — cannot mint.
 *   #3  Binding is server-side: {eventId, boundOwnerKey=sessionId} is sealed
 *       in the row; the client only ever holds the opaque token.
 *   BOUND/HONEST_STATUS: rate-limited; throws typed ConvexError on every
 *   failure; never returns a token on a denied path.
 */
export const mintEventHandoffToken = mutation({
  args: {
    slug: v.string(),
    sessionId: v.string(),
  },
  handler: async (ctx, { slug, sessionId }) => {
    // Shape gate (BOUND_READ) before any DB work. sn_session_id is a UUIDv4
    // (36 chars) or a fallback "sess_..." string; require a sane length.
    const sid = String(sessionId || "").trim();
    if (sid.length < 8 || sid.length > 80) {
      throw new ConvexError({
        code: "invalid_session",
        message: "A valid session is required to continue your notes.",
      });
    }

    // Rate-limit per minting session (DB-backed fixed window). Caps a token
    // flood even if the caller is a legitimate member.
    await enforceRateLimit(ctx, {
      key: `handoffmint:${sid}`,
      limit: MINT_RATE_LIMIT_PER_WINDOW,
      windowMs: MINT_RATE_WINDOW_MS,
    });

    const event = await resolveEvent(ctx, slug);
    if (!event) {
      // Fail closed — never mint against a phantom event.
      throw new ConvexError({
        code: "event_not_found",
        message: "That event could not be found.",
      });
    }

    // INVARIANT #2 — PROVE membership of THIS event with THIS session. This is
    // the authorization gate: only someone who actually joined the room (and
    // thus could have written private notes scoped to it) may mint.
    const member = await ctx.db
      .query("liveEventMembers")
      .withIndex("by_event_session", (q: any) =>
        q.eq("eventId", event._id).eq("sessionId", sid),
      )
      .first();
    if (!member) {
      throw new ConvexError({
        code: "not_a_member",
        message: "Join the event before continuing your notes in NodeBench.",
      });
    }

    // INVARIANT #1/#3 — generate the opaque token, store ONLY its hash + the
    // server-side binding. boundOwnerKey === sessionId for anonymous guests
    // (matches userNotes.ownerKey); it never leaves this row.
    const token = generateOpaqueToken();
    const tokenHash = await sha256Hex(token);
    const boundOwnerKeyHash = await sha256Hex(sid);
    const now = Date.now();
    const expiresAt = now + HANDOFF_TOKEN_TTL_MS;

    await ctx.db.insert("liveEventHandoffTokens", {
      tokenHash,
      eventId: event._id,
      boundOwnerKey: sid,           // server-only; never returned, never logged
      boundOwnerKeyHash,
      scope: "private_notes_read" as const,
      createdAt: now,
      expiresAt,
      usedCount: 0,
      maxUses: HANDOFF_TOKEN_MAX_USES,
    });

    // ONLY the opaque token + its expiry cross back to the client.
    return { token, expiresAt };
  },
});

export type HandoffNote = {
  noteId: string;
  title: string;
  bodyHtml: string;
  tags: string[];
  pinned: boolean;
  isAsk: boolean;
  createdAt: number;
  updatedAt: number;
};

export type ConsumeHandoffResult = {
  eventName: string;
  eventSlug: string;
  roomCode: string;
  scope: "private_notes_read";
  noteCount: number;
  notes: HandoffNote[];
  _truncated: boolean;
};

/**
 * CONSUME — fail-closed verify + read-only resolution of the bound session's
 * private notes for the bound event.
 *
 * A MUTATION (not a query) because it increments usedCount — single-use/low-use
 * enforcement requires a write.
 *
 * FAIL-CLOSED on every denial:
 *   - token shape invalid            → code=invalid_token
 *   - no row for this token hash      → code=invalid_token (indistinguishable
 *                                       from "wrong token" — no enumeration)
 *   - expired                         → code=token_expired
 *   - used up (usedCount >= maxUses)  → code=token_used
 *   - wrong scope                     → code=invalid_scope
 *   - bound event vanished            → code=event_not_found
 *
 * RETURNS: ONLY that event's notes for the bound session, READ-ONLY, BOUND at
 * MAX_HANDOFF_NOTES. NEVER returns the raw session id / owner key / token.
 * The owner is resolved SERVER-SIDE from the row binding — no client-supplied
 * owner key is ever trusted (the consume args contain only the token).
 */
export const consumeEventHandoffToken = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, { token }): Promise<ConsumeHandoffResult> => {
    const presented = String(token || "").trim();
    if (
      presented.length < MIN_PRESENTED_TOKEN_LEN ||
      presented.length > MAX_PRESENTED_TOKEN_LEN
    ) {
      throw new ConvexError({
        code: "invalid_token",
        message: "This continuation link is invalid.",
      });
    }

    const tokenHash = await sha256Hex(presented);
    const row = await ctx.db
      .query("liveEventHandoffTokens")
      .withIndex("by_token_hash", (q: any) => q.eq("tokenHash", tokenHash))
      .first();

    // Unknown token → fail closed with the SAME error as a bad shape, so a
    // caller cannot distinguish "no such token" from "malformed" (no oracle).
    if (!row) {
      throw new ConvexError({
        code: "invalid_token",
        message: "This continuation link is invalid or has already been used.",
      });
    }

    // Scope gate — this capstone only ever issues 'private_notes_read', but
    // verify defensively so a future scope can never be honored by this path.
    if (row.scope !== "private_notes_read") {
      throw new ConvexError({
        code: "invalid_scope",
        message: "This link does not grant access to private notes.",
      });
    }

    const now = Date.now();
    if (row.expiresAt <= now) {
      throw new ConvexError({
        code: "token_expired",
        message: "This continuation link has expired. Re-open it from ScratchNode.",
      });
    }

    if (row.usedCount >= row.maxUses) {
      throw new ConvexError({
        code: "token_used",
        message: "This continuation link has already been used up.",
      });
    }

    // Resolve the bound event. If it vanished, fail closed.
    const event = await ctx.db.get(row.eventId);
    if (!event) {
      throw new ConvexError({
        code: "event_not_found",
        message: "The event for this link no longer exists.",
      });
    }

    // Burn one use BEFORE returning data — so a crash mid-read still counts the
    // attempt (fail toward fewer uses, never more).
    await ctx.db.patch(row._id, { usedCount: row.usedCount + 1 });

    // INVARIANT #4 — owner resolved SERVER-SIDE from the binding; the consume
    // args never carried an owner key. Read ONLY this event's notes for the
    // bound session, READ-ONLY, BOUND at MAX_HANDOFF_NOTES. The by_owner_event
    // index requires the EXACT ownerKey — which is exactly why boundOwnerKey
    // holds the raw session id (a hash can't drive this read).
    const rows = await ctx.db
      .query("userNotes")
      .withIndex("by_owner_event", (q: any) =>
        q.eq("ownerKey", row.boundOwnerKey).eq("eventId", row.eventId),
      )
      .take(MAX_HANDOFF_NOTES + 1);
    const truncated = rows.length > MAX_HANDOFF_NOTES;
    const limited = rows.slice(0, MAX_HANDOFF_NOTES);

    // Project to a read-only, public-to-the-owner-only shape. NEVER include
    // ownerKey / boundOwnerKey / the token. Sort newest-first deterministically.
    const notes: HandoffNote[] = limited
      .map((n: any) => ({
        noteId: String(n._id),
        title: n.title,
        bodyHtml: n.bodyHtml,
        tags: Array.isArray(n.tags) ? n.tags : [],
        pinned: !!n.pinned,
        isAsk: !!n.isAsk,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);

    return {
      eventName: event.name,
      eventSlug: event.slug,
      roomCode: event.roomCode,
      scope: "private_notes_read" as const,
      noteCount: notes.length,
      notes,
      _truncated: truncated,
    };
  },
});

/**
 * JANITOR — evict expired handoff token rows. Called by a cron (mirrors
 * scratchnodeRateLimit:_evictStaleRateLimits). BOUND at MAX_HANDOFF_TOKEN_EVICT
 * per sweep via the by_expiresAt range; never a full scan.
 */
export const _evictExpiredHandoffTokens = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query("liveEventHandoffTokens")
      .withIndex("by_expiresAt", (q: any) => q.lt("expiresAt", now))
      .take(MAX_HANDOFF_TOKEN_EVICT);
    for (const r of stale) {
      await ctx.db.delete(r._id);
    }
    return { evicted: stale.length };
  },
});
