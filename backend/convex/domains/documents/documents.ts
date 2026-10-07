import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc, Id } from "../../_generated/dataModel";
import { api, internal, components } from "../../_generated/api";
import { extractMediaFromMessages } from "../../lib/dossierHelpers";

// Internal: mark document as RAG-indexed
export const markRagIndexed = internalMutation({
  args: { documentId: v.id("documents"), timestamp: v.number() },
  handler: async (ctx, { documentId, timestamp }) => {
    await ctx.db.patch(documentId, { ragIndexedAt: timestamp });
    return null;
  },
});

// Internal: update document content (for agent tools, bypasses auth)
export const updateDocumentContent = internalMutation({
  args: {
    documentId: v.id("documents"),
    content: v.string(),
  },
  handler: async (ctx, { documentId, content }) => {
    const doc = await ctx.db.get(documentId);
    if (!doc) throw new Error("Document not found");
    await ctx.db.patch(documentId, {
      content,
      lastModified: Date.now(),
    });
    // Re-index after updates
    await ctx.scheduler.runAfter(0, (internal as any).fileSearch.upsertDocument, { documentId });
    return { success: true };
  },
});

// Internal: get document by ID (for agent tools, bypasses auth)
export const getDocumentById = internalQuery({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    return await ctx.db.get(documentId);
  },
});

// Internal: find document linked to a file (for RAG indexing after chunk extraction)
export const getDocumentByFileId = internalQuery({
  args: { fileId: v.id("files") },
  handler: async (ctx, { fileId }) => {
    // documents.fileId is optional — filter scan (no index needed, rare call)
    const docs = await ctx.db.query("documents").collect();
    return docs.find((d) => (d as any).fileId === fileId) ?? null;
  },
});

import {
  type TipTapNode,
  type MediaAsset,
  convertMediaAssetsToTipTap,
  parseInlineMarks
} from "../../lib/markdownToTipTap";

// =================================================================
// Editor content uses ProseMirror/BlockNote JSON format.
// All new documents use the unified BlockNote editor.
// =================================================================

/**
 * Extract plain text from rich text JSON structure (like Prosemirror document)
 * @param content Rich text JSON content
 * @returns Plain text string
 */
const extractPlainTextFromRichContent = (content: any): string => {
  if (!content) return "";

  const text = "";

  // Handle string content (already plain text)
  if (typeof content === "string") {
    // Try to parse as JSON if it looks like JSON
    if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(content);
        return extractPlainTextFromRichContent(parsed);
      } catch {
        return content; // Return as-is if not valid JSON
      }
    }
    return content;
  }

  // Handle JSON content structure
  if (typeof content === "object" && content !== null) {
    // Special case: legacy EditorJS schema with blocks array (for migration compatibility)
    const anyContent: any = content;
    if (Array.isArray(anyContent.blocks)) {
      const blocks: any[] = anyContent.blocks ?? [];
      const lines: string[] = [];
      for (const b of blocks) {
        try {
          const t = (b?.data?.text ?? "") as string;
          switch (b?.type) {
            case "header": {
              const level = Math.min(6, Number(b?.data?.level ?? 1) || 1);
              lines.push("# ".repeat(level) + t);
              break;
            }
            case "list": {
              const items: string[] = Array.isArray(b?.data?.items) ? b.data.items : [];
              const style = (b?.data?.style || "unordered") as string;
              items.forEach((it: string, idx: number) => {
                const prefix = style === "ordered" ? `${idx + 1}. ` : "- ";
                lines.push(prefix + (it ?? ""));
              });
              break;
            }
            case "quote":
              lines.push("> " + t);
              break;
            case "delimiter":
              lines.push("---");
              break;
            case "code":
              lines.push((b?.data?.code ?? "") as string);
              break;
            case "paragraph":
            default:
              lines.push(String(t).replace(/<br\s*\/?>(?=\s|$)/g, "\n"));
          }
        } catch {
          // ignore malformed block
        }
      }
      return lines.join("\n\n").trimEnd();
    }

    // Recursively extract text from content array
    if (Array.isArray(content)) {
      return content.map((item: any) => extractPlainTextFromRichContent(item)).join(" ");
    }

    // Handle text nodes
    if (content.type === "text" && content.text) {
      return content.text;
    }

    // Handle nodes with content array
    if (content.content && Array.isArray(content.content)) {
      return content.content.map((item: any) => extractPlainTextFromRichContent(item)).join(" ");
    }

    // Handle paragraph-like structures
    if (content.type && (content.type === "paragraph" || content.type === "blockContainer" || content.type === "blockGroup")) {
      if (content.content) {
        return extractPlainTextFromRichContent(content.content) + " ";
      }
    }
  }

  return text;
};

/**
 * Parse markdown text and convert to BlockNote-compatible rich text nodes with styles
 * @param text The markdown text to parse
 * @returns Array of text nodes with appropriate styles (bold, italic, code)
 */
const parseMarkdownText = (text: string): any[] => {
  if (!text) return [];

  const nodes: any[] = [];
  let currentIndex = 0;

  // Regex patterns for markdown formatting
  const patterns: Array<{ regex: RegExp; styles: Partial<Record<string, boolean>> }> = [
    { regex: /\*\*\*(.*?)\*\*\*/g, styles: { bold: true, italic: true } }, // ***bold italic***
    { regex: /\*\*(.*?)\*\*/g, styles: { bold: true } }, // **bold**
    { regex: /\*(.*?)\*/g, styles: { italic: true } }, // *italic*
    { regex: /`(.*?)`/g, styles: { code: true } }, // `code`
  ];

  // Find all matches and their positions
  const matches: { start: number; end: number; text: string; styles: Partial<Record<string, boolean>> }[] = [];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[1], // The text without the markdown syntax
        styles: pattern.styles,
      });
    }
  }

  // Sort matches by start position
  matches.sort((a, b) => a.start - b.start);

  // Remove overlapping matches (keep the first one)
  const nonOverlappingMatches: { start: number; end: number; text: string; styles: Partial<Record<string, boolean>> }[] = [];
  for (const match of matches) {
    const hasOverlap = nonOverlappingMatches.some(existing =>
      (match.start >= existing.start && match.start < existing.end) ||
      (match.end > existing.start && match.end <= existing.end)
    );
    if (!hasOverlap) {
      nonOverlappingMatches.push(match);
    }
  }

  // Build the text nodes
  for (const match of nonOverlappingMatches) {
    // Add plain text before the match
    if (match.start > currentIndex) {
      const plainText = text.slice(currentIndex, match.start);
      if (plainText) {
        nodes.push({ type: "text", text: plainText });
      }
    }

    // Add the formatted text
    nodes.push({
      type: "text",
      styles: match.styles,
      text: match.text
    });

    currentIndex = match.end;
  }

  // Add any remaining plain text
  if (currentIndex < text.length) {
    const remainingText = text.slice(currentIndex);
    if (remainingText) {
      nodes.push({ type: "text", text: remainingText });
    }
  }

  // If no matches were found, return the original text as a single node
  if (nodes.length === 0 && text) {
    nodes.push({ type: "text", text });
  }

  return nodes;
};


