/**
 * convex/wall.ts — Phase 8: the spatial "Memory Wall" overlay for live events.
 *
 * The Wall is a SECOND render lane over the SAME event stream the chat feed
 * shows (the "Twitch" model: one stream, two synchronized views). A wall item
 * is layout-only metadata that POINTS at public content:
 *   - pinToWall({ refType:"message"|"answer", ... })  → pins existing content
 *   - createWallNote({ text })                         → a fresh public sticky
 * and is positioned / styled by:
 *   - moveWallItems({ updates:[{id,x,y}] })   ← the ONE write per drag (pointerup)
 *   - recolorWallItem / editWallNote / groupWallItems / ungroupWallItems
 *   - removeWallItems  (unpin / delete sticky — never touches the source content)
 *
 * Read side:
 *   - listWallItems({ eventId })  → realtime subscription (Convex re-runs on change)
 *
 * Public API path: api.wall.<fn> (these are the contracts public/proto/wall.html
 * and home-v5.html call from the browser).
 *
 * Privacy invariant (release-blocker, mirrors convex/events.ts + notes.ts):
 *   The Wall is PUBLIC. It only ever references liveEventMessages /
 *   liveEventAnswers. It NEVER reads or references userNotes (private). A
 *   "note" wall item is public inline text, identical in visibility to a chat
 *   message.
 *
 * Reliability (per .claude/rules/agentic_reliability.md):
 *   - BOUND: listWallItems ≤ MAX_WALL_ITEMS; every id[] mutation ≤ MAX_WALL_BATCH.
 *   - HONEST_STATUS: typed ConvexError on every validation failure, no fake ok.
 *   - HONEST_SCORES: n/a (no scoring here).
 *   - TIMEOUT: Convex's default mutation/query budgets apply.
 *   - SSRF / BOUND_READ: n/a (no external fetch).
 *   - DETERMINISTIC: server-stamped timestamps; groupId derived from min(id).
 *
 * Pattern: FigJam / Miro spatial board + content/layout separation.
 * Prior art:
 *   - FigJam — frames hold widgets; stickies carry position + color only.
 *   - Miro — board items reference content; one delta moves a whole selection.
 *   - tldraw — shape store; we deliberately do NOT adopt its store so Chat and
 *     Wall stay a single source of truth (the canonical event stream).
 * NodeBench-original: the overlay points at the canonical event stream rather
 * than owning a parallel shape store. See public/proto/wall.html for the
 * matching client-side smooth-drag engine.
 */

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { enforceRateLimit } from "./scratchnodeRateLimit";

// Local ConvexError shim — mirrors convex/events.ts and convex/scratchnodeRateLimit.ts
// so the thrown error serializes to the client with `data` intact (code + message).
class ConvexError<T extends Record<string, unknown>> extends Error {
  data: T;

  constructor(data: T) {
    super(String(data.message ?? JSON.stringify(data)));
    this.name = "ConvexError";
    this.data = data;
    (this as Record<PropertyKey, unknown>)[Symbol.for("ConvexError")] = true;
  }
}

// ─── Constants ──────────────────────────────────────────────────────────────
// BOUND — listWallItems hard cap (mirrors getMembers' MAX_ACTIVE_MEMBERS=500).
const MAX_WALL_ITEMS = 500;
// BOUND — max ids/updates accepted by one move/remove/group call. A group of
// 200 stickies is already enormous; anything larger is abuse, rejected honestly.
const MAX_WALL_BATCH = 200;
// A sticky is short by design (it's a wall note, not a document).
const MAX_WALL_NOTE_TEXT = 2_000;
// Position + size clamps — keep the board finite and reject NaN/Infinity, which
// would otherwise serialize into the client's inline transform and break layout.
const MIN_W = 80;
const MAX_W = 1_200;
const COORD_LIMIT = 100_000;
const DEFAULT_W = 180;
// Rate limits. Moves are the high-frequency path (one commit per pointerup);
// other ops (create / pin / recolor / edit / group / delete) are bursty-but-rare.
const WALL_MOVE_LIMIT = 180; // /min ≈ 3 drag-drops/sec sustained — far above human cadence
const WALL_MOVE_WINDOW = 60_000;
const WALL_OP_LIMIT = 60; // /min — create/pin/recolor/edit/group/delete
const WALL_OP_WINDOW = 60_000;

