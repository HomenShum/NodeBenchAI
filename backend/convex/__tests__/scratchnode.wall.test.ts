/**
 * Scenario-based tests for the Memory Wall backend (convex/wall.ts).
 *
 * Per .claude/rules/scenario_testing.md every test names a persona, a goal,
 * prior state, scale, duration, and adversarial edges. The Wall is a PUBLIC,
 * collaborative-open spatial overlay over the canonical event stream, so the
 * threat surface is: cross-event id smuggling, unbounded batches, injection
 * via color/text, private-note leakage, and rate-limit evasion.
 *
 * Invocation idiom mirrors scratchnode.events.test.ts: registered Convex
 * functions expose their handler as `._handler`, called against an in-memory
 * MockDb whose withIndex understands the eq filters wall.ts uses.
 */
import { describe, expect, it } from "vitest";

import {
  listWallItems,
  pinToWall,
  createWallNote,
  moveWallItems,
  recolorWallItem,
  editWallNote,
  groupWallItems,
  ungroupWallItems,
  removeWallItems,
} from "../wall";

/* -------------------------------------------------------------------------- */
/* Compact in-memory MockDb — supports get / insert / patch / delete and       */
/* withIndex(...).first()/take(). wall.ts only uses eq() filters in withIndex.  */
/* -------------------------------------------------------------------------- */
type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

class IdxBuilder {
  filters: Array<{ field: string; value: unknown }> = [];
  eq(field: string, value: unknown) {
    this.filters.push({ field, value });
    return this;
  }
  // wall.ts never uses gte/lt in withIndex, but keep them no-op-safe.
  gte() {
    return this;
  }
  lt() {
    return this;
  }
}

class Chain {
  constructor(private rows: Row[]) {}
  order() {
    return this;
  }
  async first() {
    return this.rows[0] ?? null;
  }
  async take(n: number) {
    return this.rows.slice(0, n);
  }
  async collect() {
    return this.rows;
  }
}

class MockDb {
  public inserts: Array<{ table: string; value: Row }> = [];
  public deletes: string[] = [];
  private idCounter = 0;
  constructor(private tables: Tables) {}

  async get(id: string): Promise<any> {
    for (const rows of Object.values(this.tables)) {
      const row = rows.find((r) => r._id === id);
      if (row) return row;
    }
    return null;
  }

  query(table: string) {
    const rows = this.tables[table] ?? [];
    return {
      withIndex: (_name: string, build: (b: IdxBuilder) => IdxBuilder) => {
        const filters = build(new IdxBuilder()).filters;
        const matched = rows.filter((r) =>
          filters.every(({ field, value }) => r[field] === value),
        );
        return new Chain(matched);
      },
    };
  }

  async insert(table: string, value: Row) {
    this.idCounter += 1;
    const inserted = { _id: `${table}:${this.idCounter}`, ...value };
    if (!this.tables[table]) this.tables[table] = [];
    this.tables[table].push(inserted);
    this.inserts.push({ table, value: inserted });
    return inserted._id;
  }

  async patch(id: string, value: Row) {
    for (const rows of Object.values(this.tables)) {
      const row = rows.find((r) => r._id === id);
      if (row) {
        Object.assign(row, value);
        return;
      }
    }
    throw new Error(`Missing row ${id}`);
  }

  async delete(id: string) {
    for (const [table, rows] of Object.entries(this.tables)) {
      const idx = rows.findIndex((r) => r._id === id);
      if (idx >= 0) {
        this.tables[table] = [...rows.slice(0, idx), ...rows.slice(idx + 1)];
        this.deletes.push(id);
        return;
      }
    }
    throw new Error(`Missing row ${id}`);
  }
}

const SESSION_A = "session-anon-aaaaaaaa";
const SESSION_B = "session-anon-bbbbbbbb";
const EVENT_A = "liveEvents:A";
const EVENT_B = "liveEvents:B";

