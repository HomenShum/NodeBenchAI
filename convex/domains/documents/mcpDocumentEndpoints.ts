/**
 * MCP-safe document endpoints.
 *
 * These internal functions accept an explicit `userId` parameter so they can be
 * called from external MCP agents via the Convex HTTP API with admin key auth.
 *
 * `getAuthUserId` returns null for admin-key-only requests, so standard public
 * mutations cannot be used from the gateway. These internal variants bypass that
 * by accepting userId as an explicit argument.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, internalAction } from "../../_generated/server";
import { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";

// ── Document CRUD ─────────────────────────────────────────────

export const mcpCreateDocument = internalMutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    parentId: v.optional(v.id("documents")),
    content: v.optional(v.string()),
  },
  handler: async (ctx, { userId, title, parentId, content }) => {
    if (parentId) {
      const parent = (await ctx.db.get(parentId)) as Doc<"documents"> | null;
      if (!parent || parent.createdBy !== userId) {
        throw new Error("Parent document not found or unauthorized");
      }
    }

    const docId = await ctx.db.insert("documents", {
      title,
      parentId,
      createdBy: userId,
      isPublic: false,
      isArchived: false,
      content,
      lastModified: Date.now(),
    } as any);
    return docId;
  },
});

export const mcpGetDocument = internalQuery({
  args: {
    userId: v.id("users"),
    documentId: v.id("documents"),
  },
  handler: async (ctx, { userId, documentId }) => {
    const document = (await ctx.db.get(documentId)) as Doc<"documents"> | null;
    if (!document || document.createdBy !== userId) {
      throw new Error("Document not found or unauthorized");
    }
    return document;
  },
});

export const mcpUpdateDocument = internalMutation({
  args: {
    userId: v.id("users"),
    id: v.id("documents"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    icon: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
    isFavorite: v.optional(v.boolean()),
  },
  handler: async (ctx, { userId, id, ...fields }) => {
    const doc = (await ctx.db.get(id)) as Doc<"documents"> | null;
    if (!doc) throw new Error("Document not found");
    if (doc.createdBy !== userId) throw new Error("Unauthorized");

    const patch: Record<string, unknown> = { lastModified: Date.now() };
    if (fields.title !== undefined) patch.title = fields.title;
    if (fields.content !== undefined) patch.content = fields.content;
    if (fields.icon !== undefined) patch.icon = fields.icon;
    if (fields.isPublic !== undefined) patch.isPublic = fields.isPublic;
    if (fields.isFavorite !== undefined) patch.isFavorite = fields.isFavorite;

    await ctx.db.patch(id, patch);
    return null;
  },
});

export const mcpArchiveDocument = internalMutation({
  args: {
    userId: v.id("users"),
    id: v.id("documents"),
  },
  handler: async (ctx, { userId, id }) => {
    const doc = (await ctx.db.get(id)) as Doc<"documents"> | null;
    if (!doc) throw new Error("Document not found");
    if (doc.createdBy !== userId) throw new Error("Unauthorized");

    const recursiveArchive = async (documentId: Id<"documents">) => {
      const children = await ctx.db
        .query("documents")
        .withIndex("by_parent", (q) => q.eq("parentId", documentId))
        .collect();
      for (const child of children) {
        if (child.createdBy !== userId) continue;
        await ctx.db.patch(child._id, { isArchived: true });
        await recursiveArchive(child._id);
      }
    };
    await ctx.db.patch(id, { isArchived: true });
    await recursiveArchive(id);
    return null;
  },
});

export const mcpRestoreDocument = internalMutation({
  args: {
    userId: v.id("users"),
    id: v.id("documents"),
  },
  handler: async (ctx, { userId, id }) => {
    const doc = (await ctx.db.get(id)) as Doc<"documents"> | null;
    if (!doc) throw new Error("Document not found");
    if (doc.createdBy !== userId) throw new Error("Unauthorized");

    const recursiveRestore = async (documentId: Id<"documents">) => {
      const children = await ctx.db
        .query("documents")
        .withIndex("by_parent", (q) => q.eq("parentId", documentId))
        .collect();
      for (const child of children) {
        if (child.createdBy !== userId) continue;
        await ctx.db.patch(child._id, { isArchived: false });
        await recursiveRestore(child._id);
      }
    };
    await ctx.db.patch(id, { isArchived: false });
    await recursiveRestore(id);
    return null;
  },
});

export const mcpToggleFavorite = internalMutation({
  args: {
    userId: v.id("users"),
    id: v.id("documents"),
  },
  handler: async (ctx, { userId, id }) => {
    const doc = (await ctx.db.get(id)) as Doc<"documents"> | null;
    if (!doc) throw new Error("Document not found");
    if (doc.createdBy !== userId) throw new Error("Unauthorized");
    await ctx.db.patch(id, { isFavorite: !doc.isFavorite });
    return null;
  },
});

export const mcpDuplicateDocument = internalMutation({
  args: {
    userId: v.id("users"),
    documentId: v.id("documents"),
    title: v.optional(v.string()),
  },
  handler: async (ctx, { userId, documentId, title }) => {
    const original = (await ctx.db.get(documentId)) as Doc<"documents"> | null;
    if (!original) throw new Error("Document not found");
    if (original.createdBy !== userId) throw new Error("Unauthorized");

    const newTitle = title || `${original.title} (Copy)`;
    const newDocId = await ctx.db.insert("documents", {
      title: newTitle,
      parentId: original.parentId,
      isPublic: false,
      createdBy: userId,
      lastEditedBy: userId,
      content: original.content,
      summary: original.summary,
      icon: original.icon,
      isArchived: false,
      isFavorite: false,
      lastModified: Date.now(),
      documentType: (original as any).documentType,
    } as any);
    return newDocId;
  },
});

// ── Search (read-only, accepts userId) ──────────────────────────

export const mcpSearchDocuments = internalQuery({
  args: {
    userId: v.id("users"),
    query: v.string(),
  },
  handler: async (ctx, { userId, query: q }) => {
    return await ctx.db
      .query("documents")
      .withSearchIndex("search_title", (qb) =>
        qb.search("title", q).eq("createdBy", userId).eq("isArchived", false)
      )
      .take(50);
  },
});

export const mcpListDocuments = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { userId, limit }) => {
    return await ctx.db
      .query("documents")
      .withIndex("by_user", (q) => q.eq("createdBy", userId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .order("desc")
      .take(limit ?? 100);
  },
});

export const mcpExportToMarkdown = internalQuery({
  args: {
    userId: v.id("users"),
    documentId: v.id("documents"),
  },
  handler: async (ctx, { userId, documentId }) => {
    const doc = (await ctx.db.get(documentId)) as Doc<"documents"> | null;
    if (!doc) throw new Error("Document not found");
    if (!doc.isPublic && doc.createdBy !== userId) throw new Error("Unauthorized");

    // Inline markdown serializer (same as exportDocument.ts)
    const content = doc.content || "";
    let markdown: string;
    try {
      const parsed = JSON.parse(content);
      markdown = blockToMd(parsed);
    } catch {
      markdown = content;
    }

    return { title: doc.title, markdown: `# ${doc.title}\n\n${markdown}` };
  },
});

// ── Folder endpoints ────────────────────────────────────────────

export const mcpCreateFolder = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    color: v.string(),
  },
  handler: async (ctx, { userId, name, color }) => {
    const now = Date.now();
    return await ctx.db.insert("folders", {
      name,
      color,
      userId,
      isExpanded: true,
      createdAt: now,
      updatedAt: now,
    } as any);
  },
});

export const mcpListFolders = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("folders")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const mcpGetFolderWithDocuments = internalQuery({
  args: {
    userId: v.id("users"),
    folderId: v.id("folders"),
  },
  handler: async (ctx, { userId, folderId }) => {
    const folder = (await ctx.db.get(folderId)) as Doc<"folders"> | null;
    if (!folder || folder.userId !== userId) return null;

    const links = await ctx.db
      .query("documentFolders")
      .withIndex("by_folder", (q) => q.eq("folderId", folderId))
      .collect();

    const docs = await Promise.all(
      links.map(async (link) => {
        if (link.userId !== userId) return null;
        const doc = (await ctx.db.get(link.documentId)) as Doc<"documents"> | null;
        return doc && doc.createdBy === userId && !doc.isArchived ? doc : null;
      })
    );

    return { ...folder, documents: docs.filter(Boolean) };
  },
});

export const mcpAddDocumentToFolder = internalMutation({
  args: {
    userId: v.id("users"),
    documentId: v.id("documents"),
    folderId: v.id("folders"),
  },
  handler: async (ctx, { userId, documentId, folderId }) => {
    const folder = (await ctx.db.get(folderId)) as Doc<"folders"> | null;
    if (!folder || folder.userId !== userId) {
      throw new Error("Folder not found or unauthorized");
    }
    const document = (await ctx.db.get(documentId)) as Doc<"documents"> | null;
    if (!document || document.createdBy !== userId) {
      throw new Error("Document not found or unauthorized");
    }

    const existing = await ctx.db
      .query("documentFolders")
      .withIndex("by_document_folder", (q) =>
        q.eq("documentId", documentId).eq("folderId", folderId)
      )
      .first();

    if (!existing) {
      await ctx.db.insert("documentFolders", {
        documentId,
        folderId,
        userId,
        addedAt: Date.now(),
      });
    }
    return null;
  },
});

export const mcpRemoveDocumentFromFolder = internalMutation({
  args: {
    userId: v.id("users"),
    documentId: v.id("documents"),
    folderId: v.id("folders"),
  },
  handler: async (ctx, { userId, documentId, folderId }) => {
    const link = await ctx.db
      .query("documentFolders")
      .withIndex("by_document_folder", (q) =>
        q.eq("documentId", documentId).eq("folderId", folderId)
      )
      .first();

    if (link && (link as any).userId === userId) {
      await ctx.db.delete(link._id);
    }
    return null;
  },
});

// ── Spreadsheet endpoints ───────────────────────────────────────

export const mcpCreateSpreadsheet = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
  },
  handler: async (ctx, { userId, name }) => {
    const now = Date.now();
    return await ctx.db.insert("spreadsheets", {
      name,
      userId,
      createdAt: now,
      updatedAt: now,
    } as any);
  },
});

export const mcpListSpreadsheets = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { userId, limit }) => {
    return await ctx.db
      .query("spreadsheets")
      .filter((q) => q.eq(q.field("userId"), userId))
      .order("desc")
      .take(Math.min(limit ?? 25, 100));
  },
});

export const mcpGetSpreadsheetRange = internalQuery({
  args: {
    userId: v.id("users"),
    sheetId: v.id("spreadsheets"),
    startRow: v.number(),
    endRow: v.number(),
    startCol: v.number(),
    endCol: v.number(),
  },
  handler: async (ctx, { userId, sheetId, startRow, endRow, startCol, endCol }) => {
    const sheet = (await ctx.db.get(sheetId)) as Doc<"spreadsheets"> | null;
    if (!sheet || sheet.userId !== userId) {
      throw new Error("Spreadsheet not found or unauthorized");
    }

    return await ctx.db
      .query("sheetCells")
      .withIndex("by_sheet_row_col", (q) => q.eq("sheetId", sheetId))
      .filter((q) =>
        q.and(
          q.gte(q.field("row"), startRow),
          q.lte(q.field("row"), endRow),
          q.gte(q.field("col"), startCol),
          q.lte(q.field("col"), endCol)
        )
      )
      .collect();
  },
});

export const mcpApplySpreadsheetOperations = internalMutation({
  args: {
    userId: v.id("users"),
    sheetId: v.id("spreadsheets"),
    operations: v.array(v.any()),
  },
  handler: async (ctx, { userId, sheetId, operations }) => {
    const sheet = (await ctx.db.get(sheetId)) as Doc<"spreadsheets"> | null;
    if (!sheet || sheet.userId !== userId) {
      throw new Error("Spreadsheet not found or unauthorized");
    }

    let applied = 0;
    let errors = 0;

    for (const op of operations) {
      try {
        if (op.op === "setCell") {
          const existing = await ctx.db
            .query("sheetCells")
            .withIndex("by_sheet_row_col", (q) => q.eq("sheetId", sheetId))
            .filter((q) =>
              q.and(
                q.eq(q.field("row"), op.row),
                q.eq(q.field("col"), op.col)
              )
            )
            .first();

          if (existing) {
            await ctx.db.patch(existing._id, {
              value: op.value,
              type: op.type || "text",
              updatedAt: Date.now(),
              updatedBy: userId,
            } as any);
          } else {
            await ctx.db.insert("sheetCells", {
              sheetId,
              row: op.row,
              col: op.col,
              value: op.value,
              type: op.type || "text",
              updatedAt: Date.now(),
              updatedBy: userId,
            } as any);
          }
          applied++;
        } else if (op.op === "clearCell") {
          const existing = await ctx.db
            .query("sheetCells")
            .withIndex("by_sheet_row_col", (q) => q.eq("sheetId", sheetId))
            .filter((q) =>
              q.and(
                q.eq(q.field("row"), op.row),
                q.eq(q.field("col"), op.col)
              )
            )
            .first();
          if (existing) {
            await ctx.db.delete(existing._id);
          }
          applied++;
        } else {
          errors++;
        }
      } catch {
        errors++;
      }
    }

    await ctx.db.patch(sheetId, { updatedAt: Date.now() } as any);
    return { applied, errors };
  },
});

// ── File listing ────────────────────────────────────────────────

export const mcpListFiles = internalQuery({
  args: {
    userId: v.string(),
    fileType: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { userId, fileType, limit }) => {
    let q = ctx.db
      .query("files")
      .filter((qb) => qb.eq(qb.field("userId"), userId));

    if (fileType) {
      q = q.filter((qb) => qb.eq(qb.field("fileType"), fileType));
    }

    return await q.order("desc").take(limit ?? 50);
  },
});

// ── Inline markdown helpers ─────────────────────────────────────

function inlineToMd(nodes: any[]): string {
  if (!Array.isArray(nodes)) return "";
  return nodes
    .map((node) => {
      if (node.type === "text") {
        let text = node.text || "";
        const marks: any[] = Array.isArray(node.marks) ? node.marks : [];
        const styles = node.styles || {};
        if (marks.some((m: any) => m.type === "bold") || styles.bold)
          text = `**${text}**`;
        if (marks.some((m: any) => m.type === "italic") || styles.italic)
          text = `*${text}*`;
        if (marks.some((m: any) => m.type === "code") || styles.code)
          text = `\`${text}\``;
        return text;
      }
      if (node.content) return inlineToMd(node.content);
      return "";
    })
    .join("");
}

function blockToMd(block: any): string {
  if (!block || typeof block !== "object") return "";
  const type = block.type;
  const content: any[] = Array.isArray(block.content) ? block.content : [];
  const props = block.props || block.attrs || {};

  switch (type) {
    case "doc":
      return content.map((c) => blockToMd(c)).join("\n\n");
    case "blockContainer":
    case "blockGroup":
      return content.map((c) => blockToMd(c)).join("\n");
    case "paragraph":
      return inlineToMd(content);
    case "heading":
      return "#".repeat(Math.min(props.level || 1, 6)) + " " + inlineToMd(content);
    case "bulletListItem":
      return "- " + inlineToMd(content);
    case "numberedListItem":
      return "1. " + inlineToMd(content);
    case "checkListItem":
      return `- [${props.checked || block.checked ? "x" : " "}] ` + inlineToMd(content);
    case "codeBlock": {
      const code = content.map((n: any) => n.text || "").join("");
      return "```" + (props.language || "") + "\n" + code + "\n```";
    }
    case "quote":
    case "blockquote":
      return "> " + inlineToMd(content);
    case "horizontalRule":
      return "---";
    default:
      return content.length > 0 ? content.map((c) => blockToMd(c)).join("\n") : "";
  }
}