// Palette allowlist — matches public/proto/wall.html COLORS. Validating against
// an allowlist (not just "is a string") keeps arbitrary values out of the
// client's inline `style` — defense-in-depth even though it's only a color slot.
const WALL_COLORS = [
  "#f3d77b",
  "#f5b8c4",
  "#a9d8f0",
  "#bfe3b6",
  "#e7b48f",
  "#d8c9f2",
];

function clampCoord(n: unknown, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, Math.round(n)));
}

function clampW(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_W;
  return Math.max(MIN_W, Math.min(MAX_W, Math.round(n)));
}

function safeColor(c: unknown): string {
  return typeof c === "string" && WALL_COLORS.includes(c) ? c : WALL_COLORS[0];
}

// requireMember — minimal membership gate. Intentionally duplicated from the
// (non-exported) helper in convex/events.ts rather than importing it: keeping
// wall.ts free of an events.ts import avoids coupling the wall to that module's
// action graph, and the gate is 12 lines with identical semantics. If a third
// caller needs it, extract to convex/scratchnodeShared.ts then.
async function requireMember(ctx: any, eventId: any, sessionId: string) {
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
      message: "Call joinEvent before using the wall.",
    });
  }
  return member;
}

// Loads + validates the event is usable for writes. Throws on missing/ended.
async function requireLiveEvent(ctx: any, eventId: any) {
  const event = await ctx.db.get(eventId);
  if (!event) {
    throw new ConvexError({
      code: "event_not_found",
      message: "Event no longer exists.",
    });
  }
  if (event.status === "ended") {
    throw new ConvexError({
      code: "event_ended",
      message: "This event has ended.",
    });
  }
  return event;
}

/* ========================================================================== */
/* Read — realtime subscription                                                */
/* ========================================================================== */

/**
 * Realtime wall snapshot. The Convex client re-runs this on every change, so
 * remote moves/pins/deletes stream into every viewer's board.
 *
 * BOUND at MAX_WALL_ITEMS (mirrors getMembers). A room past 500 pinned items
 * shows the first 500; the UI surfaces a "500+ on the wall" treatment (same
 * precedent as the member roster). Sorted by z ascending so render order
 * matches stacking order.
 */
export const listWallItems = query({
  args: { eventId: v.id("liveEvents") },
  handler: async (ctx, { eventId }) => {
    const rows = await ctx.db
      .query("liveEventWallItems")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .take(MAX_WALL_ITEMS);
    rows.sort((a, b) => (a.z || 0) - (b.z || 0));
    return rows;
  },
});

/* ========================================================================== */
/* Create — pin existing content, or author a fresh sticky                     */
/* ========================================================================== */

/**
 * Pin an existing public message or /ask answer onto the wall.
 *
 * Integrity: the referenced row must EXIST and belong to THIS event — prevents
 * pinning cross-event content or fabricated ids. Idempotent: re-pinning the
 * same content returns the existing item (no duplicate cards), mirroring the
 * reserveAskSlot idempotency pattern.
 */
