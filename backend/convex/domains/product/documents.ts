import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { mutation, query } from "../../_generated/server";
import {
  requireEntityWorkspaceWriteAccessByEntityId,
  resolveEntityWorkspaceAccess,
  requireProductIdentity,
  resolveProductIdentitySafely,
  summarizeText,
} from "./helpers";
import { productDocumentBlockValidator } from "./schema";

type DocumentBlockInput = {
  blockId: string;
  parentBlockId?: string;
  order: number;
  type: "paragraph" | "heading" | "bullet" | "quote" | "check" | "code";
  depth?: number;
  text: string;
  markdown?: string;
  lexical?: unknown;
  entityRefs?: string[];
  sourceRefs?: string[];
};

function slugifySegment(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/['".,()[\]{}]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeEntityRefs(text: string, refs?: string[]) {
  const explicitRefs = Array.isArray(refs) ? refs : [];
  const wikiRefs = [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1]?.trim() || "");
  return [...new Set([...explicitRefs, ...wikiRefs].map((value) => slugifySegment(value)).filter(Boolean))];
}

function normalizeSourceRefs(text: string, refs?: string[]) {
  const explicitRefs = Array.isArray(refs) ? refs : [];
  const inlineRefs = [...text.matchAll(/\[source:([^\]]+)\]/gi)].map((match) => match[1]?.trim() || "");
  return [...new Set([...explicitRefs, ...inlineRefs].map((value) => value.trim()).filter(Boolean))];
}

