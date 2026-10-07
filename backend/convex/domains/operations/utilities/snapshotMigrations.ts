import { internalMutation, mutation } from "../../../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../../../_generated/dataModel";
import { internal, components } from "../../../_generated/api";
import { ProsemirrorSync } from "@convex-dev/prosemirror-sync";

// =================================================================
// LEGACY MIGRATION UTILITIES
// These functions are for migrating existing documents from the
// deprecated EditorJS format to ProseMirror/BlockNote format.
// New documents use ProseMirror format directly.
// =================================================================

// Server-side PM JSON normalizer for existing snapshots.
// - Unwrap wrapper nodes: blockGroup/blockContainer
// - Map legacy list item names at top-level: checkListItem -> taskItem; bulletListItem -> listItem
// - Group consecutive taskItem into taskList, listItem into bulletList
// - Wrap stray top-level text nodes into paragraphs
// - Always ensure a { type: "doc", content: [...] } root

type PMNode = {
  type?: string;
  content?: PMNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  [k: string]: unknown;
};

const WRAPPERS = new Set(["blockGroup", "blockContainer"]);

function clone<T>(n: T): T {
  return JSON.parse(JSON.stringify(n));
}

function coerceDoc(c: unknown): PMNode {
  const maybeObj = (c ?? {}) as PMNode;
  if (maybeObj && typeof maybeObj === "object" && maybeObj.type === "doc") {
    if (!Array.isArray(maybeObj.content)) maybeObj.content = [];
    return maybeObj;
  }
  const wrapped: PMNode = { type: "doc", content: [] };
  if (maybeObj && typeof (maybeObj as { type?: unknown }).type === "string") {
    wrapped.content = [maybeObj];
  } else if (
    Array.isArray((maybeObj as { content?: unknown }).content)
  ) {
    wrapped.content = (maybeObj as { content: PMNode[] }).content;
  }
  return wrapped;
}

function flattenWrappers(nodes: PMNode[] | undefined): PMNode[] {
  if (!Array.isArray(nodes)) return [];
  const out: PMNode[] = [];
  for (const raw of nodes) {
    const n = clone(raw);
    if (n && WRAPPERS.has(String(n.type))) {
      out.push(...flattenWrappers(n.content));
      continue;
    }
    if (Array.isArray(n.content)) n.content = flattenWrappers(n.content);
    out.push(n);
  }
  return out;
}

function mapListItemNames(n: PMNode): PMNode {
  if (!n || typeof n !== "object") return n;
  const node = clone(n);
  if (node.type === "checkListItem") node.type = "taskItem";
  if (node.type === "bulletListItem") node.type = "listItem";
  if (Array.isArray(node.content)) node.content = node.content.map(mapListItemNames);
  return node;
}

function wrapTextAsParagraph(n: PMNode): PMNode {
  if (n?.type === "text") {
    return { type: "paragraph", content: [clone(n)] };
  }
  return n;
}

function normalizeSnapshotContent(json: unknown): PMNode {
  const doc = coerceDoc(json);
  // 1) Remove wrappers and map legacy names in top-level
  const top = flattenWrappers(doc.content).map(mapListItemNames).map(wrapTextAsParagraph);

  // 2) Group consecutive taskItem/listItem runs into list containers
  const grouped: PMNode[] = [];
  const pushRun = (kind: "taskItem" | "listItem", run: PMNode[]) => {
    if (run.length === 0) return;
    if (kind === "taskItem") grouped.push({ type: "taskList", content: run });
    else grouped.push({ type: "bulletList", content: run });
  };
  let i = 0;
  while (i < top.length) {
    const cur = top[i];
    if (cur?.type === "taskItem") {
      const run: PMNode[] = [];
      while (i < top.length && top[i]?.type === "taskItem") {
        const itm = clone(top[i]);
        if (!Array.isArray(itm.content) || itm.content.length === 0) {
          itm.content = [{ type: "paragraph", content: [] }];
        }
        run.push(itm);
        i++;
      }
      pushRun("taskItem", run);
      continue;
    }
    if (cur?.type === "listItem") {
      const run: PMNode[] = [];
      while (i < top.length && top[i]?.type === "listItem") {
        const itm = clone(top[i]);
        if (!Array.isArray(itm.content) || itm.content.length === 0) {
          itm.content = [{ type: "paragraph", content: [] }];
        }
        run.push(itm);
        i++;
      }
      pushRun("listItem", run);
      continue;
    }
    grouped.push(cur);
    i++;
  }

  return { type: "doc", content: grouped };
}