export const pinToWall = mutation({
  args: {
    eventId: v.id("liveEvents"),
    sessionId: v.string(),
    refType: v.union(v.literal("message"), v.literal("answer")),
    refMessageId: v.optional(v.id("liveEventMessages")),
    refAnswerId: v.optional(v.id("liveEventAnswers")),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    w: v.optional(v.number()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.eventId, args.sessionId);
    await enforceRateLimit(ctx, {
      key: `wall:${args.sessionId}`,
      limit: WALL_OP_LIMIT,
      windowMs: WALL_OP_WINDOW,
    });
    await requireLiveEvent(ctx, args.eventId);

    let refMessageId: any = undefined;
    let refAnswerId: any = undefined;
    let existing: any = null;

    if (args.refType === "message") {
      if (!args.refMessageId) {
        throw new ConvexError({
          code: "missing_ref",
          message: "refMessageId is required for message pins.",
        });
      }
      const msg = await ctx.db.get(args.refMessageId);
      if (!msg || msg.eventId !== args.eventId) {
        throw new ConvexError({
          code: "ref_not_found",
          message: "That message isn't part of this event.",
        });
      }
      refMessageId = args.refMessageId;
      existing = await ctx.db
        .query("liveEventWallItems")
        .withIndex("by_event_message", (q) =>
          q.eq("eventId", args.eventId).eq("refMessageId", refMessageId),
        )
        .first();
    } else {
      if (!args.refAnswerId) {
        throw new ConvexError({
          code: "missing_ref",
          message: "refAnswerId is required for answer pins.",
        });
      }
      const ans = await ctx.db.get(args.refAnswerId);
      if (!ans || ans.eventId !== args.eventId) {
        throw new ConvexError({
          code: "ref_not_found",
          message: "That answer isn't part of this event.",
        });
      }
      refAnswerId = args.refAnswerId;
      existing = await ctx.db
        .query("liveEventWallItems")
        .withIndex("by_event_answer", (q) =>
          q.eq("eventId", args.eventId).eq("refAnswerId", refAnswerId),
        )
        .first();
    }

    // Idempotent: re-pinning returns the existing card.
    if (existing) {
      return { itemId: existing._id, alreadyPinned: true };
    }

    const now = Date.now();
    const itemId = await ctx.db.insert("liveEventWallItems", {
      eventId: args.eventId,
      refType: args.refType,
      refMessageId,
      refAnswerId,
      x: clampCoord(args.x, 40),
      y: clampCoord(args.y, 40),
      w: clampW(args.w),
      color: safeColor(args.color),
      z: now, // monotonic-ish; moveWallItems bumps it on interaction
      createdBySessionId: args.sessionId,
      createdAt: now,
      updatedAt: now,
    });
    return { itemId, alreadyPinned: false };
  },
});

/**
 * Author a fresh sticky note directly on the wall. Its text is PUBLIC — every
 * member of the room sees it (identical visibility to a chat message). Private
 * notes never come through here; they live in convex/notes.ts (userNotes).
 */
export const createWallNote = mutation({
  args: {
    eventId: v.id("liveEvents"),
    sessionId: v.string(),
    text: v.string(),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    w: v.optional(v.number()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.eventId, args.sessionId);
    await enforceRateLimit(ctx, {
      key: `wall:${args.sessionId}`,
      limit: WALL_OP_LIMIT,
      windowMs: WALL_OP_WINDOW,
    });
    await requireLiveEvent(ctx, args.eventId);

    const text = (args.text || "").trim();
    if (!text) {
      throw new ConvexError({
        code: "empty_note",
        message: "Sticky note text is required.",
      });
    }
    if (text.length > MAX_WALL_NOTE_TEXT) {
      throw new ConvexError({
        code: "note_too_long",
        message: `Max ${MAX_WALL_NOTE_TEXT} chars.`,
      });
    }

    const now = Date.now();
    const itemId = await ctx.db.insert("liveEventWallItems", {
      eventId: args.eventId,
      refType: "note",
      text,
      x: clampCoord(args.x, 40),
      y: clampCoord(args.y, 40),
      w: clampW(args.w),
      color: safeColor(args.color),
      z: now,
      createdBySessionId: args.sessionId,
      createdAt: now,
      updatedAt: now,
    });
    return { itemId };
  },
});

/* ========================================================================== */
/* Move — the ONE write per drag gesture (fired on pointerup)                  */
/* ========================================================================== */

/**
 * Commit a drag. ONE mutation moves a whole selection (group-move is a single
 * call with N updates, not N calls). Convex's serializable txn ordering is the
 * last-write-wins conflict resolver — two users dragging the same item just
 * means the later commit wins, no CRDT needed.
 *
 * Collaborative-open by design (any member may rearrange any item, like
 * FigJam/Miro). Host-scoped locking is a deliberate future gate, not a v1 need.
 * Integrity: updates for items that don't exist or belong to another event are
 * skipped (not thrown) so one stale id can't fail an otherwise-valid batch.
 */
