/**
 * Cross-domain ScratchNode → NodeBench PRIVATE-NOTES handoff (roadmap #4).
 *
 * A guest's private notes are owner-keyed by their `sn_session_id`, which lives
 * in scratchnode.live's localStorage and is origin-partitioned — nodebenchai.com
 * cannot read it. Shipping that session id across the origin boundary would leak
 * a PERMANENT credential (it doubles as the notes owner key, and the notes layer
 * has no auth check) into the URL, referer, and logs. So instead:
 *
 *   mint  (scratchnode side): verify the caller is a MEMBER of this event with
 *         this session, then snapshot that member's private notes for THIS event
 *         into an opaque token row. Return ONLY a random opaque token.
 *   travel: only the opaque token is in the `/events/<slug>/private?token=…` URL.
 *   consume (nodebench side): fail-closed verify the token, return the read-only
 *         snapshot. The raw session id is NEVER stored, returned, or logged.
 *
 * Security invariants (the roadmap's #1 risk is leaking a permanent credential):
 *  - token = CSPRNG (crypto.getRandomValues), not derivable from the session id.
 *  - membership-checked at mint (liveEventMembers by_event_session).
 *  - we store a SNAPSHOT, not the session id → a table dump yields no credential
 *    and no cross-event access, only this event's notes, briefly.
 *  - event-scoped (`scope`/`eventId`), short TTL, few-use; consume is fail-closed.
 *
 * Pattern/prior art: opaque-stateful bearer token (cf. OAuth handoff codes);
 * crypto mirrors the host-token helpers in convex/events.ts.
 * See: docs deferred — AGENT_COORDINATION.md (incident note), .claude/rules/feedback_security.md.
 */
import { mutation } from "./_generated/server";
import { v } from "convex/values";

// This Convex version does not export `ConvexError` from "convex/values" (CI tsc
// catches it even though some local resolutions don't), so mirror the local class
// convex/events.ts defines — a thrown error still carries a typed `data.code`.
class ConvexError<T extends Record<string, unknown>> extends Error {
  data: T;
  constructor(data: T) {
    super(String(data.message ?? JSON.stringify(data)));
    this.name = "ConvexError";
    this.data = data;
    (this as Record<PropertyKey, unknown>)[Symbol.for("ConvexError")] = true;
  }
}

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes — short by design
const TOKEN_MAX_USES = 10; // tolerate retries / React strict-mode double-call, still bounded
const TOKEN_LEN = 43; // ~256 bits over a 64-char alphabet
const MAX_SNAPSHOT_NOTES = 100; // BOUND
const MAX_NOTE_BODY = 8000; // BOUND_READ per note body
const MIN_SESSION_LEN = 8;
const MAX_SESSION_LEN = 200;

// 64-char URL-safe alphabet → `byte % 64` is bias-free (256 % 64 === 0).
const TOKEN_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function randomToken(): string {
  const buf = new Uint8Array(TOKEN_LEN);
  (globalThis as any).crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < TOKEN_LEN; i += 1) {
    out += TOKEN_ALPHABET.charAt(buf[i] % TOKEN_ALPHABET.length);
  }
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await (globalThis as any).crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function resolveEvent(ctx: any, slug: string) {
  const clean = String(slug || "").trim().toLowerCase();
  if (!clean || clean.length > 120) return null;
  const bySlug = await ctx.db
    .query("liveEvents")
    .withIndex("by_slug", (q: any) => q.eq("slug", clean))
    .first();
  if (bySlug) return bySlug;
  const code = clean.toUpperCase();
  return await ctx.db
    .query("liveEvents")
    .withIndex("by_roomCode", (q: any) => q.eq("roomCode", code))
    .first();
}

/**
 * mintEventHandoffToken — called from the ScratchNode room (home-v5.html) by the
 * member who wants to continue their private notes in NodeBench. Membership-gated.
 */
