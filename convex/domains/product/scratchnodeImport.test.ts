/// <reference types="vite/client" />
/**
 * Scenario tests for the ScratchNode event → NodeBench WORKSPACE import
 * (roadmap #3, slice 1) — convex/domains/product/scratchnodeImport.ts.
 *
 * Per .claude/rules/scenario_testing.md: each test names a real persona + goal
 * + prior state + actions + expected outcome. Runs the real Convex transaction
 * engine via convex-test so the by_owner_entity_kind idempotency index +
 * by_event_status published-only ordering behave exactly as in production.
 *
 * The contract under test:
 *   - happy import: a published wiki → ONE editable product document under the
 *     caller's FRESH NodeBench-origin anon identity, with Q&A + sources blocks.
 *   - idempotency: re-importing the SAME published version is a no-op (no dup
 *     document, alreadyImported:true).
 *   - re-publish: a NEWER published version creates a new revision on the SAME
 *     document (not a second document).
 *   - honesty: unpublished / draft / unknown slug → ok:false no-op (no
 *     fabricated empty recap, no document written).
 *   - PRIVACY: the importer NEVER reads or writes private-note content
 *     (userNotes); private bodies never reach the imported document.
 */
import { describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";

// convex-test maps function modules by their convex-root-relative path
// (e.g. "domains/product/scratchnodeImport"). Vite's import.meta.glob keys are
// relative to THIS file's directory ("./scratchnodeImport.ts"), which would
// resolve to the wrong function path. The convex/__tests__ suites sit one level
// under convex/ so their "../**" keys happen to root correctly; this file sits
// two levels deeper, so we re-root each key from the test dir back to convex/.
const DIR_SEGMENTS = ["domains", "product"]; // this test file's dir under convex/
function rerootGlobKey(key: string): string {
  const parts = key.replace(/^\.\//, "").split("/");
  const base = [...DIR_SEGMENTS];
  while (parts[0] === "..") {
    parts.shift();
    base.pop();
  }
  return [...base, ...parts].join("/");
}
const convexModules = Object.fromEntries(
  Object.entries(import.meta.glob("../../**/*.{ts,js}")).map(([key, loader]) => [
    rerootGlobKey(key),
    loader,
  ]),
);

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
const importApi = (api as any).domains.product.scratchnodeImport;

async function seedEvent(t: any, opts: { slug: string; roomCode: string; name?: string }) {
  return await t.run(async (ctx: any) =>
    ctx.db.insert("liveEvents", {
      slug: opts.slug,
      name: opts.name ?? `${opts.slug} event`,
      roomCode: opts.roomCode,
      status: "live",
      startedAt: NOW,
    }),
  );
}

async function seedSource(
  t: any,
  eventId: any,
  opts: { uri: string; title: string; excerpt: string; body: string },
) {
  return await t.run(async (ctx: any) =>
    ctx.db.insert("liveEventSources", {
      eventId,
      uri: opts.uri,
      kind: "doc",
      title: opts.title,
      excerpt: opts.excerpt,
      body: opts.body,
      sourceHash: `hash-${opts.uri}`,
      isSeeded: false,
      uploadedAt: NOW,
    }),
  );
}

async function seedAnswer(
  t: any,
  eventId: any,
  opts: { question: string; body: string; sourceIds: any[] },
) {
  return await t.run(async (ctx: any) => {
    // liveEventAnswers.questionMessageId is required; seed a throwaway message.
    const messageId = await ctx.db.insert("liveEventMessages", {
      eventId,
      sessionId: "seed-session",
      displayName: "Seed",
      text: opts.question,
      kind: "ask",
      createdAt: NOW,
    });
    return await ctx.db.insert("liveEventAnswers", {
      eventId,
      questionMessageId: messageId,
      question: opts.question,
      normalizedQuestion: opts.question.toLowerCase(),
      body: opts.body,
      sourceIds: opts.sourceIds,
      trace: [],
      cacheHit: false,
      faqStatus: "promoted",
      createdAt: NOW,
    });
  });
}

async function seedWiki(
  t: any,
  eventId: any,
  opts: {
    version: number;
    status: "draft" | "published";
    answerIds?: any[];
    sourceIds?: any[];
    bodyHtml?: string;
  },
) {
  return await t.run(async (ctx: any) =>
    ctx.db.insert("liveEventWikiVersions", {
      eventId,
      version: opts.version,
      status: opts.status,
      title: "Event Wiki",
      bodyHtml: opts.bodyHtml ?? "<h1>recap</h1>",
      sourceAnswerIds: opts.answerIds ?? [],
      sourceIds: opts.sourceIds ?? [],
      createdByOwnerKey: "hk1:host-key-never-imported",
      createdAt: NOW + opts.version,
      publishedAt: opts.status === "published" ? NOW + opts.version : undefined,
    }),
  );
}

/** Read all productDocuments + their blocks for an anon owner. */
async function readOwnerDocuments(t: any, anonymousSessionId: string) {
  const ownerKey = `anon:${anonymousSessionId}`;
  return await t.run(async (ctx: any) => {
    const documents = await ctx.db
      .query("productDocuments")
      .withIndex("by_owner_updated", (q: any) => q.eq("ownerKey", ownerKey))
      .collect();
    const out: any[] = [];
    for (const doc of documents) {
      const blocks = await ctx.db
        .query("productDocumentBlocks")
        .withIndex("by_document_order", (q: any) => q.eq("documentId", doc._id))
        .collect();
      out.push({ doc, blocks });
    }
    return out;
  });
}

describe.skipIf(!convexTestAvailable)("ScratchNode event import — importPublishedWiki", () => {
  it("Maya (attended a launch) imports the published recap and gets an editable NodeBench doc", async () => {
    // Persona: Maya joined a room on scratchnode.live and now wants the public
    // recap saved in her NodeBench workspace under her own anon identity.
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "rooftop-launch", roomCode: "ROOF01", name: "Rooftop Launch" });
    const sourceId = await seedSource(t, eventId, {
      uri: "https://example.com/launch-deck",
      title: "Launch deck",
      excerpt: "Pricing and GA timeline.",
      body: "Full launch deck body.",
    });
    const answerId = await seedAnswer(t, eventId, {
      question: "When does GA ship?",
      body: "GA ships next quarter per the launch deck.",
      sourceIds: [sourceId],
    });
    await seedWiki(t, eventId, { version: 1, status: "published", answerIds: [answerId], sourceIds: [sourceId] });

    const sessionId = "maya-anon-001";
    const result = await t.mutation(importApi.importPublishedWiki, {
      slug: "rooftop-launch",
      anonymousSessionId: sessionId,
    });

    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(result.alreadyImported).toBe(false);
    expect(result.documentId).toBeTruthy();

    const owned = await readOwnerDocuments(t, sessionId);
    expect(owned).toHaveLength(1);
    const { doc, blocks } = owned[0];
    expect(doc.kind).toBe("entity_memory");
    expect(doc.title).toBe("Rooftop Launch — recap");
    // The Q&A and source content must have made it into editable blocks.
    const blockText = blocks.map((b: any) => b.text).join("\n");
    expect(blockText).toContain("When does GA ship?");
    expect(blockText).toContain("GA ships next quarter");
    expect(blockText).toContain("Launch deck");

    // The canonical event entity must exist, owner-private, type "event".
    const entity = await t.run(async (ctx: any) =>
      ctx.db.get(doc.entityId),
    );
    expect(entity.entityType).toBe("event");
    expect(entity.visibility).toBe("private");
    expect(entity.ownerKey).toBe(`anon:${sessionId}`);
  });

  it("re-importing the SAME published version is a no-op (idempotent — no duplicate doc)", async () => {
    // Persona: Maya double-taps the import button / reloads and clicks again.
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "design-jam", roomCode: "JAM01" });
    await seedWiki(t, eventId, { version: 1, status: "published" });

    const sessionId = "maya-anon-002";
    const first = await t.mutation(importApi.importPublishedWiki, {
      slug: "design-jam",
      anonymousSessionId: sessionId,
    });
    const second = await t.mutation(importApi.importPublishedWiki, {
      slug: "design-jam",
      anonymousSessionId: sessionId,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.alreadyImported).toBe(true);
    expect(String(second.documentId)).toBe(String(first.documentId));

    // Exactly ONE document — no duplication.
    const owned = await readOwnerDocuments(t, sessionId);
    expect(owned).toHaveLength(1);
  });

  it("a NEWER published version creates a new revision on the SAME document (not a 2nd doc)", async () => {
    // Persona: the host publishes wiki v2 after Maya already imported v1; she
    // clicks "Update recap".
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "weekly-sync", roomCode: "WK01" });
    const v1Answer = await seedAnswer(t, eventId, {
      question: "Q1?",
      body: "old answer v1",
      sourceIds: [],
    });
    await seedWiki(t, eventId, { version: 1, status: "published", answerIds: [v1Answer] });

    const sessionId = "maya-anon-003";
    const first = await t.mutation(importApi.importPublishedWiki, {
      slug: "weekly-sync",
      anonymousSessionId: sessionId,
    });

    // Host publishes a newer version with fresh content.
    const v2Answer = await seedAnswer(t, eventId, {
      question: "Q2 NEW?",
      body: "fresh answer v2",
      sourceIds: [],
    });
    await seedWiki(t, eventId, { version: 2, status: "published", answerIds: [v2Answer] });

    const second = await t.mutation(importApi.importPublishedWiki, {
      slug: "weekly-sync",
      anonymousSessionId: sessionId,
    });

    expect(second.created).toBe(false);
    expect(second.alreadyImported).toBe(false); // a real update happened
    expect(String(second.documentId)).toBe(String(first.documentId));
    expect(second.wikiVersion).toBe(2);

    // Still ONE document, but body refreshed to v2 content and a 2nd snapshot.
    const owned = await readOwnerDocuments(t, sessionId);
    expect(owned).toHaveLength(1);
    const { doc, blocks } = owned[0];
    expect(doc.latestRevision).toBe(2);
    const blockText = blocks.map((b: any) => b.text).join("\n");
    expect(blockText).toContain("Q2 NEW?");
    expect(blockText).not.toContain("Q1?");

    const snapshots = await t.run(async (ctx: any) =>
      ctx.db
        .query("productDocumentSnapshots")
        .withIndex("by_document_revision", (q: any) => q.eq("documentId", doc._id))
        .collect(),
    );
    expect(snapshots).toHaveLength(2);
  });

  it("an UNPUBLISHED room returns an honest no-op — no document written", async () => {
    // Persona: someone clicks import on a room whose host never published a wiki.
    const t = convexTest(schema, convexModules);
    await seedEvent(t, { slug: "not-published", roomCode: "NOPE01" });

    const sessionId = "anon-004";
    const result = await t.mutation(importApi.importPublishedWiki, {
      slug: "not-published",
      anonymousSessionId: sessionId,
    });

    expect(result.ok).toBe(false);
    expect(result.documentId).toBeNull();
    expect(result.reason).toBe("no_published_wiki");
    const owned = await readOwnerDocuments(t, sessionId);
    expect(owned).toHaveLength(0);
  });

  it("a DRAFT-only wiki is never importable (published boundary)", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "draft-only", roomCode: "DRFT01" });
    await seedWiki(t, eventId, { version: 1, status: "draft" });

    const sessionId = "anon-005";
    const result = await t.mutation(importApi.importPublishedWiki, {
      slug: "draft-only",
      anonymousSessionId: sessionId,
    });
    expect(result.ok).toBe(false);
    expect((await readOwnerDocuments(t, sessionId))).toHaveLength(0);
  });

  it("an UNKNOWN slug returns an honest no-op (no fabricated room/recap)", async () => {
    const t = convexTest(schema, convexModules);
    const sessionId = "anon-006";
    const result = await t.mutation(importApi.importPublishedWiki, {
      slug: "ghost-room-9999",
      anonymousSessionId: sessionId,
    });
    expect(result.ok).toBe(false);
    expect(result.documentId).toBeNull();
    expect((await readOwnerDocuments(t, sessionId))).toHaveLength(0);
  });

  it("PRIVACY: the importer never reads or writes private-note content", async () => {
    // Persona: an attendee wrote a private note in the room ("SECRET salary
    // numbers"). The public recap import must NEVER surface it.
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "private-room", roomCode: "PRIV01" });

    // A private note exists for the room — owner-keyed, NOT part of the wiki.
    const PRIVATE_MARKER = "PRIVATE_SALARY_SECRET_DO_NOT_LEAK";
    await t.run(async (ctx: any) =>
      ctx.db.insert("userNotes", {
        ownerKey: "sn_session_some_attendee",
        eventId,
        title: "my private note",
        bodyHtml: `<p>${PRIVATE_MARKER}</p>`,
        tags: [],
        pinned: false,
        isAsk: false,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );

    // The published wiki contains only public answers.
    const answerId = await seedAnswer(t, eventId, {
      question: "What was announced publicly?",
      body: "Public answer with no secrets.",
      sourceIds: [],
    });
    await seedWiki(t, eventId, { version: 1, status: "published", answerIds: [answerId] });

    const sessionId = "anon-007";
    const result = await t.mutation(importApi.importPublishedWiki, {
      slug: "private-room",
      anonymousSessionId: sessionId,
    });
    expect(result.ok).toBe(true);

    const owned = await readOwnerDocuments(t, sessionId);
    expect(owned).toHaveLength(1);
    const { doc, blocks } = owned[0];
    const allText = `${doc.markdown}\n${doc.plainText}\n${blocks.map((b: any) => b.text).join("\n")}`;
    // The private marker must appear NOWHERE in the imported document.
    expect(allText).not.toContain(PRIVATE_MARKER);
    expect(allText).toContain("Public answer with no secrets.");

    // And the private note row itself was never re-owned or mutated.
    const privateNote = await t.run(async (ctx: any) =>
      ctx.db
        .query("userNotes")
        .withIndex("by_owner_event", (q: any) =>
          q.eq("ownerKey", "sn_session_some_attendee").eq("eventId", eventId),
        )
        .first(),
    );
    expect(privateNote).not.toBeNull();
    expect(privateNote.bodyHtml).toContain(PRIVATE_MARKER);
  });
});

