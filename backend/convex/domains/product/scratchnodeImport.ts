/**
 * convex/domains/product/scratchnodeImport.ts — ScratchNode event → NodeBench
 * WORKSPACE import (roadmap #3, slice 1).
 *
 * Pattern: public-data-only projection import.
 * Prior art:
 *   - .claude/rules/scratchpad_first.md — structured output derives from a
 *     durable source; the published wiki IS that source here.
 *   - .claude/rules/layered_memory.md — anon-keyed per-user document layer.
 *   - convex/domains/product/documents.ts — the editable productDocuments /
 *     productDocumentBlocks / productDocumentSnapshots primitive we reuse.
 *
 * What this does
 * --------------
 * Takes a published ScratchNode event wiki (public, no private notes) and
 * materializes it as ONE editable NodeBench product document under a FRESH
 * NodeBench-origin anonymous product identity (NOT the cross-domain
 * sn_session_id). The document lives in the same productDocuments table the
 * entity notebook uses, so the EXISTING merge-on-sign-in path
 * (convex/domains/product/bootstrap.ts → claimAnonymousProductWorkspace)
 * automatically re-owns it from `anon:<sessionId>` to `user:<id>` when the
 * visitor later signs in. No bespoke merge code.
 *
 * Privacy invariants (release-blocker)
 * ------------------------------------
 *   - PUBLIC-DATA-ONLY. We read ONLY the published wiki snapshot via
 *     `loadStructuredPublishedWiki` (published-only; private notes excluded at
 *     publish time). We NEVER read userNotes / liveEventNoteAnchors, and we
 *     NEVER write under another user's ownerKey.
 *   - The created document is owned by the resolved anon (or signed-in)
 *     product identity — never the ScratchNode host ownerKey.
 *
 * Idempotency (agentic_reliability: DETERMINISTIC)
 * ------------------------------------------------
 *   - A stable entity slug `scratchnode-event-<hash(eventId)>` maps every
 *     re-import of the same event to the SAME entity + document.
 *   - A per-import key `hash(eventId|wikiVersion|ownerKey)` is recorded on the
 *     import event. Re-importing the SAME published version is a no-op that
 *     returns the existing document (`alreadyImported: true`). A NEWER
 *     published version writes a fresh snapshot/revision on the same document
 *     (reusing the existing revision/snapshot path — no duplicate doc).
 *
 * We intentionally do NOT do fuzzy company/person entity extraction here
 * (avoids fabricated entities). Only the canonical event entity is created.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import {
  requireProductIdentity,
  resolveProductIdentitySafely,
  summarizeText,
} from "./helpers";
import {
  loadStructuredPublishedWiki,
  type StructuredPublishedWiki,
} from "../../events";
import { normalizeProductDocumentBlocks } from "./documents";
import { composeSearchableText } from "../search/federatedHelpers";

// BOUND (agentic_reliability): hard ceilings so a hostile/huge wiki can never
// blow the mutation budget. The structured reader already caps answers/sources,
// but we cap again at the write boundary (defense in depth).
const MAX_IMPORT_ANSWERS = 20;
const MAX_IMPORT_SOURCES = 20;
const MAX_BLOCK_TEXT = 4_000;

/**
 * FNV-1a 32-bit — same stable, dependency-free hash used in convex/events.ts.
 * Deterministic across runs (DETERMINISTIC invariant), good enough for
 * collision-resistant idempotency keys at room scale.
 */
function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function importEntitySlug(eventId: string): string {
  return `scratchnode-event-${stableHash(eventId)}`;
}

function importKey(eventId: string, wikiVersion: number, ownerKey: string): string {
  return stableHash(`${eventId}|${wikiVersion}|${ownerKey}`);
}

/**
 * Build the recap document body as normalized editable blocks from the
 * structured published wiki. Deterministic: same wiki → same blocks → same
 * markdown. No private data — input is the published snapshot only.
 */