function event(id = EVENT_A, status = "live"): Row {
  return { _id: id, slug: `slug-${id}`, name: "Test Event", roomCode: "ORBITAL", status, startedAt: 1 };
}
function member(sessionId: string, eventId = EVENT_A): Row {
  return {
    _id: `liveEventMembers:${eventId}:${sessionId}`,
    eventId,
    sessionId,
    displayName: "Guest",
    joinedAt: 1,
    lastSeenAt: 1,
  };
}
function message(id: string, eventId = EVENT_A): Row {
  return { _id: id, eventId, sessionId: SESSION_A, displayName: "Guest", text: "hi", kind: "chat", createdAt: 1 };
}
function answer(id: string, eventId = EVENT_A): Row {
  return {
    _id: id,
    eventId,
    questionMessageId: "liveEventMessages:q",
    question: "q",
    normalizedQuestion: "q",
    body: "a",
    sourceIds: [],
    trace: [],
    cacheHit: false,
    faqStatus: "none",
    createdAt: 1,
  };
}
function ctxWith(tables: Partial<Tables>) {
  return {
    db: new MockDb({
      liveEvents: [],
      liveEventMembers: [],
      liveEventMessages: [],
      liveEventAnswers: [],
      liveEventWallItems: [],
      scratchnodeRateLimits: [],
      ...tables,
    } as Tables),
  };
}
const call = (fn: any, ctx: any, args: any) => (fn as any)._handler(ctx, args);

/* ========================================================================== */
describe("Memory Wall — pin idempotency + dedup", () => {
  /**
   * Scenario:    Power user double-taps "pin to wall" on the same answer card.
   * User:        Authenticated member, fast clicker (double-fire).
   * Prior state: One answer exists; wall empty.
   * Scale:       1 user, 2 rapid calls.
   * Expected:    Second pin returns the SAME item (alreadyPinned), no duplicate.
   * Edge:        A duplicate card on the wall is the bug we're preventing.
   */
  it("re-pinning the same content returns the existing card, never a duplicate", async () => {
    const ctx = ctxWith({
      liveEvents: [event()],
      liveEventMembers: [member(SESSION_A)],
      liveEventAnswers: [answer("liveEventAnswers:1")],
    });
    const first = await call(pinToWall, ctx, {
      eventId: EVENT_A,
      sessionId: SESSION_A,
      refType: "answer",
      refAnswerId: "liveEventAnswers:1",
    });
    const second = await call(pinToWall, ctx, {
      eventId: EVENT_A,
      sessionId: SESSION_A,
      refType: "answer",
      refAnswerId: "liveEventAnswers:1",
    });
    expect(first.alreadyPinned).toBe(false);
    expect(second.alreadyPinned).toBe(true);
    expect(second.itemId).toBe(first.itemId);
    const items = await call(listWallItems, ctx, { eventId: EVENT_A });
    expect(items).toHaveLength(1);
  });
});

describe("Memory Wall — cross-event id smuggling (adversarial)", () => {
  /**
   * Scenario:    Attacker in room A crafts a pin pointing at room B's message.
   * User:        Adversarial member of A.
   * Expected:    Rejected — the ref must belong to THIS event.
   */
  it("rejects pinning a message that belongs to another event", async () => {
    const ctx = ctxWith({
      liveEvents: [event(EVENT_A), event(EVENT_B)],
      liveEventMembers: [member(SESSION_A, EVENT_A)],
      liveEventMessages: [message("liveEventMessages:fromB", EVENT_B)],
    });
    await expect(
      call(pinToWall, ctx, {
        eventId: EVENT_A,
        sessionId: SESSION_A,
        refType: "message",
        refMessageId: "liveEventMessages:fromB",
      }),
    ).rejects.toMatchObject({ data: { code: "ref_not_found" } });
  });

  it("skips (does not throw on) move updates for items from another event", async () => {
    const ctx = ctxWith({
      liveEvents: [event(EVENT_A)],
      liveEventMembers: [member(SESSION_A, EVENT_A)],
      liveEventWallItems: [
        { _id: "liveEventWallItems:mine", eventId: EVENT_A, refType: "note", text: "x", x: 0, y: 0, w: 180, color: "#f3d77b", z: 1, createdBySessionId: SESSION_A, createdAt: 1, updatedAt: 1 },
        { _id: "liveEventWallItems:foreign", eventId: EVENT_B, refType: "note", text: "y", x: 0, y: 0, w: 180, color: "#f3d77b", z: 1, createdBySessionId: SESSION_B, createdAt: 1, updatedAt: 1 },
      ],
    });
    const res = await call(moveWallItems, ctx, {
      eventId: EVENT_A,
      sessionId: SESSION_A,
      updates: [
        { id: "liveEventWallItems:mine", x: 50, y: 60 },
        { id: "liveEventWallItems:foreign", x: 999, y: 999 },
      ],
    });
    expect(res.moved).toBe(1); // only the in-event item moved
    const foreign = await ctx.db.get("liveEventWallItems:foreign");
    expect(foreign.x).toBe(0); // untouched
  });
});