export const mintEventHandoffToken = mutation({
  args: { slug: v.string(), sessionId: v.string() },
  handler: async (ctx, { slug, sessionId }) => {
    if (!sessionId || sessionId.length < MIN_SESSION_LEN || sessionId.length > MAX_SESSION_LEN) {
      throw new ConvexError({ code: "invalid_session", message: "A valid session is required." });
    }
    const event = await resolveEvent(ctx, slug);
    if (!event) {
      throw new ConvexError({ code: "event_not_found", message: "Event not found." });
    }

    // MEMBERSHIP GATE — only a verified member of THIS event with THIS session may
    // mint a handoff of their OWN notes. Non-members get nothing (fail-closed).
    const member = await ctx.db
      .query("liveEventMembers")
      .withIndex("by_event_session", (q: any) =>
        q.eq("eventId", event._id).eq("sessionId", sessionId),
      )
      .first();
    if (!member) {
      throw new ConvexError({ code: "not_a_member", message: "Join the event before continuing in NodeBench." });
    }

    const now = Date.now();
    // One-way binding for audit/dedup — never the raw session id, and salted with
    // the eventId so the same session across events is not linkable from the hash.
    const boundSessionHash = await sha256Hex(`${sessionId}|${String(event._id)}`);

    // Snapshot THIS member's private notes for THIS event (membership proven).
    // Bounded; bodies capped. This is the only data the token ever exposes.
    const noteRows = await ctx.db
      .query("userNotes")
      .withIndex("by_owner_event", (q: any) =>
        q.eq("ownerKey", sessionId).eq("eventId", event._id),
      )
      .take(MAX_SNAPSHOT_NOTES);
    const notesSnapshot = noteRows.map((n: any) => ({
      title: String(n.title || "").slice(0, 300),
      bodyHtml: String(n.bodyHtml || "").slice(0, MAX_NOTE_BODY),
      pinned: !!n.pinned,
      updatedAt: typeof n.updatedAt === "number" ? n.updatedAt : now,
    }));

    // Idempotent-ish: refresh an existing unexpired token for this (event,session)
    // instead of spamming the table on repeat handoffs.
    const existing = await ctx.db
      .query("liveEventHandoffTokens")
      .withIndex("by_event_session", (q: any) =>
        q.eq("eventId", event._id).eq("boundSessionHash", boundSessionHash),
      )
      .order("desc")
      .first();
    if (existing && existing.expiresAt > now && existing.usedCount < existing.maxUses) {
      await ctx.db.patch(existing._id, {
        notesSnapshot,
        noteCount: notesSnapshot.length,
        expiresAt: now + TOKEN_TTL_MS,
      });
      return { ok: true as const, token: existing.token, expiresAt: now + TOKEN_TTL_MS, noteCount: notesSnapshot.length };
    }

    const token = randomToken();
    await ctx.db.insert("liveEventHandoffTokens", {
      token,
      eventId: event._id,
      eventSlug: event.slug,
      eventName: event.name,
      scope: "private_notes_read" as const,
      notesSnapshot,
      noteCount: notesSnapshot.length,
      boundSessionHash,
      createdAt: now,
      expiresAt: now + TOKEN_TTL_MS,
      usedCount: 0,
      maxUses: TOKEN_MAX_USES,
    });
    return { ok: true as const, token, expiresAt: now + TOKEN_TTL_MS, noteCount: notesSnapshot.length };
  },
});

/**
 * consumeEventHandoffToken — called from the NodeBench `/events/<slug>/private`
 * receiving surface. Fail-closed on every check; returns ONLY the read-only
 * snapshot + event label. Never the session id, the hash, or the token.
 */
export const consumeEventHandoffToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const clean = String(token || "").trim();
    if (!clean || clean.length < 16 || clean.length > 200) {
      return { ok: false as const, reason: "invalid" as const };
    }
    const row = await ctx.db
      .query("liveEventHandoffTokens")
      .withIndex("by_token", (q: any) => q.eq("token", clean))
      .first();
    const now = Date.now();
    if (!row || row.scope !== "private_notes_read") return { ok: false as const, reason: "invalid" as const };
    if (row.expiresAt <= now) return { ok: false as const, reason: "expired" as const };
    if (row.usedCount >= row.maxUses) return { ok: false as const, reason: "used_up" as const };

    await ctx.db.patch(row._id, { usedCount: row.usedCount + 1 });
    return {
      ok: true as const,
      eventName: row.eventName,
      eventSlug: row.eventSlug,
      noteCount: row.noteCount,
      notes: row.notesSnapshot,
    };
  },
});