function buildRecapBlocks(wiki: StructuredPublishedWiki) {
  const raw: Array<{
    blockId: string;
    order: number;
    type: "paragraph" | "heading" | "bullet" | "quote" | "check" | "code";
    text: string;
    markdown?: string;
  }> = [];
  let order = 0;

  raw.push({
    blockId: "recap-title",
    order: order++,
    type: "heading",
    text: `${wiki.eventName} — recap`,
    markdown: `# ${wiki.eventName} — recap`,
  });
  raw.push({
    blockId: "recap-intro",
    order: order++,
    type: "paragraph",
    text: "Imported from the published ScratchNode event wiki (public answers and public sources only). Private notes are not included.",
    markdown:
      "Imported from the published ScratchNode event wiki (public answers and public sources only). Private notes are not included.",
  });

  const answers = wiki.answers.slice(0, MAX_IMPORT_ANSWERS);
  if (answers.length > 0) {
    raw.push({
      blockId: "recap-qa-heading",
      order: order++,
      type: "heading",
      text: "Q&A",
      markdown: "## Q&A",
    });
    answers.forEach((answer, index) => {
      const question = String(answer.question || "").trim().slice(0, MAX_BLOCK_TEXT);
      const body = String(answer.body || "").trim().slice(0, MAX_BLOCK_TEXT);
      if (question) {
        raw.push({
          blockId: `recap-q-${index}`,
          order: order++,
          type: "heading",
          text: question,
          markdown: `### ${question}`,
        });
      }
      if (body) {
        raw.push({
          blockId: `recap-a-${index}`,
          order: order++,
          type: "paragraph",
          text: body,
          markdown: body,
        });
      }
    });
  }

  const sources = wiki.sources.slice(0, MAX_IMPORT_SOURCES);
  if (sources.length > 0) {
    raw.push({
      blockId: "recap-sources-heading",
      order: order++,
      type: "heading",
      text: "Sources",
      markdown: "## Sources",
    });
    sources.forEach((source, index) => {
      const title = String(source.title || "").trim().slice(0, MAX_BLOCK_TEXT);
      const excerpt = String(source.excerpt || "").trim().slice(0, MAX_BLOCK_TEXT);
      const label = title || source.uri || "Source";
      const text = excerpt ? `${label} — ${excerpt}` : label;
      raw.push({
        blockId: `recap-source-${index}`,
        order: order++,
        type: "bullet",
        text: text.slice(0, MAX_BLOCK_TEXT),
        markdown: source.uri ? `- **${label}** — ${excerpt || source.uri}` : `- ${text}`,
      });
    });
  }

  return normalizeProductDocumentBlocks(raw);
}

function blocksToMarkdown(blocks: ReturnType<typeof normalizeProductDocumentBlocks>) {
  return blocks.map((block) => block.markdown || block.text).filter(Boolean).join("\n\n").trim();
}

function blocksToPlainText(blocks: ReturnType<typeof normalizeProductDocumentBlocks>) {
  return blocks.map((block) => block.text).filter(Boolean).join("\n\n").trim();
}

async function getImportDocument(
  ctx: any,
  ownerKey: string,
  entitySlug: string,
): Promise<Doc<"productDocuments"> | null> {
  return await ctx.db
    .query("productDocuments")
    .withIndex("by_owner_entity_kind", (q: any) =>
      q.eq("ownerKey", ownerKey).eq("entitySlug", entitySlug).eq("kind", "entity_memory"),
    )
    .first();
}

/**
 * Has THIS owner already imported THIS (eventId, wikiVersion)? We look at the
 * import-event ledger on the document. Bounded scan (most recent 25 events).
 */
async function findPriorImportEvent(
  ctx: any,
  documentId: Id<"productDocuments">,
  key: string,
): Promise<Doc<"productDocumentEvents"> | null> {
  const events = await ctx.db
    .query("productDocumentEvents")
    .withIndex("by_document_created", (q: any) => q.eq("documentId", documentId))
    .order("desc")
    .take(25); // BOUND
  for (const event of events) {
    if (event.type === "imported" && event.metadata?.scratchnodeImportKey === key) {
      return event;
    }
  }
  return null;
}