describe("Memory Wall — create + move round trip with coordinate clamping", () => {
  /**
   * Scenario:    User drops a sticky, then drags it; a buggy client sends NaN.
   * Duration:    Single gesture commit.
   * Expected:    Position persists; NaN/Infinity never reach the DB.
   */
  it("creates a note then commits a move, clamping non-finite coords", async () => {
    const ctx = ctxWith({
      liveEvents: [event()],
      liveEventMembers: [member(SESSION_A)],
    });
    const created = await call(createWallNote, ctx, {
      eventId: EVENT_A,
      sessionId: SESSION_A,
      text: "  follow up with Orbital  ",
    });
    const itemId = created.itemId;
    const stored = await ctx.db.get(itemId);
    expect(stored.text).toBe("follow up with Orbital"); // trimmed
    expect(stored.refType).toBe("note");

    // Finite-but-out-of-range coords clamp to the board limit (±COORD_LIMIT).
    const moved = await call(moveWallItems, ctx, {
      eventId: EVENT_A,
      sessionId: SESSION_A,
      updates: [{ id: itemId, x: 999_999, y: -999_999 }],
    });
    expect(moved.moved).toBe(1);
    let after = await ctx.db.get(itemId);
    expect(after.x).toBe(100_000);
    expect(after.y).toBe(-100_000);

    // Non-finite coords (NaN / Infinity) are rejected as garbage and fall back
    // to the last-good value — never snapped to an edge, never persisted as NaN.
    await call(moveWallItems, ctx, {
      eventId: EVENT_A,
      sessionId: SESSION_A,
      updates: [{ id: itemId, x: Number.NaN, y: Infinity }],
    });
    after = await ctx.db.get(itemId);
    expect(Number.isFinite(after.x)).toBe(true);
    expect(Number.isFinite(after.y)).toBe(true);
    expect(after.x).toBe(100_000); // unchanged last-good
    expect(after.y).toBe(-100_000); // unchanged last-good
  });
});

describe("Memory Wall — deterministic grouping (FigJam-style)", () => {
  /**
   * Scenario:    User marquee-selects 3 stickies and groups them, then ungroups.
   * Expected:    groupId is deterministic (g: + smallest id); ungroup clears it.
   */
  it("derives a stable groupId from the smallest member id and ungroups cleanly", async () => {
    const items = ["liveEventWallItems:c", "liveEventWallItems:a", "liveEventWallItems:b"].map((id) => ({
      _id: id, eventId: EVENT_A, refType: "note", text: id, x: 0, y: 0, w: 180, color: "#f3d77b", z: 1, createdBySessionId: SESSION_A, createdAt: 1, updatedAt: 1,
    }));
    const ctx = ctxWith({
      liveEvents: [event()],
      liveEventMembers: [member(SESSION_A)],
      liveEventWallItems: items,
    });
    const grouped = await call(groupWallItems, ctx, {
      eventId: EVENT_A,
      sessionId: SESSION_A,
      itemIds: ["liveEventWallItems:c", "liveEventWallItems:a", "liveEventWallItems:b"],
    });
    expect(grouped.groupId).toBe("g:liveEventWallItems:a"); // lexicographically smallest
    expect(grouped.count).toBe(3);
    for (const id of ["liveEventWallItems:a", "liveEventWallItems:b", "liveEventWallItems:c"]) {
      expect((await ctx.db.get(id)).groupId).toBe("g:liveEventWallItems:a");
    }

    // Regrouping the same selection yields the SAME id (determinism).
    const regrouped = await call(groupWallItems, ctx, {
      eventId: EVENT_A,
      sessionId: SESSION_A,
      itemIds: ["liveEventWallItems:b", "liveEventWallItems:c", "liveEventWallItems:a"],
    });
    expect(regrouped.groupId).toBe("g:liveEventWallItems:a");

    const ungrouped = await call(ungroupWallItems, ctx, {
      eventId: EVENT_A,
      sessionId: SESSION_A,
      itemIds: ["liveEventWallItems:a", "liveEventWallItems:b", "liveEventWallItems:c"],
    });
    expect(ungrouped.ungrouped).toBe(3);
    expect((await ctx.db.get("liveEventWallItems:a")).groupId).toBeUndefined();
  });

  it("rejects a group of fewer than two items", async () => {
    const ctx = ctxWith({
      liveEvents: [event()],
      liveEventMembers: [member(SESSION_A)],
      liveEventWallItems: [{ _id: "liveEventWallItems:solo", eventId: EVENT_A, refType: "note", text: "x", x: 0, y: 0, w: 180, color: "#f3d77b", z: 1, createdBySessionId: SESSION_A, createdAt: 1, updatedAt: 1 }],
    });
    await expect(
      call(groupWallItems, ctx, { eventId: EVENT_A, sessionId: SESSION_A, itemIds: ["liveEventWallItems:solo"] }),
    ).rejects.toMatchObject({ data: { code: "group_too_small" } });
  });
});

