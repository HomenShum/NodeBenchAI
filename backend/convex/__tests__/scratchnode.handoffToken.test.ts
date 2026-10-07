/// <reference types="vite/client" />
/**
 * ADVERSARIAL scenario tests for the cross-domain private-notes handoff token
 * (roadmap #4). This is SECURITY code — the token is the entire access boundary
 * for a guest's private notes across an origin boundary, so the tests are written
 * as attacks: forge, replay, expire, escalate across events, and try to recover
 * the session id. Each must fail closed.
 *
 * Persona framing: an attendee ("Mara") legitimately hands off her own notes; an
 * attacker ("Eve") tries every way to read Mara's notes without her session.
 *
 * Runs the real Convex transaction engine via convex-test so the membership gate,
 * indexes, TTL, and use-count behave exactly as in production.
 */
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
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
const MARA = "mara-session-uuid-aaaaaaaa";
const EVE = "eve-session-uuid-bbbbbbbb";

async function seedEvent(t: any, slug: string, roomCode: string) {
  return await t.run(async (ctx: any) =>
    ctx.db.insert("liveEvents", { slug, name: `${slug} event`, roomCode, status: "live", startedAt: NOW }),
  );
}
async function seedMember(t: any, eventId: any, sessionId: string) {
  await t.run(async (ctx: any) =>
    ctx.db.insert("liveEventMembers", {
      eventId, sessionId, displayName: "Member", joinedAt: NOW, lastSeenAt: NOW,
    }),
  );
}
async function seedNote(t: any, eventId: any, ownerKey: string, title: string, body: string) {
  await t.run(async (ctx: any) =>
    ctx.db.insert("userNotes", {
      ownerKey, eventId, title, bodyHtml: body, tags: [], pinned: false, isAsk: false,
      createdAt: NOW, updatedAt: NOW,
    }),
  );
}