function stripMarkdown(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/[#*_~]/g, "")
    .trim();
}

export function normalizeProductDocumentBlocks(blocks: DocumentBlockInput[]) {
  return blocks
    .map((block, index) => {
      const text = String(block.text || "").trim();
      const markdown = String(block.markdown || "").trim() || text;
      return {
        blockId: String(block.blockId || `block-${index + 1}`).trim(),
        parentBlockId: block.parentBlockId ? String(block.parentBlockId).trim() : undefined,
        order: Number.isFinite(block.order) ? block.order : index,
        type: block.type,
        depth: typeof block.depth === "number" ? block.depth : undefined,
        text,
        markdown,
        lexical: block.lexical,
        entityRefs: normalizeEntityRefs(text, block.entityRefs),
        sourceRefs: normalizeSourceRefs(text, block.sourceRefs),
      };
    })
    .filter((block) => block.text || block.type === "code")
    .sort((left, right) => left.order - right.order);
}

function blocksToPlainText(blocks: ReturnType<typeof normalizeProductDocumentBlocks>) {
  return blocks.map((block) => block.text).filter(Boolean).join("\n\n").trim();
}

function blocksToMarkdown(blocks: ReturnType<typeof normalizeProductDocumentBlocks>) {
  return blocks.map((block) => block.markdown || block.text).filter(Boolean).join("\n\n").trim();
}

function arraysEqual(left?: string[], right?: string[]) {
  const nextLeft = [...new Set(Array.isArray(left) ? left : [])].sort();
  const nextRight = [...new Set(Array.isArray(right) ? right : [])].sort();
  if (nextLeft.length !== nextRight.length) return false;
  return nextLeft.every((value, index) => value === nextRight[index]);
}

function buildDocumentOutline(blocks: Array<Doc<"productDocumentBlocks">>) {
  return blocks
    .filter((block) => block.type === "heading" && block.text.trim())
    .map((block) => ({
      blockId: block.blockId,
      title: block.text,
      order: block.order,
      depth: block.depth,
    }))
    .sort((left, right) => left.order - right.order);
}

function sortByCreatedAt<T extends { createdAt: number }>(items: T[]) {
  return [...items].sort((left, right) => right.createdAt - left.createdAt);
}

type LegacyEntityNote = {
  content?: string | null;
  blocks?:
    | Array<{
        id?: string;
        kind?: "observation" | "insight" | "question" | "action";
        title?: string;
        body?: string;
      }>
    | null;
};

export function legacyEntityNoteToDocumentBlocks(note: LegacyEntityNote | null | undefined) {
  const legacyBlocks = Array.isArray(note?.blocks) ? note.blocks : [];
  if (legacyBlocks.length === 0) {
    const plain = String(note?.content || "").trim();
    if (!plain) return [] as ReturnType<typeof normalizeProductDocumentBlocks>;
    return normalizeProductDocumentBlocks([
      {
        blockId: "legacy-paragraph",
        order: 0,
        type: "paragraph",
        text: stripMarkdown(plain),
        markdown: plain,
      },
    ]);
  }

  const next: DocumentBlockInput[] = [];
  let order = 0;
  for (const legacy of legacyBlocks) {
    const title = String(legacy.title || "").trim();
    const body = String(legacy.body || "").trim();
    if (title) {
      next.push({
        blockId: `${legacy.id || `legacy-${order}`}-title`,
        order: order++,
        type: "heading",
        text: title,
        markdown: `## ${title}`,
      });
    }
    if (body) {
      next.push({
        blockId: `${legacy.id || `legacy-${order}`}-body`,
        order: order++,
        type: legacy.kind === "action" ? "check" : "paragraph",
        text: stripMarkdown(body),
        markdown: body,
      });
    }
  }
  return normalizeProductDocumentBlocks(next);
}

export async function getEntityMemoryDocumentRecord(
  ctx: any,
  ownerKey: string,
  entitySlug: string,
) {
  return await ctx.db
    .query("productDocuments")
    .withIndex("by_owner_entity_kind", (q: any) =>
      q.eq("ownerKey", ownerKey).eq("entitySlug", entitySlug).eq("kind", "entity_memory"),
    )
    .first();
}

export async function getEntityMemoryDocumentWorkspace(
  ctx: any,
  ownerKey: string,
  entitySlug: string,
) {
  const document = await getEntityMemoryDocumentRecord(ctx, ownerKey, entitySlug);
  if (!document) return null;

  const [blocks, snapshots, entityLinks, sourceLinks, events] = await Promise.all([
    ctx.db
      .query("productDocumentBlocks")
      .withIndex("by_document_order", (q: any) => q.eq("documentId", document._id))
      .collect(),
    ctx.db
      .query("productDocumentSnapshots")
      .withIndex("by_document_revision", (q: any) => q.eq("documentId", document._id))
      .order("desc")
      .take(8),
    ctx.db
      .query("productDocumentEntityLinks")
      .withIndex("by_document", (q: any) => q.eq("documentId", document._id))
      .collect(),
    ctx.db
      .query("productDocumentSourceLinks")
      .withIndex("by_document", (q: any) => q.eq("documentId", document._id))
      .collect(),
    ctx.db
      .query("productDocumentEvents")
      .withIndex("by_document_created", (q: any) => q.eq("documentId", document._id))
      .order("desc")
      .take(12),
  ]);

  const linkedEntitySlugs = [...new Set(entityLinks.map((link: Doc<"productDocumentEntityLinks">) => link.entitySlug))];
  const linkedEntities = await Promise.all(
    linkedEntitySlugs.map((slug) =>
      ctx.db
        .query("productEntities")
        .withIndex("by_owner_slug", (q: any) => q.eq("ownerKey", ownerKey).eq("slug", slug))
        .first(),
    ),
  );
  const entityBySlug = new Map(
    linkedEntities
      .filter((entity): entity is Doc<"productEntities"> => Boolean(entity))
      .map((entity) => [entity.slug, entity]),
  );

  const sourceEvidenceIds = [...new Set(sourceLinks.map((link: Doc<"productDocumentSourceLinks">) => String(link.evidenceId)))];
  const sourceEvidence = await Promise.all(sourceEvidenceIds.map((id) => ctx.db.get(id as Id<"productEvidenceItems">)));
  const evidenceById = new Map(
    sourceEvidence
      .filter((item): item is Doc<"productEvidenceItems"> => Boolean(item))
      .map((item) => [String(item._id), item]),
  );

  const sortedBlocks = [...blocks].sort((left, right) => left.order - right.order);

  return {
    ...document,
    blocks: sortedBlocks,
    snapshots,
    outline: buildDocumentOutline(sortedBlocks),
    entityLinks: sortByCreatedAt(
      entityLinks.map((link: Doc<"productDocumentEntityLinks">) => ({
        ...link,
        entityName: entityBySlug.get(link.entitySlug)?.name,
        entityType: entityBySlug.get(link.entitySlug)?.entityType,
      })),
    ),
    sourceLinks: sortByCreatedAt(
      sourceLinks
        .map((link: Doc<"productDocumentSourceLinks">) => {
          const evidence = evidenceById.get(String(link.evidenceId));
          if (!evidence) return null;
          return {
            ...link,
            evidenceId: String(link.evidenceId),
            label: evidence.label,
            type: evidence.type,
            sourceUrl: evidence.sourceUrl,
          };
        })
        .filter(Boolean),
    ),
    events,
    backlinks: entityLinks.filter((link: Doc<"productDocumentEntityLinks">) => link.relation === "mention"),
  };
}

async function syncDocumentBlocks(
  ctx: any,
  args: {
    ownerKey: string;
    documentId: Id<"productDocuments">;
    blocks: ReturnType<typeof normalizeProductDocumentBlocks>;
    entitySlug: string;
    now: number;
  },
) {
  const existingBlocks = await ctx.db
    .query("productDocumentBlocks")
    .withIndex("by_document_order", (q: any) => q.eq("documentId", args.documentId))
    .collect();
  const existingEntityLinks = await ctx.db
    .query("productDocumentEntityLinks")
    .withIndex("by_document", (q: any) => q.eq("documentId", args.documentId))
    .collect();
  const existingSourceLinks = await ctx.db
    .query("productDocumentSourceLinks")
    .withIndex("by_document", (q: any) => q.eq("documentId", args.documentId))
    .collect();

  const evidenceItems = await ctx.db
    .query("productEvidenceItems")
    .withIndex("by_owner_updated", (q: any) => q.eq("ownerKey", args.ownerKey))
    .order("desc")
    .take(200);

  const evidenceById = new Map<string, Doc<"productEvidenceItems">>(
    evidenceItems.map((item: Doc<"productEvidenceItems">) => [String(item._id), item]),
  );
  const evidenceByLabel = new Map<string, Doc<"productEvidenceItems">>(
    evidenceItems.map((item: Doc<"productEvidenceItems">) => [item.label.toLowerCase(), item]),
  );

  const existingBlocksByBlockId = new Map<string, Doc<"productDocumentBlocks">>(
    existingBlocks.map((block: Doc<"productDocumentBlocks">) => [block.blockId, block]),
  );
  const nextBlockIds = new Set(args.blocks.map((block) => block.blockId));
  let addedBlocks = 0;
  let updatedBlocks = 0;
  let deletedBlocks = 0;

  for (const block of args.blocks) {
    const existing = existingBlocksByBlockId.get(block.blockId);
    const patch = {
      parentBlockId: block.parentBlockId,
      order: block.order,
      type: block.type,
      depth: block.depth,
      text: block.text,
      markdown: block.markdown,
      lexical: block.lexical,
      entityRefs: block.entityRefs,
      sourceRefs: block.sourceRefs,
      updatedAt: args.now,
    };

    if (!existing) {
      await ctx.db.insert("productDocumentBlocks", {
        ownerKey: args.ownerKey,
        documentId: args.documentId,
        blockId: block.blockId,
        createdAt: args.now,
        ...patch,
      });
      addedBlocks += 1;
      continue;
    }

    const changed =
      existing.parentBlockId !== block.parentBlockId ||
      existing.order !== block.order ||
      existing.type !== block.type ||
      existing.depth !== block.depth ||
      existing.text !== block.text ||
      existing.markdown !== block.markdown ||
      JSON.stringify(existing.lexical ?? null) !== JSON.stringify(block.lexical ?? null) ||
      !arraysEqual(existing.entityRefs, block.entityRefs) ||
      !arraysEqual(existing.sourceRefs, block.sourceRefs);

    if (changed) {
      await ctx.db.patch(existing._id, patch);
      updatedBlocks += 1;
    }
  }

  for (const block of existingBlocks) {
    if (nextBlockIds.has(block.blockId)) continue;
    await ctx.db.delete(block._id);
    deletedBlocks += 1;
  }

  const desiredEntityLinks = new Map<
    string,
    {
      blockId?: string;
      entitySlug: string;
      relation: "primary" | "mention";
    }
  >();

  desiredEntityLinks.set(`document|${args.entitySlug}|primary`, {
    blockId: undefined,
    entitySlug: args.entitySlug,
    relation: "primary",
  });

  for (const block of args.blocks) {
    for (const entitySlug of block.entityRefs ?? []) {
      const relation: "primary" | "mention" = entitySlug === args.entitySlug ? "primary" : "mention";
      desiredEntityLinks.set(`${block.blockId}|${entitySlug}|${relation}`, {
        blockId: block.blockId,
        entitySlug,
        relation,
      });
    }
  }

  const existingEntityLinksByKey = new Map<string, Doc<"productDocumentEntityLinks">>(
    existingEntityLinks.map((link: Doc<"productDocumentEntityLinks">) => [
      `${link.blockId ?? "document"}|${link.entitySlug}|${link.relation}`,
      link,
    ]),
  );

  for (const [key, desired] of desiredEntityLinks) {
    if (existingEntityLinksByKey.has(key)) continue;
    await ctx.db.insert("productDocumentEntityLinks", {
      ownerKey: args.ownerKey,
      documentId: args.documentId,
      blockId: desired.blockId,
      entitySlug: desired.entitySlug,
      relation: desired.relation,
      createdAt: args.now,
    });
  }

  for (const [key, existing] of existingEntityLinksByKey.entries()) {
    if (desiredEntityLinks.has(key)) continue;
    await ctx.db.delete(existing._id);
  }

  const desiredSourceLinks = new Map<
    string,
    {
      blockId: string;
      evidenceId: Id<"productEvidenceItems">;
    }
  >();

  for (const block of args.blocks) {
    for (const sourceRef of block.sourceRefs ?? []) {
      const matchedEvidence =
        evidenceById.get(String(sourceRef)) ?? evidenceByLabel.get(String(sourceRef).toLowerCase());
      if (!matchedEvidence) continue;
      desiredSourceLinks.set(`${block.blockId}|${String(matchedEvidence._id)}`, {
        blockId: block.blockId,
        evidenceId: matchedEvidence._id,
      });
    }
  }

  const existingSourceLinksByKey = new Map<string, Doc<"productDocumentSourceLinks">>(
    existingSourceLinks.map((link: Doc<"productDocumentSourceLinks">) => [
      `${link.blockId ?? "document"}|${String(link.evidenceId)}`,
      link,
    ]),
  );

  for (const [key, desired] of desiredSourceLinks) {
    if (existingSourceLinksByKey.has(key)) continue;
    await ctx.db.insert("productDocumentSourceLinks", {
      ownerKey: args.ownerKey,
      documentId: args.documentId,
      blockId: desired.blockId,
      evidenceId: desired.evidenceId,
      createdAt: args.now,
    });
  }

  for (const [key, existing] of existingSourceLinksByKey.entries()) {
    if (desiredSourceLinks.has(key)) continue;
    await ctx.db.delete(existing._id);
  }

  return {
    addedBlocks,
    updatedBlocks,
    deletedBlocks,
  };
}

async function upsertLegacyEntityNote(
  ctx: any,
  args: {
    ownerKey: string;
    entityId: Id<"productEntities">;
    content: string;
    updatedAt: number;
  },
) {
  const existing = await ctx.db
    .query("productEntityNotes")
    .withIndex("by_entity", (q: any) => q.eq("entityId", args.entityId))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, {
      content: args.content,
      updatedAt: args.updatedAt,
    });
    return existing._id;
  }
  return await ctx.db.insert("productEntityNotes", {
    ownerKey: args.ownerKey,
    entityId: args.entityId,
    content: args.content,
    createdAt: args.updatedAt,
    updatedAt: args.updatedAt,
  });
}