describe.skipIf(!convexTestAvailable)("ScratchNode event import — getScratchnodeImportStatus", () => {
  it("reports not-imported before import, then imported + up-to-date after", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "status-room", roomCode: "STAT01" });
    await seedWiki(t, eventId, { version: 1, status: "published" });
    const sessionId = "anon-008";

    const before = await t.query(importApi.getScratchnodeImportStatus, {
      slug: "status-room",
      anonymousSessionId: sessionId,
    });
    expect(before.published).toBe(true);
    expect(before.imported).toBe(false);
    expect(before.entitySlug).toBeTruthy();

    await t.mutation(importApi.importPublishedWiki, {
      slug: "status-room",
      anonymousSessionId: sessionId,
    });

    const after = await t.query(importApi.getScratchnodeImportStatus, {
      slug: "status-room",
      anonymousSessionId: sessionId,
    });
    expect(after.published).toBe(true);
    expect(after.imported).toBe(true);
    expect(after.upToDate).toBe(true);
    expect(after.documentId).toBeTruthy();
  });

  it("an unknown slug reports not-published, not-imported (honest)", async () => {
    const t = convexTest(schema, convexModules);
    const status = await t.query(importApi.getScratchnodeImportStatus, {
      slug: "ghost-9999",
      anonymousSessionId: "anon-009",
    });
    expect(status.published).toBe(false);
    expect(status.imported).toBe(false);
    expect(status.documentId).toBeNull();
  });
});

