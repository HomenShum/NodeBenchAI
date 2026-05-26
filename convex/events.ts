/**
 * convex/events.ts — Phase 1 of the scratchnode.live live prod plan
 *
 * Anonymous shared chat for event rooms. No auth — visitors send a
 * `sessionId` from `localStorage` and that's their identity.
 *
 * Public API surface (called from public/proto/home-v5.html):
 *   - getEventBySlug({ slug })
 *   - getMessages({ eventId, limit? })            // realtime subscription
 *   - getMembers({ eventId })                     // realtime subscription
 *   - joinEvent({ slug, sessionId, displayName }) // returns { eventId, ... }
 *   - sendMessage({ eventId, sessionId, displayName, text, kind, replyToMessageId? })
 *   - heartbeat({ eventId, sessionId })
 *   - ensureDemoEvent()                            // seeds ai-infra-summit-2026 if missing
 *
 * Privacy invariants (release-blocker, per docs.html):
 *   - This file only handles PUBLIC chat. Private notes will be a separate
 *     table (Phase 3). Never accept a "kind: private" here.
 *   - displayName is snapshotted at send time — renames don't rewrite history.
 *
 * Reliability (per .claude/rules/agentic_reliability.md):
 *   - BOUND: getMessages limit defaults to 200, max 500
 *   - HONEST_STATUS: throws ConvexError on missing event, no fake 200
 *   - TIMEOUT: Convex functions have a 1s mutation / 10s query budget by default
 */

import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";

class ConvexError<T extends Record<string, unknown>> extends Error {
  data: T;

  constructor(data: T) {
    super(String(data.message ?? JSON.stringify(data)));
    this.name = "ConvexError";
    this.data = data;
    (this as Record<PropertyKey, unknown>)[Symbol.for("ConvexError")] = true;
  }
}

// ─── Constants ────────────────────────────────────────────────────────────
const MAX_DISPLAY_NAME = 40;
const MAX_MESSAGE_TEXT = 4000;
const DEFAULT_MESSAGE_LIMIT = 200;
const MAX_MESSAGE_LIMIT = 500;
const PRESENCE_TTL_MS = 5 * 60 * 1000; // 5 min
const MAX_SOURCE_BODY = 12_000;
const MAX_ANSWER_BODY = 4_000;
const MAX_ANSWER_LIMIT = 100;
const MAX_WIKI_ANSWERS = 20;

const DEMO_SOURCES = [
  {
    uri: "transcript://ai-infra-summit-2026/mcp-auth-panel",
    kind: "transcript" as const,
    title: "MCP auth panel transcript",
    excerpt: "Panelists agreed that scoped credentials, audit trails, and revocation UX are the gating items for enterprise MCP adoption.",
    body: "MCP auth timeline: teams are moving from static API keys toward scoped, revocable credentials, delegated OAuth-style flows, and visible audit trails. The key adoption concern is not tool count, it is whether every agent action can be traced to a person, policy, source, and approval state. Enterprise buyers asked for admin dashboards, session revocation, and least-privilege tool profiles before broad rollout.",
  },
  {
    uri: "doc://ai-infra-summit-2026/voice-agent-eval-notes",
    kind: "doc" as const,
    title: "Voice-agent evaluation notes",
    excerpt: "Voice agents need evaluation on latency, interruption handling, hallucinated actions, and handoff quality, not only transcript accuracy.",
    body: "Voice-agent evaluation: attendees compared latency, barge-in handling, transcription quality, hallucinated tool calls, escalation to humans, and post-call summary faithfulness. The strongest recurring point was that voice agents fail in edge cases where a user interrupts, changes intent, or asks for an action that needs approval.",
  },
  {
    uri: "slide://ai-infra-summit-2026/healthcare-pilots",
    kind: "slide" as const,
    title: "Healthcare workflow pilot slide",
    excerpt: "Healthcare pilots clustered around intake, clinical note preparation, payer admin, and compliance-heavy review workflows.",
    body: "Healthcare pilots: the session separated low-risk workflow automation from clinical decision support. Good first deployments include intake routing, clinical note preparation, prior-authorization packet assembly, and quality review. Buyers asked for HIPAA boundaries, source retention, and human approval before any patient-impacting write.",
  },
  {
    uri: "url://ai-infra-summit-2026/orbital-labs-demo",
    kind: "url" as const,
    title: "Orbital Labs demo brief",
    excerpt: "Orbital Labs positioned its eval layer as a way to compare agent behavior across tools, memories, and approval policies.",
    body: "Orbital Labs demo: the company framed agent evaluation as a runtime problem across tools, memory, policies, and approvals. The team showed comparison dashboards for tool-call failure, answer grounding, and human correction loops. The market implication is that eval moves closer to operations and workflow governance.",
  },
  {
    uri: "doc://ai-infra-summit-2026/event-wiki-policy",
    kind: "doc" as const,
    title: "Event wiki privacy policy",
    excerpt: "Public wiki compaction may use public chat, public answers, and host-uploaded sources, but never private attendee notes.",
    body: "Event wiki policy: only public chat messages, public sourced answers, host-uploaded sources, and host-promoted FAQ entries may enter the durable wiki. Private notes, private asks, and attendee-local drafts are excluded from compaction and from answer caches. The trace should explicitly say when private notes were not used.",
  },
];

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const normalizeQuestion = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);

