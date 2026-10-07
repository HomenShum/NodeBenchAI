// convex/tools/context/retrieveArtifact.ts
// MCP-style artifact retrieval tool for large outputs
// Enables agents to selectively retrieve content from resource_links

import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id, Doc } from "../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* TYPES                                                               */
/* ------------------------------------------------------------------ */

/**
 * Excerpt from artifact retrieval
 */
export interface ArtifactExcerpt {
  chunkId: string;
  text: string;
  relevanceScore: number;
  citation: {
    artifactId: string;
    sourceUrl?: string;
    startOffset?: number;
    endOffset?: number;
    pageIndex?: number;
    anchor: string;  // Citation anchor: {{cite:artifactId:chunkId}}
  };
}

/**
 * Result of artifact retrieval
 */
export interface RetrievalResult {
  excerpts: ArtifactExcerpt[];
  tokensUsed: number;
  tokenBudget: number;
  artifactTitle?: string;
  artifactUrl?: string;
  totalChunksSearched: number;
}

/* ------------------------------------------------------------------ */
/* CONSTANTS                                                           */
/* ------------------------------------------------------------------ */

// Default token budget for retrieval
const DEFAULT_TOKEN_BUDGET = 2000;

// Maximum token budget allowed
const MAX_TOKEN_BUDGET = 8000;

// Approximate tokens per character
const TOKENS_PER_CHAR = 0.25;

// Maximum chunks to return
const MAX_EXCERPTS = 10;

/* ------------------------------------------------------------------ */
/* HELPERS                                                             */
/* ------------------------------------------------------------------ */

/**
 * Estimate token count from text
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

/**
 * Generate citation anchor
 */
function generateCitationAnchor(artifactId: string, chunkId: string): string {
  return `{{cite:${artifactId}:${chunkId}}}`;
}

/**
 * Truncate text to fit within token budget
 */
function truncateToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = Math.floor(maxTokens / TOKENS_PER_CHAR);
  if (text.length <= maxChars) return text;

  // Try to cut at sentence boundary
  const truncated = text.substring(0, maxChars);
  const lastPeriod = truncated.lastIndexOf(". ");
  const lastNewline = truncated.lastIndexOf("\n");

  const cutPoint = Math.max(lastPeriod, lastNewline);
  if (cutPoint > maxChars * 0.7) {
    return truncated.substring(0, cutPoint + 1);
  }

  return truncated + "...";
}

/* ------------------------------------------------------------------ */
/* INTERNAL QUERIES                                                    */
/* ------------------------------------------------------------------ */

/**
 * Get artifact metadata for retrieval
 */
export const getArtifactForRetrieval = internalQuery({
  args: {
    artifactId: v.id("sourceArtifacts"),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("sourceArtifacts"),
      title: v.optional(v.string()),
      sourceUrl: v.optional(v.string()),
      rawContent: v.optional(v.string()),
      sizeBytes: v.optional(v.number()),
      mimeType: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId) as Doc<"sourceArtifacts"> | null;
    if (!artifact) return null;

    return {
      _id: artifact._id,
      title: artifact.title,
      sourceUrl: artifact.sourceUrl,
      rawContent: artifact.rawContent,
      sizeBytes: artifact.sizeBytes,
      mimeType: artifact.mimeType,
    };
  },
});

/**
 * Search chunks within an artifact
 */
export const searchArtifactChunks = internalQuery({
  args: {
    artifactId: v.id("sourceArtifacts"),
    query: v.string(),
    maxResults: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      chunkId: v.id("artifactChunks"),
      text: v.string(),
      startOffset: v.optional(v.number()),
      endOffset: v.optional(v.number()),
      pageIndex: v.optional(v.number()),
      sourceUrl: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    const maxResults = Math.min(args.maxResults ?? MAX_EXCERPTS, MAX_EXCERPTS);

    // Search chunks using full-text search
    const chunks = await ctx.db
      .query("artifactChunks")
      .withSearchIndex("search_text", (q) =>
        q.search("text", args.query)
          .eq("artifactId", args.artifactId)
          .eq("chunkVersion", 1)
      )
      .take(maxResults);

    return (chunks as Doc<"artifactChunks">[]).map((chunk) => ({
      chunkId: chunk._id,
      text: chunk.text,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      pageIndex: chunk.pageIndex,
      sourceUrl: chunk.sourceUrl,
    }));
  },
});

/**
 * Get all chunks for an artifact (for fallback when no search results)
 */
export const getArtifactChunks = internalQuery({
  args: {
    artifactId: v.id("sourceArtifacts"),
    maxResults: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      chunkId: v.id("artifactChunks"),
      text: v.string(),
      startOffset: v.optional(v.number()),
      endOffset: v.optional(v.number()),
      pageIndex: v.optional(v.number()),
      sourceUrl: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    const maxResults = Math.min(args.maxResults ?? MAX_EXCERPTS, MAX_EXCERPTS);

    const chunks = await ctx.db
      .query("artifactChunks")
      .withIndex("by_artifact_version_offset", (q) =>
        q.eq("artifactId", args.artifactId).eq("chunkVersion", 1)
      )
      .take(maxResults);

    return (chunks as Doc<"artifactChunks">[]).map((chunk) => ({
      chunkId: chunk._id,
      text: chunk.text,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      pageIndex: chunk.pageIndex,
      sourceUrl: chunk.sourceUrl,
    }));
  },
});

