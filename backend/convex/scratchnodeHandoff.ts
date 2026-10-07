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
import { query } from "./_generated/server";

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
