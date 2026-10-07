// convex/tools/context/resourceLinks.ts
// MCP-style resource_link pattern for large tool outputs
// Wraps large outputs as artifact pointers to reduce context bloat

import { v } from "convex/values";
import { internalMutation, internalQuery, query, action, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";

// Simple hash function using Web Crypto (works in both runtimes)
async function sha256HexWebCrypto(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ */
/* TYPES                                                               */
/* ------------------------------------------------------------------ */

/**
 * MCP resource_link structure
 */
export interface ResourceLink {
  type: "resource_link";
  resourceId: Id<"resourceLinks">;
  artifactId: Id<"sourceArtifacts">;
  mimeType: string;
  sizeBytes: number;
  preview: string;
  title?: string;
  retrievalHint: {
    query?: string;       // Suggested query for retrieval
    budget?: number;      // Suggested token budget
    chunkIds?: string[];  // Pre-identified relevant chunks
  };
}

/**
 * Output from resource_link wrapping decision
 */
export interface ResourceLinkOutput {
  inlineContent?: string;           // If small enough to inline
  resourceLink?: ResourceLink;      // If large, wrap as link
  wasWrapped: boolean;
  tokenSavings: number;
  originalSize: number;
}

/* ------------------------------------------------------------------ */
/* CONSTANTS                                                           */
/* ------------------------------------------------------------------ */

// Threshold for wrapping (100KB)
const WRAP_THRESHOLD_BYTES = 100 * 1024;

// Approximate tokens per character (for estimation)
const TOKENS_PER_CHAR = 0.25;

// Preview length for resource_links
const PREVIEW_LENGTH = 500;

/* ------------------------------------------------------------------ */
/* HELPERS                                                             */
/* ------------------------------------------------------------------ */

/**
 * Get byte length of string (Web-compatible)
 */
function getByteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

/**
 * Determine if content should be wrapped as a resource_link
 */
export function shouldWrapAsLink(content: string, mimeType: string = "text/plain"): boolean {
  const sizeBytes = getByteLength(content);
  return sizeBytes >= WRAP_THRESHOLD_BYTES;
}

/**
 * Create a preview from content
 */
export function createPreview(content: string, maxChars: number = PREVIEW_LENGTH): string {
  if (content.length <= maxChars) {
    return content;
  }

  // Try to cut at a sentence or paragraph boundary
  const truncated = content.substring(0, maxChars);
  const lastPeriod = truncated.lastIndexOf(". ");
  const lastNewline = truncated.lastIndexOf("\n");

  const cutPoint = Math.max(lastPeriod, lastNewline);
  if (cutPoint > maxChars * 0.5) {
    return truncated.substring(0, cutPoint + 1) + "...";
  }

  return truncated + "...";
}

/**
 * Estimate token count from content
 */
export function estimateTokens(content: string): number {
  return Math.ceil(content.length * TOKENS_PER_CHAR);
}

/**
 * Extract title from content (first line or heading)
 */
function extractTitle(content: string): string | undefined {
  const lines = content.split("\n").filter(l => l.trim());
  if (lines.length === 0) return undefined;

  const firstLine = lines[0].trim();

  // Check for markdown heading
  const headingMatch = firstLine.match(/^#+\s+(.+)$/);
  if (headingMatch) return headingMatch[1].substring(0, 100);

  // Use first line if short enough
  if (firstLine.length <= 100) return firstLine;

  return firstLine.substring(0, 97) + "...";
}

/* ------------------------------------------------------------------ */
/* MUTATIONS - Resource link creation                                 */
/* ------------------------------------------------------------------ */

/**
 * Create a resource_link for large content
 */
export const createResourceLink = internalMutation({
  args: {
    runId: v.optional(v.id("agentRuns")),
    toolName: v.string(),
    toolCallId: v.string(),
    artifactId: v.id("sourceArtifacts"),
    mimeType: v.string(),
    sizeBytes: v.number(),
    preview: v.string(),
    title: v.optional(v.string()),
    originalTokenEstimate: v.number(),
    actualTokens: v.number(),
  },
  returns: v.id("resourceLinks"),
  handler: async (ctx, args) => {
    const tokenSavings = args.originalTokenEstimate - args.actualTokens;
    const now = Date.now();

    const id = await ctx.db.insert("resourceLinks", {
      runId: args.runId,
      toolName: args.toolName,
      toolCallId: args.toolCallId,
      artifactId: args.artifactId,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      preview: args.preview,
      title: args.title,
      originalTokenEstimate: args.originalTokenEstimate,
      actualTokens: args.actualTokens,
      tokenSavings,
      createdAt: now,
    });

    return id;
  },
});

/**
 * Record access to a resource_link
 */
export const recordResourceAccess = internalMutation({
  args: {
    resourceId: v.id("resourceLinks"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.resourceId, {
      accessedAt: Date.now(),
    });
    return null;
  },
});

/* ------------------------------------------------------------------ */
/* QUERIES - Resource link retrieval                                  */
/* ------------------------------------------------------------------ */

/**
 * Get resource_link by ID
 */
export const getResourceLink = query({
  args: {
    resourceId: v.id("resourceLinks"),
  },
  returns: v.union(
    v.object({
      _id: v.id("resourceLinks"),
      runId: v.union(v.id("agentRuns"), v.null()),
      toolName: v.string(),
      toolCallId: v.string(),
      artifactId: v.id("sourceArtifacts"),
      mimeType: v.string(),
      sizeBytes: v.number(),
      preview: v.string(),
      title: v.union(v.string(), v.null()),
      originalTokenEstimate: v.number(),
      actualTokens: v.number(),
      tokenSavings: v.number(),
      createdAt: v.number(),
      accessedAt: v.union(v.number(), v.null()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.resourceId);
    if (!link) return null;

    return {
      _id: link._id,
      runId: link.runId ?? null,
      toolName: link.toolName,
      toolCallId: link.toolCallId,
      artifactId: link.artifactId,
      mimeType: link.mimeType,
      sizeBytes: link.sizeBytes,
      preview: link.preview,
      title: link.title ?? null,
      originalTokenEstimate: link.originalTokenEstimate,
      actualTokens: link.actualTokens,
      tokenSavings: link.tokenSavings,
      createdAt: link.createdAt,
      accessedAt: link.accessedAt ?? null,
    };
  },
});

/**
 * Get all resource_links for a run
 */
export const getResourceLinksForRun = query({
  args: {
    runId: v.id("agentRuns"),
  },
  returns: v.array(v.object({
    _id: v.id("resourceLinks"),
    toolName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    preview: v.string(),
    title: v.union(v.string(), v.null()),
    tokenSavings: v.number(),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const links = await ctx.db
      .query("resourceLinks")
      .withIndex("by_run", q => q.eq("runId", args.runId))
      .collect();

    return links.map(link => ({
      _id: link._id,
      toolName: link.toolName,
      mimeType: link.mimeType,
      sizeBytes: link.sizeBytes,
      preview: link.preview,
      title: link.title ?? null,
      tokenSavings: link.tokenSavings,
      createdAt: link.createdAt,
    }));
  },
});

/* ------------------------------------------------------------------ */
/* ACTION - Main wrapping logic                                       */
/* ------------------------------------------------------------------ */

/**
 * Wrap tool output as resource_link if needed
 * This is the main entry point for the resource_link pattern
 */
export const wrapToolOutput = action({
  args: {
    runId: v.optional(v.id("agentRuns")),
    toolName: v.string(),
    toolCallId: v.string(),
    content: v.string(),
    mimeType: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
  },
  returns: v.object({
    inlineContent: v.optional(v.string()),
    resourceLink: v.optional(v.object({
      type: v.literal("resource_link"),
      resourceId: v.id("resourceLinks"),
      artifactId: v.id("sourceArtifacts"),
      mimeType: v.string(),
      sizeBytes: v.number(),
      preview: v.string(),
      title: v.optional(v.string()),
      retrievalHint: v.object({
        query: v.optional(v.string()),
        budget: v.optional(v.number()),
        chunkIds: v.optional(v.array(v.string())),
      }),
    })),
    wasWrapped: v.boolean(),
    tokenSavings: v.number(),
    originalSize: v.number(),
  }),
  handler: async (ctx, args): Promise<ResourceLinkOutput> => {
    const { content, toolName, toolCallId, runId, sourceUrl } = args;
    const mimeType = args.mimeType || "text/plain";
    const sizeBytes = getByteLength(content);

    // Check if should wrap
    if (!shouldWrapAsLink(content, mimeType)) {
      return {
        inlineContent: content,
        wasWrapped: false,
        tokenSavings: 0,
        originalSize: sizeBytes,
      };
    }

    // Wrap as resource_link
    const preview = createPreview(content);
    const title = extractTitle(content);
    const originalTokens = estimateTokens(content);
    const actualTokens = estimateTokens(preview);
    const contentHash = await sha256HexWebCrypto(content);

    // Store as artifact
    const artifactResult = await ctx.runMutation(
      internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact,
      {
        runId,
        sourceType: "api_response",
        sourceUrl,
        contentHash,
        rawContent: content,
        mimeType,
        sizeBytes,
        title,
        fetchedAt: Date.now(),
      }
    );

    // Create resource_link
    const resourceId = await ctx.runMutation(
      internal.tools.context.resourceLinks.createResourceLink,
      {
        runId,
        toolName,
        toolCallId,
        artifactId: artifactResult.id,
        mimeType,
        sizeBytes,
        preview,
        title,
        originalTokenEstimate: originalTokens,
        actualTokens,
      }
    );

    const resourceLink: ResourceLink = {
      type: "resource_link",
      resourceId,
      artifactId: artifactResult.id,
      mimeType,
      sizeBytes,
      preview,
      title,
      retrievalHint: {
        query: title,
        budget: 2000,
      },
    };

    return {
      resourceLink,
      wasWrapped: true,
      tokenSavings: originalTokens - actualTokens,
      originalSize: sizeBytes,
    };
  },
});
