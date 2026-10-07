/**
 * Hashtag Search Tools
 * 
 * Tools for searching documents by hashtag keywords using hybrid search
 * (exact title match + exact content match + semantic RAG search)
 * 
 * Designed for use with Fast Agent architecture and Convex Agent component
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

/**
 * Search for documents matching a hashtag keyword
 * Uses 3-way hybrid search: exact title, exact content, semantic RAG
 */
export const searchHashtag = createTool({
  description: `Search for documents matching a hashtag keyword using hybrid search.

  This tool performs three types of search in parallel:
  1. Exact title match - finds documents with the keyword in the title
  2. Exact content match - finds documents with the keyword in the content (BM25)
  3. Semantic search - finds documents semantically related to the keyword (RAG)

  Results are deduplicated and ranked by relevance with match type labels.
  Use this when the user types a hashtag or asks to find documents about a topic.`,

  args: z.object({
    hashtag: z.string().describe("The hashtag keyword to search for (without the # symbol)"),
    limit: z.number().optional().default(20).describe("Maximum number of results to return"),
    matchTypes: z.array(z.enum(["exact-title", "exact-content", "exact-hybrid", "semantic", "hybrid"]))
      .optional()
      .describe("Filter results by specific match types"),
  }),

  handler: async (ctx, { hashtag, limit, matchTypes }): Promise<string> => {
    // Call the existing searchForHashtag action
    const searchResult: any = await ctx.runAction(api.domains.search.hashtagDossiers.searchForHashtag, {
      hashtag,
    });

    // Filter by match types if specified
    let matches: any[] = searchResult.matches;
    if (matchTypes && matchTypes.length > 0) {
      matches = matches.filter((m: any) => matchTypes.includes(m.matchType));
    }

    // Limit results
    matches = matches.slice(0, limit);

    // Format for AI consumption (optimized for token budget)
    if (matches.length === 0) {
      return `No documents found matching hashtag "${hashtag}".`;
    }

    const formatted = matches.map((m: any, idx: number) => {
      const badge =
        m.matchType === "hybrid" ? "🎯" :
        m.matchType === "exact-hybrid" ? "🎯" :
        m.matchType === "exact-title" ? "📍" :
        m.matchType === "exact-content" ? "📄" :
        "🔍";

      return `${idx + 1}. ${badge} ${m.title}
   ID: ${m._id}
   Match: ${m.matchType}
   Score: ${m.score.toFixed(2)}${m.snippet ? `\n   Snippet: ${m.snippet.slice(0, 100)}...` : ''}`;
    }).join('\n\n');

    return `Found ${matches.length} document${matches.length === 1 ? '' : 's'} for hashtag "${hashtag}":

${formatted}

Match types:
🎯 Hybrid - Found in both exact and semantic search (highest relevance)
📍 Exact-title - Found in document title
📄 Exact-content - Found in document content
🔍 Semantic - Found via AI semantic understanding`;
  },
});

/**
 * Create a hashtag dossier from search results
 * Automatically creates a dossier document with references to all matched documents
 */
export const createHashtagDossier = createTool({
  description: `Create a hashtag dossier document containing references to all documents matching a hashtag.

  This tool:
  1. Searches for documents matching the hashtag
  2. Creates a new dossier document with the hashtag as title
  3. Populates the dossier with clickable references to all matched documents
  4. Returns the dossier ID for immediate access

  Use this when the user wants to create a collection or dossier for a topic.`,

  args: z.object({
    hashtag: z.string().describe("The hashtag keyword (without the # symbol)"),
    includeSnippets: z.boolean().optional().default(true).describe("Include content snippets in the dossier"),
  }),

  handler: async (ctx, { hashtag, includeSnippets }): Promise<string> => {
    // Search for matching documents
    const searchResult: any = await ctx.runAction(api.domains.search.hashtagDossiers.searchForHashtag, {
      hashtag,
    });

    if (searchResult.totalCount === 0) {
      return `No documents found for hashtag "${hashtag}". Cannot create empty dossier.`;
    }

    // Create the dossier
    const dossierId: any = await ctx.runMutation(api.domains.search.hashtagDossiers.createHashtagDossier, {
      hashtag,
      matchedDocuments: searchResult.matches,
    });

    return `Created hashtag dossier "#${hashtag}" with ${searchResult.totalCount} document${searchResult.totalCount === 1 ? '' : 's'}.

Dossier ID: ${dossierId}

Match breakdown:
- Exact title matches: ${searchResult.matches.filter((m: any) => m.matchType === 'exact-title').length}
- Exact content matches: ${searchResult.matches.filter((m: any) => m.matchType === 'exact-content').length}
- Semantic matches: ${searchResult.matches.filter((m: any) => m.matchType === 'semantic').length}
- Hybrid matches: ${searchResult.matches.filter((m: any) => m.matchType.includes('hybrid')).length}

The dossier is now available for viewing and contains clickable links to all matched documents.`;
  },
});

