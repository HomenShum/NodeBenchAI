import { mutation, query } from "../../../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Get or create a Daily Notes document for a specific date.
 * Uses ProseMirror format and agendaDate for calendar integration.
 * Idempotent: creates once per day, then reuses.
 */
export const getOrCreateDailyNotes = mutation({
  args: {
    agendaDate: v.number(), // UTC timestamp for the day (local midnight)
    dateLabel: v.string(),  // Human-readable label like "October 5, 2025"
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check if daily notes document already exists for this date
    const existing = await ctx.db
      .query("documents")
      .withIndex("by_user_agendaDate", (q) =>
        q.eq("createdBy", userId).eq("agendaDate", args.agendaDate)
      )
      .filter((q) => q.neq(q.field("isArchived"), true))
      .first() as Doc<"documents"> | null;

    if (existing) {
      return existing._id;
    }

    // Create new Daily Notes document with ProseMirror format
    const title = `📝 Daily Notes — ${args.dateLabel}`;
    
    // Initial ProseMirror document structure
    const initialContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: title }]
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Quick notes for the day. Add thoughts, reminders, or anything you want to capture.",
              marks: [{ type: "italic" }]
            }
          ]
        },
        {
          type: "horizontalRule"
        }
      ]
    };

    const documentId = await ctx.db.insert("documents", {
      title,
      createdBy: userId,
      isPublic: false,
      isArchived: false,
      isFavorite: false,
      documentType: "text", // Use standard "text" type
      agendaDate: args.agendaDate,
      content: JSON.stringify(initialContent),
      lastModified: Date.now(),
    });

    return documentId;
  },
});

/**
 * Query to get daily notes document for a specific date
 */
export const getDailyNotes = query({
  args: {
    agendaDate: v.number(),
  },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const doc = await ctx.db
      .query("documents")
      .withIndex("by_user_agendaDate", (q) =>
        q.eq("createdBy", userId).eq("agendaDate", args.agendaDate)
      )
      .filter((q) => q.neq(q.field("isArchived"), true))
      .first() as Doc<"documents"> | null;

    return doc;
  },
});