const tokenize = (value: string) =>
  new Set(normalizeQuestion(value).split(" ").filter((token) => token.length > 2));

const scoreSource = (question: string, source: { title: string; excerpt: string; body: string }) => {
  const qTokens = tokenize(question);
  const haystack = tokenize(`${source.title} ${source.excerpt} ${source.body}`);
  let overlap = 0;
  for (const token of qTokens) {
    if (haystack.has(token)) overlap += 1;
  }
  return overlap + (source.title.toLowerCase().includes(question.toLowerCase()) ? 3 : 0);
};

const requireOwnerKey = (ownerKey: string) => {
  if (!ownerKey || ownerKey.length < 8 || ownerKey.length > 80) {
    throw new ConvexError({
      code: "invalid_owner_key",
      message: "ownerKey must be 8-80 chars.",
    });
  }
};

const ensureDemoSourcesForEvent = async (ctx: any, eventId: any) => {
  const now = Date.now();
  let inserted = 0;
  for (const source of DEMO_SOURCES) {
    const existing = await ctx.db
      .query("liveEventSources")
      .withIndex("by_event_uri", (q: any) => q.eq("eventId", eventId).eq("uri", source.uri))
      .first();
    if (existing) continue;
    await ctx.db.insert("liveEventSources", {
      eventId,
      uri: source.uri,
      kind: source.kind,
      title: source.title,
      excerpt: source.excerpt,
      body: source.body.slice(0, MAX_SOURCE_BODY),
      sourceHash: stableHash(`${source.uri}|${source.body}`),
      isSeeded: true,
      uploadedAt: now,
    });
    inserted += 1;
  }
  return inserted;
};

const requireMember = async (ctx: any, eventId: any, sessionId: string) => {
  if (!sessionId || sessionId.length < 8) {
    throw new ConvexError({
      code: "invalid_session",
      message: "Must join the event first.",
    });
  }
  const member = await ctx.db
    .query("liveEventMembers")
    .withIndex("by_event_session", (q: any) =>
      q.eq("eventId", eventId).eq("sessionId", sessionId),
    )
    .first();
  if (!member) {
    throw new ConvexError({
      code: "not_joined",
      message: "Call joinEvent before using this event.",
    });
  }
  return member;
};

const requireHost = async (ctx: any, eventId: any, ownerKey: string) => {
  requireOwnerKey(ownerKey);
  const host = await ctx.db
    .query("liveEventHosts")
    .withIndex("by_event_owner", (q: any) => q.eq("eventId", eventId).eq("ownerKey", ownerKey))
    .first();
  if (!host) {
    throw new ConvexError({
      code: "not_host",
      message: "Host ownership is required for this action.",
    });
  }
  return host;
};

// ─── QUERIES ──────────────────────────────────────────────────────────────

/**
 * Fetch an event by its slug. Returns null if missing — callers (UI) should
 * fall back to the demo event flow.
 */
export const getEventBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    if (!slug || slug.length > 120) return null;
    const event = await ctx.db
      .query("liveEvents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    return event;
  },
});

/**
 * Realtime message stream. The Convex client re-runs this on every change.
 * Ordered ascending by createdAt so the latest is last (matches UI append order).
 */
