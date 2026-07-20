import { components } from "../../_generated/api";
import { ProsemirrorSync } from "@convex-dev/prosemirror-sync";
import { getAuthUserId } from "@convex-dev/auth/server";
import { DataModel, Id, Doc } from "../../_generated/dataModel";
import { mutation, internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { api } from "../../_generated/api";

/**
 * Sanitize ProseMirror content to remove unsupported node types
 * Converts mentions and hashtags to styled text nodes
 * Converts TipTap taskItem/taskList to BlockNote checkListItem
 */
const sanitizeProseMirrorSnapshot = (snapshot: string): string => {
  try {
    const content = JSON.parse(snapshot);

    type PMLikeNode = {
      type?: unknown;
      content?: unknown;
      attrs?: Record<string, unknown>;
      marks?: unknown[];
      text?: string;
      [key: string]: unknown;
    };

    const sanitize = (node: unknown): unknown => {
      if (node === null || node === undefined) {
        return node;
      }

      if (Array.isArray(node)) {
        return node
          .map((child: unknown) => sanitize(child))
          .flat()
          .filter((child: unknown) => child !== null);
      }

      if (typeof node === "object") {
        const pmNode = node as PMLikeNode;
        const nodeType = typeof pmNode.type === "string" ? pmNode.type : undefined;

        // Convert mention inline content to styled text
        if (nodeType === "mention") {
          const label = pmNode.attrs?.label || pmNode.attrs?.id || "";
          return {
            type: "text",
            text: `@${label}`,
            marks: [
              { type: "textColor", attrs: { stringValue: "#8400ff" } },
              { type: "backgroundColor", attrs: { stringValue: "#8400ff33" } },
            ],
          };
        }

        // Convert hashtag inline content to styled text
        if (nodeType === "hashtag") {
          const name = pmNode.attrs?.name || pmNode.attrs?.hashtag || pmNode.attrs?.label || "";
          return {
            type: "text",
            text: `#${name}`,
            marks: [
              { type: "textColor", attrs: { stringValue: "#0ea5e9" } },
              { type: "backgroundColor", attrs: { stringValue: "#0ea5e933" } },
            ],
          };
        }

        // Convert TipTap taskList - return sanitized children (taskItems become checkListItems)
        if (nodeType === "taskList") {
          if (Array.isArray(pmNode.content)) {
            return pmNode.content
              .map((child: unknown) => sanitize(child))
              .flat()
              .filter((child: unknown) => child !== null);
          }
          return null;
        }

        // Convert TipTap taskItem to BlockNote checkListItem
        if (nodeType === "taskItem") {
          const checked = pmNode.attrs?.checked ?? false;
          const sanitizedContent = Array.isArray(pmNode.content)
            ? pmNode.content
              .map((child: unknown) => sanitize(child))
              .flat()
              .filter((child: unknown) => child !== null)
            : [];

          return {
            type: "blockContainer",
            content: [
              {
                type: "checkListItem",
                attrs: { checked },
                content: sanitizedContent.length > 0 ? sanitizedContent : undefined,
              }
            ]
          };
        }

        // Convert TipTap listItem to BlockNote bulletListItem
        // TipTap uses listItem inside bulletList/orderedList, BlockNote uses bulletListItem/numberedListItem
        if (nodeType === "listItem") {
          let sanitizedContent = Array.isArray(pmNode.content)
            ? pmNode.content
              .map((child: unknown) => sanitize(child))
              .flat()
              .filter((child: unknown) => child !== null)
            : [];

          // listItem often contains a paragraph, extract its content for inline display
          if (sanitizedContent.length === 1 &&
            typeof sanitizedContent[0] === "object" &&
            sanitizedContent[0] !== null &&
            (sanitizedContent[0] as any).type === "paragraph" &&
            Array.isArray((sanitizedContent[0] as any).content)) {
            sanitizedContent = (sanitizedContent[0] as any).content;
          }

          return {
            type: "bulletListItem",
            attrs: {},
            content: sanitizedContent.length > 0 ? sanitizedContent : undefined,
          };
        }

        // Convert TipTap bulletList to flattened bulletListItems wrapped in blockContainers
        if (nodeType === "bulletList") {
          if (Array.isArray(pmNode.content)) {
            return pmNode.content
              .map((child: unknown) => {
                const sanitized = sanitize(child);
                if (sanitized && typeof sanitized === "object" && (sanitized as any).type === "bulletListItem") {
                  return {
                    type: "blockContainer",
                    content: [sanitized]
                  };
                }
                return sanitized;
              })
              .flat()
              .filter((child: unknown) => child !== null);
          }
          return null;
        }

        // Convert TipTap orderedList to flattened numberedListItems wrapped in blockContainers
        if (nodeType === "orderedList") {
          if (Array.isArray(pmNode.content)) {
            return pmNode.content
              .map((child: unknown) => {
                const sanitized = sanitize(child);
                // Convert bulletListItem to numberedListItem for ordered lists
                if (sanitized && typeof sanitized === "object" && (sanitized as any).type === "bulletListItem") {
                  return {
                    type: "blockContainer",
                    content: [{ ...(sanitized as any), type: "numberedListItem" }]
                  };
                }
                return sanitized;
              })
              .flat()
              .filter((child: unknown) => child !== null);
          }
          return null;
        }

        // Convert standard TipTap paragraph/heading to BlockNote blocks if they are top-level
        const standardBlocks = ["paragraph", "heading", "blockquote", "codeBlock", "bulletList", "orderedList"];
        if (nodeType && standardBlocks.includes(nodeType)) {
          // If this is inside a doc/blockGroup, it MUST be wrapped in blockContainer
          // However, we handle that in the parent's content mapping below.
          // For now, just ensure the attributes are safe.
          const attrs = { ...pmNode.attrs };
          if (nodeType === "paragraph" || nodeType === "heading") {
            attrs.textAlignment = attrs.textAlignment || "left";
          }

          if (Array.isArray(pmNode.content)) {
            return {
              ...pmNode,
              attrs,
              content: pmNode.content.map(c => sanitize(c)).flat().filter(c => c !== null)
            };
          }
          return { ...pmNode, attrs };
        }

        if (Array.isArray(pmNode.content)) {
          let sanitizedContent = pmNode.content
            .map((child: unknown) => sanitize(child))
            .flat()
            .filter((child: unknown) => child !== null);

          // For doc/blockGroup/blockContainer nodes, ensure children are valid blocks
          const structureTypes = ["doc", "blockGroup", "blockContainer"];
          if (nodeType && structureTypes.includes(nodeType)) {
            sanitizedContent = sanitizedContent.map((child: any) => {
              if (!child || typeof child !== "object") return child;

              // If it's a bare text node, wrap in blockContainer -> paragraph
              if (child.type === "text") {
                return {
                  type: "blockContainer",
                  content: [
                    { type: "paragraph", attrs: { textAlignment: "left" }, content: [child] }
                  ]
                };
              }

              // If it's a paragraph/heading BUT not inside blockContainer, wrap it
              const needsWrapper = ["paragraph", "heading", "blockquote", "codeBlock", "bulletListItem", "numberedListItem", "checkListItem"].includes(child.type);
              if (needsWrapper) {
                return {
                  type: "blockContainer",
                  content: [child]
                };
              }

              return child;
            });
          }

          return {
            ...pmNode,
            content: sanitizedContent.length > 0 ? sanitizedContent : undefined,
          };
        }
      }

      return node;
    };

    const sanitized = sanitize(content);
    return JSON.stringify(sanitized);
  } catch (err) {
    console.error("[prosemirror] Error sanitizing snapshot:", err);
    return snapshot; // Return original if sanitization fails
  }
};

const prosemirrorSync = new ProsemirrorSync(components.prosemirrorSync);

export const {
  getSnapshot,
  submitSnapshot,
  latestVersion,
  getSteps,
  submitSteps,
} = prosemirrorSync.syncApi<DataModel>({
  async checkRead(ctx, id) {
    const document = await ctx.db.get(id) as Doc<"documents"> | null;
    if (!document) {
      throw new Error("Document not found");
    }

    // Public documents are readable by anyone (including unauthenticated users)
    if (document.isPublic) return;

    // Otherwise require authentication and ownership
    const userId = await getAuthUserId(ctx);
    if (!userId || document.createdBy !== userId) {
      throw new Error("Unauthorized");
    }
  },
  async checkWrite(ctx, id) {
    const document = await ctx.db.get(id) as Doc<"documents"> | null;
    if (!document) {
      throw new Error("Document not found");
    }

    // If author enabled public editing, allow writes for anyone
    if (document.isPublic && document.allowPublicEdit === true) return;

    // Otherwise only allow writes to the document creator
    const userId = await getAuthUserId(ctx);
    if (!userId || document.createdBy !== userId) throw new Error("Unauthorized");
  },
  async onSnapshot(ctx, id, snapshot, version) {
    // Sanitize the snapshot to remove unsupported node types before storing
    const sanitized = sanitizeProseMirrorSnapshot(snapshot);

    // Avoid overwriting dossier content with ProseMirror snapshots (dossiers have special handling)
    const document = await ctx.db.get(id) as Doc<"documents"> | null;
    if (!document) {
      return;
    }

    if (document.documentType === "dossier" || document.dossierType === "primary") {
      return;
    }

    // Update the document content when a new snapshot is available
    await ctx.db.patch(id as any, {
      content: sanitized,
    });
  },
});

// Create a new document and seed an initial ProseMirror snapshot.
// Accepts either a full ProseMirror doc JSON (with type: "doc") or a simple array of blocks
// that the existing documents.create mutation will convert to ProseMirror JSON.
export const createDocumentWithInitialSnapshot = mutation({
  args: {
    title: v.string(),
    parentId: v.optional(v.id("documents")),
    // initialContent can be either a ProseMirror JSON object or a simple array of blocks
    initialContent: v.optional(v.any()),
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    let docId: Id<"documents">;
    let contentString: string;
    let contentObject: object;
    const content = args.initialContent;

    // Branch 1: Provided a full ProseMirror JSON document
    if (content && typeof content === "object" && !Array.isArray(content) && 'type' in (content as object) && (content).type === "doc") {
      contentObject = content as object;
      contentString = JSON.stringify(contentObject);
      docId = await ctx.db.insert("documents", {
        title: args.title,
        parentId: args.parentId,
        createdBy: userId,
        isPublic: false,
        isArchived: false,
        content: contentString,
      });
    } else {
      // Branch 2: Provided simple array blocks (or nothing). Insert the document row,
      // then build a ProseMirror JSON doc directly from the simple blocks for the snapshot.
      const createdId = await ctx.runMutation(api.domains.documents.documents.create, {
        title: args.title,
        parentId: args.parentId,
        content: Array.isArray(content) ? content : [],
      });
      docId = createdId as Id<"documents">;

      const blocksInput: any[] = Array.isArray(content) ? content : [];

      // Minimal, robust converter from our simple block array to PM JSON compatible with BlockNote sync
      type PMNode = { type: string; attrs?: Record<string, any>; content?: PMNode[] } & Record<string, any>;
      const pmText = (text: string): PMNode => ({ type: "text", text });
      const pmParagraph = (text: string): PMNode => ({
        type: "paragraph",
        attrs: { textAlignment: "left" },
        content: text ? [pmText(text)] : [],
      });
      const getChildren = (b: any): any[] => Array.isArray(b?.children) ? b.children : [];

      const topLevel: PMNode[] = [];
      for (const b of blocksInput) {
        if (!b || typeof b !== "object") continue;

        let blockNode: PMNode | null = null;
        const text = String(b.text ?? "");

        switch (b.type) {
          case "heading":
            blockNode = {
              type: "heading",
              attrs: { textAlignment: "left", level: b.level || 1 },
              content: text ? [pmText(text)] : [],
            };
            break;
          case "bulletListItem":
            blockNode = {
              type: "bulletListItem",
              attrs: { textAlignment: "left" },
              content: text ? [pmText(text)] : [],
            };
            break;
          case "checkListItem":
            blockNode = {
              type: "checkListItem",
              attrs: { textAlignment: "left", checked: !!b.checked },
              content: text ? [pmText(text)] : [],
            };
            break;
          case "quote":
            blockNode = {
              type: "blockquote",
              attrs: { textAlignment: "left" },
              content: text ? [pmText(text)] : [],
            };
            break;
          case "codeBlock":
            blockNode = {
              type: "codeBlock",
              attrs: { language: b.lang || "text" },
              content: text ? [pmText(text)] : [],
            };
            break;
          case "horizontalRule":
            blockNode = { type: "horizontalRule", attrs: {} };
            break;
          case "paragraph":
          default:
            blockNode = pmParagraph(text);
        }

        if (blockNode) {
          topLevel.push({
            type: "blockContainer",
            content: [blockNode],
          });
        }
      }
      contentObject = { type: "doc", content: topLevel } as object;
    }

    // Seed the initial snapshot with the same content so the editor starts from it.
    // The sync API expects a ProseMirror JSON object.
    const sanitizePmDoc = (doc: any) => {
      try {
        if (!doc || typeof doc !== "object" || doc.type !== "doc") {
          return { type: "doc", content: [] };
        }
        const arr = Array.isArray((doc).content) ? (doc).content : [];
        const toParagraph = (text: string) => ({
          type: "paragraph",
          attrs: { textAlignment: "left" },
          content: text ? [{ type: "text", text }] : [],
        });
        const normalized: any[] = [];
        for (const n of arr) {
          if (n && typeof n === "object" && typeof (n).type === "string" && (n).type !== "text") {
            normalized.push(n);
          } else if (typeof n === "string" || (n && typeof n === "object" && (n).type === "text")) {
            const t = typeof n === "string" ? n : String((n).text ?? "");
            normalized.push(toParagraph(t));
          } else {
            normalized.push(toParagraph(""));
          }
        }
        return { type: "doc", content: normalized };
      } catch {
        return { type: "doc", content: [] };
      }
    };
    const safeDoc = sanitizePmDoc(contentObject);
    await prosemirrorSync.create(ctx, docId, safeDoc);

    return docId;
  },
});

/**
 * Migration mutation to sanitize all existing document content
 * Converts mentions and hashtags to styled text nodes
 */
export const migrateDocumentContent = mutation({
  args: {},
  returns: v.object({
    processed: v.number(),
    updated: v.number(),
    errors: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const documents = await ctx.db.query("documents").collect();
    let processed = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const doc of documents) {
      processed++;
      if (!doc.content) continue;

      try {
        const sanitized = sanitizeProseMirrorSnapshot(doc.content);
        if (sanitized !== doc.content) {
          await ctx.db.patch(doc._id, { content: sanitized });
          updated++;
          console.log(`[migration] Sanitized document ${doc._id}: ${doc.title}`);
        }
      } catch (err) {
        const errMsg = `Error processing ${doc._id}: ${err}`;
        errors.push(errMsg);
        console.error(`[migration] ${errMsg}`);
      }
    }

    console.log(`[migration] Complete: ${processed} processed, ${updated} updated, ${errors.length} errors`);
    return { processed, updated, errors };
  },
});

/**
 * Reset prosemirror-sync snapshots for a specific document
 * This deletes the cached snapshot so it will be recreated from the sanitized document content
 */
export const resetDocumentSnapshot = mutation({
  args: {
    documentId: v.id("documents"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const doc = await ctx.db.get(args.documentId) as Doc<"documents"> | null;
    if (!doc) {
      throw new Error("Document not found");
    }

    // First sanitize the document content
    if (doc.content) {
      const sanitized = sanitizeProseMirrorSnapshot(doc.content);
      if (sanitized !== doc.content) {
        await ctx.db.patch(args.documentId, { content: sanitized });
        console.log(`[resetSnapshot] Sanitized document ${args.documentId}`);
      }
    }

    // Delete the prosemirror-sync snapshot using the component API
    // This will cause the editor to create a new snapshot from the document content
    try {
      await ctx.runMutation(components.prosemirrorSync.lib.deleteDocument, {
        id: args.documentId,
      });
      console.log(`[resetSnapshot] Deleted snapshot for ${args.documentId}`);
      return true;
    } catch (err) {
      console.error(`[resetSnapshot] Error deleting snapshot: ${err}`);
      return false;
    }
  },
});

/**
 * Reset ALL prosemirror-sync snapshots
 * This is a nuclear option - use with caution
 */
export const resetAllSnapshots = mutation({
  args: {},
  returns: v.object({
    processed: v.number(),
    reset: v.number(),
    errors: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const documents = await ctx.db.query("documents").collect();
    let processed = 0;
    let reset = 0;
    const errors: string[] = [];

    for (const doc of documents) {
      processed++;

      try {
        // First sanitize the document content
        if (doc.content) {
          const sanitized = sanitizeProseMirrorSnapshot(doc.content);
          if (sanitized !== doc.content) {
            await ctx.db.patch(doc._id, { content: sanitized });
          }
        }

        // Delete the prosemirror-sync snapshot
        await ctx.runMutation(components.prosemirrorSync.lib.deleteDocument, {
          id: doc._id,
        });
        reset++;
      } catch (err) {
        // Ignore errors for documents that don't have snapshots
        const errStr = String(err);
        if (!errStr.includes("not found")) {
          errors.push(`${doc._id}: ${errStr}`);
        }
      }
    }

    console.log(`[resetAllSnapshots] Complete: ${processed} processed, ${reset} reset, ${errors.length} errors`);
    return { processed, reset, errors };
  },
});

/**
 * Internal migration - no auth required
 * Use this from the Convex dashboard or CLI
 */
export const internalResetAllSnapshots = internalMutation({
  args: {},
  returns: v.object({
    processed: v.number(),
    reset: v.number(),
    errors: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const documents = await ctx.db.query("documents").collect();
    let processed = 0;
    let reset = 0;
    const errors: string[] = [];

    for (const doc of documents) {
      processed++;

      try {
        // First sanitize the document content
        if (doc.content) {
          const sanitized = sanitizeProseMirrorSnapshot(doc.content);
          if (sanitized !== doc.content) {
            await ctx.db.patch(doc._id, { content: sanitized });
            console.log(`[migration] Sanitized document ${doc._id}: ${doc.title}`);
          }
        }

        // Delete the prosemirror-sync snapshot
        await ctx.runMutation(components.prosemirrorSync.lib.deleteDocument, {
          id: doc._id,
        });
        reset++;
      } catch (err) {
        // Ignore errors for documents that don't have snapshots
        const errStr = String(err);
        if (!errStr.includes("not found")) {
          errors.push(`${doc._id}: ${errStr}`);
        }
      }
    }

    console.log(`[internalResetAllSnapshots] Complete: ${processed} processed, ${reset} reset, ${errors.length} errors`);
    return { processed, reset, errors };
  },
});
