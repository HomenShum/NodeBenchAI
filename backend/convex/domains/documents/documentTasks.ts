/**
 * Document-based task management.
 * Tasks are now stored as documents with "task" tag and metadata in content.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id, Doc } from "../../_generated/dataModel";
import { api } from "../../_generated/api";
import { parseDocumentMetadata } from "./documentMetadataParser";

/**
 * Create a new task as a document
 */
export const createTask = mutation({
  args: {
    title: v.string(),
    dueDate: v.optional(v.number()),
    status: v.optional(v.string()),
    priority: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Format task metadata for document header
    const dueStr = args.dueDate ? new Date(args.dueDate).toLocaleString() : 'No due date';
    const statusEmoji = args.status === 'done' ? '✅' : args.status === 'in_progress' ? '🔄' : args.status === 'blocked' ? '🚫' : '📋';
    
    const metadataLines = [
      `${statusEmoji} Task: ${args.title}`,
      `📅 Due: ${dueStr}`,
      args.status ? `Status: ${args.status}` : null,
      args.priority ? `Priority: ${args.priority}` : null,
      '',
      '---',
      '',
    ].filter(Boolean);

    // Create document
    const documentId = await ctx.db.insert("documents", {
      title: `✓ ${args.title}`,
      documentType: "text",
      isPublic: false,
      createdBy: userId,
      lastEditedBy: userId,
      content: JSON.stringify({
        type: "doc",
        content: [
          ...metadataLines.map(line => ({
            type: "paragraph",
            content: [{ type: "text", text: line }],
          })),
          {
            type: "paragraph",
            content: args.description
              ? [{ type: "text", text: args.description }]
              : [],
          },
        ],
      }),
    });

    // Add tags
    await ctx.runMutation(api.domains.knowledge.tags.addTagsToDocument, {
      documentId,
      tags: [
        { name: "task", kind: "type" },
        { name: args.title, kind: "topic" },
        args.status ? { name: args.status, kind: "status" } : null,
        args.priority ? { name: args.priority, kind: "priority" } : null,
      ].filter(Boolean) as Array<{ name: string; kind?: string }>,
    });

    return documentId;
  },
});

/**
 * Update a task document
 */
export const updateTask = mutation({
  args: {
    documentId: v.id("documents"),
    title: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    status: v.optional(v.string()),
    priority: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const doc = await ctx.db.get(args.documentId) as Doc<"documents"> | null;
    if (!doc) throw new Error("Document not found");
    if (doc.createdBy !== userId) throw new Error("Unauthorized");

    // Parse existing content to get current metadata
    let existingContent: any = { type: "doc", content: [] };
    try {
      existingContent = JSON.parse(doc.content || "{}");
    } catch {
      // Ignore parse errors
    }

    // Extract description from existing content (skip metadata lines)
    const existingDescription = existingContent.content
      ?.filter((node: any) => node.type === "paragraph")
      .slice(-1)[0]?.content?.[0]?.text || "";

    // Build new metadata header
    const title = args.title || doc.title.replace(/^✓ /, "");
    const dueStr = args.dueDate ? new Date(args.dueDate).toLocaleString() : 'No due date';
    const statusEmoji = args.status === 'done' ? '✅' : args.status === 'in_progress' ? '🔄' : args.status === 'blocked' ? '🚫' : '📋';
    
    const metadataLines = [
      `${statusEmoji} Task: ${title}`,
      `📅 Due: ${dueStr}`,
      args.status ? `Status: ${args.status}` : null,
      args.priority ? `Priority: ${args.priority}` : null,
      '',
      '---',
      '',
    ].filter(Boolean);

    // Update document
    await ctx.db.patch(args.documentId, {
      title: args.title ? `✓ ${args.title}` : doc.title,
      content: JSON.stringify({
        type: "doc",
        content: [
          ...metadataLines.map(line => ({
            type: "paragraph",
            content: [{ type: "text", text: line }],
          })),
          {
            type: "paragraph",
            content: args.description !== undefined
              ? [{ type: "text", text: args.description }]
              : [{ type: "text", text: existingDescription }],
          },
        ],
      }),
      lastEditedBy: userId,
    });

    return null;
  },
});

/**
 * Delete a task document
 */
export const deleteTask = mutation({
  args: { documentId: v.id("documents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const doc = await ctx.db.get(args.documentId) as Doc<"documents"> | null;
    if (!doc) throw new Error("Document not found");
    if (doc.createdBy !== userId) throw new Error("Unauthorized");

    // Soft delete by marking as archived
    await ctx.db.patch(args.documentId, {
      isArchived: true,
    });

    return null;
  },
});

/**
 * List all task documents for the current user
 */
export const listTasks = query({
  args: {
    start: v.optional(v.number()),
    end: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args): Promise<any[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Get all documents tagged with "task"
    const taskDocs: any[] = await ctx.runQuery(api.domains.documents.documents.listDocumentsByTag, {
      tag: "task",
    });

    // If date range is specified, filter by parsed metadata
    if (args.start !== undefined && args.end !== undefined) {
      // Use statically imported parseDocumentMetadata - dynamic imports are not supported in queries
      return taskDocs
        .map((doc: any) => {
          const metadata = parseDocumentMetadata(doc.content, doc.title);
          return { ...doc, metadata };
        })
        .filter((doc: any) => {
          if (!doc.metadata.dueDate) return false;
          return doc.metadata.dueDate >= args.start! && doc.metadata.dueDate <= args.end!;
        })
        .sort((a: any, b: any) => (a.metadata.dueDate || 0) - (b.metadata.dueDate || 0));
    }

    return taskDocs;
  },
});