describe.skipIf(!convexTestAvailable)("ScratchNode event import — getPublishedWikiStructuredBySlug", () => {
  it("returns structured Q&A + sources for a published wiki, public-safe only", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "struct-room", roomCode: "STR01", name: "Struct Room" });
    const sourceId = await seedSource(t, eventId, {
      uri: "https://example.com/x",
      title: "Source X",
      excerpt: "excerpt x",
      body: "body x",
    });
    const answerId = await seedAnswer(t, eventId, {
      question: "Question A?",
      body: "Answer A body.",
      sourceIds: [sourceId],
    });
    await seedWiki(t, eventId, {
      version: 3,
      status: "published",
      answerIds: [answerId],
      sourceIds: [sourceId],
    });

    const structured = await t.query(api.events.getPublishedWikiStructuredBySlug, {
      slug: "struct-room",
    });
    expect(structured).not.toBeNull();
    expect(structured.eventName).toBe("Struct Room");
    expect(structured.wikiVersion).toBe(3);
    expect(structured.answers).toEqual([{ question: "Question A?", body: "Answer A body." }]);
    expect(structured.sources).toEqual([
      { title: "Source X", uri: "https://example.com/x", excerpt: "excerpt x" },
    ]);
    // PRIVACY: never leak the host ownerKey.
    expect((structured as any).createdByOwnerKey).toBeUndefined();
  });

  it("a draft / unknown slug returns null (no fabricated structure)", async () => {
    const t = convexTest(schema, convexModules);
    const eventId = await seedEvent(t, { slug: "struct-draft", roomCode: "SD01" });
    await seedWiki(t, eventId, { version: 1, status: "draft" });
    expect(await t.query(api.events.getPublishedWikiStructuredBySlug, { slug: "struct-draft" })).toBeNull();
    expect(await t.query(api.events.getPublishedWikiStructuredBySlug, { slug: "nope-xyz" })).toBeNull();
  });
});