/**
 * Build a ProseMirror/BlockNote-compatible JSON string from our simple array-of-blocks.
 * This is the canonical format used by the UnifiedEditor.
 */
const buildProseMirrorFromBlocks = (blocks: any[]): string => {
  type PMNode = { type: string; attrs?: Record<string, any>; content?: PMNode[] } & Record<string, any>;

  const makeParagraph = (text?: string): PMNode => ({
    type: "paragraph",
    attrs: { textAlignment: "left" },
    content: parseMarkdownText(text ?? ""),
  });

  const toText = (val: any) => String(val ?? "");

  // Extract a normalized children array from a block (either children or items)
  const getChildren = (b: any): any[] => {
    const kids = Array.isArray(b?.children)
      ? b.children
      : Array.isArray(b?.items)
        ? b.items
        : [];
    return Array.isArray(kids) ? kids : [];
  };

  // Build nested list nodes from a children array (only list nodes)
  const buildNestedLists = (children: any[]): PMNode[] => {
    const out: PMNode[] = [];
    let j = 0;
    while (j < children.length) {
      const c = children[j] ?? {};
      if (c.type === "bulletListItem") {
        const run: any[] = [];
        while (j < children.length && children[j]?.type === "bulletListItem") {
          run.push(children[j]);
          j++;
        }
        out.push({
          type: "bulletList",
          content: run.map(convertBulletListItem),
        });
        continue;
      }
      if (c.type === "checkListItem") {
        const run: any[] = [];
        while (j < children.length && children[j]?.type === "checkListItem") {
          run.push(children[j]);
          j++;
        }
        out.push({
          type: "taskList",
          content: run.map(convertTaskListItem),
        });
        continue;
      }
      // Non-list child: coerce to paragraph inside list item context
      out.push(makeParagraph(toText(c.text)));
      j++;
    }
    return out;
  };

  const convertBulletListItem = (b: any): PMNode => {
    const nested = buildNestedLists(getChildren(b));
    const content: PMNode[] = [makeParagraph(toText(b.text)), ...nested];
    return { type: "listItem", content };
  };

  const convertTaskListItem = (b: any): PMNode => {
    const nested = buildNestedLists(getChildren(b));
    const content: PMNode[] = [makeParagraph(toText(b.text)), ...nested];
    return { type: "taskItem", attrs: { checked: !!b.checked }, content };
  };

  const topLevel: PMNode[] = [];

  if (!Array.isArray(blocks) || blocks.length === 0) {
    return JSON.stringify({ type: "doc", content: [makeParagraph()] });
  }

  // Helper to flush a run of list items (top-level)
  const flushBulletRun = (runBlocks: any[]) => {
    if (runBlocks.length === 0) return;
    topLevel.push({
      type: "bulletList",
      content: runBlocks.map(convertBulletListItem),
    });
  };
  const flushTaskRun = (runBlocks: any[]) => {
    if (runBlocks.length === 0) return;
    topLevel.push({
      type: "taskList",
      content: runBlocks.map(convertTaskListItem),
    });
  };

  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i] ?? {};
    // Bullet list run
    if (b.type === "bulletListItem") {
      const run: any[] = [];
      while (i < blocks.length && blocks[i]?.type === "bulletListItem") {
        run.push(blocks[i]);
        i++;
      }
      flushBulletRun(run);
      continue;
    }
    // Task list run
    if (b.type === "checkListItem") {
      const run: any[] = [];
      while (i < blocks.length && blocks[i]?.type === "checkListItem") {
        run.push(blocks[i]);
        i++;
      }
      flushTaskRun(run);
      continue;
    }

    // Single block handling
    switch (b.type) {
      case "heading": {
        topLevel.push({
          type: "heading",
          attrs: { textAlignment: "left", level: b.level || 1 },
          content: parseMarkdownText(String(b.text ?? "")),
        });
        break;
      }
      case "paragraph": {
        topLevel.push(makeParagraph(String(b.text ?? "")));
        break;
      }
      case "quote": {
        topLevel.push({
          type: "blockquote",
          attrs: { textAlignment: "left" },
          content: parseMarkdownText(String(b.text ?? "")),
        });
        break;
      }
      case "codeBlock": {
        topLevel.push({
          type: "codeBlock",
          attrs: { language: b.lang || "text" },
          content: b.text ? [{ type: "text", text: String(b.text) }] : [],
        });
        break;
      }
      case "horizontalRule": {
        topLevel.push({ type: "horizontalRule", attrs: {} });
        break;
      }
      default: {
        // Fallback to paragraph
        topLevel.push(makeParagraph(String(b.text ?? "")));
      }
    }
    i++;
  }

  // Ensure non-empty content
  if (topLevel.length === 0) {
    topLevel.push(makeParagraph());
  }

  const doc = { type: "doc", content: topLevel };
  return JSON.stringify(doc);
};


/**
 * Create a new document with ProseMirror/BlockNote content.
 * Uses the unified ProseMirror JSON format compatible with UnifiedEditor.
 */