describe.skipIf(!convexTestAvailable)("ScratchNode private-notes handoff token (#4)", () => {
  it("happy path: a member mints, and consume returns only her own event notes", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, "rooftop", "ROOF01");
    await seedMember(t, eventId, MARA);
    await seedNote(t, eventId, MARA, "Mara note 1", "SECRET_MARA_BODY");

    const mint = await t.mutation(api.eventHandoff.mintEventHandoffToken, { slug: "rooftop", sessionId: MARA });
    expect(mint.ok).toBe(true);
    expect(typeof mint.token).toBe("string");
    expect(mint.token.length).toBeGreaterThanOrEqual(40);
    expect(mint.noteCount).toBe(1);

    const got = await t.mutation(api.eventHandoff.consumeEventHandoffToken, { token: mint.token });
    expect(got.ok).toBe(true);
    expect(got.eventName).toBe("rooftop event");
    expect(got.notes).toHaveLength(1);
    expect(got.notes[0].title).toBe("Mara note 1");
    expect(got.notes[0].bodyHtml).toContain("SECRET_MARA_BODY");
  });

  it("NON-MEMBER cannot mint a token for an event (fail-closed)", async () => {
    const t = convexTest(schema, convexModules);
    await seedEvent(t, "rooftop", "ROOF01"); // Eve is NOT seeded as a member
    await expect(
      t.mutation(api.eventHandoff.mintEventHandoffToken, { slug: "rooftop", sessionId: EVE }),
    ).rejects.toThrow();
  });

  it("the token NEVER stores or exposes the raw session id (no permanent credential)", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, "rooftop", "ROOF01");
    await seedMember(t, eventId, MARA);
    await seedNote(t, eventId, MARA, "n", "b");
    const mint = await t.mutation(api.eventHandoff.mintEventHandoffToken, { slug: "rooftop", sessionId: MARA });

    const row: any = await t.run(async (ctx: any) =>
      ctx.db.query("liveEventHandoffTokens").withIndex("by_token", (q: any) => q.eq("token", mint.token)).first(),
    );
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(MARA); // raw session id is nowhere in the row
    expect(row.boundSessionHash).not.toBe(MARA);
    expect(row.boundSessionHash.length).toBe(64); // SHA-256 hex
    // consume also never returns the session id / hash / token
    const got: any = await t.mutation(api.eventHandoff.consumeEventHandoffToken, { token: mint.token });
    expect(JSON.stringify(got)).not.toContain(MARA);
    expect(JSON.stringify(got)).not.toContain(row.boundSessionHash);
  });

  it("an EXPIRED token is denied (fail-closed)", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, "rooftop", "ROOF01");
    await seedMember(t, eventId, MARA);
    const mint = await t.mutation(api.eventHandoff.mintEventHandoffToken, { slug: "rooftop", sessionId: MARA });
    // Force-expire the row.
    await t.run(async (ctx: any) => {
      const row = await ctx.db.query("liveEventHandoffTokens").withIndex("by_token", (q: any) => q.eq("token", mint.token)).first();
      await ctx.db.patch(row._id, { expiresAt: NOW - 1 });
    });
    const got = await t.mutation(api.eventHandoff.consumeEventHandoffToken, { token: mint.token });
    expect(got.ok).toBe(false);
    expect(got.reason).toBe("expired");
  });

  it("a USED-UP token is denied (replay bound)", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, "rooftop", "ROOF01");
    await seedMember(t, eventId, MARA);
    const mint = await t.mutation(api.eventHandoff.mintEventHandoffToken, { slug: "rooftop", sessionId: MARA });
    await t.run(async (ctx: any) => {
      const row = await ctx.db.query("liveEventHandoffTokens").withIndex("by_token", (q: any) => q.eq("token", mint.token)).first();
      await ctx.db.patch(row._id, { usedCount: row.maxUses });
    });
    const got = await t.mutation(api.eventHandoff.consumeEventHandoffToken, { token: mint.token });
    expect(got.ok).toBe(false);
    expect(got.reason).toBe("used_up");
  });

  it("a FORGED / unknown token is denied (fail-closed)", async () => {
    const t = convexTest(schema, convexModules);
    await seedEvent(t, "rooftop", "ROOF01");
    const got = await t.mutation(api.eventHandoff.consumeEventHandoffToken, {
      token: "totally-made-up-token-that-does-not-exist-0001",
    });
    expect(got.ok).toBe(false);
    expect(got.reason).toBe("invalid");
  });

  it("a token for event A never yields event B's notes (event-scoped, cross-event isolation)", async () => {
    const t = convexTest(schema, convexModules);
    const eventA = await seedEvent(t, "event-a", "EVTA01");
    const eventB = await seedEvent(t, "event-b", "EVTB01");
    await seedMember(t, eventA, MARA);
    await seedMember(t, eventB, MARA);
    await seedNote(t, eventA, MARA, "A note", "EVENT_A_ONLY");
    await seedNote(t, eventB, MARA, "B note", "EVENT_B_SECRET");

    const mintA = await t.mutation(api.eventHandoff.mintEventHandoffToken, { slug: "event-a", sessionId: MARA });
    const got = await t.mutation(api.eventHandoff.consumeEventHandoffToken, { token: mintA.token });
    expect(got.ok).toBe(true);
    const bodies = (got.notes || []).map((n: any) => n.bodyHtml).join(" ");
    expect(bodies).toContain("EVENT_A_ONLY");
    expect(bodies).not.toContain("EVENT_B_SECRET"); // never leaks the other event
  });

  it("minting twice for the same member refreshes one token (no table spam)", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, "rooftop", "ROOF01");
    await seedMember(t, eventId, MARA);
    const first = await t.mutation(api.eventHandoff.mintEventHandoffToken, { slug: "rooftop", sessionId: MARA });
    const second = await t.mutation(api.eventHandoff.mintEventHandoffToken, { slug: "rooftop", sessionId: MARA });
    expect(second.token).toBe(first.token); // reused, not a fresh row
    const count = await t.run(async (ctx: any) => (await ctx.db.query("liveEventHandoffTokens").collect()).length);
    expect(count).toBe(1);
  });
});
