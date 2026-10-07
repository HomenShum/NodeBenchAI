/**
 * Document-based event management.
 * Events are now stored as documents with "event" tag and metadata in content.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id, Doc } from "../../_generated/dataModel";
import { api } from "../../_generated/api";
import { parseDocumentMetadata } from "./documentMetadataParser";

/**
 * Create a new event as a document
 */
export const createEvent = mutation({
  args: {
    title: v.string(),
    startTime: v.number(),
    endTime: v.optional(v.number()),
    allDay: v.optional(v.boolean()),
    location: v.optional(v.string()),
    status: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Format event metadata for document header
    const startDate = new Date(args.startTime);
    const endDate = args.endTime ? new Date(args.endTime) : null;
    const dateStr = args.allDay
      ? startDate.toLocaleDateString()
      : `${startDate.toLocaleString()}${endDate ? ` - ${endDate.toLocaleTimeString()}` : ''}`;
    
    const metadataLines = [
      `📅 Event: ${args.title}`,
      `⏰ Time: ${dateStr}`,
      args.location ? `📍 Location: ${args.location}` : null,
      args.status ? `Status: ${args.status}` : null,
      '',
      '---',
      '',
    ].filter(Boolean);

    // Create document
    const documentId = await ctx.db.insert("documents", {
      title: `📅 ${args.title}`,
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
        { name: "event", kind: "type" },
        { name: args.title, kind: "topic" },
        args.status ? { name: args.status, kind: "status" } : null,
      ].filter(Boolean) as Array<{ name: string; kind?: string }>,
    });

    return documentId;
  },
});

/**
 * Update an event document
 */
export const updateEvent = mutation({
  args: {
    documentId: v.id("documents"),
    title: v.optional(v.string()),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    allDay: v.optional(v.boolean()),
    location: v.optional(v.string()),
    status: v.optional(v.string()),
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
    const title = args.title || doc.title.replace(/^📅 /, "");
    const startTime = args.startTime || Date.now();
    const startDate = new Date(startTime);
    const endDate = args.endTime ? new Date(args.endTime) : null;
    const dateStr = args.allDay
      ? startDate.toLocaleDateString()
      : `${startDate.toLocaleString()}${endDate ? ` - ${endDate.toLocaleTimeString()}` : ''}`;
    
    const metadataLines = [
      `📅 Event: ${title}`,
      `⏰ Time: ${dateStr}`,
      args.location ? `📍 Location: ${args.location}` : null,
      args.status ? `Status: ${args.status}` : null,
      '',
      '---',
      '',
    ].filter(Boolean);

    // Update document
    await ctx.db.patch(args.documentId, {
      title: args.title ? `📅 ${args.title}` : doc.title,
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
 * Delete an event document
 */
export const deleteEvent = mutation({
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
 * List all event documents for the current user
 */
export const listEvents = query({
  args: {
    start: v.optional(v.number()),
    end: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args): Promise<any[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Get all documents tagged with "event"
    const eventDocs: any[] = await ctx.runQuery(api.domains.documents.documents.listDocumentsByTag, {
      tag: "event",
    });

    // If date range is specified, filter by parsed metadata
    if (args.start !== undefined && args.end !== undefined) {
      // Use statically imported parseDocumentMetadata - dynamic imports are not supported in queries
      return eventDocs
        .map((doc: any) => {
          const metadata = parseDocumentMetadata(doc.content, doc.title);
          return { ...doc, metadata };
        })
        .filter((doc: any) => {
          if (!doc.metadata.startTime) return false;
          const eventEnd = doc.metadata.endTime || doc.metadata.startTime;
          return doc.metadata.startTime <= args.end! && eventEnd >= args.start!;
        })
        .sort((a: any, b: any) => (a.metadata.startTime || 0) - (b.metadata.startTime || 0));
    }

    return eventDocs;
  },
});