export const create = mutation({
  args: {
    title: v.string(),
    parentId: v.optional(v.id("documents")),
    // The content is now an array of objects, not a string.
    content: v.optional(v.array(v.any())),
    // Optional: associate this doc with a specific day for agenda view (local midnight ms)
    agendaDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Support evaluation mode where userId is passed in ctx.evaluationUserId
    let userId = (ctx as any).evaluationUserId;
    if (!userId) {
      userId = await getAuthUserId(ctx);
    }
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Build ProseMirror JSON for BlockNote editor
    const initialContent = buildProseMirrorFromBlocks(args.content || []);

    const document = await ctx.db.insert("documents", {
      title: args.title,
      parentId: args.parentId,
      createdBy: userId,
      isPublic: false,
      isArchived: false,
      content: initialContent,
      agendaDate: args.agendaDate,
      lastModified: Date.now(),
    });

    // Asynchronously index into Gemini File Search
    // Use statically imported 'internal' - dynamic imports are not supported in mutations
    await ctx.scheduler.runAfter(0, internal.domains.documents.fileSearch.upsertDocument, { documentId: document });

    return document;
  },
});

// Create a document with a prebuilt content string (ProseMirror JSON)
export const createWithContent = mutation({
  args: {
    title: v.string(),
    content: v.string(),
    parentId: v.optional(v.id("documents")),
    agendaDate: v.optional(v.number()),
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const document = await ctx.db.insert("documents", {
      title: args.title,
      parentId: args.parentId,
      createdBy: userId,
      isPublic: false,
      isArchived: false,
      content: args.content,
      agendaDate: args.agendaDate,
      lastModified: Date.now(),
    } as any);

    await ctx.scheduler.runAfter(0, (internal as any).fileSearch.upsertDocument, { documentId: document as Id<"documents"> });

    return document as Id<"documents">;
  },
});

// Duplicate an existing document (clone content, reset metadata)
export const duplicateDocument = mutation({
  args: {
    documentId: v.id("documents"),
    title: v.optional(v.string()),
  },
  returns: v.id("documents"),
  handler: async (ctx, { documentId, title }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const original = (await ctx.db.get(documentId)) as Doc<"documents"> | null;
    if (!original) throw new Error("Document not found");
    if (original.createdBy !== userId) throw new Error("Unauthorized");

    const now = Date.now();
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
      lastModified: now,
      documentType: (original as any).documentType,
    } as any);

    return newDocId as Id<"documents">;
  },
});

/**
 * Create a new dossier document (documentType: "dossier", dossierType: "primary").
 * Stores TipTap/ProseMirror JSON as a string in `content`.
 */
export const createDossier = mutation({
  args: {
    title: v.string(),
    content: v.optional(v.string()),
    parentId: v.optional(v.id("documents")),
    isPublic: v.optional(v.boolean()),
    allowPublicEdit: v.optional(v.boolean()),
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    // Support evaluation mode where userId is passed in ctx.evaluationUserId
    let userId = (ctx as any).evaluationUserId;
    if (!userId) {
      userId = await getAuthUserId(ctx);
    }
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const now = Date.now();
    const initialContent =
      args.content ??
      JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { textAlignment: "left" },
            content: [{ type: "text", text: "" }],
          },
        ],
      });

    const documentId = await ctx.db.insert("documents", {
      title: args.title,
      parentId: args.parentId,
      createdBy: userId,
      isPublic: args.isPublic ?? false,
      allowPublicEdit: args.allowPublicEdit ?? false,
      isArchived: false,
      content: initialContent,
      lastModified: now,
      documentType: "dossier",
      dossierType: "primary",
    } as any);

    // Asynchronously index into Gemini File Search
    await ctx.scheduler.runAfter(0, internal.domains.documents.fileSearch.upsertDocument, {
      documentId,
    });

    return documentId as Id<"documents">;
  },
});

// Notes scheduled on a calendar day (documents with agendaDate in range)
export const listNotesInRange = query({
  args: { start: v.number(), end: v.number() },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("documents")
      .withIndex("by_user_agendaDate", (q: any) =>
        q.eq("createdBy", userId as any).gte("agendaDate", args.start).lte("agendaDate", args.end)
      )
      .filter((q: any) => q.neq(q.field("isArchived"), true))
      .order("asc")
      .take(500);
    return rows;
  },
});

// List documents filtered by tag
export const listDocumentsByTag = query({
  args: {
    tag: v.string(),
    start: v.optional(v.number()),
    end: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Find all tagRefs for this tag name
    const tagRecords = await ctx.db
      .query("tags")
      .withIndex("by_name", (q) => q.eq("name", args.tag))
      .take(25);

    if (tagRecords.length === 0) return [];

    // Get all tagRefs pointing to documents with this tag
    const allTagRefs: any[] = [];
    for (const tag of tagRecords) {
      const refs = await ctx.db
        .query("tagRefs")
        .withIndex("by_tag", (q) => q.eq("tagId", tag._id))
        .filter((q) => q.eq(q.field("targetType"), "documents"))
        .take(200);
      allTagRefs.push(...refs);
    }

    // Get unique document IDs
    const docIds = new Set(allTagRefs.map(ref => ref.targetId));

    // Fetch documents
    const documents: any[] = [];
    for (const docIdStr of docIds) {
      try {
        const doc = await ctx.db.get(docIdStr as Id<"documents">) as Doc<"documents"> | null;
        if (!doc) continue;
        if (doc.isArchived) continue;
        if (doc.createdBy !== userId) continue;
        documents.push(doc);
      } catch {
        // Skip invalid IDs
        continue;
      }
    }

    return documents;
  },
});

// Tiny resolvers for document titles (for references UI)
export const getTitle = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const doc = await ctx.db.get(args.documentId) as Doc<"documents"> | null;
    if (!doc) return null;
    if (!doc.isPublic && doc.createdBy !== userId) return null;
    return { title: doc.title } as { title: string };
  },
});

