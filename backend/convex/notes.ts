/**
 * convex/notes.ts — Phase 3 of the scratchnode.live live prod plan
 *   (+ Phase 5 follow-up: private note anchors — link a note to a
 *    specific public chat message or public /ask answer)
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
const MAX_ANCHOR_ID = 200;
const MAX_ANCHOR_LABEL = 160;
const MAX_ANCHOR_PREVIEW = 240;

const anchorTypeValidator = v.union(
  v.literal("message"),
  v.literal("thread"),
  v.literal("time_range"),
  v.literal("answer"),
  v.literal("entity"),
  v.literal("event"),
);

type PrivateNoteAnchorType = "message" | "thread" | "time_range" | "answer" | "entity" | "event";

const sanitizeAnchor = (args: {
  anchorType?: PrivateNoteAnchorType;
  anchorId?: string;
  anchorLabel?: string;
  anchorPreview?: string;
  startTs?: number;
  endTs?: number;
}) => {
  if (!args.anchorType) return {};
  const anchorId = typeof args.anchorId === "string" ? args.anchorId.trim().slice(0, MAX_ANCHOR_ID) : undefined;
  if (args.anchorType !== "time_range" && !anchorId) {
    throw new ConvexError({
      code: "invalid_anchor",
      message: "Private note anchors require anchorId unless anchorType is time_range.",
    });
  }
  if (args.anchorType === "time_range") {
    const startTs = Number(args.startTs);
    const endTs = Number(args.endTs);
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs < startTs) {
      throw new ConvexError({
        code: "invalid_anchor",
        message: "time_range anchors require valid startTs and endTs.",
      });
    }
  }
  const anchor: Record<string, string | number> = {
    anchorType: args.anchorType,
  };
  if (anchorId) anchor.anchorId = anchorId;
  if (typeof args.anchorLabel === "string" && args.anchorLabel.trim()) {
    anchor.anchorLabel = args.anchorLabel.trim().slice(0, MAX_ANCHOR_LABEL);
  }
  if (typeof args.anchorPreview === "string" && args.anchorPreview.trim()) {
    anchor.anchorPreview = args.anchorPreview.trim().slice(0, MAX_ANCHOR_PREVIEW);
  }
  if (typeof args.startTs === "number") anchor.startTs = args.startTs;
  if (typeof args.endTs === "number") anchor.endTs = args.endTs;
  return anchor;
};

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
    anchorType: v.optional(anchorTypeValidator),
    anchorId: v.optional(v.string()),
    anchorLabel: v.optional(v.string()),
    anchorPreview: v.optional(v.string()),
    startTs: v.optional(v.number()),
    endTs: v.optional(v.number()),
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
      ...sanitizeAnchor(args),
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
 *
 * Cascade: any liveEventNoteAnchors pointing at this note are deleted
 * inline in the same mutation. Inline (not janitor cron) so the
 * (note, anchors) state is transactionally consistent — a UI render
 * that ran a half-second after deletion can never see a phantom anchor
 * whose noteId returns null.
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
    // Cascade: remove anchors. by_note index keeps this O(anchor-count-for-note),
    // not a table scan.
    const anchors = await ctx.db
      .query("liveEventNoteAnchors")
      .withIndex("by_note", (q) => q.eq("noteId", noteId))
      .take(MAX_NOTES_PER_QUERY);
    let anchorsDeleted = 0;
    for (const anchor of anchors) {
      await ctx.db.delete(anchor._id);
      anchorsDeleted += 1;
    }
    await ctx.db.delete(noteId);
    return { ok: true, anchorsDeleted };
  },
});

// ─── ANCHOR MUTATIONS + QUERIES (Phase 5 follow-up) ────────────────────────
//
// Threat model:
//   T1 — Forged ownership: attacker tries to anchor someone else's note.
//        Mitigated by verifying note.ownerKey === args.ownerKey before insert.
//   T2 — Cross-event leakage: attacker sets eventId=A but targetMessageId
//        belongs to event B. Mitigated by verifying target.eventId === args.eventId.
//   T3 — Existence enumeration: attacker queries "is there an anchor at
//        targetMessageId X?". Mitigated by NOT shipping a by_target_* index
//        — there is no query path from target → anchor. All reads go
//        through (ownerKey, eventId).
//   T4 — Dangling anchors: note deleted but anchor survives, leaking that
//        the note ever existed. Mitigated by cascade in deleteNote.
//
// Out of scope for this PR (filed as P1):
//   - targetKind="range" (timestamp window). Will require a window-overlap
//     check at render time and additional schema fields.

const MAX_ANCHORS_PER_QUERY = 500;

/**
 * List anchors owned by ownerKey, scoped to eventId.
 * Used by the v5 prototype to render owner-only pin markers on chat
 * messages and answer cards.
 *
 * BOUND: capped at MAX_ANCHORS_PER_QUERY rows; returns `_truncated: true`
 * inside the wrapper when the cap is hit so the UI can warn the user.
 */