export const importPublishedWiki = mutation({
  args: {
    slug: v.string(),
    anonymousSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Resolve the FRESH NodeBench-origin product identity (anon or signed-in).
    // This NEVER trusts a client-supplied ownerKey and NEVER uses the
    // cross-domain sn_session_id. requireProductIdentity throws if there is
    // neither an auth session nor an anonymous session — HONEST_STATUS: no
    // silent success without an owner to attribute the import to.
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey;

    // PUBLIC-DATA-ONLY read of the published wiki snapshot. Returns null for
    // unknown slug / unpublished / draft — those are honest no-ops below.
    const wiki = await loadStructuredPublishedWiki(ctx, args.slug);
    if (!wiki) {
      return {
        ok: false as const,
        documentId: null,
        created: false,
        alreadyImported: false,
        reason: "no_published_wiki" as const,
      };
    }

    const now = Date.now();
    const entitySlug = importEntitySlug(wiki.eventId);
    const key = importKey(wiki.eventId, wiki.wikiVersion, ownerKey);
    const title = `${wiki.eventName} — recap`;

    // ── Idempotency check ─────────────────────────────────────────────────
    const existingDocument = await getImportDocument(ctx, ownerKey, entitySlug);
    if (existingDocument) {
      const prior = await findPriorImportEvent(ctx, existingDocument._id, key);
      if (prior) {
        // Same owner, same event, SAME published version → no-op. Never
        // rewrite the user's possibly-edited doc on a duplicate import.
        return {
          ok: true as const,
          documentId: existingDocument._id,
          entitySlug,
          created: false,
          alreadyImported: true,
          wikiVersion: wiki.wikiVersion,
        };
      }
    }

    // ── Ensure the canonical event entity (one per imported event) ────────
    let entity = await ctx.db
      .query("productEntities")
      .withIndex("by_owner_slug", (q: any) => q.eq("ownerKey", ownerKey).eq("slug", entitySlug))
      .first();
    const entitySummary = summarizeText(
      `Recap imported from the ScratchNode event "${wiki.eventName}" (room ${wiki.roomCode}).`,
      `${wiki.eventName} recap`,
    );
    if (!entity) {
      const entityId = await ctx.db.insert("productEntities", {
        ownerKey,
        slug: entitySlug,
        name: wiki.eventName,
        entityType: "event",
        summary: entitySummary,
        savedBecause: "scratchnode recap",
        latestRevision: 0,
        reportCount: 0,
        // Owner-private by default: an imported anon recap is the visitor's
        // own working copy, not public-research-derived federated content.
        visibility: "private",
        searchableText: composeSearchableText([
          wiki.eventName,
          entitySlug,
          entitySummary,
          "scratchnode recap",
        ]),
        createdAt: now,
        updatedAt: now,
      });
      // Schedule per-row embedding (same hook the entity upsert path uses).
      await ctx.scheduler.runAfter(
        0,
        internal.domains.search.embedRowOnUpdate.embedEntityRow,
        { entityId },
      );
      entity = await ctx.db.get(entityId);
    }
    if (!entity) {
      // HONEST_STATUS: surface a real failure rather than a fake success.
      throw new Error("Could not create event entity for ScratchNode import");
    }

    // ── Build the document body from the published snapshot ───────────────
    const blocks = buildRecapBlocks(wiki);
    const markdown = blocksToMarkdown(blocks);
    const plainText = blocksToPlainText(blocks);

    const created = !existingDocument;
    const nextRevision = (existingDocument?.latestRevision ?? 0) + 1;

    const documentId =
      existingDocument?._id ??
      (await ctx.db.insert("productDocuments", {
        ownerKey,
        kind: "entity_memory",
        title,
        entityId: entity._id,
        entitySlug,
        markdown,
        plainText,
        latestRevision: 0,
        createdAt: now,
        updatedAt: now,
      }));

    // Re-write the canonical block set. On a NEWER version this refreshes the
    // body; the snapshot below preserves the prior revision for history. We
    // do a full replace of the import-owned blocks (deterministic blockIds),
    // mirroring documents.ts syncDocumentBlocks' replace semantics, but kept
    // local so the import doc never entangles with entity-note evidence links.
    const existingBlocks = await ctx.db
      .query("productDocumentBlocks")
      .withIndex("by_document_order", (q: any) => q.eq("documentId", documentId))
      .collect();
    for (const block of existingBlocks) {
      await ctx.db.delete(block._id);
    }
    for (const block of blocks) {
      await ctx.db.insert("productDocumentBlocks", {
        ownerKey,
        documentId,
        blockId: block.blockId,
        parentBlockId: block.parentBlockId,
        order: block.order,
        type: block.type,
        depth: block.depth,
        text: block.text,
        markdown: block.markdown,
        entityRefs: block.entityRefs,
        sourceRefs: block.sourceRefs,
        createdAt: now,
        updatedAt: now,
      });
    }

    const snapshotId = await ctx.db.insert("productDocumentSnapshots", {
      ownerKey,
      documentId,
      revision: nextRevision,
      markdown,
      plainText,
      blockCount: blocks.length,
      summary: summarizeText(plainText, `${wiki.eventName} recap`),
      createdAt: now,
    });

    await ctx.db.patch(documentId, {
      title,
      entityId: entity._id,
      entitySlug,
      markdown,
      plainText,
      latestRevision: nextRevision,
      latestSnapshotId: snapshotId,
      updatedAt: now,
    });

    // Import-event ledger row — carries the idempotency key so a future
    // re-import of the SAME version is recognized as a no-op.
    await ctx.db.insert("productDocumentEvents", {
      ownerKey,
      documentId,
      type: "imported",
      label: created
        ? "Imported ScratchNode recap"
        : `Updated ScratchNode recap to wiki v${wiki.wikiVersion}`,
      summary: summarizeText(plainText, `${wiki.eventName} recap`),
      metadata: {
        scratchnodeImportKey: key,
        scratchnodeEventId: wiki.eventId,
        scratchnodeSlug: wiki.slug,
        scratchnodeRoomCode: wiki.roomCode,
        wikiVersion: wiki.wikiVersion,
        answerCount: wiki.answers.length,
        sourceCount: wiki.sources.length,
        revision: nextRevision,
      },
      createdAt: now,
    });

    return {
      ok: true as const,
      documentId,
      entitySlug,
      created,
      alreadyImported: false,
      wikiVersion: wiki.wikiVersion,
    };
  },
});