export const getTitles = query({
  args: { ids: v.array(v.id("documents")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const out: Array<{ _id: Id<"documents">; title: string }> = [];
    for (const id of args.ids) {
      const doc = await ctx.db.get(id) as Doc<"documents"> | null;
      if (doc && (doc.isPublic || doc.createdBy === userId)) {
        out.push({ _id: id, title: doc.title });
      }
    }
    return out;
  },
});

// ... the rest of your file remains exactly the same ...

export const getSidebar = query({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const documents = await ctx.db
      .query("documents")
      .withIndex("by_user", (q) => q.eq("createdBy", userId))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .order("desc")
      .take(200);

    // Sort by lastModified if available, otherwise by _creationTime
    return documents.sort((a, b) => {
      const aTime = (a).lastModified || a._creationTime;
      const bTime = (b).lastModified || b._creationTime;
      return bTime - aTime; // descending order (newest first)
    });
  },
});

/**
 * Find a document by title across user-owned and public documents.
 * Tries exact (case-insensitive) match first, then substring match.
 * Returns the first matching document's id or null.
 */
export const findByTitleAny = query({
  args: { title: v.string() },
  handler: async (ctx, { title }) => {
    const userId = await getAuthUserId(ctx);
    const lower = title.toLowerCase();

    const searchForMatch = async (params: {
      isPublic?: boolean;
      createdBy?: Id<"users">;
    }) => {
      const res = await ctx.db
        .query("documents")
        .withSearchIndex("search_title", (q) => {
          let builder = q.search("title", title).eq("isArchived", false as any);
          if (params.isPublic !== undefined) {
            builder = builder.eq("isPublic", params.isPublic);
          }
          if (params.createdBy) {
            builder = builder.eq("createdBy", params.createdBy as any);
          }
          return builder;
        })
        .take(50);

      let hit = res.find((d) => (d.title || "").toLowerCase() === lower);
      if (!hit) hit = res.find((d) => (d.title || "").toLowerCase().includes(lower));
      return hit;
    };

    // 1) Search user-owned documents
    const userHit = await searchForMatch({ createdBy: userId as any });
    if (userHit) return userHit._id;

    // 2) Search public documents
    const publicHit = await searchForMatch({ isPublic: true });
    return publicHit ? publicHit._id : null;
  },
});

export const getSidebarWithPreviews = query({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const documents = await ctx.db
      .query("documents")
      .withIndex("by_user", (q) => q.eq("createdBy", userId))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .order("desc")
      .take(200);

    // Add truncated content preview, file metadata, and sort by lastModified
    const documentsWithPreviews = await Promise.all(documents.map(async (doc) => {
      let plainText = "";
      if (doc.content && doc.content.trim()) {
        plainText = extractPlainTextFromRichContent(doc.content);
      }

      // For file-type documents, fetch analyzedAt, fileSize, and media URLs from the files table
      let fileAnalyzedAt: number | undefined;
      let fileSize: number | undefined;
      let thumbnailUrl: string | null = null;
      let mediaUrl: string | null = null;
      let csvUrl: string | null = null;
      if (doc.documentType === "file" && doc.fileId) {
        const file = await ctx.db.get(doc.fileId as Id<"files">) as Doc<"files"> | null;
        if (file) {
          fileAnalyzedAt = file.analyzedAt;
          fileSize = file.fileSize;
          // For image and video files, generate media URLs
          if ((file.fileType === "image" || file.fileType === "video") && file.storageId) {
            const url = await ctx.storage.getUrl(file.storageId);
            if (file.fileType === "image") {
              thumbnailUrl = url;
            }
            mediaUrl = url;
          }
          // For CSV and Excel files, generate URL for preview fetching
          // Note: doc.fileType contains the actual file type (csv, excel, etc.)
          // while file.fileType in the files table may be "document"
          // Also check for .xlsx/.xls extension in title for files with unknown fileType
          const isSpreadsheet =
            doc.fileType === "csv" ||
            doc.fileType === "excel" ||
            (doc.fileType === "unknown" && doc.title && /\.(xlsx?|csv)$/i.test(doc.title));
          if (isSpreadsheet && file.storageId) {
            csvUrl = await ctx.storage.getUrl(file.storageId);
          }
        }
      }

      return {
        ...doc,
        contentPreview: plainText && plainText.trim()
          ? plainText.substring(0, 150).trim()
          : null,
        // Include analyzedAt from file if available (for file-type documents)
        analyzedAt: fileAnalyzedAt ?? (doc).analyzedAt,
        fileSize: fileSize ?? (doc).fileSize,
        // Include thumbnail URL for image files
        thumbnailUrl,
        // Include media URL for playable media (images and videos)
        mediaUrl,
        // Include CSV URL for spreadsheet preview
        csvUrl,
      };
    }));

    return documentsWithPreviews.sort((a, b) => {
      const aTime = (a).lastModified || a._creationTime;
      const bTime = (b).lastModified || b._creationTime;
      return bTime - aTime; // descending order (newest first)
    });
  },
});

export const getSidebarWithOptions = query({
  args: {
    sortBy: v.optional(v.union(v.literal("updated"), v.literal("created"), v.literal("title"))),
    sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    filterBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    let documents = await ctx.db
      .query("documents")
      .withIndex("by_user", (q) => q.eq("createdBy", userId))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .take(200);

    // Apply title filter if provided
    if (args.filterBy) {
      const filter = args.filterBy.toLowerCase();
      documents = documents.filter(doc =>
        doc.title.toLowerCase().includes(filter)
      );
    }

    // Apply sorting
    const sortBy = args.sortBy || "updated";
    const sortOrder = args.sortOrder || "desc";

    documents.sort((a, b) => {
      let aValue: number | string;
      let bValue: number | string;

      switch (sortBy) {
        case "created":
          aValue = a._creationTime;
          bValue = b._creationTime;
          break;
        case "title":
          aValue = a.title.toLowerCase();
          bValue = b.title.toLowerCase();
          break;
        case "updated":
        default:
          aValue = (a).lastModified || a._creationTime;
          bValue = (b).lastModified || b._creationTime;
          break;
      }

      if (typeof aValue === "string" && typeof bValue === "string") {
        return sortOrder === "asc" ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
      } else {
        return sortOrder === "asc" ? (aValue as number) - (bValue as number) : (bValue as number) - (aValue as number);
      }
    });

    return documents;
  },
});