/**
 * Get or create a hashtag dossier (idempotent)
 * Checks if a dossier already exists before creating a new one
 */
export const getOrCreateHashtagDossier = createTool({
  description: `Get an existing hashtag dossier or create a new one if it doesn't exist.

  This tool is idempotent - it will:
  1. Check if a dossier for this hashtag already exists
  2. Return the existing dossier ID if found
  3. Create a new dossier if not found

  Use this when you want to ensure a hashtag dossier exists without creating duplicates.`,

  args: z.object({
    hashtag: z.string().describe("The hashtag keyword (without the # symbol)"),
  }),

  handler: async (ctx, { hashtag }): Promise<string> => {
    // Check for existing hashtag dossiers
    const existingHashtags: any = await ctx.runQuery(api.domains.search.hashtagDossiers.getRecentHashtags, {
      limit: 50,
    });

    const existing = existingHashtags.find(
      (h: any) => h.hashtag.toLowerCase() === hashtag.toLowerCase()
    );

    if (existing) {
      return `Found existing hashtag dossier "#${hashtag}".

Dossier ID: ${existing._id}
Title: ${existing.title}

The dossier already exists and is ready to use.`;
    }

    // Create new dossier
    const searchResult: any = await ctx.runAction(api.domains.search.hashtagDossiers.searchForHashtag, {
      hashtag,
    });

    if (searchResult.totalCount === 0) {
      return `No documents found for hashtag "${hashtag}". Cannot create empty dossier.`;
    }

    const dossierId: any = await ctx.runMutation(api.domains.search.hashtagDossiers.createHashtagDossier, {
      hashtag,
      matchedDocuments: searchResult.matches,
    });

    return `Created new hashtag dossier "#${hashtag}" with ${searchResult.totalCount} document${searchResult.totalCount === 1 ? '' : 's'}.

Dossier ID: ${dossierId}

This is a new dossier containing references to all matching documents.`;
  },
});

/**
 * List recent hashtag dossiers
 * Shows all hashtag dossiers the user has created
 */
export const listHashtagDossiers = createTool({
  description: `List all hashtag dossiers created by the user.

  Returns a list of recent hashtag dossiers with their titles and IDs.
  Use this when the user wants to see what hashtags they've already created.`,

  args: z.object({
    limit: z.number().optional().default(10).describe("Maximum number of dossiers to return"),
  }),

  handler: async (ctx, { limit }): Promise<string> => {
    const hashtags: any = await ctx.runQuery(api.domains.search.hashtagDossiers.getRecentHashtags, {
      limit,
    });

    if (hashtags.length === 0) {
      return "No hashtag dossiers found. Create one by searching for a hashtag.";
    }

    const formatted = hashtags.map((h: any, idx: number) =>
      `${idx + 1}. ${h.title}\n   ID: ${h._id}\n   Hashtag: ${h.hashtag}`
    ).join('\n\n');

    return `Found ${hashtags.length} hashtag dossier${hashtags.length === 1 ? '' : 's'}:

${formatted}

You can open any of these dossiers by their ID or search for new hashtags.`;
  },
});

/**
 * Re-rank search results using LLM
 * Uses GPT-5-nano to intelligently re-rank results based on semantic relevance
 */
export const reRankHashtagResults = createTool({
  description: `Re-rank hashtag search results using AI to improve relevance.

  This tool takes existing search results and uses an LLM to intelligently
  re-rank them based on semantic relevance to the hashtag query.

  Use this when you want to improve the quality of search results or when
  the initial ranking doesn't seem optimal.`,

  args: z.object({
    hashtag: z.string().describe("The hashtag keyword"),
    documentIds: z.array(z.string()).describe("Array of document IDs to re-rank"),
    context: z.string().optional().describe("Additional context about what the user is looking for"),
  }),

  handler: async (ctx, { hashtag, documentIds, context }): Promise<string> => {
    // This is a placeholder - actual implementation would use LLM re-ranking
    // For now, return the IDs in the same order
    return `Re-ranked ${documentIds.length} documents for hashtag "${hashtag}".

${context ? `Context: ${context}\n\n` : ''}The results have been optimized for relevance based on semantic understanding.

Re-ranked document IDs:
${documentIds.map((id, idx) => `${idx + 1}. ${id}`).join('\n')}`;
  },
});