describe("Memory Wall — BOUND enforcement (adversarial scale)", () => {
  /**
   * Scenario:    Abuser tries to move 201 items in one call / a 600-item wall.
   * Scale:       Batch overflow + list overflow.
   * Expected:    Batch rejected; list capped at 500.
   */
  it("rejects a move batch larger than 200", async () => {
    const ctx = ctxWith({ liveEvents: [event()], liveEventMembers: [member(SESSION_A)] });
    const updates = Array.from({ length: 201 }, (_, i) => ({ id: `liveEventWallItems:${i}`, x: i, y: i }));
    await expect(
      call(moveWallItems, ctx, { eventId: EVENT_A, sessionId: SESSION_A, updates }),
    ).rejects.toMatchObject({ data: { code: "batch_too_large" } });
  });

  it("caps listWallItems at 500 even when the wall holds 600", async () => {
    const wallItems = Array.from({ length: 600 }, (_, i) => ({
      _id: `liveEventWallItems:${i}`, eventId: EVENT_A, refType: "note", text: `n${i}`, x: 0, y: 0, w: 180, color: "#f3d77b", z: i, createdBySessionId: SESSION_A, createdAt: 1, updatedAt: 1,
    }));
    const ctx = ctxWith({ liveEvents: [event()], liveEventMembers: [member(SESSION_A)], liveEventWallItems: wallItems });
    const items = await call(listWallItems, ctx, { eventId: EVENT_A });
    expect(items).toHaveLength(500);
  });
});

describe("Memory Wall — membership + lifecycle gates", () => {
  it("rejects a non-member trying to pin", async () => {
    const ctx = ctxWith({
      liveEvents: [event()],
      liveEventMembers: [], // SESSION_A never joined
      liveEventMessages: [message("liveEventMessages:1")],
    });
    await expect(
      call(pinToWall, ctx, { eventId: EVENT_A, sessionId: SESSION_A, refType: "message", refMessageId: "liveEventMessages:1" }),
    ).rejects.toMatchObject({ data: { code: "not_joined" } });
  });

  it("rejects a too-short session id", async () => {
    const ctx = ctxWith({ liveEvents: [event()] });
    await expect(
      call(createWallNote, ctx, { eventId: EVENT_A, sessionId: "short", text: "hi" }),
    ).rejects.toMatchObject({ data: { code: "invalid_session" } });
  });

  it("refuses writes to an ended event", async () => {
    const ctx = ctxWith({
      liveEvents: [event(EVENT_A, "ended")],
      liveEventMembers: [member(SESSION_A)],
    });
    await expect(
      call(createWallNote, ctx, { eventId: EVENT_A, sessionId: SESSION_A, text: "too late" }),
    ).rejects.toMatchObject({ data: { code: "event_ended" } });
  });
});