export const listUserDossiers = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 10;

    const documents = await ctx.db
      .query("documents")
      .withIndex("by_user", (q) => q.eq("createdBy", userId))
      .filter((q) =>
        q.and(
          q.eq(q.field("documentType"), "dossier"),
          q.eq(q.field("dossierType"), "primary"),
          q.eq(q.field("isArchived"), false)
        )
      )
      .order("desc")
      .take(limit);

    return documents.sort((a, b) => {
      const aTime = (a).lastModified || a._creationTime;
      const bTime = (b).lastModified || b._creationTime;
      return bTime - aTime; // newest first
    });
  },
});


export const getById = query({
  args: {
    documentId: v.id("documents"),
    userId: v.optional(v.union(v.id("users"), v.string())), // Optional for evaluation/testing - accepts ID or string
  },
  handler: async (ctx, args) => {
    // Use provided userId or fall back to authenticated user
    const userId = args.userId || await getAuthUserId(ctx);
    const document = await ctx.db.get(args.documentId) as Doc<"documents"> | null;
    if (!document) return null;
    if (!document.isPublic && document.createdBy !== userId) return null;
    return document;
  },
});

/**
 * Get the ancestor chain (parent documents) for breadcrumb navigation.
 * Returns an array of ancestors from root to immediate parent.
 */
export const getAncestors = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const ancestors: Array<{ _id: Id<"documents">; title: string }> = [];

    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    let currentDoc: Doc<"documents"> | null = await ctx.db.get(args.documentId);
    if (!currentDoc) return ancestors;

    // Walk up the parent chain
    while (currentDoc?.parentId) {
      // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
      const parent: Doc<"documents"> | null = await ctx.db.get(currentDoc.parentId);
      if (!parent) break;

      // Check access
      if (!parent.isPublic && parent.createdBy !== userId) break;

      ancestors.unshift({ _id: parent._id, title: parent.title || "Untitled" });
      currentDoc = parent;
    }

    return ancestors;
  },
});

export const update = mutation({
  args: {
    id: v.id("documents"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    coverImage: v.optional(v.id("_storage")),
    icon: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
    allowPublicEdit: v.optional(v.boolean()),
    isFavorite: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const { id, ...rest } = args;
    const existingDocument = await ctx.db.get(id) as Doc<"documents"> | null;
    if (!existingDocument) throw new Error("Not found");
    if (existingDocument.createdBy !== userId) throw new Error("Unauthorized");

    // Add lastModified timestamp to track when document was updated
    const updateData = {
      ...rest,
      lastModified: Date.now()
    };

    const result = await ctx.db.patch(id, updateData);

    // Re-index after updates
    await ctx.scheduler.runAfter(0, (internal as any).fileSearch.upsertDocument, { documentId: id });

    return result;
  },
});

export const removeIcon = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existingDocument = await ctx.db.get(args.id) as Doc<"documents"> | null;
    if (!existingDocument) throw new Error("Not found");
    if (existingDocument.createdBy !== userId) throw new Error("Unauthorized");
    return await ctx.db.patch(args.id, { icon: undefined });
  },
});

export const setDocumentType = mutation({
  args: { id: v.id("documents"), documentType: v.union(v.literal("text"), v.literal("file"), v.literal("timeline")) },
  returns: v.null(),
  handler: async (ctx, { id, documentType }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existing = await ctx.db.get(id) as Doc<"documents"> | null;
    if (!existing) throw new Error("Not found");
    if (existing.createdBy !== userId) throw new Error("Unauthorized");
    await ctx.db.patch(id, { documentType } as any);
    return null;
  },
});


export const removeCoverImage = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existingDocument = await ctx.db.get(args.id) as Doc<"documents"> | null;
    if (!existingDocument) throw new Error("Not found");
    if (existingDocument.createdBy !== userId) throw new Error("Unauthorized");
    return await ctx.db.patch(args.id, { coverImage: undefined });
  },
});

export const archive = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existingDocument = await ctx.db.get(args.id) as Doc<"documents"> | null;
    if (!existingDocument) throw new Error("Not found");
    if (existingDocument.createdBy !== userId) throw new Error("Unauthorized");

    const recursiveArchive = async (documentId: Id<"documents">) => {
      const children = await ctx.db
        .query("documents")
        .withIndex("by_parent", (q) => q.eq("parentId", documentId))
        .collect();
      for (const child of children) {
        await ctx.db.patch(child._id, { isArchived: true });
        await recursiveArchive(child._id);
      }
    };
    const document = await ctx.db.patch(args.id, { isArchived: true });
    await recursiveArchive(args.id);
    return document;
  },
});

export const getTrash = query({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("documents")
      .withIndex("by_user_archived", (q) => q.eq("createdBy", userId).eq("isArchived", true))
      .collect();
  },
});

export const restore = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existingDocument = await ctx.db.get(args.id) as Doc<"documents"> | null;
    if (!existingDocument) throw new Error("Not found");
    if (existingDocument.createdBy !== userId) throw new Error("Unauthorized");

    const recursiveRestore = async (documentId: Id<"documents">) => {
      const children = await ctx.db
        .query("documents")
        .withIndex("by_parent", (q) => q.eq("parentId", documentId))
        .collect();
      for (const child of children) {
        await ctx.db.patch(child._id, { isArchived: false });
        await recursiveRestore(child._id);
      }
    };

    const options: Partial<Doc<"documents">> = { isArchived: false };
    if (existingDocument.parentId) {
      const parent = await ctx.db.get(existingDocument.parentId) as Doc<"documents"> | null;
      if (parent?.isArchived) options.parentId = undefined;
    }
    const document = await ctx.db.patch(args.id, options);
    await recursiveRestore(args.id);
    return document;
  },
});

export const remove = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existingDocument = await ctx.db.get(args.id) as Doc<"documents"> | null;
    if (!existingDocument) throw new Error("Not found");
    if (existingDocument.createdBy !== userId) throw new Error("Unauthorized");
    await ctx.db.delete(args.id);
  },
});