/* ------------------------------------------------------------------ */
/* INTERNAL MUTATIONS                                                  */
/* ------------------------------------------------------------------ */

/**
 * Record resource access for analytics
 */
export const recordAccess = internalMutation({
  args: {
    resourceId: v.optional(v.id("resourceLinks")),
    artifactId: v.id("sourceArtifacts"),
    query: v.string(),
    excerptCount: v.number(),
    tokensUsed: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Update resourceLink access timestamp if provided
    if (args.resourceId) {
      await ctx.db.patch(args.resourceId, {
        accessedAt: Date.now(),
      });
    }
    return null;
  },
});

/* ------------------------------------------------------------------ */
/* ACTION - Main retrieval tool                                        */
/* ------------------------------------------------------------------ */

/**
 * Retrieve excerpts from an artifact based on a query
 * This is the main entry point for the retrieval tool
 */
export const retrieveArtifact = action({
  args: {
    artifactId: v.id("sourceArtifacts"),
    query: v.string(),
    budget: v.optional(v.number()),      // Max tokens (default: 2000)
    resourceId: v.optional(v.id("resourceLinks")), // Optional link to resource_link
  },
  returns: v.object({
    excerpts: v.array(v.object({
      chunkId: v.string(),
      text: v.string(),
      relevanceScore: v.number(),
      citation: v.object({
        artifactId: v.string(),
        sourceUrl: v.optional(v.string()),
        startOffset: v.optional(v.number()),
        endOffset: v.optional(v.number()),
        pageIndex: v.optional(v.number()),
        anchor: v.string(),
      }),
    })),
    tokensUsed: v.number(),
    tokenBudget: v.number(),
    artifactTitle: v.optional(v.string()),
    artifactUrl: v.optional(v.string()),
    totalChunksSearched: v.number(),
  }),
  handler: async (ctx, args): Promise<RetrievalResult> => {
    const tokenBudget = Math.min(args.budget ?? DEFAULT_TOKEN_BUDGET, MAX_TOKEN_BUDGET);

    // Get artifact metadata
    const artifact = await ctx.runQuery(
      internal.tools.context.retrieveArtifact.getArtifactForRetrieval,
      { artifactId: args.artifactId }
    );

    if (!artifact) {
      return {
        excerpts: [],
        tokensUsed: 0,
        tokenBudget,
        totalChunksSearched: 0,
      };
    }

    // Search for relevant chunks
    let chunks = await ctx.runQuery(
      internal.tools.context.retrieveArtifact.searchArtifactChunks,
      {
        artifactId: args.artifactId,
        query: args.query,
        maxResults: MAX_EXCERPTS,
      }
    );

    // If no chunks exist yet for this artifact, index it once and retry search.
    if (chunks.length === 0) {
      const chunkCount = await ctx.runQuery(internal.domains.artifacts.evidenceSearch.countChunksForArtifact, {
        artifactId: args.artifactId,
      });

      if (chunkCount === 0) {
        await ctx.runAction(internal.domains.artifacts.evidenceIndexActions.indexArtifact, {
          artifactId: args.artifactId,
        });

        chunks = await ctx.runQuery(
          internal.tools.context.retrieveArtifact.searchArtifactChunks,
          {
            artifactId: args.artifactId,
            query: args.query,
            maxResults: MAX_EXCERPTS,
          }
        );
      }
    }

    // Fallback: if no search results, get first chunks
    if (chunks.length === 0) {
      chunks = await ctx.runQuery(
        internal.tools.context.retrieveArtifact.getArtifactChunks,
        {
          artifactId: args.artifactId,
          maxResults: MAX_EXCERPTS,
        }
      );
    }

    // Build excerpts within token budget
    const excerpts: ArtifactExcerpt[] = [];
    let tokensUsed = 0;
    let relevanceScore = 1.0; // Decreasing score for each result

    for (const chunk of chunks) {
      const chunkTokens = estimateTokens(chunk.text);

      // Check if adding this chunk would exceed budget
      if (tokensUsed + chunkTokens > tokenBudget) {
        // Try to fit a truncated version
        const remainingBudget = tokenBudget - tokensUsed;
        if (remainingBudget > 50) { // Only add if meaningful space remains
          const truncatedText = truncateToTokenBudget(chunk.text, remainingBudget);
          excerpts.push({
            chunkId: chunk.chunkId,
            text: truncatedText,
            relevanceScore,
            citation: {
              artifactId: args.artifactId,
              sourceUrl: chunk.sourceUrl,
              startOffset: chunk.startOffset,
              endOffset: chunk.endOffset,
              pageIndex: chunk.pageIndex,
              anchor: generateCitationAnchor(args.artifactId, chunk.chunkId),
            },
          });
          tokensUsed += estimateTokens(truncatedText);
        }
        break;
      }

      excerpts.push({
        chunkId: chunk.chunkId,
        text: chunk.text,
        relevanceScore,
        citation: {
          artifactId: args.artifactId,
          sourceUrl: chunk.sourceUrl,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          pageIndex: chunk.pageIndex,
          anchor: generateCitationAnchor(args.artifactId, chunk.chunkId),
        },
      });

      tokensUsed += chunkTokens;
      relevanceScore = Math.max(0.1, relevanceScore - 0.1); // Decrease score
    }

    // Record access for analytics
    await ctx.runMutation(
      internal.tools.context.retrieveArtifact.recordAccess,
      {
        resourceId: args.resourceId,
        artifactId: args.artifactId,
        query: args.query,
        excerptCount: excerpts.length,
        tokensUsed,
      }
    );

    return {
      excerpts,
      tokensUsed,
      tokenBudget,
      artifactTitle: artifact.title,
      artifactUrl: artifact.sourceUrl,
      totalChunksSearched: chunks.length,
    };
  },
});