/**
 * getScratchnodeImportStatus — read-only "has this owner imported this event's
 * recap, and at what version?" for the frontend to render an honest state
 * (not imported / imported v3 / a newer version is available).
 *
 * Uses resolveProductIdentitySafely so an anon caller with no owner simply
 * gets `imported: false` instead of an error (read paths never throw on a
 * missing identity).
 */
export const getScratchnodeImportStatus = query({
  args: {
    slug: v.string(),
    anonymousSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await resolveProductIdentitySafely(ctx, args.anonymousSessionId);
    const wiki = await loadStructuredPublishedWiki(ctx, args.slug);
    if (!wiki) {
      return {
        published: false as const,
        imported: false as const,
        documentId: null,
        entitySlug: null,
      };
    }
    const entitySlug = importEntitySlug(wiki.eventId);
    if (!identity.ownerKey) {
      return {
        published: true as const,
        imported: false as const,
        documentId: null,
        entitySlug,
        latestWikiVersion: wiki.wikiVersion,
      };
    }
    const document = await getImportDocument(ctx, identity.ownerKey, entitySlug);
    if (!document) {
      return {
        published: true as const,
        imported: false as const,
        documentId: null,
        entitySlug,
        latestWikiVersion: wiki.wikiVersion,
      };
    }
    const key = importKey(wiki.eventId, wiki.wikiVersion, identity.ownerKey);
    const prior = await findPriorImportEvent(ctx, document._id, key);
    const importedVersion =
      typeof document.latestSnapshotId !== "undefined" ? document.latestRevision : null;
    return {
      published: true as const,
      imported: true as const,
      documentId: document._id,
      entitySlug,
      latestWikiVersion: wiki.wikiVersion,
      // True when the owner has already imported the CURRENT published version.
      upToDate: Boolean(prior),
      importedRevision: importedVersion,
    };
  },
});