// Paginated node loading for virtualization (performance optimization)
export const getNodesPaginated = query({
  args: {
    documentId: v.id("documents"),
    startOrder: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, { documentId, startOrder, limit }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Check document access
    const document = await ctx.db.get(documentId) as Doc<"documents"> | null;
    if (!document) {
      throw new Error("Document not found");
    }

    if (!document.isPublic && document.createdBy !== userId) {
      throw new Error("Unauthorized");
    }

    // Get nodes in the specified range for virtualization
    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .filter((q) => q.gte(q.field("order"), startOrder))
      .order("asc")
      .take(Math.min(limit, 200)); // Cap at 200 nodes per request

    return nodes;
  },
});

export const clearTrash = mutation({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const trash = await ctx.db
      .query("documents")
      .withIndex("by_user_archived", (q) =>
        q.eq("createdBy", userId).eq("isArchived", true)
      )
      .collect();
    for (const doc of trash) {
      await ctx.db.delete(doc._id);
    }
    return true;
  },
});

export const getSearch = query({
  args: {
    query: v.string(),
    userId: v.optional(v.union(v.id("users"), v.string())), // Optional for evaluation/testing - accepts ID or string
  },
  handler: async (ctx, args) => {
    // Use provided userId or fall back to authenticated user
    const userId = args.userId || await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("documents")
      .withSearchIndex("search_title", (q) =>
        q.search("title", args.query).eq("createdBy", userId).eq("isArchived", false)
      )
      .take(50);
  },
});

// Full-text search across both title and content
export const searchDocumentsFull = query({
  args: {
    query: v.string(),
    userId: v.optional(v.union(v.id("users"), v.string())),
  },
  handler: async (ctx, args) => {
    const userId = args.userId || (await getAuthUserId(ctx));
    if (!userId) return [];

    const titleResults = await ctx.db
      .query("documents")
      .withSearchIndex("search_title", (q) =>
        q
          .search("title", args.query)
          .eq("createdBy", userId as Id<"users">)
          .eq("isArchived", false)
      )
      .take(25);

    const contentResults = await ctx.db
      .query("documents")
      .withSearchIndex("search_content", (q) =>
        q
          .search("content", args.query)
          .eq("createdBy", userId as Id<"users">)
          .eq("isArchived", false)
      )
      .take(25);

    // Deduplicate: title matches first
    const seen = new Set<string>();
    const merged: Array<Doc<"documents"> & { _matchType: "title" | "content" }> = [];

    for (const doc of titleResults) {
      seen.add(doc._id);
      merged.push({ ...doc, _matchType: "title" as const });
    }
    for (const doc of contentResults) {
      if (!seen.has(doc._id)) {
        seen.add(doc._id);
        merged.push({ ...doc, _matchType: "content" as const });
      }
    }

    return merged.slice(0, 50);
  },
});

// Recent documents for default @-mention suggestions
export const getRecentForMentions = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const docs = await ctx.db
      .query("documents")
      .withIndex("by_user", (q) => q.eq("createdBy", userId))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .order("desc")
      .take(200);

    // Sort by lastModified if available, otherwise by creation time (newest first)
    docs.sort((a, b) => {
      const aTime = (a).lastModified || a._creationTime;
      const bTime = (b).lastModified || b._creationTime;
      return bTime - aTime;
    });

    const limit = Math.max(1, Math.min(args.limit ?? 8, 50));
    return docs.slice(0, limit);
  },
});

// Single-document preview for mention hover tooltips
export const getPreviewById = query({
  args: { documentId: v.id("documents"), maxLen: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const doc = await ctx.db.get(args.documentId) as Doc<"documents"> | null;
    if (!doc) return null;
    if (!doc.isPublic && doc.createdBy !== userId) return null;

    let plainText = "";
    if (doc.content && doc.content.trim()) {
      plainText = extractPlainTextFromRichContent(doc.content);
    }

    const maxLen = Math.max(50, Math.min(args.maxLen ?? 180, 500));
    const contentPreview = plainText && plainText.trim()
      ? plainText.substring(0, maxLen).trim()
      : null;

    return {
      _id: doc._id,
      title: doc.title,
      icon: (doc).icon,
      isArchived: doc.isArchived,
      lastModified: (doc).lastModified || doc._creationTime,
      contentPreview,
    } as any;
  },
});

export const getPublic = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("documents")
      .withIndex("by_public", (q) => q.eq("isPublic", true))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .take(200);
  },
});

// Debug query to check document states
export const debugDocuments = query({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const allUserDocs = await ctx.db
      .query("documents")
      .withIndex("by_user", (q) => q.eq("createdBy", userId))
      .take(200);

    return allUserDocs.map(doc => ({
      id: doc._id,
      title: doc.title,
      isPublic: doc.isPublic,
      isArchived: doc.isArchived,
      createdBy: doc.createdBy,
      lastModified: (doc).lastModified,
      _creationTime: doc._creationTime
    }));
  },
});

// Get user information by ID for displaying editor names
export const getUserById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

// Track individual node edits for hover information
export const trackNodeEdit = mutation({
  args: {
    documentId: v.id("documents"),
    nodeId: v.string(), // BlockNote node ID
    content: v.string(), // Node content for identification
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check if user can edit this document
    const document = await ctx.db.get(args.documentId) as Doc<"documents"> | null;
    if (!document) throw new Error("Document not found");

    const isOwner = document.createdBy === userId;
    const isPublicDocument = document.isPublic === true;
    const isArchived = document.isArchived === true;

    if (!isOwner && (!isPublicDocument || isArchived)) {
      throw new Error("Unauthorized");
    }

    // Store or update node edit information in a tracking table
    // For now, we'll use document metadata to track the most recently edited nodes
    const now = Date.now();
    const nodeEditKey = `node_${args.nodeId}`;

    // Store edit info in document metadata (simple approach)
    // In a more complex system, this could be a separate table
    await ctx.db.patch(args.documentId, {
      lastModified: now,
      lastEditedBy: userId,
      [`${nodeEditKey}_editedBy`]: userId,
      [`${nodeEditKey}_editedAt`]: now,
      [`${nodeEditKey}_content`]: args.content.slice(0, 100), // First 100 chars for identification
    } as any);

    return { success: true, timestamp: now };
  },
});

