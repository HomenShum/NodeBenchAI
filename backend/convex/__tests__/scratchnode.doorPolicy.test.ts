/// <reference types="vite/client" />
/**
 * Scenario tests for the ScratchNode DOOR POLICY (request-to-join rooms).
 *
 * Per .claude/rules/scenario_testing.md — each test names a persona + goal +
 * prior state + actions + expected outcome. The deterministic gate in joinEvent
 * is the security boundary; the LLM is advisory and never admits/rejects anyone,
 * so these tests assert the GATE + the host-decision lifecycle, not the model.
 *
 * Runs the real Convex transaction engine via convex-test so the gate, indexes,
 * and host-auth checks behave exactly as in production.
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
const GUEST = "guest-session-uuid-1111";

async function seedEvent(
  t: any,
  opts: { slug: string; roomCode: string; joinPolicy?: "open" | "request" },
) {
  return await t.run(async (ctx: any) => {
    const doc: any = {
      slug: opts.slug,
      name: opts.slug,
      roomCode: opts.roomCode,
      status: "live",
      startedAt: NOW,
    };
    if (opts.joinPolicy) doc.joinPolicy = opts.joinPolicy;
    return await ctx.db.insert("liveEvents", doc);
  });
}

// Seed a legacy-ownerKey host row directly (no HMAC secret needed — requireHost
// matches the liveEventHosts row by (eventId, ownerKey)).
async function seedHost(t: any, eventId: any, ownerKey: string) {
  await t.run(async (ctx: any) =>
    ctx.db.insert("liveEventHosts", {
      eventId,
      ownerKey,
      displayName: "Host",
      role: "owner",
      authMethod: "legacy_ownerkey",
      createdAt: NOW,
    }),
  );
}

const errBlob = (reason: any) =>
  JSON.stringify({ message: reason?.message ?? "", data: reason?.data ?? null });

describe.skipIf(!convexTestAvailable)("ScratchNode door policy — request-to-join gate", () => {
  it("open room: a guest joins freely (gate is a no-op)", async () => {
    // Persona: first-timer with a public room code. Goal: just get in.
    const t = convexTest(schema, convexModules);
    await seedEvent(t, { slug: "open-room", roomCode: "OPEN01" }); // joinPolicy unset = open
    const joined = await t.mutation(api.events.joinEvent, {
      slug: "open-room",
      sessionId: GUEST,
      displayName: "Guest",
    });
    expect(joined.slug).toBe("open-room");
    const members = await t.run(async (ctx: any) => ctx.db.query("liveEventMembers").collect());
    expect(members.length).toBe(1);
  });

  it("request room: a non-member guest is BLOCKED with join_requires_approval", async () => {
    // Persona: stranger trying to walk into a request-to-join room.
    const t = convexTest(schema, convexModules);
    await seedEvent(t, { slug: "req-room", roomCode: "REQ001", joinPolicy: "request" });
    let threw = false;
    try {
      await t.mutation(api.events.joinEvent, {
        slug: "req-room",
        sessionId: GUEST,
        displayName: "Stranger",
      });
    } catch (e) {
      threw = true;
      expect(errBlob(e)).toMatch(/join_requires_approval/);
    }
    expect(threw).toBe(true);
    const members = await t.run(async (ctx: any) => ctx.db.query("liveEventMembers").collect());
    expect(members.length).toBe(0); // never admitted
  });

  it("request → approve → join: the host admits the guest deterministically", async () => {
    // Persona: a relevant attendee asks; host approves; guest gets in.
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "approve-room", roomCode: "APP001", joinPolicy: "request" });
    const HOST_KEY = "host-owner-key-aaaaaaaa";
    await seedHost(t, eventId, HOST_KEY);

    const reqRes = await t.mutation(api.events.requestJoinEvent, {
      slug: "approve-room",
      sessionId: GUEST,
      displayName: "Relevant Attendee",
      note: "I'm speaking on the panel.",
    });
    expect(reqRes.status).toBe("pending");

    // Still blocked before approval.
    await expect(
      t.mutation(api.events.joinEvent, {
        slug: "approve-room",
        sessionId: GUEST,
        displayName: "Relevant Attendee",
      }),
    ).rejects.toBeTruthy();

    // Host sees exactly one pending request.
    const queue = await t.query(api.events.getJoinRequests, { eventId, ownerKey: HOST_KEY });
    expect(queue.pendingCount).toBe(1);
    const requestId = queue.pending[0].requestId;

    const dec = await t.mutation(api.events.approveJoinRequest, { eventId, requestId, ownerKey: HOST_KEY });
    expect(dec.status).toBe("approved");

    // Now the gate lets the guest through.
    const joined = await t.mutation(api.events.joinEvent, {
      slug: "approve-room",
      sessionId: GUEST,
      displayName: "Relevant Attendee",
    });
    expect(joined.slug).toBe("approve-room");
    const members = await t.run(async (ctx: any) =>
      ctx.db
        .query("liveEventMembers")
        .withIndex("by_event_session", (q: any) => q.eq("eventId", eventId).eq("sessionId", GUEST))
        .collect(),
    );
    expect(members.length).toBe(1);
  });

  it("deny: a denied guest stays out", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "deny-room", roomCode: "DEN001", joinPolicy: "request" });
    const HOST_KEY = "host-owner-key-bbbbbbbb";
    await seedHost(t, eventId, HOST_KEY);
    await t.mutation(api.events.requestJoinEvent, { slug: "deny-room", sessionId: GUEST, displayName: "Spammer" });
    const queue = await t.query(api.events.getJoinRequests, { eventId, ownerKey: HOST_KEY });
    await t.mutation(api.events.denyJoinRequest, {
      eventId,
      requestId: queue.pending[0].requestId,
      ownerKey: HOST_KEY,
    });
    await expect(
      t.mutation(api.events.joinEvent, { slug: "deny-room", sessionId: GUEST, displayName: "Spammer" }),
    ).rejects.toBeTruthy();
  });

  it("host-only: a non-host can never approve a request", async () => {
    // The LLM/guest can never self-admit; only a verified host flips status.
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "auth-room", roomCode: "AUTH01", joinPolicy: "request" });
    const HOST_KEY = "host-owner-key-cccccccc";
    await seedHost(t, eventId, HOST_KEY);
    await t.mutation(api.events.requestJoinEvent, { slug: "auth-room", sessionId: GUEST, displayName: "Guest" });
    const queue = await t.query(api.events.getJoinRequests, { eventId, ownerKey: HOST_KEY });
    const requestId = queue.pending[0].requestId;
    let threw = false;
    try {
      await t.mutation(api.events.approveJoinRequest, {
        eventId,
        requestId,
        ownerKey: "not-the-host-zzzz",
      });
    } catch (e) {
      threw = true;
      expect(errBlob(e)).toMatch(/not_host|host/i);
    }
    expect(threw).toBe(true);
  });

  it("idempotent: repeated requests keep a single pending row (latest name wins)", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "idem-room", roomCode: "IDEM01", joinPolicy: "request" });
    await t.mutation(api.events.requestJoinEvent, { slug: "idem-room", sessionId: GUEST, displayName: "Guest" });
    await t.mutation(api.events.requestJoinEvent, { slug: "idem-room", sessionId: GUEST, displayName: "Guest Renamed" });
    const rows = await t.run(async (ctx: any) =>
      ctx.db
        .query("liveEventJoinRequests")
        .withIndex("by_event_session", (q: any) => q.eq("eventId", eventId).eq("sessionId", GUEST))
        .collect(),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].displayName).toBe("Guest Renamed");
  });
});