async function saveEntityMemoryDocumentInternal(
  ctx: any,
  args: {
    ownerKey: string;
    entity: Doc<"productEntities">;
    title?: string;
    markdown: string;
    plainText?: string;
    lexicalState?: unknown;
    blocks: DocumentBlockInput[];
    eventType: "created" | "edited" | "imported";
    eventLabel: string;
  },
) {
  const now = Date.now();
  const normalizedBlocks = normalizeProductDocumentBlocks(args.blocks);
  const markdown = String(args.markdown || "").trim() || blocksToMarkdown(normalizedBlocks);
  const plainText = String(args.plainText || "").trim() || blocksToPlainText(normalizedBlocks) || stripMarkdown(markdown);
  const existing = await getEntityMemoryDocumentRecord(ctx, args.ownerKey, args.entity.slug);

  const title = args.title?.trim() || `${args.entity.name} notebook`;
  const nextRevision = (existing?.latestRevision ?? 0) + 1;
  const documentId =
    existing?._id ??
    (await ctx.db.insert("productDocuments", {
      ownerKey: args.ownerKey,
      kind: "entity_memory",
      title,
      entityId: args.entity._id,
      entitySlug: args.entity.slug,
      markdown,
      plainText,
      lexicalState: args.lexicalState,
      latestRevision: 0,
      createdAt: now,
      updatedAt: now,
    }));

  const syncStats = await syncDocumentBlocks(ctx, {
    ownerKey: args.ownerKey,
    documentId,
    blocks: normalizedBlocks,
    entitySlug: args.entity.slug,
    now,
  });

  const snapshotId = await ctx.db.insert("productDocumentSnapshots", {
    ownerKey: args.ownerKey,
    documentId,
    revision: nextRevision,
    markdown,
    plainText,
    lexicalState: args.lexicalState,
    blockCount: normalizedBlocks.length,
    summary: summarizeText(plainText, `${args.entity.name} notebook`),
    createdAt: now,
  });

  await ctx.db.patch(documentId, {
    title,
    entityId: args.entity._id,
    entitySlug: args.entity.slug,
    markdown,
    plainText,
    lexicalState: args.lexicalState,
    latestRevision: nextRevision,
    latestSnapshotId: snapshotId,
    updatedAt: now,
  });

  await ctx.db.insert("productDocumentEvents", {
    ownerKey: args.ownerKey,
    documentId,
    type: args.eventType,
    label: args.eventLabel,
    summary: summarizeText(plainText, `${args.entity.name} notebook`),
    metadata: {
      entityId: args.entity._id,
      entitySlug: args.entity.slug,
      revision: nextRevision,
      blockCount: normalizedBlocks.length,
      syncStats,
    },
    createdAt: now,
  });

  await upsertLegacyEntityNote(ctx, {
    ownerKey: args.ownerKey,
    entityId: args.entity._id,
    content: plainText,
    updatedAt: now,
  });

  return {
    documentId,
    revision: nextRevision,
    markdown,
    plainText,
    blocks: normalizedBlocks,
  };
}