// Get node edit information for hover display
export const getNodeEditInfo = query({
  args: {
    documentId: v.id("documents"),
    nodeId: v.string(),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId) as Doc<"documents"> | null;
    if (!document) return null;

    const nodeEditKey = `node_${args.nodeId}`;
    const editedBy = (document as any)[`${nodeEditKey}_editedBy`];
    const editedAt = (document as any)[`${nodeEditKey}_editedAt`];
    const content = (document as any)[`${nodeEditKey}_content`];

    if (!editedBy || !editedAt) return null;

    return {
      editedBy,
      editedAt,
      content,
    };
  },
});

// Toggle favorite status of a document
export const toggleFavorite = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const document = await ctx.db.get(args.id) as Doc<"documents"> | null;
    if (!document) {
      throw new Error("Document not found");
    }

    if (document.createdBy !== userId) {
      throw new Error("Not authorized to modify this document");
    }

    await ctx.db.patch(args.id, {
      isFavorite: !document.isFavorite,
    });

    return { success: true, isFavorite: !document.isFavorite };
  },
});

/**
 * Get all linked media assets for a dossier
 */
export const getLinkedAssets = query({
  args: {
    dossierId: v.id("documents"),
  },
  returns: v.array(v.object({
    _id: v.id("documents"),
    _creationTime: v.number(),
    title: v.string(),
    documentType: v.optional(v.union(v.literal("text"), v.literal("file"), v.literal("timeline"), v.literal("dossier"))),
    fileType: v.optional(v.string()),
    dossierType: v.optional(v.union(v.literal("primary"), v.literal("media-asset"), v.literal("quick-notes"))),
    parentDossierId: v.optional(v.id("documents")),
    assetMetadata: v.optional(v.object({
      assetType: v.union(
        v.literal("image"),
        v.literal("video"),
        v.literal("youtube"),
        v.literal("sec-document"),
        v.literal("pdf"),
        v.literal("news"),
        v.literal("file")
      ),
      sourceUrl: v.string(),
      thumbnailUrl: v.optional(v.string()),
      extractedAt: v.number(),
      toolName: v.optional(v.string()),
      metadata: v.optional(v.any()),
    })),
  })),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    // Get the dossier to verify access
    const dossier = await ctx.db.get(args.dossierId) as Doc<"documents"> | null;
    if (!dossier) {
      return [];
    }

    // Check access (user must be creator or document must be public)
    if (dossier.createdBy !== userId && !dossier.isPublic) {
      return [];
    }

    // Get all linked assets
    const assets = await ctx.db
      .query("documents")
      .withIndex("by_parent_dossier", (q) => q.eq("parentDossierId", args.dossierId))
      .collect();

    return assets.map(asset => ({
      _id: asset._id,
      _creationTime: asset._creationTime,
      title: asset.title,
      documentType: asset.documentType,
      fileType: asset.fileType,
      dossierType: asset.dossierType,
      parentDossierId: asset.parentDossierId,
      assetMetadata: asset.assetMetadata,
    }));
  },
});

/**
 * Get or create a Quick Notes document linked to a dossier
 * This creates a separate document for quick notes while preserving dossier content
 */
export const getOrCreateQuickNotes = mutation({
  args: {
    dossierId: v.id("documents"),
    userId: v.optional(v.union(v.id("users"), v.string())),
  },
  handler: async (ctx, args) => {
    // Get raw userId from args or auth
    const rawUserId = (args).userId || await getAuthUserId(ctx);
    if (!rawUserId) throw new Error("Not authenticated");

    // Normalize userId to handle pipe-separated format from auth providers
    let userId: Id<"users">;
    if (typeof rawUserId === "string" && rawUserId.includes("|")) {
      const userIdPart = rawUserId.split("|")[0];
      if (!userIdPart || userIdPart.length < 10) {
        throw new Error("Invalid user ID format. Please sign out and sign back in.");
      }
      userId = userIdPart as Id<"users">;
    } else {
      userId = rawUserId as Id<"users">;
    }

    const dossier = await ctx.db.get(args.dossierId) as Doc<"documents"> | null;
    if (!dossier) {
      throw new Error("Dossier not found");
    }

    // Check access: user must be creator OR dossier must be public (for viewing)
    const isCreator = dossier.createdBy === userId;
    const canView = dossier.isPublic;
    const canEdit = isCreator || (dossier.isPublic && dossier.allowPublicEdit);

    if (!isCreator && !canView) {
      throw new Error("Not authorized to view quick notes for this dossier");
    }

    // Check if quick notes already exist
    const existing = await ctx.db
      .query("documents")
      .withIndex("by_parent_dossier", (q) => q.eq("parentDossierId", args.dossierId))
      .filter((q) => q.eq(q.field("dossierType"), "quick-notes"))
      .first();

    if (existing) {
      return existing;
    }

    // Only allow creation if user can edit
    if (!canEdit) {
      // For public dossiers where user can't edit, return null instead of creating
      // This allows viewing the dossier without quick notes
      return null;
    }

    // Create new Quick Notes document
    const quickNotesId = await ctx.db.insert("documents", {
      title: "Quick Notes",
      createdBy: userId,
      isPublic: false,
      isArchived: false,
      isFavorite: false,
      documentType: "text", // Use text type for ProseMirror
      dossierType: "quick-notes",
      parentDossierId: args.dossierId,
    });

    return await ctx.db.get(quickNotesId);
  },
});

/**
 * Migration: Update old dossier documents to use documentType: "dossier"
 * This fixes documents that were created before we added the custom DossierViewer
 */
export const migrateDossiersToNewType = mutation({
  args: {},
  returns: v.object({
    updated: v.number(),
  }),
  handler: async (ctx, _args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Find all documents with dossierType: "primary" but documentType: "text"
    const oldDossiers = await ctx.db
      .query("documents")
      .filter((q) =>
        q.and(
          q.eq(q.field("createdBy"), userId),
          q.eq(q.field("dossierType"), "primary"),
          q.or(
            q.eq(q.field("documentType"), "text"),
            q.eq(q.field("documentType"), undefined)
          )
        )
      )
      .collect();

    // Update them to documentType: "dossier"
    for (const doc of oldDossiers) {
      await ctx.db.patch(doc._id, { documentType: "dossier" });
    }

    return { updated: oldDossiers.length };
  },
});