/**
 * Retrieve full raw content from an artifact (no chunking)
 * Use this when you need the complete content and budget allows
 */
export const retrieveFullArtifact = action({
  args: {
    artifactId: v.id("sourceArtifacts"),
    budget: v.optional(v.number()),
  },
  returns: v.object({
    content: v.optional(v.string()),
    truncated: v.boolean(),
    tokensUsed: v.number(),
    tokenBudget: v.number(),
    artifactTitle: v.optional(v.string()),
    artifactUrl: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const tokenBudget = Math.min(args.budget ?? DEFAULT_TOKEN_BUDGET, MAX_TOKEN_BUDGET);

    // Get artifact with full content
    const artifact = await ctx.runQuery(
      internal.tools.context.retrieveArtifact.getArtifactForRetrieval,
      { artifactId: args.artifactId }
    );

    if (!artifact || !artifact.rawContent) {
      return {
        content: undefined,
        truncated: false,
        tokensUsed: 0,
        tokenBudget,
        artifactTitle: artifact?.title,
        artifactUrl: artifact?.sourceUrl,
      };
    }

    const contentTokens = estimateTokens(artifact.rawContent);

    if (contentTokens <= tokenBudget) {
      return {
        content: artifact.rawContent,
        truncated: false,
        tokensUsed: contentTokens,
        tokenBudget,
        artifactTitle: artifact.title,
        artifactUrl: artifact.sourceUrl,
      };
    }

    // Truncate to budget
    const truncatedContent = truncateToTokenBudget(artifact.rawContent, tokenBudget);
    return {
      content: truncatedContent,
      truncated: true,
      tokensUsed: estimateTokens(truncatedContent),
      tokenBudget,
      artifactTitle: artifact.title,
      artifactUrl: artifact.sourceUrl,
    };
  },
});

/**
 * Batch retrieve from multiple artifacts
 * Useful for distillation across multiple sources
 */
export const retrieveMultipleArtifacts = action({
  args: {
    artifactIds: v.array(v.id("sourceArtifacts")),
    query: v.string(),
    totalBudget: v.optional(v.number()),
  },
  returns: v.object({
    results: v.array(v.object({
      artifactId: v.id("sourceArtifacts"),
      excerpts: v.array(v.object({
        chunkId: v.string(),
        text: v.string(),
        relevanceScore: v.number(),
        citation: v.object({
          artifactId: v.string(),
          sourceUrl: v.optional(v.string()),
          startOffset: v.optional(v.number()),
          endOffset: v.optional(v.number()),
          pageIndex: v.optional(v.number()),
          anchor: v.string(),
        }),
      })),
      tokensUsed: v.number(),
      artifactTitle: v.optional(v.string()),
    })),
    totalTokensUsed: v.number(),
    totalBudget: v.number(),
  }),
  handler: async (ctx, args) => {
    const totalBudget = Math.min(args.totalBudget ?? DEFAULT_TOKEN_BUDGET * 2, MAX_TOKEN_BUDGET * 2);
    const perArtifactBudget = Math.floor(totalBudget / Math.max(1, args.artifactIds.length));

    const results: Array<{
      artifactId: Id<"sourceArtifacts">;
      excerpts: ArtifactExcerpt[];
      tokensUsed: number;
      artifactTitle?: string;
    }> = [];

    let totalTokensUsed = 0;

    for (const artifactId of args.artifactIds) {
      // Calculate remaining budget for this artifact
      const remainingBudget = totalBudget - totalTokensUsed;
      const budget = Math.min(perArtifactBudget, remainingBudget);

      if (budget < 50) break; // Stop if budget is too low

      const result = await ctx.runAction(
        internal.tools.context.retrieveArtifact.retrieveArtifact,
        {
          artifactId,
          query: args.query,
          budget,
        }
      );

      results.push({
        artifactId,
        excerpts: result.excerpts,
        tokensUsed: result.tokensUsed,
        artifactTitle: result.artifactTitle,
      });

      totalTokensUsed += result.tokensUsed;

      if (totalTokensUsed >= totalBudget) break;
    }

    return {
      results,
      totalTokensUsed,
      totalBudget,
    };
  },
});