export const getEntityNoteDocument = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entitySlug: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await resolveEntityWorkspaceAccess(ctx, args);
    if (!access) return null;
    return await getEntityMemoryDocumentWorkspace(ctx, access.entity.ownerKey, args.entitySlug);
  },
});

export const ensureEntityNoteDocumentBackfill = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entityId: v.id("productEntities"),
  },
  handler: async (ctx, args) => {
    const access = await requireEntityWorkspaceWriteAccessByEntityId(ctx, args);
    const ownerKey = access.entity.ownerKey;
    const entity = access.entity;

    const existing = await getEntityMemoryDocumentRecord(ctx, ownerKey, entity.slug);
    if (existing) {
      return { ok: true, documentId: existing._id, created: false };
    }

    const legacyNote = await ctx.db
      .query("productEntityNotes")
      .withIndex("by_entity", (q: any) => q.eq("entityId", entity._id))
      .first();

    const legacyBlocks = legacyEntityNoteToDocumentBlocks(legacyNote);
    const markdown =
      legacyNote?.content?.trim() ||
      blocksToMarkdown(legacyBlocks) ||
      `## ${entity.name}\n\nUse this notebook to accumulate working notes, links, and follow-up actions.`;

    const saved = await saveEntityMemoryDocumentInternal(ctx, {
      ownerKey,
      entity,
      title: `${entity.name} notebook`,
      markdown,
      plainText: stripMarkdown(markdown),
      lexicalState: undefined,
      blocks:
        legacyBlocks.length > 0
          ? legacyBlocks
          : normalizeProductDocumentBlocks([
              {
                blockId: "welcome-heading",
                order: 0,
                type: "heading",
                text: entity.name,
                markdown: `## ${entity.name}`,
              },
              {
                blockId: "welcome-paragraph",
                order: 1,
                type: "paragraph",
                text: "Use this notebook to accumulate working notes, links, and follow-up actions.",
                markdown: "Use this notebook to accumulate working notes, links, and follow-up actions.",
              },
            ]),
      eventType: legacyNote ? "imported" : "created",
      eventLabel: legacyNote ? "Imported legacy entity note" : "Created entity notebook",
    });

    return { ok: true, documentId: saved.documentId, created: true };
  },
});

export const saveEntityNoteDocument = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entityId: v.id("productEntities"),
    title: v.optional(v.string()),
    markdown: v.string(),
    plainText: v.optional(v.string()),
    lexicalState: v.optional(v.any()),
    blocks: v.array(productDocumentBlockValidator),
  },
  handler: async (ctx, args) => {
    const access = await requireEntityWorkspaceWriteAccessByEntityId(ctx, args);
    const ownerKey = access.entity.ownerKey;
    const entity = access.entity;

    return await saveEntityMemoryDocumentInternal(ctx, {
      ownerKey,
      entity,
      title: args.title,
      markdown: args.markdown,
      plainText: args.plainText,
      lexicalState: args.lexicalState,
      blocks: args.blocks as DocumentBlockInput[],
      eventType: "edited",
      eventLabel: "Updated entity notebook",
    });
  },
});