/**
 * Save a chat session as a Research Dossier with linked media assets
 */
export const saveChatSessionToDossier = mutation({
  args: {
    threadId: v.string(),
    title: v.optional(v.string()),
  },
  returns: v.object({
    dossierId: v.id("documents"),
    messageCount: v.number(),
    mediaCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    console.log("saveChatSessionToDossier called with threadId:", args.threadId);

    // Fetch all messages from the thread using Agent component
    // Use listMessagesByThreadId to get full message structure with parts
    const allMessages: any[] = [];
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const result: any = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
        threadId: args.threadId,
        order: "asc",
        paginationOpts: {
          numItems: 100,
          cursor: cursor,
        },
      });

      console.log(`Fetched ${result.page.length} messages, isDone: ${result.isDone}`);
      allMessages.push(...result.page);
      hasMore = !result.isDone;
      cursor = result.continueCursor || null;
    }

    console.log(`Total messages fetched: ${allMessages.length}`);

    if (allMessages.length === 0) {
      throw new Error("No messages found in thread");
    }

    // Log first message to see structure
    if (allMessages.length > 0) {
      console.log("First message structure:", JSON.stringify(allMessages[0], null, 2));

      // Check for messages with tool information
      const messagesWithTools = allMessages.filter((m: any) => m.tool || m.sources?.length > 0);
      console.log(`Messages with tool info: ${messagesWithTools.length}`);
      if (messagesWithTools.length > 0) {
        console.log("First tool message:", JSON.stringify(messagesWithTools[0], null, 2));
      }

      // Look for tool-result messages
      const toolResultMessages = allMessages.filter((m: any) => {
        if (m.message?.content && Array.isArray(m.message.content)) {
          return m.message.content.some((c: any) => c.type === "tool-result");
        }
        return false;
      });
      console.log(`Messages with tool-result: ${toolResultMessages.length}`);
      if (toolResultMessages.length > 0) {
        console.log("First tool-result message:", JSON.stringify(toolResultMessages[0], null, 2));
      }
    }

    // Extract media assets from tool outputs
    const extractedAssets = extractMediaFromMessages(allMessages);
    console.log(`Extracted ${extractedAssets.length} media assets`);

    // Build TipTap transcript nodes
    const transcriptNodes: TipTapNode[] = [];

    // Add header
    transcriptNodes.push({
      type: "heading",
      attrs: { level: 1, textAlignment: "left" },
      content: [{ type: "text", text: args.title || "Chat Session" }],
    });

    // Add metadata
    const messageCount = allMessages.length;
    const assetCount = extractedAssets.length;
    const createdAt = new Date().toLocaleString();

    transcriptNodes.push({
      type: "paragraph",
      attrs: { textAlignment: "left" },
      content: [
        {
          type: "text",
          text: `Saved on ${createdAt} • ${messageCount} messages • ${assetCount} media assets`,
        },
      ],
    });

    // Add conversation transcript
    for (const message of allMessages) {
      const role = message.role === "user" ? "👤 User" : "🤖 Assistant";
      const timestamp = new Date(message._creationTime).toLocaleTimeString();

      // Add message header
      transcriptNodes.push({
        type: "heading",
        attrs: { level: 3, textAlignment: "left" },
        content: [{ type: "text", text: `${role} (${timestamp})` }],
      });

      // Add message text (preserve markdown formatting via parseInlineMarks)
      if (message.text) {
        console.log(`Message text length: ${message.text.length}`);
        if (message.text.trim()) {
          transcriptNodes.push({
            type: "paragraph",
            attrs: { textAlignment: "left" },
            content: parseInlineMarks(message.text),
          });
        } else {
          console.log("Warning: Message text is empty");
        }
      } else {
        console.log("Warning: Message has no text property");
      }

      // Add tool calls if present
      if (message.parts && Array.isArray(message.parts)) {
        const toolParts = message.parts.filter((p: any) => p.type === "tool-result");
        if (toolParts.length > 0) {
          transcriptNodes.push({
            type: "paragraph",
            attrs: { textAlignment: "left" },
            content: [
              {
                type: "text",
                text: `Tools used: ${toolParts.map((p: any) => p.toolName).join(", ")}`,
                marks: [{ type: "italic" }],
              },
            ],
          });
        }
      }
    }

    console.log(`Total transcript nodes created: ${transcriptNodes.length}`);

    // Add media section if there are any assets
    // Convert extracted assets to MediaAsset format and use helper function
    if (extractedAssets.length > 0) {
      const mediaAssets: MediaAsset[] = extractedAssets.map((asset) => ({
        type: asset.type as any,
        url: asset.url,
        title: asset.title,
        thumbnail: asset.thumbnail,
        metadata: asset.metadata,
      }));

      const mediaNodes = convertMediaAssetsToTipTap(mediaAssets);
      transcriptNodes.push(...mediaNodes);
    }

    // Create TipTap document
    const tipTapDocument = {
      type: "doc",
      content: transcriptNodes,
    };

    console.log(`Creating dossier with ${transcriptNodes.length} TipTap nodes`);
    console.log(`First 3 nodes:`, JSON.stringify(transcriptNodes.slice(0, 3), null, 2));
    console.log(`Content size: ${JSON.stringify(tipTapDocument).length} bytes`);

    // Create single dossier document with everything
    const dossierId = await ctx.db.insert("documents", {
      title: args.title || `Chat Session - ${new Date().toLocaleDateString()}`,
      content: JSON.stringify(tipTapDocument), // TipTap JSON format
      createdBy: userId,
      isPublic: false,
      isArchived: false,
      isFavorite: false,
      documentType: "dossier", // Use dossier type for custom viewer
      dossierType: "primary",
      chatThreadId: args.threadId,
    });

    console.log(`Created dossier document with ID: ${dossierId}`);

    return {
      dossierId,
      messageCount: allMessages.length,
      mediaCount: extractedAssets.length,
    };
  },
});