export const listMyAnchors = query({
  args: {
    ownerKey: v.string(),
    eventId: v.id("liveEvents"),
  },
  handler: async (ctx, { ownerKey, eventId }) => {
    validateOwnerKey(ownerKey);
    // Read up to cap+1 so we can honestly report whether more exist.
    const rows = await ctx.db
      .query("liveEventNoteAnchors")
      .withIndex("by_owner_event", (q) =>
        q.eq("ownerKey", ownerKey).eq("eventId", eventId),
      )
      .take(MAX_ANCHORS_PER_QUERY + 1);
    const truncated = rows.length > MAX_ANCHORS_PER_QUERY;
    return {
      anchors: rows.slice(0, MAX_ANCHORS_PER_QUERY),
      _truncated: truncated,
    };
  },
});

/**
 * Create an anchor linking a private note to a public message or answer.
 *
 * Verification order is significant:
 *   1. ownerKey shape (cheap, no DB read)
 *   2. exactly-one-target-set (cheap)
 *   3. note ownership (DB read; biggest privacy leak vector → check early)
 *   4. target existence + cross-event match (DB read; catches typos)
 */
export const createNoteAnchor = mutation({
  args: {
    ownerKey: v.string(),
    noteId: v.id("userNotes"),
    eventId: v.id("liveEvents"),
    targetKind: v.union(v.literal("message"), v.literal("answer")),
    targetMessageId: v.optional(v.id("liveEventMessages")),
    targetAnswerId: v.optional(v.id("liveEventAnswers")),
  },
  handler: async (ctx, args) => {
    validateOwnerKey(args.ownerKey);

    // Exactly one of targetMessageId / targetAnswerId must be set, and it
    // must match targetKind. Reject both states (none-set, both-set).
    const hasMsg = typeof args.targetMessageId === "string" && args.targetMessageId.length > 0;
    const hasAns = typeof args.targetAnswerId === "string" && args.targetAnswerId.length > 0;
    if (hasMsg === hasAns) {
      throw new ConvexError({
        code: "invalid_target",
        message: "Exactly one of targetMessageId / targetAnswerId must be set.",
      });
    }
    if (args.targetKind === "message" && !hasMsg) {
      throw new ConvexError({
        code: "target_kind_mismatch",
        message: 'targetKind="message" requires targetMessageId.',
      });
    }
    if (args.targetKind === "answer" && !hasAns) {
      throw new ConvexError({
        code: "target_kind_mismatch",
        message: 'targetKind="answer" requires targetAnswerId.',
      });
    }

    // Verify note exists AND is owned by this ownerKey. Return-null-on-foreign
    // semantics would let attackers learn "this noteId exists but isn't yours"
    // by trying anchors on stolen ids — throw instead.
    const note = await ctx.db.get(args.noteId);
    if (!note) {
      throw new ConvexError({ code: "note_not_found", message: "Note does not exist." });
    }
    if (note.ownerKey !== args.ownerKey) {
      throw new ConvexError({
        code: "not_owner",
        message: "You don't own this note.",
      });
    }

    // Verify target exists and belongs to args.eventId. Catches typos AND
    // prevents an attacker who knows a foreign event's message id from
    // creating an anchor that would later render against the wrong room.
    if (args.targetKind === "message") {
      const msg = await ctx.db.get(args.targetMessageId!);
      if (!msg) {
        throw new ConvexError({
          code: "target_not_found",
          message: "Target message does not exist.",
        });
      }
      if (msg.eventId !== args.eventId) {
        throw new ConvexError({
          code: "target_event_mismatch",
          message: "Target message belongs to a different event.",
        });
      }
    } else {
      const ans = await ctx.db.get(args.targetAnswerId!);
      if (!ans) {
        throw new ConvexError({
          code: "target_not_found",
          message: "Target answer does not exist.",
        });
      }
      if (ans.eventId !== args.eventId) {
        throw new ConvexError({
          code: "target_event_mismatch",
          message: "Target answer belongs to a different event.",
        });
      }
    }

    const anchorId = await ctx.db.insert("liveEventNoteAnchors", {
      ownerKey: args.ownerKey,
      eventId: args.eventId,
      noteId: args.noteId,
      targetKind: args.targetKind,
      targetMessageId: args.targetMessageId,
      targetAnswerId: args.targetAnswerId,
      createdAt: Date.now(),
    });
    return { ok: true as const, anchorId };
  },
});

/**
 * Delete a single anchor. Owner gated by re-reading the row and matching
 * ownerKey — never trust args.ownerKey to be enough.
 */
export const deleteNoteAnchor = mutation({
  args: {
    ownerKey: v.string(),
    anchorId: v.id("liveEventNoteAnchors"),
  },
  handler: async (ctx, { ownerKey, anchorId }) => {
    validateOwnerKey(ownerKey);
    const anchor = await ctx.db.get(anchorId);
    if (!anchor) return { ok: true as const, alreadyGone: true };
    if (anchor.ownerKey !== ownerKey) {
      throw new ConvexError({
        code: "not_owner",
        message: "You don't own this anchor.",
      });
    }
    await ctx.db.delete(anchorId);
    return { ok: true as const };
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
