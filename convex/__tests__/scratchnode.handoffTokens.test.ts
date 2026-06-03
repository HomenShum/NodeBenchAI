/// <reference types="vite/client" />
/**
 * Scenario tests for ScratchNode -> NodeBench private-note handoff tokens.
 *
 * The security contract is narrow: a joined ScratchNode session can mint a
 * short-lived opaque token, NodeBench can consume that token once/few times to
 * read that session's event notes, and the raw session id never travels in the
 * URL or returned payload.
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
const SESSION_ID = "sess_guest_private_notes_12345";

async function seedJoinedEvent(t: any) {
  return await t.run(async (ctx: any) => {
    const eventId = await ctx.db.insert("liveEvents", {
      slug: "founder-dinner",
      name: "Founder Dinner",
      roomCode: "DINNER1",
      status: "live",
      startedAt: NOW,
    });
    await ctx.db.insert("liveEventMembers", {
      eventId,
      sessionId: SESSION_ID,
      displayName: "Guest",
      joinedAt: NOW,
      lastSeenAt: NOW,
    });
    await ctx.db.insert("userNotes", {
      ownerKey: SESSION_ID,
      eventId,
      title: "Pricing concern",
      bodyHtml: "PRIVATE_PRICING_CONCERN",
      tags: ["pricing"],
      pinned: false,
      isAsk: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    return eventId;
  });
}

const errBlob = (reason: any) =>
  JSON.stringify({ message: reason?.message ?? "", data: reason?.data ?? null });

describe.skipIf(!convexTestAvailable)("ScratchNode handoff tokens", () => {
  it("joined guest mints an opaque token and NodeBench consumes only that guest's event notes", async () => {
    const t = convexTest(schema, convexModules);
    await seedJoinedEvent(t);

    const minted = await t.mutation(api.scratchnodeHandoff.mintEventHandoffToken, {
      slug: "founder-dinner",
      sessionId: SESSION_ID,
    });
    expect(minted.token).toEqual(expect.any(String));
    expect(minted.token).not.toContain(SESSION_ID);
    expect(minted.expiresAt).toBeGreaterThan(Date.now());

    const tokenRows = await t.run(async (ctx: any) =>
      ctx.db.query("liveEventHandoffTokens").collect(),
    );
    expect(tokenRows).toHaveLength(1);
    expect(tokenRows[0].tokenHash).not.toBe(minted.token);
    expect(tokenRows[0].scope).toBe("private_notes_read");

    const consumed = await t.mutation(api.scratchnodeHandoff.consumeEventHandoffToken, {
      token: minted.token,
    });
    expect(consumed).toMatchObject({
      eventName: "Founder Dinner",
      eventSlug: "founder-dinner",
      roomCode: "DINNER1",
      scope: "private_notes_read",
      noteCount: 1,
      _truncated: false,
    });
    expect(consumed.notes[0].bodyHtml).toBe("PRIVATE_PRICING_CONCERN");
    expect(JSON.stringify(consumed)).not.toContain(SESSION_ID);
  });

  it("non-member cannot mint a token for someone else's event", async () => {
    const t = convexTest(schema, convexModules);
    await seedJoinedEvent(t);

    await expect(
      t.mutation(api.scratchnodeHandoff.mintEventHandoffToken, {
        slug: "founder-dinner",
        sessionId: "sess_not_joined_99999",
      }),
    ).rejects.toSatisfy((e: any) => /not_a_member/.test(errBlob(e)));
  });

  it("invalid consume token fails closed without returning notes", async () => {
    const t = convexTest(schema, convexModules);
    await seedJoinedEvent(t);

    await expect(
      t.mutation(api.scratchnodeHandoff.consumeEventHandoffToken, {
        token: "definitely-not-a-real-token-value",
      }),
    ).rejects.toSatisfy((e: any) => /invalid_token/.test(errBlob(e)));
  });
});
