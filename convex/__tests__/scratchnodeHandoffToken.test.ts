/// <reference types="vite/client" />
/**
 * ADVERSARIAL scenario tests for the cross-domain ScratchNode → NodeBench
 * PRIVATE-NOTES handoff (roadmap item #4) — scratchnodeHandoff:mintEventHandoffToken
 * + consumeEventHandoffToken.
 *
 * This is SECURITY code. Per .claude/rules/scenario_testing.md every test names a
 * persona + goal + prior state + actions + expected outcome, and we go past the
 * happy path into the attack surface. The roadmap's #1 risk is leaking a
 * permanent credential; these tests prove the opaque-stateful-token design
 * fails closed and never returns the session id.
 *
 * Runs the REAL Convex transaction engine via convex-test so indexes, the
 * single-use increment, and the by_token_hash lookup behave exactly as in prod.
 *
 * Threat matrix (every row is a test below):
 *   T1  happy:        member mints → friend redeems on NodeBench → reads notes
 *   T2  non-member:   a session that never joined cannot mint              → denied
 *   T3  wrong-event:  a member of event A cannot mint for event B          → denied
 *   T4  expired:      a token past its TTL is rejected at consume          → denied
 *   T5  used-up:      a token past maxUses is rejected                     → denied
 *   T6  unknown/tamper: a forged / tampered token fails closed            → denied
 *   T7  no-session-leak: consume NEVER returns the bound session id        → invariant
 *   T8  event-scope:  consume returns ONLY the bound event's notes         → invariant
 *   T9  read-only:    consume does not mutate notes; only burns a use      → invariant
 *   T10 phantom-event: minting against a non-existent slug                 → denied
 */
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

const convexModules = import.meta.glob("../**/*.{ts,js}");

let convexTest: any;
let convexTestAvailable = false;
try {
  const mod = await import(/* @vite-ignore */ "convex-test");
  convexTest = mod.convexTest;
  convexTestAvailable = typeof convexTest === "function";
} catch {
  convexTestAvailable = false;
}

const NOW = 1_700_000_000_000;
// Realistic anonymous sn_session_id values (UUIDv4-shaped, 36 chars).
const ALICE_SESSION = "11111111-2222-4333-8444-555555555555";
const MALLORY_SESSION = "99999999-8888-4777-8666-555544443333";

async function seedEvent(t: any, opts: { slug: string; roomCode: string }) {
  return await t.run(async (ctx: any) =>
    ctx.db.insert("liveEvents", {
      slug: opts.slug,
      name: `${opts.slug} event`,
      roomCode: opts.roomCode,
      status: "live",
      startedAt: NOW,
    }),
  );
}

async function joinAsMember(t: any, eventId: any, sessionId: string) {
  return await t.run(async (ctx: any) =>
    ctx.db.insert("liveEventMembers", {
      eventId,
      sessionId,
      displayName: "Guest",
      joinedAt: NOW,
      lastSeenAt: NOW,
    }),
  );
}

async function seedNote(
  t: any,
  opts: { ownerKey: string; eventId: any; title: string; bodyHtml: string },
) {
  return await t.run(async (ctx: any) =>
    ctx.db.insert("userNotes", {
      ownerKey: opts.ownerKey,
      eventId: opts.eventId,
      title: opts.title,
      bodyHtml: opts.bodyHtml,
      tags: ["from-room"],
      pinned: false,
      isAsk: false,
      createdAt: NOW,
      updatedAt: NOW,
    }),
  );
}

/** Read the single handoff token row back so tests can inspect / tamper with it. */
async function readTokenRow(t: any) {
  return await t.run(async (ctx: any) => {
    const rows = await ctx.db.query("liveEventHandoffTokens").take(10);
    return rows[0] ?? null;
  });
}