export const getMessages = query({
  args: {
    eventId: v.id("liveEvents"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { eventId, limit }) => {
    const safeLimit = Math.min(Math.max(limit ?? DEFAULT_MESSAGE_LIMIT, 1), MAX_MESSAGE_LIMIT);
    const rows = await ctx.db
      .query("liveEventMessages")
      .withIndex("by_event_time", (q) => q.eq("eventId", eventId))
      .order("desc")
      .take(safeLimit);
    return rows.reverse(); // ascending for UI
  },
});

/**
 * Active members — only those with a lastSeenAt within the presence TTL window.
 * Stale rows are evicted by the janitor cron (see convex/crons.ts).
 */
export const getMembers = query({
  args: { eventId: v.id("liveEvents") },
  handler: async (ctx, { eventId }) => {
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    const all = await ctx.db
      .query("liveEventMembers")
      .withIndex("by_event_lastSeen", (q) =>
        q.eq("eventId", eventId).gte("lastSeenAt", cutoff),
      )
      .collect();
    return all;
  },
});

// ─── MUTATIONS ────────────────────────────────────────────────────────────

/**
 * Idempotent join: upsert liveEventMembers by (eventId, sessionId).
 * Auto-creates the demo event on first call if missing.
 */
export const joinEvent = mutation({
  args: {
    slug: v.string(),
    sessionId: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, { slug, sessionId, displayName }) => {
    if (!slug || slug.length > 120) {
      throw new ConvexError({ code: "invalid_slug", message: "Bad event slug." });
    }
    if (!sessionId || sessionId.length < 8 || sessionId.length > 64) {
      throw new ConvexError({
        code: "invalid_session",
        message: "sessionId must be a 8-64 char UUID-like string.",
      });
    }
    const safeName = (displayName || "Anonymous Guest").slice(0, MAX_DISPLAY_NAME).trim()
      || "Anonymous Guest";

    let event = await ctx.db
      .query("liveEvents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();

    // Auto-seed the demo event so the first visitor to scratchnode.live
    // doesn't hit an empty room.
    if (!event && slug === "ai-infra-summit-2026") {
      const id = await ctx.db.insert("liveEvents", {
        slug: "ai-infra-summit-2026",
        name: "AI Infra Summit",
        roomCode: "ORBITAL",
        status: "live",
        startedAt: Date.now(),
      });
      event = await ctx.db.get(id);
    }
    if (!event) {
      throw new ConvexError({ code: "event_not_found", message: "No such event slug." });
    }
    if (event.slug === "ai-infra-summit-2026") {
      await ensureDemoSourcesForEvent(ctx, event._id);
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("liveEventMembers")
      .withIndex("by_event_session", (q) =>
        q.eq("eventId", event._id).eq("sessionId", sessionId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { lastSeenAt: now, displayName: safeName });
    } else {
      await ctx.db.insert("liveEventMembers", {
        eventId: event._id,
        sessionId,
        displayName: safeName,
        joinedAt: now,
        lastSeenAt: now,
      });
    }

    return {
      eventId: event._id,
      slug: event.slug,
      name: event.name,
      roomCode: event.roomCode,
      status: event.status,
    };
  },
});

/**
 * Post a public message to the event feed. Three kinds:
 *   - "chat": normal user message
 *   - "ask":  /ask invocation; Phase 2 will trigger the agent action.
 *             Phase 1 just stores the row so the UI can show it.
 *   - "system": joins/leaves/mod notes (Phase 4 hosts only)
 *
 * Private mode NEVER hits this function — see convex/notes.ts (Phase 3).
 */
export const sendMessage = mutation({
  args: {
    eventId: v.id("liveEvents"),
    sessionId: v.string(),
    displayName: v.string(),
    text: v.string(),
    kind: v.union(v.literal("chat"), v.literal("ask"), v.literal("system")),
    replyToMessageId: v.optional(v.id("liveEventMessages")),
  },
  handler: async (ctx, args) => {
    const text = (args.text || "").trim();
    if (!text) {
      throw new ConvexError({ code: "empty_message", message: "Message text required." });
    }
    if (text.length > MAX_MESSAGE_TEXT) {
      throw new ConvexError({
        code: "message_too_long",
        message: `Max ${MAX_MESSAGE_TEXT} chars.`,
      });
    }
    if (!args.sessionId || args.sessionId.length < 8) {
      throw new ConvexError({
        code: "invalid_session",
        message: "Must join the event before sending.",
      });
    }

    const event = await ctx.db.get(args.eventId);
    if (!event) {
      throw new ConvexError({ code: "event_not_found", message: "Event no longer exists." });
    }
    if (event.status === "ended") {
      throw new ConvexError({
        code: "event_ended",
        message: "This event has ended.",
      });
    }

    // Verify the sender is a member (presence row exists) — prevents drive-by sends.
    const member = await ctx.db
      .query("liveEventMembers")
      .withIndex("by_event_session", (q) =>
        q.eq("eventId", args.eventId).eq("sessionId", args.sessionId),
      )
      .first();
    if (!member) {
      throw new ConvexError({
        code: "not_joined",
        message: "Call joinEvent before sendMessage.",
      });
    }

    // Display name snapshot — prefer client-provided (typo fix), fall back to member.
    const safeName = (args.displayName || member.displayName || "Anonymous Guest")
      .slice(0, MAX_DISPLAY_NAME)
      .trim() || "Anonymous Guest";

    const now = Date.now();
    const messageId = await ctx.db.insert("liveEventMessages", {
      eventId: args.eventId,
      sessionId: args.sessionId,
      displayName: safeName,
      text,
      kind: args.kind,
      replyToMessageId: args.replyToMessageId,
      createdAt: now,
    });

    // Bump presence as a side effect of sending (saves a heartbeat round trip).
    await ctx.db.patch(member._id, { lastSeenAt: now });

    return { messageId, createdAt: now };
  },
});

/**
 * Cheap presence heartbeat. UI calls this every 30s. Idempotent — early-returns
 * if lastSeenAt was bumped within the last 15s (rate-limits accidental spam).
 */
export const heartbeat = mutation({
  args: {
    eventId: v.id("liveEvents"),
    sessionId: v.string(),
  },
  handler: async (ctx, { eventId, sessionId }) => {
    const member = await ctx.db
      .query("liveEventMembers")
      .withIndex("by_event_session", (q) =>
        q.eq("eventId", eventId).eq("sessionId", sessionId),
      )
      .first();
    if (!member) {
      // Not joined — caller should call joinEvent. Return false so UI can react.
      return { ok: false, reason: "not_joined" };
    }
    const now = Date.now();
    if (now - member.lastSeenAt < 15_000) {
      return { ok: true, skipped: true };
    }
    await ctx.db.patch(member._id, { lastSeenAt: now });
    return { ok: true, skipped: false };
  },
});

/**
 * Idempotent seed for the demo event. Safe to call repeatedly; only inserts
 * if the slug isn't already present. Used by the dev/admin tooling — not
 * called automatically by joinEvent for non-demo slugs.
 */
export const ensureDemoEvent = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("liveEvents")
      .withIndex("by_slug", (q) => q.eq("slug", "ai-infra-summit-2026"))
      .first();
    if (existing) return { eventId: existing._id, created: false };
    const id = await ctx.db.insert("liveEvents", {
      slug: "ai-infra-summit-2026",
      name: "AI Infra Summit",
      roomCode: "ORBITAL",
      status: "live",
      startedAt: Date.now(),
    });
    const sourcesInserted = await ensureDemoSourcesForEvent(ctx, id);
    return { eventId: id, created: true, sourcesInserted };
  },
});

// ─── INTERNAL: presence janitor (called from crons.ts) ──────────────────

/**
 * Internal cron handler — deletes liveEventMembers rows whose lastSeenAt is
 * older than the presence TTL. Bounded delete: max 500 per run to avoid
 * blowing the mutation budget when an event ends with many attendees.
 */
export const _evictStalePresence = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    // Scan all events' stale rows (no by-event narrowing — janitor is global).
    // Index by_event_lastSeen lets us at least range-scan within each event,
    // but Convex doesn't support index-less full scans cheaply. For Phase 1
    // this is acceptable: usually <10 active events at once.
    const stale = await ctx.db
      .query("liveEventMembers")
      .filter((q) => q.lt(q.field("lastSeenAt"), cutoff))
      .take(500);
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
    return { evicted: stale.length };
  },
});
