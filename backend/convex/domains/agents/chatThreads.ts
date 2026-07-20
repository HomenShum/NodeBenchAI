import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { Id, Doc } from "../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
// Id not needed in this module
import { createBlockJson, detectNodeType, extractPlainText, coerceToBlockJson } from "../../lib/markdown";
import { candidateDocValidator } from "../search/rag";

/**
 * Start a new chat thread as a regular document.
 * The document will be titled with a timestamp unless a custom title is provided.
 */
export const start = mutation({
  args: {
    title: v.optional(v.string()),
    // Optional: initial system/context message to seed the thread document
    initialContext: v.optional(v.string()),
  },
  returns: v.id("documents"),
  handler: async (ctx, { title, initialContext }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const now = new Date();
    const defaultTitle = `Chat — ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

    // Create the document
    const documentId = await ctx.db.insert("documents", {
      title: title ?? defaultTitle,
      parentId: undefined,
      createdBy: userId,
      isPublic: false,
      isArchived: false,
      content: undefined,
      lastModified: Date.now(),
    });

    // Optionally add an initial heading and/or context block
    const rootOrderBase = 0;

    // Heading with the title (normalized)
    const headingMd = `# ${title ?? defaultTitle}`;
    const headingNorm = coerceToBlockJson(createBlockJson("heading", headingMd), extractPlainText(headingMd));
    await ctx.db.insert("nodes", {
      documentId,
      parentId: undefined,
      order: rootOrderBase,
      type: headingNorm.type,
      text: headingNorm.text,
      json: headingNorm.block,
      authorId: userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isUserNode: true,
    });

    if (initialContext && initialContext.trim()) {
      const headingType = detectNodeType(initialContext);
      const normalized = coerceToBlockJson(createBlockJson(headingType, initialContext), extractPlainText(initialContext));
      await ctx.db.insert("nodes", {
        documentId,
        parentId: undefined,
        order: rootOrderBase + 1,
        type: normalized.type,
        text: normalized.text,
        json: normalized.block,
        authorId: userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isUserNode: true,
      });
    }

    return documentId;
  },
});

/**
 * Append a chat message as a node to a thread document.
 * Stores role label and timestamp inline in the markdown for readability.
 */
export const appendMessage = mutation({
  args: {
    threadDocumentId: v.id("documents"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    timestamp: v.optional(v.number()),
    candidateDocs: v.optional(v.array(candidateDocValidator)),
  },
  returns: v.id("nodes"),
  handler: async (ctx, { threadDocumentId, role, content, timestamp, candidateDocs }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const doc = await ctx.db.get(threadDocumentId) as Doc<"documents"> | null;
    if (!doc) throw new Error("Document not found");
    if (doc.createdBy !== userId) throw new Error("Unauthorized");

    const createdAt = timestamp ?? Date.now();
    const timeStr = new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const label = role === "user" ? "User" : "Assistant";

    const markdown = `**${label} (${timeStr})**\n${content}`;

    // Compute order as next root-level index
    const existing = await ctx.db
      .query("nodes")
      .withIndex("by_document", (q) => q.eq("documentId", threadDocumentId))
      .collect();

    const rootNodes = existing.filter((n) => !("parentId" in n) || (n).parentId === undefined || (n).parentId === null);
    const nextOrder = rootNodes.length;

    const nodeType = detectNodeType(markdown);

    // Build base JSON and add attachments if present
    const baseJson = createBlockJson(nodeType, markdown);
    const normalized = coerceToBlockJson(baseJson, extractPlainText(markdown));
    const attachments: Array<{ type: string; value: unknown }> = [];
    if (candidateDocs && candidateDocs.length > 0) {
      attachments.push({ type: "ai.candidateDocs", value: candidateDocs });
    }
    const jsonWithAttachments = attachments.length > 0
      ? {
          ...(normalized.block || {}),
          props: {
            ...(((normalized.block || {}).props) ?? {}),
            attachments: [
              ...((((normalized.block || {}).props || {}).attachments as Array<{ type: string; value: unknown }>) ?? []),
              ...attachments,
            ],
          },
        }
      : normalized.block;

    const nodeId = await ctx.db.insert("nodes", {
      documentId: threadDocumentId,
      parentId: undefined,
      order: nextOrder,
      type: normalized.type,
      text: normalized.text,
      json: jsonWithAttachments,
      authorId: userId,
      createdAt,
      updatedAt: createdAt,
      isUserNode: role === "user",
    });

    // Touch document lastModified
    await ctx.db.patch(threadDocumentId, { lastModified: Date.now() });

    return nodeId;
  },
});


/**
 * List recent chat threads for the current user with summary info.
 */
export const listThreadsForUser = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      threadId: v.id("documents"),
      title: v.string(),
      lastModified: v.number(),
      messageCount: v.number(),
      lastMessage: v.optional(
        v.object({
          role: v.union(v.literal("user"), v.literal("assistant")),
          text: v.string(),
          createdAt: v.number(),
        })
      ),
    })
  ),
  handler: async (ctx, { limit }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Fetch user's documents likely to be chat threads. Heuristic: Title starts with "Chat — ".
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_user", (q) => q.eq("createdBy", userId))
      .collect();

    const threads = docs
      .filter((d) => !d.isArchived && typeof d.title === "string" && /^Chat\s\u2014|^Chat\s--|^Chat\s\u2013|^Chat\s\u2015|^Chat\s-/.test(d.title) || d.title.startsWith("Chat — ") || d.title.startsWith("Chat - "))
      .sort((a, b) => (Number(b.lastModified || 0) - Number(a.lastModified || 0)));

    const limited = typeof limit === "number" ? threads.slice(0, Math.max(1, limit)) : threads.slice(0, 50);

    const out: Array<{
      threadId: Id<"documents">;
      title: string;
      lastModified: number;
      messageCount: number;
      lastMessage?: { role: "user" | "assistant"; text: string; createdAt: number };
    }> = [];

    for (const d of limited) {
      const nodes = await ctx.db
        .query("nodes")
        .withIndex("by_document", (q) => q.eq("documentId", d._id))
        .collect();
      const rootNodes = nodes.filter((n) => !("parentId" in n) || (n).parentId === undefined || (n).parentId === null);
      const messageCount = rootNodes.length;
      const last = rootNodes.sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0];
      const lastMessage = last
        ? {
            role: (last).isUserNode ? ("user" as const) : ("assistant" as const),
            text: String(last.text || "").slice(0, 200),
            createdAt: Number(last.createdAt || 0),
          }
        : undefined;
      out.push({
        threadId: d._id,
        title: d.title,
        lastModified: Number(d.lastModified || 0),
        messageCount,
        lastMessage,
      });
    }

    return out;
  },
});