export const normalizeSnapshot = internalMutation({
  args: { snapshotId: v.id("documentSnapshots") },
  returns: v.null(),
  handler: async (ctx, { snapshotId }) => {
    const snap = await ctx.db.get(snapshotId) as Doc<"documentSnapshots"> | null;
    if (!snap) return null;
    try {
      const parsed = JSON.parse(snap.content);
      const normalized = normalizeSnapshotContent(parsed);
      const content = JSON.stringify(normalized);
      await ctx.db.patch(snapshotId, {
        content,
        contentSize: content.length,
      });
    } catch {
      // If it's not valid JSON, leave it; server-side validation will reject on use
    }
    return null;
  },
});

export const normalizeAllSnapshots = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const snapshots = await ctx.db.query("documentSnapshots").collect() as Doc<"documentSnapshots">[];
    for (const s of snapshots) {
      await ctx.scheduler.runAfter(0, internal.domains.utilities.snapshotMigrations.normalizeSnapshot, {
        snapshotId: s._id as Id<"documentSnapshots">,
      });
    }
    return null;
  },
});

/**
 * Convert TipTap taskItem/taskList nodes to BlockNote checkListItem format.
 * This fixes documents that were saved with TipTap schema but need to be
 * rendered with BlockNote which uses checkListItem instead.
 */
function convertTaskItemToCheckListItem(node: PMNode): PMNode | PMNode[] | null {
  if (!node || typeof node !== "object") return node;

  const n = clone(node);

  // Convert taskList - flatten its children (taskItems become checkListItems)
  if (n.type === "taskList") {
    if (Array.isArray(n.content)) {
      const converted = n.content
        .map((child) => convertTaskItemToCheckListItem(child))
        .flat()
        .filter((c): c is PMNode => c !== null);
      return converted;
    }
    return null;
  }

  // Convert taskItem to checkListItem
  if (n.type === "taskItem") {
    const checked = (n.attrs as Record<string, unknown>)?.checked ?? false;
    const convertedContent = Array.isArray(n.content)
      ? n.content
          .map((child) => convertTaskItemToCheckListItem(child))
          .flat()
          .filter((c): c is PMNode => c !== null)
      : [];

    return {
      type: "checkListItem",
      attrs: { checked },
      content: convertedContent.length > 0 ? convertedContent : undefined,
    };
  }

  // Recursively process content
  if (Array.isArray(n.content)) {
    const converted = n.content
      .map((child) => convertTaskItemToCheckListItem(child))
      .flat()
      .filter((c): c is PMNode => c !== null);
    n.content = converted;
  }

  return n;
}

function migrateToBlockNoteFormat(json: unknown): PMNode {
  const doc = coerceDoc(json);

  // Convert taskItem/taskList to checkListItem
  if (Array.isArray(doc.content)) {
    const converted = doc.content
      .map((child) => convertTaskItemToCheckListItem(child))
      .flat()
      .filter((c): c is PMNode => c !== null);
    doc.content = converted;
  }

  return doc;
}

