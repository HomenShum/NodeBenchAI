import { v } from "convex/values";
import { mutation } from "../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { api } from "../../../_generated/api";

/**
 * Get or create a document for an event.
 * If the event already has a documentId, return it.
 * Otherwise, create a new document and associate it with the event.
 */
export const getOrCreateEventDocument = mutation({
  args: {
    eventId: v.id("events"),
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Get the event
    const event = await ctx.db.get(args.eventId) as Doc<"events"> | null;
    if (!event) throw new Error("Event not found");
    if (event.userId !== userId) throw new Error("Not authorized");

    // If event already has a document, return it
    if (event.documentId) {
      return event.documentId;
    }

    // Create a simple document for event notes
    // The event metadata (time, location, status) stays in the event record
    const documentId = await ctx.db.insert("documents", {
      title: `📅 ${event.title}`,
      documentType: "text",
      isPublic: false,
      createdBy: userId,
      lastEditedBy: userId,
      content: JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: event.description
              ? [{ type: "text", text: event.description }]
              : [],
          },
        ],
      }),
    });

    // Associate the document with the event
    await ctx.db.patch(args.eventId, {
      documentId,
    });

    // Add tags to mark this as an event document
    await ctx.runMutation(api.domains.knowledge.tags.addTagsToDocument, {
      documentId,
      tags: [
        { name: "event", kind: "type" },
        { name: event.title, kind: "topic" },
      ],
    });

    return documentId;
  },
});

/**
 * Get or create a document for a user event.
 * If the user event already has a documentId, return it.
 * Otherwise, create a new document and associate it with the user event.
 */
export const getOrCreateUserEventDocument = mutation({
  args: {
    userEventId: v.id("userEvents"),
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Get the user event
    const userEvent = await ctx.db.get(args.userEventId) as Doc<"userEvents"> | null;
    if (!userEvent) throw new Error("User event not found");
    if (userEvent.userId !== userId) throw new Error("Not authorized");

    // If user event already has a document, return it
    if (userEvent.documentId) {
      return userEvent.documentId;
    }

    // Format user event metadata for document header
    const dueStr = userEvent.dueDate ? new Date(userEvent.dueDate).toLocaleString() : 'No due date';
    const statusEmoji = userEvent.status === 'done' ? '✅' : userEvent.status === 'in_progress' ? '🔄' : userEvent.status === 'blocked' ? '🚫' : '📋';

    const metadataLines = [
      `${statusEmoji} Task: ${userEvent.title}`,
      `📅 Due: ${dueStr}`,
      userEvent.status ? `Status: ${userEvent.status}` : null,
      userEvent.priority ? `Priority: ${userEvent.priority}` : null,
      '',
      '---',
      '',
    ].filter(Boolean);

    // Create a new document for the user event with metadata header
    const documentId = await ctx.db.insert("documents", {
      title: `✓ ${userEvent.title}`,
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
            content: userEvent.description
              ? [{ type: "text", text: userEvent.description }]
              : [],
          },
        ],
      }),
    });

    // Associate the document with the user event
    await ctx.db.patch(args.userEventId, {
      documentId,
    });

    // Add tags to mark this as a task document
    await ctx.runMutation(api.domains.knowledge.tags.addTagsToDocument, {
      documentId,
      tags: [
        { name: "task", kind: "type" },
        { name: userEvent.title, kind: "topic" },
        userEvent.status ? { name: userEvent.status, kind: "status" } : null,
        userEvent.priority ? { name: userEvent.priority, kind: "priority" } : null,
      ].filter(Boolean) as Array<{ name: string; kind?: string }>,
    });

    return documentId;
  },
});

// Backward compatibility alias
export const getOrCreateTaskDocument = getOrCreateUserEventDocument;