export const moveWallItems = mutation({
  args: {
    eventId: v.id("liveEvents"),
    sessionId: v.string(),
    updates: v.array(
      v.object({
        id: v.id("liveEventWallItems"),
        x: v.number(),
        y: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.eventId, args.sessionId);
    if (args.updates.length === 0) {
      return { moved: 0 };
    }
    if (args.updates.length > MAX_WALL_BATCH) {
      throw new ConvexError({
        code: "batch_too_large",
        message: `Max ${MAX_WALL_BATCH} items per move.`,
      });
    }
    await enforceRateLimit(ctx, {
      key: `wallmove:${args.sessionId}`,
      limit: WALL_MOVE_LIMIT,
      windowMs: WALL_MOVE_WINDOW,
    });

    const now = Date.now();
    let moved = 0;
    for (const u of args.updates) {
      const item = await ctx.db.get(u.id);
      if (!item || item.eventId !== args.eventId) continue; // integrity skip
      await ctx.db.patch(u.id, {
        x: clampCoord(u.x, item.x),
        y: clampCoord(u.y, item.y),
        z: now, // dragged items come to front (matches the client engine)
        updatedAt: now,
      });
      moved += 1;
    }
    return { moved };
  },
});

/* ========================================================================== */
/* Edit — recolor, retext (note only), group, ungroup                          */
/* ========================================================================== */

/** Recolor any wall item. Color validated against the allowlist. */
export const recolorWallItem = mutation({
  args: {
    eventId: v.id("liveEvents"),
    sessionId: v.string(),
    itemId: v.id("liveEventWallItems"),
    color: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.eventId, args.sessionId);
    await enforceRateLimit(ctx, {
      key: `wall:${args.sessionId}`,
      limit: WALL_OP_LIMIT,
      windowMs: WALL_OP_WINDOW,
    });
    const item = await ctx.db.get(args.itemId);
    if (!item || item.eventId !== args.eventId) {
      throw new ConvexError({
        code: "item_not_found",
        message: "That wall item isn't part of this event.",
      });
    }
    await ctx.db.patch(args.itemId, {
      color: safeColor(args.color),
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Edit a sticky's text. ONLY refType "note" is editable — message/answer cards
 * are immutable public content edited at their source, not on the wall.
 */
export const editWallNote = mutation({
  args: {
    eventId: v.id("liveEvents"),
    sessionId: v.string(),
    itemId: v.id("liveEventWallItems"),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.eventId, args.sessionId);
    await enforceRateLimit(ctx, {
      key: `wall:${args.sessionId}`,
      limit: WALL_OP_LIMIT,
      windowMs: WALL_OP_WINDOW,
    });
    const item = await ctx.db.get(args.itemId);
    if (!item || item.eventId !== args.eventId) {
      throw new ConvexError({
        code: "item_not_found",
        message: "That wall item isn't part of this event.",
      });
    }
    if (item.refType !== "note") {
      throw new ConvexError({
        code: "not_editable",
        message:
          "Only sticky notes can be edited on the wall; messages and answers are edited at their source.",
      });
    }
    const text = (args.text || "").trim();
    if (!text) {
      throw new ConvexError({
        code: "empty_note",
        message: "Sticky note text is required.",
      });
    }
    if (text.length > MAX_WALL_NOTE_TEXT) {
      throw new ConvexError({
        code: "note_too_long",
        message: `Max ${MAX_WALL_NOTE_TEXT} chars.`,
      });
    }
    await ctx.db.patch(args.itemId, { text, updatedAt: Date.now() });
    return { ok: true };
  },
});

/**
 * Group a selection. DETERMINISTIC: groupId = "g:" + the lexicographically
 * smallest member id, so the same selection always groups to the same id (and
 * since an item belongs to one group at a time, that anchor is collision-free
 * across distinct groups). Requires ≥2 items; BOUND at MAX_WALL_BATCH.
 */
export const groupWallItems = mutation({
  args: {
    eventId: v.id("liveEvents"),
    sessionId: v.string(),
    itemIds: v.array(v.id("liveEventWallItems")),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.eventId, args.sessionId);
    if (args.itemIds.length < 2) {
      throw new ConvexError({
        code: "group_too_small",
        message: "Select at least two items to group.",
      });
    }
    if (args.itemIds.length > MAX_WALL_BATCH) {
      throw new ConvexError({
        code: "batch_too_large",
        message: `Max ${MAX_WALL_BATCH} items per group.`,
      });
    }
    await enforceRateLimit(ctx, {
      key: `wall:${args.sessionId}`,
      limit: WALL_OP_LIMIT,
      windowMs: WALL_OP_WINDOW,
    });

    // Validate every item belongs to this event before mutating any.
    const items: any[] = [];
    for (const id of args.itemIds) {
      const item = await ctx.db.get(id);
      if (!item || item.eventId !== args.eventId) {
        throw new ConvexError({
          code: "item_not_found",
          message: "One or more items isn't part of this event.",
        });
      }
      items.push(item);
    }

    const minId = [...args.itemIds].map(String).sort()[0];
    const groupId = `g:${minId}`;
    const now = Date.now();
    for (const item of items) {
      await ctx.db.patch(item._id, { groupId, updatedAt: now });
    }
    return { groupId, count: items.length };
  },
});

/** Ungroup a selection — clears groupId on each item in this event. */
export const ungroupWallItems = mutation({
  args: {
    eventId: v.id("liveEvents"),
    sessionId: v.string(),
    itemIds: v.array(v.id("liveEventWallItems")),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.eventId, args.sessionId);
    if (args.itemIds.length === 0) {
      return { ungrouped: 0 };
    }
    if (args.itemIds.length > MAX_WALL_BATCH) {
      throw new ConvexError({
        code: "batch_too_large",
        message: `Max ${MAX_WALL_BATCH} items per ungroup.`,
      });
    }
    await enforceRateLimit(ctx, {
      key: `wall:${args.sessionId}`,
      limit: WALL_OP_LIMIT,
      windowMs: WALL_OP_WINDOW,
    });

    const now = Date.now();
    let ungrouped = 0;
    for (const id of args.itemIds) {
      const item = await ctx.db.get(id);
      if (!item || item.eventId !== args.eventId) continue; // integrity skip
      if (item.groupId === undefined) continue;
      await ctx.db.patch(id, { groupId: undefined, updatedAt: now });
      ungrouped += 1;
    }
    return { ungrouped };
  },
});

/* ========================================================================== */
/* Remove — unpin a card / delete a sticky                                     */
/* ========================================================================== */

/**
 * Remove wall items. Removing a message/answer pin only UNPINS it — the source
 * content (liveEventMessages / liveEventAnswers) is untouched. Removing a "note"
 * deletes the sticky entirely (its text lived only on the wall). BOUND at
 * MAX_WALL_BATCH; integrity-checked per id.
 */
export const removeWallItems = mutation({
  args: {
    eventId: v.id("liveEvents"),
    sessionId: v.string(),
    itemIds: v.array(v.id("liveEventWallItems")),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.eventId, args.sessionId);
    if (args.itemIds.length === 0) {
      return { removed: 0 };
    }
    if (args.itemIds.length > MAX_WALL_BATCH) {
      throw new ConvexError({
        code: "batch_too_large",
        message: `Max ${MAX_WALL_BATCH} items per remove.`,
      });
    }
    await enforceRateLimit(ctx, {
      key: `wall:${args.sessionId}`,
      limit: WALL_OP_LIMIT,
      windowMs: WALL_OP_WINDOW,
    });

    let removed = 0;
    for (const id of args.itemIds) {
      const item = await ctx.db.get(id);
      if (!item || item.eventId !== args.eventId) continue; // integrity skip
      await ctx.db.delete(id);
      removed += 1;
    }
    return { removed };
  },
});