describe.skipIf(!convexTestAvailable)("ScratchNode → NodeBench private-notes handoff token", () => {
  /* ----------------------------------------------------------------------- */
  /* T1 — HAPPY PATH                                                          */
  /* ----------------------------------------------------------------------- */
  it("T1 happy: a member mints, a friend redeems on NodeBench, and reads ONLY their own notes", async () => {
    // Persona: Alice took private notes during a live room, then taps
    // "Continue in NodeBench". Goal: see those exact notes on nodebenchai.com.
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "ai-summit", roomCode: "ORBIT1" });
    await joinAsMember(t, eventId, ALICE_SESSION);
    await seedNote(t, {
      ownerKey: ALICE_SESSION,
      eventId,
      title: "MCP auth takeaways",
      bodyHtml: "<p>SECRET_PRIVATE_BODY</p>",
    });

    const minted = await t.mutation(api.scratchnodeHandoff.mintEventHandoffToken, {
      slug: "ai-summit",
      sessionId: ALICE_SESSION,
    });
    // Mint returns ONLY { token, expiresAt } — never the session id.
    expect(typeof minted.token).toBe("string");
    expect(minted.token.length).toBeGreaterThan(20);
    expect(typeof minted.expiresAt).toBe("number");
    expect((minted as any).sessionId).toBeUndefined();
    expect((minted as any).boundOwnerKey).toBeUndefined();
    expect(minted.token).not.toContain(ALICE_SESSION);

    // The stored row holds only a HASH of the token (replay-proof) and the
    // server-only binding.
    const row = await readTokenRow(t);
    expect(row).not.toBeNull();
    expect(row.tokenHash).not.toBe(minted.token); // raw token never stored
    expect(row.scope).toBe("private_notes_read");
    expect(row.usedCount).toBe(0);

    // Redeem on NodeBench.
    const consumed = await t.mutation(api.scratchnodeHandoff.consumeEventHandoffToken, {
      token: minted.token,
    });
    expect(consumed.eventSlug).toBe("ai-summit");
    expect(consumed.noteCount).toBe(1);
    expect(consumed.notes[0].bodyHtml).toContain("SECRET_PRIVATE_BODY");
    expect(consumed.scope).toBe("private_notes_read");
  });

  /* ----------------------------------------------------------------------- */
  /* T2 — NON-MEMBER MINT DENIED                                             */
  /* ----------------------------------------------------------------------- */
  it("T2 non-member: a session that never joined the room cannot mint a token", async () => {
    // Persona: Mallory knows the room slug but never joined. Goal: forge a
    // token to read someone's notes. Expected: hard denial at mint.
    const t = convexTest(schema, convexModules);
    await seedEvent(t, { slug: "closed-door", roomCode: "DOOR99" });
    // No joinAsMember for Mallory.

    await expect(
      t.mutation(api.scratchnodeHandoff.mintEventHandoffToken, {
        slug: "closed-door",
        sessionId: MALLORY_SESSION,
      }),
    ).rejects.toThrow(/not_a_member|Join the event/i);

    // And NO token row was created.
    const row = await readTokenRow(t);
    expect(row).toBeNull();
  });

  /* ----------------------------------------------------------------------- */
  /* T3 — WRONG-EVENT MINT DENIED                                            */
  /* ----------------------------------------------------------------------- */
  it("T3 wrong-event: a member of event A cannot mint a token for event B", async () => {
    // Persona: Mallory legitimately joined room A. Goal: mint a token scoped to
    // room B (where she has no membership) to read B's attendees' notes.
    const t = convexTest(schema, convexModules);
    const eventA = await seedEvent(t, { slug: "room-a", roomCode: "ROOMA1" });
    await seedEvent(t, { slug: "room-b", roomCode: "ROOMB1" });
    await joinAsMember(t, eventA, MALLORY_SESSION); // member of A ONLY

    await expect(
      t.mutation(api.scratchnodeHandoff.mintEventHandoffToken, {
        slug: "room-b",
        sessionId: MALLORY_SESSION,
      }),
    ).rejects.toThrow(/not_a_member|Join the event/i);
  });

  /* ----------------------------------------------------------------------- */
  /* T4 — EXPIRED TOKEN DENIED                                               */
  /* ----------------------------------------------------------------------- */
  it("T4 expired: a token past its TTL is rejected at consume (fail closed)", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "ttl-room", roomCode: "TTL001" });
    await joinAsMember(t, eventId, ALICE_SESSION);
    const minted = await t.mutation(api.scratchnodeHandoff.mintEventHandoffToken, {
      slug: "ttl-room",
      sessionId: ALICE_SESSION,
    });

    // Force the row to be expired (simulate >10min later).
    await t.run(async (ctx: any) => {
      const rows = await ctx.db.query("liveEventHandoffTokens").take(1);
      await ctx.db.patch(rows[0]._id, { expiresAt: Date.now() - 1 });
    });

    await expect(
      t.mutation(api.scratchnodeHandoff.consumeEventHandoffToken, { token: minted.token }),
    ).rejects.toThrow(/token_expired|expired/i);
  });

  /* ----------------------------------------------------------------------- */
  /* T5 — USED-UP TOKEN DENIED                                               */
  /* ----------------------------------------------------------------------- */
  it("T5 used-up: a token whose uses are exhausted is rejected (single/low-use)", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "burn-room", roomCode: "BURN01" });
    await joinAsMember(t, eventId, ALICE_SESSION);
    await seedNote(t, { ownerKey: ALICE_SESSION, eventId, title: "n", bodyHtml: "<p>x</p>" });
    const minted = await t.mutation(api.scratchnodeHandoff.mintEventHandoffToken, {
      slug: "burn-room",
      sessionId: ALICE_SESSION,
    });

    // Force usedCount to maxUses (simulate exhaustion).
    await t.run(async (ctx: any) => {
      const rows = await ctx.db.query("liveEventHandoffTokens").take(1);
      await ctx.db.patch(rows[0]._id, { usedCount: rows[0].maxUses });
    });

    await expect(
      t.mutation(api.scratchnodeHandoff.consumeEventHandoffToken, { token: minted.token }),
    ).rejects.toThrow(/token_used|used/i);
  });

  it("T5b each consume burns exactly one use (the increment is real, not theater)", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "count-room", roomCode: "CNT001" });
    await joinAsMember(t, eventId, ALICE_SESSION);
    await seedNote(t, { ownerKey: ALICE_SESSION, eventId, title: "n", bodyHtml: "<p>x</p>" });
    const minted = await t.mutation(api.scratchnodeHandoff.mintEventHandoffToken, {
      slug: "count-room",
      sessionId: ALICE_SESSION,
    });

    await t.mutation(api.scratchnodeHandoff.consumeEventHandoffToken, { token: minted.token });
    const after1 = await readTokenRow(t);
    expect(after1.usedCount).toBe(1);
    await t.mutation(api.scratchnodeHandoff.consumeEventHandoffToken, { token: minted.token });
    const after2 = await readTokenRow(t);
    expect(after2.usedCount).toBe(2);
  });

  /* ----------------------------------------------------------------------- */
  /* T6 — UNKNOWN / TAMPERED TOKEN FAILS CLOSED                              */
  /* ----------------------------------------------------------------------- */
  it("T6 unknown: a never-minted / tampered token fails closed with no oracle", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "real-room", roomCode: "REAL01" });
    await joinAsMember(t, eventId, ALICE_SESSION);
    const minted = await t.mutation(api.scratchnodeHandoff.mintEventHandoffToken, {
      slug: "real-room",
      sessionId: ALICE_SESSION,
    });

    // A completely fabricated token.
    await expect(
      t.mutation(api.scratchnodeHandoff.consumeEventHandoffToken, {
        token: "totally-made-up-token-aaaaaaaaaaaa",
      }),
    ).rejects.toThrow(/invalid_token|invalid/i);

    // A one-character tamper of a REAL token → different hash → unknown → denied.
    const tampered = minted.token.slice(0, -1) + (minted.token.endsWith("A") ? "B" : "A");
    await expect(
      t.mutation(api.scratchnodeHandoff.consumeEventHandoffToken, { token: tampered }),
    ).rejects.toThrow(/invalid_token|invalid/i);

    // A too-short token is rejected before any DB work.
    await expect(
      t.mutation(api.scratchnodeHandoff.consumeEventHandoffToken, { token: "short" }),
    ).rejects.toThrow(/invalid_token|invalid/i);
  });

  /* ----------------------------------------------------------------------- */
  /* T7 — NO SESSION-ID LEAK (the roadmap's #1 risk)                         */
  /* ----------------------------------------------------------------------- */
  it("T7 no-leak: neither mint NOR consume ever returns the bound session id", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "leak-test", roomCode: "LEAK01" });
    await joinAsMember(t, eventId, ALICE_SESSION);
    await seedNote(t, {
      ownerKey: ALICE_SESSION,
      eventId,
      title: "private",
      bodyHtml: "<p>body</p>",
    });

    const minted = await t.mutation(api.scratchnodeHandoff.mintEventHandoffToken, {
      slug: "leak-test",
      sessionId: ALICE_SESSION,
    });
    const consumed = await t.mutation(api.scratchnodeHandoff.consumeEventHandoffToken, {
      token: minted.token,
    });

    // Serialize the ENTIRE consume payload and assert the session id is absent.
    const blob = JSON.stringify(consumed);
    expect(blob).not.toContain(ALICE_SESSION);
    // And no field named ownerKey / boundOwnerKey / sessionId is exposed.
    expect((consumed as any).ownerKey).toBeUndefined();
    expect((consumed as any).boundOwnerKey).toBeUndefined();
    expect((consumed as any).sessionId).toBeUndefined();
    expect((consumed.notes[0] as any).ownerKey).toBeUndefined();
  });

  /* ----------------------------------------------------------------------- */
  /* T8 — EVENT-SCOPE: only the bound event's notes                          */
  /* ----------------------------------------------------------------------- */
  it("T8 event-scope: consume returns ONLY the bound event's notes, never cross-event", async () => {
    // Prior state: Alice has notes in BOTH room X (bound) and room Y (other).
    const t = convexTest(schema, convexModules);
    const eventX = await seedEvent(t, { slug: "room-x", roomCode: "ROOMX1" });
    const eventY = await seedEvent(t, { slug: "room-y", roomCode: "ROOMY1" });
    await joinAsMember(t, eventX, ALICE_SESSION);
    await joinAsMember(t, eventY, ALICE_SESSION);
    await seedNote(t, { ownerKey: ALICE_SESSION, eventId: eventX, title: "x-note", bodyHtml: "<p>X_BODY</p>" });
    await seedNote(t, { ownerKey: ALICE_SESSION, eventId: eventY, title: "y-note", bodyHtml: "<p>Y_BODY</p>" });

    // Mint a token bound to room X.
    const minted = await t.mutation(api.scratchnodeHandoff.mintEventHandoffToken, {
      slug: "room-x",
      sessionId: ALICE_SESSION,
    });
    const consumed = await t.mutation(api.scratchnodeHandoff.consumeEventHandoffToken, {
      token: minted.token,
    });

    expect(consumed.eventSlug).toBe("room-x");
    expect(consumed.noteCount).toBe(1);
    const bodies = consumed.notes.map((n: any) => n.bodyHtml).join("|");
    expect(bodies).toContain("X_BODY");
    expect(bodies).not.toContain("Y_BODY"); // the OTHER event's note never leaks
  });

  it("T8b cross-session: a token bound to Alice never returns Mallory's notes in the same event", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "shared-room", roomCode: "SHARE1" });
    await joinAsMember(t, eventId, ALICE_SESSION);
    await joinAsMember(t, eventId, MALLORY_SESSION);
    await seedNote(t, { ownerKey: ALICE_SESSION, eventId, title: "alice", bodyHtml: "<p>ALICE_NOTE</p>" });
    await seedNote(t, { ownerKey: MALLORY_SESSION, eventId, title: "mallory", bodyHtml: "<p>MALLORY_NOTE</p>" });

    const minted = await t.mutation(api.scratchnodeHandoff.mintEventHandoffToken, {
      slug: "shared-room",
      sessionId: ALICE_SESSION,
    });
    const consumed = await t.mutation(api.scratchnodeHandoff.consumeEventHandoffToken, {
      token: minted.token,
    });

    const bodies = consumed.notes.map((n: any) => n.bodyHtml).join("|");
    expect(bodies).toContain("ALICE_NOTE");
    expect(bodies).not.toContain("MALLORY_NOTE"); // same room, different owner — never leaks
  });

  /* ----------------------------------------------------------------------- */
  /* T9 — READ-ONLY: consume mutates nothing but the use counter            */
  /* ----------------------------------------------------------------------- */
  it("T9 read-only: consume does not alter, create, or delete any note", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "ro-room", roomCode: "RORO01" });
    await joinAsMember(t, eventId, ALICE_SESSION);
    const noteId = await seedNote(t, {
      ownerKey: ALICE_SESSION,
      eventId,
      title: "untouched",
      bodyHtml: "<p>ORIGINAL</p>",
    });
    const minted = await t.mutation(api.scratchnodeHandoff.mintEventHandoffToken, {
      slug: "ro-room",
      sessionId: ALICE_SESSION,
    });

    const before = await t.run(async (ctx: any) => ctx.db.get(noteId));
    await t.mutation(api.scratchnodeHandoff.consumeEventHandoffToken, { token: minted.token });
    const after = await t.run(async (ctx: any) => ctx.db.get(noteId));

    expect(after.title).toBe(before.title);
    expect(after.bodyHtml).toBe(before.bodyHtml);
    expect(after.updatedAt).toBe(before.updatedAt); // not touched
    const allNotes = await t.run(async (ctx: any) => ctx.db.query("userNotes").take(50));
    expect(allNotes.length).toBe(1); // no note created or deleted
  });

  /* ----------------------------------------------------------------------- */
  /* T10 — PHANTOM EVENT                                                      */
  /* ----------------------------------------------------------------------- */
  it("T10 phantom-event: minting against a non-existent slug fails closed", async () => {
    const t = convexTest(schema, convexModules);
    await expect(
      t.mutation(api.scratchnodeHandoff.mintEventHandoffToken, {
        slug: "ghost-room-does-not-exist",
        sessionId: ALICE_SESSION,
      }),
    ).rejects.toThrow(/event_not_found|could not be found/i);
  });

  /* ----------------------------------------------------------------------- */
  /* JANITOR — bounded eviction (BOUND)                                       */
  /* ----------------------------------------------------------------------- */
  it("janitor evicts ONLY expired token rows, leaving live ones intact", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "janitor-room", roomCode: "JAN001" });
    await joinAsMember(t, eventId, ALICE_SESSION);
    // One live token.
    await t.mutation(api.scratchnodeHandoff.mintEventHandoffToken, {
      slug: "janitor-room",
      sessionId: ALICE_SESSION,
    });
    // One already-expired token (insert directly).
    await t.run(async (ctx: any) =>
      ctx.db.insert("liveEventHandoffTokens", {
        tokenHash: "deadbeef".repeat(8),
        eventId,
        boundOwnerKey: ALICE_SESSION,
        boundOwnerKeyHash: "cafef00d".repeat(8),
        scope: "private_notes_read",
        createdAt: NOW - 1_000_000,
        expiresAt: Date.now() - 1,
        usedCount: 0,
        maxUses: 5,
      }),
    );

    const res = await t.mutation(internal.scratchnodeHandoff._evictExpiredHandoffTokens, {});
    expect(res.evicted).toBe(1);
    const remaining = await t.run(async (ctx: any) =>
      ctx.db.query("liveEventHandoffTokens").take(10),
    );
    expect(remaining.length).toBe(1); // the live token survived
  });
});