export const migrateSnapshotToBlockNote = internalMutation({
  args: { snapshotId: v.id("documentSnapshots") },
  returns: v.null(),
  handler: async (ctx, { snapshotId }) => {
    const snap = await ctx.db.get(snapshotId) as Doc<"documentSnapshots"> | null;
    if (!snap) return null;
    try {
      const parsed = JSON.parse(snap.content);
      const migrated = migrateToBlockNoteFormat(parsed);
      const content = JSON.stringify(migrated);
      await ctx.db.patch(snapshotId, {
        content,
        contentSize: content.length,
      });
      console.log(`[migrateSnapshotToBlockNote] Migrated snapshot ${snapshotId}`);
    } catch (e) {
      console.error(`[migrateSnapshotToBlockNote] Failed to migrate snapshot ${snapshotId}:`, e);
    }
    return null;
  },
});

export const migrateAllSnapshotsToBlockNote = mutation({
  args: {},
  returns: v.object({ count: v.number() }),
  handler: async (ctx) => {
    const snapshots = await ctx.db.query("documentSnapshots").collect() as Doc<"documentSnapshots">[];
    let count = 0;
    for (const s of snapshots) {
      // Check if snapshot contains taskItem or taskList
      if (s.content.includes('"taskItem"') || s.content.includes('"taskList"')) {
        await ctx.scheduler.runAfter(0, internal.domains.utilities.snapshotMigrations.migrateSnapshotToBlockNote, {
          snapshotId: s._id as Id<"documentSnapshots">,
        });
        count++;
      }
    }
    console.log(`[migrateAllSnapshotsToBlockNote] Scheduled migration for ${count} snapshots`);
    return { count };
  },
});

/**
 * Convert EditorJS format to ProseMirror format
 * EditorJS uses: { time, blocks: [{ type, data }] }
 * ProseMirror uses: { type: "doc", content: [{ type, content, attrs }] }
 */
function convertEditorJSToProseMirror(editorJsContent: string): string | null {
  try {
    const parsed = JSON.parse(editorJsContent);
    if (!parsed || !Array.isArray(parsed.blocks)) {
      return null; // Not EditorJS format
    }

    const pmContent: PMNode[] = [];

    for (const block of parsed.blocks) {
      const blockType = block.type;
      const data = block.data || {};

      switch (blockType) {
        case "header":
          pmContent.push({
            type: "heading",
            attrs: { level: data.level || 1 },
            content: data.text ? [{ type: "text", text: data.text }] : [],
          });
          break;

        case "paragraph":
          pmContent.push({
            type: "paragraph",
            content: data.text ? [{ type: "text", text: data.text }] : [],
          });
          break;

        case "checklist":
          // Convert EditorJS checklist items to BlockNote checkListItem
          if (Array.isArray(data.items)) {
            for (const item of data.items) {
              pmContent.push({
                type: "checkListItem",
                attrs: { checked: item.checked ?? false },
                content: item.text ? [{ type: "text", text: item.text }] : [],
              });
            }
          }
          break;

        case "list":
          // Convert EditorJS list items to BlockNote bulletListItem or numberedListItem
          if (Array.isArray(data.items)) {
            const listType = data.style === "ordered" ? "numberedListItem" : "bulletListItem";
            for (const item of data.items) {
              const text = typeof item === "string" ? item : item.content || "";
              pmContent.push({
                type: listType,
                content: text ? [{ type: "text", text }] : [],
              });
            }
          }
          break;

        case "quote":
          pmContent.push({
            type: "quote",
            content: data.text ? [{ type: "text", text: data.text }] : [],
          });
          break;

        case "code":
          pmContent.push({
            type: "codeBlock",
            attrs: { language: data.language || "" },
            content: data.code ? [{ type: "text", text: data.code }] : [],
          });
          break;

        case "delimiter":
          pmContent.push({
            type: "horizontalRule",
          });
          break;

        default:
          // For unknown block types, convert to paragraph with text
          const text = data.text || JSON.stringify(data);
          pmContent.push({
            type: "paragraph",
            content: text ? [{ type: "text", text }] : [],
          });
      }
    }

    // Ensure at least one paragraph if empty
    if (pmContent.length === 0) {
      pmContent.push({ type: "paragraph", content: [] });
    }

    const pmDoc: PMNode = {
      type: "doc",
      content: pmContent,
    };

    return JSON.stringify(pmDoc);
  } catch (err) {
    console.error("[convertEditorJSToProseMirror] Error:", err);
    return null;
  }
}