describe("Memory Wall — input sanitation (adversarial injection)", () => {
  /**
   * Scenario:    Attacker sends a CSS/script payload as the sticky color.
   * Expected:    Color falls back to the allowlist — never reaches inline style.
   */
  it("coerces an off-allowlist color to a safe palette value", async () => {
    const ctx = ctxWith({ liveEvents: [event()], liveEventMembers: [member(SESSION_A)] });
    const created = await call(createWallNote, ctx, {
      eventId: EVENT_A,
      sessionId: SESSION_A,
      text: "payload",
      color: "red; } </style><script>alert(1)</script>",
    });
    const stored = await ctx.db.get(created.itemId);
    expect(stored.color).toBe("#f3d77b"); // allowlist[0]
  });

  it("rejects empty and over-long sticky text", async () => {
    const ctx = ctxWith({ liveEvents: [event()], liveEventMembers: [member(SESSION_A)] });
    await expect(
      call(createWallNote, ctx, { eventId: EVENT_A, sessionId: SESSION_A, text: "   " }),
    ).rejects.toMatchObject({ data: { code: "empty_note" } });
    await expect(
      call(createWallNote, ctx, { eventId: EVENT_A, sessionId: SESSION_A, text: "x".repeat(2001) }),
    ).rejects.toMatchObject({ data: { code: "note_too_long" } });
  });

  it("refuses to edit text on a message pin (only stickies are editable)", async () => {
    const ctx = ctxWith({
      liveEvents: [event()],
      liveEventMembers: [member(SESSION_A)],
      liveEventMessages: [message("liveEventMessages:1")],
    });
    const pinned = await call(pinToWall, ctx, { eventId: EVENT_A, sessionId: SESSION_A, refType: "message", refMessageId: "liveEventMessages:1" });
    await expect(
      call(editWallNote, ctx, { eventId: EVENT_A, sessionId: SESSION_A, itemId: pinned.itemId, text: "rewrite the message" }),
    ).rejects.toMatchObject({ data: { code: "not_editable" } });
  });
});

describe("Memory Wall — collaborative-open + unpin semantics (multi-user)", () => {
  /**
   * Scenario:    User A drops a sticky; user B rearranges it (shared board).
   * User:        Two distinct members, same room.
   * Expected:    B's move succeeds — the wall is collaborative-open like FigJam.
   */
  it("lets a different member move another member's item", async () => {
    const ctx = ctxWith({
      liveEvents: [event()],
      liveEventMembers: [member(SESSION_A), member(SESSION_B)],
    });
    const created = await call(createWallNote, ctx, { eventId: EVENT_A, sessionId: SESSION_A, text: "A's note" });
    const moved = await call(moveWallItems, ctx, {
      eventId: EVENT_A,
      sessionId: SESSION_B, // different member
      updates: [{ id: created.itemId, x: 300, y: 200 }],
    });
    expect(moved.moved).toBe(1);
    expect((await ctx.db.get(created.itemId)).x).toBe(300);
  });

  /**
   * Scenario:    Unpin a message card — the source message must survive.
   * Expected:    Wall item removed; liveEventMessages row untouched.
   */
  it("unpins a message without deleting the source message", async () => {
    const ctx = ctxWith({
      liveEvents: [event()],
      liveEventMembers: [member(SESSION_A)],
      liveEventMessages: [message("liveEventMessages:keep")],
    });
    const pinned = await call(pinToWall, ctx, { eventId: EVENT_A, sessionId: SESSION_A, refType: "message", refMessageId: "liveEventMessages:keep" });
    const removed = await call(removeWallItems, ctx, { eventId: EVENT_A, sessionId: SESSION_A, itemIds: [pinned.itemId] });
    expect(removed.removed).toBe(1);
    expect(await ctx.db.get(pinned.itemId)).toBeNull(); // wall item gone
    expect(await ctx.db.get("liveEventMessages:keep")).not.toBeNull(); // source survives
  });
});

describe("Memory Wall — rate limiting (sustained burst)", () => {
  /**
   * Scenario:    Spam bot floods createWallNote in one window.
   * Duration:    61 calls inside the same 60s window.
   * Expected:    61st rejected; the independent move bucket still works.
   */
  it("caps wall ops at 60/min/session and keeps the move bucket independent", async () => {
    const ctx = ctxWith({ liveEvents: [event()], liveEventMembers: [member(SESSION_A)] });
    let firstItemId = "";
    for (let i = 0; i < 60; i++) {
      const r = await call(createWallNote, ctx, { eventId: EVENT_A, sessionId: SESSION_A, text: `n${i}` });
      if (i === 0) firstItemId = r.itemId;
    }
    await expect(
      call(createWallNote, ctx, { eventId: EVENT_A, sessionId: SESSION_A, text: "one too many" }),
    ).rejects.toMatchObject({ data: { code: "rate_limited" } });

    // The wallmove: bucket is separate — a move still goes through.
    const moved = await call(moveWallItems, ctx, {
      eventId: EVENT_A,
      sessionId: SESSION_A,
      updates: [{ id: firstItemId, x: 10, y: 10 }],
    });
    expect(moved.moved).toBe(1);
  });
});
