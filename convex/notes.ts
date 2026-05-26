/**
 * convex/notes.ts — Phase 3 of the scratchnode.live live prod plan
 *
 * Private notes per anonymous session. Replaces the prototype's
 * window._notes_v5 localStorage store.
 *
 * Security model (release-blocker invariant per docs.html):
 *   - ownerKey is passed by the client and MUST be validated server-side
 *     on every read/write. Without this, anyone could read anyone's notes
 *     by guessing sessionIds. Phase 1 generates UUIDv4 sessionIds (122
 *     bits of entropy) so brute-force enumeration is infeasible — but the
 *     server still must filter strictly.
 *   - For Phase 3 (anonymous), ownerKey === sessionId.
 *   - Phase 4 (auth'd users) will use ownerKey = "user:<userId>" and
 *     migrate session-scoped notes via a one-time merge mutation.
 *
 * Privacy invariants (release-blocker):
 *   - Private notes NEVER feed the public event wiki (Phase 5 compaction
 *     reads from liveEventAnswers + promoted FAQ, not from userNotes).
 *   - Sending a private note never appends to liveEventMessages — that
 *     code path lives in convex/events.ts and is unaware of this table.
 *
 * Reliability (per .claude/rules/agentic_reliability.md):
 *   - BOUND: list returns capped at 500 notes per query
 *   - HONEST_STATUS: throws ConvexError on ownerKey mismatch — never silent
 *   - DETERMINISTIC: createdAt/updatedAt are server-generated; client can't fake history
 */

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

class ConvexError<T extends Record<string, unknown>> extends Error {
  data: T;

  constructor(data: T) {
    super(String(data.message ?? JSON.stringify(data)));
    this.name = "ConvexError";
    this.data = data;
    (this as Record<PropertyKey, unknown>)[Symbol.for("ConvexError")] = true;
  }
}

const MAX_TITLE = 200;
const MAX_BODY = 100_000;                  // 100K HTML chars — generous for rich text
const MAX_TAGS = 20;
const MAX_TAG_LEN = 40;
const MAX_NOTES_PER_QUERY = 500;
const MIN_OWNER_KEY_LEN = 8;
const MAX_OWNER_KEY_LEN = 80;             // accommodates "user:<convexId>" form

const validateOwnerKey = (ownerKey: string) => {
  if (!ownerKey || ownerKey.length < MIN_OWNER_KEY_LEN || ownerKey.length > MAX_OWNER_KEY_LEN) {
    throw new ConvexError({
      code: "invalid_owner_key",
      message: `ownerKey must be ${MIN_OWNER_KEY_LEN}-${MAX_OWNER_KEY_LEN} chars.`,
    });
  }
};

const sanitizeTags = (tags: string[]) => {
  return (tags || [])
    .filter((t) => typeof t === "string" && t.length > 0 && t.length <= MAX_TAG_LEN)
    .slice(0, MAX_TAGS)
    .map((t) => t.toLowerCase().trim());
};

// ─── QUERIES ──────────────────────────────────────────────────────────────

/**
 * List notes belonging to ownerKey. Scoped by eventId if provided.
 * Realtime subscription — Convex re-runs on every change to ownerKey's notes.
 */
export const listMyNotes = query({
  args: {
    ownerKey: v.string(),
    eventId: v.optional(v.id("liveEvents")),
  },
  handler: async (ctx, { ownerKey, eventId }) => {
    validateOwnerKey(ownerKey);
    const rows = await ctx.db
      .query("userNotes")
      .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .take(MAX_NOTES_PER_QUERY);
    // Optional event filter is applied client-side after the indexed read
    // — keeps the index lean and avoids a multi-index split.
    return eventId ? rows.filter((r) => r.eventId === eventId) : rows;
  },
});

/**
 * Fetch a single note by id, but ONLY if the requestor owns it.
 * Returns null when not found OR not owned (deliberately indistinguishable
 * to prevent existence enumeration).
 */
export const getNote = query({
  args: {
    ownerKey: v.string(),
    noteId: v.id("userNotes"),
  },
  handler: async (ctx, { ownerKey, noteId }) => {
    validateOwnerKey(ownerKey);
    const note = await ctx.db.get(noteId);
    if (!note || note.ownerKey !== ownerKey) return null;
    return note;
  },
});

// ─── MUTATIONS ────────────────────────────────────────────────────────────

/**
 * Create a new note. Server-generated timestamps; client can't backdate.
 */
