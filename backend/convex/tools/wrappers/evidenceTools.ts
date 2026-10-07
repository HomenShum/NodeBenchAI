/**
 * Evidence Tools - wrappers for store → index → retrieve
 *
 * These tools return compact evidence handles (IDs + quotes) suitable for
 * progressive disclosure and deterministic citation.
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api } from "../../_generated/api";

export const fetchUrlToEvidence = createTool({
  description:
    "Fetch a URL and store it as a durable sourceArtifact, returning an artifactId + short preview (not full content).",
  args: z.object({
    url: z.string().describe("URL to fetch"),
    renderJs: z.boolean().optional().describe("Enable JavaScript rendering (paywalled/dynamic pages)"),
    includeRawHtml: z.boolean().optional().describe("Request raw HTML (if available)"),
    extractImages: z.boolean().optional().describe("Extract image URLs when available"),
    forceRefresh: z.boolean().optional().describe("Bypass cache"),
    maxPreviewChars: z.number().optional().describe("Max preview size"),
  }),
  handler: async (ctx, args) => {
    return await ctx.runAction(api.tools.media.linkupFetch.linkupFetchEvidence, args as any);
  },
});

export const indexEvidenceArtifact = createTool({
  description: "Index a sourceArtifact into addressable evidence chunks (artifactChunks).",
  args: z.object({
    artifactId: z.string().describe("sourceArtifacts ID to index"),
  }),
  handler: async (ctx, args) => {
    return await ctx.runAction(api.tools.knowledge.evidenceTools.indexArtifact, {
      artifactId: args.artifactId as any,
    });
  },
});

export const searchEvidence = createTool({
  description:
    "Search indexed evidence (artifactChunks) and return top matching quotes with chunk IDs for citation.",
  args: z.object({
    query: z.string().describe("What to find in the evidence"),
    runId: z.string().optional().describe("Optional agentRuns ID to scope search"),
    artifactId: z.string().optional().describe("Optional sourceArtifacts ID to scope search"),
    artifactIds: z.array(z.string()).optional().describe("Optional list of sourceArtifacts IDs to scope search"),
    ensureIndexed: z.boolean().optional().describe("Index missing artifacts before searching"),
    maxResults: z.number().optional().describe("Max number of results"),
    maxQuoteChars: z.number().optional().describe("Max quote length per result"),
  }),
  handler: async (ctx, args) => {
    return await ctx.runAction(api.tools.knowledge.evidenceTools.searchEvidence, {
      query: args.query,
      runId: args.runId as any,
      artifactId: args.artifactId as any,
      artifactIds: args.artifactIds as any,
      ensureIndexed: args.ensureIndexed,
      maxResults: args.maxResults,
      maxQuoteChars: args.maxQuoteChars,
    });
  },
});

export const getEvidenceChunk = createTool({
  description: "Fetch a specific evidence chunk by chunkId (bounded text).",
  args: z.object({
    chunkId: z.string().describe("artifactChunks ID to fetch"),
    maxChars: z.number().optional().describe("Max characters of chunk text to return"),
  }),
  handler: async (ctx, args) => {
    return await ctx.runAction(api.tools.knowledge.evidenceTools.getEvidenceChunk, {
      chunkId: args.chunkId as any,
      maxChars: args.maxChars,
    });
  },
});