/**
 * Check if content is in EditorJS format
 */
function isEditorJSFormat(content: string): boolean {
  try {
    const parsed = JSON.parse(content);
    return parsed && Array.isArray(parsed.blocks);
  } catch {
    return false;
  }
}

/**
 * Migrate all documents with EditorJS format to ProseMirror format
 */
export const migrateEditorJSToProseMirror = internalMutation({
  args: {},
  returns: v.object({
    processed: v.number(),
    converted: v.number(),
    errors: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const documents = await ctx.db.query("documents").collect() as Doc<"documents">[];
    let processed = 0;
    let converted = 0;
    const errors: string[] = [];

    for (const doc of documents) {
      processed++;
      if (!doc.content) continue;

      if (isEditorJSFormat(doc.content)) {
        const pmContent = convertEditorJSToProseMirror(doc.content);
        if (pmContent) {
          await ctx.db.patch(doc._id, { content: pmContent });
          converted++;
          console.log(`[migrateEditorJS] Converted document ${doc._id}: ${doc.title}`);
        } else {
          errors.push(`Failed to convert ${doc._id}: ${doc.title}`);
        }
      }
    }

    console.log(`[migrateEditorJS] Complete: ${processed} processed, ${converted} converted, ${errors.length} errors`);
    return { processed, converted, errors };
  },
});

// Create prosemirror sync instance for seeding
const prosemirrorSync = new ProsemirrorSync(components.prosemirrorSync);

/**
 * Seed ProseMirror sync component with content from documents.content field.
 * This is needed after running internalResetAllSnapshots to restore document content.
 */
export const seedProseMirrorFromDocuments = internalMutation({
  args: {},
  returns: v.object({
    processed: v.number(),
    seeded: v.number(),
    skipped: v.number(),
    errors: v.array(v.string()),
  }),
  handler: async (ctx) => {

    const documents = await ctx.db.query("documents").collect() as Doc<"documents">[];
    let processed = 0;
    let seeded = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const doc of documents) {
      processed++;

      // Skip documents without content
      if (!doc.content) {
        skipped++;
        continue;
      }

      // Skip dossier documents (they use a different format)
      if (doc.documentType === "dossier" || (doc).dossierType === "primary") {
        skipped++;
        continue;
      }

      // Skip file documents (they don't use the editor)
      if (doc.documentType === "file") {
        skipped++;
        continue;
      }

      try {
        // Parse the content to ensure it's valid ProseMirror JSON
        const parsed = JSON.parse(doc.content);

        // Ensure it has the correct structure
        if (!parsed || typeof parsed !== "object" || parsed.type !== "doc") {
          // Try to wrap it in a doc structure
          const wrapped = { type: "doc", content: Array.isArray(parsed) ? parsed : [] };
          await prosemirrorSync.create(ctx, doc._id, wrapped);
        } else {
          await prosemirrorSync.create(ctx, doc._id, parsed);
        }

        seeded++;
        console.log(`[seedProseMirror] Seeded document ${doc._id}: ${doc.title}`);
      } catch (err) {
        const errStr = String(err);
        // Ignore "already exists" errors
        if (errStr.includes("already exists") || errStr.includes("Document already has")) {
          skipped++;
        } else {
          errors.push(`${doc._id} (${doc.title}): ${errStr}`);
        }
      }
    }

    console.log(`[seedProseMirror] Complete: ${processed} processed, ${seeded} seeded, ${skipped} skipped, ${errors.length} errors`);
    return { processed, seeded, skipped, errors };
  },
});