export const createNote = mutation({
  args: {
    ownerKey: v.string(),
    eventId: v.optional(v.id("liveEvents")),
    title: v.string(),
    bodyHtml: v.string(),
    tags: v.optional(v.array(v.string())),
    isAsk: v.optional(v.boolean()),
    pinned: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    validateOwnerKey(args.ownerKey);
    const title = (args.title || "").slice(0, MAX_TITLE).trim() || "Untitled";
    const bodyHtml = (args.bodyHtml || "").slice(0, MAX_BODY);
    const tags = sanitizeTags(args.tags || []);
    const now = Date.now();
    const id = await ctx.db.insert("userNotes", {
      ownerKey: args.ownerKey,
      eventId: args.eventId,
      title,
      bodyHtml,
      tags,
      pinned: !!args.pinned,
      isAsk: !!args.isAsk,
      createdAt: now,
      updatedAt: now,
    });
    return { noteId: id, createdAt: now };
  },
});

/**
 * Update an existing note. ownerKey must match the note's ownerKey.
 * Only title / bodyHtml / tags / pinned can change — createdAt/eventId/isAsk
 * are immutable post-create.
 */
export const updateNote = mutation({
  args: {
    ownerKey: v.string(),
    noteId: v.id("userNotes"),
    title: v.optional(v.string()),
    bodyHtml: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    pinned: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    validateOwnerKey(args.ownerKey);
    const note = await ctx.db.get(args.noteId);
    if (!note) {
      throw new ConvexError({ code: "note_not_found", message: "Note no longer exists." });
    }
    if (note.ownerKey !== args.ownerKey) {
      throw new ConvexError({
        code: "not_owner",
        message: "You don't own this note.",
      });
    }
    const patch: Record<string, any> = { updatedAt: Date.now() };
    if (typeof args.title === "string") patch.title = args.title.slice(0, MAX_TITLE).trim() || "Untitled";
    if (typeof args.bodyHtml === "string") patch.bodyHtml = args.bodyHtml.slice(0, MAX_BODY);
    if (Array.isArray(args.tags)) patch.tags = sanitizeTags(args.tags);
    if (typeof args.pinned === "boolean") patch.pinned = args.pinned;
    await ctx.db.patch(args.noteId, patch);
    return { ok: true, updatedAt: patch.updatedAt };
  },
});

/**
 * Toggle pinned. Convenience wrapper — saves a round trip vs updateNote.
 */
export const togglePin = mutation({
  args: {
    ownerKey: v.string(),
    noteId: v.id("userNotes"),
  },
  handler: async (ctx, { ownerKey, noteId }) => {
    validateOwnerKey(ownerKey);
    const note = await ctx.db.get(noteId);
    if (!note || note.ownerKey !== ownerKey) {
      throw new ConvexError({ code: "not_owner", message: "Note not found or not owned." });
    }
    await ctx.db.patch(noteId, { pinned: !note.pinned, updatedAt: Date.now() });
    return { pinned: !note.pinned };
  },
});

/**
 * Permanent delete. ownerKey gated.
 */
export const deleteNote = mutation({
  args: {
    ownerKey: v.string(),
    noteId: v.id("userNotes"),
  },
  handler: async (ctx, { ownerKey, noteId }) => {
    validateOwnerKey(ownerKey);
    const note = await ctx.db.get(noteId);
    if (!note) return { ok: true, alreadyGone: true };
    if (note.ownerKey !== ownerKey) {
      throw new ConvexError({ code: "not_owner", message: "You don't own this note." });
    }
    await ctx.db.delete(noteId);
    return { ok: true };
  },
});

/**
 * Phase 4 prep — migrate session-scoped notes to a user account on sign-in.
 * Called once after the JWT exchange returns the userId. Idempotent: re-running
 * with the same (oldOwnerKey, newOwnerKey) is a no-op after the first call.
 */
export const migrateOwnerKey = mutation({
  args: {
    oldOwnerKey: v.string(),                            // e.g. session UUID
    newOwnerKey: v.string(),                            // e.g. "user:<convexId>"
  },
  handler: async (ctx, { oldOwnerKey, newOwnerKey }) => {
    validateOwnerKey(oldOwnerKey);
    validateOwnerKey(newOwnerKey);
    if (oldOwnerKey === newOwnerKey) return { migrated: 0 };
    const rows = await ctx.db
      .query("userNotes")
      .withIndex("by_owner_updated", (q) => q.eq("ownerKey", oldOwnerKey))
      .take(MAX_NOTES_PER_QUERY);
    for (const row of rows) {
      await ctx.db.patch(row._id, { ownerKey: newOwnerKey });
    }
    return { migrated: rows.length };
  },
});
