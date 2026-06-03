/// <reference types="vite/client" />
/**
 * Scenario tests for the PUBLIC wiki read — events:getPublishedWikiBySlug.
 *
 * Per .claude/rules/scenario_testing.md — each test names a persona + goal +
 * prior state + actions + expected outcome. This query is the viral payoff of
 * "the room remembers everything": anyone with the link reads the published wiki
 * with NO account. The contract under test:
 *   - latest *published* version only (drafts / unpublished -> null, never a fake)
 *   - resolves by slug OR room code (same resolver the room uses)
 *   - returns ONLY public-safe fields (never the host ownerKey or internal ids)
 *
 * Runs the real Convex transaction engine via convex-test so indexes + ordering
 * behave exactly as in production.
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

async function seedWiki(
  t: any,
  eventId: any,
  opts: { version: number; status: "draft" | "published"; bodyHtml: string },
) {
  return await t.run(async (ctx: any) =>
    ctx.db.insert("liveEventWikiVersions", {
      eventId,
      version: opts.version,
      status: opts.status,
      title: `${opts.slug ?? "Event"} Wiki`,
      bodyHtml: opts.bodyHtml,
      sourceAnswerIds: [],
      sourceIds: [],
      createdByOwnerKey: "hk1:secret-owner-key-should-never-be-returned",
      createdAt: NOW,
      publishedAt: opts.status === "published" ? NOW : undefined,
    }),
  );
}

describe.skipIf(!convexTestAvailable)("ScratchNode public wiki — getPublishedWikiBySlug", () => {
  it("a friend who wasn't there opens the shared link and reads the published wiki (no account)", async () => {
    // Persona: someone who got a scratchnode.live/wiki/<slug> link in a group chat.
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "rooftop-launch", roomCode: "ROOF01" });
    await seedWiki(t, eventId, {
      version: 1,
      status: "published",
      bodyHtml: "<h1>Rooftop Launch</h1><p>PUBLIC_RECAP_CONTENT</p>",
    });

    const wiki = await t.query(api.events.getPublishedWikiBySlug, { slug: "rooftop-launch" });
    expect(wiki).not.toBeNull();
    expect(wiki.eventName).toBe("rooftop-launch event");
    expect(wiki.eventSlug).toBe("rooftop-launch");
    expect(wiki.roomCode).toBe("ROOF01");
    expect(wiki.version).toBe(1);
    expect(wiki.bodyHtml).toContain("PUBLIC_RECAP_CONTENT");
    // PRIVACY: the public read must NEVER leak host/internal fields.
    expect((wiki as any).createdByOwnerKey).toBeUndefined();
    expect((wiki as any).sourceIds).toBeUndefined();
    expect((wiki as any).sourceAnswerIds).toBeUndefined();
  });

  it("resolves by ROOM CODE too (same resolver the room uses)", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "design-jam", roomCode: "JAM777" });
    await seedWiki(t, eventId, { version: 1, status: "published", bodyHtml: "<p>jam recap</p>" });

    const byCode = await t.query(api.events.getPublishedWikiBySlug, { slug: "jam777" });
    expect(byCode).not.toBeNull();
    expect(byCode.eventSlug).toBe("design-jam");
  });

  it("serves the LATEST published version when several exist", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "weekly-sync", roomCode: "WEEK01" });
    await seedWiki(t, eventId, { version: 1, status: "published", bodyHtml: "<p>v1 old</p>" });
    await seedWiki(t, eventId, { version: 2, status: "published", bodyHtml: "<p>v2 NEWEST</p>" });

    const wiki = await t.query(api.events.getPublishedWikiBySlug, { slug: "weekly-sync" });
    expect(wiki.version).toBe(2);
    expect(wiki.bodyHtml).toContain("v2 NEWEST");
  });

  it("an event with no published wiki yet returns null (honest — never a fake empty wiki)", async () => {
    const t = convexTest(schema, convexModules);
    await seedEvent(t, { slug: "not-published", roomCode: "NOPE01" });
    const wiki = await t.query(api.events.getPublishedWikiBySlug, { slug: "not-published" });
    expect(wiki).toBeNull();
  });

  it("a DRAFT wiki version is never served publicly (only published)", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "draft-only", roomCode: "DRFT01" });
    await seedWiki(t, eventId, { version: 1, status: "draft", bodyHtml: "<p>not ready</p>" });
    const wiki = await t.query(api.events.getPublishedWikiBySlug, { slug: "draft-only" });
    expect(wiki).toBeNull();
  });

  it("a nonexistent slug returns null (no fabricated room)", async () => {
    const t = convexTest(schema, convexModules);
    const wiki = await t.query(api.events.getPublishedWikiBySlug, { slug: "ghost-room-9999" });
    expect(wiki).toBeNull();
  });
});
