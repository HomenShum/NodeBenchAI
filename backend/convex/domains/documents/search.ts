/**
 * convex/domains/documents/search.ts
 * High-performance instant search for Welcome Landing
 * 
 * Provides fast search-as-you-type for dossiers and documents,
 * enabling "Instant-Value" UX where users see cached knowledge immediately.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * instantSearch - Fast search for dossiers with fallback to recent items
 * 
 * Used by InstantSearchBar to provide immediate results as user types.
 * Returns dossiers matching the query, or recent dossiers if query is short.
 */
export const instantSearch = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 5;
    const queryText = args.query.trim();

    // If query is too short, return recent dossiers
    if (queryText.length < 2) {
      const recentDocs = await ctx.db
        .query("documents")
        .withIndex("by_user", (q) => q.eq("createdBy", userId))
        .filter((q) =>
          q.and(
            q.eq(q.field("documentType"), "dossier"),
            q.neq(q.field("isArchived"), true)
          )
        )
        .order("desc")
        .take(limit);

      return recentDocs.map((doc) => ({
        _id: doc._id,
        title: doc.title || "Untitled Dossier",
        documentType: doc.documentType,
        snippet: doc.summary
          ? doc.summary.substring(0, 120) + (doc.summary.length > 120 ? "..." : "")
          : "Cached research dossier",
        matchType: "recent" as const,
        _creationTime: doc._creationTime,
        updatedAt: (doc).lastModified || doc._creationTime,
      }));
    }

    // Search by title using the existing search index
    const searchResults = await ctx.db
      .query("documents")
      .withSearchIndex("search_title", (q) =>
        q
          .search("title", queryText)
          .eq("createdBy", userId)
          .eq("isArchived", false)
      )
      .take(limit * 2); // Take more to filter for dossiers

    // Prioritize dossiers, then other document types
    const dossiers = searchResults.filter((d) => d.documentType === "dossier");
    const others = searchResults.filter((d) => d.documentType !== "dossier");
    const combined = [...dossiers, ...others].slice(0, limit);

    return combined.map((doc) => ({
      _id: doc._id,
      title: doc.title || "Untitled Document",
      documentType: doc.documentType,
      snippet: doc.summary
        ? doc.summary.substring(0, 120) + (doc.summary.length > 120 ? "..." : "")
        : doc.documentType === "dossier"
          ? "Cached research dossier"
          : "Document",
      matchType: "search" as const,
      _creationTime: doc._creationTime,
      updatedAt: (doc).lastModified || doc._creationTime,
    }));
  },
});

/**
 * getRecentDossiers - Get user's most recent dossiers
 * 
 * Used for "Recent Research" section on landing page.
 */
export const getRecentDossiers = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 10;

    const dossiers = await ctx.db
      .query("documents")
      .withIndex("by_user", (q) => q.eq("createdBy", userId))
      .filter((q) =>
        q.and(
          q.eq(q.field("documentType"), "dossier"),
          q.neq(q.field("isArchived"), true)
        )
      )
      .order("desc")
      .take(limit);

    return dossiers.map((doc) => ({
      _id: doc._id,
      title: doc.title || "Untitled Dossier",
      summary: doc.summary,
      _creationTime: doc._creationTime,
      updatedAt: (doc).lastModified || doc._creationTime,
    }));
  },
});

